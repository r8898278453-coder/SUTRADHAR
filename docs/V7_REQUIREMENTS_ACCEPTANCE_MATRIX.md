# SUTRADHAR v7.0 — Requirements, Acceptance Tests & Migration Matrix

**Date:** 2026-11-11  
**Status:** ORIGINAL 11 NOVEMBER TEST-SPEC BASELINE. A subset of these scenarios has since acquired unit/CI and disposable MySQL implementations on Draft PR #1; this document does **not** contain an audited per-case CI→physical acceptance mapping. No actual Hostinger/MySQL staging restore, production-signed Windows installer, or physical multi-PC acceptance is inferred from CI.  
**Source:** Owner-approved conversation requirements, [Architecture Blueprint v7](./SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md), [Agent / Task / QA / Recovery Contract](./AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), and legacy v6.0 root blueprint.

## 1. Acceptance policy

- Every row defines **one executable/fault-injection test**, expected outcome and the earliest intended milestone. A design document is not a passing test. P0 tests must pass in CI (for pure logic) and in a representative environment (for hosting, browser and Git) before any production claim.
- Classification: **SPECIFIED** (this original matrix), **CODED**, **LOCALLY_TESTED**, **LIVE_ACCEPTED**, **BLOCKED**. Historical baseline was SPECIFIED/NOT_RUN. For current changes consult CI evidence on the exact Draft PR head; **do not** promote any of the 71 cases to LIVE_ACCEPTED without an independently observed target environment and linked Owner-reviewed receipt.
- Never use a seeded/fake node, mocked GitHub merge, skipped Docker test or model self-report as actual deployment evidence. Keep immutable test receipts with specific Git SHA and environment.
- Prioritize real 2-PC pilot + one disposable test repository; only then scale to 8–10 PCs. Do not change protected main, rotate secrets, or deploy without explicit owner approval.

## 2. Coverage map and test cases

### A. Hostinger shared hosting / MySQL / control plane (M1)

| ID | Requirement / test setup | Expected assertion |
|---|---|---|
| V7-H01 | Deploy React + Express to owner's **existing Hostinger Business** environment using supported release/ZIP workflow | Authenticated HTTPS UI and API function through restart; no VPS/custom service dependency |
| V7-H02 | Start without database credentials / with invalid TLS or connectivity | Fail closed; no anonymous/admin fallback, no fake healthy dashboard |
| V7-H03 | Concurrent HTTP requests on multiple control process instances | Same MySQL authoritative state and atomic version transitions; no memory-only authority |
| V7-H04 | MySQL schema migration from backed-up test SQLite fixture | Verified record counts/IDs, deterministic migration, rollback path, transaction constraints intact |
| V7-H05 | Kill/restart Hostinger web process between claim and response | No lost accepted events, no duplicate task; idempotent response after restart |
| V7-H06 | Disable MySQL / Hostinger API for 10 minutes then restore | No new claims, promotions, pushes/merges during outage; local sealed work not falsely marked complete; read/reconcile on recovery |
| V7-H07 | Run 10 machines x multiple agents heartbeat/poll load test with real plan limits | No unbounded background workers/WebSockets; observed HTTP/DB/memory budget within configured limits |
| V7-H08 | Restore encrypted MySQL backup to disposable DB and replay verified event snapshot | Exact project/leader/ticket checkpoint restoration with owner-visible timestamp and no secret leak |
| V7-H09 | Deliver Telegram webhook twice and same Owner web command concurrently | One command ledger effect, one audit receipt, same state visible from both interfaces |

### B. Enrollment, IDs, heartbeat and leadership (M2)

