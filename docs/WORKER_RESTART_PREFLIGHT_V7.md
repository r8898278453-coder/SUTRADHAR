# SUTRADHAR v7 — Worker restart / checkpoint preflight

**Status:** Alpha draft-branch code. This is a read-only check for an *existing* worker lease, not automatic failover or a production recovery guarantee.

## Purpose

When an agent process, browser session or workstation tool restarts, do not call `prepare` again to steal/re-claim an already claimed task. Central remains authoritative and the saved local `tasks/<ticket-id>.json` record is **not** an authority by itself.

## Manual restart procedure

On the previously enrolled worker PC, with the same existing node identity and trusted Git repository configuration. The **developer CLI** reads its owner-permission local identity file; it must not be mistaken for proof of the packaged Desktop's separately implemented OS-vault protection:

```sh
npm run edge:worker -- resume AGENT_ID TICKET_ID
```

`resume` sends an Ed25519 node-signed request to `POST /v7/tasks/resume-check` including the worker's existing lease ID and saved Master epoch. Central checks approved agent/node, current live READY Master, unchanged epoch, an unrevoked/unexpired exact worker lease and a resumable task state. The endpoint **does not** extend the 600-second lease.

The PC then compares immutable ticket/project/repository/branch/baseline and write scope, validates latest Central checkpoint SHA-256, verifies configured trusted Git repository origin, worktree identity, branch and baseline ancestry, and displays the next manual action. It does not fetch, push, merge, launch a provider or execute a test.

A mismatch or stale/expired lease fails closed; do not delete records or reset lease epochs to get past the error. Investigate in Central and use the authorized Owner reconciliation workflow only after checking any uncertain Git effects.

## Boundaries

- The preflight does **not** acquire new work, renew an expired lease, execute an installer, restore provider sessions, or authorize remote Git publication.
- Subsequent `checkpoint` or `submit` calls independently validate the live lease and epoch again. The preflight is not a permanent grant and may become stale immediately after it returns.
- A promoted Master increments the epoch, revokes old worker leases, and marks affected work for reconciliation. Former Master/worker assertions do not override that fence.
- Only a fresh `prepare` on an Owner-reconciled READY task may issue a new lease through the normal authorized task claim gate.

## Verification

`npm run test:v7` covers source-contract mismatch, forged lease record, stale epoch, tampered checkpoint and scope. `npm run test:v7-mysql` (disposable DB only) tests valid lease preflight, wrong/stolen lease, cross-agent attempt and post-failover rejection.

**Still required for release:** signed production installer, real secure OS credential store, physical multi-PC restart/failover test and externally verified Git effects. Do not connect unapproved alpha code to a live Hostinger deployment.

## 21 November — Agent process restart ownership reconciliation

Separately from a worker ticket resume, the developer edge daemon and packaged Electron OS-vault child both now handle `AGENT_ID_ALREADY_EXISTS` by making a **node-key-signed GET /v7/nodes/me**. Central scopes this listing to that exact approved node. A duplicate global ID is only accepted for local restart after the response's `node_id` matches the original PC identity and **exactly one** matching agent is already `APPROVED` on that PC.

If the ID is absent (for example, another PC already owns it), duplicated in a malformed response, `PENDING`, `REVOKED`, or Central cannot validate the node key, the daemon fails closed and does not count that ID as registered. It does not reassign, transfer, adopt, re-enroll or automatically approve any agent. Reconnect still uses the original OS-vault key on packaged Windows; worker lease/epoch and uncertain Git effects remain separate gates. The older behavior of treating a global duplicate ID alone as restart permission is forbidden.

Disposable MySQL integration exercises same-node and cross-node collisions. Pure tests verify malformed, wrong-node, pending/revoked, duplicate and invalid identifiers. The packaged-source contract test confirms both edge implementations share this guard. This is code/CI evidence, **not a physical restart, vault continuity, Hostinger staging or release approval**.

## 21 November — Developer Edge local crash/sequence preflight

The **developer-only** `npm run edge:start` daemon has a separate, plain-text Ed25519 identity file; it is **not** the packaged Electron OS-vault identity. It now enforces:

