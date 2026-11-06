# Implementation State — 2026-11-06

**Status: REAL DOCKER EXECUTION CI VERIFIED; GIT MERGE/ROLLBACK BLOCKED — NOT PRODUCTION READY**

The prior text in this file incorrectly equated manually persisted fixture data with verified Docker execution, Git push and remote merge. It has been superseded by evidence-based tracking.

See:
- [Implementation Tracker](docs/IMPLEMENTATION_TRACKER.md) — module-level implementation/remaining status.
- [Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-06.md) — changes and validation history.
- [Real Sandbox Execution](docs/SANDBOX_EXECUTION.md) — runtime configuration, evidence, isolation and limitations.
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
- Git push verifier **does not verify a remote merge** and returns HTTP 501. No ticket is marked `COMMITTED_PUSHED` by that endpoint.
- Rollback is `ROLLBACK_REQUESTED` until a verified revert merges.
- The old fixture-based `tests/e2e_lifecycle.test.ts` remains fixture-only for Git/merge. Separate real Docker integration suites now verify patch validation, passing/failing containers, Express API state transitions and SQLite writes.
- Real worker identity management, durable merge queue and protected GitHub PR checks are incomplete.

## Mandatory owner actions

Rotate the historically committed private signing key and invalidate legacy tokens; decide Git history cleanup separately. Configure production HTTPS, administrator credentials, authorized workers, Telegram admin allowlist, and required GitHub checks.

**Do not report 100% completion or deployment readiness based on unit tests alone.**
