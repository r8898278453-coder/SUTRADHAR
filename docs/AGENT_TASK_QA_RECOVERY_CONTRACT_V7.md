# SUTRADHAR v7.0 — Authoritative Agent, Task, QA & Recovery Contract

**Date:** 2026-11-11  
**Status:** TARGET CONTRACT / PARTIAL ALPHA IMPLEMENTATION; current code does not implement all endpoints, tables, statuses or guarantees. See dated implementation reconciliation below.  
**Authority:** This specification is the canonical proposed *behavioral contract* for Master, Backup, Developer, QA, Git Integrator, Watchdog and Owner. It accompanies [Architecture Blueprint v7](./SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md) and [Test Matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). It supersedes older conflicting specifications **as target behavior** while preserving the existing security and no-direct-main safety gates.

## 1. Invariants — MUST always hold

**INV-01 One leader:** At most one currently valid (agent ID, epoch, lease) can mutate Master-owned state. Every Master mutation is transactionally fenced by current epoch and expiration.

**INV-02 No orphan authority:** Neither browser messages nor Telegram pins, local files, nor a node clock may elect a Master, claim a task, approve a protected edit or confirm a merge. MySQL transaction decisions and independent remote Git proofs are authoritative for their respective domains.

**INV-03 Distinct identities:** A node is a physical/logical computer enrollment; an agent is an independently authenticated process/persona. Multiple agents on one computer cannot masquerade as multiple independent failover hosts.

**INV-04 Idempotency:** Every command, allocation, checkpoint, Git operation and webhook has a durable, scoped idempotency/correlation key; retries return prior decision or reconcile proof, never duplicate success side effects.

**INV-05 No side effect without scope:** Before code mutation there must be a valid owner/project decision, scoped task, base SHA, approved file/contract reservations, valid worker lease and protected-path authorization.

**INV-06 Tested tree, not AI assertion:** The Git tree SHA submitted for review is the exact tree independently tested and scoped. AI chat saying 'done' is not a receipt.

**INV-07 Review != complete:** Branch pushed, PR created, task QA passed, review approved, GitHub merged and deployment verified are **distinct states**, never conflated.

**INV-08 Safe failover:** Expired/partitioned Master and revoked worker leases cannot execute newly accepted writes or resume old Git publication. The successor reads durable versioned context, not an absent browser's RAM.

**INV-09 No privilege from documentation:** A proposed change, written handoff or discussion does not authorize out-of-scope code, core security, schema, dependency or release mutations. Protected actions require explicit grants and independent review.

**INV-10 Secrets never travel in prompts:** MySQL password, private keys, session cookies, tokens, production secrets and sensitive source material beyond explicitly authorized task context cannot enter provider prompts, Git history, audit logs or Telegram.

**INV-11 Provider compliance:** Browser-first is a preference, not permission to scrape or bypass providers' access restrictions. Unsupported unattended flows must block and offer approved assistance; do not imply guaranteed automated Git capabilities in a chat UI.

**INV-12 Default deny:** Unconfigured signing keys, TLS/auth, provider workspace mapping, MySQL migrations, safe test command, Git protection or required review means BLOCKED; never fall back to fake/simulated production success.

## 2. Actors, capabilities and boundaries

| Actor | Can do | Cannot do without special authorization |
|---|---|---|
| Owner | Project intake, priorities, approve protected plans/changes, pause/revoke, approve releases, view audits | Bypass cryptographic proof by merely marking a task done |
| Active Master | Plan, create approved-scope tickets, schedule/reassign, propose integration, inspect QA and status; also claim normal Developer work | Self-authorize protected edits, bypass test failures, merge unreviewed core |
| Backup 1 / Backup 2 | Read permitted project state, execute scoped Developer tasks, keep heartbeat and leadership eligibility | Issue Master commands until elected with fresh epoch |
| AI Developer | Claim one scoped lease, work via allowed provider, produce local verified patch, tests, checkpoint and review submission | Direct-main push; arbitrary shell/API/secret access; expand scope |
| Independent QA | Execute acceptance/regression/security suites against exact candidate Git tree; sign test evidence | Rewrite code and silently pass its own modified candidate |
| Git Integrator | Prepare restricted integration tree, check conflicts, run combined QA, propose draft PR/merge verification | Force push, infer remote merge from local branch, ignore required review |
| Central Watchdog | Evaluate expired leases, age and recovery candidates; record audited state transitions | Infer source changes from missing heartbeats or accept an unverified retry |
| Web / Telegram adapter | Authenticated input and display from one command service | Maintain separate shadow project/ticket/master state |
| AI provider webpage | Generate suggestions / work artifacts through permitted use | Obtain privileged filesystem/DB/Git credentials from Electron |

Role-based authorization is checked server-side per action. For hybrid Master-as-Developer, **use a separate developer lease and scoped task role**; do not grant coding task an unrestricted Master capability.

## 3. Common command / event envelope (proposed JSON fields)

All commands to the HTTPS API MUST carry:

    schema_version: "7.0"
    request_id: UUID  (idempotency key, unique by actor + operation + resource)
    actor: { node_id, agent_id, credential_reference }
    action: <enum>
    project_id: <immutable ID or null>
    ticket_id: <immutable ID or null>
    expected_version: <integer or null>
    expected_master_epoch: <integer or null>
    payload: <schema-validated action-specific object>

The server attaches its own **server_received_at**, command classification, current authorization and trace ID; ignores caller-supplied role/trust claims. Logs redacted evidence and responses contain server-owned versions and operation receipt IDs.

**No secrets in serialized audit payloads**; credential_reference denotes a server-recognized identity, not raw credentials. Polls use HTTP authentication and authorization; all significant state changes are InnoDB transactions, not best-effort in-process counters.

### Response / retry contract

- Success: {accepted:true, resource_version, receipt_id, state}, returned idempotently for retries.
- Conflict: {accepted:false, error_code:"VERSION_CONFLICT" | "SCOPE_CONFLICT" | "STALE_MASTER_EPOCH" | "LEASE_EXPIRED", retryable:false or requires fresh read}.
- Transient unavailable: {accepted:false, error_code:"CONTROL_UNAVAILABLE" | "REMOTE_UNCERTAIN", retryable:true **only after read-only reconciliation** for external side effects}.
- No fabricated completed work: response must expose whether data is **VERIFIED**, **PENDING**, **BLOCKED**, or **UNKNOWN**.

Use monotonic version numbers and DB clock. A request ID uniqueness constraint and an operation ledger ensure retried HTTP POSTs, Telegram webhook redelivery, or node reconnect cannot create repeated tickets or branches.

