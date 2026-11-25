# Implementation State — 2026-11-06 (historical snapshot)

## 24 November 2026 — status correction

This file records **the state of the 6–11 November development baseline**,
not the current GitHub Draft PR implementation. Since that snapshot, the
v7 Hostinger/MySQL Central code, separate Central-only build, Electron
Desktop OS-vault worker/QA source, staging recovery tooling and extensive
CI/test harnesses were added on the **unmerged fix branch**.

See [repository deep audit](docs/REPOSITORY_DEEP_AUDIT_2026-11-24.md),
[implementation tracker](docs/IMPLEMENTATION_TRACKER.md), and [gap register](GAP_REGISTER.md). These later code commits are *not* evidence of protected
main, live Hostinger staging, production signing, or real multi-PC acceptance.
Statements below such as "all v7 tests NOT_RUN" refer to this **historical
snapshot** and must not overwrite newer exact-HEAD CI evidence.

**Status: REAL DOCKER + LOCAL ROLLBACK GIT CI VERIFIED; LIVE GITHUB MERGE/ROLLBACK NOT VERIFIED — NOT PRODUCTION READY**

The prior text in this file incorrectly equated manually persisted fixture data with verified Docker execution, Git push and remote merge. It has been superseded by evidence-based tracking.

## Owner-directed architecture v7.0 — design-only

On 2026-11-11, **three new normative target documents** were committed to the existing fix branch:
- [Architecture Blueprint v7](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md)
- [Agent / Task / QA / Recovery Contract](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md)
- [V7 Requirements / Acceptance Tests](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md)

Finalized target: owner's existing Hostinger Business web hosting + MySQL + request-driven HTTPS/Telegram web backend; 8–10 Electron PCs with unique node/agent IDs; retained 1 Active Master + 2 backups selected after 08:00 initial bootstrap, 60-second heartbeats; hybrid Master-as-Developer, permitted browser-first AI workflow, safe Git, checkpoints, independent QA and protected review.

**Documentation only: NOT a MySQL migration, Hostinger deployment, Electron browser implementation, browser-provider acceptance or multi-host test.** Existing SQLite code, partially in-memory/demo data, API LLM router and CI-scoped Git/Docker verification remain the current execution reality. All V7 tests are NOT_RUN; live GitHub forward/rollback acceptance and historic signer rotation remain outstanding.

