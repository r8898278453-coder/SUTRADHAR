# SUTRADHAR

**One system. Two applications. One GitHub repository.**

**Developer Edge safety:** The separate developer-only plaintext identity daemon now requires a private single-process lock and durable local heartbeat counter writes. This does not change the packaged Electron OS-vault trust boundary or authorize deployment. See [Worker restart and developer Edge recovery](docs/WORKER_RESTART_PREFLIGHT_V7.md).

> **Release status — 24 November 2026:** SUTRADHAR v7 remains **alpha on Draft PR #1**; it is NOT an approved production release. Core/Windows unsigned QA packaging and disposable MySQL tests are source-CI evidence only. No production-signed Windows installer, live Hostinger deployment or staging restore, approved automatic update, or independently verified 2/3/8–10 physical-PC rollout has been completed. Never connect this fix branch to a live production website or distribute unsigned QA output as trusted software.

SUTRADHAR coordinates a group of PCs through an authoritative control plane:

- **Central (Hostinger Business web hosting):** browser dashboard, HTTPS API, MySQL, node approval, master/backup election, projects/tasks/checkpoints, audit, optional Telegram controls.
- **Desktop (each Windows/other supported PC):** local agent and Electron shell; sends signed heartbeats, performs authorized developer/QA work on the PC, and recovers state from Central after a failover.
- **Shared protocol:** API contracts, identities, authorization, version compatibility. Central stores authoritative orchestration state; a Master PC never becomes its own source of truth.

## Start here — choose your role

