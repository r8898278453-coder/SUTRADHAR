# SUTRADHAR — Architecture Blueprint v7.0

**Date:** 2026-11-11  
**Status:** TARGET DESIGN BASELINE / PARTIAL ALPHA SOURCE IMPLEMENTED / NOT PRODUCTION READY  
**Scope:** The owner's consolidated requirements from the architecture discussions. This document supersedes v6.0 **as a target design**, not as a claim that the existing code works accordingly. The legacy root file **Project Blue Print.txt** remains preserved for historical context.  
**Companion contracts:** [Agent, Task, QA and Recovery Contract](./AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md) and [Acceptance / Traceability Matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md).  
**Original 11 November code status:** legacy SQLite, in-memory/demo views and partial Git/LLM flows. The current v7 alpha uses MySQL as the sole authority for new Central routes and separate Central/Desktop builds; legacy code remains isolated from the intended deployment. See the current source progress below.

## 1. Non-negotiable product requirements

- Deploy the **central web dashboard, HTTPS control API, and Telegram webhook** on the owner's *existing Hostinger Business shared web hosting*, using the owner's **Hostinger MySQL**. **No VPS or new paid always-on service is a dependency.**
- Deploy Electron-based SUTRADHAR agents on **8–10 owner-controlled computers**; each computer may host multiple logically distinct agents, subject to measured capacity. The PCs perform actual AI work, local Git, and Docker; Hostinger never executes agent coding tasks.
- All nodes join one logically shared cluster, register persistent **node IDs**, and declare owner-provided **machine name and general location**. Every agent has a separate **agent ID**; a machine is not an agent.
- All eligible agents send **one 60-second heartbeat** (may be consolidated by node). Server-authoritative state distinguishes online/offline machine, agent, task, engine, and leadership health.
- **One Active Master + up to two ranked Backup Masters.** Initially, **after 08:00 Asia/Kolkata**, the first *server-accepted eligible* candidate wins; second/third eligible candidates become backups in arrival order, preferably on distinct physical nodes. Healthy existing Master remains Master over day boundaries: **no daily re-election at 08:00**.
- Failover occurs on the expiry of a server-verifiable lease, including outside the 08:00 initial bootstrap window. Never allow two accepted Masters to issue mutations; strictly fence stale epochs. If no eligible agents exist, display **NO_MASTER**, not a fabricated leader. Ranking is persisted and can fill vacancies.
- The Master plans, prioritizes projects, creates conflict-aware implementation tickets, manages review/integration, and **also acts as a Developer when no other worker is available**. Backups can work as Developers while on standby, then safely checkpoint and assume leadership if needed.
- Master and every agent write all *material, versioned* decisions and checkpoints to the central service; a successor Master recovers project, ticket, Git, test, and next-step context from MySQL. A live Electron/browser session is **not** transferable by copying database rows.
- Owner manages the same cluster from **authenticated website and Telegram controls**; both call **one command service** and consult one MySQL source of truth. Telegram is never election authority.
- AI Workers are **browser-first** via Electron-controlled authorized ChatGPT Web/Projects and Google AI Studio web workspaces, **without requiring model APIs**. Providers are not assumed to support programmatic output extraction or embedded login. Unsupported workflows fail closed to a documented, user-authorized assisted path; never bypass provider login, account, rate-limit, or automation restrictions.
- Workers discover provider-side projects using **central project ID + account ID + verified provider workspace reference**, never just a matching display name. They create new provider workspaces only if permitted, authorized, and a duplicate search confirms absence; record the mapping before use.
- Workers receive scoped tasks, prepare minimal-context prompts, work in isolated local Git trees, run actual tests, and submit tested branches. AI webpage output never receives native filesystem, shell, Git credentials or privileged Electron APIs.
- On chat exhaustion, crash or context overflow, save a short verified checkpoint and **handoff inside the same authorized provider project** when permitted. Never misrepresent chat creation as bypassing service limits; block/reassign/require assistance if limits remain.
- **No arbitrary code changes.** Document proposed changes and notify relevant agents *before* out-of-scope or shared-contract changes; documentation is **not authorization**. Protected core/security/schema changes require **Owner approval** before work and independent review before merge.
- Source code and approved project documentation belong in Git; MySQL owns **live cluster, authoritative tickets, leases, permissions, progress and audit state**. Git is not a heartbeat or election database. Central SUTRADHAR deployment may use Hostinger ZIP/release upload without a dependency on GitHub Actions.
- Token/context minimization: narrow context, reusable prompt templates, per-task handoffs, hash-based deduplication, low-cost deterministic checks, bounded retries and provider quota caps. This reduces redundant context, **not** guaranteed account limits or cost.

