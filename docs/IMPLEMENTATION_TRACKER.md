# SUTRADHAR — Implementation & Release Tracker

**Original tracker baseline:** 2026-11-06  
**V7 architecture documentation update:** 2026-11-11 (SPECIFIED ONLY)  
**Starting baseline:** `7d09b021bffcebe50300e175fbedb3938d6c523a`  
**Implementation branch:** `fix/p0-containment-2026-11-06`  
**Target:** PR review into `main` after CI, threat-model checks and owner approval.

## Status vocabulary

- **CODED / CI PENDING** — code exists on the fix branch; not accepted as deployed or production-validated.
- **PARTIAL** — some required functionality exists; release acceptance is not satisfied.
- **BLOCKED** — deliberately fail-closed or dependent on missing integration/infrastructure.
- **OWNER ACTION** — requires repository owner to rotate credentials or configure GitHub.
- **VERIFIED** — a scoped test actually executed successfully; this does **not** imply end-to-end readiness.

## Owner-directed v7 architecture — design-only status

- [Architecture Blueprint v7.0](./SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md) — Hostinger Business + MySQL, 8–10 Electron nodes, retained 1 Master + 2 backups, 60-second heartbeats, browser-first workers and owner control.
- [Authoritative Agent / Task / QA / Recovery Contract](./AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md) — scope, permissions, state transitions, checkpoints, integration and fail-closed recovery.
- [V7 Requirements / Acceptance Matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) — executable proposed test IDs by milestone; **all new V7 tests NOT_RUN**.

| New target | Priority | Status | Required proof |
|---|---|---|---|
| V7-M1 Hostinger request-driven API + MySQL | P0 | SPECIFIED ONLY | Deployed HTTPS, migration, restart, backup restore, idempotent commands |
| V7-M2 Node registration / 60s heartbeat / retained Master | P0 | SPECIFIED ONLY | 2 distinct PCs, 08:00 initial election, 1+2 roles, 180s lease, epoch fencing |
| V7-M3 Intelligent project/task/contract planner | P0 | SPECIFIED ONLY | Deduplicated scope/contract-safe DAG with acceptance and test criteria |
| V7-M4 Electron provider-permitted browser worker | P0 | SPECIFIED / PROVIDER FEASIBILITY BLOCKED | Authorized provider project mapping, safe Git operator, checkpoint/new-chat; no extraction-policy bypass |
| V7-M5 Independent QA / protected Git integration | P0 | SPECIFIED / LIVE ACCEPTANCE PENDING | Combined Git tree QA, reviewed remote merge, rollback and receipts |
| V7-M6 Web/Telegram parity + 8–10 PC pilot | P0 | SPECIFIED ONLY | Real truthful status, cross-machine faults, provider quota, secure Owner commands |

