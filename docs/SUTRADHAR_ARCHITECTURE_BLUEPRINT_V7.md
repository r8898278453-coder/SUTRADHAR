# SUTRADHAR — Architecture Blueprint v7.0

**Date:** 2026-11-11  
**Status:** DESIGN BASELINE / NOT IMPLEMENTED / NOT PRODUCTION READY  
**Scope:** The owner's consolidated requirements from the architecture discussions. This document supersedes v6.0 **as a target design**, not as a claim that the existing code works accordingly. The legacy root file **Project Blue Print.txt** remains preserved for historical context.  
**Companion contracts:** [Agent, Task, QA and Recovery Contract](./AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md) and [Acceptance / Traceability Matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md).  
**Code status:** Current implementation still uses SQLite, in-memory/demo views, and partially implemented Git/LLM flows; do not call this blueprint deployed.

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
