# Changelog

## [Unreleased — human review verification authorization] - 2026-11-10

### Added
- Separate administrator-only, short-lived (15-minute) authorization for
  read-only GitHub merged-PR proof checks; **no worker lease renewal**.
- Exact registered PR number and pushed head SHA pinned to the verifier.
- SQLite grant CAS enforces tested tree/patch/epoch/kill-switch and original
  token revocation, consumes grant atomically with verified merged SHA.
- Watchdog now preserves READY_FOR_REVIEW evidence after worker timeout
  while still revoking stale execution leases.
- Negative and post-lease-expiry tests for admin grants and GitHub evidence.
- [Human Review Authorization Guide](docs/HUMAN_REVIEW_AUTHORIZATION.md).

### Pending
- Owner-approved live target GitHub PR acceptance, actual Git revert
  rollback and production/release security gates.

## [Unreleased — durable push crash recovery] - 2026-11-10

### Added
- SQLite `worker_push_jobs` reservation before remote Git operations, with
  RUNNING, NEEDS_RECONCILIATION and CONFIRMED states shared across processes.
- Missing/uncertain push outcomes never trigger blind retry; expired jobs move
  into explicit recovery rather than automatically releasing the lock.
- Read-only Git remote inspection verifies main baseline, worker branch parent
  and exact Docker-tested tree, then recovers the signed receipt under CAS or
  permits a separate explicit retry only after proving remote branch absent.
- Regression tests across independent SQLite connections and real local bare
  Git remotes for positive, absent, mismatched and expired outcomes.
- Operator guide and implementation log for 10 November.

### Pending
- Real GitHub authenticated acceptance, durable PR operation reservations,
  human-review grant live acceptance, genuine Git revert rollback and
  production release checks. No live target GitHub operation performed.

## [Unreleased — verified worker branch publication] - 2026-11-08

### Added
- Real Git bare-index patch publication bound to Docker-tested Git tree,
  baseline, whitelist and changed files; only new worker branch non-force
  push, remote SHA confirmation; never push main.
- Optional administrator-only branch push endpoint and isolated GitHub push
  credentials, durable `verified_worker_pushes` receipts with signed worker
  lease/epoch/patch CAS checks; downstream draft PR and final merge CAS now
  require exact verified pushed commit.
- Real disposable local bare-remote Git push regression tests and API
  authentication/configuration tests. Dashboard shows separate Push Tested
  Branch, Create Draft PR and Verify GitHub Merge actions.

### Remaining
- No live target GitHub push/PR/merge performed; historical signer rotation,
  distributed queue/crash recovery, rollback revert and production deployment pending.

## [Unreleased — protected draft PR creation] - 2026-11-07

### Added
- Explicit administrator-only draft PR submission, disabled by default and
  controlled with separate write-scoped GitHub token.
- Exact tested tree, parent baseline, branch commit count and file-scope
  verification before draft PR creation; no automatic branch push or merge.
- Idempotent existing-draft handling, durable draft submission audit record,
  current signed worker lease / epoch / patch CAS checks.
- Positive/negative GitHub REST fixtures, API and SQLite regression tests;
  truthful Create Draft PR / Verify GitHub Merge UI buttons.

### Still pending
- Live GitHub target branch + draft PR acceptance, protected main configuration,
  real automated worker push, durable distributed queue, and rollback.
- No merge/deploy performed and no exposed signing key rotated.

## [Unreleased — GitHub verification slice] - 2026-11-07

### Added
- Immutable Git tree SHA attestation from a real Docker-tested snapshot; successful test and provenance are stored atomically in SQLite.
- Read-only GitHub REST merge verifier: single-commit PR parent/baseline, tested head/merged tree equality, allowed-file boundary, successful required GitHub Actions checks, independent human approval and merged-commit ancestry on main.
- Durable signed worker lease identity: master-issued token ID stored on claim and rechecked in the final SQLite CAS alongside current epoch/revocation/expiry.
- Verified merge evidence audit table; `COMMITTED_PUSHED` is written only for a genuinely validated remote PR and matching tested artifact.
- Mocked-GitHub API acceptance/denial tests, HTTP endpoint mocked-REST integration, SQLite CAS regression tests and Python queue safety tests.
- Operator documentation: [GitHub Merge Verification](docs/GITHUB_MERGE_VERIFICATION.md) and [7 November Log](docs/IMPLEMENTATION_LOG_2026-11-07.md).

### Safety and remaining work
- Disabled legacy in-process Git `checkout main` / `merge` / `push main` path; no implicit PR merge.
- **Live target-project GitHub PR acceptance remains unverified.** Tests use controlled REST fixtures and real SQLite, not an actual merged PR.
- Owner must configure read-only GitHub token, required checks, independent reviewers and branch protection, rotate the previously exposed signer, and complete real revert/rollback and protected PR creation.

## [Unreleased — fix branch] - 2026-11-06