**No Hostinger deployment, live MySQL migration, Electron desktop runtime, authorized unattended ChatGPT/AI Studio browser workflow, or V7 multi-host E2E acceptance has occurred.** Preserve the historical P0 security/Git gates below. Do not interpret v7 document commits as functional implementation.

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
| GIT-01 | P0 | Exact GitHub PR merge verification | CI VERIFIED (MOCKED GITHUB ONLY) | Remote PR number and pushed head now pinned to the registered draft; after review, an explicit 15-minute administrator grant plus real GitHub CI/review/merged-tree evidence required. Worker execution lease is NOT renewed. No live target PR merge acceptance executed. |
| GIT-02 | P0 | Exact tested-tree worker branch publisher | CI VERIFIED (LOCAL BARE REMOTE) | New sandbox/push_tested_branch.py uses Git index-only staging, exact Docker attestation and scope, remote main+branch checks, non-force worker push, remote SHA confirmation; local bare-remote integration tests pass. Live target GitHub push NOT RUN. |
| GIT-03 | P0 | Protected merge queue | PARTIAL — PUSH RESERVATION CI VERIFIED | Direct main push disabled; worker-branch push now uses atomic SQLite reservation and read-only recovery for uncertain outcomes. Fully scheduled distributed queue, PR operation locks, live target GitHub acceptance and protection rules pending. |
| GIT-04 | P0 | Draft PR creation gate | CI VERIFIED (MOCKED GITHUB ONLY) | Admin-only and off by default, requires exact verified-worker-push receipt and rechecks GitHub head/tree/base/scope before draft PR. Mocked REST and SQLite CAS tests only; live target PR NOT RUN. |
| ROLL-01 | P0 | Real Git revert, reviewed PR and crash reconciliation | CI VERIFIED (LOCAL GIT + DOCKER; MOCKED GITHUB) | Exact first-parent inverse tree Docker-tested before branch push; draft PR and reviewed merged SHA gate completion. Read-only Git/GitHub crash reconciliation uses SQLite fencing and re-Docker-tests existing branch; live target GitHub rollback acceptance NOT RUN. |
| DB-01 | P1 | Atomic Node ticket/master claims | PARTIAL | `BEGIN IMMEDIATE` exists; add multi-process contention and epoch-fencing tests. |
| DB-02 | P1 | Python/Node clock consistency | CODED / CI PENDING | Python SQLite paths changed to milliseconds and writer transactions; test cross-language startup and concurrent writes. |
| DB-03 | P1 | One authoritative cluster state | PARTIAL | Parallel JS in-memory data, seeded fictitious workers, and Python JSON config/audit cache remain. |
| WATCH-01 | P1 | Heartbeat and pause | PARTIAL / REVIEW FIX TESTED | Watchdog still revokes expired execution leases, but now preserves READY_FOR_REVIEW status and tested provenance; explicit admin proof-grant handles long reviews. Multi-host failover consistency pending. |
| UI-01 | P1 | Honest dashboard | PARTIAL | Admin login and real Docker result toasts; fake failure controls removed. Production demo seed, fictional metrics and live synchronization still require correction. |
| TEST-01 | P1 | Automated pipeline | CI VERIFIED (SCOPED) | Actions runs TS lint/tests/build, Python SQLite/sandbox tests, real Python Docker and real Express→Docker integration. Use latest commit-specific run; no branch protection configured. |
| TEST-02 | P1 | Real E2E tests | PARTIAL — DOCKER + LOCAL GIT VERIFIED | Actual Docker integration tests for both forward patch and rollback restored tree; local bare Git proves first-parent rollback branch and unchanged main. GitHub PR creation/review/merge mocked REST only; no live target acceptance. |
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

**Owner-directed next target (V7 M1):** implement and verify a stateless Hostinger Business HTTPS control API, MySQL schema/transaction/backup/migration path, then 2-PC enrollment + heartbeat + retained Master/backup election. **Existing security/Git acceptance debt:** perform owner-approved live target GitHub forward and rollback draft PR→reviewed merge acceptance (current GitHub API tests use mocks). Implement dedicated real-Docker HTTP recovery integration and HA durable PR queue/scheduling, strong branch protections and signer rotation. Rollback recovery is read-only and explicitly admin-triggered; it does not auto-retry external writes. No worker lease extension is used for human review; admin proof-grant implemented, awaiting live acceptance. Add durable DB-level duplicate-test locking, stronger provenance and language-specific signed Docker images. Verification endpoint now fails closed with 503 for missing config or 409 for insufficient evidence; it must never infer a merge from a token.

## Verification policy

Code inspection is not a passing test. CI results refer to a specific commit; subsequent commits invalidate that proof until rerun. Docker and GitHub integration tests require actual dependencies and credentials. Report `NOT_RUN`, `BLOCKED`, or `FAILED` truthfully.

See [implementation log](./IMPLEMENTATION_LOG_2026-11-06.md), [7 November continuation log](./IMPLEMENTATION_LOG_2026-11-07.md), [8 November continuation log](./IMPLEMENTATION_LOG_2026-11-08.md), [10 November implementation log](./IMPLEMENTATION_LOG_2026-11-10.md), [human review authorization](./HUMAN_REVIEW_AUTHORIZATION.md), [worker branch publication](./WORKER_BRANCH_PUBLICATION.md), [real sandbox guide](./SANDBOX_EXECUTION.md), and [GitHub merge verification](./GITHUB_MERGE_VERIFICATION.md), and [verified rollback pipeline](./VERIFIED_ROLLBACK_PIPELINE.md), and [11 November recovery log](./IMPLEMENTATION_LOG_2026-11-11.md) for performed actions, configuration and CI evidence.


## V7 alpha implementation activity — 2026-11-11 (not a production release)

The branch now additionally contains implemented experimental source code, beyond the original `SPECIFIED ONLY` v7 planning baseline. The original design/status text above is retained for historical provenance; **do not interpret it as the current branch code inventory**.

