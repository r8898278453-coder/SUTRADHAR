# SUTRADHAR v7.0 — Authoritative Agent, Task, QA & Recovery Contract

**Date:** 2026-11-11  
**Status:** TARGET CONTRACT / DESIGN ONLY; current code does not implement all endpoints, tables, statuses or guarantees.  
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
