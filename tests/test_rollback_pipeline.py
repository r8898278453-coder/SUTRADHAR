"""Real disposable Git-remote rollback tests; real Docker only in dedicated CI stage."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from sandbox.prepare_rollback import prepare_rollback, PublishFailure

MARKER = b"__SUTRADHAR_CONTAINER_TEST_STARTED__\n"


def git(path: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(path), *args], text=True, stderr=subprocess.PIPE
    ).strip()


class RollbackBranchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="sutradhar-rollback-real-git-")
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.remote = self.root / "remote.git"
        self.source.mkdir()
        self.remote.mkdir()
        git(self.remote, "init", "--bare", "-q")
        git(self.source, "init", "-q", "-b", "main")
        git(self.source, "config", "user.name", "Fixture")
        git(self.source, "config", "user.email", "fixture@invalid.local")
        git(self.source, "remote", "add", "origin", str(self.remote))
        (self.source / "value.txt").write_text("SAFE\n")
        (self.source / "README.md").write_text("UNCHANGED\n")
        git(self.source, "add", "-A")
        git(self.source, "commit", "-q", "-m", "baseline")
        self.baseline = git(self.source, "rev-parse", "HEAD")
        self.baseline_tree = git(self.source, "rev-parse", "HEAD^{tree}")
        (self.source / "value.txt").write_text("REGRESSION\n")
        git(self.source, "add", "value.txt")
        git(self.source, "commit", "-q", "-m", "merged bad change")
        self.merged = git(self.source, "rev-parse", "HEAD")
        self.merged_tree = git(self.source, "rev-parse", "HEAD^{tree}")
        git(self.source, "push", "-q", "origin", "main")
        self.branch = "rollback/TKT-ROLL-001"

    def tearDown(self):
        self.tmp.cleanup()

    def run_rollback(self, **kwargs):
        args = dict(
            repo_root=str(self.source), github_repository="acme/widgets",
            ticket_id="TKT-ROLL-001", merged_commit=self.merged,
            baseline_commit=self.baseline, tested_tree=self.merged_tree,
            changed_files=["value.txt"], allowed_files=["value.txt"],
            test_command="python3 -c 'print(1)'", allow_local_remote=True,
            test_runner=lambda workspace, command: (0, MARKER)
        )
        args.update(kwargs)
        return prepare_rollback(**args)

    def test_branch_is_actual_first_parent_revert_and_main_unchanged(self):
        result = self.run_rollback()
        self.assertEqual(result["status"], "ROLLBACK_BRANCH_PUSHED_NOT_MERGED")
        self.assertEqual(result["treeSha"], self.baseline_tree)
        self.assertEqual(result["headSha"], git(self.remote, "rev-parse", f"refs/heads/{self.branch}"))
        self.assertEqual(git(self.remote, "rev-parse", f"{result['headSha']}^"), self.merged)
        self.assertEqual(git(self.remote, "rev-parse", f"{result['headSha']}^{{tree}}"), self.baseline_tree)
        self.assertEqual(git(self.remote, "rev-parse", "refs/heads/main"), self.merged)

    def test_failed_docker_never_pushes_a_rollback_branch(self):
        for runner in [lambda workspace, command: (1, MARKER),
                       lambda workspace, command: (0, b"NO_REAL_DOCKER_MARKER")]:
            with self.subTest(runner=runner):
                with self.assertRaises(PublishFailure) as err:
                    self.run_rollback(test_runner=runner)
                self.assertEqual(err.exception.code, "ROLLBACK_DOCKER_TEST_NOT_PASSED")
                self.assertNotIn(self.branch, git(self.remote, "for-each-ref", "--format=%(refname:short)"))

    def test_refuse_changed_main_and_wrong_merged_tree(self):
        with self.assertRaises(PublishFailure) as err:
            self.run_rollback(tested_tree="f" * 40)
        self.assertEqual(err.exception.code, "ROLLBACK_VERIFIED_MERGE_TREE_MISMATCH")
        git(self.source, "checkout", "-q", "-b", "other", self.merged)
        (self.source / "README.md").write_text("MAIN MOVED\n")
        git(self.source, "add", "README.md")
        git(self.source, "commit", "-q", "-m", "new main")
        git(self.source, "push", "-q", "origin", "HEAD:refs/heads/main")
        with self.assertRaises(PublishFailure) as err:
            self.run_rollback()
        self.assertEqual(err.exception.code, "ROLLBACK_MAIN_MOVED_MANUAL_REVIEW")

    def test_scope_mismatch_and_duplicate_branch_are_denied(self):
        with self.assertRaises(PublishFailure) as err:
            self.run_rollback(changed_files=["README.md"])
        self.assertEqual(err.exception.code, "ROLLBACK_CHANGED_FILES_MISMATCH")
        with self.assertRaises(PublishFailure) as err:
            self.run_rollback(allowed_files=["README.md"])
        self.assertEqual(err.exception.code, "ROLLBACK_OUT_OF_SCOPE")
        self.run_rollback()
        with self.assertRaises(PublishFailure) as err:
            self.run_rollback()
        self.assertEqual(err.exception.code, "ROLLBACK_BRANCH_ALREADY_EXISTS")

    def test_dirty_checkout_is_never_used_as_the_revert_tree(self):
        (self.source / "README.md").write_text("UNTRACKED DIRTY\n")
        (self.source / "untracked.txt").write_text("UNTRACKED\n")
        result = self.run_rollback()
        self.assertEqual(result["treeSha"], self.baseline_tree)
        self.assertEqual(git(self.remote, "show", result["headSha"] + ":README.md"), "UNCHANGED")

    @unittest.skipUnless(os.getenv("SUTRADHAR_REAL_DOCKER_E2E") == "1",
                         "Real Docker stage must opt in")
    def test_real_docker_must_pass_before_remote_branch_push(self):
        result = self.run_rollback(test_runner=None,
            test_command="python3 -c 'print(123)'")
        self.assertEqual(result["dockerExitCode"], 0)
        self.assertEqual(git(self.remote, "rev-parse", "refs/heads/main"), self.merged)


if __name__ == "__main__":
    unittest.main()
