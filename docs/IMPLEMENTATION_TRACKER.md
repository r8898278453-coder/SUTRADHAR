# SUTRADHAR — Implementation & Release Tracker

> **Current-reading note (22 November 2026):** Rows labelled `SPECIFIED ONLY`, `NOT_RUN` or `NOT IMPLEMENTED` in the original 6–11 November baseline sections below are preserved as historical records; they do **not** describe every current alpha source feature. Newer dated development sections and the [repository README](../README.md) record subsequent code/CI changes. Nevertheless, real Hostinger staging, production Windows signing, physical multi-PC tests, provider-permitted autonomy and independent release acceptance remain **NOT ACCEPTED / HOLD**. Neither historical notes nor CI imply go-live.

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
| OPS-02 | P2 | Reproducible dependencies | PARTIAL / CI VERIFIED | Root/Desktop npm v3 locks committed; exact @google/genai 3.3.0; Linux/Windows npm ci verified. Independent dependency audit, Python locking and isolated app workspaces pending. |

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

## 15 November 2026 — Committed locks and actual disposable MySQL restore

This is the latest state and supersedes older historical entries saying npm lockfiles do not exist or the AI SDK still floats as latest.

| Release gate | Current verified evidence | Outstanding production requirement |
| --- | --- | --- |
| Root npm dependency lock | package-lock.json committed; 348 npm package entries with integrity; CI npm ci | Independent security/licenses audit and Owner PR review |
| Desktop npm dependency lock | apps/desktop/package-lock.json committed; 283 entries; Electron 45.3.1 / builder 26.18.0; Windows CI npm ci and unsigned QA build | Real trusted signing certificate and physical installer acceptance |
| MySQL recovery tool | Disposable MySQL 8 CI successfully executes mysqldump, encrypted backup, authentication, empty staging restore and original-versus-restored rows | Live Hostinger staging/off-host backup, independent restore rehearsal and recovery timing evidence |
| Dependency integrity workflow | Reads committed lockfiles directly on Windows and Linux; no candidate regeneration or privileged file overwrite | High-severity advisory review and approved production dependency baseline |

Lockfile SHA-256 for review comparison:

- Root: 14fd124ae3ae40fbd0b516ba8b01fb7372eab31c62719cd7eea600c41f68722a
- Desktop: b4d305eb2abde14ddc42142391c3f7e528ef0a5af55cdc1ab140ec84c727c1d9

No Hostinger deployment, live MySQL restore, production Windows signing, automatic updater, physical multi-PC test or PR merge was performed.


## 15 November 2026 — Enrollment crash and duplicate-instance protection

| Safety gate | Implemented on Draft PR #1 | Still pending |
| --- | --- | --- |
| Single identity owner | Electron single-instance guard, tested pure policy | Real Windows multi-user/tray test |
| Durable receipt | PREPARED before request, SUBMITTED only after matching Central ACK; OS-vault key SHA and HTTPS origin bound | Real crash/reboot/DPAPI test |
| Uncertain grant result | No automatic repeat POST or rekey; user UI reports Owner review | Physical network-partition test |
| Explicit repair | Signed read-only Central /v7/nodes/me check, requiring same Owner-approved identity | Owner-approved recovery/rotation wizard |
| Malformed/legacy receipt | Fail closed; no silent legacy marker acceptance | Owner-guided migration |
| CI checks | Enrollment receipt, signed recheck and single-instance negative tests | Signed installer and physical PC acceptance |

No Hostinger deployment, production Windows signing, owner-approved release, actual multi-PC failover or PR merge was performed.

## 15 November 2026 — Signed Desktop offer scoped to rollout wave / node IDs