| ID | Requirement / test setup | Expected assertion |
|---|---|---|
| V7-N01 | Install Electron on two PCs, enroll with name/general location | Durable distinct random node IDs, unique agent IDs, owner approval and no exposed private keys |
| V7-N02 | Clone installed image/identity directory onto different PC | Identity collision rejected; explicit recovery/re-enrollment required |
| V7-N03 | Register 3 logical agents on one physical machine | All agents distinct; leader/backups are not falsely presented as 3 independent failover hosts |
| V7-N04 | Each active agent sends signed heartbeat every 60s; send out-of-order/forged sequence | Correct server last-seen and suspicion, stale/forged events denied |
| V7-N05 | Drop 1, then 3 accepted heartbeat periods | Single missed heartbeat does not force invalid takeover; after ~180s lease-based transition eligible, bounded by server processing |
| V7-E01 | Two eligible nodes first connect concurrently at 08:00 IST | Exactly one MASTER elected with server-ordered deterministic winner; single epoch increment |
| V7-E02 | At 08:05 and 08:06 new distinct eligible nodes join | Persistent ranked Backup 1 and Backup 2; backups retain Developer permissions only |
| V7-E03 | Keep active Master healthy for 3 days across successive 08:00 boundaries | No daily reset/election; current tenure and cumulative duration correct |
| V7-E04 | Master abruptly disconnects at 17:00 with active worker task on Backup 1 | On authoritative lease expiry Backup 1 becomes unique Master with new epoch; coding checkpoint saved/reassigned |
| V7-E05 | Partition old Master, then reconnect after promotion | Old epoch cannot create ticket, authorize change, renew leadership, push restricted code or merge |
| V7-E06 | Backup 1 and Master unavailable; Backup 2 healthy | Backup 2 promoted exactly once; backup rank refilled when another eligible distinct machine arrives |
| V7-E07 | No workers online except Master | Master takes normal scoped Developer lease; remains able to handle urgent Master command via checkpoint/preemption |
| V7-E08 | All nodes offline / central API down before initial 08:00 | NO_MASTER (not simulated); no client self-election; initial bootstrap respects policy and later failover is not tied to 08:00 |
| V7-E09 | One node stays online but claimed task lease has expired | Healthy heartbeat does not extend invalid task lease or allow stale branch publication |

### C. Master project intelligence and task creation (M3)

| ID | Requirement / test setup | Expected assertion |
|---|---|---|
| V7-P01 | Select existing project with same display name as another project | Immutable project ID + repo/account mapping disambiguates; wrong project never loaded |
| V7-P02 | Request new project identical to active project | Existing match detected or explicit duplicate decision; no silent second repo |
| V7-P03 | Request new unique project with owner approval | Project/repo/CI/template baseline and provider mapping proposal, no credentials written to Git |
| V7-T01 | Owner asks for multi-layer feature | Master creates small testable task DAG with architecture, boundaries, contracts, dependencies and acceptance criteria |
| V7-T02 | Master creates same request twice / duplicate webhook | Same idempotent plan/ticket IDs or explicit duplicate proposal; no duplicate claimable work |
| V7-T03 | Unknown payment provider/security requirement | Master creates clarification, no assumed high-risk implementation |
| V7-T04 | Two tasks write same file or nested directory | One claim/reservation blocked or serialized before any unapproved write |
| V7-T05 | Two tasks write distinct files but same database/API contract | Semantic contract reservation detects integration hazard, no unsafe parallel release |
| V7-T06 | Task depends on unverified upstream ticket | Cannot claim until required upstream accepted state/proof |
| V7-T07 | Master changes task allowed paths after worker claim | Old worker lease/version cannot use expanded scope; new proposal/approval required |
| V7-T08 | Master lease expires mid-task-generation transaction | No accepted ticket from stale epoch; successor reads prior committed state |

### D. Electron/browser AI work, tokens and handoff (M4)

| ID | Requirement / test setup | Expected assertion |
|---|---|---|
| V7-B01 | Open provider webpage in Electron remote renderer | No Node integration, sandbox on, context isolation, restricted IPC/navigation and browser session partition |
| V7-B02 | Webpage attempts shell/filesystem/Git credential/DB access through renderer | Denied; no raw IPC or secrets exposed |
| V7-B03 | Google OAuth rejects embedded browser | Safe external/system-browser sign-in or BLOCKED_PROVIDER; no security bypass |
| V7-B04 | ChatGPT Web automation not permitted or output retrieval unsupported | Disable unattended extraction; user-authorized assisted/supported path only; no false success |
| V7-B05 | Create provider project after search with duplicate display names | Use verified provider/account/project mapping, not title alone; permission-gated creation |
| V7-B06 | Worker starts second chat under same provider project after context exhaustion | Verified compact checkpoint + exact Git SHA transmitted only if provider permits and session is allowed |
| V7-B07 | Provider limit persists in new session / session expired | BLOCKED_PROVIDER or authorized alternate; no circumvention or unbounded chat creation |
| V7-B08 | Prompt composer injects project secrets or full irrelevant repo | Secret redaction and context budget reject unsafe payload; audited refusal |
| V7-B09 | Repeat same debugging cycle on same base/errors | Content-hash dedupe, deterministic local checks and bounded prompt retries; no redundant unlimited requests |
| V7-B10 | Electron agent killed after AI suggestion but before local patch application | No VERIFIED commit; handoff reflects suggestion only, not completed implementation |

### E. Git security, QA, independent review and release (M5)

