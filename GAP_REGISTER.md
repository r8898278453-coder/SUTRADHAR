# Active Gap Register — source/real-world reconciliation 24 November 2026

This register reflects the current implementation branch, not an unsupported "all resolved" report.

| ID | Priority | Gap | Status |
|---|---|---|---|
| GAP-P0-001 | Critical | Previously public master signing key must be rotated; old leases invalidated | OWNER ACTION |
| GAP-P0-002 | Critical | HTTP real Docker execution integrated and tested; production images/provenance and deployment verification remain | PARTIAL — REAL DOCKER CI VERIFIED |
| GAP-P0-003 | Critical | Remote GitHub merge verifier pins registered PR/head; 15-minute admin proof grant handles expired worker lease. Live target GitHub merged-PR acceptance not run | PARTIAL — MOCKED API CI VERIFIED |
| GAP-P0-004 | Critical | Docker-tested rollback branch, draft PR and exact reviewed merged-tree verification; read-only rollback crash reconciliation with SQLite fencing added. Live target GitHub acceptance and HA recovery operation testing pending | PARTIAL — LOCAL GIT/DOCKER & MOCKED REST CI VERIFIED |
| GAP-P0-005 | High | Multiple worker identities and per-ticket lease enforcement across all operations | PARTIAL |
| GAP-P0-006 | High | Direct-main push disabled; guarded worker push with SQLite reservation and read-only crash reconciliation, draft PR/merge receipts integrated; live GitHub delivery and scheduled distributed queue pending | PARTIAL — RECOVERY CI VERIFIED |
| GAP-P1-001 | High | Node/Python shared-state and leader failover consistency | PARTIAL |
| GAP-P1-002 | High | Forward patch and rollback reverse-tree Docker/Git tests pass; GitHub reviewed PR and merge are mocked REST fixtures only | PARTIAL — LOCAL GIT/DOCKER VERIFIED |
| GAP-P1-003 | High | Production demo seed and fictional worker metrics remain | PENDING |
| GAP-P1-004 | High | Runtime sandbox isolation security review | PENDING |
| GAP-P1-005 | Medium | Root/Desktop npm locks and Python dependency baseline | PARTIAL — committed npm locks with CI integrity; Python audit/review and production approval pending |
| GAP-P1-006 | Medium | CI results and production HTTPS browser smoke test | VERIFY PER COMMIT |

## Additional v7 target-architecture gaps (partial alpha source; production acceptance open)

| ID | Priority | New gap / conflict to resolve | Status |
|---|---|---|---|
| V7-GAP-01 | P0 | Hostinger Business deployed stateless HTTPS React/Express + MySQL schema, migration, backup/restore | PARTIAL — Central bundle, backup/restore and v8 staging CI; real Hostinger staging/deployment/restore NOT_RUN |
| V7-GAP-02 | P0 | Persistent node identity vs separate agent identity; 60s heartbeat, 180s suspicion, secure enrollment | PARTIAL — signed API and enrollment code/CI; physical Windows DPAPI/restart NOT_RUN |
| V7-GAP-03 | P0 | Initial post-08:00 election, retention across days, two ranked backups, fenced multi-PC failover | PARTIAL — MySQL election/concurrency/fencing CI; physical 2/3/8–10-PC NOT_RUN |
| V7-GAP-04 | P0 | Master hybrid developer duty + backup worker preemption, durable takeover context | PARTIAL — durable leadership/worker recovery source, physical hybrid duty acceptance open |
| V7-GAP-05 | P0 | Master deduplicated project selection/creation, parallel-safe task DAG and explicit QA contract | PARTIAL — Desktop local Git baseline CI verified at 6c996cb; explicit encrypted draft restore and bounded lexical relative-import hints CODED / CI PENDING; autonomous decomposition, full semantic analysis, remote/upstream proof and combined QA OPEN |
| V7-GAP-06 | P0 | Electron isolation, browser provider compatibility, permitted chat continuation and project mapping | PARTIAL — OS-vault/Electron and scoped Owner-declared unverified workspace bindings in CI; durable MySQL registry, browser/provider permission and physical acceptance OPEN |
| V7-GAP-07 | P0 | Trusted local patch/Git operator, MySQL path and semantic contract reservations, no unverified DONE | PARTIAL — local Git/scope reservations/QA guards CI; live protected GitHub acceptance OPEN |
| V7-GAP-08 | P0 | Independent QA, combined integration tree, live GitHub draft PR/merge acceptance, release evidence | PARTIAL — signed QA/source CI; real independent reviewer/device and live protected merge NOT_RUN |
| V7-GAP-09 | P0 | Centralized checkpoint/event history with idempotent crash/network recovery | PARTIAL — MySQL ledgers, grant-revocation and independent snapshot validation in CI; fresh-checkpoint submission guard coded/CI pending; hardware crash/partition proof NOT_RUN |
| V7-GAP-10 | P0 | Website and Telegram single Owner Command Service, default-deny core change authorization | PARTIAL — shared web/private Telegram STATUS/PAUSE/RESUME service and replay tests added; real Telegram delivery, wider command parity and Owner authorization OPEN |
| V7-GAP-11 | P1 | Context minimization, retry budgets, provider quota and transparent partial results | PARTIAL — deterministic compact 8 KiB preview, hash/deduplication and separate mapping metadata in CI; actual token accounting, secret review and provider quota/cost measurements OPEN |
| V7-GAP-12 | P0 | Retire or disable production access to duplicate SQLite/in-memory/demo/legacy election and Git paths | PARTIAL — Central-only bundle and MySQL authority; legacy source remains and production route isolation NOT ACCEPTED |

