# SUTRADHAR v7.0 — Requirements, Acceptance Tests & Migration Matrix

**Date:** 2026-11-11  
**Status:** TEST SPECIFICATION ONLY. These V7 tests have **not** been implemented or run. Existing Git/Docker/SQLite tests do not count as Hostinger/MySQL/Electron/2-PC acceptance.  
**Source:** Owner-approved conversation requirements, [Architecture Blueprint v7](./SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md), [Agent / Task / QA / Recovery Contract](./AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), and legacy v6.0 root blueprint.

## 1. Acceptance policy

- Every row defines **one executable/fault-injection test**, expected outcome and the earliest intended milestone. A design document is not a passing test. P0 tests must pass in CI (for pure logic) and in a representative environment (for hosting, browser and Git) before any production claim.
- Classification: **SPECIFIED** (this document), **CODED**, **LOCALLY_TESTED**, **LIVE_ACCEPTED**, **BLOCKED**. As of this document, all V7 rows are SPECIFIED / NOT_RUN.
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
