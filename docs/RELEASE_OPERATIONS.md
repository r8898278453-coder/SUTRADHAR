# SUTRADHAR — Release, updates, rollback & recovery policy

**Status:** target operating policy, **NOT fully implemented** as of 12 November 2026.  
**Audience:** Owner (approvals and simple choices), release engineer (technical checks), independent QA (evidence).  
**Key principle:** A successful CI run, a PR merge, a Hostinger build and a production deployment are **four different events**. No event stands in for another.

## 1. Two products, two release channels

| Channel | Produces | Where it goes | Required explicit approval |
| --- | --- | --- | --- |
| **Central** | Node.js/Express web build, version/schema manifest, reproducible bundle | One Hostinger Business Node.js website | **Owner approves Central production version** |
| **Desktop** | Signed OS-specific installer/update artifact, agent/worker and compatibility manifest | Approved PCs via controlled installer/update feed | **Owner approves Desktop release and rollout** |
| **Shared contracts** | Versioned API schema/types + compatibility fixtures | Tested against both; not a third Owner installation | Included in each affected app's release checks |

Updating one application does not automatically update the other. Neither channel updates just because a developer pushed a feature branch.

**Current alpha (12 November 2026):** New app-specific staging build commands exist: **npm run build:central** writes apps/central/dist; **npm run build:desktop** writes apps/desktop/dist and a local Electron setup wizard is available. Both build scripts record explicit **ALPHA_UNAPPROVED** manifests; these are **not trusted signed release identities**. PR CI checks separation and optionally attempts an **unsigned internal Windows QA installer** without uploading/publishing it. The existing combined npm run build remains for backwards compatibility. There is still **no approved Central promotion pipeline, Windows signing, auto-updater or independent production deployment acceptance**.

## 2. Version identity and release receipt (required target)

Every immutable artifact must record:

- Product: CENTRAL or DESKTOP; semantic version and protocol version.
- Source repository, **full Git commit SHA**, approved PR/reviewer identities and exact release request ID.
- Build workflow ID, test suite results and independent QA receipt.
- Artifact checksum/digest and (for Desktop) signing publisher/certificate verification.
- Supported Central/Desktop version range; required/minimum MySQL schema version.
- Migration set, backup identifier, recovery compatibility and feature flag state.
- Deployment target; timestamp; Owner approval; per-phase result, health check and rollback receipt.

Display the installed Central version on the Owner dashboard and each PC's installed Desktop version and update status. **Do not invent or display a release ID not actually read from installed artifacts.**

## 3. Protected source and promotion flow

~~~text
PR -> review -> required tests -> merge into protected main
                       |
               release candidate
                       |
            independent QA + staging
                  /             \
        Central release      Desktop release
        request              request
           |                    |
     Owner APPROVE           Owner APPROVE
           |                    |
     controlled release      sign & publish
     ref promotion           pilot update group
           |                    |
     Hostinger build         staged PC rollout
           |                    |
     HTTPS/DB smoke          heartbeat/version smoke
           \                    /
             audit receipt and closure
~~~

**Branch approach:** ordinary feature PRs target protected **main**. The future **release/central-production** branch is **release-only** and may be advanced by a reviewed, Owner-gated promotion, never by ordinary development. Hostinger's Git integration may automatically rebuild on every push to its selected branch; it must therefore not be wired to an unprotected development branch. The protected release branch and promotion workflow are **not yet configured**. Never manually force-push or bypass protection to simulate promotion.

Desktop version releases use signed, immutable artifacts published by a separate workflow; they do not rely on moving the Central deployment branch. A desktop whose peer protocol is outside the compatible range must fail closed on state-mutating operations and display a guided recovery path.

## 4. Pre-deploy gates — Central

The release engineer prepares evidence. Owner reads a short nontechnical summary and approves or rejects.