| Workstream | Branch code | Real environment acceptance |
|---|---|---|
| Hostinger-compatible request-driven Express/MySQL control API | `v7/central.ts`, `v7/schema.sql`, dashboard UI | Disposable MySQL CI only; **live Hostinger NOT_RUN** |
| Node/agent enrollment, Ed25519 signed 60s heartbeat, 08:00 initial election, sticky Master + 2 backups, failover and epoch fencing | `v7/agent.ts`, `v7/rules.ts`, transactional MySQL API | Deterministic tests and simulated distinct-node MySQL checks; **two actual PCs NOT_RUN** |
| Owner Web and Telegram shared command ledger, scoped project/agent approval | `v7/central.ts`, `v7/ui/*` | Limited commands exercised in CI; full web/Telegram parity NOT_RUN |
| Task creation, approved scope/capacity, dependencies, leased claims, checkpoints, independent QA receipt | MySQL API + `v7/worker.ts` | Disposable MySQL paths exercised; actual worker provider/browser path NOT_RUN |
| Guarded one-shot Git publication, read-only remote commit/tree proof, owner-enabled draft PR and independent merge verification | `v7/git_remote.ts`, `v7/worker.ts`, existing v6 guards | Read-only mock negatives and earlier local Git/Docker guards; **live approved target GitHub release NOT_RUN** |
| Secure manually assisted Electron shell | `v7/desktop/*` | Electron app packaging / OAuth compatibility / physical-PC UI test NOT_RUN |
| Read-only legacy SQLite inventory staging (not cutover) | `v7/migrate_legacy.ts`, `v7_legacy_imports` | Full authoritative migration/restore NOT_RUN |
| Test/CI | `tests/v7_rules.test.ts`, `tests/v7_git_remote.test.ts`, `tests/v7_mysql_integration.test.ts`, MySQL8 job | CI passing for applicable code paths only; **71 total V7 acceptance cases NOT_RUN unless specifically evidenced** |

**Safety/release gate still OPEN:** Owner approval for protected core/schema changes; secure desktop OS vault/anti-clone enrollment; real Hostinger deployment; full SQLite cutover; live 2-PC and 8–10-PC tests; official provider/browser-policy proof; full task creator and semantic interface reservations; combined integration QA; external protected PR/merge/rollback/release evidence. Nothing in this activity authorizes pushing/merging protected main or claiming production deployment.

Operational instructions: [v7/README.md](../v7/README.md). Canonical acceptance specifications: [v7 matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md).


## Documentation and non-developer deployment decision — 12 November 2026

**DOCUMENTED ONLY — no deployment, source tree refactor, release pipeline, installer, merge or production acceptance performed by this documentation work.**

| Decision/work item | Status | Evidence / next gate |
| --- | --- | --- |
| Root-level project README and human-readable owner navigation | **DOCUMENTED** | [README](../README.md) |
| One GitHub monorepo, two independently built applications plus versioned shared contracts | **DECIDED / REFACTOR NOT RUN** | [ADR-001](ADR_001_MONOREPO_TWO_APPS.md); existing code still under v7/ and root package.json |
| Owner first-time setup for Hostinger + 8–10 PCs | **DOCUMENTED / LIVE SETUP NOT RUN** | [Owner guide](OWNER_SETUP_AND_DEPLOYMENT.md); current CLI and privileged schema bootstrap still developer-assisted |
| Central-only release source and manual Owner promotion approval | **DESIGNED / NOT IMPLEMENTED** | Protect main; create release-only Hostinger production ref with audited approval; never link a live deployment to an ordinary development branch |
| Desktop signed installer, secure device vault, startup and updater | **DESIGNED / NOT IMPLEMENTED** | Independent packaging and real OS installation/pilot acceptance |
| MySQL backup/restore, versioned migrations, compatible Central/Desktop protocol and safe rollback | **DESIGNED / NOT ACCEPTED** | [Release operations](RELEASE_OPERATIONS.md); staging restores, migration proofs, actual deploy/recovery receipts |
| Current v7 alpha technical runbook cross-reference | **DOCUMENTED** | [v7/README](../v7/README.md) |
| Two-PC/8–10-PC, Hostinger and all 71 v7 requirements | **NOT_ACCEPTED** | [Acceptance matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) |

**Deployment reminder:** Current staging build settings are repository root (./), npm run build, dist/server.cjs on Node 22; apps/central does **not** exist yet. Hostinger's managed GitHub deployment can rebuild upon pushes, so a protected, explicitly Owner-promoted release ref is required before connecting the live Central website. Do not mistake a documentation-only decision for a functioning one-click deployment.


## Independent Central/Desktop build foundation — 12 November 2026

**Incremental code implementation on draft PR #1; no production release or merge.**