| ID | Requirement / test setup | Expected assertion |
|---|---|---|
| V7-G01 | Worker receives web-generated patch with extra protected file, symlink, mode change or path traversal | Patch rejected before mutation; explicit scoped proposal logged |
| V7-G02 | Two workers commit on independent ticket branches from same base | Both branches retained; combined integration safe or explicitly conflict/blocked; no lost updates |
| V7-G03 | Worker pushes exact Docker-tested tree to new branch, receives timeout | Read-only remote proof recovers exact SHA or marks uncertainty; no blind second push |
| V7-G04 | PR creation times out after GitHub accepted it | Unique remote draft PR recovered via read-only inspector; no duplicate PR |
| V7-G05 | Wrong commit/head/base, modified main, missing required CI or review | No VERIFIED_MERGED/DONE; Owner-visible blocked status |
| V7-G06 | Protected/core file proposal written but not authorized | No code apply or Git push, regardless of AI/Master wording |
| V7-Q01 | AI claims tests passed while Docker exits nonzero | FAILED/TEST_FAILED; no review-ready receipt |
| V7-Q02 | Developer writes only trivial happy-path tests, omits required negative case | Independent QA contract catches missing case; cannot mark accepted |
| V7-Q03 | Unit tests pass separately but two branches break combined API | Integration QA fails; no protected merge |
| V7-Q04 | Hybrid Master authored high-risk change and self-approves | Approval denied until Owner/independent reviewer; deterministic tests still required |
| V7-Q05 | UI feature passes unit tests but not actual browser flow | UI QA evidence missing -> REVIEW_REQUIRED/BLOCKED, no DONE |
| V7-Q06 | Test runner identity, command hash or tree SHA differs from pushed commit | Receipt invalid; rerun trusted suite on exact tree |
| V7-Q07 | Rollback requested / draft rollback PR created, no approved remote merge | ROLLBACK_REQUESTED only; never ROLLBACK_COMPLETED |
| V7-R01 | Real protected GitHub PR reviewed/merged in disposable target repo | Exact remote head/tree/approvals/CI independently read, then DONE; no direct-main write |
| V7-R02 | Full release deployed to disposable target and health checks fail | Release not marked verified; rollback path/approval triggered with evidence |

### F. Operational recovery, security and owner controls (M5–M6)

| ID | Requirement / test setup | Expected assertion |
|---|---|---|
| V7-O01 | Master crash after persisting 12 tasks with mixed statuses | Successor sees exactly 12 original tasks, same dependencies, Git receipts, decisions and next actions |
| V7-O02 | Worker crash after saving checkpoint; different worker resumes | New worker independently verifies source SHA/tree and lease; no private browser session transfer |
| V7-O03 | Timeout after remote Git/PR side effect with mismatched remote receipt | RECONCILIATION_REQUIRED; no new side effect, manual escalation |
| V7-O04 | Telegram unauthorized user attempts pause/approve/force master | Rejected, redacted audited failure, no shared-state mutation |
| V7-O05 | Website and Telegram issue concurrent same priority change | Version/CAS controls ordering; both display authoritative final outcome |
| V7-O06 | Revoke a node or leaked signer/token during running task | Old signatures/leases blocked, pending tasks safely returned/reconciled; no secret in logs |
| V7-O07 | Kill-switch during coding, Git push or rollout | Checkpoint/local work preserved; server refuses new remote mutations and marks pending appropriately |
| V7-O08 | Electron workers run different protocol versions after update | Incompatible writes rejected; signed update and rollback path tested |
| V7-O09 | Two workers from separate projects accidentally reuse provider chat/workspace | Project/account ACL and context isolation block cross-project access |
| V7-O10 | Stress 8–10 physical machines with mixed capacities, two backups, 20+ logical agents | Single Master, stable quota/capacity scheduling, bounded MySQL/HTTP load and no duplicate/lost tasks |
| V7-O11 | Attempt documented but unauthorized core, schema or credential change | Denied pending Owner authorization, independent reviewer and verified tests |
| V7-O12 | Show production dashboard while seed fixtures exist | No false live stats; demo mode labeled and isolated from real owner commands |

## 3. Canonical role boundaries and pre-merge gates

| Role / approval | Delivery responsibility | Required evidence |
|---|---|---|
| Master/Architect | Project choice, duplicate check, plan, scoped task/test contract | Plan hash, approved assumptions, dependency DAG |
| Worker Developer | Permitted provider workflow, isolated patch, local QA, checkpoint, submission | Exact tested tree SHA, lease/epoch, changed-file manifest |
| Independent QA | Negative/unit/integration/security/UI evidence as required | Test receipt with runner, commands, exit, tree |
| Git Integrator | Combined integration, merge conflict handling, draft PR, remote review proof | Exact integrated SHA, combined QA, PR/review/check status |
| Owner | Protected schema/core/release approvals; Telegram/web controls | Authenticated command receipt, policy grant, audit |
| Watchdog/Recovery | Expired leases, uncertain operations, safe read-only inspection | Reconciled remote result, fencing and event version |

