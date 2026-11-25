# SUTRADHAR v7 — Master task batch planning (staging alpha)

## Status and operating boundary

CODED / exact-head CI pending. The Master manually prepares a manifest; this is deterministic validation, not autonomous task decomposition, source-code analysis, semantic completeness proof or execution. Central remains the authority. No new schema, provider calls, Git mutation, task claims, production deployment or release approval. G0–G7 HOLD.

## Prepare one project batch

Use an already approved current Master on a trusted developer CLI machine. Build Central and CLI from the same reviewed source. Independently review the project ID, repository, actual baseline commit(s), complete write paths, shared contracts, dependencies and acceptance criteria. Save a private UTF-8 JSON file (do not put credentials or private provider content in the file). Retain the exact request ID and file until the outcome is reconciled.

Example manifest (replace all illustrative IDs, paths, baselines and descriptions):

```json
{
  "request_id": "batch_example_001",
  "project_id": "project_example",
  "expected_master_epoch": 7,
  "tasks": [
    {
      "ticket_id": "ticket_example_a",
      "baseline_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "branch_name": "ai/example_a",
      "title": "Add inventory interface",
      "description": "Review and implement the scoped inventory contract.",
      "risk": "MEDIUM",
      "write_scopes": ["src/inventory.ts"],
      "acceptance_criteria": ["Inventory contract tests pass"],
      "dependencies": [],
      "contract_keys": ["api:inventory"]
    },
    {
      "ticket_id": "ticket_example_b",
      "baseline_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "branch_name": "ai/example_b",
      "title": "Add inventory tests",
      "description": "Verify the exact inventory contract and negative cases.",
      "risk": "LOW",
      "write_scopes": ["tests/inventory.test.ts"],
      "acceptance_criteria": ["Missing inventory records are rejected"],
      "dependencies": ["ticket_example_a"],
      "contract_keys": ["api:inventory"]
    }
  ]
}
```

The example SHA is not a real verified baseline. A dependency becoming DONE does not update another ticket's immutable baseline or prove the baseline contains the upstream change. Independently determine whether dependent work is valid at its chosen baseline; if not, plan the downstream ticket separately after upstream merge and review. Never automatically rebase or expand write scopes.

## Preview and commit

1. On the trusted developer CLI with its existing enrolled identity, run `npm run edge:worker -- plan-batch-preview AGENT_ID MANIFEST_FILE`. Inspect the complete original manifest and the returned ordered tickets, path/contract declarations, approval requirements, and preview SHA-256. The preview is read-only with respect to tickets/approvals; signed authentication still records its nonce.
2. If the preview is rejected, correct the manifest before any commit. A batch has 2–10 tasks and a 64 KiB serialized tasks ceiling; CLI file ceiling is 70,000 bytes. Each task has exact fields and must explicitly declare dependencies and contract_keys (empty lists mean the planner declared none). The batch rejects duplicate or case-aliased IDs/branches, duplicate intent, internal cycles, nonexistent or cross-project/case-aliased existing dependencies, cancelled dependencies, and overlapping path/contract pairs without a transitive in-batch dependency. It never silently invents a dependency.
3. After independently reviewing every field and digest, run `npm run edge:worker -- plan-batch-commit AGENT_ID MANIFEST_FILE PREVIEW_SHA256 CONFIRM_PLAN`. The same exact manifest/request ID and current Master epoch must be retained. Central revalidates all rules, branch/project state, approvals and dependencies transactionally. Either every ticket, approval, dependency, event and command receipt is persisted or all roll back. The final DB-clock Master lease check happens before receipt finalization.
4. If the response is uncertain, preserve the manifest, request ID and digest; inspect Central first. Only an identical signed retry on still-current authority can retrieve the same receipt. Do not create a fresh request ID or alter the payload to bypass a possible prior admission. The preview does not reserve resources.
5. WAITING_AUTHORIZATION requires the existing separate Owner approval. READY is a lifecycle state, not an execution grant: dependencies must reach DONE, exact live worker lease and reservation checks must pass, and independent QA/Git controls remain mandatory. Parallel-safe here means declared conflicts have explicit dependency order, not proof of source-level independence.

## API and acceptance

