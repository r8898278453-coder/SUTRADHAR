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

        # Production protection: the legacy local queue is not authorized to
        # merge/push main. Merge must happen through a reviewed GitHub PR with
        # required CI and exact tested-tree attestation, verified independently
        # by /api/cluster/ticket/verify-push after GitHub reports it merged.
        logger.warning(
            "[MERGE-QUEUE] Denied unsafe direct-main merge for %s. "
            "Create a reviewed PR; no git mutation performed.",
            item.ticket_id,
        )
        return MergeResult(
            success=False,
            ticket_id=item.ticket_id,
            error_message="GITHUB_REVIEWED_PR_REQUIRED: Direct local main merges are disabled",
            sent_to_dlq=False,
        )
