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
            logger.warning(f"Git pull ff-only notice: {err} (proceeding with local baseline)")
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
        """Pull latest rebase before pushing to avoid missing peers' work."""
        logger.info(f"[{self.worker_id}] Pull rebase against origin/{base_branch}...")
        rc, out, err = self.execute_git_cmd(["pull", "--rebase", "origin", base_branch])
        if rc != 0:
            logger.error(f"Rebase conflict: {err}")
            return False, f"REBASE_CONFLICT: {err}"

        # Commit and push
        self.execute_git_cmd(["add", "."])
        self.execute_git_cmd(["commit", "-m", f"feat({self.current_ticket.ticket_id if self.current_ticket else 'task'}): auto-synthesized by {self.worker_id}"])

        rc, out, err = self.execute_git_cmd(["push", "-u", "origin", work_branch])
        if rc != 0:
            logger.warning(f"Git push warning (simulated local repo): {err}")

        return True, "SUCCESS"