## 2. Deployment and trust boundaries

    OWNER (Web dashboard / Telegram)
                   |
            HTTPS Command API
                   |
    HOSTINGER BUSINESS WEB HOSTING
      - React UI + supported Node.js/Express request handlers
      - Telegram HTTPS webhook (validated and idempotent)
      - Authentication/authorization, registration, election, task API
      - Hostinger MySQL (authoritative InnoDB transactions)
                   ^
                   | HTTPS polling + authenticated commands ONLY
                   |
     PC-01 ... PC-10 (Electron node runtime)
      - 0..N isolated agent identities and role capabilities
      - Master planner (when elected), backups, developer, QA
      - Browser UI workspace or allowed external system browser
      - Unprivileged repo worktree + restricted Git operator
      - Local Docker QA runner + durable local checkpoint/outbox
                   |
            Project Git repositories
          scoped branches / protected main

**Shared-hosting constraints:** design the server as **stateless, short HTTP requests**; never require a permanent background scheduler, inbound WebSockets, Redis, Docker or Python on Hostinger. Worker-initiated polling and short supported cron tasks may trigger timeouts/sweeps. A web process restart must not lose authority or active work. Hosting plan configuration, Node runtime availability, MySQL access/TLS and cron quotas must be proven by deployment acceptance, not assumed from the diagram.

**Source-of-truth separation:**
1. MySQL: IDs, authorizations, elections, queue, actor/epoch/ticket versions, project registry, provider workspace mapping, checkpoints, audits, receipts.
2. Git remote: project source commits, branch/PR/review/merge evidence, approved documentation snapshots.
3. Local PC: private session credentials, ephemeral caches, isolated Git trees, pending outbox; local state is **recoverable but not authoritative**.
4. Provider web workspace: working conversation context only, never proof that code has been saved, tested, pushed or merged.

**No secrets** in Git, docs, prompts, browser logs, Telegram, checkpoint JSON, or unencrypted local backups. Never send the owner's MySQL password to worker PCs. Owner shares production secrets only using protected deployment secret configuration.

## 3. Identity, enrollment and agent isolation

- At first launch, generate a persistent random node ID and independent node signing key in the local OS credential store. Ask owner for display name and general location; server validates an owner-approved enrollment request. Store only public key and appropriate minimal metadata centrally. Reinstall/migration needs explicit recovery or re-enrollment; a clone cannot silently reuse an identity.
- Each machine registers unique agent IDs, role eligibility (MASTER, BACKUP, DEVELOPER, QA), engine capability, capacity, software/protocol version, resource budget, and current state. Multiple agents on the same machine are separate logical workers but **do not count as two independent failover hosts**.
- The control API checks node/agent identity, ticket scope, leadership epoch, valid lease, role and request idempotency; role names supplied by a browser are never trusted. Revoke a compromised node/agent without revoking the entire cluster.
- Heartbeat cadence is **60 seconds**; configured suspected-offline threshold defaults to about **180 seconds since last accepted heartbeat**. Use MySQL server timestamps and transactional lease checks, not client clocks, Telegram message age, or exact cron wakeups. Offline status is evidence of no recent accepted heartbeat, not proof that a machine is physically powered down.
- A consolidated machine heartbeat may report all local agent statuses with monotonically increasing sequence numbers. Status is not a substitute for progress receipts, task leases or branch provenance.

## 4. Master election, retention and failover

1. Before initial bootstrapping: no Active Master, no fictitious backups. Initial first-eligible election opens at **08:00 Asia/Kolkata**. After cluster bootstrap, failover/recovery can elect an eligible candidate **at any time**, including overnight. Owner emergency election is a separately audited, authorized action.
2. Election transaction reads and locks the one authoritative leader row. It compares *server* time, current lease, candidate eligibility/health, and current epoch. If no unexpired leader, it increments the monotonic epoch, selects the first accepted eligible candidate deterministically (server arrival sequence and stable ID tie-break), and commits one leader record.
3. Next two healthy and eligible *distinct-machine when possible* candidates rank as Backup 1 and Backup 2 by persisted accepted registration order. Refill empty backup slots on arrival. Backups get read access to approved shared context and work as Developers until promoted.
4. Renew leader lease only upon **authenticated heartbeat + epoch fencing**. Every privileged ticket-generation, reallocation, authorization, integration, and release mutation checks current epoch in the same database transaction; a stale Master cannot keep operating after partition/reconnect.
5. On lease expiry, promote healthy Backup 1, otherwise Backup 2, otherwise next eligible candidate. Promotion increments epoch and writes a durable election event. A backup with an active developer task checkpoints it and yields or reassigns it before performing privileged Master duties; no silent task loss.
6. A returning former Master becomes an eligible worker/standby, not the current leader by default. A healthy leader **is never replaced just because 08:00 arrives**.
7. Track **elected_at, current tenure, cumulative leadership duration, previous holder, promotion reason, epoch, last accepted heartbeat**. No bogus tenure reset at midnight.
8. If the central API or MySQL is unreachable, no node may self-promote or publish/merge shared code. Local verified progress can be preserved as a pending outbox. New claims, lease renewals and privileged writes are blocked until authoritative service recovery.

