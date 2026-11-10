#!/usr/bin/env python3
"""Prepare and push a *review-only* inverse of a previously verified main merge.

No host checkout or execution of target code. The exact first-parent Git tree
is re-created in a private bare Git index and tested in an isolated Docker
runner BEFORE a single non-force push to a new rollback branch.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from typing import Optional

from sandbox.execute_ticket import extract_safe_snapshot, RUNNER_ROOT, OUTPUT_LIMIT
from sandbox.push_tested_branch import (
    _git, _git_environment, _canonical_origin, _remote_ref,
    _askpass_script, SHA1, PublishFailure,
)
from sandbox.execute_ticket import scoped_path, RunnerFailure

TICKET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,85}$")


def prepare_rollback(
    *, repo_root: str, github_repository: str, ticket_id: str,
    merged_commit: str, baseline_commit: str, tested_tree: str,
    allowed_files: list[str], changed_files: list[str],
    test_command: str, push_token: Optional[str] = None,
    allow_local_remote: bool = False,
    test_runner=None
) -> dict[str, object]:
    """Push a new rollback branch only if real Docker tests pass.

    Injected test_runner is for local Git unit tests only. The CLI and HTTP
    endpoint never accept a replacement runner or a caller-provided command.
    """
    if not TICKET.fullmatch(ticket_id) or not all(SHA1.fullmatch(s) for s in
        (merged_commit, baseline_commit, tested_tree)):
        raise PublishFailure("ROLLBACK_ATTESTATION_INVALID")
    if not test_command or len(test_command) > 300:
        raise PublishFailure("ROLLBACK_DOCKER_COMMAND_NOT_CONFIGURED")
    try:
        allowed = {scoped_path(p) for p in allowed_files}
        changed = {scoped_path(p) for p in changed_files}
    except RunnerFailure:
        raise PublishFailure("ROLLBACK_PROTECTED_PATH")
    if not allowed or not changed or len(changed) != len(changed_files) or len(changed) >= 100:
        raise PublishFailure("ROLLBACK_SCOPE_INVALID")
    if not changed.issubset(allowed):
        raise PublishFailure("ROLLBACK_OUT_OF_SCOPE")
    try:
        source = Path(repo_root).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        raise PublishFailure("SOURCE_REPOSITORY_MISSING")
    if not source.is_dir() or not (source / ".git").exists():
        raise PublishFailure("SOURCE_REPOSITORY_MISSING")
    env = _git_environment()
    if Path(_git(source, env, "rev-parse", "--show-toplevel").decode()).resolve() != source:
        raise PublishFailure("SOURCE_REPOSITORY_MISMATCH")
    origin_url = _git(source, env, "config", "--local", "--get", "remote.origin.url").decode()
    origin = _canonical_origin(origin_url, github_repository, allow_local_remote)
    if not allow_local_remote and origin.startswith("https://") and not push_token:
        raise PublishFailure("ROLLBACK_PUSH_TOKEN_NOT_CONFIGURED")

    branch = "rollback/" + ticket_id
    with tempfile.TemporaryDirectory(prefix="sutradhar-rollback-") as folder:
        root = Path(folder)
        bare = root / "rollback.git"
        bare.mkdir(mode=0o700)
        _git(bare, env, "init", "--bare", "-q")
        _git(bare, env, "config", "user.name", "SUTRADHAR Rollback")
        _git(bare, env, "config", "user.email", "rollback@local.invalid")
        env["GIT_INDEX_FILE"] = str(root / "rollback.index")
        _askpass_script(root, env, push_token)

        # Only the *latest* verified main commit is eligible. A later change
        # must never be erased or shadowed by an automatic rollback branch.
        if _remote_ref(bare, env, origin, "refs/heads/main") != merged_commit:
            raise PublishFailure("ROLLBACK_MAIN_MOVED_MANUAL_REVIEW")
        remote_branch = "refs/heads/" + branch
        if _remote_ref(bare, env, origin, remote_branch):
            raise PublishFailure("ROLLBACK_BRANCH_ALREADY_EXISTS")
        _git(bare, env, "fetch", "--no-tags", "--no-write-fetch-head",
             "--no-recurse-submodules", origin, "refs/heads/main", timeout=60)
        parents = _git(bare, env, "rev-list", "--parents", "-n", "1", merged_commit).decode().split()
        # Supports squash and 2-parent GitHub merge commits; octopus merges
        # need manual review and no code is modified.
        if len(parents) not in (2, 3) or parents[0] != merged_commit or parents[1] != baseline_commit:
            raise PublishFailure("ROLLBACK_MERGED_PARENT_MISMATCH")
        if _git(bare, env, "rev-parse", merged_commit + "^{tree}").decode() != tested_tree:
            raise PublishFailure("ROLLBACK_VERIFIED_MERGE_TREE_MISMATCH")
        reverted_tree = _git(bare, env, "rev-parse", baseline_commit + "^{tree}").decode()
        raw = _git(bare, env, "diff", "--no-renames", "--name-status", "-z",
                   baseline_commit, merged_commit)
        pieces = [v.decode("utf-8", "strict") for v in raw.split(b"\x00") if v]
        if len(pieces) != 2 * len(changed):
            raise PublishFailure("ROLLBACK_CHANGED_FILES_MISMATCH")
        statuses = pieces[::2]
        actual = set(pieces[1::2])
        if actual != changed or any(status not in {"A", "D", "M"} for status in statuses):
            raise PublishFailure("ROLLBACK_CHANGED_FILES_MISMATCH")
        for name in actual:
            try:
                scoped_path(name)
            except RunnerFailure:
                raise PublishFailure("ROLLBACK_PROTECTED_PATH")
        summary = _git(bare, env, "diff", "--no-renames", "--summary",
                       baseline_commit, merged_commit)
        if b"mode change" in summary or b"rename " in summary or b"symlink" in summary:
            raise PublishFailure("ROLLBACK_GIT_MODE_UNSAFE")
        _git(bare, env, "read-tree", baseline_commit)
        if _git(bare, env, "write-tree").decode() != reverted_tree:
            raise PublishFailure("ROLLBACK_TREE_REBUILD_FAILED")

        # Test the exact previously committed baseline tree in an isolated
        # Docker workspace before publishing any Git branch.
        archive = root / "rollback.tar"
        _git(bare, env, "archive", "--format=tar", "-o", str(archive), baseline_commit, timeout=60)
        workspace = root / "candidate"
        workspace.mkdir(mode=0o700)
        try:
            extract_safe_snapshot(archive, workspace)
        except (RunnerFailure, tarfile.TarError, OSError):
            raise PublishFailure("ROLLBACK_SNAPSHOT_UNSAFE")
        if test_runner is None:
            try:
                proc = subprocess.run(
                    ["bash", str(RUNNER_ROOT / "sandbox" / "run_sandbox.sh"),
                     str(workspace), test_command],
                    cwd=RUNNER_ROOT, timeout=180, capture_output=True, check=False
                )
            except (subprocess.TimeoutExpired, OSError):
                raise PublishFailure("ROLLBACK_DOCKER_UNAVAILABLE")
            code, stdout = proc.returncode, proc.stdout
        else:
            # Supplied only in direct Python tests, never through the CLI.
            code, stdout = test_runner(workspace, test_command)
        if code != 0 or b"__SUTRADHAR_CONTAINER_TEST_STARTED__" not in stdout[:4096]:
            raise PublishFailure("ROLLBACK_DOCKER_TEST_NOT_PASSED")

        # Recheck remote main after testing because Docker may take minutes.
        if _remote_ref(bare, env, origin, "refs/heads/main") != merged_commit:
            raise PublishFailure("ROLLBACK_MAIN_MOVED_MANUAL_REVIEW")
        if _remote_ref(bare, env, origin, remote_branch):
            raise PublishFailure("ROLLBACK_BRANCH_ALREADY_EXISTS")
        rollback_head = _git(bare, env, "commit-tree", reverted_tree,
                             "-p", merged_commit,
                             "-m", f"[{ticket_id}] Revert verified GitHub merge {merged_commit}").decode()
        if not SHA1.fullmatch(rollback_head):
            raise PublishFailure("ROLLBACK_COMMIT_FAILED")
        _git(bare, env, "push", "--porcelain", origin,
             f"{rollback_head}:{remote_branch}", timeout=60)
        if _remote_ref(bare, env, origin, remote_branch) != rollback_head:
            raise PublishFailure("ROLLBACK_REMOTE_PUSH_UNVERIFIED")
        return {
            "status": "ROLLBACK_BRANCH_PUSHED_NOT_MERGED",
            "branch": branch, "headSha": rollback_head,
            "treeSha": reverted_tree, "mergedCommit": merged_commit,
            "baselineCommit": baseline_commit,
            "testedMergeTreeSha": tested_tree, "changedFiles": sorted(actual),
            "dockerExitCode": code
        }



def inspect_rollback_for_recovery(
    *, repo_root: str, github_repository: str, ticket_id: str,
    merged_commit: str, baseline_commit: str, tested_tree: str,
    allowed_files: list[str], changed_files: list[str],
    test_command: str, push_token: Optional[str] = None,
    allow_local_remote: bool = False, test_runner=None
) -> dict[str, object]:
    """Read-only remote inspection; Docker-retest exact restored tree if present.

    This can recover a server crash after push without inferring that an
    untrusted actor's matching Git branch was ever Docker tested. It never
    pushes, deletes, force-updates, creates a PR, or claims rollback complete.
    """
    if not TICKET.fullmatch(ticket_id) or not all(
        SHA1.fullmatch(s) for s in (merged_commit, baseline_commit, tested_tree)
    ):
        raise PublishFailure("ROLLBACK_ATTESTATION_INVALID")
    if not test_command.strip() or len(test_command) > 300:
        raise PublishFailure("ROLLBACK_DOCKER_COMMAND_NOT_CONFIGURED")
    try:
        allowed = {scoped_path(p) for p in allowed_files}
        changed = {scoped_path(p) for p in changed_files}
    except RunnerFailure:
        raise PublishFailure("ROLLBACK_PROTECTED_PATH")
    if not allowed or not changed or len(changed) != len(changed_files) or len(changed) >= 100:
        raise PublishFailure("ROLLBACK_SCOPE_INVALID")
    if not changed.issubset(allowed):
        raise PublishFailure("ROLLBACK_OUT_OF_SCOPE")
    try:
        source = Path(repo_root).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        raise PublishFailure("SOURCE_REPOSITORY_MISSING")
    if not source.is_dir() or not (source / ".git").exists():
        raise PublishFailure("SOURCE_REPOSITORY_MISSING")
    env = _git_environment()
    if Path(_git(source, env, "rev-parse", "--show-toplevel").decode()).resolve() != source:
        raise PublishFailure("SOURCE_REPOSITORY_MISMATCH")
    origin_raw = _git(source, env, "config", "--local", "--get", "remote.origin.url").decode()
    origin = _canonical_origin(origin_raw, github_repository, allow_local_remote)
    if not allow_local_remote and origin.startswith("https://") and not push_token:
        raise PublishFailure("ROLLBACK_PUSH_TOKEN_NOT_CONFIGURED")

    branch = "rollback/" + ticket_id
    branch_ref = "refs/heads/" + branch
    with tempfile.TemporaryDirectory(prefix="sutradhar-rollback-inspect-") as folder:
        root = Path(folder)
        bare = root / "verify.git"
        bare.mkdir(mode=0o700)
        _git(bare, env, "init", "--bare", "-q")
        env["GIT_INDEX_FILE"] = str(root / "verify.index")
        _askpass_script(root, env, push_token)
        if _remote_ref(bare, env, origin, "refs/heads/main") != merged_commit:
            raise PublishFailure("ROLLBACK_MAIN_MOVED_MANUAL_REVIEW")
        head = _remote_ref(bare, env, origin, branch_ref)
        if head is None:
            # Absence is a snapshot only. A separate admin action is required
            # to retry, and all preflight checks must run again.
            return {
                "status": "ROLLBACK_REMOTE_BRANCH_ABSENT",
                "branch": branch, "mergedCommit": merged_commit,
                "baselineCommit": baseline_commit, "testedMergeTreeSha": tested_tree
            }
        _git(bare, env, "fetch", "--no-tags", "--no-write-fetch-head",
             "--no-recurse-submodules", origin, "refs/heads/main", timeout=60)
        _git(bare, env, "fetch", "--no-tags", "--no-write-fetch-head",
             "--no-recurse-submodules", origin, head, timeout=60)
        parents = _git(bare, env, "rev-list", "--parents", "-n", "1", merged_commit).decode().split()
        if len(parents) not in (2, 3) or parents[0] != merged_commit or parents[1] != baseline_commit:
            raise PublishFailure("ROLLBACK_MERGED_PARENT_MISMATCH")
        if _git(bare, env, "rev-parse", merged_commit + "^{tree}").decode() != tested_tree:
            raise PublishFailure("ROLLBACK_VERIFIED_MERGE_TREE_MISMATCH")
        restored = _git(bare, env, "rev-parse", baseline_commit + "^{tree}").decode()
        head_parents = _git(bare, env, "rev-list", "--parents", "-n", "1", head).decode().split()
        if head_parents != [head, merged_commit] or (
            _git(bare, env, "rev-parse", head + "^{tree}").decode() != restored
        ):
            raise PublishFailure("ROLLBACK_REMOTE_REVERT_MISMATCH")
        raw = _git(bare, env, "diff", "--no-renames", "--name-status", "-z",
                   baseline_commit, merged_commit)
        fields = [item.decode("utf-8", "strict") for item in raw.split(b"\\x00") if item]
        if len(fields) != 2 * len(changed) or set(fields[1::2]) != changed or (
            any(code not in {"A", "D", "M"} for code in fields[::2])
        ):
            raise PublishFailure("ROLLBACK_CHANGED_FILES_MISMATCH")
        summary = _git(bare, env, "diff", "--no-renames", "--summary",
                       baseline_commit, merged_commit)
        if b"mode change" in summary or b"rename " in summary or b"symlink" in summary:
            raise PublishFailure("ROLLBACK_GIT_MODE_UNSAFE")

        # Verify the exact branch tree inside real Docker again, even if a
        # local pre-crash Docker receipt was never written.
        archive = root / "reverted-tree.tar"
        _git(bare, env, "archive", "--format=tar", "-o", str(archive), head, timeout=60)
        workspace = root / "candidate"
        workspace.mkdir(mode=0o700)
        try:
            extract_safe_snapshot(archive, workspace)
        except (RunnerFailure, tarfile.TarError, OSError):
            raise PublishFailure("ROLLBACK_SNAPSHOT_UNSAFE")
        if test_runner is None:
            try:
                proc = subprocess.run(
                    ["bash", str(RUNNER_ROOT / "sandbox" / "run_sandbox.sh"),
                     str(workspace), test_command],
                    cwd=RUNNER_ROOT, timeout=180, capture_output=True, check=False
                )
            except (subprocess.TimeoutExpired, OSError):
                raise PublishFailure("ROLLBACK_DOCKER_UNAVAILABLE")
            code, stdout = proc.returncode, proc.stdout
        else:
            # Test injection is unavailable from CLI / HTTP.
            code, stdout = test_runner(workspace, test_command)
        if code != 0 or b"__SUTRADHAR_CONTAINER_TEST_STARTED__" not in stdout[:4096]:
            raise PublishFailure("ROLLBACK_DOCKER_TEST_NOT_PASSED")
        if _remote_ref(bare, env, origin, branch_ref) != head:
            raise PublishFailure("ROLLBACK_REMOTE_BRANCH_CHANGED")
        if _remote_ref(bare, env, origin, "refs/heads/main") != merged_commit:
            raise PublishFailure("ROLLBACK_MAIN_MOVED_MANUAL_REVIEW")
        return {
            "status": "ROLLBACK_REMOTE_BRANCH_CONFIRMED_NOT_MERGED",
            "branch": branch, "headSha": head, "treeSha": restored,
            "mergedCommit": merged_commit, "baselineCommit": baseline_commit,
            "testedMergeTreeSha": tested_tree,
            "changedFiles": sorted(changed), "dockerExitCode": code
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--github-repository", required=True)
    parser.add_argument("--ticket-id", required=True)
    parser.add_argument("--merged-commit", required=True)
    parser.add_argument("--baseline-commit", required=True)
    parser.add_argument("--tested-tree", required=True)
    parser.add_argument("--test-command", required=True)
    parser.add_argument("--allowed-file", action="append", default=[])
    parser.add_argument("--changed-file", action="append", default=[])
    parser.add_argument("--inspect-only", action="store_true",
                        help="Read-only remote rollback branch inspection with Docker retest")
    args = parser.parse_args()
    try:
        if args.inspect_only:
            proof = inspect_rollback_for_recovery(
                repo_root=args.repo_root, github_repository=args.github_repository,
                ticket_id=args.ticket_id, merged_commit=args.merged_commit,
                baseline_commit=args.baseline_commit, tested_tree=args.tested_tree,
                allowed_files=args.allowed_file, changed_files=args.changed_file,
                test_command=args.test_command,
                push_token=os.environ.get("SUTRADHAR_GITHUB_ROLLBACK_TOKEN")
            )
            print(json.dumps({"success": True, **proof}, sort_keys=True))
            return
        proof = prepare_rollback(
            repo_root=args.repo_root, github_repository=args.github_repository,
            ticket_id=args.ticket_id, merged_commit=args.merged_commit,
            baseline_commit=args.baseline_commit, tested_tree=args.tested_tree,
            allowed_files=args.allowed_file, changed_files=args.changed_file,
            test_command=args.test_command,
            push_token=os.environ.get("SUTRADHAR_GITHUB_ROLLBACK_TOKEN")
        )
        print(json.dumps({"success": True, **proof}, sort_keys=True))
    except (PublishFailure, RunnerFailure) as exc:
        print(json.dumps({"success": False, "error":
            exc.code if isinstance(exc, PublishFailure) else "ROLLBACK_SCOPE_INVALID"}))
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        print(json.dumps({"success": False, "error": "ROLLBACK_PREPARATION_UNAVAILABLE"}))


if __name__ == "__main__":
    main()
