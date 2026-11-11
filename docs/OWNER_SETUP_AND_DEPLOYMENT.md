# SUTRADHAR — Owner setup & deployment guide (non-developer first)

**For:** the person who owns Hostinger, GitHub and the 8–10 PCs.  
**Version:** 12 November 2026. **Applies to:** approved *target* deployment experience, with an honest inventory of what the current alpha can do.

> **STOP / no production go-live yet.** This repository's v7 code is currently an alpha on draft PR #1. A first-time Hostinger deployment, database backup/restore, full installer, automatic updates and real multi-PC failover have not been accepted. The instructions below identify exactly what the Owner will eventually click and what requires a developer in the meantime.

## Five terms in simple language

- **GitHub:** where source code and approved release artifacts are stored.
- **Central:** SUTRADHAR's website and API on Hostinger; everyone talks to this.
- **MySQL:** the Central database; holds authoritative node, Master, ticket and audit state.
- **Desktop:** the PC application and local agent; does work and reports to Central.
- **Release:** a tested, explicitly approved version. A code commit is **not** automatically a release.

You only manage **one repository** and **one Central website**. Each PC gets **one Desktop installation**, which can host multiple agents. The Master and two ranked backups are selected among approved PCs by Central; they are not three separate servers.

## What you need before first setup

| Item | Owner action | Current alpha status |
| --- | --- | --- |
| Hostinger Business web hosting account and a domain/subdomain | Have access to hPanel | Supported by provider, **not tested for SUTRADHAR** |
| GitHub repository access and branch protection | Approve reviewers and release permissions | Repository exists; protection/release promotion **not configured** |
| Dedicated MySQL database and strong password | Create in Hostinger; store password in password manager | Schema exists; staging restore/migration proof **not done** |
| Private Owner admin secret and a different enrollment secret | Generate independently; never post, email or commit | Current alpha uses configured secrets; enrollment hardening pending |
| HTTPS URL for Central | Select domain, ensure HTTPS certificate | **No live deployment verified** |
| One trusted test PC first, then another distinct PC | Be able to approve both nodes | Signed agent code exists; 2 physical PC pilot **not done** |
| Signed Windows installer and update channel | Download only from approved releases | **NOT BUILT** |
| Verified backups and rollback plan | Record who can restore and confirm | **NOT ACCEPTED** |

**Safety:** do not put secrets in README, a GitHub issue/PR, ChatGPT messages, screen recordings, Desktop installer, or the same shared folder on every PC. A developer may need temporary access through a secure credential manager, never through code.

## Part A — Central / Hostinger (target Owner workflow)

**A1. Approve a version.** In GitHub, review the proposed Central release summary: version, commit SHA, required CI/independent QA, compatibility list, database migration plan and rollback plan. Give the explicit Owner approval *for Central production*. A general merge approval is not enough.

**A2. Add a Hostinger Node.js web app.** Log in to Hostinger **hPanel**, choose the existing Business hosting plan, and use **Websites → Add website → Node.js Web App** (wording may vary by dashboard version). Select **Import Git Repository / Connect with GitHub**, authorize only the necessary repository, and choose SUTRADHAR. Hostinger's generic PHP/HTML **Git integration** is not the same flow; use the Node.js web-app flow.

**A3. Select the release source, not a development branch.** Once implemented, set Hostinger's deploy branch to protected **release/central-production**. It must move *only* when an Owner-approved workflow promotes a reviewed version. **This branch and release workflow do not currently exist:** do not link a live production site to the existing fix branch or ordinary main.

**A4. Review build settings.** Once the independent Central app refactor is completed and tested, use the settings shipped with its release manifest. **For current alpha/staging experiments only**, the new Central-only build wrapper now provides:

| Current staging setting | Value |
| --- | --- |
| Framework | Express / Node.js |
| Runtime | Node.js 22 |
| Root directory | Repository root: **./** |
| Build command | **npm run build:central** |
| Output directory | **apps/central/dist** |
| Entry file | **apps/central/dist/server.cjs** |
| Public verification URL | **https://YOUR-DOMAIN/v7/health** |

Those are **not** the future apps/central settings. Do not select apps/central yet: the folder does not exist. The new Central-only staging bundle copies the UI and v7/schema.sql beside its server entry, and intentionally excludes PC-side bundles; **real Hostinger runtime packaging and restoration are not yet accepted**. The legacy combined npm run build still produces Desktop-side bundles and must not be used as a production Central release.

**A5. Create a separate MySQL database.** In hPanel use **Websites → Manage site → Databases → Management** (exact names may vary). Create a fresh database and dedicated user with a unique long password. Record the **full Hostinger-prefixed database name/user** in your secure password manager. Do **not** import/overwrite the old SQLite database. For a Hostinger-local MySQL connection use host **127.0.0.1**, not localhost.

**A6. Configure secrets only in the website's environment variables.** Enter the following via Hostinger's environment settings. Blank values below are *placeholders*, never usable production credentials.

| Variable | What it means | Notes |
| --- | --- | --- |
| DB_HOST | Database host | **127.0.0.1** on Hostinger, subject to current account details |
| DB_PORT | Database port | Commonly **3306** |
| DB_NAME, DB_USER, DB_PASSWORD | Dedicated MySQL database details | Exact full prefixed values from hPanel |
| SUTRADHAR_ADMIN_KEY | Owner control/API authorization secret | At least 32 random characters; Owner only |
| SUTRADHAR_ENROLLMENT_CODE | Initial PC enrollment gate | Different long secret; current shared-secret design is alpha |
| NODE_ENV | Runtime mode | **production** |
| SUTRADHAR_ALLOW_MIGRATIONS | Enables privileged one-time schema endpoint | Leave **false** outside a tightly supervised, approved migration |
| SUTRADHAR_GITHUB_TOKEN and PR token | Optional GitHub inspection/draft PR capability | Keep unset until scoped permissions and release gates are verified |
| TELEGRAM_* | Optional bot/webhook authorization | Keep disabled until Owner-validated |
| PORT | Managed by hosting environment | Do not hardcode a public custom port |

Only use database TLS settings after verifying actual Hostinger database TLS support and certificates. **No database credentials go onto Desktop PCs.** See [v7/.env.example](../v7/.env.example) for exact alpha variable names.

**A7. Schema migration is currently developer-assisted.** This alpha does **not** have a safe one-click migration wizard. The schema bootstrap is an authenticated POST to **/v7/owner/migrate**, guarded by **SUTRADHAR_ALLOW_MIGRATIONS=true**; it expects **v7/schema.sql** in the app's runtime working directory. Do not execute from the browser address bar, leave the flag on, or run against existing production data. A developer must first validate staging packaging, review SQL, back up/restore a disposable DB, perform the authorized operation, turn the flag off and restart. Future releases will use versioned migrations with a visual, approval-gated status.

**A8. Verify health without editing data.** Confirm HTTPS and open **https://YOUR-DOMAIN/v7/health**. The expected healthy response after valid config and schema is a JSON object containing **ready: true** and **authority: mysql**. An HTTP 503, blank page, auth error or database error is **NOT** success. Then open the dashboard and sign in using Owner-approved credentials through a trusted browser. Confirm the display agrees with live node/agent records.

**A9. Turn on only after acceptance.** Required evidence: deploy log, exact Central version/commit, DB schema version, backup and restore test, live authenticated dashboard, forbidden-request tests, restart and outage behavior, two-PC trial, and Owner sign-off. Until then this is a staging-only technical experiment.

**Official Hostinger help (screens and labels may change):**
- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/
- https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/
- https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/

## Part B — Desktop / each PC (target Owner workflow)

**B1. Start with one pilot PC, then a second.** Do not install to all 10 PCs at once.

**B2. Only use an approved, signed installer.** The target flow is **GitHub Releases → SUTRADHAR Desktop vX → verified installer → Windows install wizard**. Confirm publisher/signature and release version. **Today there is no trusted packaged installer**; do not download random EXEs or treat the Electron source folder as an installable product.

**B3. First-run wizard.** Target screens will ask for the Central **HTTPS URL**, a friendly PC label and a short-lived enrollment grant. The app generates device identity locally (ideally Windows DPAPI/OS-backed secret storage), registers the PC and waits for Owner approval. **This wizard and OS vault integration are NOT implemented yet.**

**B4. Approve in Central.** Open Owner dashboard: new **PC pending → inspect node fingerprint/name → approve node**; then review its **agent IDs and roles → approve eligible agents** and project-specific permissions. Confirm the PC is genuinely yours before approval. Do not approve a duplicate/cloned machine identity or give all roles by default.

**B5. Observe heartbeats.** Once approved, the agent should send **one signed aggregate heartbeat every ~60 seconds**. After ~180 seconds without accepted heartbeat, Central can mark it ineligible. A healthy Master stays Master; Backup 1/2 are separate ranked fallbacks. Check two distinct physical PCs and forced Master restart *in staging*, never in the middle of a critical production task.

**B6. Expand gradually.** After passing physical 2-PC acceptance, enroll remaining PCs in small batches, each with distinct persistent device identity and correct work permissions. Keep QA independent from the code author for a given ticket.