Signed current-Master POST /v7/tasks/plan-batch/preview accepts agent_id, request_id, project_id, expected_master_epoch, tasks. POST /v7/tasks/plan-batch requires those exact fields plus preview_sha256. Preview and commit use identical normalized content binding; changing meaningful task fields or Master/project/request identity invalidates the digest. A preview is not a durable approval, resource reservation or independently verified baseline.

Unit tests: tests/v7_rules.test.ts. Disposable MySQL tests: tests/v7_mysql_integration.test.ts. They cover deterministic topology, conflict reachability, malformed declarations, exact identity, stale preview, concurrent receipt replay, blocked dependent claim and complete rollback on late branch collision. Real Master/operator UI, autonomous decomposition and semantic discovery, independently verified baseline and combined QA, physical failover and live acceptance are still open. No production change.


## Packaged Desktop Master planner (manual staging alpha)

Exact baseline `804726e` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312420) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312581), including previous Desktop correction and Master batch admission. New Desktop Master planner and receipt lookup are CODED / EXACT-HEAD CI PENDING.

1. On the current approved Master PC with a healthy signed Central heartbeat and no maintenance hold, select its local agent. Open **Master task batch planner** under My development tasks.
2. Enter the exact existing project ID and unique batch request ID. Fill task fields and click **Add task to local draft** for each of 2–10 tasks. List scopes, criteria, dependencies and contract keys one per line. Review the entire read-only draft; remove the last draft task if it needs correction. Do not put secrets in task text. Baseline commits must be independently verified by the operator; the UI does not verify Git.
3. Click **Validate and preview exact batch**. Electron main obtains the current signed cluster observation; Central independently checks Master authority and all planning rules. Review ordered tickets and Owner-approval requirements along with all draft fields. Retain exact project, original agent, request ID, draft and digest privately. The preview is not a reservation.
4. Check the independent-review box and click **Confirm exact reviewed batch**. Native confirmation is required. Main submits the stored reviewed payload, not a replacement renderer payload; selection/draft changes invalidate renderer review. Central rechecks current authority and admits atomically. No claims, provider actions, execution or Git operations occur.
5. If admission is uncertain or after a restart, enter the same original agent, exact project, request ID and preview digest and click **Inspect historical admission receipt (no mutation)**. This is a signed read-only observation of the original durable command receipt. It does not require the original Master still to be Master, but the original agent and PC must remain approved and not drained. A missing/mismatched receipt is not permission to create a replacement batch. Consult Owner if the original signer is unavailable. The receipt is historical, not current ticket state or execution permission.

The local draft/review is in memory; there is no durable Desktop draft journal or automatic retry. Retain the original draft and identifiers before committing. Server and Desktop must be rebuilt together. Existing CLI manifest path remains available. New receipt endpoint POST /v7/tasks/plan-batch/receipt requires exact agent_id, project_id, request_id and preview_sha256; it verifies original actor and durable batch receipt. Signature nonces are still recorded. No source-level semantic discovery, autonomous planning, verified baseline or production acceptance. G0–G7 HOLD.


## Restart-safe reviewed admission and current-Master project picker

Exact baseline `0fc7c7a` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325287) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325508), including the previous Desktop Master planner and historical receipt lookup. New project catalog and admission journal changes are CODED / EXACT-HEAD CI PENDING.

1. Select the approved current Master agent, click **Load active projects (current Master only)** and choose the exact project by name, repository, base branch and immutable ID. The signed catalog returns at most 100 ACTIVE projects, sorted by ID. A truncated catalog is labelled; exact ID entry remains available. No Owner key, grant or provider mapping is returned. The catalog does not verify a baseline or grant execution permission.
2. Prepare and preview 2–10 tasks, independently review the Git baseline, dependencies, shared contracts and criteria, then confirm natively. Before any admission POST, main encrypts and fsyncs the exact reviewed task body and preview receipt in the per-PC `node/master-batch-journal` using OS safeStorage. It reads the original intent back. Only one unresolved intent is permitted on this PC. A successful exact receipt is stored as a separate encrypted, append-only record. No automatic deletion or automatic retry.
3. After crash/restart or an uncertain response, select the original approved agent on the original Central and click **Recover pending reviewed batch after restart**. The original project, request, draft, epoch and digest are restored for inspection, not submission. Click **Inspect historical admission receipt**. The exact verified historical receipt closes the local hold. A missing receipt is not proof of non-admission; preserve the journal and escalate to Owner. A revoked/unavailable original signer or corrupt/incomplete evidence also requires Owner review. No automatic replacement admission, journal deletion, or bypass.
4. Unconfirmed form edits and preview-only drafts are not durable. The native confirmation is the durability boundary. If a local evidence write fails, no admission is sent from that invocation; an incomplete intent may require manual Owner reconciliation. Each encrypted record is capped at 65,536 bytes; an oversized reviewed batch must be reduced before admission. The directory inventory is capped at 256 entries; retention/archive policy and physical Windows power-cut/DPAPI verification are not yet accepted. The local filesystem remains a trusted boundary, not a tamper-proof proof of remote state.