## 5. Projects, Master planning, task creation and parallelism

- **Project intake:** owner request from Telegram/web -> project identity lookup -> select existing or propose new -> retrieve trusted Git repo, latest main SHA, architecture, backlog, previous decisions, interfaces, release constraints. Project display names may collide; use immutable project ID.
- **New project:** requires explicit project authorization, repo ownership/visibility, template/stack decision, baseline CI, secret policy, initial architecture, tests and Git branch protections. Provision via a scoped and auditable authorized operation, not a generic AI web instruction.
- **Task Creator:** analyse requirement ambiguity, duplicate functionality/tickets/PRs, repo state, boundary changes, and risk level; create architecture plan, dependency DAG, non-overlapping file write scopes, API/schema contracts, *test contracts* and acceptance criteria before enabling work.
- **Atomic dispatch:** reserve both file paths and shared semantic resources (API contracts, migrations, package config, generated code) in MySQL; an overlapping reservation queues or requires an explicit integration plan. Different files do **not** guarantee safe integration.
- **Scheduling:** dependency-ready tasks, priority, worker capability, current provider availability, quotas, machine resources, fairness, one claim/lease per ticket and bounded attempts. Master may claim an ordinary developer ticket with exactly the same worker restrictions as everyone else.
- **Completing work:** a worker can only **SUBMIT_FOR_REVIEW** with proven Git SHA and test receipt. **DONE** means independently verified integrated/merged evidence and completion acceptance; never mark done because the browser said it completed.

## 6. Electron developer and provider workflow

1. Authenticated Electron agent polls for an eligible scoped task and receives ticket version, lease, project/repo ID, baseline SHA, allowed read/write paths, contract hashes, test commands, stop conditions and minimum necessary prompt context.
2. Verify correct provider account/project mapping; on absence request authorized creation then persist provider workspace identity. A similarly named project must not be silently reused.
3. Prepare context-minimal, versioned prompts (scope, relevant code, interfaces, acceptance/test criteria, prior concise checkpoint); do not insert provider credentials, secrets or entire unneeded repository.
4. Open a provider-permitted browser workspace. Electron remote content must have **nodeIntegration off, contextIsolation on, sandbox on**, restricted navigation/IPC and separate session partitions. Some Google logins may reject embedded webviews: support a user-authorized system-browser path rather than weakening security.
5. Use only provider-supported/permitted interactions; where programmatic scraping/output extraction is not permitted or demonstrated, transition to **PROVIDER_ASSISTED_HANDOFF** or BLOCKED_PROVIDER rather than promise unattended development or evade service limits.
6. Trusted local operator validates AI-supplied patch/output as **untrusted input**, applies only to isolated project worktree/approved paths, runs build/tests in local sandbox, and records actual test evidence.
7. Record checkpoint on meaningful progress, chat end, worker stop, preemption, provider blockage, and before Git publication. New chat may continue under same mapped project when provider permits; load compact verified handoff and re-check Git SHA, never paste complete prior conversation by default.
8. Push a **new, restricted branch** without force, with exact tested tree provenance. External Git ref operations use durable reservation/idempotent recovery before retry. Submit a review request; never directly mutate protected main.

**Operational feasibility gate:** ChatGPT Web unattended automated output collection may be restricted by provider terms; a web subscription is not an automation API. Google embedded login may be unsupported. Workflows must be verified provider by provider, with lawful supported or human-assisted fallback. Browser-first is a product preference, **not an assertion that 100% unattended browser automation is possible**.

## 7. Git, QA, independence and release

- Source code changes only inside per-ticket worktrees/branches; never arbitrary shell commands from website content, never automatic force push, never staging unrelated files.
- Protect baseline HEAD/tree, allowed file/mode scope, API/schema ownership, security files, test command config, output receipts and reviewer eligibility. Changes outside scope are **documented as proposals**, not auto-applied.
- Local QA: syntax/type/lint, unit tests, sandbox execution, allowed-file diff, secret scan, expected API/schema behavior. Integration QA: combine current reviewed heads against latest protected base and rerun dependency, regression, security, UI and deployment smoke suites as appropriate.
- The authoring worker or hybrid Master cannot substitute its own assertion for independent protected-change review. Independent GitHub review or Owner gate remains mandatory for high-risk/core changes; GitHub checks and protected branch rules are an additional remote safety boundary.
- Current implementation's verified tested-branch and rollback pipeline is *partially* reusable; live target GitHub PR/merge/rollback acceptance has **not** been performed. Do not weaken existing default-off push/PR/rollback gates to make the new architecture appear functional.
- Release is distinct from branch push or merge: record artifact/version, target environment, deployment proof, monitoring and rollback readiness. A rollback request is not evidence of completed rollback.

