# Bulk Master backlog review — V7 alpha

## Purpose and boundaries

Organize 2–100 manually declared tasks sharing one exact baseline SHA into advisory review groups. The original developer-source command is retained. Desktop now has a separate owner-assisted bulk file review and local-draft import path (alpha source, exact-head CI and physical acceptance pending). Neither path is an autonomous task decomposer or a Central admission API. The existing 2–10-task admission/preview limit remains unchanged. A single-task review group is not a valid multi-task admission batch.

The command reads a strict UTF-8 JSON envelope from stdin, limited to 524288 bytes. Use a trusted local file, not a pipe from an untrusted service. The envelope has exactly two keys, schema and tasks. Use schema SUTRADHAR_BULK_DECLARATIONS_V1. Each task retains the same ten exact fields as the existing Master planner. Example (illustrative IDs and placeholder SHA; replace with reviewed actual data):

```json
{
  "schema":"SUTRADHAR_BULK_DECLARATIONS_V1",
  "tasks":[
    {"ticket_id":"ticket_001","baseline_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","branch_name":"ai/ticket_001","title":"First task","description":"Implement first reviewed scope","risk":"LOW","write_scopes":["src/a.ts"],"acceptance_criteria":["Verify scoped behavior"],"dependencies":[],"contract_keys":[]},
    {"ticket_id":"ticket_002","baseline_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","branch_name":"ai/ticket_002","title":"Second task","description":"Implement second reviewed scope","risk":"LOW","write_scopes":["src/b.ts"],"acceptance_criteria":["Verify scoped behavior"],"dependencies":["ticket_001"],"contract_keys":[]}
  ]
}
```

From a trusted SUTRADHAR source checkout, with its reviewed dependencies installed:

```sh
npm run --silent ops:master-bulk-review < backlog.json > review.json
```

Use a shell supporting stdin redirection (on Windows use Command Prompt). Output path redirection is the operator's local action; the script does not itself write a file. Choose a new private output filename; shell redirection may overwrite an existing file. Do not include credentials, provider secrets, private keys or transcripts in task declarations.

## Read the report

- Every declared task is included exactly once. Deterministic dependency waves cover internal declared edges; cycles and case aliases are refused.
- Within each wave, deterministic first-fit review partition limits groups to 10 tasks and 65536 serialized manifest bytes. HIGH/CORE and directly declared external-dependency tasks are isolated. Same-wave declared path/contract conflicts are separated and remain explicitly reported across groups. Separation is not conflict resolution or parallel dispatch permission.
- Connected components identify related review work. All pair conflicts, unresolved counts, direct cross-group dependency IDs, external dependency IDs and upstream baseline review flags remain visible. A group with transitive dependencies must also respect the full graph. A group with no declared conflict can still have undiscovered conflicts.
- Manifest SHA-256 binds exact field values and array order for all tasks in canonical ticket-ID order, independent of input task order or JSON object key order. It is not a signature or proof of remote Git state.
- The default report includes identifiers, hashes and review metadata, not task titles/descriptions or source contents. Identifiers can still be sensitive; review before sharing.

## Explicit group extraction

After reviewing the full report, replace the placeholder digest and group ID below with the exact values from that report:

```sh
npm run --silent ops:master-bulk-review -- --extract EXACT_64_CHARACTER_SHA256 review_001 < backlog.json > group-review.json
```

The command revalidates the entire backlog and refuses a changed digest, malformed selection or absent group. It outputs the selected exact task fields, original dependencies, group metadata, all related conflict pairs, parent manifest digest and group review SHA-256. The output intentionally contains full task descriptions and criteria; it is sensitive local review material, not an admission request or a prompt approved for external sharing. No secret scan is performed. No group extraction automatically creates, schedules or admits a task. Obtain a fresh Central project/baseline/epoch preview and required Owner approvals through existing controls. Replan dependent work after upstream merge and independent Git verification. Resolve conflicts and external dependencies before proceeding.

## Verification and current limitations

Run `node --test tests/master_bulk_review.test.cjs` or `npm run test:v7`. The new suite has 86 named cases, including 50- and 100-task input, 100-task chains, all 4950 pair conflicts, exact group extraction, stale digest, strict input and actual CLI subprocesses. This is a test count, not a count of completed development tasks or production acceptance requirements. Previous exact HEAD `370672751cc3ae57623fab3bf8345bd28f397c27` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45500418291) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45500418320), including the offline bulk planner. New Desktop integration: CODED / EXACT-HEAD CI PENDING.

The planner does not invoke the previous developer AST diagnostic; Desktop source hints, actual task decomposition, semantic/type/contract inference, live upstream Git freshness, combined integration QA, worker availability, provider telemetry, and physical acceptance remain separate gaps. No schema, network action, provider request, deployment or release approval. G0–G7 HOLD.


## Desktop bulk file review — 25 November 2026