Server endpoint POST /v7/tasks/plan-batch/projects accepts exactly agent_id and expected_master_epoch; current approved READY Master, live epoch and maintenance gates are independently checked. All previous transaction, approval, dependency, claim and QA controls remain mandatory. Baseline and semantic completeness are unverified. G0–G7 HOLD.


## Owner reconciliation of unresolved Master admission

Exact baseline `85ae5a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705079) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705150), including encrypted Master admission journal and signed project catalog. New Owner reconciliation batch is CODED / EXACT-HEAD CI PENDING.

1. On the original approved Desktop, recover the pending reviewed draft. Copy the displayed original agent, exact project, request ID, preview SHA-256 and ordered ticket IDs (one per line) into the Central Owner dashboard's **Interrupted Master admission — Owner reconciliation** panel. Preserve the encrypted local evidence.
2. Click **Inspect historical admission**. ADMITTED means an existing historical receipt; do not cancel or duplicate. HOLD_TICKET_CONFLICT means at least one listed ticket ID exists; do not cancel. NO_RECEIPT means the current database contains neither the request receipt nor the listed ticket IDs. This is not proof of non-admission. ADMISSION_CANCELLED identifies a permanent recorded cancellation.
3. Only after independently reviewing the exact journal, current database and restore history, and uncertain effects, select both review confirmations and confirm **Record permanent admission cancellation ONLY**. The web-only Owner command `CANCEL_MASTER_BATCH_ADMISSION` acquires the same leader lock as batch admission, rechecks original identity/key and listed tickets, then atomically inserts a denial marker in the original actor/request namespace and an audit event. Existing admission or another occupied key cannot be overwritten. Concurrent identical Owner command replay returns the original receipt; a delayed original admission or reused preview is refused.
4. On the original still-approved Desktop, use **Inspect historical admission receipt**. The signed lookup returns a distinct cancellation resolution rather than an admitted ticket receipt. Main validates exact original agent/project/request/digest/order and stores a separate encrypted closure record. No task is created, deleted, claimed or automatically retried. A missing/mismatched/uncertain result remains HOLD; inspect again or escalate, never delete evidence.

Cancellation is a permanent deny marker for the exact original actor/request key, not proof of historical non-admission after database loss/restore. Owner must independently compare original local journal, ordered IDs, preview digest, database history and uncertain effects; server checks the current durable ledger and listed ticket IDs, not the full original task manifest. A wrong cancellation declaration is not automatically corrected. No existing tickets are deleted, no replacement work authorized, and an unavailable/revoked original signer cannot automatically release its local journal. Retention and physical DPAPI/power-cut acceptance remain open.

POST /v7/owner/master-batch/inspect is an authenticated read-only observation with exact agent_id, project_id, request_id, preview_sha256 and plan_order. Owner command requires those fields plus evidence_reviewed and no_retry_confirmed true. Original signed receipt endpoint remains unchanged for historical admitted receipts; cancelled requests return resolution instead. Rebuild Central/Desktop together. G0–G7 HOLD.

## Local Git baseline preflight (Desktop)

Exact baseline `a77d3a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558734) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558666), including previous Owner admission reconciliation. New local baseline and exact project lookup changes are CODED / EXACT-HEAD CI PENDING.