| Gate | Current implementation in draft PR | Outstanding acceptance |
| --- | --- | --- |
| Signed per-PC update | `apps/desktop/update-policy.cjs` accepts v2 Owner-signed wave with 1–10 explicit node IDs; checks installed OS-vault node, version, publisher and exact EXE SHA | Trusted Owner key, real Windows signed installer, physical PC test |
| Owner offline offer creation | `scripts/release/sign-offline-offer.cjs` signs exact version/SHA/Windows Authenticode evidence plus Owner wave/recipients | Protected signing infrastructure; actual Central device roster review |
| Wrong-target / legacy protection | Unsigned v1/global offers, wrong device, malformed/duplicated wave IDs, expired/tampered data fail closed; tests updated | Real signed staged one-PC/two-PC acceptance |
| Installer integrity | Chunked SHA256 plus after-Authenticode rehash; no memory-sized load and no symlink acceptance | Safe installer execution/TOCTOU-resistant install/recovery |
| Automatic update and rollback | NOT IMPLEMENTED: verified metadata is inspection-only | Real signed distribution, stop/pause, identity preservation, rollback telemetry, Owner approval |

Current unsigned alpha has `update-trust.json` unconfigured and cannot accept a production offer. **No installer was executed or distributed, no Hostinger account or physical PC was accessed, and main remains unchanged.** [Owner rollout runbook](SIGNED_DESKTOP_ROLLOUT_WAVES.md).

## 15 November 2026 — PC maintenance preflight and signed inspection journal

| New safety check | Code and unit verification scope | Still missing |
| --- | --- | --- |
| Live cluster-role preflight | `apps/desktop/update-readiness.cjs` uses scoped signed Central GETs; refuses active Master, Backup 1 or 2, unknown agents, non-READY/paused cluster, missing backups and offline Central | Physical multi-PC role/lease proof and Owner approved maintenance freeze/drain |
| Local inspection receipt | `apps/desktop/update-inspection-journal.cjs` node-signs one immutable `OFFLINE_INSPECTED_ONLY` record after Owner metadata, installer SHA and Windows Authenticode checks in Electron main | Hardware-backed logging, Central receipt collection and crash-safe install state transitions |
| Repeated/partial receipt | Duplicate offer checks existing node signature; partial/tampered records block rather than being replaced | Cross-device anti-replay/revocation and recovery with Owner authorization |
| Signed installer execution | NOT IMPLEMENTED and never performed | Signed update runner, secure backup of device state, rollback/health acceptance, physical PCs |

**Evidence status:** Code committed to Draft PR #1; exact-HEAD CI must pass before calling tests verified. User remains responsible for Owner-controlled Hostinger and Windows certificate credentials. [Detailed runbook](DESKTOP_MAINTENANCE_PREFLIGHT_V7.md).


## 15 November 2026 — Authoritative Owner maintenance intent (new draft milestone)

| Gate | Code delivered in Draft PR #1 | Still missing for go-live |
| --- | --- | --- |
| Fresh work/heartbeat evidence | Central signed `/v7/nodes/me` returns heartbeat age, active leases and unresolved Git jobs; Desktop refuses stale/busy/unfinished agent work | Physical Central heartbeat/workload acceptance |
| Owner intent | `v7_pc_maintenance_plans` schema, idempotent `PLAN_PC_UPDATE` / `CANCEL_PC_UPDATE`, five-minute MySQL expiry, exact node/wave/offer SHA/epoch and audit event | Owner-approved Hostinger schema migration, manual staging test |
| Owner UI | Central dashboard can record, view, cancel plans; current epoch prefilled and plan buttons disabled if API/schema is unavailable | Owner hPanel deployment and real authentication rehearsal |
| Node safety check | Signed `GET /v7/nodes/maintenance` plus node/cluster proof, rejects mismatched or stale intent and critical roles | Atomic maintenance lease/fencing and real failover test |
| Installer execution and post-update acceptance | **NOT IMPLEMENTED**; all responses explicitly `installer_execution_allowed:false` | Identity-preserving installer runner, rollback, physical Windows signoff |