## 8. Checkpoint / memory / token minimization

**Central authoritative checkpoint:** project ID, ticket ID/version, agent ID, Master epoch, provider and account mapping reference (non-secret), provider chat reference if permitted, latest independently verified Git commit/tree/base, changed-file manifest, test evidence, completed steps, blockers, pending approvals, next deterministic action, checkpoint generation and server timestamp.

- Persist task decisions as immutable events; use idempotent event IDs and optimistic version compare-and-swap. Keep per-ticket handoff docs (e.g. .sutradhar/tasks/TASK-ID/) in **scoped project branches**; do not have 10 workers edit a single global progress file. Materialize approved summaries in a controlled single-writer step.
- Store compact architecture summary + changed-function/contract excerpts + latest checkpoint; deduplicate by content hash. Use local deterministic git/test information before asking AI to reason. Maintain bounded retry and per-task token/chat budget counters without attempting provider-account circumvention.
- After chat exhaustion, **checkpoint first**, then allowed new chat in the same mapped project; if limits persist, pause or change to an authorized alternate engine/assisted workflow. Human review and provider compatibility gates are not optional.

## 9. Unified owner operations and safety policy

- Web and Telegram both call the same **Owner Command Service**; authorization, command ID deduplication, audit and project ACLs are shared.
- Minimum commands: status, nodes, agents, master tenure and election history, projects, project details, ticket and QA receipts, priority, create/select project, pause/resume, clarification answer, approve/deny proposal, deliberate failover, retry/reconcile, logs, budgets and emergency stop.
- A request to modify SUTRADHAR core code/security/database schema, delete an environment, expose a secret, expand the allowlist, change repository identity, or merge to protected main must be an explicit **change proposal -> owner authorization -> scope reservation -> tested implementation -> independent review**.
- Record append-only event and audit trails: actor, role, node, epoch, project/ticket version, reason summary, command correlation ID, before/after references, Git SHA, test receipt and authorization. Keep credentials and private user information out of logs.
- Strong node/user authentication, HTTPS, CSRF defenses for website, Telegram webhook secret and authorized user/chat IDs, per-action RBAC, revocation, rate limiting, key rotation and backup/restore drills are required. Previously exposed master signer must be owner-rotated before deployment.

## 10. Canonical responsibility registry (eliminates duplicated systems)

| Responsibility | Exactly one authority | Allowed mirrors / adapters |
|---|---|---|
| Cluster health, nodes, agents, leader epoch | MySQL + Control API | Electron read view; web/Telegram display |
| Owner commands and authorization | Central Command Service | Web handler; Telegram webhook |
| Elections and promotions | Central Election Service / MySQL | Election UI; client heartbeat |
| Tickets, leases, reservations, checkpoints | Central Task Service / MySQL | Local outbox, per-task docs |
| Project code and remote integration evidence | Protected project Git remote | Local independent worktrees |
| Browser account/project working session | Provider-controlled authorized workspace | Central non-secret reference only |
| Code execution and tests | Restricted local Worker/QA runtime | Signed/attested test receipts centrally |
| LLM/provider behavior | Explicit versioned provider adapter | No second implicit model router authority |
| Release/rollback authorization | Owner-gated verified release state machine | GitHub PR proof and audit snapshots |

Retire or disable production access to **legacy in-memory demo cluster state**, duplicate Node/Python election owners, fake metrics and any direct-main legacy Git path; migrate existing SQLite data with integrity verification. Legacy blueprint references to Telegram pinned messages or Gemini pinned ticket generation are historical defaults, **not** authority over the owner-approved v7 browser-first design.

## 11. Remaining feasibility gates and implementation phases

**P0 still open:** Hostinger deployed HTTPS/Node/MySQL smoke test; schema migrations and backups; 2-PC cryptographic enrollment; single-master and real failover; Electron sandboxed workstation; provider-permission proof and project mapping; audited checkpoint/handoff; independent QA; cross-machine file/contract locks; live GitHub protected PR/merge and rollback acceptance; historic signer rotation. These are **not** represented as completed.