1. Select the approved current Master and exact active project ID. Click **Inspect trusted local Git checkout (no network)**. Electron main obtains a signed exact project lookup, independent of the 100-project catalog limit; choose the already-trusted local Git repository root in the native folder picker.
2. Inspect the displayed configured repository, base tracking ref, commit SHA and tree SHA. The local origin URL must match the signed project repository. No fetch, checkout, reset, worktree creation, project command, provider action or publication is performed. A missing tracking ref, non-commit, invalid tree, wrong root/origin or changed ref blocks observation. Independently check remote freshness using approved Git operations outside this tool.
3. Use the exact displayed baseline SHA for every task in this Desktop batch. Preview rechecks the signed project, Master epoch, local ref and task baseline equality; changed evidence requires reinspection. Review all task scopes, dependencies and criteria. Internal dependency edges are displayed as order-only evidence; future upstream code inclusion is explicitly unverified.
4. Native confirmation and commit recheck the same signed project, epoch, local checkout and SHA before the encrypted admission intent and POST. Existing approval, dependency, claim, QA and Git controls still apply. No checkout path is sent to Central or returned to the renderer. On uncertain admission follow the existing encrypted journal / Owner reconciliation flow, not a retry.

Local verification observes the configured repository origin, local remote-tracking ref, commit and tree only. It is not live GitHub freshness, an independent remote attestation, source-level semantic analysis, or proof that upstream changes are included. Desktop batches now require every task to use the same inspected tracking-ref SHA; if a dependent task needs not-yet-merged code, plan it separately after upstream merge and review. Central and CLI planning contracts remain unchanged except for the additional signed project lookup; no baseline evidence is persisted in Central or the admission journal beyond the task's existing baseline SHA.

Unconfirmed drafts remain in memory. Rebuild Central/Desktop together. G0–G7 HOLD.

## Encrypted unconfirmed drafts and local source dependency hints

Exact baseline `6c996cb` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717874) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717690), including the Desktop Git baseline preflight. New encrypted unconfirmed draft and bounded source-hint changes are CODED / EXACT-HEAD CI PENDING.

1. Enter exact project/request identifiers, add tasks, and leave unfinished task fields as needed. Click **Save unconfirmed local draft**. Desktop main saves the added tasks and unfinished editor fields only; no preview/digest authority or checkout path is stored. On a revision conflict, load the existing snapshot before replacing it. No silent overwrite of an unknown revision.
2. After restart, select the same approved local agent and Central, then **Load saved unconfirmed draft**. Confirm replacement of current unsaved fields. Reinspect the trusted local Git baseline and obtain a fresh Central preview before admission. Do not reuse an already admitted/cancelled request key. A pending confirmed admission takes priority: use the separate pending admission recovery procedure first.
3. After the current draft uses the same inspected local tracking-ref SHA, click **Inspect local relative-import hints (no AI or network Git)**. Review cross-task import and shared-import path hints. Decide whether scopes, shared contracts, dependencies or downstream planning should change. The system does not change the draft or authorize work. Reinspect when the draft/baseline changes.

Explicit save only; no autosave. The latest saved unconfirmed snapshot per node/Central/agent is encrypted, CAS-revisioned, and bounded to 60,000 UTF-8 JSON bytes and 65,536 encrypted bytes. A pending admission journal blocks draft save/restore. Restoring an unconfirmed snapshot never restores baseline observation, reviewed preview, Owner consent, or admission/execution authority. An interrupted/corrupt draft write remains a local Owner-review hold. Saved task content may contain sensitive material; do not enter credentials or provider secrets. Physical Windows DPAPI/power-cut and retention/recovery of corrupt snapshots remain open.

Source hints are lexical, not an AST or complete dependency graph: inspect immutable Git tree/blob objects for scoped JS/TS-family regular files, at most 12 files, 16 KiB per blob, 1 MiB tree listing and 40 hints. Relative static/literal imports only; comments/strings may cause false positives, package aliases, generated code, other languages, dynamic paths and unscanned files may cause false negatives. Only paths, task IDs, counts and commit/tree IDs are returned; no source content, provider send, automatic dependency insertion, task creation or Git mutation. The report does not prove semantic independence, upstream inclusion or remote freshness; no measured provider token reduction is claimed.

This supersedes earlier in-memory-only statements for explicitly saved unconfirmed drafts. Unsaved edits remain in memory. No Central schema change or release. G0–G7 HOLD.

## Declared dependency review and compact planning context

