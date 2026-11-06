#!/usr/bin/env python3
"""Fail-closed Git-snapshot -> scoped patch -> disposable Docker test runner.

CLI arguments are supplied only by the trusted SUTRADHAR backend. Never execute
model-generated patches or test code on the host. The only host subprocesses are
git, archive extraction and the hardened Docker wrapper.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

MAX_PATCH_BYTES = 2 * 1024 * 1024
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024
MAX_FILES = 8000
OUTPUT_LIMIT = 48 * 1024
RUNNER_ROOT = Path(__file__).resolve().parent.parent


class RunnerFailure(Exception):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status


def scoped_path(raw: str) -> str:
    if not raw or "\x00" in raw or "\\" in raw:
        raise RunnerFailure("PATCH_REJECTED", "Invalid scoped file path")
    path = PurePosixPath(raw)
    if path.is_absolute() or ".." in path.parts or str(path) != raw or raw.startswith("-"):
        raise RunnerFailure("PATCH_REJECTED", "Unsafe path or traversal")
    forbidden = {".git", ".sutradhar_state", "secrets", "__pycache__", "node_modules"}
    if forbidden.intersection(path.parts) or path.name == ".env" or path.name.startswith(".env.") or path.suffix in {".pem", ".key", ".p12", ".pfx"}:
        raise RunnerFailure("PATCH_REJECTED", "Protected file path")
    return str(path)


def run_git(repo: Path, *args: str, timeout: int = 20) -> str:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_TEMPLATE_DIR"] = os.devnull
    proc = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True,
        timeout=timeout, env=env, check=False
    )
    if proc.returncode:
        raise RunnerFailure("PREPARE_FAILED", f"Git {args[0]} failed (exit {proc.returncode}): {proc.stderr.decode('utf-8', 'replace')[-600:]}")
    return proc.stdout.decode("utf-8", "replace").strip()


def extract_safe_snapshot(archive: Path, destination: Path) -> None:
    count = 0
    total = 0
    with tarfile.open(archive, "r:") as source:
        for member in source:
            if member.name in {".", "./"}:
                continue
            name = member.name.removeprefix("./").rstrip("/")
            # Never copy runtime credentials into a runnable code snapshot.
            parts = PurePosixPath(name).parts
            if ({".sutradhar_state", "secrets", "node_modules", "__pycache__"} & set(parts)
                    or PurePosixPath(name).name == ".env"
                    or PurePosixPath(name).name.startswith(".env.")
                    or PurePosixPath(name).suffix in {".pem", ".key", ".p12", ".pfx"}):
                continue
            safe = scoped_path(name)
            count += 1
            total += member.size
            if count > MAX_FILES or total > MAX_ARCHIVE_BYTES:
                raise RunnerFailure("PREPARE_FAILED", "Snapshot size or file count limit exceeded")
            target = destination / safe
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                handle = source.extractfile(member)
                if handle is None:
                    raise RunnerFailure("PREPARE_FAILED", "Unreadable archive member")
                with handle, target.open("wb") as output:
                    shutil.copyfileobj(handle, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
            else:
                # Reject symlinks, hard links, devices and other unsafe archive members.
                raise RunnerFailure("PREPARE_FAILED", "Symlink/hardlink/device in source snapshot; sandbox refused")


def run(args: argparse.Namespace) -> dict:
    started = time.monotonic()
    result = {
        "status": "PREPARE_FAILED", "patchValid": False,
        "exitCode": None, "stdout": "", "stderr": "",
        "changedFiles": [], "baselineCommit": None,
        "patchSha256": None, "durationMs": 0
    }
    try:
        repo = Path(args.repo_root).expanduser().resolve(strict=True)
        if not repo.is_dir() or not (repo / ".git").exists():
            raise RunnerFailure("PREPARE_FAILED", "Configured source is not a Git checkout")
        if run_git(repo, "rev-parse", "--show-toplevel") != str(repo):
            raise RunnerFailure("PREPARE_FAILED", "Repo root mismatch")
        baseline = run_git(repo, "rev-parse", "--verify", "HEAD")
        result["baselineCommit"] = baseline

        patch_path = Path(args.patch_file).resolve(strict=True)
        if patch_path.stat().st_size == 0 or patch_path.stat().st_size > MAX_PATCH_BYTES:
            raise RunnerFailure("PATCH_REJECTED", "Patch is empty or exceeds 2 MiB")
        patch = patch_path.read_bytes()
        result["patchSha256"] = hashlib.sha256(patch).hexdigest()
        allowed = {scoped_path(x) for x in args.allowed_file}
        if not allowed:
            raise RunnerFailure("PATCH_REJECTED", "Ticket has no allowed files")
        if not args.test_command.strip():
            raise RunnerFailure("SANDBOX_NOT_CONFIGURED", "Trusted test command is not configured")

        with tempfile.TemporaryDirectory(prefix="sutradhar-ticket-") as tmp:
            tmpdir = Path(tmp)
            archive = tmpdir / "baseline.tar"
            workspace = tmpdir / "candidate"
            workspace.mkdir(mode=0o700)
            run_git(repo, "archive", "--format=tar", "-o", str(archive), baseline, timeout=60)
            extract_safe_snapshot(archive, workspace)

            # Initialize a throwaway Git index solely to check the *actual* patched paths.
            run_git(workspace, "init", "-q")
            run_git(workspace, "config", "user.name", "SUTRADHAR Test Runner")
            run_git(workspace, "config", "user.email", "runner@local.invalid")
            run_git(workspace, "add", "-A")
            run_git(workspace, "commit", "-q", "-m", "Sandbox baseline", timeout=60)

            candidate_patch = tmpdir / "candidate.patch"
            candidate_patch.write_bytes(patch)
            for mode in ("--check",):
                try:
                    run_git(workspace, "apply", mode, str(candidate_patch))
                except RunnerFailure as exc:
                    raise RunnerFailure("PATCH_REJECTED", str(exc)) from exc
            try:
                run_git(workspace, "apply", str(candidate_patch))
            except RunnerFailure as exc:
                raise RunnerFailure("PATCH_REJECTED", str(exc)) from exc

            run_git(workspace, "add", "-A")
            changed_raw = subprocess.run(
                ["git", "-C", str(workspace), "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"],
                capture_output=True, check=True, timeout=20
            ).stdout
            changed = {s.decode("utf-8", "strict") for s in changed_raw.split(b"\x00") if s}
            for file_path in changed:
                scoped_path(file_path)
            if not changed or not changed.issubset(allowed):
                raise RunnerFailure("PATCH_REJECTED", "Patch changes files outside ticket whitelist or changes no files")
            summary = run_git(workspace, "diff", "--cached", "--summary", "HEAD")
            if "mode change" in summary or "rename " in summary or "symlink" in summary:
                raise RunnerFailure("PATCH_REJECTED", "Mode changes or renames are not permitted")
            stage = subprocess.run(
                ["git", "-C", str(workspace), "ls-files", "-s", "-z"],
                capture_output=True, check=True, timeout=20
            ).stdout
            for line in stage.split(b"\x00"):
                if not line or b"\t" not in line:
                    continue
                meta, raw_name = line.split(b"\t", 1)
                name = raw_name.decode("utf-8", "strict")
                if name in changed and meta.split(b" ", 1)[0] not in {b"100644", b"100755"}:
                    raise RunnerFailure("PATCH_REJECTED", "Unsafe staged file type")
            result["patchValid"] = True
            result["changedFiles"] = sorted(changed)

            if not shutil.which("docker"):
                raise RunnerFailure("SANDBOX_UNAVAILABLE", "Docker executable not found")
            with (tmpdir / "docker.stdout").open("wb") as stdout_file, (tmpdir / "docker.stderr").open("wb") as stderr_file:
                try:
                    proc = subprocess.run(
                        ["bash", str(RUNNER_ROOT / "sandbox" / "run_sandbox.sh"),
                         str(workspace), args.test_command],
                        cwd=RUNNER_ROOT, stdout=stdout_file, stderr=stderr_file,
                        timeout=180, check=False
                    )
                    exit_code = proc.returncode
                except subprocess.TimeoutExpired:
                    exit_code = 124
            stdout = (tmpdir / "docker.stdout").read_bytes()
            stderr = (tmpdir / "docker.stderr").read_bytes()
            result["stdout"] = stdout[-OUTPUT_LIMIT:].decode("utf-8", "replace")
            result["stderr"] = stderr[-OUTPUT_LIMIT:].decode("utf-8", "replace")
            result["exitCode"] = exit_code

            if exit_code == 124:
                raise RunnerFailure("TEST_FAILED", "Sandbox timed out")
            if b"__SUTRADHAR_CONTAINER_TEST_STARTED__" not in stdout[:4096]:
                raise RunnerFailure("SANDBOX_UNAVAILABLE" if exit_code == 126 else "RUNNER_ERROR",
                                    "Docker container did not reach the trusted test-start marker")
            result["status"] = "TEST_PASSED" if exit_code == 0 else "TEST_FAILED"
    except RunnerFailure as exc:
        result["status"] = exc.status
        result["stderr"] = (result["stderr"] + "\n" + str(exc))[-OUTPUT_LIMIT:].strip()
    except (OSError, subprocess.SubprocessError, UnicodeError, tarfile.TarError, ValueError) as exc:
        result["status"] = "RUNNER_ERROR"
        result["stderr"] = f"Runner preparation failed: {type(exc).__name__}"
    finally:
        result["durationMs"] = int((time.monotonic() - started) * 1000)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--patch-file", required=True)
    parser.add_argument("--test-command", required=True)
    parser.add_argument("--allowed-file", action="append", default=[])
    args = parser.parse_args()
    print(json.dumps(run(args), sort_keys=True))
