#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - WORKER SEQUENTIAL RUNNER (v5.3)
Manages ephemeral worktree lifecycles with guaranteed crash recovery and self-healing.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, List, Optional

from core.crypto_signer import CryptoSigner
from core.llm_router import LLMRouter
from core.patch_validator import PatchValidator


class WorktreeManager:
    def __init__(self, repo_root: str, base_workspace_dir: str):
        self.repo_root = Path(repo_root).resolve()
        self.base_workspace_dir = Path(base_workspace_dir).resolve()
        self.base_workspace_dir.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def create_ephemeral_worktree(self, ticket_id: str, branch_name: str) -> Generator[Path, None, None]:
        worktree_dir = self.base_workspace_dir / ticket_id
        
        self._force_cleanup(worktree_dir, branch_name)

        try:
            cmd = [
                "git", "worktree", "add",
                "-B", branch_name,
                str(worktree_dir),
                "origin/main"
            ]
            subprocess.run(cmd, cwd=self.repo_root, check=True, capture_output=True, text=True)
            yield worktree_dir

        finally:
            self._force_cleanup(worktree_dir, branch_name)

    def _force_cleanup(self, worktree_dir: Path, branch_name: str) -> None:
        try:
            subprocess.run(
                ["git", "worktree", "remove", "--force", str(worktree_dir)],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
            )
        except Exception:
            pass

        if worktree_dir.exists():
            try:
                shutil.rmtree(worktree_dir, ignore_errors=True)
            except Exception:
                pass

        subprocess.run(["git", "worktree", "prune"], cwd=self.repo_root, capture_output=True)


class SequentialWorker:
    def __init__(
        self,
        node_id: str,
        repo_root: str,
        workspaces_dir: str,
        llm_router: LLMRouter,
        privkey_path: str,
    ):
        self.node_id = node_id
        self.wt_manager = WorktreeManager(repo_root, workspaces_dir)
        self.llm_router = llm_router
        self.privkey_path = privkey_path

    def process_ticket(
        self,
        ticket_id: str,
        spec_prompt: str,
        allowed_files: List[str],
        read_only_contracts: List[str],
        epoch_id: int,
        max_retries: int = 3,
    ) -> bool:
        branch_name = f"ai/{ticket_id}"

        with self.wt_manager.create_ephemeral_worktree(ticket_id, branch_name) as workspace:
            retry_count = 0
            debugging_history: List[dict] = []
            current_stderr: Optional[str] = None
            failing_diff: Optional[str] = None

            while retry_count < max_retries:
                synth_result = self.llm_router.synthesize_patch(
                    ticket_id=ticket_id,
                    prompt=spec_prompt,
                    allowed_files=allowed_files,
                    debugging_history=debugging_history,
                    retry_count=retry_count,
                    prior_diff=failing_diff,
                    prior_stderr=current_stderr,
                )

                if not synth_result.success:
                    retry_count += 1
                    continue

                norm_result = PatchValidator.apply_patch_with_fallback(
                    workspace_path=str(workspace),
                    raw_diff=synth_result.diff_content,
                    allowed_files=allowed_files,
                    read_only_contracts=read_only_contracts,
                )

                if not norm_result.success:
                    current_stderr = f"Patch rejected: {norm_result.error_message}"
                    failing_diff = synth_result.diff_content
                    debugging_history.append({
                        "role": "system",
                        "content": current_stderr,
                    })
                    retry_count += 1
                    continue

                test_proc = subprocess.run(
                    ["bash", "sandbox/run_sandbox.sh", str(workspace)],
                    capture_output=True,
                    text=True,
                )

                if test_proc.returncode == 0:
                    token_header = CryptoSigner.sign_lease(
                        ticket_id=ticket_id,
                        worker_id=self.node_id,
                        epoch_id=epoch_id,
                        allowed_files=allowed_files,
                        ttl_seconds=3600,
                        private_key_path=self.privkey_path,
                    )
                    
                    commit_msg = (
                        f"feat({ticket_id}): verified autonomous implementation\n\n"
                        f"Security-Token: {token_header}\n"
                        f"Signer-Node: {self.node_id}\n"
                        f"Epoch: {epoch_id}\n"
                    )

                    subprocess.run(["git", "add", "-A"], cwd=workspace, check=True)
                    subprocess.run(["git", "commit", "-m", commit_msg], cwd=workspace, check=True)
                    subprocess.run(["git", "push", "origin", branch_name], cwd=workspace, check=True)
                    return True

                else:
                    current_stderr = test_proc.stderr or test_proc.stdout
                    failing_diff = norm_result.sanitized_diff
                    debugging_history.append({
                        "role": "assistant",
                        "content": f"```diff\n{failing_diff}\n```",
                    })
                    debugging_history.append({
                        "role": "user",
                        "content": f"Test failed with exit code {test_proc.returncode}.\nSTDERR:\n{current_stderr}",
                    })
                    retry_count += 1

            return False


if __name__ == "__main__":
    node_id = os.environ.get("SUTRADHAR_NODE_ID", "NODE-LOCAL01")
    print(f"[*] Starting Sutradhar Sequential Worker {node_id}...")