Exact baseline `babd15b` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449293) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449341). Encrypted unconfirmed draft storage and lexical source hints are source-CI verified. New advisory graph, fair sampling and compact context changes are CODED / EXACT-HEAD CI PENDING.

After inspecting the local baseline and adding 2–10 complete tasks, click **Inspect local relative-import hints**. Review per-task scanned/scoped counts (the 12-file global cap is unchanged), potential source relationships, declared dependency waves, connected review groups, unordered case-insensitive path overlaps and hierarchical shared-contract overlaps. Resolve conflicts by independently changing declarations or deferring downstream tasks. External dependencies must be checked in Central; cycles and case aliases are rejected. Empty hints never prove independence.

Click **Prepare compact planning context (local preview only)** to produce a bounded exact JSON handoff. Each task inherits the top-level baseline_sha. Copy manually only after reviewing for sensitive data and verifying provider permission; no automatic upload. If the byte budget is exceeded, split and independently review the draft. Explicit local compact planning preview hoists one shared baseline SHA and retains all exact task strings, order, scope, risk, contracts, dependencies and criteria. It reports exact UTF-8 bytes, difference versus expanded compact JSON and SHA-256; cap 16,384 bytes, fail closed rather than truncate. No token count or actual provider savings verified, no secret scan, no automatic transmission. Independent secret review is required before any manual sharing. Draft/review changes invalidate the displayed preview. Existing signed Central admission, approval, dependency and worker reservations remain authoritative.

Declared dependency waves are a topological view of internal declared edges only, not dispatch waves. External dependencies remain unverified, unordered path/contract conflicts require review, and connected review groups are not a safe parallel execution guarantee. Source hints remain bounded lexical evidence, not AST or semantic proof; round-robin sampling improves task coverage but does not guarantee complete coverage. No task decomposition, automatic edge insertion, claim, Git mutation or provider action is authorized. G0–G7 HOLD.

## Planning context versus observed provider usage

