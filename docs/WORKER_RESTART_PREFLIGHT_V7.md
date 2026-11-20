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