**Required before a ticket becomes DONE:** current project and ticket identity; valid scope/version; exact Git/code acceptance evidence where applicable; required independent QA; verified integration/remote review; Owner policy for sensitive changes; durable audit event. **Required before calling a deployed release READY:** tested artifact hash, deployment environment, observed smoke tests and rollback readiness.

## 4. Existing-code-to-target mapping (avoid duplicate authorities)

| Legacy current component | Reuse/retire decision for v7 |
|---|---|
| server.ts Express auth/HTTP handlers | Retain safe auth ideas; refactor to stateless Hostinger-compatible commands |
| server_db.ts node:sqlite | Replace production authority with MySQL InnoDB migrations and adapters; preserve provenance constraints |
| core/leader_election.py & Node election logic | One DB-fenced Election Service, not dual active leaders |
| core/llm_router.py Gemini/OpenRouter | Optional future adapter, not mandatory for browser-first worker requirement |
| core/worker_agent.py | Refactor role lifecycle into Electron local runtime; keep only verified safe Git/operator logic |
| sandbox/execute_ticket.py | Run on worker PCs with real Docker; never on Hostinger shared hosting |
| sandbox/push_tested_branch.py & reconciliation | Reuse guarded exact-tree and durable uncertainty principles; port storage safely |
| github_pr_creator.ts / verifier / rollback reconciler | Keep off-by-default remote write and read-only proof/rollback gates |
| src/App.tsx in-memory demo and fallback state | Separate explicit demo environment; real owner dashboard reads MySQL only |
| core/telegram_hub.py & server.ts Telegram paths | One authorized webhook Command Service, not separate state authority |
| package.json lack of Electron | Dedicated desktop build, reproducible pinned dependencies and signed releases needed |

## 5. Open decisions and blocked assumptions — must be resolved via evidence

1. **Browser automation permissions and capabilities:** ChatGPT Web unattended output extraction cannot be presumed permissible; Google sign-in may disallow embedded user-agent. Build per-provider capability table (SUPPORTED / ASSISTED / BLOCKED) after authorized proof-of-concept and current terms verification. No silent fallback to scraping or rate-limit circumvention.
2. **Hostinger Business runtime:** Live deployed test must verify supported Node version, process restarts, cron restrictions, local MySQL credentials/TLS, resource caps and webhook ingress. No VPS or infinite-process assumptions.
3. **8 AM policy edge case:** An initial *brand-new* cluster remains without Master before 08:00 IST; an established cluster can promote a backup **at any time** upon an expired lease. Owner override must be explicitly authorized and audited.
4. **Git repository topology:** Central SUTRADHAR source and project code can be in separate repos; if Owner chooses monorepo for all projects, additional strong project prefix/ACL tests and cross-project isolation gates apply. **Git is never central live DB.**
5. **Independent review:** If all other agents offline, hybrid Master may code and run deterministic QA, but protected changes wait for Owner/independent Git review; review cannot be bypassed merely to mark feature complete.
6. **Private identity data in Git:** Node IDs/names/general location may be exported only as explicitly authorized, sanitized non-secret manifests; current private MySQL identity registry remains authoritative, not Git.
7. **Provider accounts and quotas:** Web subscription does not grant unlimited automation, capacity or token-free output. Budget measurements must be grounded in actual allowed plans.
8. **No rollout without owner:** Credentials, Hostinger deployment, GitHub branch rules, live push/review/merge, signer rotation and protected main remain Owner-controlled.

## 6. Gate and milestone checklist

- **M1 exit:** V7-H01..H09. Hostinger/HTTPS/MySQL/web/Telegram two-interface truth proven.
- **M2 exit:** V7-N01..N05, V7-E01..E09. Two real PCs, unique IDs, valid Master/backup failover and epoch fencing proven.
- **M3 exit:** V7-P01..P03, V7-T01..T08. Master task intelligence and safe dependency/scoping contract proven.
- **M4 exit:** V7-B01..B10. Electron isolation, provider capability, checkpoint, continuation, local Git integration proof (unsupported provider automation remains BLOCKED).
- **M5 exit:** V7-G01..G06, V7-Q01..Q07, V7-R01..R02, V7-O01..O03. Real remote GitHub/QA/recovery acceptance.
- **M6 exit:** V7-O04..O12, full Hostinger stress/restart, 8–10 PC tests and Owner approvals.

**Done for this documentation slice:** three design documents committed to the existing fix branch. **Not done:** executing these V7 tests, migration, Electron implementation, Hostinger deployment, Master election across real PCs, browser provider acceptance, live protected merge, or production release.


### 24 November — Telegram source acceptance scope