| You want to... | Read this first |
| --- | --- |
| Track current code, evidence and open work | [Implementation tracker](docs/IMPLEMENTATION_TRACKER.md) and [gap register](GAP_REGISTER.md) |
| Configure manual provider workspace references | [Owner provider declaration guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md) |
| Understand how Central and Desktop fit together | [Architecture & repository decision](docs/ADR_001_MONOREPO_TWO_APPS.md) |
| Set up or operate the system without programming | [Owner's installation and deployment guide](docs/OWNER_SETUP_AND_DEPLOYMENT.md) |
| Approve a release, investigate failures or recover safely | [Release, update & rollback policy](docs/RELEASE_OPERATIONS.md) |
| Run the existing **alpha** with developer assistance | [Current v7 implementation/runbook](v7/README.md) |
| Review original technical requirements | [V7 architecture blueprint](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md) and [Agent/Task/QA contract](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md) |
| Understand post-failover Master recovery safety | [Master recovery ledger & Git reconciliation](docs/MASTER_RECOVERY_LEDGER_V7.md) |
| Review uncertain Git publications from Central safely | [Owner Git recovery review and exact SHA confirmation](docs/OWNER_GIT_RECOVERY_REVIEW_V7.md) |
| Audit real-world failure fixes and remaining automation gates | [Real-world audit remediation tracker](docs/REAL_WORLD_AUDIT_REMEDIATION_V7.md) |
| Verify a worker restart without stealing a lease | [Worker restart and checkpoint preflight](docs/WORKER_RESTART_PREFLIGHT_V7.md) |
| See what has actually passed and what remains | [Implementation tracker](docs/IMPLEMENTATION_TRACKER.md) and [71-case acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) |
| Review cross-system security gaps discovered in the latest source-tree audit | **[24 November repository deep audit](docs/REPOSITORY_DEEP_AUDIT_2026-11-24.md)** |
| Decide whether the real-world production gates have sufficient Owner evidence | [17 November release-gate handoff](docs/OWNER_RELEASE_GATE_HANDOFF_2026-11-17.md) |
| Review Windows signing, OS-vault keys, Hostinger staging, encrypted backup and physical PC acceptance | [Production-readiness checklist](docs/PRODUCTION_READINESS_V7_2026-11-12.md) |
| Inspect PC update readiness and local signed no-install evidence | [Windows update safety preflight](docs/DESKTOP_MAINTENANCE_PREFLIGHT_V7.md) |
| Plan or cancel Owner-approved five-minute **intent-only** PC maintenance | [Owner maintenance intent guide](docs/OWNER_PC_MAINTENANCE_INTENT_V7.md) |
| Start/finalize/release persistent task-drain fence without installer execution | [PC drain fence Owner guide](docs/PC_DRAIN_FENCE_V7.md) |
| Review verified software dependencies and lockfile candidates before Windows signing | [Dependency lockfile review gate](docs/DEPENDENCY_LOCK_REVIEW_V7.md) |
| Set up external accounts and physical PCs without programming or sharing secrets | **[Owner provisioning checklist](docs/OWNER_PROVISIONING_RUNBOOK.md)** and [GitHub prerequisite tracker](https://github.com/r8898278453-coder/SUTRADHAR/issues/2) |

## Simple picture

~~~text
                    SUTRADHAR CENTRAL
               Hostinger Business / HTTPS
             Dashboard + Node.js API + MySQL
                   (authoritative data)
                            |
              signed HTTPS every 60 seconds
                  /         |         \
           Desktop PC 1  Desktop PC 2  Desktop PC 3...10
           Electron +    Electron +   Electron +
           local agent   local agent  local agent
           Master        Backup 1     Backup 2 / workers
                   (roles can change by election)
~~~

**Master policy:** Initial election begins at **08:00 Asia/Kolkata**. The existing healthy Master stays Master across later days; Backup 1 then Backup 2 are ranked fallbacks (prefer distinct PCs). Central controls failover and epochs. There is **no local Master election during a Central outage**.

## What a non-developer should eventually need to do

1. **First Central setup (once):** connect the approved GitHub release source to a Hostinger Node.js website, create a MySQL database, enter secrets in Hostinger's settings, check the HTTPS health screen.
2. **First Desktop setup (per PC):** download the approved signed installer, install, enter/select the Central URL, approve the new PC and its agents on the Owner dashboard.
3. **Daily use:** monitor the Owner dashboard/Telegram, approve sensitive actions and releases. Heartbeats, task state and failover are automated.
4. **Updates:** approve a tested Central release separately from a tested Desktop release; see a release ID and post-update health result.
5. **Problems:** stop rollout and use a verified recovery plan with a known-good release **and separately validated MySQL restore/migration procedure**.

**Important:** This is the **target experience**, not something the current alpha can do end-to-end today. Today, Central schema setup still needs privileged provisioning; PC enrollment/roles and signed QA need real independent physical verification. CI generates an **unsigned internal QA installer smoke artifact**, but a production-signed, Owner-approved installer and proven automated deployment do not yet exist. See the [Owner guide](docs/OWNER_SETUP_AND_DEPLOYMENT.md) for a READY vs NOT READY checklist.

## Current remaining release gates — source work is not live acceptance

| Gate | Evidence we can use now | Blocking real-world evidence |
| --- | --- | --- |
| G0 source and CI | Draft PR #1 source and exact-HEAD GitHub Actions checks | Independent security/PR review, Owner approval and GitHub main protections |
| G1 Hostinger staging | Isolated Central build; Owner-hostname-pinned and TLS/IP-pinned read-only staging probe | Owner-provisioned HTTPS staging website, actual deployment receipt and dedicated MySQL |
| G2 MySQL recovery | Disposable MySQL backup/restore CI and encrypted backup/recovery tooling | Owner-approved separate empty staging restore with independent data and timing evidence |
| G3 trusted Windows installer | Strict four-key Ed25519 release contract, protected signing workflow and Authenticode verification code | Real certificate, restricted signing environment, reviewed stable tag and signed installer verification |
| G4 and G5 PC identities/failover | OS-vault, signed heartbeat, sticky Master and distinct-node regression tests | Physically separate 2-PC, 3-PC and 8–10-PC acceptance with real reboots/failover |
| G6 update/rollback | Signed offline offers, manual maintenance drain, hardened installer checks and fail-closed recovery code | Owner-reviewed physical install/update/rollback with key preservation and post-install health |
| G7 go-live | Owner gate/evidence signature/hash verification scripts | Independent G0–G6 evidence review and separate explicit Central/Desktop production authorization |

Start with [Owner provisioning](docs/OWNER_PROVISIONING_RUNBOOK.md) and [Owner release-gate handoff](docs/OWNER_RELEASE_GATE_HANDOFF_2026-11-17.md). Never paste keys, passwords, signing certificates or staging database exports into chats, PRs or issue comments. Keep Draft PR #1 unmerged and the protected production deployment ref unchanged until independent Owner evidence exists.

## Source layout: current vs target

**Current branch source (real paths, now including independent build wrappers):**

- [Central staging app](apps/central/README.md) — isolated Central bundle (Express + UI + schema), built by npm run build:central; source currently still in v7/.
- [Desktop alpha app](apps/desktop/README.md) — first-run Electron setup and independently compiled PC agent, built by npm run build:desktop. A signed installer is **not** yet released.
- [Versioned shared protocol](packages/shared/contract.json) — API protocol 7, heartbeat 60s, stale threshold 180s and initial 08:00 IST rule.

**Current branch source (real paths):**

~~~text
SUTRADHAR/
├── v7/
│   ├── central.ts              # request-driven Express/MySQL Central
│   ├── agent.ts                # signed PC agent
│   ├── worker.ts               # PC development/QA CLI
│   ├── rules.ts, schema.sql    # election rules and MySQL schema
│   ├── desktop/               # experimental Electron shell
│   ├── ui/                    # experimental Central dashboard
│   └── README.md              # technical alpha runbook
├── tests/                     # current security and integration tests
├── sandbox/                   # PC-side Docker/Git security tooling
├── docs/
├── src/, server.ts, server_db.ts  # legacy v6 code; NOT v7 authority
└── package.json               # current combined alpha build
~~~

**Target source organization — app wrappers exist, but most production source has NOT YET MOVED:**

~~~text
SUTRADHAR/
├── apps/
│   ├── central/               # independently deployable Hostinger web app
│   └── desktop/               # independently distributable Electron app
├── packages/
│   └── shared/                # versioned API/protocol/contracts
├── tests/                     # contract, integration, security, acceptance
├── scripts/release/           # signed/promoted release tooling
└── .github/workflows/         # isolated checks and release pipelines
~~~

Do **not** set Hostinger's Root directory to apps/central. The new **Central-only staging build** uses repository root **./**, Node.js **22**, build **npm run build:central**, output **apps/central/dist**, and entry **apps/central/dist/server.cjs**. This bundler now includes the schema, dashboard and a non-production release manifest; it explicitly excludes PC agent and worker binaries. The legacy combined alpha build (npm run build → dist/server.cjs) is still available for compatibility. **Neither build has been accepted on live Hostinger**; the protected release branch, migration/restore procedure and Owner go-live checks are outstanding.

## Git and release policy

- **One monorepo**, not two repositories; Central and Desktop are not maintained on separate permanent development branches.
- **main** holds only reviewed, owner-approved changes. Use short-lived feature/fix branches and pull requests.
- Because Hostinger may automatically redeploy on *every push to its selected branch*, the **future** protected deployment ref **release/central-production** must only move after human approval and successful release gates. **This ref/workflow is NOT created/configured yet.**
- Desktop builds/releases must be tagged, signed and published independently. Do not auto-distribute an unreviewed commit.
- Never let a worker push/merge directly to protected main; source change review and deployment approval are separate decisions.
- Shared API/protocol changes require both Central and Desktop compatibility testing before promotion.

See [ADR](docs/ADR_001_MONOREPO_TWO_APPS.md) and [release policy](docs/RELEASE_OPERATIONS.md) for branch protection, rollback, DB migrations and release identity.

## Developer-only alpha commands

Run these **only on a trusted development machine**, not as a supposed non-developer installation recipe:

~~~bash
npm ci
npm run lint
npm test
npm run build
npm run test:desktop
npm run test:packages
# Uses a disposable, intentionally provisioned MySQL8 database:
npm run test:v7-mysql
~~~

Current combined scripts are defined in [package.json](package.json). The [v7 runbook](v7/README.md) documents experimental Central and PC startup, enrollment, worker CLI and limitations. Never point test commands or migration experiments at production data.

## Non-negotiable release blockers

**Latest implementation slice:** Windows Authenticode signing gate, OS-safeStorage encrypted Desktop identity (new packaged secure-agent), pinned offline signed update verification, AES-256-GCM backup/staging-only restore and read-only Hostinger/physical-PC evidence tools have been added. **Code/tests are not real account/hardware acceptance.** See the [release checklist](docs/PRODUCTION_READINESS_V7_2026-11-12.md).

Before calling SUTRADHAR "one-click" or "production ready" we still need: independently deployable Central production acceptance; **security approval of committed, CI-verified npm locks**; safe reviewed migrations and proven backup/restore; protected Owner-gated promotion; a Windows installer with secure machine-key storage and a verified updater; an enrollment wizard and reliable background startup; actual multi-PC failover; browser-provider-permitted workflows; real GitHub PR/QA evidence; and completed acceptance gates. The latest CI results cover only their stated scope, **not** full real-world acceptance.

**The draft v7 implementation is under [PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1). Keep it unmerged until explicit Owner approval.**

## Hostinger reference documents

- [Node.js web app from GitHub](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Monorepo root-directory deployment](https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/)
- [Business Node.js runtime limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)
- [Connect Node.js to Hostinger MySQL](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)

These describe Hostinger platform features; **they are not proof that this application has been deployed or accepted**.


## 23 November 2026 — Latest review checkpoints

The Draft PR now has bounded (64-KiB streaming) signed Central JSON checks in
Desktop installer execution, escrow preparation, local drain isolation, update
readiness and cancellation preflight, with negative no-launch/no-release tests.
This is **not** a substitute for certified Hostinger HTTPS runtime, physical
Windows UAC/DPAPI/install proof or independent QA. The source is still
`v7/` behind independently built `apps/central` and `apps/desktop`
wrappers; those folders **exist**. The repository's `main` branch metadata
currently reports **not protected**, so G0 stays unresolved. Always consult
the exact-HEAD [GitHub PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1)
and [gap register](GAP_REGISTER.md), never a historical green run.


## 24 November 2026 — Current development evidence

Last independently checked source baseline: `3465af4`, [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985550) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45441985559) both SUCCESS. Includes strict task planning, compact context preview, unverified Owner-declared workspace mapping, dependency-ready task filtering, project access revocation and independent Master recovery validation. Fresh checkpoint before candidate submission after reclaim/failed QA (`ee2e62f` / `8684dfe`) is new source awaiting CI at this update.

Read the [current architecture reconciliation](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md), [contract](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), [implementation tracker](docs/IMPLEMENTATION_TRACKER.md), [acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md) together. The provider registry is configuration-only and unverified; actual account/workspace validation, durable registry, token measurement and physical acceptance remain open. All G0–G7 remain HOLD. Check exact current Draft PR head before any review; earlier CI is not release approval.


## Shared-contract admission — latest source work

Verified previous baseline `93993a0`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700768) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45449700737) both SUCCESS, including the fresh-checkpoint change. The new shared-contract implementation and regressions are CODED / CI PENDING at this update.