## 4. Node enrollment, agent registration, heartbeat and election

### Enrollment contract

    node_id: immutable random generated value; unique across cluster
    node_public_key: per-node public identity; private key in OS credential store
    display_name: owner provided; mutable
    general_location: owner provided; optional and not exact GPS
    enrollment_status: PENDING -> APPROVED -> REVOKED
    software_version, protocol_version, OS, capacity, capabilities
    agents[]: {agent_id, node_id, roles_allowed, engine_capabilities, max_parallel_tasks}

Enrollment requires owner approval/secure enrollment grant, not just supplying a node ID. One node may host several agents; role selection and task assignment occur per agent with node-wide capacity checks. Private IP, token or credential values are not required in Git; approved non-secret registry export may be committed by a controlled process when explicitly requested.

### Heartbeat contract

- **60 seconds** from each agent (optionally aggregated and signed by a node service), carrying sequence, local agent liveness, capacity/load, ticket ID, phase, engine availability and software version. Receive time is stored by server; clients do not write lease expiration.
- Machine and agent state = ONLINE / SUSPECT / OFFLINE / REVOKED. Default **SUSPECT after approximately 180 seconds without accepted heartbeat**; exact transition governed by server lease and request processing, not guaranteed exact timer execution on shared hosting.
- A heartbeat alone cannot advance completed steps, assert QA success or modify Git proof. Master heartbeat must carry valid epoch for lease renewal; worker progress uses separate versioned receipts.
- If Hostinger/MySQL is unavailable, nodes append locally sealed pending events, halt *new remote mutations and new claims*, and do not auto-promote. Once reconnected, stale epoch/lease events are rejected or sent to explicit reconciliation.

### Election contract

    leader_state: {active_agent_id, node_id, epoch, elected_at,
                   last_heartbeat_at, lease_expires_at, cumulative_tenure}
    backups: ordered [backup_1, backup_2] with separate node IDs when available
    election_history: immutable {old, new, reason, epoch, server_time}

- At fresh initial bootstrap, candidates are considered **no earlier than 08:00 Asia/Kolkata**. First *accepted eligible authenticated* candidate wins deterministic transaction. Healthy Master survives midnight and subsequent 08:00 events.
- Lease expiry prompts promotion **at any time** from eligible backup order, then next eligible candidate; timeout is checked on API calls or authorized short cron. No extra paid always-on service.
- A DB transaction locks leader row, checks old epoch/lease, increments epoch and commits single winner. If racing, only one transaction succeeds.
- Standbys read up-to-date central context; they do not need or share browser cookies. On takeover, preempt their own Developer tasks via a durable checkpoint; task stays valid only if lease remains valid and owner scheduler permits resumption; otherwise explicitly reassign.
- A previously active Master returning online does not reclaim leadership without new election. All its pending remote publications need fresh authority and reconciliation.
- **NO_MASTER** must be displayed when none eligible. If no worker but Master is healthy, Master may claim an ordinary Developer task within its capacity.

## 5. Project creation, selection and permissions

**Canonical project record:**

    project_id, display_name, project_type, owner_id, repo_full_name,
    repo_visibility, protected_base_branch, required_checks,
    default_test_profile, architecture_doc_sha, status, priority,
    allowed_nodes, provider_mappings[], created_at, version

**Provider mapping** is a separate per-(project, provider, authorized account) record with verified provider workspace reference, last_verified_at and capabilities. Never choose by display-name matching alone. A project creation operation must reserve immutable project ID, authorize Git repo creation, establish baseline protections and reference the provider workspace separately. Duplicate project names may be allowed, but provider workspace mapping conflicts must block.

Before new/duplicate implementation tickets, Master compares open/blocked/done tickets, accepted project roadmap, relevant code paths, Git history/PRs, dependency/interface contracts and previous proposed plans. Persist duplicate-detection fingerprint (project + intent + affected contract version) with human-visible rationale; semantic equivalence still needs careful review, not blind string matching.

## 6. Authoritative Task Creator contract

A **DRAFT** task cannot be claimable. Master validates or obtains clarification before transitioning to **READY**. Every task MUST include:

| Field | Required meaning |
|---|---|
| ticket_id / project_id | Immutable IDs; project must be enrolled and accessible |
| created_by_master_epoch | Current valid Master authority and plan version |
| title / goal / description | Testable business and engineering intent |
| requirement_refs / architecture_ref | Approved source and design decisions |
| baseline_git_sha / repo / base_branch | Immutable source snapshot |
| read_scopes / write_scopes / forbidden_scopes | Narrow explicit paths; protect core, credentials, policy |
| interface_contract_refs | APIs, DB migrations, shared schemas, generated files affected |
| dependency_ticket_ids | Acyclic DAG; READY only when all required inputs are verified |
| risk_level | LOW/MEDIUM/HIGH/CORE; determines human approval/review |
| chosen_engine_capabilities | Browser provider capabilities needed; no hard-coded unauthorized account |
| acceptance_criteria | Observable behavior, expected/negative cases |
| test_profile / commands | Trusted server-side selected commands; never arbitrary caller shell |
| resource_budget / retry_budget | Time, provider sessions, context, tests, retries |
| definition_of_done | QA receipts + integrated Git evidence + approvals |
| task_version / prompt_template_version | Optimistic CAS and reproducibility |
| reservations | Paths/contracts to protect across concurrent workers |

**Master may not silently expand scopes** in a retry. Scope expansion creates a new versioned change proposal, checks conflicts, and is Owner-approved for CORE/HIGH risk as defined by policy. Master can create new tasks only while its lease and epoch are valid.

### Task lifecycle (normative)

    DRAFT -> WAITING_CLARIFICATION -> DRAFT
          -> WAITING_AUTHORIZATION -> READY
    READY -> CLAIMED -> RUNNING -> CHECKPOINTED (resumable) -> RUNNING
    RUNNING -> BLOCKED_PROVIDER | BLOCKED_CLARIFICATION
            -> TESTING -> TEST_FAILED -> RUNNING (bounded retry)
            -> SUBMITTED_FOR_REVIEW -> INTEGRATING
            -> REVIEW_REQUIRED -> VERIFIED_MERGED -> DONE
    Any active state -> RECONCILIATION_REQUIRED / CANCELLED / FAILED
    RECONCILIATION_REQUIRED -> prior proven state (read-only proof) or BLOCKED