- Exactly 1–4 configured unique agent IDs. Once its identity is created, changed/reordered IDs are **refused** instead of being silently added. Use Owner-controlled enrollment/review for changes, not manual JSON edits.
- An exclusive private `edge-owner.lock` in `SUTRADHAR_NODE_DIR` (default `~/.sutradhar/v7`). A second daemon or lock left after a crash refuses startup. It does **not** auto-steal the lock even if the PID appears dead. On normal exit or handled SIGINT/SIGTERM it removes only its own unchanged lock.
- Before the first signed request after restart, the original Ed25519 key pair and identity are verified and the software boot ID rotated while preserving node/agent counters. Unreadable, insecure, symlinked or mismatched plaintext identities fail closed. If identity is absent but enrollment/outbox/status/temporary artifacts remain, startup **never silently rekeys**.
- Heartbeat sequence counters must all advance by exactly one, must match the persistent identity, and are written to exclusive mode-0600 temporary storage with file flush, atomic rename, then POSIX parent-directory flush **before sending the heartbeat**. A failed/ambiguous commit poisons the session, halts the daemon and intentionally leaves its lock for review.
- While the process is alive, a restored/externally changed identity file is detected before another counter write. This **does not** prevent restoring an older plaintext identity when the daemon is offline; Central still enforces durable node and agent replay sequence counters.

**If `DEV_EDGE_ALREADY_RUNNING_OR_CRASH_UNRECONCILED` appears:** Do not delete the identity file or start two copies. First check the PC/service and make sure *no other daemon* is active; inspect protected node/agent sequences, heartbeat evidence and uncertain work in Central; only an authorized Owner/operator may decide whether removal of the **local lock file only** is safe. No automatic lock stealing, key rotation, lease resume, Master promotion, Git work retry, installer execution or Hostinger mutation occurs. A killed/stale process can leave a lock on purpose.

Tests: `npm run test:v7` contains actual local-filesystem crash/replay/locking fixtures and source-contract assertions. This is **local alpha developer-only** validation, not Windows DPAPI/ACL/power-cut proof or physical multi-PC failover acceptance.

## 21 November — Concurrent signed heartbeat retry acceptance (disposable MySQL)

A dedicated throwaway enrolled and Owner-approved test node sends two real HTTP Ed25519-signed `POST /v7/nodes/heartbeat` requests concurrently, each with a distinct valid nonce but the **same next node and agent sequence**. Under the database leader-row serialization, exactly **one** can return HTTP 200. The other must return HTTP 409 `REPLAY_SEQUENCE`. The test independently checks the committed MySQL node/agent counters and rejects a later retry of that same sequence.

This is a concurrency acceptance test against **disposable MySQL only**; it never contacts the live Hostinger service or certifies real two-PC failover, physical key custody, OS restart, Master lease correctness under a power-cut or production deployment.

## 21 November — Master/Backup concurrent promotion and lost recovery response

Central's signed `POST /v7/leadership/reconcile` must be safe when a newly promoted Master submits the exact same `request_id`, Master epoch and recovery-manifest SHA-256 twice, including concurrent requests and retries after a successful MySQL commit whose HTTP response was lost. Central now checks the durable idempotency receipt **after current Master/epoch/lease fencing but before the one-time RECOVERING phase check**. The original accepted `READY` receipt can be returned without a second transition or `MASTER_RECOVERY_ACK` event. A new request ID after READY remains rejected; a changed manifest with an existing ID fails `IDEMPOTENCY_KEY_REUSED`; a demoted or expired Master is still fenced before any receipt is returned.

The disposable MySQL HTTP integration sends two concurrent signed reconcile requests for the same newly elected Master, retries after the accepted commit, and checks exactly one stored command receipt and recovery ACK event. It also injects the expiration of the current Master and races simultaneous separately signed Backup-1/Backup-2 heartbeats. The first eligible backup must become Master exactly once with one epoch increment and one `MASTER_PROMOTED` event, while both heartbeat responses agree on that epoch and Master. Later replay of the original Master recovery receipt is denied by the new epoch fence.