**Current developer-only workaround:** Node.js 22, locally built dist/v7-agent.cjs, process supervision and environment variables including **SUTRADHAR_CENTRAL_URL**, **SUTRADHAR_AGENT_IDS**, **SUTRADHAR_NODE_NAME**, and an enrollment code; see [v7 runbook](../v7/README.md). This is not a non-developer install, does not solve Windows automatic start, and stores a filesystem identity rather than using a production-grade OS vault. The Electron code currently only opens the dashboard and authorized external browser pages.


**New code implemented, physical tests pending:** the separate [Desktop alpha app](../apps/desktop/README.md) now has a local first-run Electron wizard, unique generated agent IDs, protocol-7 Central health check and a supervised local agent. It is **not yet a signed installer**, OS-vault identity storage or an approved update mechanism. The [Central staging app](../apps/central/README.md) has a separate bundle and schema copy.

## Part C — What daily operation should look like

| Situation | Owner should see/do | What the system does |
| --- | --- | --- |
| PC online | Green/online state, last heartbeat, installed version | Signed heartbeat and Central state update |
| PC unexpectedly offline | Alert; inspect status and network | Epoch-fenced recovery/failover by Central when policy permits |
| Master offline | Inspect promoted backup and recovery status | Qualified Backup 1, then Backup 2, claims new epoch; no duplicate Master |
| Central unreachable | Wait for authoritative service restoration, protect in-flight work | PCs do not locally elect Master; preserve bounded signed outbox |
| New project | Approve intended agents and scope | Authoritative task/lease project ACLs |
| Code needs sensitive change | Review change request | Work remains blocked until Owner authorization |
| Central release proposed | Review staging evidence, approve/promote or reject | Central-only deploy, health verification, audit receipt |
| Desktop release proposed | Review signature/compatibility, approve pilot rollout | Desktop-only release, staged update; old compatible versions supported |
| Failure after deployment | **Pause rollout and follow recovery guide** | Preserve evidence and use appropriate code/database restore strategy |

The rows above include **target UX**; current alpha offers only portions of the underlying capabilities. For current status consult the [implementation tracker](IMPLEMENTATION_TRACKER.md).

## Part D — Troubleshooting before touching production

- **Website won't open / HTTP 503:** check Hostinger Deployments, Node.js runtime logs and process/resource limits. Confirm Node version, build, output and entry. Do not repeatedly redeploy random branches.
- **Health not ready:** verify environment variable names and credentials; check MySQL availability and actual schema state. A 503 must never be presented as healthy.
- **Database login fails:** recheck prefixed database/user and **127.0.0.1**; never put passwords into logs or screenshots.
- **Old UI after release:** compare the Hostinger deployment commit and branch, clear CDN/browser cache and restart *only after* confirming rollout status.
- **PC pending:** Owner must approve the exact physical PC and agents; unapproved identity must not do work.
- **Heartbeat missing:** check HTTPS access, device identity uniqueness and Central; do not force-promote a Master locally.
- **Desktop update failed:** pause wave, keep last good compatible version, and preserve agent identity. Do not erase the identity/data directory to make the error disappear.
- **Database migration failed:** stop; do not rerun repeatedly. Use migration receipt, backup checksum, restore test and developer review before a new attempt.

## Final production go/no-go checklist

Mark each line with **real evidence**; no automated status is inferred from these written instructions.

- [ ] Exact Owner-approved Central and Desktop release versions published
- [ ] Required GitHub review/branch rules and signing key rotation completed
- [ ] Reproducible Central build and separate Hostinger stage deploy proven
- [ ] MySQL schema migration, downgrade/forward compatibility and **actual restore test** passed
- [ ] HTTPS/Owner auth/Telegram privilege and audit controls independently tested
- [ ] Two different PCs enrolled; signed identity and 60s heartbeat/failover measured
- [ ] Real PC installer, secure OS key vault, startup supervision and update pilot tested
- [ ] ChatGPT/AI Studio actions remain compliant with authorized account/provider limits
- [ ] Developer vs independent QA and exact GitHub PR/CI/merge receipt verified
- [ ] Desktop protocol compatibility tested during staggered rollout
- [ ] 71-case acceptance matrix evidenced and 8–10 PC pilot signed off
- [ ] Owner explicitly approves each initial production deployment

**As of 12 November 2026 these release gates are NOT complete.** This guide is a deployment contract and checklist, not a claim of successful installation.

**See also:** [README](../README.md) · [Architecture decision](ADR_001_MONOREPO_TWO_APPS.md) · [Release/recovery](RELEASE_OPERATIONS.md) · [Technical alpha runbook](../v7/README.md).