Not all successful tasks require every intermediate state; each transition has a server-enforced allowed-from set. **DONE is terminal after verified integration acceptance**. For tasks whose deliverable is not source code (e.g., documentation), explicit non-code acceptance evidence and owner policy replace Git merge proof; do not fake a Git commit.

### Atomic claim + reservations

- In one MySQL transaction: lock task row, verify status READY/dependencies/epoch, validate node + agent + capacity + ACL, reserve exact write paths and semantic contracts, increment task version, issue unique scoped worker lease.
- Database uniqueness or serializable/advisory locking must prevent conflicting reservations, including overlapping **directory prefixes** and matching shared API/schema locks (a simple unique exact path constraint is insufficient).
- On worker death, **do not** immediately reissue a pushed/uncertain external operation. Reconcile Git receipts and task checkpoint before releasing/reallocating its write scopes.
- Task lease ≠ node heartbeat; task lease must renew with valid progress/allowed state and never authorize merge after expiry.

## 7. Development worker, trusted Git and browser handoff

### Worker preflight

- Verify node enrollment, agent authorization, lease, current project ID, repo identity/visibility, base commit, task/version, read/write scopes, dependency receipts and workspace isolation.
- Resolve mapped provider account and provider workspace; do not create an arbitrary similarly named project. Confirm provider current terms, allowed auth/session path, and capability. Capture only non-secret reference.
- Build a concise prompt containing accepted task goals, exact contracts, relevant file excerpts or snippets, working baseline and acceptance criteria; include a token/size limit and source hashes.
- If provider workflow cannot be safely automated, transition **BLOCKED_PROVIDER** and request authorized assisted operation or supported alternate workflow, without misrepresenting it as automated success.

### Trusted output and Git operator

- Treat web output as *untrusted text/artifacts*, not an instruction to run arbitrary shell commands. Extract/receive patch through a provider-permitted workflow; validate path traversal, symlinks, rename/modes, binary changes, protected files, scope and patch syntax.
- Only trusted local operator can apply approved candidate to a fresh isolated Git worktree based on exact SHA. No web renderer access to Node integration, shell, GitHub token, Docker socket, file picker with unrestricted access, or raw IPC.
- Test in properly restricted local Docker runner with controlled trusted test profile, resource/network limits, explicit exit code and output evidence. AI cannot choose to skip or alter mandatory test command.
- For successful candidate: capture Git diff manifest, baseline/head/tree SHA, test suite/version, runner identity/time, commit author and worker lease/epoch proof; reserve then push only allowed new work branch, non-force and never directly main; check actual remote result.
- On uncertain push, branch already exists or partial crash: use read-only remote inspection and existing guarded reconciler principles. Never blind retry a GitHub POST/push, PR creation, merge or rollback.

### Checkpoint/handoff (source of truth)

    checkpoint_id, schema_version, project_id, ticket_id, task_version
    node_id, agent_id, master_epoch, provider_id
    provider_account_ref, provider_workspace_ref, provider_chat_ref
    source_base_sha, verified_head_sha, verified_tree_sha, changed_files_manifest
    completed_actions[], pending_actions[], known_errors[]
    last_test_receipt_id, last_git_operation_receipt_id
    next_exact_action, blocker_reason, approval_refs[]
    checkpoint_generation, created_at_server, content_hash

The server atomically checks ticket version + agent lease and persists append-only history; a new provider chat may read a compact generated handoff and must independently verify Git state. Provider conversation or local process death does not silently change status to DONE. Chat exhaustion or auth expiry triggers checkpoint -> authorized new chat in same mapped workspace if allowed -> otherwise BLOCKED_PROVIDER and Owner notification. No session-cookie transfer between different agents.

### Handoff files (proposed per-ticket scope)

    .sutradhar/tasks/<ticket_id>/HANDOFF.md
    .sutradhar/tasks/<ticket_id>/DECISIONS.md
    .sutradhar/tasks/<ticket_id>/TEST_RESULTS.md
    .sutradhar/tasks/<ticket_id>/CHECKPOINT.json

These files are optional Git snapshots attached to approved ticket branches, **not** a replacement for central DB. Store no secrets/PII; never overwrite another agent's shared progress file. Any shared architecture summary is regenerated by a single authorized writer from approved event records.

## 8. Independent QA and integration contract

QA **must not trust developer self-report**. Test execution produces a structured immutable receipt:

    receipt_id, ticket_id, candidate_head_sha, candidate_tree_sha, test_profile_id
    runner_node_id, runner_agent_id, environment_image_digest
    test_commands_hash, started_at, ended_at, exit_code, timed_out
    stdout_stderr_digest, results: [{test_id, outcome, evidence_ref}]
    scope_validation, dependency_validation, security_gate, provenance_signature

**Required QA tiers (as applicable to scope/risk):**
1. Parse/syntax/type/lint and changed-file/scope checks.
2. Unit tests including negative/edge behavior from acceptance contract.
3. DB/API/interface contract and dependency integration tests.
4. Regression tests against unaffected critical flows.
5. Security checks: authorization, secret leakage, path traversal, injection/sandbox escapes and dangerous file changes.
6. Combined integration tree checks for *all* parallel worker branches; individual test passes do not suffice.
7. Browser UI and cross-environment smoke tests for UI work.
8. Deployment verification and rollback-readiness checks for releases.

The same agent that authored a HIGH/CORE change cannot be its sole approving reviewer. A deterministic QA runner can execute on the Master PC if alone, but **Owner approval and independent remote review** remain mandatory for protected operations. Never use an LLM opinion as the sole reason to PASS a security or merge gate.

**QA failure contract:** save reproducible failing command/profile, expected vs actual, output digest, exact SHA, environment, affected file list and retry budget; transition to TEST_FAILED / BLOCKED or generate **one idempotent corrective ticket**. Do not silently update requirements/test profiles to make a failure disappear.

**Integration:** reserve integration operation; pull exact latest target, ensure no unauthorized deletions/mode changes, merge/rebase proven heads sequentially in a separate isolated worktree, recompute combined Git tree SHA, rerun combined QA, create **draft PR** with exact remote identity and required reviews. Actual completed merge/rollback status requires independent remote PR/CI/tree evidence and approvals; deployment state must be independently proved.

## 9. Failure taxonomy and recovery