[Owner maintenance-intent guide](OWNER_PC_MAINTENANCE_INTENT_V7.md). This is not production deployment or release approval.


## 15 November 2026 — Atomic task admission fence / graceful worker drain (Draft PR #1)

| Gate | Code/test coverage | Remaining external proof |
| --- | --- | --- |
| Persistent node fence | New `v7_pc_maintenance_fences` table; no automatic expiration after five-minute intent | Hostinger staging migration, real power-loss/restart tests |
| Atomic claim exclusion | Worker claim and Owner START serialize on Master/cluster MySQL row, fence checked before lease creation; available-task API refuses fenced PCs | 2/3/8–10 actual PC race/load acceptance |
| Master/backup protection | Election candidate query excludes fenced nodes; Owner START refuses any current Master or backup and requires 2 live backups | Real Windows election under network partition |
| Graceful drain | Already issued leases can checkpoint and submit; no forced revocation; new QA/agent-registration work is blocked | Real agent actions, external provider in-flight operation audit |
| Idle finalization | Owner FINALIZE requires live/idle target, no live lease or unresolved Git/unfinished ticket; fence remains | Real Owner reconciliation and no-loss acceptance |
| Explicit release | Owner CANCEL atomically releases fence and audits it; does not run installer | Approval review, physical maintenance procedure |
| Installer/rollback | NOT IMPLEMENTED; all responses remain `installer_execution_allowed:false` | Genuine signing certificate, identity backup/reinstall, rollback health telemetry |

[Owner drain-fence runbook](PC_DRAIN_FENCE_V7.md). This source is draft/unmerged; live staging and physical acceptance have **not** been performed.


## 15 November 2026 — Drain admission surface audit

Beyond worker claims and election, new QA receipts, Git reservations, change proposals and agent registration are rejected on fenced PCs. Heartbeats and existing worker checkpoint/submit remain available for graceful completion. An existing Git confirmation remains permitted to reconcile remote side effects; unfinished Git jobs block DRAINED. The Central SQL paths now follow a leader-first lock order to reduce heartbeat/task-claim deadlock risk. Disposable MySQL tests explicitly attempt forbidden admission routes; **real concurrency and external provider acceptance remain pending**.

## 21 November 2026 — Exact-envelope heartbeat and withdrawn advisory update