Central now supports explicit shared API/database/interface/event declarations in signed task plans, requires Owner authorization for nonempty keys, and refuses conflicting reservations across files/base branches in the same repository. Desktop includes the validated declarations in its bounded assisted context. This is not automated semantic discovery or verified production behavior. See [contract](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md), [implementation tracker](docs/IMPLEMENTATION_TRACKER.md), [acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). No schema change; G0–G7 HOLD.


## Durable provider registry — latest development

Last fully green source baseline `93993a0`; shared-contract HEAD `01ff1ce` dependency CI succeeded but application CI was cancelled. New provider-registry source is CODED / CI PENDING; verify the latest exact-head workflow results.

Owner-managed provider alias snapshots now persist in MySQL with versioned replacement and explicit revocation. After initial replacement, clearing the registry does not reactivate legacy configuration. Desktop displays local provenance separately from compact context. See [Owner registry guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). This is unverified declaration metadata, not live provider authentication, browser automation or token measurement. Dedicated indexed storage, target hosting restore/performance and dashboard editor remain open. G0–G7 HOLD.


## Owner provider registry dashboard — latest development

Verified previous source baseline `215e5ee`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116654) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116645) both SUCCESS. New Owner registry editor is CODED / CI PENDING at this update.

Non-developer Owner can now load current alias declarations, add/remove local draft rows, review the entire replacement and save explicitly with current-version readback. No API command composition needed for this dashboard workflow. See [step-by-step Owner guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). Uncertain responses require fresh load; aliases are not provider credentials or permission proof. No actual provider action, schema migration, deployment or production acceptance. G0–G7 HOLD.