| Failure code | Trigger | Required outcome |
|---|---|---|
| MASTER_LEASE_EXPIRED | No accepted leader heartbeat until expiry | Single fenced promotion, old epoch denied |
| WORKER_LEASE_EXPIRED | Worker missing/invalid progress lease | Preserve checkpoint; block old worker; reconcile uncertain Git before reassignment |
| PROVIDER_AUTH_EXPIRED | Browser session expired or login blocked | Save verified checkpoint, BLOCKED_PROVIDER, owner-assisted reauth |
| PROVIDER_LIMIT | Chat/context/quota exhausted | Compact checkpoint and permitted new chat; else pause, no evasion |
| PROVIDER_UI_CHANGED | Provider website flow inconsistent | Disable affected adapter/capability; no simulated completion |
| PATCH_SCOPE_VIOLATION | Changed outside allowed scope or protected file | Reject, document change proposal, require new authorization |
| FILE_OR_CONTRACT_CONFLICT | Overlap with active reservation / incompatible schema | Queue/replan; never overwrite |
| TEST_FAILED | Actual runner non-zero/missing test evidence | Block publication; bounded repair cycle |
| GIT_REMOTE_UNCERTAIN | Push/PR request timed out after possible side effect | Mark RECONCILIATION_REQUIRED; read-only remote proof, no blind repeat |
| MERGE_NOT_VERIFIED | Wrong PR/head/tree/reviews/checks or target advanced | No DONE; repeat independent inspection after explicitly authorized repair |
| ROLLBACK_UNCERTAIN | Rollback branch/PR outcome unknown | Existing read-only reconciliation + real Docker proof, no auto merge |
| MYSQL_UNAVAILABLE | Central authority down | Preserve sealed local outbox; no new claims, promotions, push or merge |
| NODE_UPDATE_INCOMPATIBLE | Old desktop protocol/schema version | Reject mutation; require verified upgrade/downgrade plan |
| SECRET_EXPOSURE | Credentials seen in logs, output or Git | Stop work, revoke, rotate, incident response |
| UNKNOWN_STATE | Conflicting checkpoint/chat/branch/DB | Fail closed, Owner-visible reconciliation |

### Recovery ordering

1. Authenticate returning node/agent and validate current election epoch/task lease.
2. Read authoritative MySQL checkpoint and operation ledger.
3. Inspect local Git tree and remote refs **read-only**; verify referenced exact SHA, tree, branch, repo and PR against external evidence.
4. Compare operation state with reservation and receipts. If already executed, restore proof only; if absent, decide whether a **new explicit authorized** attempt is allowed.
5. Re-run required actual QA when environment, code or timing invalidates earlier proof.
6. Resume only the permitted next action; otherwise block and ask Owner. Record before/after audit event.

An offline Master never transfers live provider cookies to a backup. Successful browser interaction or an unverified local file is not sufficient to resume a ticket at a later lifecycle stage.

## 10. Permissions: Owner change proposal workflow

Change kinds: NORMAL_SCOPED, SHARED_CONTRACT, PROJECT_ARCHITECTURE, CORE_SECURITY, DB_SCHEMA, DEPLOYMENT, DELETE/DESTRUCTIVE, RELEASE, CREDENTIALS.

For any changed scope beyond currently authorized task:
1. Create immutable **change proposal** describing reason, exact file/contract delta, dependencies, affected agents, risks, rollback/test plan and intended Git base.
2. Notify Master and impacted workers; coordinate path/contract lock.
3. Authorize under policy (Master for normal compatible expansion if explicitly permitted; **Owner for CORE_SECURITY, DB_SCHEMA, release, destructive, secret and other protected operations**).
4. Apply only after reservation and refreshed lease/epoch; QA + independent review before protected merge. Revoke and audit invalid attempts.

No "document first, therefore edit freely" loophole. Worker must not access SUTRADHAR core repository when assigned to a separate customer project.

## 11. Central data model and API surface — target only

**Canonical MySQL tables / indexes:** nodes(node_id unique, status), agents(agent_id unique, node_id FK), enrollment_grants, node_heartbeats(node_id/seq unique), leader_state(singleton, epoch), leader_history, backups(rank unique), projects(project_id unique), provider_workspaces(unique project/provider/account/reference), tickets(ticket_id unique, project_id FK, version), task_dependencies, task_leases(ticket_id active uniqueness), path_reservations and contract_reservations (transactional overlap checks), change_proposals, authorizations, test_receipts, git_operation_ledger(unique request_id), checkpoint_history(unique ticket + generation), audit_events(unique event ID), command_ledger(unique actor + request_id), engine_usage, configuration_versions, revocations and release_receipts.

MySQL **InnoDB** transactions, correctly defined unique keys, foreign keys, indexes, deadlock retry with same idempotency key and server time are required. No claim of portable SQLite SQL syntax: migration must specifically implement MySQL semantics and verified schema versions. Avoid remote direct worker MySQL access.

**Proposed control endpoints (not present as such in current code):**
- POST /v7/nodes/enroll ; POST /v7/nodes/heartbeat ; GET /v7/nodes/me
- GET /v7/cluster ; POST /v7/leadership/claim ; POST /v7/leadership/heartbeat ; POST /v7/leadership/reconcile
- POST /v7/projects/propose ; POST /v7/projects/select ; GET /v7/projects
- POST /v7/tasks/plan ; POST /v7/tasks/claim ; POST /v7/tasks/checkpoint ; POST /v7/tasks/submit
- POST /v7/tasks/propose-change ; POST /v7/tasks/authorize ; POST /v7/tasks/qa-receipt ; POST /v7/tasks/reconcile
- POST /v7/git/publish-verified ; POST /v7/git/reconcile ; POST /v7/integration/propose
- POST /v7/owner/command ; POST /v7/telegram/webhook ; GET /v7/audit

These paths are *design candidates*, not compatibility promises. Existing production endpoints must be mapped carefully and not exposed in parallel with divergent authorization semantics.

## 12. Acceptance gates, test responsibility and migration discipline

The [V7 matrix](./V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) contains individual test IDs, expected evidence, priority and owner. Tests must include actual **2 separate machines** before scaling to 8–10; simultaneous enroll/election, network partition and Master crash, malformed task/duplicate/overlap, provider login/limit, Git push timeout, branch conflict and independent protected review. MySQL restore drill and Hostinger deployed HTTPS smoke test are mandatory.

**Migration plan:** inventory SQLite tables and legacy demo reads -> schema/SQL compatibility tests -> MySQL migration with snapshot/hash reconciliation -> dual-read comparison in a non-production environment (never dual authoritative writers) -> cutover with rollback backup -> retire legacy in-memory/SQLite production write paths -> deploy one stateless HTTPS API -> two-node acceptance. Existing protected Git/rollback code must be ported without re-enabling direct main or weakening off-by-default external write gates.