**Suggested implementation order:**
- M1: Hostinger-compatible stateless control API + MySQL schema/migrations/backups + truthful web/Telegram source of truth.
- M2: Electron 2-node enrollment, heartbeat, primary/backup election, fencing, crash/network partition tests.
- M3: Project registry and Master Task Creator + dependency/contracts, duplicate detection and owner review.
- M4: Provider-compatible browser-first worker proof-of-concept + local trusted Git operator + checkpoint/new-chat recovery; block unsupported provider flow.
- M5: Parallel two-worker Git integration, independent QA, remote protected PR and rollback acceptance.
- M6: Web/Telegram parity, 8–10 PC stress, recovery and rollout.

**Release policy:** Documentation alone is not verification. Every gate needs a reproducible acceptance test and owner-approved deployment evidence. See [V7 Requirements / Acceptance Matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). Existing draft PR #1 remains **unmerged**, and main is unchanged.


## 12. Current implementation reconciliation — 24 November 2026

Verified source baseline: `3465af4`, [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985550) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985559) both passed. This is not production acceptance. The subsequent fresh-checkpoint change (`ee2e62f`, tests `8684dfe`) is coded, CI not yet verified at this documentation update.

| Target area | Current source status | Remaining proof/work |
|---|---|---|
| Central + Desktop split | Separate staging builds; MySQL authority and unsigned Windows QA packaging in CI | Real Hostinger HTTPS, off-host restore and signed installer |
| Retained Master + two independent backups | Signed heartbeat, lease/epoch fencing and shared recovery snapshot verification | Actual 2/3/8–10-PC failover, hybrid duty and load |
| Master task creator | Exact project IDs, branch uniqueness, deterministic task fingerprint, valid acceptance criteria, dependencies and repository-wide path reservation | Autonomous decomposition, semantic API/schema contract reservation and clarification |
| Provider workspace selection | Owner-declared non-secret configuration aliases, exact project/agent binding and conflict checks | Durable versioned MySQL registry, verified real account/workspace, revocation and permitted adapter |
| Token minimization | Deterministic compact JSON, deduplicated scope/criteria, 8 KiB cap, checkpoint digest; mapping metadata outside prompt | Actual tokenizer/quota accounting, safe context reuse, secret review and provider-permitted continuation |
| Worker recovery | Project revocation fences unfinished leases and preserves evidence; stale receipts rejected; new claim needs fresh checkpoint before submit (new CI pending) | Physical crash recovery, independent worktree verification, provider interruption and tested release |
| Owner control | Shared web/private Telegram STATUS/PAUSE/RESUME | Real bot delivery and remaining safe command parity |

Requirements in sections 1–11 are unchanged. See [implementation tracker](IMPLEMENTATION_TRACKER.md), [gap register](../GAP_REGISTER.md), [acceptance matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [provider declaration guide](PROVIDER_WORKSPACE_DECLARATIONS_V7.md). G0–G7 remain HOLD; main unchanged; no production rollout.


## 13. Shared-contract admission — incremental source reconciliation

Verified previous baseline `93993a0`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700768) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700737) both SUCCESS, including the fresh-checkpoint change. The new shared-contract implementation and regressions are CODED / CI PENDING at this update.

Master may declare canonical exclusive API, database, interface and event keys in `contract_keys` when planning a task. Nonempty declarations require fresh Owner authorization regardless of LOW risk. Central persists the declaration in the durable TASK_PLANNED ledger and, under the existing repository-wide reservation lock, rejects overlapping declared keys across distinct files/base branches. An unclassified legacy task and a nonempty declared task cannot hold reservations concurrently in the same repository. Path scopes remain separate; a contract key never grants filesystem permission. Reconciliation retains the hold until ordinary reservations are explicitly released. Desktop retains the declaration in bounded manual context.

This is an initial explicit declaration mechanism, not automatic semantic dependency discovery. An explicitly empty declaration is not independently proven conflict-free. Different resource namespaces, external repos, incorrectly declared contracts and combined integration behavior still need review. No schema migration was introduced; event lookup cost on real Hostinger remains to be measured. G0–G7 remain HOLD.


## 14. Durable Owner provider declarations — incremental implementation

Last fully green source baseline `93993a0`; shared-contract HEAD `01ff1ce` dependency CI succeeded but application CI was cancelled. New provider-registry source is CODED / CI PENDING; verify the latest exact-head workflow results.

Central now persists bounded canonical full registry snapshots in its authoritative MySQL event ledger. Owner-authenticated read and expected-version replacement require exact active project, approved agent/node and development grants. First stored snapshot supersedes the legacy environment; explicit empty replacement revokes all declarations without fallback. Desktop displays source and revision separately from the prompt. Neither alias nor digest proves provider login or consent. This design uses the existing schema rather than unreviewed DDL; indexed lookup, retention/restore proof, non-developer dashboard editor, actual provider account/workspace verification, permitted recovery and measured quota remain open. See [registry guide](PROVIDER_WORKSPACE_DECLARATIONS_V7.md) and [tracker](IMPLEMENTATION_TRACKER.md). G0–G7 HOLD.