V7-H09 and V7-O04 now have disposable MySQL HTTP fixtures: duplicate Telegram update plus concurrent web PAUSE produces one cluster state transition (separate command receipts for distinct channel requests); replay of the same update produces one durable Telegram receipt. Unauthorized and unrecognized commands cannot alter cluster state, and STATUS does not elect a Master. V7-O05 priority-change parity and real Telegram delivery/credential acceptance are still open. Sensitive approvals remain web-only. CI fixtures are not a live Telegram acceptance record.


## 24 November 2026 — Incremental requirements-to-source evidence (not live acceptance)

Verified baseline `3465af4`: [application workflow](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985550) and [dependency workflow](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985559) completed successfully. The following is a scoped cross-reference, not a complete per-case audit or promotion of the original 71 tests.

| Requirement IDs | Source evidence / regression location | Remaining target acceptance |
|---|---|---|
| V7-T02, T04, T06, T07, O11 | `tests/v7_mysql_integration.test.ts`: duplicate plan/branch, overlap, dependencies, invalid criteria and approvals | Full autonomous planning, semantic reservations (T05), protected reviewer |
| V7-P01, B05, O09 | `tests/v7_rules.test.ts`, `tests/desktop_worker_inspection.test.cjs`, MySQL detail access: declared binding isolation | Durable registry, live account/workspace verification and cross-project provider isolation |
| V7-B06, B08, B09 | Compact context byte budget, digest, deduplication, malformed Unicode and local metadata separation | Provider-permitted continuation, actual tokens/quota, secret prevention and measured retry budget |
| V7-E05, E09, O02, O06 | MySQL project revocation/regrant, stale lease denial and evidence retention | Physical interruption/revocation and real signer rotation |
| V7-O01, O03 | `tests/v7_recovery_validation.test.ts` plus signed MySQL recovery/independent Central checks | Physical successor recovery, exact worktree and remote receipts |
| V7-O02, B10, Q06 | NEW `ee2e62f` / `8684dfe`: reclaim cannot submit based solely on historical checkpoint; fresh generation and malformed Unicode tests | CODED / CI PENDING; physical recovery and independently tested candidate |

G0–G7 HOLD. No test row has been promoted to LIVE_ACCEPTED; all 71 original scenarios and their independent receipt requirements remain unchanged.


## Incremental V7-T05 source coverage — declared shared contract reservations

Verified previous baseline `93993a0`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700768) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700737) both SUCCESS, including the fresh-checkpoint change. The new shared-contract implementation and regressions are CODED / CI PENDING at this update.

| Requirement | Added evidence | Remaining proof |
|---|---|---|
| V7-T05, T04 | `tests/v7_rules.test.ts` canonical keys and hierarchy; `tests/v7_mysql_integration.test.ts` distinct-file and cross-base shared API conflict, disjoint admission, no reservation on refusal | Run new exact-head CI; independent semantic declaration review, automatic discovery and live combined integration |
| V7-O11 | Nonempty LOW-risk declaration remains WAITING_AUTHORIZATION; explicit Owner review before claim | Real independent Owner review |
| V7-O02, O06 | Revoked contract holder retains reservation until Owner reconciliation; competing claim denied until release | Physical recovery and external side-effect proof |
| V7-B06, B08 | `tests/desktop_worker_inspection.test.cjs`: declared keys preserved in bounded preview; malformed metadata rejected | Actual provider permission, token usage, secret review |

Previous fresh-checkpoint regressions are verified in source CI at 93993a0. The 71 original scenario definitions are retained, with no promotion to LIVE_ACCEPTED.


## Incremental provider registry coverage

Last fully green source baseline `93993a0`; shared-contract HEAD `01ff1ce` dependency CI succeeded but application CI was cancelled. New provider-registry source is CODED / CI PENDING; verify the latest exact-head workflow results.

| Requirement | Added source evidence | Still required |
|---|---|---|
| V7-P01, B05, O09 | tests/v7_rules.test.ts canonical digest/version and invalid aliases; tests/v7_mysql_integration.test.ts exact grant denial, non-owner read denial and scoped task detail | Real provider identity and permitted cross-project isolation |
| V7-P03, T02, O06, O11 | MySQL replacement CAS, concurrent identical receipt, concurrent different requests, stale version refusal, explicit empty snapshot and no legacy fallback | Owner editor, real revocation/restore and physical acceptance |
| V7-B06, B08, B09 | tests/desktop_worker_inspection.test.cjs registry provenance outside prompt and invalid version rejection | Live authorized provider, actual tokens/quota and secret review |

All new source evidence awaits exact-head CI. Original 71 scenarios retained; no LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Incremental Owner registry editor regression coverage