**V7 authoritative target docs:** [Blueprint](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md), [Contracts](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), [Acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). Legacy issues above remain open until independently verified.

Full acceptance requirements: [docs/IMPLEMENTATION_TRACKER.md](docs/IMPLEMENTATION_TRACKER.md).  
Action history: [docs/IMPLEMENTATION_LOG_2026-11-06.md](docs/IMPLEMENTATION_LOG_2026-11-06.md).  
Runtime: [docs/SANDBOX_EXECUTION.md](docs/SANDBOX_EXECUTION.md).  
Git delivery: [docs/GITHUB_MERGE_VERIFICATION.md](docs/GITHUB_MERGE_VERIFICATION.md).
Rollback: [docs/VERIFIED_ROLLBACK_PIPELINE.md](docs/VERIFIED_ROLLBACK_PIPELINE.md).
Crash recovery: [docs/IMPLEMENTATION_LOG_2026-11-11.md](docs/IMPLEMENTATION_LOG_2026-11-11.md).


## Exact-HEAD evidence rule (23 November 2026)

`PARTIAL` means source exists on the **unmerged Draft PR**, not that production
works. Mark a gap `ACCEPTED` only after an independent reviewer examines the
required real-system evidence for the exact release SHA; see
[71-case matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and
[Owner production issue](https://github.com/r8898278453-coder/SUTRADHAR/issues/2).
Known release blockers include an unprotected `main` reported by GitHub branch
metadata, absent Hostinger staging/off-host restore, no Owner-certified Windows
signer, no witnessed real 2/3/8–10-PC behavior and no G0–G7 approval.
Even if npm CI passes, do **not** merge, publish signed packages or deploy to
live customers. The physical/credential/Owner gates cannot be closed by CI.

## 24 November 2026 — audited source-level fixes vs still open

The [targeted deep repository audit](docs/REPOSITORY_DEEP_AUDIT_2026-11-24.md)
inventories the Git tree and distinguishes source defects repaired on
unmerged Draft PR #1 from environmental/Owner prerequisites. Code-level
fixes cover four developer CLI journal race paths; malformed GitHub review
records; bounded GitHub provenance; G0 protected-branch prerequisites;
future-dated Backup candidates; installer diagnostic evidence reads; and
nested Git/npm/secret-file escapes under broad worker scopes. These are
**pending exact-current-HEAD CI plus independent acceptance**, not
self-certified production fixes.

The known `main protected:false` G0 gap, Hostinger staging, MySQL
backup→restore, trusted Windows signer, physical 2/3/8–10-PC election and
update/rollback evidence, and G7 Owner approval remain OPEN. The
historical public Master signing key rotation is still OWNER ACTION.


## 24 November — current verified source baseline

At `3465af4`, both [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985550) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985559) passed. This supersedes earlier source-CI-pending notes for that exact baseline only. New fresh-checkpoint submission changes `ee2e62f` / `8684dfe` are coded, not yet CI verified at this update. No gap is closed on the basis of source CI alone. See [consolidated implementation tracker](docs/IMPLEMENTATION_TRACKER.md) and [incremental requirements evidence](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). G0–G7 HOLD.


## Shared-contract admission follow-up

Verified previous baseline `93993a0`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700768) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700737) both SUCCESS, including the fresh-checkpoint change. The new shared-contract implementation and regressions are CODED / CI PENDING at this update.

