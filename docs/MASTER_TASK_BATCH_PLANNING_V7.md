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