## 15. Non-developer Owner registry editor — incremental implementation

Verified previous source baseline `215e5ee`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116654) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116645) both SUCCESS. New Owner registry editor is CODED / CI PENDING at this update.

The existing authenticated Central dashboard now includes a provider registry panel for current version inspection, alias entry, local remove/add and reviewed full-list replacement. Owner must explicitly load current state; draft edits never write. Initial version 0 does not expose environment bindings and requires deliberate supersession of all legacy declarations. Save requires full-list consent, no unadded form data and explicit confirmation. One expected-version POST followed by exact current-state readback guards concurrent changes and lost responses. Unknown outcomes require fresh explicit load; no automatic retry. Session changes clear local metadata and ignore late responses. No separate deployment, credential store, provider authentication or automatic execution; real browser and Hostinger acceptance remain open. See [Owner registry guide](PROVIDER_WORKSPACE_DECLARATIONS_V7.md). G0–G7 HOLD.


## 16. Manual provider interruption and attempt history — incremental implementation

Verified previous baseline `e935cef`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765773) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765743) both SUCCESS. New manual attempt source is CODED / CI PENDING at this update.

Central records one outstanding manual attempt per ticket, using the existing MySQL event ledger and signed worker commands. BEGIN binds current worker lease, Master epoch, durable registry revision, exact declaration digest, fresh checkpoint and operator-supplied context digest. OPEN/INTERRUPTED blocks new attempt, candidate submission, normal requeue and new compact Desktop handoff. Same-lease closure requires a newer checkpoint and manual external-session/worktree review. On revoked lease, separate Owner review closes only the attempt record while ticket/reservation reconciliation remains required. Trusted developer CLI supports explicit recording and readback, never automatic retry or provider transmission. This is opt-in local metadata, not proof of actual remote activity or permission. Packaged Desktop mutation controls, Owner resolution UI, live provider integration, actual transmitted bytes and quota, physical interruption and target ledger retention/performance remain open. G0–G7 HOLD.


## 17. Owner provider interruption review — incremental implementation

Previous HEAD `82e2a8c` failed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188656) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188901) on TS18049 strict-null diagnostics; disposable MySQL integration and unsigned Windows smoke passed. Explicit return guards (`4d05bde`) correct the reported paths; combined CI verification of the fix and new UI remains pending. Last fully green baseline `e935cef`.

The existing Central Owner dashboard now includes a ticket-specific interrupted-attempt review panel. Current authoritative observation includes closure eligibility only for an unresolved attempt bound to a revoked original lease and ticket already RECONCILIATION_REQUIRED. Owner retypes the exact attempt ID, independently reviews external session/worktree and confirms no automatic retry. The authenticated command rechecks the same state transactionally; current exact closure readback is required before displaying success. Late responses after session change are ignored. This closure does not release reservations, requeue or perform external provider activity. Packaged Desktop attempt mutation, actual authorized provider continuation and physical/browser/Hostinger acceptance remain open. No schema changes; G0–G7 HOLD.


## 18. Consolidated Desktop provider recovery and reviewed context admission

Verified exact baseline `1193b3b`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215514) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215696) both SUCCESS. New consolidated Desktop/provider admission batch is CODED / EXACT-HEAD CI PENDING.

The packaged Windows Desktop now exposes explicit manual BEGIN / INTERRUPT / CLOSE controls. Electron main uses the original sealed receipt, signed live lease observation, original trusted Git worktree, exact current task and OS-vault allowlisted signing. Renderer cannot submit arbitrary signed request bodies. Compact context is displayed separately from local registry metadata; main recomputes its SHA-256 and matches the reviewed context, task identity, registry revision and binding digest. Central BEGIN requires exact expected_task_version, registry revision, binding digest and checkpoint generation under transaction. Coordinated Central, Desktop and CLI builds are required because BEGIN now has a required version field. No remote provider request, automatic retry or reassignment; ambiguous replies require current signed inspection. Additional safeguards `5432a9a`, `2651e1e`, `7768fb2`: main retains only the reviewed preview's in-memory task/origin/digest/registry-version/binding-digest metadata; a changed registry revision or binding blocks BEGIN even when compact context bytes match. Recovery refuses a missing original worktree rather than recreating it. These safeguards and regression fixtures also await exact-head CI. Actual provider authentication, transmitted bytes, actual token/quota measurement, physical/Hostinger acceptance and target ledger performance/restore remain OPEN. G0–G7 HOLD.


## 19. Consolidated Master task DAG and atomic planning admission