V7-GAP-05/V7-GAP-07: explicit declared contract keys, Owner review, conservative same-repository claim exclusion and Desktop context fidelity are implemented in source. This does not independently infer missing declarations or prove combined integration; target ledger lookup performance and live QA remain open. V7-GAP-09 fresh-checkpoint guard is now CI verified at 93993a0. No gap promoted to ACCEPTED; G0–G7 HOLD. See [tracker](docs/IMPLEMENTATION_TRACKER.md) and [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md).


## Provider registry follow-up

Last fully green application + dependency baseline: `93993a0`. Previous shared-contract HEAD `01ff1ce`: [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45451459381) SUCCESS; [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45451459160) CANCELLED after subsequent branch development. Shared-contract and new registry source still require exact-head application CI.

V7-GAP-06 / V7-GAP-11: durable versioned Owner replacement of non-secret provider declarations, exact active grant checks, canonical digest, explicit clear without legacy fallback, and Desktop local provenance are CODED / CI PENDING. See [Owner registry guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md). Registry uses existing MySQL events; dedicated indexed storage/performance, retention and restore evidence, non-developer editor, provider-permitted account/workspace verification, interruption and actual token/quota measurement remain OPEN. G0–G7 HOLD; no gap accepted solely on source evidence.


## Owner provider registry editor follow-up

Verified baseline `215e5ee`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116654) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116645) both SUCCESS. This includes the shared-contract and durable provider registry source/regressions. The new dashboard editor is CODED / CI PENDING at this update.

V7-GAP-06 / V7-GAP-11: previous explicit semantic reservation and durable registry source now CI verified at 215e5ee. The non-developer dashboard editor is coded with explicit current load, local draft, full replacement confirmation, expected version, one-shot mutation and exact readback, with stale-session and uncertain-result holds. New source awaits CI; real browser/Hostinger usability, dedicated indexed registry or measured ledger performance, retention/restore, actual provider permission, interruption recovery and token accounting remain OPEN. See [Owner guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md) and [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md). No G0–G7 gate promoted.


## Provider interruption follow-up

Verified previous baseline `e935cef`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765773) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765743) both SUCCESS, including the Owner registry dashboard. Manual provider attempt source is CODED / CI PENDING at this update.

V7-GAP-06 / V7-GAP-09 / V7-GAP-11: non-developer registry dashboard is CI verified at e935cef. Manual attempt lifecycle, current lease/registry/checkpoint binding, unresolved submit/requeue/preview holds and Owner closure are CODED / CI PENDING. This is opt-in local evidence, not provider login/session recovery or automatic continuation. Packaged Desktop write controls, Owner review UI, real provider verification, actual context/token accounting, target storage performance and retention/restore remain OPEN. See [tracker](docs/IMPLEMENTATION_TRACKER.md) and [provider guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md). G0–G7 HOLD.


## Provider recovery CI correction / Owner closure follow-up

At `82e2a8c`, [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188656) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188901) FAILED because both Linux typecheck paths reported TS18049 nullable registry/prior state in central.ts. Disposable MySQL integration, unsigned Windows installer smoke, Python/shell/state jobs, Windows lock check and advisory review passed. Explicit return guards in `4d05bde` address the reported compiler diagnostics; its workflows were cancelled by subsequent commits, not verified green. Last fully green combined baseline `e935cef`. New Owner recovery UI and regression changes are CODED / EXACT-HEAD CI PENDING.

