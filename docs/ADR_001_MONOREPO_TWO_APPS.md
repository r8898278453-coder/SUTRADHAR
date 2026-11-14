# ADR-001 — One monorepo, two separately released applications

**Status:** APPROVED DESIGN DECISION (12 November 2026); implementation/migration **PENDING**  
**Owner goal:** A non-developer can install, update and recover SUTRADHAR without routinely using a terminal, reading Git history or running SQL.  
**Scope:** SUTRADHAR v7 Central on existing Hostinger **Business web hosting**, Desktop on approximately 8–10 PCs.

## Decision

Maintain **one GitHub repository** for the product, organized as two independently built and released applications and a versioned shared contract. Do **not** split Central and Desktop into permanent development branches or separate repositories.

The authoritative runtime source is still primarily under v7/ with root scripts. **Staging build wrappers and Desktop setup UI now exist** in apps/central and apps/desktop; source extraction and independent signed releases remain pending. The following describes the complete target (do not infer all paths/subsystems exist):

~~~text
apps/central/            # Express, dashboard, MySQL migrations, Hostinger packaging
apps/desktop/            # Electron, agent daemon, worker, installers/updater
packages/shared/         # validated request/response schemas, role enums, API version
tests/contracts/         # cross-version and security tests
tests/central/           # API/MySQL tests
tests/desktop/           # agent, enrollment, updater and OS tests
tests/e2e/               # 2 real PCs; later 8–10 PC acceptance
scripts/release/         # promotion, rollback, provenance/manifest checks
.github/workflows/       # per-app CI, controlled releases
docs/                    # owner, operator and developer documentation
~~~

**An app folder is not a deployment boundary unless its manifest, dependencies, build, runtime entry and configuration are independently tested.** A simple file move cannot be considered complete.

## Why this option

| Option | Owner experience | Risk/cost | Decision |
| --- | --- | --- | --- |
| Two permanent branches, one for each app | Must understand which branch owns shared APIs and conflicts | Drifting protocol, risky merges, confusing release sources | Reject |
| Two repositories | Separate permission and version management, duplicated contract publishing | Extra coordination and release friction for one small integrated product | Defer |
| **One repo; two app folders; one shared contract** | One project to track, simple installers and dedicated Hostinger release | Requires disciplined CI/release filtering | **Select** |

Re-evaluate two repos only if there are genuinely separate products/owners, conflicting access requirements or clearly independent release governance. Repository count is not a substitute for permissions.

## Three distinct boundaries

1. **Source boundary:** one mainline with short-lived PR branches. Every change gets an owner/reviewer decision. Central and Desktop refer to explicitly versioned shared contracts.
2. **Deployment boundary:** Hostinger receives **only** a tested Central build; PCs receive **only** tested, signed Desktop artifacts. Central cannot assume Docker/long-lived background workers; Desktop can run local, authorized tooling.
3. **Security/state boundary:** MySQL on Central is authoritative. Desktop maintains only approved local identity, caches, worktrees and signed outbox entries. Master and backups are roles on PCs, not separate websites. A Central outage never triggers uncoordinated local elections.

## Branches are not application folders

**Target repository policy:**