**Evidence vocabulary:** SPECIFIED, CODED, LOCALLY_TESTED, LIVE_ACCEPTED, BLOCKED. A passing mocked-GitHub test is **LOCALLY_TESTED**, not LIVE_ACCEPTED. The owner's final implementation request did **not** authorize deploying to Hostinger, changing credentials, altering protected main, or releasing any project.

**Operational sources and review:** [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [Hostinger Node limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/), [OpenAI terms](https://openai.com/policies/terms-of-use/), [Google embedded authorization guidance](https://developers.google.com/identity/protocols/oauth2/web-server). Reassess service capabilities and terms at provider implementation time.

## 22 November 2026 — Repository-wide task branch reservations (additional coded safeguard)

Central's signed Master `POST /v7/tasks/plan` now serializes the **entire Git repository project set**, even when two SUTRADHAR projects use different base branches for the same `owner/repo`. Distinct tasks may not plan the same `ai/*` publication branch across those projects. The task fingerprint's existing unique MySQL constraint is surfaced as an explicit `TASK_INTENT_DUPLICATE` 409, and a preexisting repository branch is reported as `TASK_REPOSITORY_BRANCH_ALREADY_RESERVED` 409. Transaction rollback leaves no partial dependency or approval effects. Read-only query does not replace a GitHub remote branch check; external Git publication must still independently validate the remote ref, exact tested commit and Owner authorization. Disposable MySQL signed HTTP tests cover both within-project and cross-base branch collisions plus duplicate intent; real GitHub and physical multi-PC acceptance remain HOLD.

## 23 November 2026 — deterministic planning input rejection

The signed Master Task Planner now refuses overlapping write scope entries within a single ticket (for example `src` and `src/x.ts`) and duplicate dependency IDs before any database writes. These would otherwise create ambiguous scope reservations and duplicate dependency DAG edges. The fail-closed error is `TASK_PLANNING_AMBIGUOUS_SCOPE_OR_DEPENDENCIES` (HTTP 400). Independent signed-HTTP + disposable MySQL tests assert both rejections; Master epoch, protected-scope approval, repository-wide branch reservations and worker-claim conflict checks remain separate. No semantic API-contract registry or autonomous scheduler is claimed.

## 23 November 2026 — repository-wide claim scope isolation

MySQL `v7_reservations` retains its existing per-project keys and pinned v7 schema, but `POST /v7/tasks/claim` now locks all projects sharing the same GitHub repository in deterministic order and reads **all their reserved scopes**, including those attached to a different base branch. A same-repository nested or overlapping scope claim is refused with `SCOPE_CONFLICT` before issuing a lease, even if the two tasks belong to separate Owner-created projects. This extends the earlier repository-wide `ai/*` branch reservation policy to actual worker admission. Signed HTTP + disposable MySQL tests cover two distinct project/base-branch configurations with overlapping paths, an independent worker, and preservation of the original claim. It does **not** constitute semantic API-contract conflict detection or real GitHub combined integration acceptance. Owner-approved protected changes and physical acceptance remain HOLD.


## 24 November 2026 — Worker authority, context and recovery contract reconciliation

Source baseline `3465af4` passed application and dependency CI; later `ee2e62f` / `8684dfe` fresh-checkpoint changes await exact-head CI.

- Planning rejects blank, duplicate or malformed acceptance criteria, case-aliased/self dependencies and caller-supplied initial approval IDs. Protected tasks receive a fresh Central-created Owner approval. Eligible dependency-ready tasks are filtered before the 50-row discovery limit.
- Initial provider aliases are Owner-declared, unverified configuration only. Signed task detail exposes only the assigned developer's own binding; Desktop validates digest and excludes mapping metadata from the prompt. Missing/malformed configuration is a hold for provider use. The target durable MySQL mapping registry and provider permission proof are not implemented by this configuration.
- Compact handoff retains exact baseline, ticket version, scope, criteria and latest checkpoint digest under 8 KiB UTF-8; no automatic provider transmission or claim of token count, secret scanning or verified live lease.
- Removing project developer access quarantines unfinished leased work, revokes the lease, preserves checkpoint/candidate/Git/reservations and requires Owner reconciliation. Regrant does not restore old authority. Claim replay and worker mutations recheck current lease and grants.
- Both agent builds and Central validate recovery manifests: exact checkpoint membership and hashes, recognized lifecycle, descending audit event IDs and exact high-water mark; unresolved work/Git holds remain.
- **New submission precondition (coded, CI pending):** after claim/reclaim or failed QA, the worker must save a fresh checkpoint transition to CHECKPOINTED before candidate submission. Central checks latest checkpoint agent, epoch and digest; malformed Unicode is rejected before persistence. Historical checkpoints remain available as handoff, not new authorization. Exact valid submit retries remain idempotent.

No schema alteration, automatic reassignment, provider authorization or release permission is introduced. All original invariants and physical acceptance requirements remain binding.


## Shared contract declaration and claim policy — incremental alpha

Verified previous baseline `93993a0`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700768) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700737) both SUCCESS, including the fresh-checkpoint change. The new shared-contract implementation and regressions are CODED / CI PENDING at this update.

- Signed Master plan accepts optional `contract_keys`: maximum 12 canonical lowercase strings, maximum 96 characters each, `api:`, `db:`, `interface:` or `event:` followed by dot-separated ASCII identifiers. Reject invalid, duplicate or nested-redundant declarations. Store canonical sorted keys in TASK_PLANNED; absent means unclassified, explicit [] means planner declares no shared contract, not verified proof.
- Nonempty keys require Owner approval even for LOW risk; review justification includes the actual declared keys. Existing protected-path policy is unchanged. Intent fingerprint continues to reject duplicate work even if the proposed declaration changes.
- Claim reads declared keys of the requested task and all same-repository reserved tickets under the existing lock. Equal or ancestor/descendant keys within the same namespace conflict; a declared nonempty task also conflicts with an unclassified reservation in either direction. Refuse with SHARED_CONTRACT_CONFLICT before inserting reservations. Missing historical declaration is unclassified; malformed/duplicate plan ledger records and excessive declaration lookup scope hold rather than guessing.
- Existing path reservations remain the single durable lock authority, including quarantine/recovery. Keys are not pseudo-paths, do not change allowed files, and are not a second worker lease. Owner approval does not override conflicts.
- Signed detail returns canonical declaration or null; Desktop validates it and includes non-null keys in the existing 8 KiB compact context, never automatically transmits it.

No automatic semantic inference, verified completeness of declarations, cross-repository dependency lock, measured hosting cost or combined integration acceptance is claimed. Schema v7/v8 unchanged. Original QA and G0–G7 gates remain.


