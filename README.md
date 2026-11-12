# SUTRADHAR

**One system. Two applications. One GitHub repository.**

> **Release status — 12 November 2026:** SUTRADHAR v7 is an **alpha implementation on a draft pull request**, NOT an approved production release. Do not connect the draft branch to a live Hostinger site or distribute it as a trusted PC installer. No production deployment, Windows installer, automatic updates, or full 8–10-PC acceptance has been completed.

SUTRADHAR coordinates a group of PCs through an authoritative control plane:

- **Central (Hostinger Business web hosting):** browser dashboard, HTTPS API, MySQL, node approval, master/backup election, projects/tasks/checkpoints, audit, optional Telegram controls.
- **Desktop (each Windows/other supported PC):** local agent and Electron shell; sends signed heartbeats, performs authorized developer/QA work on the PC, and recovers state from Central after a failover.
- **Shared protocol:** API contracts, identities, authorization, version compatibility. Central stores authoritative orchestration state; a Master PC never becomes its own source of truth.

## Start here — choose your role

| You want to... | Read this first |
| --- | --- |
| Understand how Central and Desktop fit together | [Architecture & repository decision](docs/ADR_001_MONOREPO_TWO_APPS.md) |
| Set up or operate the system without programming | [Owner's installation and deployment guide](docs/OWNER_SETUP_AND_DEPLOYMENT.md) |
| Approve a release, investigate failures or recover safely | [Release, update & rollback policy](docs/RELEASE_OPERATIONS.md) |
| Run the existing **alpha** with developer assistance | [Current v7 implementation/runbook](v7/README.md) |
| Review original technical requirements | [V7 architecture blueprint](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md) and [Agent/Task/QA contract](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md) |
| See what has actually passed and what remains | [Implementation tracker](docs/IMPLEMENTATION_TRACKER.md) and [71-case acceptance matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md) |
| Review Windows signing, OS-vault keys, Hostinger staging, encrypted backup and physical PC acceptance | [Production-readiness checklist](docs/PRODUCTION_READINESS_V7_2026-11-12.md) |

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

**Important:** This is the **target experience**, not something the current alpha can do end-to-end today. Today, Central schema setup requires a privileged authenticated API call; PCs require Node.js, environment configuration and manually started agents; the Electron shell is not a packaged installer. See the [owner guide](docs/OWNER_SETUP_AND_DEPLOYMENT.md) for an honest READY vs NOT READY checklist.

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
npm install
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

Before calling SUTRADHAR "one-click" or "production ready" we still need: an independently deployable Central app; reproducible locked dependencies; safe reviewed migrations and proven backup/restore; protected Owner-gated promotion; a Windows installer with secure machine-key storage and a verified updater; an enrollment wizard and reliable background startup; actual multi-PC failover; browser-provider-permitted workflows; real GitHub PR/QA evidence; and completed acceptance gates. The latest CI results cover only their stated scope, **not** full real-world acceptance.

**The draft v7 implementation is under [PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1). Keep it unmerged until explicit Owner approval.**

## Hostinger reference documents

- [Node.js web app from GitHub](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Monorepo root-directory deployment](https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/)
- [Business Node.js runtime limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)
- [Connect Node.js to Hostinger MySQL](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)

These describe Hostinger platform features; **they are not proof that this application has been deployed or accepted**.