- Approved PR, no P0 outstanding auth/security gap, required tests green on **exact candidate SHA**.
- Known-good backup recorded with checksum, location, retention and **proven restore rehearsal**.
- Schema migration described and tested on disposable MySQL and staging with at least old/new client compatibility.
- Build reproducible from lockfile; only Central runtime bundled; source and migration paths resolved at runtime.
- Hostinger Business constraints checked: request-driven HTTP only; no inbound WebSocket, Docker, arbitrary port or continuous worker on server.
- Staging deploy: request, DB connection, /v7/health, owner authorization, dashboard, webhook and forbidden-action tests pass.
- Independent QA and Owner approval refer to exact artifact and schema range.
- A post-deploy monitor, stop rollout mechanism and escalation contact exist.

If any gate is unknown: **NO-GO**. "We can fix it later" does not count as an accepted deployment plan.

## 5. Pre-publish gates — Desktop

- Signed installer verified on clean target OS (Windows pilot first); tampered artifact rejected.
- Unique device identity protected by OS secret storage; installation preserves it on updates; machine cloning/duplicate ID detected.
- Fresh enrollment and approval with limited rights; auto-start/supervision and uninstall behavior tested.
- Correct Central URL and TLS/certificate validation; no database/admin secret packaged.
- One signed aggregate heartbeat around each 60 seconds; ~180-second stale transition measured on Central.
- Old Master fencing, Backup 1→2 promotion and recovery acknowledgment tested on **two physical PCs** and later larger pilot.
- Compatible across Central's supported protocol range, including Central-first rollout and disconnected PC.
- Trusted QA, Docker/Git conditions and browser-provider policies satisfied on a supported PC, not Hostinger.
- Update rollback/install failure does not erase durable local identity, checkpoints or frozen Git worktrees.

**Current status:** the Electron app now offers a local first-run Central health check, PC name, unique agent IDs and enrollment-code entry, and starts the existing signed agent. Actual packaged Windows installer behavior, OS vault, signatures, updater and multi-PC acceptance remain incomplete. No approval/heartbeat success is inferred from the child process merely running.

## 6. Safe staged rollout

### Central

1. Freeze the approved version and schema plan; verify an actual restorable backup and acceptance receipts.
2. Owner approves **Central vX** separately from PR merge.
3. Promote the exact source/artifact via the protected Central release mechanism (future implementation).
4. Verify Hostinger's actual Deployments record and expected source commit; *do not* infer success from GitHub push.
5. Check HTTPS **/v7/health**, dashboard auth, MySQL version, active nodes, heartbeat after reload and audited command handling.
6. Mark success only after all checks pass; otherwise stop promotion and begin incident handling.

### Desktop

1. Owner approves **Desktop vY** and allowed Central versions.
2. Publish signed artifact; first update **one non-critical pilot PC**.
3. Inspect version, signed identity persistence, heartbeat, approval state, recovery and work queues.
4. Update a second distinct PC; exercise failover in staging.
5. Expand in small waves to remaining PCs. Pause on any unexpected stale agents, duplicate identities, protocol errors, QA failure or lost checkpoints.
6. Close release only after the complete device inventory and audit receipts are accurate.

A Desktop update should never trigger a Hostinger deployment; a Central-only release should never silently push an installer.

## 7. Rollback means three separate decisions

| Incident | Preferred safe response | Do NOT |
| --- | --- | --- |
| Central web build broken; DB unchanged | Stop, verify last healthy immutable Central build and redeploy through approved channel, verify health | Force-push random SHA or declare recovered from a green build log |
| Central DB schema/data changed | Freeze writers, capture current data, assess backwards compatibility; apply reviewed forward fix or **restore independently tested snapshot** with explicit data-loss decision | Assume reverting a Node bundle reverts the MySQL schema |
| Desktop update faulty | Pause rollout, use last verified compatible **signed** installer on affected wave while preserving identity and outbox | Uninstall/reinstall wiping device identity or use an untrusted binary |
| Master PC lost | Let Central mark stale, fence epoch and move to eligible backup, then reconcile tasks | Elect Master locally or replay old-epoch Git pushes |
| Central unreachable | Preserve PC-side checkpoints/outboxes, freeze privileged actions, restore authoritative Central and reconcile | Continue privileged task/merge writes without Central |
| Git/source code defect | Use reviewed Git revert/repair PR with independent QA and verified remote merge | Confuse source-code revert with application deploy or DB restore |

