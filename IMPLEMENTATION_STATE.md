# Implementation State — 2026-11-06

**Status: REAL DOCKER + LOCAL ROLLBACK GIT CI VERIFIED; LIVE GITHUB MERGE/ROLLBACK NOT VERIFIED — NOT PRODUCTION READY**

The prior text in this file incorrectly equated manually persisted fixture data with verified Docker execution, Git push and remote merge. It has been superseded by evidence-based tracking.

## Owner-directed architecture v7.0 — design-only

On 2026-11-11, **three new normative target documents** were committed to the existing fix branch:
- [Architecture Blueprint v7](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md)
- [Agent / Task / QA / Recovery Contract](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md)
- [V7 Requirements / Acceptance Tests](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md)

Finalized target: owner's existing Hostinger Business web hosting + MySQL + request-driven HTTPS/Telegram web backend; 8–10 Electron PCs with unique node/agent IDs; retained 1 Active Master + 2 backups selected after 08:00 initial bootstrap, 60-second heartbeats; hybrid Master-as-Developer, permitted browser-first AI workflow, safe Git, checkpoints, independent QA and protected review.

**Documentation only: NOT a MySQL migration, Hostinger deployment, Electron browser implementation, browser-provider acceptance or multi-host test.** Existing SQLite code, partially in-memory/demo data, API LLM router and CI-scoped Git/Docker verification remain the current execution reality. All V7 tests are NOT_RUN; live GitHub forward/rollback acceptance and historic signer rotation remain outstanding.

See:
- [Implementation Tracker](docs/IMPLEMENTATION_TRACKER.md) — module-level implementation/remaining status.
- [Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-06.md) — changes and validation history.
- [Real Sandbox Execution](docs/SANDBOX_EXECUTION.md) — runtime configuration, evidence, isolation and limitations.
- [GitHub Merge Verification](docs/GITHUB_MERGE_VERIFICATION.md) — read-only delivery evidence and limitations.
- [7 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-07.md) — this continuation slice.
- [8 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-08.md) — tested worker-branch push and live acceptance gaps.
- [10 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-10.md) — durable push reservation, crash recovery and human review authorization.
- [Human Review Authorization](docs/HUMAN_REVIEW_AUTHORIZATION.md) — short-lived admin proof grants, watchdog behavior and limits.
- [Verified Rollback Pipeline](docs/VERIFIED_ROLLBACK_PIPELINE.md) — Docker-tested revert branch, draft PR, GitHub merge proof and remaining gaps.
- [11 November Recovery Log](docs/IMPLEMENTATION_LOG_2026-11-11.md) — read-only rollback crash reconciliation, SQLite fencing and proof limits.
- [Worker Branch Publication](docs/WORKER_BRANCH_PUBLICATION.md) — guarded push protocol and local integration evidence.
- [GitHub Actions](https://github.com/r8898278453-coder/SUTRADHAR/actions) — check results for the specific commit.

## Implemented foundations

- React control plane and Express REST surface.
- Real Ed25519 payload signing and verification.
- SQLite storage with Node-side `BEGIN IMMEDIATE` claims and election.
- Python SQLite CAS and clock normalization on the fix branch.
- Gemini and OpenRouter API call code (runtime provider availability not proven here).
- Telegram chat + admin user allowlisting.
- Admin session login with HttpOnly SameSite cookie and same-origin mutations.
- Real Docker test endpoint: Git HEAD snapshot + scoped patch validation + disposable nonroot Docker execution + SQLite test outcomes. Both real runner and HTTP integration pass/fail tests have passed in CI.
- CI workflow and test entry points on the fix branch.

## Deliberately blocked until integrated

- HTTP Docker testing runs only when `SUTRADHAR_TARGET_REPO_ROOT` and `SUTRADHAR_SANDBOX_TEST_COMMAND` are configured and Docker is available. Missing prerequisites return 503; invalid patch scope returns 422. Production deployment is still unverified.
- GitHub merge verification checks the exact registered PR number/pushed commit, single tested head commit and merged tree, file scope, required Actions checks and independent review. After human review, administrator explicitly grants a 15-minute verification window without extending any worker lease. SQLite CAS consumes this grant and checks epoch, patch and provenance again. **No live target PR acceptance test performed.**
- Real rollback preparation reconstructs the exact first-parent Git tree of the previously verified merge in a private bare Git repository; Docker tests must pass before a new non-force branch push. Recovery can inspect actual remote Git, re-Docker-test an uncertain existing branch, inspect an exact draft PR read-only and recover only fenced SQLite receipts. A rollback remains `ROLLBACK_REQUESTED` until independent GitHub merged-tree verification. **No live target-repo rollback merge performed.**
- The old fixture-based `tests/e2e_lifecycle.test.ts` remains fixture-only for Git/merge. Separate real Docker integration suites now verify patch validation, passing/failing containers, Express API state transitions and SQLite writes.
- Legacy direct-main Python queue is disabled. Administrator worker-branch push and draft PR creation remain off by default. Worker push uses an atomic SQLite reservation, durable uncertainty state and read-only Git parent/tree recovery before an explicit retry; local bare-remote tests verify it. **No live target GitHub push/PR/merge acceptance performed.** Distributed scheduling, protected main, live review-grant acceptance and live GitHub rollback acceptance remain incomplete; read-only rollback crash reconciliation is now implemented and locally CI-tested, but cannot replace live acceptance.

## Mandatory owner actions

Rotate the historically committed private signing key and invalidate legacy tokens; decide Git history cleanup separately. Configure production HTTPS, administrator credentials, authorized workers, Telegram admin allowlist, and required GitHub checks.

**Do not report 100% completion or deployment readiness based on unit tests alone.**
