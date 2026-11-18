# SUTRADHAR v7 — Master recovery ledger and fail-closed publication gate

**Status:** Implemented on the alpha draft branch; not production deployed. Recovery contract remains contingent on CI and real multi-PC acceptance.

## Why this exists

The Central MySQL ledger is authoritative. A newly promoted Master must obtain a fresh, exact-epoch snapshot from Central, validate its integrity, and acknowledge the **same** snapshot before Central moves from `RECOVERING` to `READY`. A local agent's files, chat history, or cached event stream never supersede Central.

The preexisting recovery code rejected a snapshot once **301 historical events** existed, even if there was no unfinished work. It also checked ticket reconciliation state but did not separately block a `RUNNING` or `NEEDS_RECONCILIATION` Git publication reservation. Neither behavior is acceptable for long-lived clusters.

## Recovery snapshot (signed node access)

`GET /v7/recovery` is available only to the authenticated current live Master. It includes:

- `epoch` and `phase`; phase must remain `RECOVERING`.
- `tickets`: all non-DONE/non-CANCELLED tickets, up to 300. More than 300 is an explicit fail-closed pagination gate.
- `checkpoints`: latest checkpoint only for active tickets, up to 300. Per-ticket summary/next-action SHA-256 is checked by the agent.
- `events`: **at most the latest 300 audit records** in descending event-id order; old events are retained in the MySQL audit table and do not automatically block a promotion.
- `event_high_watermark`: highest event ID present in the authoritative MySQL ledger when read. It is not a proof of all historical events being transmitted.
- `unresolved_git_jobs`: up to 300 Git jobs in `RUNNING` or `NEEDS_RECONCILIATION` regardless of ticket status. More than 300 blocks recovery until an approved pagination protocol exists.
- `manifest_sha256`: SHA-256 of the exact JSON snapshot (excluding the digest itself). This is an integrity check within authenticated HTTPS, **not** an independent remote-Git proof.

The agent rejects invalid epoch/phase, malformed or duplicate active tickets/checkpoints/event IDs, inconsistent event high-watermark, mismatched checkpoint digests, and mismatched manifest digest. Any unresolved ticket or uncertain Git job blocks automatic readiness.

## READY transition safety

`POST /v7/leadership/reconcile` locks the Central leader row, checks live Master identity and epoch, recomputes the same manifest from MySQL, and rejects a changed digest. It rejects `RECONCILIATION_REQUIRED` tickets and any uncertain Git jobs with HTTP 423. No Git push, PR creation, merge, provider automation, or task retry is authorized by recovery acknowledgement.

If the snapshot changes during recovery (e.g. an event is appended), the Master must fetch a new snapshot and retry; it may not rely on a stale cached digest. Owner must separately investigate unresolved remote effects; merely receiving a heartbeat or local checkpoint cannot prove a Git operation succeeded or failed.

## Owner-reviewed exact remote branch recovery (draft capability)

When an older Master epoch left a Git job in \`RUNNING\` or \`NEEDS_RECONCILIATION\`, the ordinary worker \`/v7/git/confirm\` endpoint **cannot** confirm it under a new Master epoch. Re-running the push risks duplicate external effects.

The Owner-only \`POST /v7/git/recover-remote-proof\` endpoint is a separate recovery option. It requires the authenticated admin, \`ticket_id\`, unique \`request_id\`, **current recovery epoch**, \`owner_confirmed_readonly_proof:true\` and a reason. It is **developer-assisted alpha tooling**, not an Owner dashboard button and not a release approval.

The service first requires a live \`RECOVERING\` Master, an old-epoch uncertain Git job and a matching independently passed QA receipt. It then uses only GitHub **GET** requests to verify the exact branch, candidate commit SHA, tested tree SHA, one-parent baseline and authorized file scope. A missing branch, absent token, network outage, tree mismatch, unexpected commit or invalid scope leaves the job unresolved and the Master blocked. **Remote absence is not treated as safe permission to repush.**

After positive proof, a second locked MySQL transaction rechecks the epoch, job, ticket immutables, QA and lack of active worker lease. It records a durable confirmed Git job, audit event and restores a previously reconciliation-required QA ticket to \`INTEGRATING\`. It **does not** merge, publish anything new, renew leases or declare the task DONE. Another outstanding task/Git job may still block Master READY.

The generic Owner \`RECONCILE_TICKET\` action now rejects tickets that have any Git publication job. This prevents accidental re-claim and duplicate work before exact remote evidence is resolved.

A previously unsuccessful or unobserved Git publication still requires an Owner-approved incident procedure; this endpoint deliberately does not offer a force-clear or blind retry. Real authorized GitHub acceptance remains **NOT_RUN**. The disposable MySQL test uses a simulated GET-only GitHub responder and is **not** proof of a real remote repository operation.

## Tests and limits

- `npm run test:v7`: validates normal, stale, malformed, duplicate and tampered snapshots, bounded event windows and Git barriers.
- `npm run test:v7-mysql` on a **disposable** MySQL instance: inserts more than 300 audit events and proves a Master can recover; verifies an uncertain Git job independently denies READY even with a terminal ticket.
- Exact-commit CI and security audit must still pass; these tests are not physical-PC, provider or live GitHub acceptance.

**Outstanding:** pagination for more than 300 simultaneous active tasks/unresolved Git jobs; independent authenticated remote-Git effect verification and Owner incident resolution; stable cross-host recovery and crash-injection tests; production Hostinger staging and backup/restore; Windows-signed release and physical 2/3/8–10-PC pilot. The full dependency vulnerability audit remains a release gate.
