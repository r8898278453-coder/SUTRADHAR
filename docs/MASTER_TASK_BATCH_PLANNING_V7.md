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