| Capability | Source/code added | Acceptance |
| --- | --- | --- |
| Shared protocol constants | packages/shared/contract.json; v7/rules.ts uses it; /v7/health reports api_protocol | Alpha unit/CI; live Central compatibility **NOT_RUN** |
| Independent Hostinger Central staging bundle | apps/central/build.cjs, apps/central/package.json; assets/schema/version manifest | Node CI builds and package boundary checks; **live Hostinger NOT_RUN** |
| Independent Desktop staging bundle | apps/desktop/build.cjs, Electron main/preload/setup UI and validated local config | Node CI build and setup validator; **real Windows install/child process NOT_RUN** |
| Windows QA-only unsigned installer | apps/desktop/pack-qa.cjs; CI PR-only Windows packaging smoke | CI target added; **no signing/publishing/owner installation approval** |
| Recovery and one-time enrollment safety | v7/agent.ts Master recovery GET includes agent ID; securely reconciles interrupted enrollment using signed node proof; discards grant after enrollment | Code/CI scope only; physical node recovery **NOT_RUN** |
| Build-time app boundary, artifact hashes | scripts/check-packages.cjs; apps/*/dist/release-manifest.json; CI npm run test:packages | CI proves no app-crossed files in staged dist; **NOT a signed production release** |
| Nontechnical first-run PC flow | HTTPS Central health preflight, generated per-PC agent IDs, Owner enrollment grant only in memory, local supervised agent | UI/runtime untested on physical Windows; no OS vault, updater or user-ready install |
| Separate Owner gated Central deployment ref/release approvals | Documented, not coded | **NOT CONFIGURED / OWNER ACTION** |

**Technical Hostinger staging settings, not a live deployment:** Root ./, Node.js 22, build npm run build:central, output apps/central/dist, entry apps/central/dist/server.cjs. The underlying Central source still lives in v7/, and the bundle still depends on root repository dependencies. Desktop production-safe packaging, dependency lock, secure vault, rollback, real Hostinger DB backup/restore, initial schema cutover and 71-case acceptance are blocked.

**Safety:** Windows alpha package must not be uploaded as a trusted installer; the QA workflow has only a private smoke-build step and no release/publication action. The owner retains control of any production promotion. The existing security/deployment release gates in this tracker remain unchanged.


## Release-safety implementation slice — 12 November 2026

**CODED on draft PR, not live production. Do not claim physical/device/Hostinger acceptance merely from CI.**

| Priority | Implemented source / tests | Evidence still REQUIRED |
| --- | --- | --- |
| Production-signed Windows installer gate | apps/desktop/pack-release.cjs; tests/release_sign_gate.test.cjs | Owner certificate and trusted Windows stable release. Current alpha is intentionally blocked. No signed production artifact. |
| OS-backed key protection | apps/desktop/os-vault.cjs; secure-agent.ts using Electron safeStorage, private IPC, monotonic signed sequence; tests/desktop_vault.test.cjs | Real Windows DPAPI install/restart, legacy migration, OS recovery, key rotation and QA worker bridge |
| Verifiable update/rollback | apps/desktop/update-policy.cjs; setup UI offline verification; scripts/release/sign-offline-offer.cjs; tests/desktop_update_policy.test.cjs | Owner signing keys, signed update feed, network distribution/replay protection, safe automatic install and full rollback |
| Hostinger staging health and immutable SHA | scripts/ops/hostinger-staging-preflight.cjs; tests/hostinger_staging_preflight.test.cjs | Actual Hostinger staging account/subdomain, real HTTPS/DB/asset/deployment log evidence |
| Encrypted MySQL backup and staging-only restore | scripts/ops/mysql-ops.cjs, backup-crypto.cjs; tests/mysql_backup_crypto.test.cjs | Real mysqldump (authorized off-host) and successful independently inspected restore; no production destructive restore path |
| Physical 2/3/8–10 PC pilot evidence | scripts/ops/pilot-readonly.cjs and pilot-policy.cjs; tests/pilot_policy.test.cjs | Two or more distinct physical machines, 08:00 IST/sticky Master, actual 180s failover, Backup2, old-epoch fencing, full QA and all 71 cases |

**Deployment status:** No Hostinger site, hPanel, MySQL account or physical PC was accessed. No production release ref advanced, signing certificate used, Windows installer uploaded, update installed, database migrated/restored, or PR merged. Changes remain in fix/p0-containment-2026-11-06.

**Source of truth for the next Owner trial:** [Owner-ready production checklist](PRODUCTION_READINESS_V7_2026-11-12.md). Production go-live requires all missing gates and explicit Owner approval, not just this documentation.


## Signing boundary + reproducible dependency proposal — 13 November 2026

**Changed code on draft PR #1 (no merge / deploy / signed release).**

- **OS-vault signing isolation CODED:** apps/desktop/vault-bridge.cjs generates/stores Ed25519 private key only inside Electron main-process safeStorage. apps/desktop/secure-agent.ts now receives only public identity plus strictly scoped Central request signatures. Sequence/boot/agent IDs are validated by parent. tests/desktop_signer_bridge.test.cjs covers forgery attempts, private-key non-disclosure, canonical verification and stale counters. **Physical Windows and process threat-model acceptance still NOT RUN.**
- **Dependency lockfile candidates GENERATED IN CI ONLY:** scripts/release/prepare-lockfile-candidate.cjs and .github/workflows/dependency-lock-proposal.yml resolve and pin @google/genai and emit root + Desktop candidate lockfiles as short-lived review artifact. **These are NOT committed** and must be reviewed/audited and tested with npm ci on Linux/Windows before release. Current root dependency remains \`latest\` on the draft branch until this review is done.
- Latest-scoped verification must refer to exact SHA; every subsequent commit needs rerun.
- No actual Hostinger staging deployment, Owner certificate, 2-PC test, secure updater distribution, production branch ref or account secrets were touched.

**Current external prerequisites:** [Owner provisioning runbook](OWNER_PROVISIONING_RUNBOOK.md), [Issue #2](https://github.com/r8898278453-coder/SUTRADHAR/issues/2). Keep production signing workflow locked until lockfiles reviewed, protected environment configured and Owner explicitly authorizes the exact release.


## Supported Electron and one-time grant isolation — 13 November 2026

**Draft PR #1 only. No production release or Hostinger/physical-PC acceptance.**

- Replaced **EOL Electron 33.4.11** with supported **Electron 45.3.1**, plus electron-builder 26.18.0. apps/desktop/runtime-policy.cjs checks approved major/patched minimum and fails closed after the 27 April 2027 support review deadline. tests/desktop_runtime_policy.test.cjs and QA pack guard added.
- Packaged Edge no longer receives the **one-time Owner enrollment grant** via IPC: apps/desktop/enrollment.cjs submits it directly from Electron main to Central over HTTPS, refuses redirects, verifies exact node ID and Owner approval requirement. Child gets success/error only; test coverage in tests/desktop_enrollment.test.cjs.
- apps/desktop/main.cjs now binds private IPC replies to the original child process instance to prevent a restart-race reply leaking to a replacement process.
- .github/workflows/dependency-lock-proposal.yml now tests generated root/Desktop candidate locks via **clean npm ci** on both Windows and Linux. Candidate artifact is not automatically committed; actual approved signed release remains blocked until dependency audit and reviewed lockfiles are committed.
- Sync Electron safeStorage remains supported in Electron 45 but is deprecated; a safe async migration is mandatory before a later runtime removes it. Windows DPAPI does not protect keys from every other process running as the same OS user.

**Required external proof remains:** Owner/independent reviewer, trusted signed Windows installer, OS-vault reboot/recovery, signed update rollout and rollback, Hostinger staging and MySQL restore, and real 2/3/8–10 physical-PC acceptance plus all 71 V7 tests.


## Exact SDK pin and dependency lock security gate — 14 November 2026

**Draft PR #1 only. No merge, Hostinger deployment or signed production installer.**

- The repository root previously declared **@google/genai: latest**. The dependency has been pinned to **3.3.0**, matching the previously successful Windows/Linux candidate install. This is a source dependency choice, **not** an independent vulnerability-audit approval.
- [scripts/release/verify-dependency-locks.cjs](../scripts/release/verify-dependency-locks.cjs) now verifies npm lockfile v3, manifest/lockfile pairing, resolved npm registry HTTPS URLs and package integrity hashes; rejects untrusted sources, floating latest and unpinned runtime versions.
- [tests/dependency_locks.test.cjs](../tests/dependency_locks.test.cjs) covers valid locks, tampering, floating versions, invalid registry/integrity, manifest drift and unpinned Electron.
- The review-only dependency workflow validates proposed locks with clean npm ci on **Windows and Linux**, including the new security check. The Owner-protected Windows signer also invokes this check **before privileged dependency installation**.
- **Still open:** root package-lock.json and apps/desktop/package-lock.json are generated as short-lived CI proposal artifacts, not yet committed to the draft branch. Production signer remains blocked until they are inspected, audited and committed with Owner/QA review.
- This lock check protects dependency provenance but **does not** prove installed package signatures, identify all supply-chain vulnerabilities, or replace real release approval.

**Production acceptance:** Windows signing, protected GitHub reviewers, actual Hostinger staging and encrypted restore, real-device OS vault, signed update rollback, physical 2–10 PC trial and all 71 acceptance cases remain not run.
