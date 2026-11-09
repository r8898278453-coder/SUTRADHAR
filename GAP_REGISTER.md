# Active Gap Register — 2026-11-06

This register reflects the current implementation branch, not an unsupported "all resolved" report.

| ID | Priority | Gap | Status |
|---|---|---|---|
| GAP-P0-001 | Critical | Previously public master signing key must be rotated; old leases invalidated | OWNER ACTION |
| GAP-P0-002 | Critical | HTTP real Docker execution integrated and tested; production images/provenance and deployment verification remain | PARTIAL — REAL DOCKER CI VERIFIED |
| GAP-P0-003 | Critical | Remote GitHub PR merge verifier implemented with exact tested tree, mandatory CI/review checks; live target PR acceptance not yet run | PARTIAL — MOCKED API CI VERIFIED |
| GAP-P0-004 | Critical | Real Git revert with verified merge missing | BLOCKED (REQUESTED only) |
| GAP-P0-005 | High | Multiple worker identities and per-ticket lease enforcement across all operations | PARTIAL |
| GAP-P0-006 | High | Direct-main push disabled; guarded worker push with SQLite reservation and read-only crash reconciliation, draft PR/merge receipts integrated; live GitHub delivery and scheduled distributed queue pending | PARTIAL — RECOVERY CI VERIFIED |
| GAP-P1-001 | High | Node/Python shared-state and leader failover consistency | PARTIAL |
| GAP-P1-002 | High | Real Docker+Git snapshot+HTTP+SQLite tests pass, but remote GitHub PR/merge E2E still missing | PARTIAL — DOCKER VERIFIED |
| GAP-P1-003 | High | Production demo seed and fictional worker metrics remain | PENDING |
| GAP-P1-004 | High | Runtime sandbox isolation security review | PENDING |
| GAP-P1-005 | Medium | Lockfile, pinned packages and Python requirements | PENDING |
| GAP-P1-006 | Medium | CI results and production HTTPS browser smoke test | VERIFY PER COMMIT |

Full acceptance requirements: [docs/IMPLEMENTATION_TRACKER.md](docs/IMPLEMENTATION_TRACKER.md).  
Action history: [docs/IMPLEMENTATION_LOG_2026-11-06.md](docs/IMPLEMENTATION_LOG_2026-11-06.md).  
Runtime: [docs/SANDBOX_EXECUTION.md](docs/SANDBOX_EXECUTION.md).  
Git delivery: [docs/GITHUB_MERGE_VERIFICATION.md](docs/GITHUB_MERGE_VERIFICATION.md).
