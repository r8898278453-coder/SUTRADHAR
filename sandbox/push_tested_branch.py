#!/usr/bin/env python3
"""Create + push only the exact Git tree previously validated by real Docker.

No checkout of generated code, no generated-code execution on host, no push to
main, no force, no ref deletion, no remote URL supplied by the API caller.
The staged candidate is assembled via a private bare Git object database/index.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Optional
from urllib.parse import urlparse

from sandbox.execute_ticket import scoped_path, RunnerFailure, MAX_PATCH_BYTES

SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
BRANCH = re.compile(r"^(?:ai/[A-Za-z0-9_.-]+|worker-[A-Za-z0-9-]+/ticket-[A-Za-z0-9_.-]+)$")
PROHIBITED_BRANCHES = {"main", "master", "develop", "release", "HEAD"}
GIT_TIMEOUT = 45


class PublishFailure(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _git(cwd: Path, env: dict[str, str], *argv: str, timeout: int = GIT_TIMEOUT) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(cwd), *argv],
            env=env, timeout=timeout, check=False, capture_output=True
        )
    except (OSError, subprocess.TimeoutExpired):
        raise PublishFailure("GIT_OPERATION_UNAVAILABLE")
    if result.returncode:
        # Do not expose stdout/stderr: Git may include remote authentication material.
        raise PublishFailure("GIT_OPERATION_FAILED")
    return result.stdout.strip()


def _git_environment() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ALLOW_PROTOCOL"] = "file:https:ssh"
    return env


def _canonical_origin(raw: str, repo: str, allow_local_remote: bool) -> str:
    raw = raw.strip()
    if allow_local_remote and raw.startswith("/") and Path(raw).is_dir():
        return raw
    if not REPOSITORY.fullmatch(repo):
        raise PublishFailure("GITHUB_REPOSITORY_INVALID")
    expected = repo.removesuffix(".git")
    if raw in {f"https://github.com/{expected}", f"https://github.com/{expected}.git",
               f"git@github.com:{expected}", f"git@github.com:{expected}.git"}:
        return raw
    raise PublishFailure("GIT_ORIGIN_REPOSITORY_MISMATCH")


def _remote_ref(cwd: Path, env: dict[str, str], origin: str, ref: str) -> Optional[str]:
    result = _git(cwd, env, "ls-remote", "--refs", origin, ref)
    if not result:
        return None
    rows = result.decode("utf-8", "strict").splitlines()
    if len(rows) != 1:
        raise PublishFailure("GIT_REMOTE_REF_AMBIGUOUS")
    value = rows[0].split("\t", 1)
    if len(value) != 2 or value[1] != ref or not SHA1.fullmatch(value[0]):
        raise PublishFailure("GIT_REMOTE_REF_AMBIGUOUS")
    return value[0]


def _askpass_script(folder: Path, env: dict[str, str], token: Optional[str]) -> None:
    if not token:
        return
    script = folder / "askpass.py"
    script.write_text(
        "#!/usr/bin/env python3\n"
        "import os, sys\n"
        "question = sys.argv[1].lower() if len(sys.argv) > 1 else ''\n"
        "sys.stdout.write('x-access-token' if 'username' in question "
        "else os.environ.get('SUTRADHAR_GITHUB_PUSH_TOKEN', ''))\n",
        encoding="utf-8"
    )
    script.chmod(0o700)
    env["GIT_ASKPASS"] = str(script)
    env["SUTRADHAR_GITHUB_PUSH_TOKEN"] = token


def push_tested_patch(
    *, repo_root: str, github_repository: str, ticket_id: str, branch: str,
    baseline_commit: str, candidate_tree_sha: str, patch_sha256: str,
    patch: bytes, changed_files: list[str], allowed_files: list[str],
    push_token: Optional[str] = None, allow_local_remote: bool = False
) -> dict[str, object]:
    """Publish a single new child commit. Raises on any uncertain outcome."""
    if not SHA1.fullmatch(baseline_commit) or not SHA1.fullmatch(candidate_tree_sha):
        raise PublishFailure("INVALID_TESTED_GIT_ATTESTATION")
    if not SHA256.fullmatch(patch_sha256) or hashlib.sha256(patch).hexdigest() != patch_sha256:
        raise PublishFailure("PATCH_CHANGED_SINCE_DOCKER_TEST")
    if len(patch) < 1 or len(patch) > MAX_PATCH_BYTES:
        raise PublishFailure("PATCH_SIZE_INVALID")
    if not BRANCH.fullmatch(branch) or branch in PROHIBITED_BRANCHES or not ticket_id:
        raise PublishFailure("UNSAFE_WORKER_BRANCH")
    allowed = {scoped_path(s) for s in allowed_files}
    changed = {scoped_path(s) for s in changed_files}
    if not allowed or not changed or len(changed) != len(changed_files) or len(changed) > 100:
        raise PublishFailure("INVALID_CHANGED_FILE_LIST")
    if not changed.issubset(allowed):
        raise PublishFailure("OUT_OF_SCOPE_FILES")

    try:
        source = Path(repo_root).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        raise PublishFailure("SOURCE_REPOSITORY_MISSING")
    if not source.is_dir() or not (source / ".git").exists():
        raise PublishFailure("SOURCE_REPOSITORY_MISSING")
    env = _git_environment()
    root = _git(source, env, "rev-parse", "--show-toplevel").decode()
    if Path(root).resolve() != source:
        raise PublishFailure("SOURCE_REPOSITORY_MISMATCH")
    if _git(source, env, "rev-parse", "HEAD").decode() != baseline_commit:
        raise PublishFailure("SOURCE_BASELINE_CHANGED_RETEST_REQUIRED")
    origin_raw = _git(source, env, "config", "--local", "--get", "remote.origin.url").decode()
    origin = _canonical_origin(origin_raw, github_repository, allow_local_remote)
    if not allow_local_remote and not push_token and origin.startswith("https://"):
        raise PublishFailure("PUSH_TOKEN_NOT_CONFIGURED")

    with tempfile.TemporaryDirectory(prefix="sutradhar-push-") as folder:
        work = Path(folder)
        bare = work / "objects.git"
        bare.mkdir(mode=0o700)
        env["GIT_INDEX_FILE"] = str(work / "private.index")
        _askpass_script(work, env, push_token)
        _git(bare, env, "init", "--bare", "-q")
        _git(bare, env, "config", "user.name", "SUTRADHAR Worker")
        _git(bare, env, "config", "user.email", "worker@local.invalid")
        # Fetch a SHA from the trusted on-disk object database, not a remote ref.
        _git(bare, env, "fetch", "--no-tags", "--no-write-fetch-head",
             "--no-recurse-submodules", str(source), baseline_commit)
        _git(bare, env, "read-tree", baseline_commit)
        patch_file = work / "candidate.diff"
        patch_file.write_bytes(patch)
        patch_file.chmod(0o600)
        try:
            _git(bare, env, "apply", "--cached", "--check", str(patch_file))
            _git(bare, env, "apply", "--cached", str(patch_file))
        except PublishFailure:
            raise PublishFailure("PATCH_NOT_APPLICABLE_TO_TESTED_BASELINE")
        raw_changed = _git(bare, env, "diff", "--cached", "--name-only",
                           "--no-renames", "-z", baseline_commit)
        actual = {s.decode("utf-8", "strict") for s in raw_changed.split(b"\x00") if s}
        if actual != changed:
            raise PublishFailure("PATCH_CHANGED_FILE_SET_MISMATCH")
        for file_name in actual:
            try:
                scoped_path(file_name)
            except RunnerFailure:
                raise PublishFailure("PATCH_CONTAINS_PROTECTED_PATH")
        raw_status = _git(bare, env, "diff", "--cached", "--name-status",
                          "--no-renames", "-z", baseline_commit)
        statuses = [s.decode("utf-8", "strict") for s in raw_status.split(b"\x00") if s]
        if len(statuses) != 2 * len(actual):
            raise PublishFailure("PATCH_GIT_STATUS_INVALID")
        if any(status not in {"A", "D", "M"} for status in statuses[::2]):
            raise PublishFailure("PATCH_GIT_STATUS_UNSAFE")
        summary = _git(bare, env, "diff", "--cached", "--summary", baseline_commit)
        if b"mode change" in summary or b"rename " in summary or b"symlink" in summary:
            raise PublishFailure("PATCH_GIT_MODE_UNSAFE")
        staged = _git(bare, env, "ls-files", "--stage", "-z")
        for record in staged.split(b"\x00"):
            if not record or b"\t" not in record:
                continue
            info, raw_file = record.split(b"\t", 1)
            if raw_file.decode("utf-8", "strict") in actual and info.split(b" ")[0] not in {b"100644", b"100755"}:
                raise PublishFailure("PATCH_GIT_OBJECT_TYPE_UNSAFE")
        actual_tree = _git(bare, env, "write-tree").decode()
        if actual_tree != candidate_tree_sha:
            raise PublishFailure("TESTED_GIT_TREE_MISMATCH")

        # Both target main and the new work branch must be checked remotely.
        if _remote_ref(bare, env, origin, "refs/heads/main") != baseline_commit:
            raise PublishFailure("REMOTE_MAIN_MOVED_RETEST_REQUIRED")
        branch_ref = "refs/heads/" + branch
        previous = _remote_ref(bare, env, origin, branch_ref)
        if previous:
            raise PublishFailure("WORKER_BRANCH_ALREADY_EXISTS")

        new_sha = _git(bare, env, "commit-tree", actual_tree, "-p",
                       baseline_commit, "-m", f"[{ticket_id}] Docker-tested patch").decode()
        if not SHA1.fullmatch(new_sha):
            raise PublishFailure("COMMIT_CREATION_FAILED")
        # No '+' refspec, --force, remote delete, or push to main.
        # The target branch must not exist; after the push we verify exact SHA.
        try:
            _git(bare, env, "push", "--porcelain", "--no-verify",
                 origin, f"{new_sha}:{branch_ref}", timeout=60)
        except PublishFailure:
            raise PublishFailure("WORKER_BRANCH_PUSH_FAILED")
        if _remote_ref(bare, env, origin, branch_ref) != new_sha:
            raise PublishFailure("WORKER_BRANCH_PUSH_UNVERIFIED")
        return {
            "status": "PUSH_CONFIRMED_NOT_MERGED",
            "headSha": new_sha, "treeSha": actual_tree,
            "baselineCommit": baseline_commit, "patchSha256": patch_sha256,
            "branch": branch, "changedFiles": sorted(actual)
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--github-repository", required=True)
    parser.add_argument("--ticket-id", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--baseline-commit", required=True)
    parser.add_argument("--candidate-tree-sha", required=True)
    parser.add_argument("--patch-sha256", required=True)
    parser.add_argument("--patch-file", required=True)
    parser.add_argument("--allowed-file", action="append", default=[])
    parser.add_argument("--changed-file", action="append", default=[])
    args = parser.parse_args()
    try:
        result = push_tested_patch(
            repo_root=args.repo_root, github_repository=args.github_repository,
            ticket_id=args.ticket_id, branch=args.branch,
            baseline_commit=args.baseline_commit,
            candidate_tree_sha=args.candidate_tree_sha,
            patch_sha256=args.patch_sha256,
            patch=Path(args.patch_file).read_bytes(),
            allowed_files=args.allowed_file,
            changed_files=args.changed_file,
            push_token=os.environ.get("SUTRADHAR_GITHUB_PUSH_TOKEN")
        )
        print(json.dumps({"success": True, **result}, sort_keys=True))
    except (PublishFailure, RunnerFailure) as error:
        code = error.code if isinstance(error, PublishFailure) else "PATCH_SCOPE_INVALID"
        print(json.dumps({"success": False, "error": code}))
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        print(json.dumps({"success": False, "error": "WORKER_PUSH_UNAVAILABLE"}))


if __name__ == "__main__":
    main()