- **main:** protected source of accepted code, not directly wired to Hostinger's automatic deployment.
- **feat/***, **fix/***: short-lived, independently testable work; PR into main with reviewers.
- **release/central-production:** **exceptional permanent release pointer** for Hostinger, not a Central development branch. Only a reviewed release promotion may advance it, with no force push; locked-down writers and environment approval. It must not accept normal developer pushes. Requires a real release/promotion implementation before use.
- **Version tags / signed artifacts:** Desktop release and Central release each receive an immutable release identity and evidence manifest. Never infer a deploy solely from a Git branch name.

**Deployment must not be coupled to a merge.** Code approved into main does not automatically mean Hostinger or all desktops should update. CI and security checks precede independent Owner approval. Use GitHub environments/branch protections and a controlled promotion workflow once implemented; no such workflow is currently installed.

For Central, Hostinger auto-deployment from GitHub may run on each push to the selected branch. This makes the release-only pointer important. For Desktop, build signing and updater publishing must be separate jobs gated on explicit authorization. Do not commit Hostinger environment variables, secrets or signing keys.

## Shared contract and compatibility

Version at least **Central version**, **Desktop version**, **API protocol version** and **MySQL schema version**, and record the minimum/maximum supported peer versions in a release manifest.

- Additive, backward-compatible protocol change: release Central first, accept previous desktop version during rollout, then progressively update desktop.
- Breaking protocol change: implement a dual-version transition or a hard stop with a staged upgrade; do not allow a surprise incompatible heartbeat or task claim.
- A desktop that is unsupported must fail closed on control actions, preserve a bounded local outbox, and display actionable instructions to the Owner; do not silently self-promote.
- Schema migrations must be **forward-compatible**, versioned, reviewable and paired with independently verified backup/restore. Code rollback does not automatically undo a database migration.
- Standard deployment must not demand simultaneous 10-PC updates or a minutes-long cluster outage.

**Status:** Versions, feature negotiation, protocol compatibility gates and release manifests are planned and are NOT yet implemented fully in v7 alpha.

## Responsibilities and permissions

| Component | Does | Must not do |
| --- | --- | --- |
| Central | authenticated HTTP, durable MySQL state, enrollment, task/epoch/leases, owner commands, dashboard, optional Telegram | run Docker, launch a provider browser or assume permanent schedulers on Hostinger |
| Desktop agent | generate/store device identity, heartbeat, recover/ack state, supervise trusted PC workers | elect Master without Central, share private identity across PCs, bypass owner/project approval |
| Developer worker | isolated worktree, exact scope, signed checkpoints, submit commit/tree | write protected main, self-approve risky schema/security changes |
| Independent QA | independently test same candidate and produce evidence | treat an unverified self-assertion as production release proof |
| Release pipeline | package/promote immutable build; report rollout and rollback state | deploy merely because a feature branch was pushed |
| Owner | approves enrollment, core/security/schema/release changes; can pause rollout | manually run routine scripts once owner tooling is completed |

## Target release workflow

~~~text
Developer PR -> scoped CI/contract/security tests -> independent QA
           -> accepted main commit
           -> Central staging build / Desktop staging build (separate)
           -> health, security, migration/restore & pilot smoke tests
           -> Owner approves selected application + immutable version
           -> Central release ref promotion OR signed Desktop publish
           -> monitor with release identity -> accept or safely recover
~~~

An approved Central update **must not** publish a Desktop installer. A Desktop-only change **must not** deploy Central. Shared contract changes must trigger both compatibility test suites even if only one application is initially promoted.

## Hostinger constraints and implications

Official Hostinger Business web hosting supports managed Node.js/Express and MySQL. Deploying one app from a monorepo is supported through its **Root directory** setting, with build/entry/output for the selected app. Limits include request timeout and no incoming WebSockets, Docker, custom ports or always-running background workers. In other words: no master/worker execution on the hosting account.

- Today: project root **./**, Node.js **22**, build **npm run build**, output **dist**, entry **dist/server.cjs**. The experimental code and schema paths still depend on root layout. Not tested live.
- After refactor: use the separately built **apps/central** only after its independent packaging and runtime path tests pass. Hostinger Root directory must be configured for the *real* app/workspace structure; don't guess in advance.
- Database endpoint on Hostinger often uses **127.0.0.1**. Credentials stay in hPanel environment settings, never in Git or an installer.

Official references:
- https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/
- https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/
- https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/


### Implementation slice after decision — 12 November 2026

**CODED (CI acceptance pending):** [apps/central/build.cjs](../apps/central/build.cjs) creates Central-only staging dist/server.cjs plus dashboard, schema and an alpha manifest; [apps/desktop/build.cjs](../apps/desktop/build.cjs) compiles a separate Edge/Worker bundle; [apps/desktop](../apps/desktop/README.md) includes an isolated Electron first-run wizard; [packages/shared/contract.json](../packages/shared/contract.json) holds the protocol/heartbeat policy. The monorepo root offers npm run test:packages to check boundaries.

**NOT IMPLEMENTED/ACCEPTED:** source extraction into fully independent workspaces; Hostinger real deploy; developer-independent signed installer/OS vault/updater; protected Central promotion; production data restore, release acceptance and physical multi-PC tests. Central should currently use monorepo root ./ with **npm run build:central**, output **apps/central/dist**, entry **apps/central/dist/server.cjs** during approved staging experiments, **not** an apps/central Root setting. There is no authority to deploy production from the draft feature branch.

## Migration plan (not yet executed)

1. Preserve the existing v7 alpha branch and baseline; inventory current runtime and test paths.
2. Extract **packages/shared** types/validation only with contract tests, maintaining old routes until proven.
3. Extract **apps/central** with an independent package, lockfile, staging MySQL migration runner and production asset packaging. Prove request-driven Hostinger staging.
4. Extract **apps/desktop** with an independently tested Electron package, secure OS identity storage, first-run wizard, signed installers and updater.
5. Separate the CI checks and add changed-path selective builds **without** skipping shared-contract/security tests.
6. Implement immutable release manifests, approved Central promotion ref, approved Desktop signing/publishing, backup/restore and audited one-click/assisted rollback.
7. Execute disposable MySQL tests, real 2-PC enrollment/failover, disconnected-PC replay and 8–10-PC pilot. Record evidence per acceptance ID.
8. Only then request Owner approval to merge and enable deployment. Never silently delete or overwrite legacy v6/SQLite data.

## Explicit non-goals today

No second repository. No Hostinger VPS purchase. No unapproved merge, database cutover, production deployment, Windows installation or real automatic updates. No claim that the prototype Electron shell satisfies an installer or that the alpha Git/QA bridges complete protected production delivery.

**Related:** [Owner guide](OWNER_SETUP_AND_DEPLOYMENT.md) · [Release operations](RELEASE_OPERATIONS.md) · [Implementation tracker](IMPLEMENTATION_TRACKER.md) · [Architecture v7](SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md).