## Owner-managed provider registry — incremental alpha contract

Last fully green source baseline `93993a0`; shared-contract HEAD `01ff1ce` dependency CI succeeded but application CI was cancelled. New provider-registry source is CODED / CI PENDING; verify the latest exact-head workflow results.

- Owner-authenticated GET /v7/owner/provider-registry returns current source, version, non-secret declarations and digest. Version 0 is legacy fallback; it does not export environment bindings. REPLACE_PROVIDER_REGISTRY is web-owner-only, full replacement with exact expected_version; every declaration must match an active project and an approved node/agent with developer grant. Invalid input, stale versions or mismatched grants fail closed. Cluster row serialization and durable idempotency preserve one accepted replacement per version.
- Canonical snapshots are capped at 100 bindings and 16 KiB declaration JSON. A monotonic version and SHA-256 bind sorted declarations in the append-only MySQL ledger. Once initialized, empty replacement is a tombstone; no environment fallback. Corrupt stored state refuses registry reads/returns invalid worker metadata, never grants execution.
- Signed task detail exposes the assigned developer's own declarations only while permitted. Desktop validates registry source/version separately from compact context; metadata does not authorize execution or verify provider mapping. Explicit omission revokes a declaration; it does not revoke a real provider account/session, stop a previously opened browser or prove that a local worktree is safe. Existing project grant revocation and lease fencing remain separate.
- Historical receipts are not fresh authorization. Regrant may make a still-stored unverified declaration visible again; Owner must explicitly remove obsolete declarations. Do not treat a stored snapshot as a live account ACL.

No schema change, automatic provider actions, verified real provider mapping or live acceptance. Dedicated indexed storage, retention/restore performance, dashboard editor and provider interruption recovery remain open. See [Owner instructions](PROVIDER_WORKSPACE_DECLARATIONS_V7.md).


## Owner registry editor contract — incremental alpha

Verified previous source baseline `215e5ee`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116654) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116645) both SUCCESS. New Owner registry editor is CODED / CI PENDING at this update.

- Existing Owner dashboard loads registry by explicit GET only; periodic dashboard refresh does not overwrite local draft. Display source/revision and alias rows with text-only DOM rendering. Client validates bounded alias syntax and conflict rules; Central remains authoritative for exact grants and version.
- Add/remove changes only in-tab draft; review consent resets when inputs or draft change. Save is disabled during requests, without a loaded revision, without review consent, for unchanged initialized lists or while unadded form fields are populated. Initial version 0 requires explicit warning that invisible legacy environment aliases will be superseded.
- Save uses one REPLACE_PROVIDER_REGISTRY command with unique request ID and expected version; no automatic retry. Current GET readback must match accepted receipt ID, next version, digest and complete binding list before success. Rejected, uncertain or superseded outcomes clear the editable snapshot and require explicit reload. This is server readback comparison, not independent cryptographic provider authentication.
- Session generation/key/revision checks discard late GET/POST results after disconnect/reconnect. Credentials, aliases and drafts are not stored persistently by the editor. Disconnect cannot cancel a command already committed. No external login, session revocation, provider authorization or execution; real provider and physical acceptance remain open.

Tests in tests/v7_owner_dashboard_session.test.cjs model local draft, explicit consent, CAS, concurrent revision, malformed response and stale session. No real-browser acceptance claimed; G0–G7 HOLD.


## Manual provider attempt and interruption contract — incremental alpha

Verified previous baseline `e935cef`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765773) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765743) both SUCCESS. New manual attempt source is CODED / CI PENDING at this update.

- POST /v7/tasks/provider-attempt uses node signature, current live original lease, Master epoch, exact agent and ticket, and durable command receipt. BEGIN requires CHECKPOINTED, current durable registry version and matching declaration digest, exact latest checkpoint generation/hash and non-secret operator-supplied context SHA-256. Strict field allowlist; no raw prompt, response, provider chat ID, credentials or quota claim. Only one unresolved recorded attempt per ticket.
- INTERRUPT changes OPEN to INTERRUPTED on the same lease; absent crash report leaves OPEN. CLOSE requires same live lease and epoch, exact attempt ID, independently reviewed worktree/session assertions and a strictly newer valid checkpoint generation. Neither action triggers provider calls. Historical receipt is not fresh authorization; read current task detail.
- Unresolved state holds new BEGIN, claim, TASK_SUBMIT, normal RECONCILE_TICKET and Desktop compact handoff. Lease renewal/checkpoint remain possible. Existing lease and Git/QA fences remain independent; a closed record never creates a lease or QA receipt.
- Owner-only GET /v7/owner/provider-attempt/:ticketId observes latest attempt; RESOLVE_PROVIDER_ATTEMPT requires RECONCILIATION_REQUIRED and revoked original lease, matching attempt ID and explicit external-session/worktree/no-auto-retry review. Closure alone does not release reservation or reassign. Normal reconciliation still requires existing external Git review and no frozen candidate/QA artifact.
- Trusted developer CLI uses explicit signed mutation followed by current detail readback and refuses automatic retry. Packaged Desktop task detail validates non-secret attempt metadata and blocks new compact handoff while unresolved. Record history is opt-in; absence of record is not proof of absence of external activity. Context digest is not verified against transmitted bytes. No provider login, session restoration, automatic continuation or external side effects.

Existing MySQL event ledger reused without schema migration. Dedicated indexed storage, backup/restore and retention review, actual provider verification, packaged Desktop mutation controls, Owner resolution UI, physical acceptance and token accounting remain open. G0–G7 HOLD.


## Owner provider recovery dashboard contract — incremental alpha

Previous HEAD `82e2a8c` failed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188656) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188901) on TS18049 strict-null diagnostics; disposable MySQL integration and unsigned Windows smoke passed. Explicit return guards (`4d05bde`) correct the reported paths; combined CI verification of the fix and new UI remains pending. Last fully green baseline `e935cef`.

- Read-only Owner GET /v7/owner/provider-attempt/:ticketId supplies owner_resolution_eligible only when ticket state is RECONCILIATION_REQUIRED, attempt unresolved, and original matching lease revoked. No execution, mapping verification or reassignment authorization. GET is not permission to mutate; POST rechecks current state.
- Dashboard requires exact ticket observation, retyped full attempt ID, independent session and worktree review, no-auto-retry attestation and explicit confirmation. It sends one RESOLVE_PROVIDER_ATTEMPT POST; checks receipt ID, exact ticket/attempt and closure-only flags; verifies current readback of CLOSED with OWNER_REVIEW. Unknown/mismatched outcomes require fresh inspection, never automatic retry. Session generation, key and revision guards suppress stale results; logout clears local review, not already committed MySQL state.
- No provider credentials/session contents in UI; no ordinary ticket requeue, reservation release, QA/Git change or external provider action. Original manual worker recovery remains separate. Real provider identity/session and actual context/usage are not verified.

