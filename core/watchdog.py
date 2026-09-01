#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - WATCHDOG & DEAD-TICKET RECOVERY ENGINE (v5.4)
Monitors worker heartbeats, tracks lease TTL expirations, auto-revokes dead tickets,
and handles Human-in-the-Loop (HITL) escalations.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set

logger = logging.getLogger("sutradhar.watchdog")


@dataclass
class LeaseWatchRecord:
    ticket_id: str
    worker_id: str
    epoch_id: int
    leased_at: float
    expires_at: float
    last_heartbeat_at: float
    missed_heartbeats: int = 0
    max_missed_heartbeats: int = 3
    is_revoked: bool = False
    progress_pct: int = 0
    last_step: str = "INITIAL_LEASE"


@dataclass
class WatchdogSweepResult:
    expired_tickets: List[str]
    revoked_workers: List[str]
    active_leases: int
    hitl_escalations: List[str]


class TicketWatchdog:
    """
    Tracks all active ticket leases, ensuring workers that go silent (>90s or 3 missed heartbeats)
    or exceed absolute TTL are gracefully revoked and their tasks returned to the DAG queue.
    """

    def __init__(
        self,
        heartbeat_interval_seconds: float = 30.0,
        max_missed_heartbeats: int = 3,
        on_ticket_revoked: Optional[Callable[[str, str, str], None]] = None,
        on_hitl_escalated: Optional[Callable[[str, str], None]] = None,
    ):
        self.heartbeat_interval = heartbeat_interval_seconds
        self.max_missed_heartbeats = max_missed_heartbeats
        self.on_ticket_revoked = on_ticket_revoked
        self.on_hitl_escalated = on_hitl_escalated
        self.leases: Dict[str, LeaseWatchRecord] = {}

    def register_lease(
        self,
        ticket_id: str,
        worker_id: str,
        epoch_id: int,
        ttl_seconds: float = 900.0,  # 15 min default
    ) -> LeaseWatchRecord:
        now = time.time()
        record = LeaseWatchRecord(
            ticket_id=ticket_id,
            worker_id=worker_id,
            epoch_id=epoch_id,
            leased_at=now,
            expires_at=now + ttl_seconds,
            last_heartbeat_at=now,
            missed_heartbeats=0,
            max_missed_heartbeats=self.max_missed_heartbeats,
        )
        self.leases[ticket_id] = record
        logger.info(f"[WATCHDOG] Registered lease for {ticket_id} -> {worker_id} (TTL: {ttl_seconds}s)")
        return record

    def record_heartbeat(
        self,
        ticket_id: str,
        worker_id: str,
        progress_pct: int = 0,
        current_step: str = "WORKING",
    ) -> bool:
        record = self.leases.get(ticket_id)
        if not record:
            logger.warning(f"[WATCHDOG] Received heartbeat for untracked ticket {ticket_id}")
            return False

        if record.worker_id != worker_id:
            logger.error(f"[WATCHDOG] Heartbeat worker mismatch on {ticket_id}: expected {record.worker_id}, got {worker_id}")
            return False

        now = time.time()
        record.last_heartbeat_at = now
        record.missed_heartbeats = 0
        record.progress_pct = progress_pct
        record.last_step = current_step
        logger.debug(f"[WATCHDOG] Heartbeat refreshed for {ticket_id} ({progress_pct}% - {current_step})")
        return True

    def release_lease(self, ticket_id: str) -> bool:
        if ticket_id in self.leases:
            del self.leases[ticket_id]
            logger.info(f"[WATCHDOG] Lease released for {ticket_id}")
            return True
        return False

    def sweep(self) -> WatchdogSweepResult:
        now = time.time()
        expired: List[str] = []
        revoked: List[str] = []
        hitl: List[str] = []

        for ticket_id, record in list(self.leases.items()):
            if record.is_revoked:
                continue

            # 1. Check absolute TTL expiration
            if now >= record.expires_at:
                record.is_revoked = True
                expired.append(ticket_id)
                revoked.append(record.worker_id)
                logger.warning(f"[WATCHDOG] Lease EXPIRED for {ticket_id} (Worker: {record.worker_id})")
                if self.on_ticket_revoked:
                    self.on_ticket_revoked(ticket_id, record.worker_id, "LEASE_TTL_EXPIRED")
                continue

            # 2. Check missed heartbeats interval
            time_since_hb = now - record.last_heartbeat_at
            missed_count = int(time_since_hb // self.heartbeat_interval)

            if missed_count > record.missed_heartbeats:
                record.missed_heartbeats = missed_count
                logger.info(f"[WATCHDOG] Ticket {ticket_id} missed heartbeat #{record.missed_heartbeats}")

            if record.missed_heartbeats >= record.max_missed_heartbeats:
                record.is_revoked = True
                expired.append(ticket_id)
                revoked.append(record.worker_id)
                logger.warning(
                    f"[WATCHDOG] Ticket {ticket_id} worker {record.worker_id} UNRESPONSIVE "
                    f"({record.missed_heartbeats} missed heartbeats, {time_since_hb:.1f}s silent). Auto-revoking..."
                )
                if self.on_ticket_revoked:
                    self.on_ticket_revoked(ticket_id, record.worker_id, "WORKER_UNRESPONSIVE")

        return WatchdogSweepResult(
            expired_tickets=expired,
            revoked_workers=revoked,
            active_leases=len([l for l in self.leases.values() if not l.is_revoked]),
            hitl_escalations=hitl,
        )
