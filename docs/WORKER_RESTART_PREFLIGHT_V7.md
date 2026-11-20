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