1. On the enrolled, approved packaged Windows PC, select the current Master agent and exact active project. Verify its heartbeat, no maintenance hold and no unresolved admission journal. Select the trusted local Git checkout using **Inspect trusted local Git checkout (no network)**. This is a local tracking ref observation, not remote verification.
2. Expand **Review a local bulk backlog (2–100 tasks)** and click **Inspect bulk declarations file**. Choose the previously reviewed JSON declarations using the native file picker. The strict UTF-8 file limit is 524288 bytes. The reader rejects nonregular files, final-component symlinks and observed descriptor/path changes; it is not a guarantee that a trusted selected path is physically local or that an adversarial OS cannot race a read. Use a trusted local folder, not a network share. No raw file path is accepted from the renderer.
3. Review the complete report, including all conflict pairs, task IDs, declared waves, group dependencies, external dependencies, the exact local baseline, file SHA-256 and manifest SHA-256. The report does not return descriptions or source text. A group marked separate review required cannot use the import shortcut. Selected-group status lists exact ticket IDs and blockers. The reported eligibility is local draft eligibility only, never verified independence, capacity, approval or dispatch permission.
4. Choose an eligible group of 2–10 tasks. HIGH/CORE, isolated groups, unresolved declared conflicts, external or upstream dependency requirements and groups outside existing size limits are refused by the main-process selection contract. Click **Load eligible group into local draft only** and explicitly confirm replacement of the current unsaved draft/editor. Main rereads the exact file bytes, validates the entire manifest and both digests, rechecks signed project/epoch and local tracking ref, and extracts only the exact selected task fields. File formatting changes also require fresh review. No raw source, credentials or provider transmission.
5. The draft receives the original task fields only. Request ID, prior preview digest and review consent are cleared. Reinspect every field; supply a new unique request ID, obtain a fresh Central preview, and use the existing required review/admission flow. Explicit encrypted save for the small unconfirmed draft remains available. The bulk manifest is an operator-owned input file, not a newly persisted encrypted Desktop backlog. No automatic task generation, admission, worker assignment or execution occurs. Reinspect the file before selecting another group. Downstream work requires independent upstream/baseline review and replanning after merge.

The native review is one-shot and bound to the current setup window, agent, Central origin, project, baseline and Master epoch. It is cleared on selection/competing batch actions; the renderer clears its report on draft/selection changes and ignores stale responses. Central remains authoritative; its 2–10-task limit and journal/approval rules are unchanged. Signed project checks are read-only application operations; no live provider request or Git fetch/push is performed. The Desktop module is included in the ASAR allowlist; actual packaging/CI and physical Windows acceptance must be verified independently.

Regression coverage: 79 named cases in `tests/desktop_master_bulk_review.test.cjs` (including one POSIX-only symlink test), registered in `npm run test:desktop`. Includes 50/100-task input, exact file and manifest digests, group blockers, changed baseline, descriptor read races, fixed IPC/source contract checks and actual renderer handlers in a minimal DOM model. Test cases are not completed feature tasks. The 50–100 development-task target is not achieved in this slice. No release gate promoted. G0–G7 HOLD.


## 25 November 2026 — Desktop bounded AST source inspection and dependency-order review

Prior Desktop bulk integration HEAD `4024ed872bbc19095354edae242b97359ae9a02a`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45579140265) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45579140289) were observed CANCELLED after the branch advanced. Do not infer a pass or failure. Last verified successful baseline remains `370672751cc3ae57623fab3bf8345bd28f397c27` (both workflows). New exact-head CI must cover the accumulated changes.

| Workstream | Evidence commits | Status |
|---|---|---|
| Shared bounded AST parser, unchanged developer CLI interface, immutable Desktop scoped blob inspection and explicit unknown counts | 2feb45f, d2e0899, 97dbfc6 | CODED / CI PENDING |
| Locked TypeScript runtime and upstream license/notice staging, fixed package resources, closed build inventory, package verification and protected signing preflight | a2b85d1, e3cee8e, b56e1b1, e116ce0, cda264b, 65f5b96 | CODED / CI PENDING |
| Signed-project/epoch-gated existing IPC, fixed installed parser, no silent lexical fallback, updated Desktop controls | 0cb6a19, 7b9338e, 8d3a0f6, 318a64e, fef9489 | CODED / CI PENDING |
| Advisory comparison of syntactic cross-task references with declared dependency DAG, direct/transitive/reverse/missing order and shared dependency review | 3cffc9d, 318a64e | CODED / CI PENDING |
| 49 new Desktop AST regression scenarios and three packaged-resource regressions, CI registration | bf71f40, 9d9ebae, 618a8f0 | CODED / CI PENDING |

The existing 2–10-task Desktop draft is inspected using the same bounded syntax parser as the developer CLI. Scope-based round-robin samples at most 12 files, 16 KiB per blob, 1 MiB tree listing, 128 reference occurrences per file, 40 output hints. Syntax errors and reference overflow discard partial per-file evidence; unknown resolution remains explicit. The application returns hints and review questions, not source text or unresolved import strings. No declared edges changed, no automatic task creation/admission/dispatch, no provider request, no remote Git operation, no semantic/type resolution or verified upstream freshness. The existing lexical helper is retained only for source callers and legacy tests, marked LEXICAL_LEGACY; packaged UI requires AST_SYNTAX. Existing locked TypeScript 5.9.3 resource is shipped with license/notice and build/packaging digests; full parser increases package size. Package-byte verification is not runtime tamper resistance or physical installation acceptance. No new npm dependency, schema or release gate promotion. The 52 new tests are not 52 completed development tasks; the requested 50–100 feature-task target is not achieved in this slice.

V7-GAP-05/07/08 remain PARTIAL/OPEN for actual automatic task decomposition, full semantic/type/contract discovery, remote baseline proof, worker availability, and combined integration QA. V7-GAP-06/09/11 remain open for provider permissions, durable recovery/retention and measured token/quota accounting. Hostinger staging, owner signing, branch protection and physical 8–10-PC acceptance remain independent gates. G0–G7 HOLD.

Operator guide: [Bounded AST source inspection](MASTER_AST_HINTS_V7.md).