V7-GAP-06 / V7-GAP-09 / V7-GAP-11: strict-null compiler correction and Owner eligibility/closure dashboard coded, with independent review attestations and exact current-state readback. Provider attempt MySQL fixture passed at failed HEAD 82e2a8c; combined baseline is NOT green. New tests await exact-head CI. Packaged Desktop mutation, actual permitted provider recovery, context/token proof, live browser acceptance, ledger retention/restore and performance remain OPEN. G0–G7 HOLD. See [tracker](docs/IMPLEMENTATION_TRACKER.md).



## Consolidated Desktop provider attempt and context integrity follow-up

Verified exact baseline `1193b3b`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215514) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215696) both SUCCESS, including the previous strict-null correction and Owner interruption review dashboard. New packaged Desktop attempt controls and task-version admission are CODED / EXACT-HEAD CI PENDING.

V7-GAP-06 / V7-GAP-09 / V7-GAP-11: packaged Desktop manual attempt controls, main-only signing boundary, reviewed digest recomputation, exact task-version BEGIN admission, separate context field and local fixture coverage are coded. Actual physical OS-vault/browser/provider operation, transmitted-byte proof, provider-permitted continuation, token accounting, ledger retention/restore/performance and independent acceptance remain OPEN. No gap promoted to LIVE_ACCEPTED. See [tracker](docs/IMPLEMENTATION_TRACKER.md) and [operator guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md). G0–G7 HOLD.


Additional safeguards `5432a9a`, `2651e1e`, `7768fb2`: main retains only the reviewed preview's in-memory task/origin/digest/registry-version/binding-digest metadata; a changed registry revision or binding blocks BEGIN even when compact context bytes match. Recovery refuses a missing original worktree rather than recreating it. These safeguards and regression fixtures also await exact-head CI.


## Master planning batch and previous Desktop CI reconciliation

Previous exact HEAD `8145c64`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963696) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963719) were cancelled. Before cancellation the real MySQL and Python/shell/state jobs passed, while the TypeScript/unit/build job failed at Desktop security validation: obsolete static regex expected a ternary that had been replaced by the reviewed-context guard. Test correction `b4ec4ae` preserves the security assertions. Last fully green combined baseline `1193b3b`. New planner and correction are CODED / EXACT-HEAD CI PENDING.

V7-GAP-05: bounded deterministic DAG, explicit declared conflict ordering, shared single/batch validation, preview hash and all-or-nothing durable admission coded. V7-GAP-07/08: actual baseline suitability and combined independent QA remain OPEN; DONE upstream does not change immutable downstream baseline. V7-GAP-06/09/11: previous packaged Desktop provider controls not fully CI verified; correction is pending exact-head CI. Actual provider authentication, transmitted context, measured usage, physical acceptance and ledger restore still OPEN. See [tracker](docs/IMPLEMENTATION_TRACKER.md) and [Master planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md). G0–G7 HOLD.


## Desktop Master planner and receipt recovery follow-up

Exact baseline `804726e` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312420) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312581), including previous Desktop correction and Master batch admission. New Desktop Master planner and receipt lookup are CODED / EXACT-HEAD CI PENDING.

V7-GAP-05/09: Desktop form and reviewed admission, signed original-actor historical receipt lookup and maintenance/identity fences coded. Durable local draft, physical usability and successor/Owner reconciliation if original signer unavailable remain OPEN. V7-GAP-07/08: actual Git baseline and combined QA remain OPEN. No provider/token feature added. No live acceptance promotion. G0–G7 HOLD.


## Reviewed Master admission journal and project catalog follow-up

Exact baseline `0fc7c7a` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325287) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325508), including the previous Desktop Master planner and historical receipt lookup. New project catalog and admission journal changes are CODED / EXACT-HEAD CI PENDING.

V7-GAP-05/09: current-Master signed project picker and encrypted original reviewed admission intent/receipt, one unresolved admission per PC, exact original-actor restart inspection coded. Unconfirmed drafts, Owner resolution for missing receipt/unavailable signer, journal retention and physical DPAPI/power-cut acceptance OPEN. V7-GAP-07/08: actual baseline and combined QA OPEN. V7-GAP-11: actual provider token/quota usage OPEN. No LIVE_ACCEPTED promotion. G0–G7 HOLD.


