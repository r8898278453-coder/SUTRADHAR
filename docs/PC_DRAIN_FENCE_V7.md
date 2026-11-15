# SUTRADHAR v7 — Owner-safe PC task-drain fence

**15 November 2026 · Draft PR #1 · No installer execution or production permissions**

## What changed

An Owner may move an existing five-minute PC maintenance intention to a **persistent task drain fence**, with three distinct safe outcomes:

| Stage | Meaning | What Central enforces |
| --- | --- | --- |
| INTENT_ONLY | Five-minute advisory proposal | No work is stopped or fenced; old policy requires idle noncritical PC |
| DRAINING | Owner explicitly started a persistent fence | New claims, available-work discovery, new agent registrations and new QA submissions from that PC are blocked; already held worker leases can checkpoint and submit normally |
| DRAINED | Central checks that no live worker lease, unresolved ticket, Git operation or reported busy agent remains | The task fence **continues**; still **no installer execution approval** |
| CANCELLED | Owner explicitly releases intent/fence | New work and leader/back-up candidacy may resume; must not be used mid-install |

**Critical distinction:** The initial five-minute INTENT_ONLY expiration does not remove a DRAINING/DRAINED fence. There is no automatic release on process restart, crash or timeout. Only the Owner's explicit CANCEL command removes the durable fence.

## Owner dashboard workflow

1. Inspect Central roles, idle PC, signed offer wave and node ID. Record a five-minute intent first; only a live approved PC that is neither Master nor Backup 1/2 is eligible.
2. While the intent is still valid, enter its plan ID under **Drain plan ID (Owner-operated)**. Click **Start durable fence — block new claims** and confirm.
3. Central stores `v7_pc_maintenance_fences` with the exact PC and expected Master epoch. It rechecks both healthy backups and target heartbeat before activation. Existing work is **not revoked or forcibly completed**. Agents can finish their previously held task leases.
4. When all previously held worker work has finished and any uncertain Git task/ticket has been independently reconciled, click **Verify drained (no outstanding work)**. If there is a live lease, stale heartbeat, unresolved Git job or unfinished ticket, Central refuses the DRAINED transition.
5. In **Owner maintenance plans**, check the DRAINED status. This proves only that the known Central work was drained at that point in time. The persistent fence remains and stops the PC acquiring new work.
6. To cancel and return the PC to normal work, use **Cancel intent / RELEASE active fence**. Read the confirmation carefully. The release immediately permits new claims and possible leadership candidacy again; never release the fence during a real update.

These buttons do **not** pause the cluster globally, disable heartbeats, shut down any PC, run an EXE, create an installer lease, or perform a Windows update/rollback. The system continues its 60-second heartbeat behavior.

## Safety invariants

- Owner commands `START_PC_DRAIN`, `FINALIZE_PC_DRAIN`, and `CANCEL_PC_UPDATE` require authenticated idempotent Owner requests with a real MySQL transaction. Each transition serializes with `v7_cluster` leadership/epoch row.
- Task claims serialize with the same leadership row and check the persistent per-node fence *before* creating a work lease. A pending work-availability request is not permission to claim. A later task claim is rejected with `PC_MAINTENANCE_FENCED`.
- Candidate election filters out any node with an active fence. An Owner cannot start a drain for the current Master or either backup, and the two other backups must remain live.
- The fenced PC's already held worker leases are **not revoked**. It can checkpoint and submit existing work, while new registered agents and QA submissions are rejected. A future worker restart or non-lease process must also honor fencing.
- Owner FINALIZE requires approved live agents, unchanged epoch, two healthy backups, no live worker lease, no unfinished task status, and no unreconciled Git job. A stale or expired worker lease does not prove external Git operations are clean; those must be reconciled separately.
- The signed Desktop status endpoint exposes DRAINING or DRAINED while the fence persists, even after the original intent's five-minute clock expires. Desktop cannot treat a fenced device as a normal maintenance-ready PC or as installer-authorized.
- Releasing the fence is an explicit Owner security decision. It is recorded in Central's event ledger.

## Known limitations / pending real-world gates

This is **task admission fencing**, not OS maintenance fencing. It does not stop all possible external workflows, prevent a compromised Windows user from running an EXE, or revoke already-issued remote provider actions. It does not atomically freeze all Central membership changes outside the MySQL leader transaction. A node's reported heartbeat status can be inaccurate, so server-authoritative work/lease/Git checks are additionally used.

An actual safe installer rollout still needs independently reviewed signed package provenance, a dedicated OS-install execution guard, backup and retention of the DPAPI identity, Owner installation approval, physical power/network interruption tests, a post-install heartbeat and lease re-validation protocol, a bounded recovery policy, and verified fallback installer/rollback semantics. **None of those production operations have occurred.**

## CI evidence and validation policy

New pure state tests verify intentional DRAINING vs idle-only DRAINED. The disposable MySQL integration exercises a real claimed worker lease, fence activation, refusal of new task admission, checkpoint/submit of existing work, refusal to finalize while the lease is live, controlled expiry of the *test database* lease, explicit finalization and Owner cancellation. The test-only time change must never run against Hostinger production.

Review [Owner maintenance intent](OWNER_PC_MAINTENANCE_INTENT_V7.md), [Windows safety preflight](DESKTOP_MAINTENANCE_PREFLIGHT_V7.md), and [production readiness](PRODUCTION_READINESS_V7_2026-11-12.md). The latest GitHub Actions result on the exact commit is required before counting this phase CI-verified.
