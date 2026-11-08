"""Real local Git remote integration for tested-tree-only worker branch publication."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from sandbox.push_tested_branch import push_tested_patch, PublishFailure


def git(directory: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(directory), *args], stderr=subprocess.PIPE, text=True
    ).strip()


class TestedBranchPushTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="sutradhar-push-e2e-")
        self.root = Path(self.folder.name)
        self.remote = self.root / "remote.git"
        self.source = self.root / "source"
        self.remote.mkdir()
        self.source.mkdir()
        git(self.remote, "init", "--bare", "-q")
        git(self.source, "init", "-b", "main", "-q")
        git(self.source, "config", "user.name", "Sandbox Fixture")
        git(self.source, "config", "user.email", "fixture@local.invalid")
        git(self.source, "remote", "add", "origin", str(self.remote))
        (self.source / "value.txt").write_text("OLD\n")
        (self.source / "README.md").write_text("README\n")
        (self.source / ".env.example").write_text("SAMPLE_ONLY=true\n")
        git(self.source, "add", "-A")
        git(self.source, "commit", "-q", "-m", "baseline")
        git(self.source, "push", "-q", "origin", "main")
        self.baseline = git(self.source, "rev-parse", "HEAD")
        (self.source / "value.txt").write_text("NEW\n")
        self.patch = subprocess.check_output(
            ["git", "-C", str(self.source), "diff", "--", "value.txt"]
        )
        git(self.source, "add", "value.txt")
        self.tree = git(self.source, "write-tree")
        git(self.source, "reset", "--hard", "-q", "HEAD")
        self.branch = "worker-test/ticket-push-001"

    def tearDown(self):
        self.folder.cleanup()

    def push(self, **overrides):
        args = {
            "repo_root": str(self.source),
            "github_repository": "acme/widgets",
            "ticket_id": "TKT-PUSH-001",
            "branch": self.branch,
            "baseline_commit": self.baseline,
            "candidate_tree_sha": self.tree,
            "patch_sha256": hashlib.sha256(self.patch).hexdigest(),
            "patch": self.patch,
            "changed_files": ["value.txt"],
            "allowed_files": ["value.txt"],
            "allow_local_remote": True,
        }
        args.update(overrides)
        return push_tested_patch(**args)

    def remote_branch(self):
        output = git(self.remote, "show-ref", "--verify", f"refs/heads/{self.branch}")
        return output.split()[0]

    def test_exact_pushed_branch_is_single_child_and_main_unchanged(self):
        result = self.push()
        self.assertEqual(result["status"], "PUSH_CONFIRMED_NOT_MERGED")
        self.assertEqual(result["treeSha"], self.tree)
        self.assertEqual(result["headSha"], self.remote_branch())
        self.assertEqual(git(self.remote, "rev-parse", "refs/heads/main"), self.baseline)
        self.assertEqual(git(self.remote, "rev-parse", f"{result['headSha']}^"), self.baseline)
        self.assertEqual(git(self.remote, "rev-parse", f"{result['headSha']}^{{tree}}"), self.tree)
        self.assertEqual(result["changedFiles"], ["value.txt"])

    def test_duplicate_branch_cannot_be_overwritten_or_force_pushed(self):
        self.push()
        before = self.remote_branch()
        with self.assertRaises(PublishFailure) as error:
            self.push()
        self.assertEqual(error.exception.code, "WORKER_BRANCH_ALREADY_EXISTS")
        self.assertEqual(self.remote_branch(), before)

    def test_mismatched_tree_rejects_before_remote_push(self):
        with self.assertRaises(PublishFailure) as error:
            self.push(candidate_tree_sha="e" * 40)
        self.assertEqual(error.exception.code, "TESTED_GIT_TREE_MISMATCH")
        self.assertEqual(git(self.remote, "rev-parse", "refs/heads/main"), self.baseline)

    def test_forged_patch_hash_or_out_of_scope_file_denies(self):
        for override in [
            {"patch_sha256": "f" * 64},
            {"changed_files": ["README.md"]},
            {"allowed_files": ["README.md"]},
            {"branch": "main"},
            {"branch": "worker-test/ticket-../main"},
        ]:
            with self.subTest(override=override):
                with self.assertRaises((PublishFailure, Exception)):
                    self.push(**override)

    def test_dirty_unrelated_source_changes_are_not_pushed(self):
        (self.source / "README.md").write_text("DIRTY_UNRELATED\n")
        (self.source / "untracked.txt").write_text("UNTRACKED\n")
        result = self.push()
        self.assertEqual(result["treeSha"], self.tree)
        self.assertEqual(git(self.remote, "show", result["headSha"] + ":README.md"), "README")

    def test_remote_main_moved_fails_closed(self):
        other = self.root / "other"
        subprocess.check_call(["git", "clone", "-q", str(self.remote), str(other)])
        git(other, "checkout", "-q", "-b", "main", self.baseline)
        git(other, "config", "user.name", "Other")
        git(other, "config", "user.email", "other@local.invalid")
        (other / "README.md").write_text("UPDATED\n")
        git(other, "add", "README.md")
        git(other, "commit", "-q", "-m", "new main")
        git(other, "push", "-q", "origin", "main")
        with self.assertRaises(PublishFailure) as error:
            self.push()
        self.assertEqual(error.exception.code, "REMOTE_MAIN_MOVED_RETEST_REQUIRED")

    def test_changed_local_head_requires_retest(self):
        (self.source / "README.md").write_text("NEW HEAD\n")
        git(self.source, "add", "README.md")
        git(self.source, "commit", "-q", "-m", "local changed")
        with self.assertRaises(PublishFailure) as error:
            self.push()
        self.assertEqual(error.exception.code, "SOURCE_BASELINE_CHANGED_RETEST_REQUIRED")


if __name__ == "__main__":
    unittest.main()
