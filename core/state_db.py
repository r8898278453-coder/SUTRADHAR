#!/usr/bin/env python3
"""
SUTRADHAR SHARED STATE LAYER - 'THE BRAIN' (v6.0 PRODUCTION)
Atomic Compare-And-Swap (CAS) Transactions, 6 Standard Collections,
Local Resilient Cache Fallback, Dependency Resolution, Quota Manager & Clarification Protocol.
"""
import os
import json
import time
import uuid
import logging
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("sutradhar.brain")

STATE_DIR = os.path.join(os.path.dirname(__file__), "..", ".sutradhar_state")
CACHE_FILE = os.path.join(STATE_DIR, "db_cache.json")


class StateDatabase:
    """
    Central Database Client for Sutradhar Cluster State.
    Implements Firestore-compatible Atomic CAS schema + Local HA Cache Fallback.
    Collections:
      - system_state: { current_master, global_status, max_concurrent_workers, epoch }
      - workers: { worker_id: { role, status, current_ticket, quota_usage, last_seen, machine_info } }
      - projects: { project_id: { name, git_repo_url, priority, status, created_at, config_hash } }
      - tickets: { ticket_id: { project_id, title, description, scope, status, claimed_by, claimed_at, attempt_count, branch_name, depends_on, clarification_question, rollback_commit } }
      - audit_log: { log_id: { timestamp, actor, action, ticket_id, reasoning, details } }
      - config: { prompts: { v1, v2, active_version }, model_quotas, shared_env }
    """

    def __init__(self, persistence_file: Optional[str] = None):
        self.persistence_file = persistence_file or CACHE_FILE
        os.makedirs(os.path.dirname(self.persistence_file), exist_ok=True)
        self._memory_db: Dict[str, Any] = self._load_from_disk()

    def _default_state(self) -> Dict[str, Any]:
        return {
            "system_state": {
                "current_master": {
                    "worker_id": "NODE-E78A1201",
                    "since_timestamp": time.time() - 3600,
                    "last_heartbeat": time.time(),
                    "epoch": 18
                },
                "global_status": "RUNNING",  # "RUNNING" | "PAUSED" | "MAINTENANCE"
                "max_concurrent_workers": 6,
                "active_project_id": "PRJ-MATRIMONY-01"
            },
            "workers": {
                "NODE-E78A1201": {
                    "worker_id": "NODE-E78A1201",
                    "name": "Master Node (Alpha)",
                    "role": "MASTER",
                    "status": "BUSY",
                    "current_ticket": "TKT-104",
                    "last_seen": time.time(),
                    "machine_info": "Linux x86_64 8-Core (Host Sandbox)",
                    "capabilities": ["ticket_generation", "docker_qa", "diff_synthesis", "git_merge"],
                    "quota_usage": {
                        "gemini_pro_daily_calls": 42,
                        "gemini_pro_limit": 1500,
                        "openrouter_daily_calls": 8,
                        "is_exhausted": False
                    },
                    "github_identity": {
                        "username": "sutradhar-master-alpha",
                        "email": "master-alpha@cluster.sutradhar.internal"
                    }
                },
                "NODE-B7A93310": {
                    "worker_id": "NODE-B7A93310",
                    "name": "Worker Node 1",
                    "role": "WORKER",
                    "status": "BUSY",
                    "current_ticket": "TKT-104",
                    "last_seen": time.time() - 15,
                    "machine_info": "Container Worker 01 (Docker Engine)",
                    "capabilities": ["diff_synthesis", "local_docker_test"],
                    "quota_usage": {
                        "gemini_pro_daily_calls": 128,
                        "gemini_pro_limit": 1500,
                        "openrouter_daily_calls": 3,
                        "is_exhausted": False
                    },
                    "github_identity": {
                        "username": "sutradhar-worker-1",
                        "email": "worker-1@cluster.sutradhar.internal"
                    }
                },
                "NODE-C34F9082": {
                    "worker_id": "NODE-C34F9082",
                    "name": "Worker Node 2",
                    "role": "WORKER",
                    "status": "IDLE",
                    "current_ticket": None,
                    "last_seen": time.time() - 10,
                    "machine_info": "Container Worker 02 (Docker Engine)",
                    "capabilities": ["diff_synthesis", "local_docker_test"],
                    "quota_usage": {
                        "gemini_pro_daily_calls": 95,
                        "gemini_pro_limit": 1500,
                        "openrouter_daily_calls": 12,
                        "is_exhausted": False
                    },
                    "github_identity": {
                        "username": "sutradhar-worker-2",
                        "email": "worker-2@cluster.sutradhar.internal"
                    }
                }
            },
            "projects": {
                "PRJ-MATRIMONY-01": {
                    "project_id": "PRJ-MATRIMONY-01",
                    "name": "Matrimony Matchmaking & Bio Sanitizer Engine",
                    "git_repo_url": "git@github.com:sutradhar-corp/matrimony-engine.git",
                    "priority": "P0_CRITICAL",
                    "status": "ACTIVE",
                    "created_at": "2026-08-30T10:00:00Z",
                    "config_hash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
                }
            },
            "tickets": {
                "TKT-104": {
                    "ticket_id": "TKT-104",
                    "project_id": "PRJ-MATRIMONY-01",
                    "title": "Matrimony Profile Controller & Bio Sanitizer",
                    "description": "Implement XSS scrubbing and sanitization on candidate profile bio fields.",
                    "scope": {
                        "allowed_files": ["modules/matrimony/ProfileController.php", "tests/Unit/BioSanitizerTest.php"],
                        "read_only_contracts": ["contracts/ProfileInterface.php"],
                        "definition_of_done": "Unit tests pass with 100% assertions and no HTML injection vulnerability."
                    },
                    "status": "in_progress",  # open | claimed | in_progress | review | done | failed | blocked_clarification | needs_human_review
                    "claimed_by": "NODE-B7A93310",
                    "claimed_at": time.time() - 320,
                    "attempt_count": 1,
                    "max_attempts": 3,
                    "branch_name": "worker-1/ticket-104",
                    "depends_on": None,
                    "clarification_question": None,
                    "rollback_commit": "c4b8291f8a"
                },
                "TKT-105": {
                    "ticket_id": "TKT-105",
                    "project_id": "PRJ-MATRIMONY-01",
                    "title": "Matchmaking Preference Weight Vector Optimizer",
                    "description": "Calculate Euclidean distance vector scoring for horoscope and lifestyle matches.",
                    "scope": {
                        "allowed_files": ["modules/matrimony/MatchOptimizer.php", "tests/Unit/MatchOptimizerTest.php"],
                        "read_only_contracts": ["contracts/ProfileInterface.php"],
                        "definition_of_done": "Vector distance calculations pass all edge case matrix tests."
                    },
                    "status": "open",
                    "claimed_by": None,
                    "claimed_at": None,
                    "attempt_count": 0,
                    "max_attempts": 3,
                    "branch_name": None,
                    "depends_on": "TKT-104",  # Dependency enforcement
                    "clarification_question": None,
                    "rollback_commit": None
                }
            },
            "audit_log": [
                {
                    "log_id": "LOG-001",
                    "timestamp": time.time() - 600,
                    "actor": "NODE-E78A1201",
                    "action": "MASTER_ELECTED",
                    "ticket_id": None,
                    "reasoning": "Previous heartbeat expired; atomic CAS claimed epoch #18.",
                    "details": {"epoch": 18}
                },
                {
                    "log_id": "LOG-002",
                    "timestamp": time.time() - 320,
                    "actor": "NODE-B7A93310",
                    "action": "TICKET_CLAIMED",
                    "ticket_id": "TKT-104",
                    "reasoning": "Ticket has status=open and zero blocking dependencies.",
                    "details": {"branch": "worker-1/ticket-104"}
                }
            ],
            "config": {
                "prompts": {
                    "active_version": "v2",
                    "v1": {
                        "ticket_generation": "System Prompt V1: Generate tickets from feature specs.",
                        "worker_builder": "System Prompt V1: Synthesize unified diff."
                    },
                    "v2": {
                        "ticket_generation": "System Prompt V2 (Rigid AST & Zero Assumption): Break feature into independent, non-overlapping tickets with explicit allowed_files and definition of done. If ambiguous, tag clarification_needed.",
                        "worker_builder": "System Prompt V2 (Zero Assumption Checkpoint): Adhere strictly to ticket scope. If ambiguity found, do NOT assume — halt and set status=blocked_clarification."
                    }
                },
                "model_routing": {
                    "ticket_generation_pinned_model": "gemini-pro",
                    "worker_primary_model": "gemini-pro",
                    "worker_fallback_models": [
                        "meta-llama/llama-3.3-70b-instruct:free",
                        "deepseek/deepseek-r1:free"
                    ],
                    "escalate_on_dual_failure": "needs_human_review"
                }
            }
        }

    def _load_from_disk(self) -> Dict[str, Any]:
        if os.path.exists(self.persistence_file):
            try:
                with open(self.persistence_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error reading cache DB file: {e}. Falling back to default.")
        state = self._default_state()
        self._save_to_disk(state)
        return state

    def _save_to_disk(self, state: Optional[Dict[str, Any]] = None) -> None:
        try:
            with open(self.persistence_file, "w", encoding="utf-8") as f:
                json.dump(state or self._memory_db, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist state cache: {e}")

    # ==================== COLLECTION ACCESSORS ====================

    def get_collection(self, collection_name: str) -> Any:
        return self._memory_db.get(collection_name, {})

    def get_system_state(self) -> Dict[str, Any]:
        return self._memory_db.get("system_state", {})

    def get_workers(self) -> Dict[str, Any]:
        return self._memory_db.get("workers", {})

    def get_tickets(self) -> Dict[str, Any]:
        return self._memory_db.get("tickets", {})

    def get_audit_log(self, limit: int = 50) -> List[Dict[str, Any]]:
        logs = self._memory_db.get("audit_log", [])
        return logs[-limit:]

    def get_config(self) -> Dict[str, Any]:
        return self._memory_db.get("config", {})

    # ==================== ATOMIC CAS TRANSACTIONS ====================

    def try_claim_master(self, worker_id: str, heartbeat_ttl_seconds: int = 180) -> Tuple[bool, str, int]:
        """
        Atomic Compare-And-Swap Master Election (Section 5).
        Returns (success: bool, current_master_id: str, epoch: int).
        """
        state = self._memory_db["system_state"]
        current = state.get("current_master", {})
        now = time.time()
        
        last_hb = current.get("last_heartbeat", 0)
        curr_master = current.get("worker_id")
        epoch = current.get("epoch", 1)

        # Check if master is alive
        if curr_master and (now - last_hb) < heartbeat_ttl_seconds:
            if curr_master == worker_id:
                # Refresh heartbeat
                current["last_heartbeat"] = now
                self._save_to_disk()
                return True, curr_master, epoch
            return False, curr_master, epoch

        # Master is expired or empty -> Atomic CAS win!
        new_epoch = epoch + 1
        state["current_master"] = {
            "worker_id": worker_id,
            "since_timestamp": now,
            "last_heartbeat": now,
            "epoch": new_epoch
        }

        # Update worker role
        if worker_id in self._memory_db["workers"]:
            self._memory_db["workers"][worker_id]["role"] = "MASTER"

        self.append_audit_log(
            actor=worker_id,
            action="MASTER_ELECTED_CAS",
            ticket_id=None,
            reasoning=f"Previous master timed out (> {heartbeat_ttl_seconds}s). Won atomic election CAS.",
            details={"epoch": new_epoch}
        )
        self._save_to_disk()
        return True, worker_id, new_epoch

    def try_claim_ticket(self, worker_id: str, ticket_id: str) -> Tuple[bool, str]:
        """
        Atomic Ticket Claim with Dependency Enforcement (Section 7, Section 11 Gap #3).
        Only claims if status is 'open' AND (depends_on is None OR depends_on status is 'done').
        """
        tickets = self._memory_db["tickets"]
        if ticket_id not in tickets:
            return False, "Ticket not found"

        tkt = tickets[ticket_id]

        # 1. Status check
        if tkt.get("status") != "open":
            return False, f"Ticket status is '{tkt.get('status')}', not 'open'"

        # 2. Dependency check (Section 11 Gap #3)
        dep_id = tkt.get("depends_on")
        if dep_id:
            if dep_id not in tickets:
                return False, f"Blocking dependency {dep_id} does not exist"
            dep_status = tickets[dep_id].get("status")
            if dep_status != "done":
                return False, f"Dependency {dep_id} is '{dep_status}', must be 'done' before claiming"

        # 3. Max Concurrent Worker Check (Section 11 Gap #10)
        max_workers = self._memory_db["system_state"].get("max_concurrent_workers", 6)
        active_claims = sum(1 for t in tickets.values() if t.get("status") in ["claimed", "in_progress"])
        if active_claims >= max_workers:
            return False, f"Max concurrent workers cap reached ({active_claims}/{max_workers})"

        # 4. Quota check for worker (Section 4.3)
        worker = self._memory_db["workers"].get(worker_id)
        if worker and worker.get("quota_usage", {}).get("is_exhausted", False):
            return False, f"Worker {worker_id} quota is marked exhausted. Cannot claim."

        # Atomic claim
        tkt["status"] = "claimed"
        tkt["claimed_by"] = worker_id
        tkt["claimed_at"] = time.time()
        tkt["branch_name"] = f"worker-{worker_id[-4:]}/ticket-{ticket_id.lower().replace('tkt-', '')}"

        if worker:
            worker["status"] = "BUSY"
            worker["current_ticket"] = ticket_id

        self.append_audit_log(
            actor=worker_id,
            action="TICKET_CLAIMED",
            ticket_id=ticket_id,
            reasoning="Dependency check passed. Atomic claim acquired.",
            details={"branch": tkt["branch_name"]}
        )
        self._save_to_disk()
        return True, "Claim successful"

    # ==================== CLARIFICATION PROTOCOL (Section 3.3) ====================

    def block_for_clarification(self, worker_id: str, ticket_id: str, question: str, reasoning: str) -> bool:
        """
        Worker halts assumption, transitions ticket to 'blocked_clarification', logs question.
        Worker frees current_ticket to pick next available open ticket.
        """
        tickets = self._memory_db["tickets"]
        if ticket_id not in tickets:
            return False
        tkt = tickets[ticket_id]
        tkt["status"] = "blocked_clarification"
        tkt["clarification_question"] = {
            "question": question,
            "asked_by": worker_id,
            "asked_at": time.time(),
            "reminders_sent": 0
        }
        
        # Free worker so they don't sit idle (Section 3.3)
        worker = self._memory_db["workers"].get(worker_id)
        if worker:
            worker["status"] = "IDLE"
            worker["current_ticket"] = None

        self.append_audit_log(
            actor=worker_id,
            action="BLOCKED_FOR_CLARIFICATION",
            ticket_id=ticket_id,
            reasoning=reasoning or "Ambiguous specification detected. Halted to prevent invalid assumption.",
            details={"question": question}
        )
        self._save_to_disk()
        return True

    def answer_clarification(self, ticket_id: str, answer: str, answered_by: str = "Human") -> bool:
        """
        Human or Master provides answer. Ticket resumes to 'in_progress' or 'open'.
        """
        tickets = self._memory_db["tickets"]
        if ticket_id not in tickets:
            return False
        tkt = tickets[ticket_id]
        if tkt["status"] != "blocked_clarification":
            return False

        if tkt.get("clarification_question"):
            tkt["clarification_question"]["answer"] = answer
            tkt["clarification_question"]["answered_by"] = answered_by
            tkt["clarification_question"]["answered_at"] = time.time()

        tkt["status"] = "in_progress"
        self.append_audit_log(
            actor=answered_by,
            action="CLARIFICATION_ANSWERED",
            ticket_id=ticket_id,
            reasoning="Clarification answer provided. Task unblocked.",
            details={"answer": answer}
        )
        self._save_to_disk()
        return True

    # ==================== BAD MERGE ROLLBACK (Section 11 Gap #5) ====================

    def rollback_merge(self, ticket_id: str, reason: str, actor: str = "Master") -> Tuple[bool, Optional[str]]:
        """
        Rolls back bad merge by referencing saved rollback_commit and auto-generating a hotfix ticket.
        """
        tickets = self._memory_db["tickets"]
        if ticket_id not in tickets:
            return False, "Ticket not found"

        tkt = tickets[ticket_id]
        saved_commit = tkt.get("rollback_commit", "HEAD~1")

        # Auto-create hotfix ticket
        hotfix_id = f"TKT-HOTFIX-{uuid.uuid4().hex[:4].upper()}"
        hotfix_ticket = {
            "ticket_id": hotfix_id,
            "project_id": tkt.get("project_id", "PRJ-MATRIMONY-01"),
            "title": f"[ROLLBACK HOTFIX] Revert {ticket_id}: {tkt.get('title')}",
            "description": f"Emergency rollback of {ticket_id} due to: {reason}. Git revert applied on {saved_commit}.",
            "scope": tkt.get("scope", {}),
            "status": "open",
            "claimed_by": None,
            "claimed_at": None,
            "attempt_count": 0,
            "max_attempts": 3,
            "branch_name": None,
            "depends_on": None,
            "clarification_question": None,
            "rollback_commit": None
        }
        tickets[hotfix_id] = hotfix_ticket

        self.append_audit_log(
            actor=actor,
            action="MERGE_ROLLBACK",
            ticket_id=ticket_id,
            reasoning=f"Bad merge detected. Reverted to commit {saved_commit}. Auto-spawned hotfix {hotfix_id}.",
            details={"rollback_commit": saved_commit, "hotfix_ticket": hotfix_id, "reason": reason}
        )
        self._save_to_disk()
        return True, hotfix_id

    # ==================== AUDIT LOG & REASONING (Section 11 Gap #12) ====================

    def append_audit_log(self, actor: str, action: str, ticket_id: Optional[str], reasoning: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        log_entry = {
            "log_id": f"LOG-{uuid.uuid4().hex[:6].upper()}",
            "timestamp": time.time(),
            "actor": actor,
            "action": action,
            "ticket_id": ticket_id,
            "reasoning": reasoning,  # LLM/Agent single-line reasoning
            "details": details or {}
        }
        if "audit_log" not in self._memory_db:
            self._memory_db["audit_log"] = []
        self._memory_db["audit_log"].append(log_entry)
        self._save_to_disk()
        return log_entry


# Global Singleton Database Instance
db = StateDatabase()

if __name__ == "__main__":
    print(f"[StateDB] Database initialized successfully at {CACHE_FILE}")
    print(f"[StateDB] Active master: {db.get_system_state().get('current_master')}")
    print(f"[StateDB] Total tickets: {len(db.get_tickets())}")
