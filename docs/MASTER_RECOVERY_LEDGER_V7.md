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

## Tests and limits

- `npm run test:v7`: validates normal, stale, malformed, duplicate and tampered snapshots, bounded event windows and Git barriers.
- `npm run test:v7-mysql` on a **disposable** MySQL instance: inserts more than 300 audit events and proves a Master can recover; verifies an uncertain Git job independently denies READY even with a terminal ticket.
- Exact-commit CI and security audit must still pass; these tests are not physical-PC, provider or live GitHub acceptance.

**Outstanding:** pagination for more than 300 simultaneous active tasks/unresolved Git jobs; independent authenticated remote-Git effect verification and Owner incident resolution; stable cross-host recovery and crash-injection tests; production Hostinger staging and backup/restore; Windows-signed release and physical 2/3/8–10-PC pilot. The full dependency vulnerability audit remains a release gate.
