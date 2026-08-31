#!/usr/bin/env python3
"""
SUTRADHAR CLUSTER - CONSENSUS & LEADER ELECTION (v5.3)
SQLite-backed persistent state machine with monotonic epoch self-demotion.
"""
from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger("sutradhar.consensus")


@dataclass
class NodeRecord:
    node_id: str
    role: str
    uptime_seconds: int
    last_heartbeat: int
    epoch_id: int


class ClusterStateManager:
    def __init__(self, db_path: str = "/opt/sutradhar/data/cluster_state.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cluster_meta (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    current_epoch INTEGER NOT NULL,
                    active_master_id TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS node_registry (
                    node_id TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    uptime_seconds INTEGER NOT NULL,
                    last_heartbeat INTEGER NOT NULL,
                    epoch_id INTEGER NOT NULL
                );
            """)
            conn.execute("""
                INSERT OR IGNORE INTO cluster_meta (id, current_epoch, active_master_id, updated_at)
                VALUES (1, 1, 'UNINITIALIZED', ?);
            """, (int(time.time()),))

    def get_cluster_epoch(self) -> Tuple[int, str]:
        with self._get_conn() as conn:
            cursor = conn.execute("SELECT current_epoch, active_master_id FROM cluster_meta WHERE id = 1;")
            row = cursor.fetchone()
            return row[0], row[1]

    def register_heartbeat(self, node_id: str, role: str, uptime: int, epoch_id: int) -> Tuple[int, str, bool]:
        now = int(time.time())
        with self._get_conn() as conn:
            cursor = conn.execute("SELECT current_epoch, active_master_id FROM cluster_meta WHERE id = 1;")
            curr_epoch, master_id = cursor.fetchone()

            must_demote = False
            if role == "MASTER" and (epoch_id < curr_epoch or (master_id != node_id and master_id != "UNINITIALIZED")):
                must_demote = True

            conn.execute("""
                INSERT INTO node_registry (node_id, role, uptime_seconds, last_heartbeat, epoch_id)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                    role=excluded.role,
                    uptime_seconds=excluded.uptime_seconds,
                    last_heartbeat=excluded.last_heartbeat,
                    epoch_id=excluded.epoch_id;
            """, (node_id, "STANDBY" if must_demote else role, uptime, now, curr_epoch))

            return curr_epoch, master_id, must_demote

    def elect_new_master(self, candidate_node_id: str) -> Optional[int]:
        now = int(time.time())
        with self._get_conn() as conn:
            cursor = conn.execute("SELECT current_epoch, active_master_id, updated_at FROM cluster_meta WHERE id = 1;")
            curr_epoch, current_master, last_updated = cursor.fetchone()

            if current_master != "UNINITIALIZED" and (now - last_updated) < 90 and current_master != candidate_node_id:
                logger.warning(f"[CONSENSUS] Master {current_master} is still alive. Refusing election.")
                return None

            new_epoch = curr_epoch + 1
            conn.execute("""
                UPDATE cluster_meta
                SET current_epoch = ?, active_master_id = ?, updated_at = ?
                WHERE id = 1;
            """, (new_epoch, candidate_node_id, now))

            conn.execute("""
                UPDATE node_registry SET role = 'MASTER', epoch_id = ? WHERE node_id = ?;
            """, (new_epoch, candidate_node_id))

            logger.info(f"[CONSENSUS] Node {candidate_node_id} elected MASTER for Epoch #{new_epoch}")
            return new_epoch


if __name__ == "__main__":
    mgr = ClusterStateManager("/opt/sutradhar/data/cluster_state.db")
    epoch, master = mgr.get_cluster_epoch()
    print(f"[+] Cluster State SQLite Initialized: Epoch #{epoch} | Master: {master}")