Verified previous source baseline `215e5ee`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116654) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116645) both SUCCESS. New Owner registry editor is CODED / CI PENDING at this update.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-P01, B05, O09 | tests/v7_owner_dashboard_session.test.cjs: explicit registry load, local-only alias draft, full-list confirmation, invalid response/alias refusal | Real browser operation, actual provider identity and permitted workspace isolation |
| V7-P03, T02, O06, O11 | One-shot expected-version POST, duplicate click suppression, empty replacement consent, current version/digest/list readback, newer revision hold | Real Owner usability and revocation/restore test |
| V7-B06, B08, B09 | Stale GET/POST responses after Owner logout ignored; no additional provider action | Live permission, physical assisted continuation, measured quota/tokens |

New source awaits exact-head CI. Original 71 acceptance scenario definitions remain unchanged; no LIVE_ACCEPTED promotion or production gate change.


## Incremental provider interruption coverage

Verified previous baseline `e935cef`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765773) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765743) both SUCCESS. New manual attempt source is CODED / CI PENDING at this update.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-B05, B06, B08, B09 | tests/v7_rules.test.ts exact attempt shape; tests/desktop_worker_inspection.test.cjs unresolved hold and metadata outside compact prompt | Real provider account/workspace permission, exact transmitted bytes and actual token/quota measurement |
| V7-O02, O03, O06, Q06 | tests/v7_mysql_integration.test.ts live lease, registry version, duplicate BEGIN, interrupted submit hold, newer checkpoint closure, revoked-lease Owner review before requeue | Physical interrupted PC/provider session and verified external effects |
| V7-O09, O11 | Owner authenticated attempt observation and explicit review; no automatic reassignment | Owner dashboard and packaged Desktop usability, independent live acceptance |

Source regressions await exact-head CI. Original 71 acceptance scenario definitions remain unchanged, no LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Incremental Owner interruption review coverage

Previous HEAD `82e2a8c` failed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188656) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188901) on TS18049 strict-null diagnostics; disposable MySQL integration and unsigned Windows smoke passed. Explicit return guards (`4d05bde`) correct the reported paths; combined CI verification of the fix and new UI remains pending. Last fully green baseline `e935cef`.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-O02, O03, O06 | MySQL fixture: live lease not eligible, revoked exact lease eligible, closed attempt no longer eligible | Actual original PC/provider and independent Owner review |
| V7-O09, O11 | Dashboard VM regression: exact ticket/attempt, three attestations, one closure POST, current readback, ineligible/malformed refusal, uncertainty and logout | Real-browser/Hostinger Owner usability and physical interruption |
| V7-B05, B06, B08, B09 | No actual provider permission, prompt or quota claim; local evidence only | Packaged Desktop mutation, transmitted context verification, live permitted recovery and measured usage |

No change to the original 71 scenario definitions; no LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Consolidated Desktop provider attempt regression coverage

Verified exact baseline `1193b3b`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215514) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215696) both SUCCESS. New consolidated Desktop/provider admission batch is CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-B05, B06, B08, B09 | Desktop main recomputes compact digest; exact reviewed mapping revision/binding, task version, separate context-only field; signed fixture rejects stale context | Actual provider permission and transmitted bytes; measured provider tokens/quota |
| V7-O02, O03, O06 | Original lease echo, trusted Git worktree, native review, main-only signer, fresh checkpoint and uncertain response hold | Physical original-PC interruption, external effects and independent recovery review |
| V7-O09, O11 | Non-developer BEGIN/INTERRUPT/CLOSE controls, verified current readback; existing Owner closure UI CI passed | Real Windows/Hostinger usability and approved provider continuity |
| V7-P03, T02 | Disposable MySQL fixture for stale expected_task_version rejection, coordinated client/signer admission | Exact-head CI and independent acceptance |

Original 71 acceptance scenarios retained; no LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Consolidated Master batch planning regression coverage

Previous exact HEAD `8145c64`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963696) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963719) were cancelled. Before cancellation the real MySQL and Python/shell/state jobs passed, while the TypeScript/unit/build job failed at Desktop security validation: obsolete static regex expected a ternary that had been replaced by the reviewed-context guard. Test correction `b4ec4ae` preserves the security assertions. Last fully green combined baseline `1193b3b`. New planner and correction are CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-T01, T04, T05 | Deterministic explicit task DAG; reject duplicate/cyclic/aliased nodes and unordered declared path or contract conflict | Autonomous task decomposition, actual code-level semantic discovery, combined QA |
| V7-T02, O01 | Signed preview digest, atomic MySQL batch/approval/edge/event/receipt admission, concurrent identical replay, late collision rollback | Physical Master crash and successor recovery of committed batch |
| V7-T06, T08 | Exact existing dependency/project and DONE claim gate; current Master epoch and final DB-clock lease recheck | Physical failover and expiry-at-commit acceptance |
| V7-T03, Q02, Q03, O11 | Explicit bounded declarations, existing criteria and protected Owner approvals retained; no baseline proof or automatic execution | Unknown requirement clarification, negative/combined tests, actual baseline proof, independent approval |
| V7-B05, B06 | Prior Desktop static assertion corrected to check main-process reviewed context guard | Combined exact-head CI, physical provider/Windows acceptance |