Previous exact HEAD `8145c64`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963696) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963719) were cancelled. Before cancellation the real MySQL and Python/shell/state jobs passed, while the TypeScript/unit/build job failed at Desktop security validation: obsolete static regex expected a ternary that had been replaced by the reviewed-context guard. Test correction `b4ec4ae` preserves the security assertions. Last fully green combined baseline `1193b3b`. New planner and correction are CODED / EXACT-HEAD CI PENDING.

A live approved READY Master can preview a bounded single-project batch of 2–10 explicitly declared tasks. Deterministic topological sorting rejects cycles, case aliases, duplicate intents/branches and declared path or shared-contract conflicts lacking explicit transitive order. Existing dependencies must be exact same-project non-cancelled tickets. Preview validates current MySQL state and binds normalized batch content, Master epoch, project and request ID in a SHA-256; it does not reserve work. Commit revalidates under the existing leader/repository locks, creates tickets, approvals, edges, task events, batch event and idempotent receipt in one transaction, and rechecks database-clock Master authority before receipt finalization. Any failure rolls back the entire batch. Existing claim dependency, reservation, approval and QA/Git barriers remain intact. Trusted CLI provides reviewed manifest preview/commit. See [Master planning guide](MASTER_TASK_BATCH_PLANNING_V7.md). No automated task generation, code-level dependency discovery, baseline verification, worker execution or provider integration. An upstream DONE state does not change downstream immutable baseline. Real operator/physical and combined QA acceptance remain open. G0–G7 HOLD.


## 20. Non-developer Desktop Master planning and historical receipt recovery

Exact baseline `804726e` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312420) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312581), including previous Desktop correction and Master batch admission. New Desktop Master planner and receipt lookup are CODED / EXACT-HEAD CI PENDING.

The approved local Master can prepare 2–10 explicitly declared tasks in a no-code form. Main-only OS-vault signing uses exact planning preview/commit/receipt request shapes. Main obtains current signed cluster observation, validates the returned order/declarations and pins the reviewed payload in memory; a separate native confirmation commits only that payload. Central rechecks exact Master identity, eligibility, maintenance and epoch under the existing transaction. Historical receipt lookup is restricted to the original approved actor and exact project/request/digest, and returns historical admission metadata only. The original Master need not remain elected to inspect its own receipt; revoked/drained original signers require separate Owner reconciliation. No durable local draft, automatic retry, verified baseline, source-semantic completeness or autonomous generation. See [Master planning guide](MASTER_TASK_BATCH_PLANNING_V7.md). G0–G7 HOLD.


## 21. Restart-safe reviewed Master admission and project selection

Exact baseline `0fc7c7a` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325287) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325508), including the previous Desktop Master planner and historical receipt lookup. New project catalog and admission journal changes are CODED / EXACT-HEAD CI PENDING.

Signed current-Master catalog returns minimal active project identity/name/repository/base branch (maximum 100; explicit truncation), never Owner key or provider/grant configuration. Main persists exact confirmed reviewed admission in an encrypted append-only per-PC journal before POST and reads it back; one unresolved intent blocks new previews/admissions on that PC. Exact verified historical receipt closes the hold with separate encrypted evidence. Recovery restores original reviewed draft and identifiers only for the original approved agent/Central, not current authority or automatic execution. Unconfirmed local edits are still in memory. Existing idempotent MySQL command ledger is authoritative; absence of receipt cannot authorize replacement work. Bounded file/inventory policy, Owner/successor resolution, retention and physical Windows DPAPI/power-cut acceptance remain open. Actual Git baseline, autonomous source discovery, independent combined QA and production acceptance remain separate. No new schema. G0–G7 HOLD.


## 22. Owner-controlled interrupted Master admission reconciliation

Exact baseline `85ae5a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705079) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705150), including encrypted Master admission journal and signed project catalog. New Owner reconciliation batch is CODED / EXACT-HEAD CI PENDING.

The web Owner can inspect the exact original actor, project, request, preview digest and ordered ticket IDs. Existing admitted receipt or conflicting listed tickets deny cancellation. For absent receipt and listed tickets, independent Owner review permits a permanent denial marker in the existing v7_commands actor/request namespace, serialized by the same leader lock as admission; marker and audit event commit atomically. Preview and delayed admission reject reuse. The original approved Desktop reads the distinct resolution and closes its encrypted journal only on exact matching identifiers and order. Historical admission receipts remain unchanged. Cancellation is a permanent deny marker for the exact original actor/request key, not proof of historical non-admission after database loss/restore. Owner must independently compare original local journal, ordered IDs, preview digest, database history and uncertain effects; server checks the current durable ledger and listed ticket IDs, not the full original task manifest. A wrong cancellation declaration is not automatically corrected. No existing tickets are deleted, no replacement work authorized, and an unavailable/revoked original signer cannot automatically release its local journal. Retention and physical DPAPI/power-cut acceptance remain open. No new schema or production change. G0–G7 HOLD.

## 23. Desktop local Git baseline preflight

Exact baseline `a77d3a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558734) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558666), including previous Owner admission reconciliation. New local baseline and exact project lookup changes are CODED / EXACT-HEAD CI PENDING.

