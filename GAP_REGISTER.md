# Active Gap Register — 2026-11-06 (V7 design addendum 2026-11-11)

This register reflects the current implementation branch, not an unsupported "all resolved" report.

| ID | Priority | Gap | Status |
|---|---|---|---|
| GAP-P0-001 | Critical | Previously public master signing key must be rotated; old leases invalidated | OWNER ACTION |
| GAP-P0-002 | Critical | HTTP real Docker execution integrated and tested; production images/provenance and deployment verification remain | PARTIAL — REAL DOCKER CI VERIFIED |
| GAP-P0-003 | Critical | Remote GitHub merge verifier pins registered PR/head; 15-minute admin proof grant handles expired worker lease. Live target GitHub merged-PR acceptance not run | PARTIAL — MOCKED API CI VERIFIED |
| GAP-P0-004 | Critical | Docker-tested rollback branch, draft PR and exact reviewed merged-tree verification; read-only rollback crash reconciliation with SQLite fencing added. Live target GitHub acceptance and HA recovery operation testing pending | PARTIAL — LOCAL GIT/DOCKER & MOCKED REST CI VERIFIED |
| GAP-P0-005 | High | Multiple worker identities and per-ticket lease enforcement across all operations | PARTIAL |
| GAP-P0-006 | High | Direct-main push disabled; guarded worker push with SQLite reservation and read-only crash reconciliation, draft PR/merge receipts integrated; live GitHub delivery and scheduled distributed queue pending | PARTIAL — RECOVERY CI VERIFIED |
| GAP-P1-001 | High | Node/Python shared-state and leader failover consistency | PARTIAL |
| GAP-P1-002 | High | Forward patch and rollback reverse-tree Docker/Git tests pass; GitHub reviewed PR and merge are mocked REST fixtures only | PARTIAL — LOCAL GIT/DOCKER VERIFIED |
| GAP-P1-003 | High | Production demo seed and fictional worker metrics remain | PENDING |
| GAP-P1-004 | High | Runtime sandbox isolation security review | PENDING |
| GAP-P1-005 | Medium | Lockfile, pinned packages and Python requirements | PENDING |
| GAP-P1-006 | Medium | CI results and production HTTPS browser smoke test | VERIFY PER COMMIT |

## Additional v7 target-architecture gaps (design-only; not implemented)

| ID | Priority | New gap / conflict to resolve | Status |
|---|---|---|---|
| V7-GAP-01 | P0 | Hostinger Business deployed stateless HTTPS React/Express + MySQL schema, migration, backup/restore | SPECIFIED / NOT_RUN |
| V7-GAP-02 | P0 | Persistent node identity vs separate agent identity; 60s heartbeat, 180s suspicion, secure enrollment | SPECIFIED / NOT_RUN |
| V7-GAP-03 | P0 | Initial post-08:00 election, retention across days, two ranked backups, fenced multi-PC failover | SPECIFIED / NOT_RUN |
| V7-GAP-04 | P0 | Master hybrid developer duty + backup worker preemption, durable takeover context | SPECIFIED / NOT_RUN |
| V7-GAP-05 | P0 | Master deduplicated project selection/creation, parallel-safe task DAG and explicit QA contract | SPECIFIED / NOT_RUN |
| V7-GAP-06 | P0 | Electron isolation, browser provider compatibility, permitted chat continuation and project mapping | SPECIFIED / PROVIDER FEASIBILITY GATE |
| V7-GAP-07 | P0 | Trusted local patch/Git operator, MySQL path and semantic contract reservations, no unverified DONE | SPECIFIED / NOT_RUN |
| V7-GAP-08 | P0 | Independent QA, combined integration tree, live GitHub draft PR/merge acceptance, release evidence | SPECIFIED / NOT_RUN |
| V7-GAP-09 | P0 | Centralized checkpoint/event history with idempotent crash/network recovery | SPECIFIED / NOT_RUN |
| V7-GAP-10 | P0 | Website and Telegram single Owner Command Service, default-deny core change authorization | SPECIFIED / NOT_RUN |
| V7-GAP-11 | P1 | Context minimization, retry budgets, provider quota and transparent partial results | SPECIFIED / NOT_RUN |
| V7-GAP-12 | P0 | Retire or disable production access to duplicate SQLite/in-memory/demo/legacy election and Git paths | SPECIFIED / NOT_RUN |

**V7 authoritative target docs:** [Blueprint](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md), [Contracts](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), [Acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). Legacy issues above remain open until independently verified.

Full acceptance requirements: [docs/IMPLEMENTATION_TRACKER.md](docs/IMPLEMENTATION_TRACKER.md).  
Action history: [docs/IMPLEMENTATION_LOG_2026-11-06.md](docs/IMPLEMENTATION_LOG_2026-11-06.md).  
Runtime: [docs/SANDBOX_EXECUTION.md](docs/SANDBOX_EXECUTION.md).  
Git delivery: [docs/GITHUB_MERGE_VERIFICATION.md](docs/GITHUB_MERGE_VERIFICATION.md).
Rollback: [docs/VERIFIED_ROLLBACK_PIPELINE.md](docs/VERIFIED_ROLLBACK_PIPELINE.md).
Crash recovery: [docs/IMPLEMENTATION_LOG_2026-11-11.md](docs/IMPLEMENTATION_LOG_2026-11-11.md).