Original 71 scenarios unchanged. No LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Desktop Master planning and receipt regression coverage

Exact baseline `804726e` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312420) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312581), including previous Desktop correction and Master batch admission. New Desktop Master planner and receipt lookup are CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-T01, T04, T05 | Desktop no-code task draft, signed preview, pinned reviewed payload and native confirmation | Actual autonomous task decomposition/source semantic analysis and physical usability |
| V7-T02, O01, O03 | Signed historical batch receipt lookup, exact actor/project/request/digest, mismatch/uncertain response and foreign actor regression | Physical restart/crash and Owner/successor recovery when original signer unavailable |
| V7-T08, O06, O07 | Exact Master eligibility, node binding and drain fencing; final local guard | Physical failover/maintenance and expiry acceptance |
| V7-Q02, Q03, O11 | Declared criteria and existing separate Owner approval retained; no execution or baseline proof | Independent actual baseline and combined integration QA |

Original 71 scenarios unchanged. No LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Master reviewed admission journal and catalog regression coverage

Exact baseline `0fc7c7a` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325287) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325508), including the previous Desktop Master planner and historical receipt lookup. New project catalog and admission journal changes are CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-P01, T01 | Signed minimal current-Master catalog and exact ID/name/repo/base selection; no baseline claim | Physical operator usability, actual baseline and project creation approval |
| V7-T02, O01, O03 | Encrypted append-only reviewed intent before POST, restart fixture, one unresolved intent, exact receipt closure, corrupt/mismatched evidence refused | Actual Windows DPAPI/power-cut, missing-receipt/Owner successor reconciliation and retention |
| V7-T08, O06, O07 | Current Master catalog and exact local identity/fence guards | Actual demotion/maintenance and physical failover |
| V7-Q02, Q03, O11 | Existing declared criteria and approvals unchanged, no execution grant | Autonomous source discovery, actual baseline proof and combined independent QA |

Original 71 scenarios unchanged. No LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Interrupted Master admission reconciliation coverage

Exact baseline `85ae5a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705079) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705150), including encrypted Master admission journal and signed project catalog. New Owner reconciliation batch is CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-T02, O01, O03 | Exact original receipt and ticket conflict inspection; permanent original actor/request cancellation; identical Owner replay and delayed admission/preview refusal | Actual cancellation/admission race, crash, restore, original signer unavailable recovery |
| V7-O06, O07, O11 | Web-only independent Owner review, exact session-bound consent/readback, no deletion or execution | Actual physical operator and Owner approval/revocation acceptance |
| V7-T08 | Shared leader lock with batch admission; no new ticket on cancellation | Physical takeover and partition acceptance |
| V7-O02 | Distinct encrypted local cancellation closure with exact ordered IDs | Physical DPAPI/power-cut and retention |

Original 71 scenarios unchanged; no LIVE_ACCEPTED promotion. Cancellation is a permanent deny marker for the exact original actor/request key, not proof of historical non-admission after database loss/restore. Owner must independently compare original local journal, ordered IDs, preview digest, database history and uncertain effects; server checks the current durable ledger and listed ticket IDs, not the full original task manifest. A wrong cancellation declaration is not automatically corrected. No existing tickets are deleted, no replacement work authorized, and an unavailable/revoked original signer cannot automatically release its local journal. Retention and physical DPAPI/power-cut acceptance remain open. G0–G7 HOLD.

## Local Git baseline preflight coverage

Exact baseline `a77d3a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558734) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558666), including previous Owner admission reconciliation. New local baseline and exact project lookup changes are CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-P01, T01 | Exact active project lookup independent of catalog cap; native trusted repository root and exact origin/ref checks | Physical operator acceptance and independent remote baseline verification |
| V7-T06, T08 | Same local baseline across Desktop batch, epoch/project/ref recheck, internal dependency warning | Actual upstream merge inclusion and physical failover |
| V7-Q02, Q03, Q06 | Local immutable commit/tree observation, unchanged HEAD/worktree fixture, mismatch denial | Actual source analysis, independent combined QA and live Git proof |
| V7-O06, O07 | Fixed signer, exact identity, maintenance and session fences | Physical Windows/maintenance acceptance |

