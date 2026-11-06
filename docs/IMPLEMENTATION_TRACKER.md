# SUTRADHAR — Implementation & Release Tracker

**Date:** 2026-11-06  
**Starting baseline:** `7d09b021bffcebe50300e175fbedb3938d6c523a`  
**Implementation branch:** `fix/p0-containment-2026-11-06`  
**Target:** PR review into `main` after CI, threat-model checks and owner approval.

## Status vocabulary

- **CODED / CI PENDING** — code exists on the fix branch; not accepted as deployed or production-validated.
- **PARTIAL** — some required functionality exists; release acceptance is not satisfied.
- **BLOCKED** — deliberately fail-closed or dependent on missing integration/infrastructure.
- **OWNER ACTION** — requires repository owner to rotate credentials or configure GitHub.
- **VERIFIED** — a scoped test actually executed successfully; this does **not** imply end-to-end readiness.

## Current implementation matrix

| ID | Priority | Workstream | Status | Implementation / acceptance remaining |
|---|---|---|---|---|
| SEC-01 | P0 | Public committed signing key | OWNER ACTION | Current tree cleaned in prior commit; rotate exposed key, invalidate all old leases, decide authorized history remediation. Never retrieve or print exposed key. |
| SEC-02 | P0 | Default-deny API authentication | CI VERIFIED (SCOPED) | `server.ts` removes default worker secret, anonymous admin access, public cluster-state/database reads; test unauthorized requests and browser session. |
| SEC-03 | P0 | Browser administration | CI VERIFIED (SCOPED) | HttpOnly Strict cookie login and authenticated dashboard in `src/App.tsx`; production HTTPS, CSRF/origin and deployment smoke test required. |
| SEC-04 | P0 | Worker identity and lease scope | PARTIAL | Worker key requires configured worker ID; ticket mutation checks active DB lease. Must implement distinct identities for multiple worker nodes and stronger authenticated messages. |
| SEC-05 | P0 | Telegram controls | PARTIAL | Explicit admin allowlist exists; complete audited control-command coverage and escape all dynamic notifications. |
| EXEC-01 | P0 | Real backend Docker tests | CI VERIFIED (SCOPED) | `server.ts` invokes `sandbox/execute_ticket.py`; actual HTTP→Git snapshot→Docker→SQLite pass/fail/scope tests passed in Actions run 42259691009. Production deployment, language-specific images and stronger evidence provenance remain. |
| EXEC-02 | P0 | Isolated workspaces | CI VERIFIED (SCOPED) | Git HEAD archive, forbidden-path/symlink checks, scope-checked diff, Docker container start marker and real test exits verified. Dedicated hardened worker host/threat review still required. |
| EXEC-03 | P0 | Live LLM synthesis | PARTIAL | Real Gemini/OpenRouter calls exist; validate actual unified diff output and ensure no arbitrary caller forces simulator. |
| GIT-01 | P0 | No invented merge status | CODED / CI PENDING | Git verification endpoint now fails closed with HTTP 501 rather than setting `COMMITTED_PUSHED`. Real remote commit/PR/merge evidence not yet implemented. |
| GIT-02 | P0 | Worker Git error handling | CODED / CI PENDING | Python worker rejects failed fetch/commit/rebase/push and out-of-scope staged paths; automated disposable-Git integration tests pending. |
| GIT-03 | P0 | Protected merge queue | BLOCKED | Durable queue, GitHub PRs/checks, epoch fencing and actual merge evidence missing; existing Python queue pushes directly to `main`. |
| ROLL-01 | P0 | Truthful rollback status | CODED / CI PENDING | `ROLLBACK_REQUESTED` recorded, not `ROLLBACK_COMPLETED`. Actual Git revert/test/review/merge workflow still missing. |
| DB-01 | P1 | Atomic Node ticket/master claims | PARTIAL | `BEGIN IMMEDIATE` exists; add multi-process contention and epoch-fencing tests. |
| DB-02 | P1 | Python/Node clock consistency | CODED / CI PENDING | Python SQLite paths changed to milliseconds and writer transactions; test cross-language startup and concurrent writes. |
| DB-03 | P1 | One authoritative cluster state | PARTIAL | Parallel JS in-memory data, seeded fictitious workers, and Python JSON config/audit cache remain. |
| WATCH-01 | P1 | Heartbeat and pause | PARTIAL | SQLite heartbeat ownership validation, worker-ID checks, stop-after-current pause implemented; lease expiry/epoch checks and persisted failover still need proof. |
| UI-01 | P1 | Honest dashboard | PARTIAL | Admin login and real Docker result toasts; fake failure controls removed. Production demo seed, fictional metrics and live synchronization still require correction. |
| TEST-01 | P1 | Automated pipeline | CI VERIFIED (SCOPED) | Actions runs TS lint/tests/build, Python SQLite/sandbox tests, real Python Docker and real Express→Docker integration. Use latest commit-specific run; no branch protection configured. |
| TEST-02 | P1 | Real E2E tests | PARTIAL — DOCKER VERIFIED | Actual Docker runner and HTTP endpoint tests pass, including failure and forbidden path. Existing old `e2e_lifecycle` remains fixture-only; no remote Git/PR merge or real rollback integration. |
| DOC-01 | P1 | Accurate documentation | CODED / CI PENDING | This tracker, implementation log and revised `IMPLEMENTATION_STATE.md`; keep statuses evidence-based. |
| OPS-01 | P1 | CI required checks & branch protection | OWNER ACTION | Configure required PR checks, rules and secrets. No unauthorized history rewrite or force push. |
| OPS-02 | P2 | Reproducible dependencies | BLOCKED | No npm lockfile, floating `@google/genai: latest`, incomplete Python dependency specification. |

## Release gates (all must pass; no shortcuts)

1. Rotate the historically exposed signing key and invalidate previous tokens.
2. Prove unauthenticated, forged-role, forged-worker and cross-origin requests cannot control the cluster.
3. Prove real generated code is applied inside an isolated worktree with actual Docker exit status, stdout/stderr and timeout.
4. Prove a failed test or missing Docker never becomes `READY_FOR_REVIEW` / `COMMITTED_PUSHED`.
5. Prove branch commit, authorized file scope, live epoch, valid lease, CI checks and actual remote merge before marking `COMMITTED_PUSHED`.
6. Prove rollback is an actual verified Git revert, not a hotfix record.
7. Prove Node and Python share one authoritative transaction/clock model, recover from restart, and elect one leader.
8. Prove UI shows truthful live data, browser login works over HTTPS, and P0 controls require authorized identities.
9. Make all required CI checks green, merge through a reviewed PR, then separately smoke-test a deployment.

## Next implementation slice

**Priority next:** connect tested candidate artifacts to verified Git branch commits and required-check PR merges with durable evidence; implement actual revert-and-merge rollback. Keep `/api/cluster/ticket/verify-push` returning HTTP 501 until remote verification is proven. Also implement DB-level concurrent test locking and language-specific signed runner images.

## Verification policy

Code inspection is not a passing test. CI results refer to a specific commit; subsequent commits invalidate that proof until rerun. Docker and GitHub integration tests require actual dependencies and credentials. Report `NOT_RUN`, `BLOCKED`, or `FAILED` truthfully.

See [implementation log](./IMPLEMENTATION_LOG_2026-11-06.md) and [real sandbox execution guide](./SANDBOX_EXECUTION.md) for performed actions, configuration and CI evidence.