Tests in tests/v7_owner_dashboard_session.test.cjs and tests/v7_mysql_integration.test.ts cover eligibility, review, duplicate suppression, mismatch and logout. Source CI pending; no physical acceptance. G0–G7 HOLD.


## Packaged Desktop attempt and context admission contract — consolidated alpha

Verified exact baseline `1193b3b`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215514) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215696) both SUCCESS. New consolidated Desktop/provider admission batch is CODED / EXACT-HEAD CI PENDING.

- Existing packaged Windows/main-only worker boundary: require enrolled OS-vault agent, recent Central acknowledgement, no local maintenance or installer incident hold, native explicit confirmation, single worker-operation busy guard, original sealed receipt, signed resume observation with exact lease echo, and original trusted local Git worktree. Recheck origin and local operation fences after asynchronous preflight. No missing worktree recreation in attempt recovery.
- Main computes compact context from current signed task metadata and validates exact reviewed digest. Review metadata is retained only in memory and bound to Central origin, exact agent/ticket, registry revision and provider binding digest. Changes in task/registry/mapping invalidate review. Separate readonly renderer context field excludes local registry metadata. The 8192-byte budget is not a token budget, secret scan or proof of transmitted bytes.
- BEGIN signed request now requires integer expected_task_version matching locked ticket, in addition to existing exact live lease, current epoch, provider registry revision, binding digest, checkpoint generation/digest and context digest. Rebuild Central/CLI/Desktop together; older BEGIN requests lacking the new field are refused. INTERRUPT/CLOSE use exact attempt ID; closure requires fresh checkpoint and explicit native worktree/external-session review.
- Fixed signer URI and strict exact body; no arbitrary renderer/heartbeat-child signing. One mutation followed by exact current readback; ambiguity holds further blind retries. Do not expose lease ID or private key via renderer. Worker response decoder rejects invalid UTF-8.
- These are manual local records, not provider requests, verified provider account/workspace identity or external session restoration. Owner revoked-lease review remains separate. Tests in tests/desktop_worker_claim.test.cjs and tests/v7_mysql_integration.test.ts cover stale reviewed digest/registry, lease echo, local fence, one unresolved attempt, fresh checkpoint, lost reply and stale expected_task_version. Source CI pending; no physical acceptance.

Additional safeguards `5432a9a`, `2651e1e`, `7768fb2`: main retains only the reviewed preview's in-memory task/origin/digest/registry-version/binding-digest metadata; a changed registry revision or binding blocks BEGIN even when compact context bytes match. Recovery refuses a missing original worktree rather than recreating it. These safeguards and regression fixtures also await exact-head CI. G0–G7 HOLD.


## Master batch planning contract — incremental alpha

Previous exact HEAD `8145c64`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963696) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963719) were cancelled. Before cancellation the real MySQL and Python/shell/state jobs passed, while the TypeScript/unit/build job failed at Desktop security validation: obsolete static regex expected a ternary that had been replaced by the reviewed-context guard. Test correction `b4ec4ae` preserves the security assertions. Last fully green combined baseline `1193b3b`. New planner and correction are CODED / EXACT-HEAD CI PENDING.

- Current approved READY Master only; signed POST /v7/tasks/plan-batch/preview with exact agent_id, project_id, request_id, expected_master_epoch, tasks; POST /v7/tasks/plan-batch adds exact preview_sha256. Two to ten tasks; serialized task input at most 65536 bytes. Task fields: ticket_id, baseline_sha, branch_name, title, description, risk, write_scopes, acceptance_criteria, dependencies, contract_keys. Explicit arrays required for both declarations. Single-ticket route shares validation and admission; legacy missing declarations remain legacy/unclassified there.
- Deterministic order by exact ticket ID among eligible DAG nodes. Reject internal cycles, aliases, duplicate ID/branch/intent, overlapping paths or shared contracts without transitive dependency order. Existing dependency must resolve to exact ticket/project and not CANCELLED. Single plan and claim now check exact identity rather than SQL case-insensitive aliases; node signature lookup also binds exact node ID. No invented dependency or semantic completeness proof.
- Preview reports per-ticket approval requirements, normalized digest and order; no ticket/approval mutation (normal signature nonce still recorded). Commit requires digest match, current Master and project, rechecks branch/intent/dependency state, persists whole batch and one idempotent command receipt atomically. Final DB-clock Master lease recheck occurs before finalizing new receipt. Identical retry on current authority may retrieve prior receipt; no automatic retry or task execution.
- Owner approval still required for protected/high/core or declared shared contract change. READY is not permission to claim until upstream DONE, current approved worker lease and reservations pass. Baselines remain immutable and independently reviewed; DONE does not prove a later task contains upstream code. Independent combined QA and protected Git review remain required.
- Trusted CLI manifest preview and explicit CONFIRM_PLAN commit (see [operator guide](MASTER_TASK_BATCH_PLANNING_V7.md)); no generic new signer endpoint in Desktop, automatic provider calls, or schema changes. Unit and disposable MySQL regressions coded; exact-head CI pending. G0–G7 HOLD.


## Desktop Master batch review and historical receipt contract

Exact baseline `804726e` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312420) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312581), including previous Desktop correction and Master batch admission. New Desktop Master planner and receipt lookup are CODED / EXACT-HEAD CI PENDING.

- Current signed READY Master, approved local packaged Windows OS-vault identity, heartbeat and local maintenance/installer fences required for preview/admission. Main-only fixed signer allows exact bounded request fields, 2–10 tasks and 64 KiB task payload; no arbitrary request URL or heartbeat-child signing.
- Main reads current cluster epoch, verifies ordered ticket IDs, declared dependencies, scopes and canonical contracts, flags and approval states. Pins original body, preview digest and Central origin in memory. Renderer cannot submit a replacement commit body; native confirmation required, final local fences checked. Draft/selection changes invalidate UI review. Commit verifies exact receipt IDs/order/approval states and digest; uncertain result requires inspection, no automatic retry.
- Signed POST /v7/tasks/plan-batch/receipt with exact agent_id, project_id, request_id and preview_sha256 observes an original durable TASK_PLAN_BATCH receipt. Central checks exact approved node/agent, no drain, original actor/request and stored digest/shape. It can be observed after demotion, but does not grant current authority or certify current ticket states. Missing/wrong digest or foreign actor denied. Normal authentication nonce persists; no ticket/approval mutation.
- Local draft is in-memory only; operator retains original draft, request ID and digest privately. No credentials in task text. Revoked/unavailable original signer requires Owner escalation. Immutable baseline review, actual source-level dependency discovery, independent QA and production acceptance remain separate. Tests in tests/desktop_worker_claim.test.cjs and tests/v7_mysql_integration.test.ts await exact-head CI. G0–G7 HOLD.


