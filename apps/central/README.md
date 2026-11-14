# SUTRADHAR Central (Hostinger app) — alpha

**Current source:** v7/central.ts in the repo root. This folder is the new independent **build and deploy output** boundary; source has **not** yet moved into this folder. The source migration will follow a contract-test-backed refactor.

## Hostinger staging build settings

Use the **GitHub monorepo/root workspace** flow, NOT the app-folder Root directory flow yet:

| Hostinger setting | Current staging value |
| --- | --- |
| Root directory | **./** (repository root) |
| Node.js version | **22.x** |
| Build command | **npm run build:central** |
| Output directory | **apps/central/dist** |
| Entry file | **apps/central/dist/server.cjs** |
| Health | **https://STAGING-DOMAIN/v7/health** |

This build only outputs Central server and static UI, version manifest, and v7 schema. It intentionally does not bundle Electron, PC agent, QA tools or Python/Docker. Root npm dependencies still include existing legacy v6 and desktop development dependencies; full standalone dependency isolation and a lockfile remain pending.

**Never attach a production Hostinger website to the draft fix branch or ordinary main.** Hostinger's GitHub integration can automatically deploy whenever the selected branch receives a push. The approved release-only production branch/workflow is not configured yet. This is a staged build target, not permission to deploy.

## Engineer preflight

From repository root, with Node.js 22 and a controlled test environment:

~~~sh
npm install --no-audit --no-fund
npm run lint
npm test
npm run build:central
npm run check:packages
# Local staging start only after creating an isolated disposable MySQL database.
NODE_ENV=production node apps/central/dist/server.cjs
~~~

Never run migrations against a live database from development. The built release contains **dist/v7/schema.sql** and the server resolves it relative to its own bundle. Migration is still manual and Owner-authorized, behind SUTRADHAR_ALLOW_MIGRATIONS=true.

Environment variable names remain in [v7/.env.example](../../v7/.env.example) and the [Owner guide](../../docs/OWNER_SETUP_AND_DEPLOYMENT.md). No secrets in Git.

## Staging verification and backup safety — 12 November 2026

An Owner-approved staging environment can be checked **without changing it** using npm run ops:hostinger-preflight from a trusted PC. Required variables are SUTRADHAR_STAGING_URL (a staging/test HTTPS hostname) and SUTRADHAR_EXPECTED_COMMIT_SHA (full exact deployed SHA). The verifier checks /v7/health, MySQL authority, release manifest SHA/protocol and the dashboard, and reports production_accepted:false deliberately.

Encrypted logical MySQL backup code exists at scripts/ops/mysql-ops.cjs with AES-256-GCM verification before a **different empty staging/test database** restore. It requires permitted MySQL client connectivity on a separate operator machine, not a long-running worker on Hostinger shared hosting. If Hostinger doesn't allow external MySQL for the account, use the hPanel database backup/export workflow and a controlled separate restore rehearsal instead. The current code has **not performed an actual Hostinger deploy, MySQL backup or live restore**.

See the [Owner-ready production checklist](../../docs/PRODUCTION_READINESS_V7_2026-11-12.md) for all safety checks and environment-dependent gates. The protected Central production promotion pipeline remains unimplemented.

## Status

- Central-only bundle: **implemented, CI acceptance pending**.
- App-specific clean install/root independent of monorepo: **NOT IMPLEMENTED**.
- Hostinger actual deploy/DB backup restore: **NOT RUN**.
- Safe versioned migrations: **NOT IMPLEMENTED**.
- Protected Owner-approved production promotion: **NOT CONFIGURED**.

See [ADR](../../docs/ADR_001_MONOREPO_TWO_APPS.md) and [Release operations](../../docs/RELEASE_OPERATIONS.md).