**Owner operation:** If a Master reconciliation reply is lost, preserve its exact `request_id`, epoch and signed manifest digest and perform a normal authorized same-identity retry; never generate a different request ID simply to bypass `READY`, never force an epoch, and never requeue uncertain Git/worker work without its separate Owner recovery proof. This is a database-backed concurrency test, not physical multi-PC acceptance or Hostinger staging. Production HOLD.

## 21 November — Read-only Owner developer-Edge lock inspection

On the original **developer-only alpha** PC, use `npm run ops:inspect-developer-edge`. It reads `SUTRADHAR_NODE_DIR` or the default `~/.sutradhar/v7` and prints only an allowlisted node ID, boot ID, monotonic sequence counters, agent IDs, lock PID/start time and known evidence filenames (if present). It **never prints** the plaintext private/public PEM, lock token, enrollment grant, environment variables, arbitrary filesystem names or a process command line. It refuses unsafe POSIX file/directory permissions, symlinked identity files, invalid lock records and untrusted input. It creates, deletes, renames, chmods or modifies **nothing**; it does not call Central or check whether the PID is actually running.

Results are review-only: `LOCK_PRESENT_OWNER_REVIEW_REQUIRED`, `MISSING_IDENTITY_OWNER_REVIEW_REQUIRED`, `UNLOCKED_NOT_RESTART_AUTHORIZED`, `NOT_ENROLLED` or `NOT_CONFIGURED`. **None** is a launch authorization. If a lock is present, independently verify the PC/service state and Central enrollment, Master epoch, outstanding worker leases and Git effects; only an authorized Owner may manually decide on removing the exact local lock while the daemon is known stopped. Never delete the identity, reset counters, auto-rekey, assume the PID is stale, promote Master or retry Git work based on this output. Invalid state exits nonzero without outputting secrets. Synthetic CI tests verify read-only file bytes, symlink/permissions denial, no secret/lock-token output and nonzero invalid results. This does not validate physical Windows OS-vault, Hostinger, production release or cross-PC machine identity.

## 21 November — Independent backup node election and NO_MASTER safety fence

**Owner meaning:** Two or three SUTRADHAR agents on one Windows PC are still **one PC**, not multiple independent Master backups. Central now assigns Backup-1 and Backup-2 only to different approved node IDs (distinct from the Master and from each other). An unavailable backup slot remains `null`. It does NOT invent a backup from another agent running on the same PC.

On Master lease expiry/revocation, Central refuses to promote an agent on the old Master's enrolled node. This also applies when the Master itself is no longer an eligible candidate. If no independently enrolled healthy node exists, the cluster becomes `NO_MASTER`; any still-running agent on the old node cannot automatically rebootstrap itself on a subsequent heartbeat. Central preserves the previous Master identity in its durable `MASTER_MISSING` audit event and resolves its old node ID using the authoritative enrolled agent ledger. If this evidence is missing, election fails closed. A later signed heartbeat from an independently enrolled healthy node can elect the new Master, increment the epoch, revoke old leases, and enter `RECOVERING` for Owner-reviewed reconciliation. Owner and node GET/STATUS inspection alone never causes election.

**Important limitation:** Different approved node IDs are not independently proven different **physical machines**. The Owner still must verify actual PC hardware, independent Windows OS-vault keys, unplug/restart evidence, heartbeat timing, backup ordering and remote Git effects on genuinely separate PCs. Do not bypass `NO_MASTER` by cloning a vault/identity onto another agent, editing MySQL rows, resetting sequences or creating unauthorized enrollments. Alpha disposable MySQL regression exercises a former Master and two agent IDs on one node, repeated same-node heartbeat rejection, and subsequent separate-node takeover. No production release authorization.

## 21 November — Owner leadership-safety diagnostic (read-only, MySQL authority)

The Central Owner dashboard now displays **Leadership safety — read-only Owner diagnosis**. With the normal protected Owner API key it retrieves `GET /v7/owner/leadership-safety`. It does **not** write the cluster, elect/promote Master, extend leases, revoke worker leases, remove local crash locks, retry Git, release maintenance, install software or infer physical-PC acceptance. Older staging builds where this API is unavailable show **UNKNOWN — Owner verification required** instead of falsely reporting healthy status. No additional permission/confirmation workflow is introduced.

