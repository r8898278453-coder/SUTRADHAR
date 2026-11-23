# Active Gap Register — source/real-world reconciliation 24 November 2026

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
| GAP-P1-005 | Medium | Root/Desktop npm locks and Python dependency baseline | PARTIAL — committed npm locks with CI integrity; Python audit/review and production approval pending |
| GAP-P1-006 | Medium | CI results and production HTTPS browser smoke test | VERIFY PER COMMIT |

## Additional v7 target-architecture gaps (partial alpha source; production acceptance open)

| ID | Priority | New gap / conflict to resolve | Status |
|---|---|---|---|
| V7-GAP-01 | P0 | Hostinger Business deployed stateless HTTPS React/Express + MySQL schema, migration, backup/restore | PARTIAL — Central bundle, backup/restore and v8 staging CI; real Hostinger staging/deployment/restore NOT_RUN |
| V7-GAP-02 | P0 | Persistent node identity vs separate agent identity; 60s heartbeat, 180s suspicion, secure enrollment | PARTIAL — signed API and enrollment code/CI; physical Windows DPAPI/restart NOT_RUN |
| V7-GAP-03 | P0 | Initial post-08:00 election, retention across days, two ranked backups, fenced multi-PC failover | PARTIAL — MySQL election/concurrency/fencing CI; physical 2/3/8–10-PC NOT_RUN |
| V7-GAP-04 | P0 | Master hybrid developer duty + backup worker preemption, durable takeover context | PARTIAL — durable leadership/worker recovery source, physical hybrid duty acceptance open |
| V7-GAP-05 | P0 | Master deduplicated project selection/creation, parallel-safe task DAG and explicit QA contract | PARTIAL — project/task/QA API policies and disposable tests; real provider orchestration NOT_RUN |
| V7-GAP-06 | P0 | Electron isolation, browser provider compatibility, permitted chat continuation and project mapping | PARTIAL — OS-vault/Electron code in unsigned QA; browser-provider feasibility and physical acceptance OPEN |
| V7-GAP-07 | P0 | Trusted local patch/Git operator, MySQL path and semantic contract reservations, no unverified DONE | PARTIAL — local Git/scope reservations/QA guards CI; live protected GitHub acceptance OPEN |
| V7-GAP-08 | P0 | Independent QA, combined integration tree, live GitHub draft PR/merge acceptance, release evidence | PARTIAL — signed QA/source CI; real independent reviewer/device and live protected merge NOT_RUN |
| V7-GAP-09 | P0 | Centralized checkpoint/event history with idempotent crash/network recovery | PARTIAL — MySQL ledgers and recovery tests; hardware crash/partition proof NOT_RUN |
| V7-GAP-10 | P0 | Website and Telegram single Owner Command Service, default-deny core change authorization | PARTIAL — Owner API/dashboard policies CI; live Telegram parity and Owner authorization OPEN |
| V7-GAP-11 | P1 | Context minimization, retry budgets, provider quota and transparent partial results | PARTIAL — bounded evidence/source policies; real provider quota/cost measurements OPEN |
| V7-GAP-12 | P0 | Retire or disable production access to duplicate SQLite/in-memory/demo/legacy election and Git paths | PARTIAL — Central-only bundle and MySQL authority; legacy source remains and production route isolation NOT ACCEPTED |

**V7 authoritative target docs:** [Blueprint](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md), [Contracts](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), [Acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). Legacy issues above remain open until independently verified.

Full acceptance requirements: [docs/IMPLEMENTATION_TRACKER.md](docs/IMPLEMENTATION_TRACKER.md).  
Action history: [docs/IMPLEMENTATION_LOG_2026-11-06.md](docs/IMPLEMENTATION_LOG_2026-11-06.md).  
Runtime: [docs/SANDBOX_EXECUTION.md](docs/SANDBOX_EXECUTION.md).  
Git delivery: [docs/GITHUB_MERGE_VERIFICATION.md](docs/GITHUB_MERGE_VERIFICATION.md).
Rollback: [docs/VERIFIED_ROLLBACK_PIPELINE.md](docs/VERIFIED_ROLLBACK_PIPELINE.md).
Crash recovery: [docs/IMPLEMENTATION_LOG_2026-11-11.md](docs/IMPLEMENTATION_LOG_2026-11-11.md).


## Exact-HEAD evidence rule (23 November 2026)

`PARTIAL` means source exists on the **unmerged Draft PR**, not that production
works. Mark a gap `ACCEPTED` only after an independent reviewer examines the
required real-system evidence for the exact release SHA; see
[71-case matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and
[Owner production issue](https://github.com/r8898278453-coder/SUTRADHAR/issues/2).
Known release blockers include an unprotected `main` reported by GitHub branch
metadata, absent Hostinger staging/off-host restore, no Owner-certified Windows
signer, no witnessed real 2/3/8–10-PC behavior and no G0–G7 approval.
Even if npm CI passes, do **not** merge, publish signed packages or deploy to
live customers. The physical/credential/Owner gates cannot be closed by CI.

## 24 November 2026 — audited source-level fixes vs still open

The [targeted deep repository audit](docs/REPOSITORY_DEEP_AUDIT_2026-11-24.md)
inventories the Git tree and distinguishes source defects repaired on
unmerged Draft PR #1 from environmental/Owner prerequisites. Code-level
fixes cover four developer CLI journal race paths; malformed GitHub review
records; bounded GitHub provenance; G0 protected-branch prerequisites;
future-dated Backup candidates; installer diagnostic evidence reads; and
nested Git/npm/secret-file escapes under broad worker scopes. These are
**pending exact-current-HEAD CI plus independent acceptance**, not
self-certified production fixes.

The known `main protected:false` G0 gap, Hostinger staging, MySQL
backup→restore, trusted Windows signer, physical 2/3/8–10-PC election and
update/rollback evidence, and G7 Owner approval remain OPEN. The
historical public Master signing key rotation is still OWNER ACTION.