### Implemented and CI-verified
- Default-deny admin APIs, browser login with HttpOnly session cookie, no hardcoded worker secret, stricter worker identity/lease checks.
- Actual HTTP-to-Docker test execution: clean `git archive HEAD` snapshot, unified patch validation against allowed files, isolated non-root Docker process, real exit codes, stdout/stderr, retry/DLQ transitions, SQLite attempt/audit persistence and stale-epoch/patch fencing.
- GitHub Actions now runs real Docker positive, negative and out-of-scope tests, including an Express HTTP-to-Docker-to-SQLite integration.
- TypeScript, React dashboard, state and worker safety fixes and evidence-based documentation.

### Deliberately blocked / still required
- No fabricated remote Git merge; `/api/cluster/ticket/verify-push` remains HTTP 501 until real PR/merge evidence is implemented.
- Rollback is only `ROLLBACK_REQUESTED`, not an actual Git revert.
- Historical signing-key leak requires owner rotation/revocation.
- No production readiness claim: real PHP/Node target images, GitHub merge queue, branch protection, multi-worker identities and production dashboard demo isolation remain.

**Documentation:** [Implementation Tracker](docs/IMPLEMENTATION_TRACKER.md) · [Sandbox Execution](docs/SANDBOX_EXECUTION.md) · [Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-06.md).

## [5.4.0] - 2026-11-04
### Added
- **Authoritative Shared State SQLite Database (`server_db.ts`)**:
  - Implemented Node 22 built-in `node:sqlite` (`DatabaseSync`) database at `.sutradhar_state/cluster.db` with WAL mode.
  - Entities managed: `system_state`, `workers`, `projects`, `tickets`, `ticket_dependencies`, `worker_leases`, `audit_log`, `configuration`, `model_usage`, `merge_queue`, `execution_attempts`, `revoked_tokens`.
  - Added atomic CAS master election, atomic ticket claims with DAG dependency enforcement, watchdog lease sweeper, clarification protocol, and rollback hotfix creation.
- **Genuine Ed25519 Asymmetric Cryptographic Gatekeeper**:
  - Asymmetric Ed25519 keypair provisioned in `.sutradhar_state/secrets/`.
  - Cryptographic token generation and verification using native Node `crypto.sign` and `crypto.verify`.
  - OpenSSL CLI fallback in `core/crypto_signer.py` for Python runtime.
  - Added public key endpoint `GET /api/cluster/security/public-key` and standalone token verification endpoint `POST /api/cluster/security/verify-token`.
  - Added automated test suite `tests/security_ed25519.test.ts` (16 test vectors, all passing).
  - Added automated test suite `tests/cluster_db.test.ts` (9 test vectors, all passing).
- **Model Usage & Telemetry**:
  - Pinned LLM code synthesis and self-healing to `@google/genai` compliant `'gemini-3.8-flash'` with `User-Agent: aistudio-build`.
  - Persisted latency, token counts, and success status to `model_usage` table.
- **End-to-End Task Lifecycle Automated Test (`tests/e2e_lifecycle.test.ts`)**:
  - Added 15 comprehensive automated test vectors covering Master election, DAG task creation, child claim rejection, parent lease claim, heartbeat progress, sandbox failure injection, closed-loop healing, Ed25519 commit verification, automatic child unblocking, HITL clarification, emergency kill-switch, bad merge rollback, and watchdog sweep.
  - Replaced `window.alert` in `TelegramLiveCard.tsx` with responsive inline notification banners.

### Changed
- Wired `/api/cluster/state`, `/api/db/all`, `/api/cluster/ticket/create`, `/api/tickets/claim`, `/api/cluster/ticket/synthesize`, `/api/cluster/ticket/test`, `/api/cluster/ticket/self-heal`, `/api/cluster/watchdog/heartbeat`, `/api/cluster/watchdog/revoke`, and `/api/master/rollback` directly to `clusterDb`.
- Updated background watchdog interval to atomically sweep SQLite leases and auto-revoke dead worker tickets.
- Replaced prohibited models (`gemini-2.0-flash`, `gemini-pro`, `gemini-flash-1.5-8b`) with modern active models.

### Fixed
- Fixed Python 3.10 f-string backslash syntax error in `core/protocol.py`.
- Fixed tuple unpacking mismatch in `core/leader_election.py`.
- Hardened Telegram bot commands against HTML injection and unauthorized caller execution.

## [5.3.1] - 2026-11-03
### Fixed
- Dev server initialization restored on port 3000 with Vite middleware integration.
- Resolved TypeScript compilation and syntax defects in `TaskDAGView.tsx` and `src/App.tsx`.
- Verified live HTTP 200 responses on both frontend index route `/` and backend API `/api/cluster/state`.

### Added
- Repository state management files: `IMPLEMENTATION_STATE.md`, `CODEBASE_MAP.md`, `GAP_REGISTER.md`, and `CHANGELOG.md`.
