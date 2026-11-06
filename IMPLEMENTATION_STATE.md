# Implementation State — 2026-11-06

**Status: REAL DOCKER CI VERIFIED; GITHUB MERGE GATE CODE-TESTED; LIVE MERGE/ROLLBACK NOT VERIFIED — NOT PRODUCTION READY**

The prior text in this file incorrectly equated manually persisted fixture data with verified Docker execution, Git push and remote merge. It has been superseded by evidence-based tracking.

See:
- [Implementation Tracker](docs/IMPLEMENTATION_TRACKER.md) — module-level implementation/remaining status.
- [Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-06.md) — changes and validation history.
- [Real Sandbox Execution](docs/SANDBOX_EXECUTION.md) — runtime configuration, evidence, isolation and limitations.
- [GitHub Merge Verification](docs/GITHUB_MERGE_VERIFICATION.md) — read-only delivery evidence and limitations.
- [7 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-07.md) — this continuation slice.
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
- GitHub merge verification now reads actual GitHub REST data when configured: merged PR, single commit, exact tested and merged tree, file scope, required CI checks and independent review. SQLite CAS checks live token/epoch again. Without configuration or trustworthy evidence it fails closed. **No real merged target PR has been acceptance-tested.**
- Rollback is `ROLLBACK_REQUESTED` until a verified revert merges.
- The old fixture-based `tests/e2e_lifecycle.test.ts` remains fixture-only for Git/merge. Separate real Docker integration suites now verify patch validation, passing/failing containers, Express API state transitions and SQLite writes.
- Legacy direct-main Python queue is disabled. Automated PR creation, durable merge queue, real target-repo acceptance, production branch protection and real rollback remain incomplete.

## Mandatory owner actions

Rotate the historically committed private signing key and invalidate legacy tokens; decide Git history cleanup separately. Configure production HTTPS, administrator credentials, authorized workers, Telegram admin allowlist, and required GitHub checks.

**Do not report 100% completion or deployment readiness based on unit tests alone.**