The report includes the persisted epoch/phase, approved Master/Backup node-ID bindings, expired Master lease observation, count of recently heartbeating eligible **distinct enrolled node IDs**, whether a persisted `MASTER_MISSING` audit exists, and the last previous-Master node binding for the **current** missing-Master epoch. It uses MySQL server time and never trusts a desktop's `status` assertion as physical-machine proof. Codes distinguish `PREVIOUS_MASTER_IDENTITY_EVIDENCE_MISSING`, `WAITING_FOR_DISTINCT_APPROVED_NODE_HEARTBEAT`, `AWAITING_SIGNED_HEARTBEAT_FOR_ELECTION`, `MASTER_LEASE_EXPIRED_AWAITING_SIGNED_HEARTBEAT`, `MASTER_RECOVERY_RECONCILIATION_REQUIRED` and backup node collisions/shortfall. The Owner should inspect Central read-only evidence and the true physical PCs rather than edit the epoch, agent/node enrollment or audit rows.

Safety detail: the election and diagnostic share a latest-event-only previous-Master identity lookup. A malformed latest `MASTER_MISSING` record does **not** cause an older record to be silently used as an alternative; absence of valid history keeps independent promotion blocked. The response always marks `read_only:true`, `automatic_promotion_allowed:false`, `restart_authorized:false`, `physical_machine_verified:false` and `production_release_authorized:false`. A healthy-looking report is not signed Hostinger release evidence. A request to the diagnostic requires Owner authorization; signed node heartbeats remain the only routine liveness/automatic election stimulus.

Tests: pure diagnostic reason-code/state cases; JS Owner UI safe-fallback/cannot-POST fixtures; real disposable MySQL integration checking owner-only access, repeated diagnostic reads under an expired Master lease, exactly unchanged durable cluster/lease/promotions and correct NO_MASTER then RECOVERING observations. All physical Windows, Hostinger staging and G0–G7 Owner release gates remain PENDING/HOLD.

## 21 November — Developer Edge inspector matches the real identity contract

The read-only Owner inspector now checks the **exact** six-field identity layout used by `v7/developer_identity.ts`, the exact two-field agent records, unique agent IDs, non-negative safe integer counters, and cryptographic consistency of the stored Ed25519 private/public key pair. It reports `local_ed25519_pair_verified: true` only after the keys match; it **never exports either PEM**. An invalid shape returns `DEV_EDGE_INSPECT_IDENTITY_INVALID`; invalid, non-Ed25519 or mismatched keys return `DEV_EDGE_INSPECT_IDENTITY_KEY_MISMATCH`, with no secrets in CLI diagnostics. A real daemon-generated identity/lock pair is exercised by the runtime integration tests.

The inspector now enumerates names **internally only** to detect any unexpected residual file, such as interrupted `identity.json.*.tmp`, just as the developer daemon refuses missing-identity rekey when any file remains. It exposes only `unexpected_artifact_count`, not those file names. A missing identity with unknown files is `MISSING_IDENTITY_OWNER_REVIEW_REQUIRED`, **not** `NOT_ENROLLED`; an otherwise unlocked identity with unknown files is `UNLOCKED_RESIDUAL_ARTIFACTS_OWNER_REVIEW_REQUIRED`. No state permits launch/restart or deleting a file. Unrecognized files must be investigated manually alongside Central enrollment, leases, outbox and crash-lock evidence.

`configured_agent_roster_verified:false` means that this diagnostic cannot compare the saved roster to the daemon's external `SUTRADHAR_AGENT_IDS` configuration. `counter_rollback_verified:false` means the local file cannot prove that its counters were not restored from an older copy; Central must verify signed replay sequences. A matching local key pair **does not prove physical PC identity, genuine OS-vault custody, approval in Central, live process state or a safe restart**. Production HOLD.

## 21 November — Packaged Desktop encrypted identity loss/restart fence

