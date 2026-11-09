# Implementation State — 2026-11-06

**Status: REAL DOCKER + LOCAL ROLLBACK GIT CI VERIFIED; LIVE GITHUB MERGE/ROLLBACK NOT VERIFIED — NOT PRODUCTION READY**

The prior text in this file incorrectly equated manually persisted fixture data with verified Docker execution, Git push and remote merge. It has been superseded by evidence-based tracking.

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
- Real rollback preparation now re-creates the exact first-parent Git tree of the previously verified merge in a private bare Git repository; an isolated Docker test must pass before a new rollback branch push. A draft GitHub rollback PR requires independent review/checks, and `ROLLBACK_COMPLETED` is recorded **only after read-only GitHub merge + restored tree verification**. Local Git/Docker and mocked GitHub API tests passed; real target-repo rollback merge was NOT performed.
- The old fixture-based `tests/e2e_lifecycle.test.ts` remains fixture-only for Git/merge. Separate real Docker integration suites now verify patch validation, passing/failing containers, Express API state transitions and SQLite writes.
- Legacy direct-main Python queue is disabled. Administrator worker-branch push and draft PR creation remain off by default. Worker push uses an atomic SQLite reservation, durable uncertainty state and read-only Git parent/tree recovery before an explicit retry; local bare-remote tests verify it. **No live target GitHub push/PR/merge acceptance performed.** Distributed scheduling, protected main, live review-grant acceptance, rollback crash reconciliation and live GitHub rollback acceptance remain incomplete.

## Mandatory owner actions

Rotate the historically committed private signing key and invalidate legacy tokens; decide Git history cleanup separately. Configure production HTTPS, administrator credentials, authorized workers, Telegram admin allowlist, and required GitHub checks.

**Do not report 100% completion or deployment readiness based on unit tests alone.**
