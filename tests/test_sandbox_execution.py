"""Real Git snapshot / Docker sandbox integration and scope rejection tests."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from sandbox.execute_ticket import run, scoped_path, RunnerFailure


class SandboxExecutionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sutradhar-runner-test-")
        self.root = Path(self.directory.name)
        self.repo = self.root / "project"
        self.repo.mkdir()
        self._git("init", "-q")
        self._git("config", "user.email", "test@local.invalid")
        self._git("config", "user.name", "Sutradhar CI")
        (self.repo / "value.txt").write_text("OLD\n", encoding="utf-8")
        (self.repo / "tests").mkdir()
        (self.repo / "tests" / "test_value.py").write_text(
            "from pathlib import Path\n\n"
            "def test_value():\n"
            "    assert Path('/workspace/value.txt').read_text() == 'NEW\\n'\n",
            encoding="utf-8"
        )
        (self.repo / ".env.example").write_text("FAKE_CONFIG=not-a-secret\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "baseline")

        (self.repo / "value.txt").write_text("NEW\n", encoding="utf-8")
        patch = subprocess.run(
            ["git", "-C", str(self.repo), "diff", "--", "value.txt"],
            capture_output=True, text=True, check=True
        ).stdout
        self._git("checkout", "--", "value.txt")
        self.patch = self.root / "candidate.patch"
        self.patch.write_text(patch, encoding="utf-8")
        self.args = argparse.Namespace(
            repo_root=str(self.repo), patch_file=str(self.patch),
            allowed_file=["value.txt"], test_command="python3 -m pytest -q"
        )

    def tearDown(self):
        self.directory.cleanup()

    def _git(self, *args):
        subprocess.run(
            ["git", "-C", str(self.repo), *args], check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )

    def test_whitelist_rejects_valid_patch_outside_scope(self):
        self.args.allowed_file = ["tests/test_value.py"]
        result = run(self.args)
        self.assertEqual(result["status"], "PATCH_REJECTED", result)
        self.assertFalse(result["patchValid"])
        self.assertIsNone(result["exitCode"])

    def test_invalid_patch_fails_before_container(self):
        self.patch.write_text("this is not a Git diff", encoding="utf-8")
        result = run(self.args)
        self.assertEqual(result["status"], "PATCH_REJECTED", result)
        self.assertIsNone(result["exitCode"])

    def test_non_git_workspace_is_rejected(self):
        self.args.repo_root = str(self.root)
        result = run(self.args)
        self.assertEqual(result["status"], "PREPARE_FAILED", result)
        self.assertFalse(result["patchValid"])

    def test_path_traversal_and_secrets_are_rejected(self):
        for name in ("../escape.py", "/etc/passwd", ".git/config", "secrets/key.pem",
                     ".env", "modules/../secret.py", "modules\\escape.py"):
            with self.subTest(path=name):
                with self.assertRaises(RunnerFailure):
                    scoped_path(name)

    @unittest.skipUnless(os.getenv("SUTRADHAR_REAL_DOCKER_E2E") == "1", "Docker E2E opt-in")
    def test_real_docker_passes_only_applied_candidate(self):
        if not shutil.which("docker"):
            self.skipTest("Docker binary missing")
        result = run(self.args)
        self.assertEqual(result["status"], "TEST_PASSED", result)
        self.assertEqual(result["exitCode"], 0)
        self.assertTrue(result["patchValid"])
        self.assertEqual(result["changedFiles"], ["value.txt"])
        self.assertIn("__SUTRADHAR_CONTAINER_TEST_STARTED__", result["stdout"])

    @unittest.skipUnless(os.getenv("SUTRADHAR_REAL_DOCKER_E2E") == "1", "Docker E2E opt-in")
    def test_real_docker_failing_test_is_not_success(self):
        if not shutil.which("docker"):
            self.skipTest("Docker binary missing")
        self.patch.write_text(self.patch.read_text().replace("+NEW", "+BAD"))
        result = run(self.args)
        self.assertEqual(result["status"], "TEST_FAILED", result)
        self.assertNotEqual(result["exitCode"], 0)
        self.assertTrue(result["patchValid"])


if __name__ == "__main__":
    unittest.main()