## Owner Master admission reconciliation follow-up

Exact baseline `85ae5a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705079) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705150), including encrypted Master admission journal and signed project catalog. New Owner reconciliation batch is CODED / EXACT-HEAD CI PENDING.

V7-GAP-05/09: exact Owner read-only observation, permanent original request-key denial and Desktop encrypted cancellation closure coded. Cancellation is a permanent deny marker for the exact original actor/request key, not proof of historical non-admission after database loss/restore. Owner must independently compare original local journal, ordered IDs, preview digest, database history and uncertain effects; server checks the current durable ledger and listed ticket IDs, not the full original task manifest. A wrong cancellation declaration is not automatically corrected. No existing tickets are deleted, no replacement work authorized, and an unavailable/revoked original signer cannot automatically release its local journal. Retention and physical DPAPI/power-cut acceptance remain open. V7-GAP-07/08: actual baseline proof and combined QA OPEN. V7-GAP-11: actual provider token/quota usage OPEN. No LIVE_ACCEPTED promotion. G0–G7 HOLD.

## Local Git baseline preflight follow-up

Exact baseline `a77d3a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558734) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558666), including previous Owner admission reconciliation. New local baseline and exact project lookup changes are CODED / EXACT-HEAD CI PENDING.

V7-GAP-05/07/08: exact signed project lookup, local tracking-ref/commit/tree observation and Desktop baseline rechecks coded. Local verification observes the configured repository origin, local remote-tracking ref, commit and tree only. It is not live GitHub freshness, an independent remote attestation, source-level semantic analysis, or proof that upstream changes are included. Desktop batches now require every task to use the same inspected tracking-ref SHA; if a dependent task needs not-yet-merged code, plan it separately after upstream merge and review. Central and CLI planning contracts remain unchanged except for the additional signed project lookup; no baseline evidence is persisted in Central or the admission journal beyond the task's existing baseline SHA. Physical Windows and combined QA remain open. V7-GAP-09: unavailable-signer recovery, unconfirmed drafts and retention open. V7-GAP-11: actual provider usage open. G0–G7 HOLD.

## Unconfirmed draft and source dependency hint follow-up

Exact baseline `6c996cb` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717874) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717690), including the Desktop Git baseline preflight. New encrypted unconfirmed draft and bounded source-hint changes are CODED / EXACT-HEAD CI PENDING.

V7-GAP-05/07/08: scoped immutable local source import hints coded; complete semantic/contract discovery, live baseline/upstream proof and independent combined QA open. V7-GAP-09: explicit encrypted unconfirmed draft snapshot/restore coded; autosave, interrupted/corrupt snapshot reconciliation, unavailable-signer recovery and retention open. V7-GAP-11: source contents are not returned or sent; measured provider usage and quota accounting remain open. Explicit save only; no autosave. The latest saved unconfirmed snapshot per node/Central/agent is encrypted, CAS-revisioned, and bounded to 60,000 UTF-8 JSON bytes and 65,536 encrypted bytes. A pending admission journal blocks draft save/restore. Restoring an unconfirmed snapshot never restores baseline observation, reviewed preview, Owner consent, or admission/execution authority. An interrupted/corrupt draft write remains a local Owner-review hold. Saved task content may contain sensitive material; do not enter credentials or provider secrets. Physical Windows DPAPI/power-cut and retention/recovery of corrupt snapshots remain open. Source hints are lexical, not an AST or complete dependency graph: inspect immutable Git tree/blob objects for scoped JS/TS-family regular files, at most 12 files, 16 KiB per blob, 1 MiB tree listing and 40 hints. Relative static/literal imports only; comments/strings may cause false positives, package aliases, generated code, other languages, dynamic paths and unscanned files may cause false negatives. Only paths, task IDs, counts and commit/tree IDs are returned; no source content, provider send, automatic dependency insertion, task creation or Git mutation. The report does not prove semantic independence, upstream inclusion or remote freshness; no measured provider token reduction is claimed. G0–G7 HOLD.
