#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - WORKER AI STUDIO LIFECYCLE AGENT (v5.4)
Automates the safe workflow:
1. Leader Discovery & Claim from Telegram Hub
2. Pre-Flight Git Pull & Workspace Branch Isolation (backup/TKT-xxx)
3. Strict Allowed-Files / Context Bound Synthesis via LLM Router
4. Pre-Merge Rebase (git pull --rebase)
5. Sandbox Self-Test Verification
6. Atomic Push to Backup Branch & Ready-for-Master Notification
"""
from __future__ import annotations

import logging
import os
import subprocess
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from core.llm_router import LLMRouter
from core.protocol import MessageType, NodeRole, ProtocolCodec, SenderMetadata, WireMessage

logger = logging.getLogger("sutradhar.worker")


@dataclass
class WorkerTicketContext:
    ticket_id: str
    title: str
    domain: str
    allowed_files: List[str]
    base_branch: str
    work_branch: str
    ed25519_token: str
    epoch_id: int
    ttl_seconds: int = 900


class WorkerLifecycleAgent:
    def __init__(
        self,
        worker_id: str,
        repo_path: str = ".",
        llm_router: Optional[LLMRouter] = None,
    ):
        self.worker_id = worker_id
        self.repo_path = repo_path
        self.router = llm_router or LLMRouter()
        self.current_ticket: Optional[WorkerTicketContext] = None

    def execute_git_cmd(self, args: List[str]) -> Tuple[int, str, str]:
        try:
            res = subprocess.run(
                ["git"] + args,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                check=False,
            )
            return res.returncode, res.stdout.strip(), res.stderr.strip()
        except Exception as e:
            return 1, "", str(e)

    def step_1_preflight_pull(self, base_branch: str = "main") -> bool:
        """Fetch latest origin and verify clean working tree."""
        logger.info(f"[{self.worker_id}] Pre-flight: Fetching & pulling latest {base_branch}...")
        rc, out, err = self.execute_git_cmd(["checkout", base_branch])
        if rc != 0:
            logger.error(f"Failed to checkout {base_branch}: {err}")
            return False

        rc, out, err = self.execute_git_cmd(["pull", "--ff-only", "origin", base_branch])
        if rc != 0:
            logger.error(f"Git pull failed; refusing to use stale local baseline: {err}")
            return False
        return True

    def step_2_create_backup_branch(self, work_branch: str) -> bool:
        """Create dedicated isolation branch for this ticket."""
        logger.info(f"[{self.worker_id}] Creating work branch: {work_branch}")
        rc, out, err = self.execute_git_cmd(["checkout", "-B", work_branch])
        return rc == 0

    def step_3_apply_diff_patch(self, diff_content: str, allowed_files: List[str]) -> bool:
        """Validates that modified files are strictly within allowed whitelist before applying."""
        logger.info(f"[{self.worker_id}] Verifying patch whitelist guard...")
        # Check files in diff
        for line in diff_content.splitlines():
            if line.startswith("+++ b/") or line.startswith("--- a/"):
                file_path = line.split(" ", 1)[1][2:].strip()
                if file_path != "/dev/null" and file_path not in allowed_files:
                    logger.critical(f"[{self.worker_id}] AST GUARD REJECTION: Diff touches unauthorized file: {file_path}")
                    return False

        # Apply patch via git apply
        patch_file = f"/tmp/patch_{self.worker_id}_{int(time.time())}.patch"
        with open(patch_file, "w") as f:
            f.write(diff_content)

        rc, out, err = self.execute_git_cmd(["apply", "--check", patch_file])
        if rc != 0:
            logger.error(f"Patch pre-check failed: {err}")
            return False

        rc, out, err = self.execute_git_cmd(["apply", patch_file])
        return rc == 0

    def step_4_rebase_and_push(self, base_branch: str, work_branch: str) -> Tuple[bool, str]:
        """Stage only approved ticket files, commit, rebase, and verify push success."""
        if not self.current_ticket or not self.current_ticket.allowed_files:
            return False, "MISSING_TICKET_SCOPE"

        from pathlib import PurePosixPath
        allowed_files = set()
        for name in self.current_ticket.allowed_files:
            p = PurePosixPath(name)
            if p.is_absolute() or ".." in p.parts or not name or "\\x00" in name:
                return False, f"INVALID_ALLOWED_PATH: {name}"
            allowed_files.add(str(p))

        # Never stage arbitrary pre-existing workspace modifications.
        rc, _, err = self.execute_git_cmd(["add", "--", *sorted(allowed_files)])
        if rc != 0:
            return False, f"GIT_STAGE_FAILED: {err}"

        rc, output, err = self.execute_git_cmd(["diff", "--cached", "--name-only", "--no-renames", "-z"])
        if rc != 0:
            return False, f"GIT_DIFF_FAILED: {err}"
        changed = {p for p in output.split("\\x00") if p}
        if not changed or not changed.issubset(allowed_files):
            return False, f"UNAUTHORIZED_STAGED_FILES: {sorted(changed - allowed_files)}"

        rc, _, err = self.execute_git_cmd([
            "commit", "-m",
            f"feat({self.current_ticket.ticket_id}): auto-synthesized by {self.worker_id}"
        ])
        if rc != 0:
            return False, f"GIT_COMMIT_FAILED: {err}"

        rc, _, err = self.execute_git_cmd(["fetch", "origin", base_branch])
        if rc != 0:
            return False, f"GIT_FETCH_FAILED: {err}"

        rc, _, err = self.execute_git_cmd(["rebase", f"origin/{base_branch}"])
        if rc != 0:
            self.execute_git_cmd(["rebase", "--abort"])
            return False, f"REBASE_CONFLICT: {err}"

        rc, _, err = self.execute_git_cmd(["push", "-u", "origin", work_branch])
        if rc != 0:
            return False, f"GIT_PUSH_FAILED: {err}"
        return True, "PUSH_CONFIRMED_NOT_MERGED"
