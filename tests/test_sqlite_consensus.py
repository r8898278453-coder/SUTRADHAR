"""SQLite CAS regression tests: no network, secrets, or external dependencies."""
import concurrent.futures
import os
import sqlite3
import tempfile
import time
import unittest

from core.state_db import StateDatabase


class SQLiteConsensusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp.name, "cluster.db")
        self.db = StateDatabase(
            persistence_file=os.path.join(self.temp.name, "cache.json"),
            sqlite_file=self.db_path,
        )
        now = int(time.time() * 1000)
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                CREATE TABLE system_state (
                    id INTEGER PRIMARY KEY, current_master_id TEXT, epoch_id INTEGER,
                    last_heartbeat INTEGER, updated_at INTEGER,
                    kill_switch_active INTEGER, max_concurrent_workers INTEGER
                );
                CREATE TABLE workers (
                    worker_id TEXT PRIMARY KEY, role TEXT, status TEXT,
                    current_ticket_id TEXT
                );
                CREATE TABLE tickets (
                    ticket_id TEXT PRIMARY KEY, status TEXT, assigned_to TEXT,
                    branch TEXT, updated_at INTEGER
                );
                CREATE TABLE ticket_dependencies (
                    parent_ticket_id TEXT, child_ticket_id TEXT
                );
            """)
            conn.execute(
                "INSERT INTO system_state VALUES (1, ?, ?, ?, ?, ?, ?)",
                ("OLD-MASTER", 15, now - 190_000, now - 190_000, 0, 3),
            )
            for worker in ("NEW-MASTER", "WORKER-A", "WORKER-B"):
                conn.execute(
                    "INSERT INTO workers (worker_id, role, status) VALUES (?, 'WORKER', 'IDLE')",
                    (worker,),
                )
            conn.execute("INSERT INTO tickets VALUES (?, 'PENDING', NULL, NULL, ?)", ("TKT-RACE", now))

    def tearDown(self):
        self.temp.cleanup()

    def test_master_election_uses_node_milliseconds(self):
        success, master, epoch = self.db.try_claim_master(
            "NEW-MASTER", heartbeat_ttl_seconds=180
        )
        self.assertTrue(success)
        self.assertEqual(master, "NEW-MASTER")
        self.assertEqual(epoch, 16)
        with sqlite3.connect(self.db_path) as conn:
            last_heartbeat = conn.execute(
                "SELECT last_heartbeat FROM system_state WHERE id = 1"
            ).fetchone()[0]
        self.assertLess(abs(last_heartbeat - int(time.time() * 1000)), 5000)

    def test_concurrent_ticket_claim_only_one_winner(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(
                lambda worker: self.db.try_claim_ticket(worker, "TKT-RACE"),
                ("WORKER-A", "WORKER-B"),
            ))
        self.assertEqual(sum(1 for success, _ in results if success), 1)
        with sqlite3.connect(self.db_path) as conn:
            status, assigned_to = conn.execute(
                "SELECT status, assigned_to FROM tickets WHERE ticket_id = ?",
                ("TKT-RACE",)
            ).fetchone()
        self.assertEqual(status, "SYNTHESIZING_DIFF")
        self.assertIn(assigned_to, ("WORKER-A", "WORKER-B"))

    def test_kill_switch_blocks_new_claims(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE system_state SET kill_switch_active = 1 WHERE id = 1")
        success, error = self.db.try_claim_ticket("WORKER-A", "TKT-RACE")
        self.assertFalse(success)
        self.assertIn("KILL_SWITCH_ACTIVE", error)


if __name__ == "__main__":
    unittest.main()