- [x] Central signed heartbeat requests require real positive safe-integer node/agent sequences, strictly typed nullable nonnegative Master epoch, 1–30 distinct valid agent entries and no unrecognized fields. Validation fails before MySQL updates. Source: `v7/heartbeat_validation.ts`, `v7/central.ts`, pure tests and disposable-MySQL signed-HTTP rejection tests. Commit `a62c9faf5567ca9ef324851fec3a336baac96c16`.
- [x] Previously reported `GHSA-fc5q-39xc-vjpf` `picomatch` finding was **withdrawn by GitHub on 18 November 2026** (https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Exact code-commit npm security-review job [44892226516](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/44892226516) passed **production-only**, **full root** and **Desktop** high/critical audits. Keep these independent fail-closed scans, with no advisory suppression and no forced dependency change.
- [ ] Production readiness still requires genuine Windows signing, Hostinger staging plus off-host MySQL backup/restore, physically independent Windows PCs and Owner-reviewed staged rollout, post-install and rollback acceptance. Current branch/PR remains alpha and unmerged.

## 22 November 2026 — Protected signer handoff parity (code-only)

Release workflow and production packager now share all four required distinct Owner-managed Ed25519 public trust roots; static CI tests refuse workflow omissions or accidental signer reuse. No production signing was performed. G3 remains BLOCKED until real Authenticode certificate, protected GitHub environment, immutable reviewed stable tag and independent installer evidence are supplied; G6 remains BLOCKED until physical update/rollback acceptance.

## 23 November 2026 — Independent read-only v8 migration metadata postcheck

A narrow, **read-only** operator postcheck now checks the exact reviewed manifest SHA,
v7 baseline source hash, connected staging DB name, complete `[7,8]` version history,
the non-retryable v8 migration audit STARTED/DDL_COMPLETE_UNVERIFIED pair, and the
actual nonunique `v7_nonces.idx_nonce_received_at(received_at)` index metadata.
This closes the gap where a successful DDL rehearsal alone could be confused with
independent inspection of its index. It does **not** verify stored data, index query
plan/performance, backup receipt authenticity, production compatibility or recovery.

On a trusted operator workstation with an independently provisioned **read-only**
staging MySQL login, set `DB_NAME` to the separate source DB name, set
`SUTRADHAR_STAGING_DB_NAME` to the exact dedicated staging DB,
`SUTRADHAR_STAGING_V8_POSTCHECK_APPROVED=yes`,
`SUTRADHAR_STAGING_V8_POSTCHECK_CONFIRM_DB` to the same staging name,
and `SUTRADHAR_EXPECTED_V8_MIGRATION_SHA256` to the independently reviewed
64-character migration hash. Supply `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD` through a private credentials manager and run
`npm run ops:verify-staging-v8`. A passing read-only check is a metadata
snapshot only, never a go-live or migration authorization. Do not operate it on
production. Disposable real-MySQL CI now validates an intact v8 index and rejects
a deliberately removed index; separate pure tests reject version, audit, identity
and index drift. Real Hostinger migration/restore and G0–G7 remain **HOLD**.

## 23 November 2026 — v8 independent full-baseline structural drift check

The read-only v8 postcheck now **also** checks every pinned v7 baseline table, column name/type/nullability, declared index and foreign-key relation using the existing reviewed inventory, while requiring exact schema version history `[7,8]` (never accepting v9 implicitly). The v8 nonce-age index is checked separately. A valid index plus tampered baseline table no longer produces accepted metadata. Pure tests cover missing/extra column, missing FK/index, unexpected table and unreviewed version; disposable real MySQL rehearsal now deliberately adds an unexpected column and verifies fail-closed rejection. This is **not** a data-row validation, default/collation/implicit-index review, DDL atomicity proof or Hostinger live acceptance. Owner G0–G7 remain HOLD.


## 23 November 2026 — Indexed-only nonce housekeeping safety

The 30-minute replay-nonce prune now runs only after a committed, clock-aligned
every-fifth accepted heartbeat **and** a fresh DB metadata check for the exact
`[7,8]` schema history and physical nonunique
`v7_nonces.idx_nonce_received_at(received_at)` index. Until both exist,
cleanup skips silently: no unindexed whole-table DELETE on v7; a partial v8
migration also cannot enable that path. Failures are best-effort and never
roll back an accepted signed heartbeat or enable read-side election. Pure
tests reject forged/incomplete metadata. Disposable real-MySQL integration
proves a v7 baseline and version-only v8 skip cleanup, while complete
version-plus-index v8 prunes stale nonces and keeps new replay protection.
**Operational tradeoff:** v7-only alpha installations retain stale nonce rows
until a separately reviewed staging migration; do not run v7 indefinitely at
scale. This is source/CI logic, NOT authorization for Hostinger v8 DDL, real
provider automation, production update or release.


## 23 November 2026 — Central runtime exact schema compatibility gate

Central now checks bounded, **database-authoritative** schema versions at the
start of every transactional signed API/health operation (not just in a separate
operator checker). Exactly v7 baseline or `[7,8]` is accepted; unknown/gapped
histories fail with 503 before side effects. v8 additionally requires the
physical nonunique nonce-age index plus the exact pinned migration SHA and
a completed staging-style migration audit record. A forged v8 version alone,
or a physical index without matching audit, cannot make Central report READY.
Empty DB initialization remains a separately authorized bootstrap path.
Pure unit tests pin the migration digest to the manifest, and disposable
MySQL tests assert incomplete v8 heartbeat rejection and successful v8
after index + audit, then restore v7 fixture state.

**Important evidence limit:** An existing audit record is not an independent
Owner/DBA signed approval or data-compatibility test; the runtime only checks
DB shape/claims and cannot prove full production migration. G0–G7 remain
HOLD until the real environment and independent acceptance are demonstrated.


## 23 November 2026 — Post-schema-guard election consistency fix

Initial exact-commit CI exposed a concurrency regression: opening a MySQL
REPEATABLE READ transaction before schema-version SELECT can pin an older
candidate heartbeat snapshot *before* the first serialized leader-row lock.
That can make simultaneous Backup1/Backup2 heartbeats observe inconsistent
Master selection even though the leader row itself is locked fresh. The
schema compatibility guard now performs its metadata SELECTs in autocommit,
then starts the business transaction, preserving the established leader-first
consistent-read sequence. The runtime still rejects unknown or incomplete
migration metadata before the signed action, but this is NOT a guarantee that
an operator may run live DDL concurrently; the real migration requires an
Owner-approved maintenance window and independent staging proof. Regression
tests assert this ordering; re-run exact-head real MySQL concurrency CI.


## 23 November 2026 — Size-bounded signed Central evidence before installer launch

The Windows Desktop's Owner-granted interactive installer launcher no longer
uses unbounded `Response.json()` to consume its signed Central GET evidence.
It requires an actual HTTP response stream and `application/json`, validates
content-length, and caps the received stream at **64 KiB** before parsing.
It disables HTTP caching and omits ambient credentials. Oversized/malformed
Central responses fail **before** the one-shot installer-attempt journal and
before any Windows EXE is started; the existing maintenance hold persists.
Desktop tests cover missing stream, invalid content-type/length, malformed JSON,
array body and >64-KiB response plus no-launch behavior. This is code-only CI
hardening, not physical Windows acceptance; separately bound legacy GET flows
still need review and live Hostinger evidence is unavailable.


## 23 November 2026 — Bounded Central evidence before escrow and local drain

The same streaming-only 64-KiB JSON reader now protects the signed GET
checks before (1) writing an installer escrow preparation attempt and
(2) persisting a local Owner-drained PC maintenance hold. Both paths
reject oversized/malformed Central evidence, disable network caching and
omit ambient credentials. The negative tests verify **no new escrow
attempt** and **no new local maintenance hold** after an oversized reply,
without changing any Central grant or installer execution semantics.
Further signed GET consumers remain subject to independent review.


## 23 November 2026 — Bounded readiness and cancellation evidence

Advisory PC update-readiness and signed maintenance cancellation preflight
now also use the shared 64-KiB bounded streaming JSON reader instead of
unbounded `Response.json()`. Malformed/oversized evidence is rejected,
responses are not cached and ambient credentials are omitted. Tests
assert a huge readiness response cannot produce positive advisory status
and a huge cancellation response cannot release a local maintenance hold.
These changes do NOT create a release grant, override Owner signatures,
or prove physical rollback; they reduce remote response memory risk before
Owner-controlled decisions.


## 23 November 2026 — Remaining privileged Windows signed GET response caps

Privileged maintenance flow now reuses the same reviewed 64-KiB streaming-only
Central JSON parser before **manual restart attempts**, **post-heartbeat
reconciliation**, **failed-install diagnosis**, and **Owner failure-exception
review**. Postinstall observation now delegates to that same parser rather
than maintaining an inconsistent duplicate. No code uses unbounded
`Response.json()` on those signed GET surfaces; requests disable cache and
ambient credentials, and invalid or oversize responses fail closed.
Negative tests confirm no one-shot restart receipt, no failed-install
certificate, no Owner exception receipt and no release of the previous local
hold after overlarge Central response. This is source/unsigned QA protection,
not proof of physical Windows install completion, independent Owner release
authorization, or stable production signing. G0–G7 remain HOLD.


## 23 November 2026 — Race-free encrypted archive publication

Replaced `existsSync` + `renameSync` encrypted archive publication, where
a concurrent writer could overwrite a prior valid backup, with exclusive
hard-link publish of an fsynced ciphertext temp file. Negative tests
assert immutable existing ciphertext, symlink refusal and exactly one
winner in a two-OS-process destination race. Offline backup verification
no longer requires MySQL credentials; restore refuses absent credentials and
unapproved target before decrypting any backup. Decrypted SQL Buffer is
cleared best-effort after use. This is source/CI testing only; G2 off-host,
actual Hostinger restore timing and independent Owner signoff remain HOLD.


### SQL switch guard regression assertion

The operator staging restore continues to reject `USE`,
`CREATE DATABASE` and `DROP DATABASE` directives before any MySQL
connection. New authenticated-archive regression tests explicitly check
the real whitespace-regex interpretation and fail if directives could
escape due to an accidental literal-backslash regex. This is not a
general SQL parser, and real Hostinger recovery acceptance remains open.


## 23 November 2026 — Windows enrollment GET/POST response bounds

Initial Owner-granted node enrollment and existing-node reconciliation now
use the same 64-KiB bounded streaming Central JSON reader as privileged
maintenance: oversized/malformed HTTP responses cannot produce an accepted
enrollment or promote a PREPARED receipt to SUBMITTED. HTTP requests use
`cache:no-store`, `credentials:omit`, no redirects and a timeout.
Signed duplicate-node reconciliation requires an explicit node ID, nonce and
signature header before issuing the GET. Local enrollment receipt inspection
rejects symbolic links instead of following them. New negative tests preserve
PREPARED on overlarge reply, deny incomplete signed rechecks and symlinked
receipts. This is source/CI hardening, not successful Windows DPAPI/physical
Owner approval testing; G4/G5 remain HOLD.


## 23 November 2026 — Electron ASAR missing-module recovery gate

Real source audit exposed that `bounded-central-json.cjs` had become an
actual runtime import of enrollment and maintenance modules, but was
**missing from electron-builder's explicit `build.files` list**. An
unsigned installer can still be created while the installed Electron
main process later fails to resolve the missing module.

The missing runtime file is now included. A build-only
`package-closure.cjs` verifier statically checks every literal local
CommonJS `require()` from every packaged `.cjs` module, failing if
any target is absent or any package path is unsafe/duplicate. It is
enforced by the root post-build package check, unsigned QA packager and
Owner-controlled release packager **before** electron-builder executes.
Negative tests remove a dependency from a cloned package manifest and
assert rejection. A green static closure is **not** real Windows ASAR
launch, UAC or DPAPI proof. G3/G4/G6 remain independently blocked.


## 23 November 2026 — Bounded first-run Central health check

The Electron main process formerly called unbounded `Response.json()`
for the Owner-selected Central `/v7/health` endpoint before first setup.
It now calls a separate, directly unit-tested `central-health.cjs`
reader using the same 64 KiB streaming cap as enrollment/maintenance.
It refuses malformed/oversize/HTML/streamless responses and requires
service=sutradhar-v7, ready=true, authority=mysql and exact local API
protocol. HTTPS GET cannot redirect and does not send ambient credentials
or use cached health. The new runtime module is explicitly listed in
`build.files`, and the Desktop package closure verifies that dependency.
A passing health check is a momentary claim, NOT an Owner enrollment grant,
real Hostinger deployment proof or production approval.


## 23 November 2026 — Verify actual packaged Electron ASAR contents

The previous static `package-closure.cjs` checks literal local requires
before electron-builder runs, but cannot establish that the **actual**
Windows package contains those files. New `verify-packaged-runtime.cjs`
inspects the generated `out/win-unpacked/resources/app.asar` with the
committed electron-builder dependency `@electron/asar` and checks every
explicitly listed runtime module against its source SHA-256. The
electron-builder-normalized `package.json` must retain exact app name,
main entry and version. It also checks the independently shipped
`resources/secure-agent.cjs` against the Desktop build output and
refuses Central server/schema or device identity files inside ASAR.

Both unsigned internal QA packaging and the Owner-protected Windows
release packager now **fail after packaging** if this inspection fails,
before reporting success or producing any signing verification receipt.
Pure tests simulate omitted/altered ASAR modules, changed app identity,
wrong secure-agent bytes and leaked Central/identity material. This is
build artifact integrity, NOT executing the NSIS installer, launching
Electron, testing OS vault persistence, or verifying physical Windows
code-signing: G3/G4/G6 remain pending external acceptance.


## 23 November 2026 — Immutable bounded first-run PC settings

Desktop setup's previous unbounded `desktop-settings.json` read and
unconditional rename-based config rewrite have been replaced by
`settings-store.cjs`. It validates only the exact Central HTTPS URL,
friendly PC name and agent IDs, reads at most 4 KiB, refuses symlinks,
invalid UTF-8 and unexpected secret fields, and creates the initial
settings file with a fully fsynced temp plus an atomic exclusive hard link.
Two competing OS processes cannot both publish or overwrite an existing
roster; negative tests check corruption, symlinks and duplicate IDs.
The new runtime file is included in the Windows ASAR allowlist and actual
package integrity gate. This is local config hardening, NOT a proof of
physical Windows encrypted vault acceptance or update/rollback. G4/G6 HOLD.


## 23 November 2026 — Bounded heartbeat and Master recovery replies in real Windows child

The packaged `apps/desktop/secure-agent.ts` still used unbounded
`Response.json()` for **every signed node API reply**, including registration,
heartbeat, current-node reconciliation, recovery and Master reconciliation.
The isolated child now delegates to bundled `agent-central-http.cjs`
with an exact route allowlist, 64 KiB cap on routine signed responses and
a separately bounded **512 KiB** cap on the at-most-300-event recovery
snapshot. All responses must stream valid UTF-8 JSON objects with
`application/json`; oversized declared or actual received bytes,
invalid/malformed data and unrecognized routes fail closed. Requests
explicitly refuse redirects, disable caching, omit ambient cookies and
apply the existing 15-second timeout. Only narrow machine-readable
Central error codes are allowed back into the child error path.
Negative tests cover the absence of a signed ACK on excessive JSON,
recovery size differences, malformed UTF-8 and HTML, non-streaming
responses, route/body denial, 409 duplicate ID and sanitized errors.
`secure-agent.cjs` is esbuild-bundled and remains subject to actual
ASAR external resource byte verification. This is code/CI protection,
not evidence of real 60-second heartbeats, 180-second failover or
physical Windows update/rollback. G4/G5/G6 stay HOLD.


## 23 November 2026 — Public HTTPS hostname requirement for first enrollment

Desktop setup originally accepted `https://192.168.x.y` / other IP
literal or `https://public-host:custom-port` as if it were a Hostinger
public Central. The OS-vault Owner grant enrollment path had a separate,
looser hostname validator and could POST the private one-time enrollment
grant to such a URL. `desktop-config.cjs` now validates an ASCII/punycode
DNS hostname with at least two syntactically valid labels, rejects IP
literals, local/private/reserved TLDs, malformed labels and ports other
than canonical HTTPS 443. Owner grant enrollment and immutable enrollment
receipt binding reuse this validator. Negative tests prove **no network
request** is made to rejected hosts and no PREPARED enrollment receipt
is created. Already-persisted invalid endpoints fail closed and require
an Owner-reviewed migration, never automatic identity reset.
This is only hostname *syntax* validation, **not** DNS resolution/pinning,
certificate ownership verification, public address assurance or
protection against DNS rebinding. Owner must independently establish
the genuine deployed Hostinger staging domain and manage network egress
before any real PC enrollment. G1/G4 remain HOLD.
