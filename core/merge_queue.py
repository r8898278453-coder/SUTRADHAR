#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - MERGE-QUEUE ENGINE & REBASE COORDINATOR (v5.3)
Handles concurrent parallel branches via an Automated Rebase Engine,
sequential fast-forward merges, and dead-letter queue escalation.
"""
from __future__ import annotations

import logging
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from core.crypto_signer import CryptoSigner

logger = logging.getLogger("sutradhar.merge_queue")


@dataclass
class QueueItem:
    ticket_id: str
    branch_name: str
    worker_id: str
    token: str
    allowed_files: List[str]
    enqueued_at: float
    retry_count: int = 0


@dataclass
class MergeResult:
    success: bool
    ticket_id: str
    rebased_commit: Optional[str] = None
    error_message: Optional[str] = None
    sent_to_dlq: bool = False


class MergeQueueEngine:
    def __init__(
        self,
        repo_root: str,
        master_pubkey_path: str,
        sandbox_script_path: str = "sandbox/run_sandbox.sh",
    ):
        self.repo_root = Path(repo_root).resolve()
        self.master_pubkey_path = Path(master_pubkey_path).resolve()
        self.sandbox_script = Path(sandbox_script_path).resolve()
        self.queue: List[QueueItem] = []

    def enqueue_ticket(
        self,
        ticket_id: str,
        branch_name: str,
        worker_id: str,
        token: str,
        allowed_files: List[str],
    ) -> None:
        item = QueueItem(
            ticket_id=ticket_id,
            branch_name=branch_name,
            worker_id=worker_id,
            token=token,
            allowed_files=allowed_files,
            enqueued_at=time.time(),
        )
        self.queue.append(item)
        logger.info(f"[MERGE-QUEUE] Enqueued {ticket_id} from worker {worker_id}")

    def process_next(self, expected_epoch: int) -> Optional[MergeResult]:
        if not self.queue:
            return None

        item = self.queue.pop(0)
        logger.info(f"[MERGE-QUEUE] Processing {item.ticket_id} on branch {item.branch_name}")

        # 1. Verify Cryptographic Token Pre-check
        valid, reason, payload = CryptoSigner.verify_token_header(
            token_str=item.token,
            expected_ticket_id=item.ticket_id,
            public_key_path=str(self.master_pubkey_path),
            expected_epoch_id=expected_epoch,
        )
        if not valid:
            logger.error(f"[MERGE-QUEUE] Token check failed for {item.ticket_id}: {reason}")
            return MergeResult(
                success=False,
                ticket_id=item.ticket_id,
                error_message=f"Gatekeeper Token Rejection: {reason}",
                sent_to_dlq=True,
            )

        # 2. Automated Rebase on latest origin/main
        try:
            subprocess.run(["git", "fetch", "origin", "main"], cwd=self.repo_root, check=True, capture_output=True)
            
            # Checkout ticket branch
            subprocess.run(["git", "checkout", item.branch_name], cwd=self.repo_root, check=True, capture_output=True)
            
            # Rebase onto main
            rebase_proc = subprocess.run(
                ["git", "rebase", "origin/main"],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
            )

            if rebase_proc.returncode != 0:
                logger.warning(f"[MERGE-QUEUE] Rebase conflict for {item.ticket_id}. Aborting rebase...")
                subprocess.run(["git", "rebase", "--abort"], cwd=self.repo_root, capture_output=True)
                return MergeResult(
                    success=False,
                    ticket_id=item.ticket_id,
                    error_message=f"Rebase Conflict against latest main: {rebase_proc.stderr}",
                    sent_to_dlq=True,
                )

            # 3. Post-Rebase Hermetic Sandbox Verification
            logger.info(f"[MERGE-QUEUE] Re-verifying {item.ticket_id} inside Sandbox after Rebase...")
            sb_proc = subprocess.run(
                ["bash", str(self.sandbox_script), str(self.repo_root)],
                capture_output=True,
                text=True,
            )

            if sb_proc.returncode != 0:
                logger.warning(f"[MERGE-QUEUE] Post-rebase sandbox test failed: {sb_proc.stderr}")
                return MergeResult(
                    success=False,
                    ticket_id=item.ticket_id,
                    error_message=f"Post-rebase test failure: {sb_proc.stderr or sb_proc.stdout}",
                    sent_to_dlq=True,
                )

            # 4. Fast-Forward Merge into main
            subprocess.run(["git", "checkout", "main"], cwd=self.repo_root, check=True, capture_output=True)
            subprocess.run(["git", "merge", "--ff-only", item.branch_name], cwd=self.repo_root, check=True, capture_output=True)
            subprocess.run(["git", "push", "origin", "main"], cwd=self.repo_root, check=True, capture_output=True)

            rev_proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.repo_root, capture_output=True, text=True, check=True)
            rebased_sha = rev_proc.stdout.strip()

            logger.info(f"[MERGE-QUEUE] Fast-forward merge complete for {item.ticket_id} (SHA: {rebased_sha[:8]})")
            return MergeResult(
                success=True,
                ticket_id=item.ticket_id,
                rebased_commit=rebased_sha,
            )

        except Exception as ex:
            logger.error(f"[MERGE-QUEUE] Exception during merge queue processing: {ex}")
            try:
                subprocess.run(["git", "rebase", "--abort"], cwd=self.repo_root, capture_output=True)
                subprocess.run(["git", "checkout", "main"], cwd=self.repo_root, capture_output=True)
            except Exception:
                pass
            return MergeResult(
                success=False,
                ticket_id=item.ticket_id,
                error_message=str(ex),
                sent_to_dlq=True,
            )
