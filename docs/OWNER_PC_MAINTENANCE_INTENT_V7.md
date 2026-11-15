# SUTRADHAR — Owner PC Maintenance Intent (v7)

**15 November 2026 | DRAFT implementation | Advisory only — NO installer execution**

## Why this exists

A Desktop can be the Master, Backup 1, Backup 2, active worker, or a node with an unresolved Git operation. Simply inspecting a valid signed installer is **not** permission to stop that PC. Central is the authoritative source for identity, roles, Master epoch, approved nodes and tasks.

The new Owner-maintenance workflow records a short-lived, auditable intention to **consider** a PC for a signed future update. **It is not a maintenance lease, drain, pause, installer command, release permission, or rollback.** Every returned response explicitly states `installer_execution_allowed: false`.

## Owner-friendly dashboard workflow (after reviewed schema migration)

1. Open the approved **Central Owner dashboard** and connect using the Owner key (kept in the browser tab only; never paste the key into issues or chat).
2. Review the **Current master**, **Backup order**, live agents and ticket lifecycle. Never choose Master, Backup 1, Backup 2 or a PC with unfinished work.
3. In **PC maintenance intents — NOT installer approval**, enter the exact enrolled PC `node_...` identity, Owner-approved `wave_...` ID, the proposed *stable* target version and SHA-256 of the **signed offer JSON file**. The current Master epoch is filled from Central. Only a trusted release reviewer should supply/verify the offer hash.
4. Click **Record 5-minute intent only** and confirm. Central checks the node/agents in MySQL, Master lease and epoch, two distinct live backups, recent heartbeats (at most 180 seconds old), idle status, active work leases and unfinished Git jobs. Unsafe requests fail.
5. Review the resulting plan ID and expiration in the dashboard. A PC can separately use **Check whether this PC is Master or backup** to perform signed Central node/cluster/Owner-intent checks. The role snapshot can change immediately; a plan is not an install permission.
6. To withdraw an intent, paste its ID into **Cancel existing plan ID** and click **Cancel maintenance intent**. A cancelled, expired or stale-epoch plan cannot be treated as current.
7. **Do not run an EXE from this workflow.** A future fully reviewed installer runner must implement independent Owner approval, atomic maintenance fencing, task draining, identity-preserving backup, signed execution, post-update heartbeat acceptance and emergency rollback.

## Central guards and durability

- The Owner `PLAN_PC_UPDATE` command is idempotent by request ID. It writes a dedicated `v7_pc_maintenance_plans` row with a five-minute MySQL deadline, exact target node/wave/version/offer SHA and Master epoch. It does **not** modify any agent, Master, task, lease or OS process.
- Central refuses unknown/revoked nodes, stale epochs, expired Master leases, unhealthy or paused clusters, missing/stale backups, busy/stale target agents, active worker leases, unresolved Git operations and concurrent unexpired plans for the same PC.
- `CANCEL_PC_UPDATE` records cancellation and an audit event. Owner can inspect plans through the authenticated dashboard.
- A node can read only **its own** intent using a signed `GET /v7/nodes/maintenance`. Its response includes the current intent (or null) and `installer_execution_allowed: false`.
- Reassignment of Master invalidates the epoch binding; a PC's local readiness check also rejects stale or expired signed intent evidence.
- The maintenance schema is a new table, requiring an **Owner-authorized migration** in staging before these buttons become usable. Dashboard planning buttons fail closed if the endpoint is unavailable.

## Verification versus production acceptance

| Gate | Development status | Real production evidence still required |
| --- | --- | --- |
| Central role/heartbeat/unfinished-work checks | Implemented with pure tests and disposable-MySQL integration | Hostinger staging and physical multi-PC failover |
| Five-minute Owner-only intent, read/cancel, epoch binding | Implemented in Central API and Owner dashboard | Reviewed migration, Owner access, expired-plan rehearsal |
| Signed Desktop view of intent and safety checks | Implemented in packaged Desktop source | Genuine signed installer, trust root and physical Windows validation |
| Actually stop, drain, execute signed update, reinstall, restore identity | **NOT IMPLEMENTED** | Separate architecture/QA/Owner approval |
| Post-install health, crash recovery and automatic rollback | **NOT IMPLEMENTED** | Real physical pilot and independent acceptance |

This development work must stay on [Draft PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1). It does not authorize merging `main`, deploying Hostinger, applying migrations to a live database, signing production releases, or stopping any PC.


## 15 November 2026 — Persistent Owner drain fence after a short-lived intent

The Owner dashboard now includes **Start durable fence — block new claims** and **Verify drained (no outstanding work)** controls. Start requires the original five-minute INTENT_ONLY plan still be valid, and a fresh approved/healthy noncritical PC, current Master epoch and live Master plus two distinct backups. From activation onward Central's MySQL fence prevents new task claims, new work discovery, QA submissions and new agent registrations on that PC; it also excludes that PC from leadership election. Existing worker leases are **not revoked** and can checkpoint/submit until completed.

**DRAINED** can only be recorded after Central sees no active lease, no unfinished ticket/uncertain Git operation and live idle target agents. A fence NEVER expires automatically after five minutes or on reboot. **Cancel intent / RELEASE active fence** removes the fence and can immediately allow new work. Use only after the Owner confirms maintenance is not underway.

There is still no installer launcher, shutdown, actual signed update, identity restoration or rollback capability. See [PC drain fence runbook](PC_DRAIN_FENCE_V7.md). Owner must rehearse real Windows/Hostinger acceptance separately.


## Drain versus remote Git operations

The persistent Owner task fence blocks **new** Git publication reservations and change proposals on the target PC, alongside new claims and QA submissions. It does not invalidate or hide an existing remote Git operation: confirmation/reconciliation of an already reserved Git job remains possible, and the Owner cannot FINALIZE while that job remains unresolved. Central cannot prevent an external process that is outside this agent protocol from running; physical acceptance must include externally initiated work.