A current Master may obtain exact signed project identity independent of the capped catalog. Native checkout selection binds the local repository root, configured origin, base tracking ref, commit and tree to project/agent/Central/epoch in Electron main. Preview and pre-admission recheck the same local observation and require all task baselines to match. No network Git operation or worktree mutation; no path exposed to renderer or Central. Internal dependencies are reported as ordering edges, not future source inclusion. Local verification observes the configured repository origin, local remote-tracking ref, commit and tree only. It is not live GitHub freshness, an independent remote attestation, source-level semantic analysis, or proof that upstream changes are included. Desktop batches now require every task to use the same inspected tracking-ref SHA; if a dependent task needs not-yet-merged code, plan it separately after upstream merge and review. Central and CLI planning contracts remain unchanged except for the additional signed project lookup; no baseline evidence is persisted in Central or the admission journal beyond the task's existing baseline SHA. G0–G7 HOLD.

## 24. Explicit encrypted unconfirmed drafts and bounded local dependency hints

Exact baseline `6c996cb` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717874) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717690), including the Desktop Git baseline preflight. New encrypted unconfirmed draft and bounded source-hint changes are CODED / EXACT-HEAD CI PENDING.

Desktop main isolates one latest encrypted editable snapshot per node/Central/agent from the append-only confirmed admission journal. Snapshot uses CAS against the loaded digest and stable private file/atomic write checks; it contains task/editor data only, never authority or provider credentials. A pending admission takes priority. Local immutable-source inspection binds exact signed project and current inspected local tracking ref to existing draft scopes and returns possible cross-task/shared relative imports without returning source or creating dependencies. Explicit save only; no autosave. The latest saved unconfirmed snapshot per node/Central/agent is encrypted, CAS-revisioned, and bounded to 60,000 UTF-8 JSON bytes and 65,536 encrypted bytes. A pending admission journal blocks draft save/restore. Restoring an unconfirmed snapshot never restores baseline observation, reviewed preview, Owner consent, or admission/execution authority. An interrupted/corrupt draft write remains a local Owner-review hold. Saved task content may contain sensitive material; do not enter credentials or provider secrets. Physical Windows DPAPI/power-cut and retention/recovery of corrupt snapshots remain open. Source hints are lexical, not an AST or complete dependency graph: inspect immutable Git tree/blob objects for scoped JS/TS-family regular files, at most 12 files, 16 KiB per blob, 1 MiB tree listing and 40 hints. Relative static/literal imports only; comments/strings may cause false positives, package aliases, generated code, other languages, dynamic paths and unscanned files may cause false negatives. Only paths, task IDs, counts and commit/tree IDs are returned; no source content, provider send, automatic dependency insertion, task creation or Git mutation. The report does not prove semantic independence, upstream inclusion or remote freshness; no measured provider token reduction is claimed. G0–G7 HOLD.

## 25. Advisory planning graph and compact context

Exact baseline `babd15b` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449293) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449341). Encrypted unconfirmed draft storage and lexical source hints are source-CI verified. New advisory graph, fair sampling and compact context changes are CODED / EXACT-HEAD CI PENDING.

Desktop main calculates deterministic declared dependency waves and connected review components, with conservative case-insensitive path and hierarchical contract overlap checks. Transitive declared order is distinguished from unresolved conflicts. External dependencies are explicitly unverified. Local source scan allocates the same bounded file budget round-robin across tasks and reports coverage. A separate main-only exact compact context is bound to the rechecked local baseline. Declared dependency waves are a topological view of internal declared edges only, not dispatch waves. External dependencies remain unverified, unordered path/contract conflicts require review, and connected review groups are not a safe parallel execution guarantee. Source hints remain bounded lexical evidence, not AST or semantic proof; round-robin sampling improves task coverage but does not guarantee complete coverage. No task decomposition, automatic edge insertion, claim, Git mutation or provider action is authorized. Explicit local compact planning preview hoists one shared baseline SHA and retains all exact task strings, order, scope, risk, contracts, dependencies and criteria. It reports exact UTF-8 bytes, difference versus expanded compact JSON and SHA-256; cap 16,384 bytes, fail closed rather than truncate. No token count or actual provider savings verified, no secret scan, no automatic transmission. Independent secret review is required before any manual sharing. Draft/review changes invalidate the displayed preview. Existing signed Central admission, approval, dependency and worker reservations remain authoritative. G0–G7 HOLD.