**Database recovery is not automatically reversible.** Restoring a backup can discard newer state; the Owner must see what data interval and agents/tasks would be affected. Preserve audit and receipts where legally and technically appropriate; compare epoch/idempotency state after restoration before workers resume.

**The current repo's v6 guarded Git rollback controls** refer to source-code/GitHub PR recovery, **not** Hostinger website or MySQL restore. They must not be marketed as one-click production deployment rollback. See [verified Git rollback pipeline](VERIFIED_ROLLBACK_PIPELINE.md).

## 8. Incident stop/resume runbook (Owner view)

1. Select **Pause rollout** in the *future* Owner release screen; until that exists, ask the release engineer to stop the next deployment/update wave. Do not assume such a button is implemented now.
2. Record the affected app, version, rollout start, exact time, healthy versions, Hostinger Deployments entry or PC IDs, and visible error. Keep secrets out of screenshots/logs.
3. Determine whether the problem is **web only**, **DB/schema**, **Desktop only**, **Central connectivity**, or **Git/task state**. Treat simultaneous symptoms as high severity.
4. Prevent duplicate external side effects: do not repeatedly push a Git branch, rerun migrations, re-enroll PCs or repeat approvals blindly.
5. Gather read-only evidence first: health endpoint, deployment logs, node heartbeat status, DB/backup metadata, signed QA/release receipts, provider outage status.
6. Choose the corresponding reviewed recovery path in the table above. Require Owner sign-off for schema restore, credential rotation, forced compatible downgrade or releasing quarantined work.
7. Verify recovery with the exact acceptance checks that failed; observe the system before restarting the remaining rollout waves.
8. Close the incident with before/after versions, restoration point, scope of data loss (if any), and approval/audit trail.

## 9. Mandatory security and compliance guardrails

- Never expose admin, GitHub, Telegram, DB, enrollment or device private keys in repository, log or distributed app.
- Never auto-merge main or auto-deploy on an unreviewed agent action. Core/schema/security/credential/release changes need explicit Owner authority.
- Do not allow desktop workers to edit Central production DB directly.
- On lost/stolen PC: revoke node/agent access and rotate affected enrollment grants; keep other PCs running if safe.
- Use provider-authorized browser workflows; do not defeat ChatGPT or Google AI Studio rate limits or access policies.
- Local QA reports alone do not make a release production-verified; prove exact tested Git tree, independent QA, protected PR checks and remote merge evidence.
- No destructive recovery, schema migration or secret rotation without backup, explicit approval and a documented roll-forward option.

## 10. Current implementation gaps before the promised owner UX

**NOT IMPLEMENTED/ACCEPTED:** reproducible lockfile/fully isolated workspaces; application source extraction, signed/published release workflows and production selective CI; release/central-production branch creation/protection/promoter; owner release approval UI and immutable deployment receipts; signed installer and updater; OS key vault; first-run enrollment wizard; production migration/backup/restore flow; live Hostinger staging; production rollback controls; real 2-PC and 8–10-PC evidence; full v7 71-case acceptance. No one-click install/update/rollback claim until these are delivered and tested.

Use [Implementation Tracker](IMPLEMENTATION_TRACKER.md) for scope-specific evidence, [Owner Setup](OWNER_SETUP_AND_DEPLOYMENT.md) for installation, [ADR](ADR_001_MONOREPO_TWO_APPS.md) for structural decisions, and [V7 Acceptance Matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) for completion gates.

## Hostinger authoritative reference

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/
- https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/
- https://www.hostinger.com/support/how-to-fix-changes-not-showing-after-a-node-js-deployment-at-hostinger/