## Master reviewed admission journal and catalog contract

Exact baseline `0fc7c7a` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325287) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325508), including the previous Desktop Master planner and historical receipt lookup. New project catalog and admission journal changes are CODED / EXACT-HEAD CI PENDING.

- POST /v7/tasks/plan-batch/projects accepts exactly agent_id, expected_master_epoch. Current approved READY Master, exact node/agent, maintenance and DB-clock epoch/lease checks. Returns read-only minimal active project records (project_id, display_name, repository, base_branch), at most 100 with truncation. No grant, credentials, provider mappings or baseline attestation.
- Electron main-only signer/client verifies catalog identity, epoch, shape, IDs and bounds; renderer project picker is display-only until normal signed preview. Existing exact ID entry remains supported.
- After native confirmation and before any admission POST, the main process writes an exclusive, encrypted and fsynced reviewed intent with exact original node, Central origin, body and preview review to a dedicated local journal and verifies readback. One unresolved intent blocks preview/new admission. The exact validated historical receipt is written separately and read back; no automated replay or deletion. Existing immutable evidence cannot be overwritten. Corrupt, orphaned or ambiguous evidence holds the workflow.
- On restart, original approved agent/Central may restore the reviewed draft and exact identifiers without sending an admission. Exact historical receipt lookup closes the local journal only on matching project/request/digest/epoch/order/approval statuses. Missing receipt is not non-admission proof; unavailable original signer, no receipt, corruption or failed write require separate Owner reconciliation. Unconfirmed draft edits are not persisted.
- Per-record encrypted limit 65,536 bytes; inventory cap 256 entries, no retention automation. The filesystem/OS safeStorage remains a trusted local boundary, not tamper-proof proof of actual remote state. Physical power-cut and DPAPI acceptance remain open. Existing claim/approval/QA and immutable baseline verification remain separate. Tests in tests/desktop_worker_claim.test.cjs and tests/v7_mysql_integration.test.ts await exact-head CI. G0–G7 HOLD.


## Owner interrupted Master admission reconciliation contract

Exact baseline `85ae5a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705079) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705150), including encrypted Master admission journal and signed project catalog. New Owner reconciliation batch is CODED / EXACT-HEAD CI PENDING.

- Web Owner authenticated POST /v7/owner/master-batch/inspect with exact agent_id, project_id, request_id, preview_sha256, plan_order (2–10 unique exact IDs). No mutation of tasks/commands by observation. Exact original agent/project and request key; existing receipt/digest/order checked. States ADMITTED, HOLD_TICKET_CONFLICT, NO_RECEIPT, ADMISSION_CANCELLED.
- Only web Owner command CANCEL_MASTER_BATCH_ADMISSION with those exact fields plus evidence_reviewed/no_retry_confirmed true can record a cancellation. Under the leader lock, recheck no existing command or listed tickets (including aliases). Insert distinct TASK_PLAN_BATCH_CANCELLED operation in original actor/request namespace, resolution, and TASK_BATCH_ADMISSION_CANCELLED event atomically with Owner receipt. Replays of same Owner command retain receipt; occupied preview/delayed admission is refused.
- Dashboard requires exact observation, two review assertions, explicit confirmation, session/revision fence and exact resolution readback. Failure/uncertainty requires reinspection, not automatic retries.
- Original signed POST /v7/tasks/plan-batch/receipt returns admitted receipt or distinct resolution with no execution permission. Original approved node/agent and no drain remain mandatory. Desktop validates exact identifiers and ordered tickets against local journal, writes separate encrypted resolution evidence, and closes only after readback. No admission or execution occurs from cancellation.
- Cancellation is a permanent deny marker for the exact original actor/request key, not proof of historical non-admission after database loss/restore. Owner must independently compare original local journal, ordered IDs, preview digest, database history and uncertain effects; server checks the current durable ledger and listed ticket IDs, not the full original task manifest. A wrong cancellation declaration is not automatically corrected. No existing tickets are deleted, no replacement work authorized, and an unavailable/revoked original signer cannot automatically release its local journal. Retention and physical DPAPI/power-cut acceptance remain open. Tests in MySQL, Desktop worker and Owner dashboard session suites coded; exact-head CI pending. G0–G7 HOLD.

## Desktop local baseline and exact project lookup contract

Exact baseline `a77d3a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558734) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558666), including previous Owner admission reconciliation. New local baseline and exact project lookup changes are CODED / EXACT-HEAD CI PENDING.

- POST /v7/tasks/plan-batch/project accepts exactly agent_id, expected_master_epoch and project_id; requires current approved READY Master, live lease and no drain. Exact active project match (no aliases), minimal project_id/display_name/repository/base_branch, no execution or baseline attestation.
- Electron main uses fixed OS-vault signer and signed cluster observation, validates response, selects trusted local Git root natively and reads configured origin, refs/remotes/origin/<base>, immutable commit and tree. Reject wrong root/origin, unsafe ref, missing object, invalid or changed tracking ref. Disable Git transport protocols, replacement objects, injected environment overrides and optional locks. No fetch/checkout/project commands.
- Main pins observation and rechecks exact signed project identity, Master epoch and local ref at preview and before journal.begin/admission; all Desktop task baseline SHAs must equal observed SHA. Internal dependency report never asserts upstream code inclusion. UI invalidates review on selection changes and requires independent human review.
- Local verification observes the configured repository origin, local remote-tracking ref, commit and tree only. It is not live GitHub freshness, an independent remote attestation, source-level semantic analysis, or proof that upstream changes are included. Desktop batches now require every task to use the same inspected tracking-ref SHA; if a dependent task needs not-yet-merged code, plan it separately after upstream merge and review. Central and CLI planning contracts remain unchanged except for the additional signed project lookup; no baseline evidence is persisted in Central or the admission journal beyond the task's existing baseline SHA. Tests in Desktop worker and MySQL integration suites await exact-head CI. Physical Windows/remote acceptance remains separate. G0–G7 HOLD.