## Provider interruption recovery — latest development

Verified previous baseline `e935cef`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765773) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765743) both SUCCESS. New manual attempt source is CODED / CI PENDING at this update.

Manual provider attempts now have durable OPEN/INTERRUPTED/CLOSED metadata bound to original lease, registry revision and checkpoint; unresolved records block fresh handoff/submission/requeue until reviewed. Developer CLI supports explicit record and readback. See [provider recovery guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). No automatic provider activity, login, session transfer, measured token accounting or schema migration. Desktop mutation controls, Owner resolution UI and physical acceptance remain open. G0–G7 HOLD.


## Owner interrupted provider recovery — latest development

Previous HEAD `82e2a8c` failed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188656) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188901) on TS18049 strict-null diagnostics; disposable MySQL integration and unsigned Windows smoke passed. Explicit return guards (`4d05bde`) correct the reported paths; combined CI verification of the fix and new UI remains pending. Last fully green baseline `e935cef`.

Owner dashboard can inspect an exact ticket's provider attempt and record independent review of an unresolved revoked-lease attempt without composing API commands. It requires exact ID, explicit review and current closure readback; never requeues or calls a provider. See [recovery guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). Packaged Desktop mutation, real permitted provider recovery, context and usage proof and physical acceptance remain open. No deployment/signing or schema migration. G0–G7 HOLD.


