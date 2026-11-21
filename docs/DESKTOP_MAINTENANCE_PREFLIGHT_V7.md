# SUTRADHAR — Windows PC Update Safety Preflight and Inspection Receipts

**15 November 2026 | Draft PR #1 | NO installer execution or production authorization**

## What has been coded

**Signed role preflight:** The packaged Desktop uses its encrypted OS-vault node identity to authenticate two HTTPS requests to the configured Central: `GET /v7/nodes/me` and `GET /v7/cluster/state`. It checks approved agent identity, Central's `READY`/unpaused cluster phase, a Master and **two distinct assigned backups**. If any of this PC's agents is the current Master/Backup 1/Backup 2, the preflight BLOCKS maintenance candidacy. Unknown or unapproved PC, malformed Central reply, disconnected Central or missing backups also fail closed.

**This is a point-in-time snapshot, not a live safety lease.** Central may change the Master/backup assignment immediately after the check, and the cluster-state endpoint evaluates leases. Assignment does not prove both backups will remain healthy. There is no freeze, lock, Agent drain, installer execution or Owner maintenance approval in this feature.

**Local signed inspection journal:** After an Owner-signed update v2 offer passes all metadata, installer SHA-256 and Windows Authenticode checks, Electron main signs a local *OFFLINE_INSPECTED_ONLY* record with the existing node Ed25519 key. The record binds the node/public key, original Central origin, signed offer digest, installer hash, source SHA, wave, target/current version and inspection timestamp. It explicitly records `installed=false` and contains no private signing key.

A repeat of the **same** offer on the same PC verifies the existing signed receipt and reports it was already inspected instead of writing another receipt. A changed, partial or corrupt receipt requires Owner review; it is never silently overwritten. The record is in the PC's private local `node/update-inspections` directory, not centrally uploaded.

**Security boundary:** Local OS users can delete files or compromise an unprotected session. These node signatures are useful *local evidence*, not a hardware-backed immutable audit log or one-time replay counter. An expired or withdrawn Owner offer still needs live independent release verification; reusing an old receipt does not grant permission to install. No installer is ever launched by these screens.

## Owner-facing steps (once a trusted signed release exists)

1. Open Desktop → **Verify a signed update file**. Select the correct Owner-signed offer JSON beside the genuine Windows-signed EXE. A successful result only means `Verified offline` and saves a signed local *inspection* receipt.
2. Open **Check whether this PC is Master or backup**. The app checks its approved node and agent IDs and the live Central roles using scoped, signed GET requests. **BLOCKED** means do not stop this PC for an update.
3. Even if the result says non-critical, ask the Owner to confirm current cluster backups and workload, plan a maintenance window, pause or drain tasks through a separately reviewed future procedure, and repeat the check immediately before any real installation.
4. Do not execute an installer or delete the OS-vault identity from this workflow. Protected signed distribution, safe identity-preserving installer run, crash recovery, post-update heartbeat validation and emergency rollback remain a separate unimplemented production gate.

## Testing and no-go conditions

- Unit tests exercise approved noncritical PC vs active Master/backup, unapproved agents, missing backups, paused/RECOVERING cluster, mismatched signed request, Central outage, and invalid HTTPS origin.
- Journal tests exercise Ed25519 verification, no-install assertion, exact-offer idempotency, corrupted/partial receipt failure, lost/changing OS-vault key, mismatched Central, altered installer hash and expired offer.
- Final acceptance requires a genuine Owner code-signing certificate, trust root, physical Windows PCs, Central staging, live role changes between checks, real Windows signature verification and crash/power-loss tests. **None have been performed in this conversation.**

Read [Owner-signed rollout waves](SIGNED_DESKTOP_ROLLOUT_WAVES.md), [Owner provisioning](OWNER_PROVISIONING_RUNBOOK.md) and [production readiness](PRODUCTION_READINESS_V7_2026-11-12.md).


## 15 November 2026 — Central Owner intent linkage

The Desktop now performs a **third signed GET** to `/v7/nodes/maintenance` when checking Master/backup safety. It reports whether an unexpired, same-epoch Owner INTENT_ONLY record exists for that node, and fails closed on mismatched node, stale epoch or malformed expiry. Central's node response also contains server-clock heartbeat age, worker-lease and unresolved Git-job evidence. The PC refuses a noncritical status if any agent is stale, busy or working.

Owner can create/cancel a five-minute intention through the Central dashboard. This is **not a maintenance lease or installer authorization** and will not prevent roles/work from changing after the check. [Detailed Owner guide](OWNER_PC_MAINTENANCE_INTENT_V7.md).


## 15 November 2026 — Persistent Central drain status

The signed `/v7/nodes/maintenance` response also reports DRAINING/DRAINED states and a persistent `fence_active` flag, including after the earlier five-minute intent expires. The Desktop update-readiness checker **blocks** on active drain status rather than reporting a normal noncritical PC ready for installation. An active fence is a server-side task admission restriction only, never Windows executable permission.

The Central Owner UI can START, FINALIZE and CANCEL a fence. For safe worker continuation and Owner-only release steps, see [PC drain fence guide](PC_DRAIN_FENCE_V7.md).