Exact baseline `8e897c8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45492514727) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45492514610). Advisory planning graph, fair source sampling and compact context are source-CI verified. New Owner-attested provider usage history is CODED / EXACT-HEAD CI PENDING.

Compact planning context bytes are not token counts. For tracked closed worker provider attempts, use the separate [Owner usage observation workflow](PROVIDER_WORKSPACE_DECLARATIONS_V7.md#independently-observed-per-attempt-usage-owner-web). No provider token estimate is inferred from context size. Untracked or unavailable readings remain unknown. G0–G7 HOLD.


## 25 November 2026 — developer AST hint inspection

Starting exact HEAD `d1daa265` independently passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45495746438) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45495746128). The Owner-attested usage ledger is source-CI verified on that HEAD.

- `4e08d02`, `261e10b`: developer-only TypeScript AST parser, conservative relative module resolution, immutable Git object inspection, strict bounded inputs, path and encoding checks, explicit missing/ambiguous/unsupported statuses. No provider transmission, source-content export, worktree mutation, task dispatch or remote freshness proof.
- `27426f2`: 161 regression scenarios (syntax forms, comment/string decoys, unsupported references, path/extension ambiguity, bounds and real local Git snapshot). These are test cases, not 161 completed implementation tasks.
- `537f10c`: integrated regression suite into `npm run test:v7`; added `npm run ops:master-ast-hints`.

**CODED / EXACT-HEAD CI PENDING** until an independently observed successful run on the final source. Developer-only: relies on locked TypeScript dev dependency, not installed Electron runtime; existing Desktop lexical hints are unchanged. This is syntactic evidence, not type-checker resolution, scope binding, contract inference or semantic independence. V7-GAP-05/07/08 remain PARTIAL/OPEN; autonomous task decomposition, integrated Desktop AST, upstream proof, combined QA remain open. No production gate promoted. See [AST operator instructions](MASTER_AST_HINTS_V7.md). G0–G7 HOLD.


## 25 November 2026 — bulk advisory backlog review and exact group extraction

Previous exact HEAD `574f2f4` independently verified [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45498263195) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45498263106) SUCCESS, including developer AST inspection. New bulk review changes are CODED / EXACT-HEAD CI PENDING.

| Workstream | Source commits | Status |
|---|---|---|
| Global declared DAG, 2–100 tasks, shared baseline, deterministic review groups, cross-group dependencies and full conflict pairs | f446be1, 5a3be59 | CODED / CI PENDING |
| Strict bounded offline JSON command and CI integration | e65c5d0, 5af6c05 | CODED / CI PENDING |
| Exact digest-bound group selection and local export, preserving fields and related conflicts | c2d9394, 0718f05 | CODED / CI PENDING |
| 86 regression scenarios including 50/100 tasks, 4950 conflicts, stale digest and CLI subprocesses | 13c0a56, 056d5ec | CODED / CI PENDING |

Advisory only: existing Desktop/Central admission cap of 2–10 tasks remains unchanged. Same-wave groups are bounded to 10 and 65536 serialized manifest bytes; protected risk and directly declared external dependencies isolated, unresolved conflicts remain visible, singletons are not multi-task admission batches. No remote freshness, verified worker capacity, semantic independence, source inspection, provider send, automatic task creation, admission or execution. Default report excludes task descriptions and criteria; explicit group extraction emits sensitive exact declared content and requires separate secret review. Digest detects changed declarations, not a signed authorization. Fresh Central preview and separate upstream baseline review remain mandatory. Test cases are not completed feature tasks; the 50–100 development-task completion target is not achieved in this slice.

V7-GAP-05/07/08 remain PARTIAL/OPEN: actual automatic decomposition, Desktop AST integration, semantic/contract inference, upstream proof and combined QA; V7-GAP-06/09/11 remain open for provider permissions, recovery, retention and measured token/quota accounting. Hostinger staging, signing, branch protection and physical PC acceptance remain independent release gates. G0–G7 HOLD.
Operator guide: [Bulk Master backlog review](MASTER_BULK_REVIEW_V7.md).


## 25 November 2026 — Desktop bulk backlog review and local draft import

Previous exact HEAD `370672751cc3ae57623fab3bf8345bd28f397c27` independently passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45500418291) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45500418320), including the offline 100-task bulk planner. The following new Desktop integration is CODED / EXACT-HEAD CI PENDING.

| Workstream | Source commits | Evidence status |
|---|---|---|
| Bounded native file read, exact UTF-8 manifest, local baseline equality, raw file and canonical manifest digests, import eligibility blockers | ad5eec9 | CODED / CI PENDING |
| Signed project/epoch recheck, native file picker, fixed main-process IPC and one-shot selection, competing action fence | afb65aa, 22f9557 | CODED / CI PENDING |
| Preload allowlist and ASAR package closure inclusion | 41b1b8d, ca41c4e | CODED / CI PENDING |
| Local review report, explicit group selection and replacement consent, request/preview reset, selection/availability fences, blocker detail | f9adbc9, 984dbb0, fdb6359, a3ebffe, b51652a | CODED / CI PENDING |
| 79 named regression scenarios (including POSIX symlink case and renderer DOM-model tests), CI registration | 2dafdfb, 89c6aa5, 11aee17 | CODED / CI PENDING |

Desktop now accepts a native-selected trusted local JSON file of 2–100 declared tasks (512 KiB raw cap), bound to a current signed Master/project/epoch and local Git tracking-ref observation. Only an eligible 2–10-task group can be loaded into the local unconfirmed draft, after explicit confirmation and exact reread of both digests. Protected/isolated, unresolved conflict, external or upstream-dependent and singleton groups require separate review. A fresh request ID, Central preview, independent review and existing admission approval remain necessary. No automatic task generation, admission, dispatch, execution, provider request or Git mutation. No new schema, dependency, remote freshness proof, semantic independence, capacity proof or durable bulk backlog storage. Existing 2–10 Central admission cap unchanged. The selected file is operator-owned sensitive input; no secret scan or physical locality guarantee. UI and packaged Windows real-environment acceptance remain open. Test case count is not a completed feature-task count; the 50–100 development-task target was not achieved in this slice.

V7-GAP-05/07/08 remain PARTIAL/OPEN for actual task decomposition, AST integration in Desktop, semantic/type/contract inference, independent remote baseline and combined QA. V7-GAP-06/09/11 remain open for provider permissions, recovery, retention and measured token/quota accounting. Hostinger staging, branch protection, owner signing and physical 8–10-PC acceptance remain separate gates. G0–G7 HOLD.

Operator guide: [Desktop and CLI bulk backlog review](MASTER_BULK_REVIEW_V7.md).