Original 71 scenarios unchanged; no LIVE_ACCEPTED promotion. Local verification observes the configured repository origin, local remote-tracking ref, commit and tree only. It is not live GitHub freshness, an independent remote attestation, source-level semantic analysis, or proof that upstream changes are included. Desktop batches now require every task to use the same inspected tracking-ref SHA; if a dependent task needs not-yet-merged code, plan it separately after upstream merge and review. Central and CLI planning contracts remain unchanged except for the additional signed project lookup; no baseline evidence is persisted in Central or the admission journal beyond the task's existing baseline SHA. G0–G7 HOLD.

## Unconfirmed draft and local source hint coverage

Exact baseline `6c996cb` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717874) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717690), including the Desktop Git baseline preflight. New encrypted unconfirmed draft and bounded source-hint changes are CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-T01, T06 | Bounded scoped immutable relative-import hints; cross-task and shared path review | Complete AST/contract analysis and automatic decomposition |
| V7-T02, O01, O03 | Explicit encrypted unconfirmed snapshot CAS/restore and pending admission priority | Physical DPAPI/power-cut, interrupted snapshot resolution and autosave |
| V7-Q02, Q03, Q06 | Local immutable blobs and dirty worktree isolation; large blob/invalid scope/ref mismatch fixtures | Independent live remote/upstream proof and combined QA |
| V7-O06, O07 | Main-only fixed IPC, exact local identity and existing operator fences | Physical Windows/maintenance acceptance |

Original 71 scenarios unchanged; no LIVE_ACCEPTED promotion. Explicit save only; no autosave. The latest saved unconfirmed snapshot per node/Central/agent is encrypted, CAS-revisioned, and bounded to 60,000 UTF-8 JSON bytes and 65,536 encrypted bytes. A pending admission journal blocks draft save/restore. Restoring an unconfirmed snapshot never restores baseline observation, reviewed preview, Owner consent, or admission/execution authority. An interrupted/corrupt draft write remains a local Owner-review hold. Saved task content may contain sensitive material; do not enter credentials or provider secrets. Physical Windows DPAPI/power-cut and retention/recovery of corrupt snapshots remain open. Source hints are lexical, not an AST or complete dependency graph: inspect immutable Git tree/blob objects for scoped JS/TS-family regular files, at most 12 files, 16 KiB per blob, 1 MiB tree listing and 40 hints. Relative static/literal imports only; comments/strings may cause false positives, package aliases, generated code, other languages, dynamic paths and unscanned files may cause false negatives. Only paths, task IDs, counts and commit/tree IDs are returned; no source content, provider send, automatic dependency insertion, task creation or Git mutation. The report does not prove semantic independence, upstream inclusion or remote freshness; no measured provider token reduction is claimed. G0–G7 HOLD.

## Advisory planning and compact context coverage

Exact baseline `babd15b` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449293) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449341). Encrypted unconfirmed draft storage and lexical source hints are source-CI verified. New advisory graph, fair sampling and compact context changes are CODED / EXACT-HEAD CI PENDING.

| Requirement | New source evidence | Still required |
|---|---|---|
| V7-T01, T06, T08 | Declared DAG waves, conflict review groups, transitive order, external dependency warning | Automatic decomposition, AST/semantic proof, actual worker availability and upstream merge |
| V7-Q02, Q03, Q06 | Fair bounded immutable source sampling and per-task coverage | Complete dependency analysis and combined independent QA |
| V7-O06, O07 | Fixed IPC and baseline/epoch rechecks, pending journal hold | Physical Windows and maintenance acceptance |
| Context minimization | Lossless common baseline hoisting, actual UTF-8 byte/digest check, cap refusal | Actual measured provider tokens/quota and permission |

Original 71 scenarios unchanged; no LIVE_ACCEPTED promotion. Declared dependency waves are a topological view of internal declared edges only, not dispatch waves. External dependencies remain unverified, unordered path/contract conflicts require review, and connected review groups are not a safe parallel execution guarantee. Source hints remain bounded lexical evidence, not AST or semantic proof; round-robin sampling improves task coverage but does not guarantee complete coverage. No task decomposition, automatic edge insertion, claim, Git mutation or provider action is authorized. Explicit local compact planning preview hoists one shared baseline SHA and retains all exact task strings, order, scope, risk, contracts, dependencies and criteria. It reports exact UTF-8 bytes, difference versus expanded compact JSON and SHA-256; cap 16,384 bytes, fail closed rather than truncate. No token count or actual provider savings verified, no secret scan, no automatic transmission. Independent secret review is required before any manual sharing. Draft/review changes invalidate the displayed preview. Existing signed Central admission, approval, dependency and worker reservations remain authoritative. G0–G7 HOLD.