## Consolidated Desktop provider recovery batch

Verified exact baseline `1193b3b`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215514) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45459215696) both SUCCESS. New consolidated Desktop/provider admission batch is CODED / EXACT-HEAD CI PENDING.

Packaged Desktop now has explicit manual attempt BEGIN, INTERRUPT and CLOSE controls using the original live lease and trusted worktree; reviewed context digest and provider mapping revision must match fresh Central metadata. Compact JSON has a separate read-only field. BEGIN now requires expected_task_version; rebuild Central/Desktop/CLI together. See [operator guide](docs/PROVIDER_WORKSPACE_DECLARATIONS_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). Actual provider permission, transmitted bytes and token usage remain unverified; no provider automation, schema migration, deployment or signing. G0–G7 HOLD.


## Consolidated Master batch planning

Previous exact HEAD `8145c64`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963696) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45461963719) were cancelled. Before cancellation the real MySQL and Python/shell/state jobs passed, while the TypeScript/unit/build job failed at Desktop security validation: obsolete static regex expected a ternary that had been replaced by the reviewed-context guard. Test correction `b4ec4ae` preserves the security assertions. Last fully green combined baseline `1193b3b`. New planner and correction are CODED / EXACT-HEAD CI PENDING.

Master can preview and admit 2–10 tasks atomically using a reviewed local manifest, explicit dependencies/shared contracts and exact content digest. Declared conflicts must be ordered; no partial tickets or approvals on failed admission. See [Master batch planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). This is manual planning, not autonomous generation, verified baseline or execution. Latest exact-head CI and real acceptance remain pending. G0–G7 HOLD.