See:
- [Implementation Tracker](docs/IMPLEMENTATION_TRACKER.md) — module-level implementation/remaining status.
- [Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-06.md) — changes and validation history.
- [Real Sandbox Execution](docs/SANDBOX_EXECUTION.md) — runtime configuration, evidence, isolation and limitations.
- [GitHub Merge Verification](docs/GITHUB_MERGE_VERIFICATION.md) — read-only delivery evidence and limitations.
- [7 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-07.md) — this continuation slice.
- [8 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-08.md) — tested worker-branch push and live acceptance gaps.
- [10 November Implementation Log](docs/IMPLEMENTATION_LOG_2026-11-10.md) — durable push reservation, crash recovery and human review authorization.
- [Human Review Authorization](docs/HUMAN_REVIEW_AUTHORIZATION.md) — short-lived admin proof grants, watchdog behavior and limits.
- [Verified Rollback Pipeline](docs/VERIFIED_ROLLBACK_PIPELINE.md) — Docker-tested revert branch, draft PR, GitHub merge proof and remaining gaps.
- [11 November Recovery Log](docs/IMPLEMENTATION_LOG_2026-11-11.md) — read-only rollback crash reconciliation, SQLite fencing and proof limits.
- [Worker Branch Publication](docs/WORKER_BRANCH_PUBLICATION.md) — guarded push protocol and local integration evidence.
- [GitHub Actions](https://github.com/r8898278453-coder/SUTRADHAR/actions) — check results for the specific commit.

## Implemented foundations

- React control plane and Express REST surface.
- Real Ed25519 payload signing and verification.
- SQLite storage with Node-side `BEGIN IMMEDIATE` claims and election.
- Python SQLite CAS and clock normalization on the fix branch.
- Gemini and OpenRouter API call code (runtime provider availability not proven here).
- Telegram chat + admin user allowlisting.
- Admin session login with HttpOnly SameSite cookie and same-origin mutations.
- Real Docker test endpoint: Git HEAD snapshot + scoped patch validation + disposable nonroot Docker execution + SQLite test outcomes. Both real runner and HTTP integration pass/fail tests have passed in CI.
- CI workflow and test entry points on the fix branch.

## Deliberately blocked until integrated

- HTTP Docker testing runs only when `SUTRADHAR_TARGET_REPO_ROOT` and `SUTRADHAR_SANDBOX_TEST_COMMAND` are configured and Docker is available. Missing prerequisites return 503; invalid patch scope returns 422. Production deployment is still unverified.
- GitHub merge verification checks the exact registered PR number/pushed commit, single tested head commit and merged tree, file scope, required Actions checks and independent review. After human review, administrator explicitly grants a 15-minute verification window without extending any worker lease. SQLite CAS consumes this grant and checks epoch, patch and provenance again. **No live target PR acceptance test performed.**
- Real rollback preparation reconstructs the exact first-parent Git tree of the previously verified merge in a private bare Git repository; Docker tests must pass before a new non-force branch push. Recovery can inspect actual remote Git, re-Docker-test an uncertain existing branch, inspect an exact draft PR read-only and recover only fenced SQLite receipts. A rollback remains `ROLLBACK_REQUESTED` until independent GitHub merged-tree verification. **No live target-repo rollback merge performed.**
- The old fixture-based `tests/e2e_lifecycle.test.ts` remains fixture-only for Git/merge. Separate real Docker integration suites now verify patch validation, passing/failing containers, Express API state transitions and SQLite writes.
- Legacy direct-main Python queue is disabled. Administrator worker-branch push and draft PR creation remain off by default. Worker push uses an atomic SQLite reservation, durable uncertainty state and read-only Git parent/tree recovery before an explicit retry; local bare-remote tests verify it. **No live target GitHub push/PR/merge acceptance performed.** Distributed scheduling, protected main, live review-grant acceptance and live GitHub rollback acceptance remain incomplete; read-only rollback crash reconciliation is now implemented and locally CI-tested, but cannot replace live acceptance.

## Mandatory owner actions

Rotate the historically committed private signing key and invalidate legacy tokens; decide Git history cleanup separately. Configure production HTTPS, administrator credentials, authorized workers, Telegram admin allowlist, and required GitHub checks.

**Do not report 100% completion or deployment readiness based on unit tests alone.**


## 25 November 2026 — developer AST hint inspection

Starting exact HEAD `d1daa265` independently passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45495746438) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45495746128). The Owner-attested usage ledger is source-CI verified on that HEAD.

- `4e08d02`, `261e10b`: developer-only TypeScript AST parser, conservative relative module resolution, immutable Git object inspection, strict bounded inputs, path and encoding checks, explicit missing/ambiguous/unsupported statuses. No provider transmission, source-content export, worktree mutation, task dispatch or remote freshness proof.
- `27426f2`: 161 regression scenarios (syntax forms, comment/string decoys, unsupported references, path/extension ambiguity, bounds and real local Git snapshot). These are test cases, not 161 completed implementation tasks.
- `537f10c`: integrated regression suite into `npm run test:v7`; added `npm run ops:master-ast-hints`.

**CODED / EXACT-HEAD CI PENDING** until an independently observed successful run on the final source. Developer-only: relies on locked TypeScript dev dependency, not installed Electron runtime; existing Desktop lexical hints are unchanged. This is syntactic evidence, not type-checker resolution, scope binding, contract inference or semantic independence. V7-GAP-05/07/08 remain PARTIAL/OPEN; autonomous task decomposition, integrated Desktop AST, upstream proof, combined QA remain open. No production gate promoted. See [AST operator instructions](docs/MASTER_AST_HINTS_V7.md). G0–G7 HOLD.


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
Operator guide: [Bulk Master backlog review](docs/MASTER_BULK_REVIEW_V7.md).


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

Operator guide: [Desktop and CLI bulk backlog review](docs/MASTER_BULK_REVIEW_V7.md).


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

Operator guide: [Bounded AST source inspection](docs/MASTER_AST_HINTS_V7.md).