Unlike the developer-only plaintext inspector, the packaged Electron Desktop's `node/identity.osvault.json` is stored as an OS-safeStorage ciphertext. The packaged vault now accepts only the actual Ed25519 private/public key pair and the exact field layout produced by the signer bridge; simple `PRIVATE KEY` text or decryptable but mismatched PEMs are rejected. A missing encrypted identity file with **any** remaining entry under the node directory causes `OS_VAULT_IDENTITY_MISSING_OWNER_RECOVERY_REQUIRED`, not creation of a new node identity. This includes leftover interrupted ciphertext-write temporary files and enrollment/status/maintenance evidence.

Treat this result as a **stop** requiring Owner inspection on the original Windows PC. Never delete old evidence, clone keys, reset counters, re-enroll or rerun ambiguous task/Git/QA effects to bypass it. Central node enrollment and accepted signed sequences, true OS credential provider, Windows directory ACLs and a physical restart/power-loss test are independent requirements. This code-level fail-closed check alone does not verify protected DPAPI storage or authorize production.

## 21 November — Packaged Windows ambiguous counter commit requires Owner review

For the packaged Electron runtime, `node/identity.osvault.write-intent` is created **before** each ciphertext replacement and removed only after the attempted encrypted identity write is complete. If the process crashes or an encrypted file flush/rename/retirement fails, this marker may remain even when `identity.osvault.json` appears readable. It is intentionally not a credential and may be accompanied by a changed or unchanged ciphertext. Any remaining marker blocks automatic reinitialization, signed heartbeats, work signing and relaunch. The currently running vault also refuses all subsequent reads/signatures after a failed write, even if somebody manually deletes the marker.

The secure heartbeat child now treats `saveCounters` errors and IPC timeouts as a **fatal uncertain commit**, not a routine network outage: no next heartbeat or guessed counter is sent, and Electron Main suppresses automatic restart until an authorized recovery. Preserve both marker and encrypted identity file. Do **not** delete the marker, reset sequence counters, clone the encrypted file to another PC, issue a new agent ID, re-run an uncertain Git job or remove Central leases as a workaround. Owner must independently compare accepted signed sequences, node/agent identity, recovery epoch, remote Git/QA effects and actual hardware before any recovery decision.

CI simulates failures before ciphertext flush and after ciphertext rename, verifies marker persistence across a newly constructed vault, and confirms signing denial in the parent signer bridge. Actual NTFS directory durability, Windows ACLs, Windows credential-provider behavior and abrupt power-loss recovery remain unverified. This is not production release acceptance.

**IPC timeout / abrupt child exit guard:** If the counter-save acknowledgement never reaches Electron Main, the child exits with a nonzero code; Main now treats any unexpected nonzero or signaled child exit as `OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED`, rather than scheduling a replacement process. This is intentionally conservative, including non-vault child crashes. The process-local hold is not a substitute for physically validating persisted on-disk intent and NTFS power-loss behavior.

## 21 November — Exact-step packaged heartbeat and signing policy

Packaged Desktop now mirrors the developer daemon's strict counter progression: each encrypted node+agent counter must advance **exactly one** step per local heartbeat save; boot rotation preserves all counters unchanged. The OS vault independently blocks node/agent gaps (`OS_VAULT_SEQUENCE_GAP_DENIED`, `OS_VAULT_AGENT_SEQUENCE_GAP_DENIED`); the IPC signer also refuses such candidate states. This prevents a compromised or malfunctioning child from jumping counters through a locally accepted persisted write. A Central heartbeat can still skip *server-observed* values if earlier locally saved heartbeats never reached Central; Central requires strictly increasing durable values, not contiguous received packets.

The signer now binds each `POST /v7/nodes/heartbeat` request to the **previously fsynced** exact boot ID, node sequence and every local agent's ID/sequence in roster order. Only the expected aggregate `ONLINE` heartbeat shape, with no additional fields or unapproved status claims, can be signed. A counter save is mandatory before requesting the signature. Every forged/unsaved shape fails locally; Central approval, lease/epoch and anti-replay remain authoritative. Error `VAULT_HEARTBEAT_STATE_MISMATCH` is a denied signature, not a reason to reset node identity, bypass the vault or retry ambiguous external work.