## Desktop Master task planner and receipt recovery

Exact baseline `804726e` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312420) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45463312581), including previous Desktop correction and Master batch admission. New Desktop Master planner and receipt lookup are CODED / EXACT-HEAD CI PENDING.

The current approved Windows Master has a no-code local form for 2–10 tasks, reviewed digest and native admission confirmation, plus original-actor historical receipt inspection for uncertain responses. See [Master task planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). Draft is in memory; preserve exact identifiers and digest. Manual declarations only, no actual baseline verification, autonomous planning or execution. New batch CI and physical acceptance pending; G0–G7 HOLD.


## Restart-safe reviewed Master admission and project picker

Exact baseline `0fc7c7a` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325287) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45478325508), including the previous Desktop Master planner and historical receipt lookup. New project catalog and admission journal changes are CODED / EXACT-HEAD CI PENDING.

Current Master can load a minimal signed active-project catalog and select exact project identity. Native-confirmed reviewed task batch is encrypted and journaled locally before admission; on uncertainty recover original draft and inspect exact historical receipt rather than resubmit. One unresolved intent blocks new batches on this PC. Unconfirmed drafts are still in memory. See [Master planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). Physical recovery, Owner non-admission resolution, retention, actual baseline and autonomous planning remain open; no schema migration or release. G0–G7 HOLD.


## Owner interrupted Master admission reconciliation

Exact baseline `85ae5a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705079) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45480705150), including encrypted Master admission journal and signed project catalog. New Owner reconciliation batch is CODED / EXACT-HEAD CI PENDING.

Owner can inspect an unresolved original batch and, after independent review, permanently block its original request key without creating or deleting tasks. Original approved Desktop can inspect the distinct cancellation receipt and close its exact encrypted journal. Missing receipt is not proof of non-admission. See [Master planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). Actual baseline/source analysis, unconfirmed draft persistence, unavailable-signer recovery, retention and physical acceptance remain open. G0–G7 HOLD.

## Desktop local Git baseline preflight

Exact baseline `a77d3a8` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558734) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45483558666), including previous Owner admission reconciliation. New local baseline and exact project lookup changes are CODED / EXACT-HEAD CI PENDING.

Current Desktop Master can inspect a native-selected trusted local Git checkout against the exact signed active project. All tasks must match the observed local tracking-ref SHA; preview and commit recheck it. No fetch/checkout or remote freshness proof. Internal dependency ordering is not proof that future upstream code is included. See [Master planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). CLI and Central planning still require independent review. G0–G7 HOLD.

## Encrypted unconfirmed drafts and local source hints

Exact baseline `6c996cb` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717874) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45485717690), including the Desktop Git baseline preflight. New encrypted unconfirmed draft and bounded source-hint changes are CODED / EXACT-HEAD CI PENDING.

Desktop Master can explicitly save and restore unfinished task/editor fields using an encrypted per-agent CAS snapshot and inspect bounded relative-import path hints from the inspected local immutable baseline. No source upload, AI call, dependency insertion or admission authority is restored. Unsaved edits remain in memory; full semantic analysis, actual token usage, remote/upstream verification and physical acceptance are open. See [Master planning guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). G0–G7 HOLD.

## Advisory Master planning graph and compact context

Exact baseline `babd15b` passed [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449293) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45489449341). Encrypted unconfirmed draft storage and lexical source hints are source-CI verified. New advisory graph, fair sampling and compact context changes are CODED / EXACT-HEAD CI PENDING.

Desktop Master can review declared dependency waves, conflict components and fair bounded local source hints, and prepare an exact compact JSON planning preview with common baseline and byte/digest evidence. No automatic execution, semantic independence or measured provider token claim. See [operator guide](docs/MASTER_TASK_BATCH_PLANNING_V7.md), [tracker](docs/IMPLEMENTATION_TRACKER.md), [matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) and [gap register](GAP_REGISTER.md). G0–G7 HOLD.
