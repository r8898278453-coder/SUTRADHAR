# Owner provisioning — SUTRADHAR Central + Windows Desktop

**Version:** 12 November 2026 · **Project:** SUTRADHAR v7  
**Audience:** Non-developer Owner · **Status:** NOT YET PROVISIONED OR DEPLOYED

This guide turns the last production prerequisites into a clear list of **account settings and actions**. **Never paste database passwords, signing certificates, private keys, GitHub secrets, or enrollment codes into chat, issues, PRs, or screenshots.** Enter them directly in the relevant secure Hostinger/GitHub/OS interface.

## Your three decisions (no credentials required)

1. Pick a **staging subdomain**, e.g. stage.yourdomain.com, separate from the eventual production Central website.
2. Decide who is allowed to **approve releases** in GitHub (Owner and a second reviewer recommended) and whether your Windows signing certificate is already available or must be procured.
3. Choose **two distinct Windows PCs** for first enrollment/failover, then a third PC for Backup 2. Final full pilot includes 8–10 PCs.

## A. Hostinger staging (Owner in hPanel)

| Step | What to do | Expected proof |
| --- | --- | --- |
| A1 | Websites → Add website → **Node.js Web App**; use separate staging subdomain and enable HTTPS | Staging address opens in browser |
| A2 | Create a fresh **staging MySQL database/user** with its own password; save in a password manager | DB name/user available privately; NO live production database touched |
| A3 | Prepare environment values: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, SUTRADHAR_ADMIN_KEY, SUTRADHAR_ENROLLMENT_CODE, NODE_ENV=production, SUTRADHAR_ALLOW_MIGRATIONS=false | Stored privately in hPanel, never GitHub |
| A4 | Staging GitHub connection: **ONLY after approved candidate**, select reviewed staging release branch, not current fix/* or main | Hostinger deployment log shows exact commit |
| A5 | Current code's monorepo settings: Root **./**, Node **22**, Build **npm run build:central**, Output **apps/central/dist**, Entry **apps/central/dist/server.cjs** | Build/entry align with real source layout |
| A6 | Have engineer validate schema and bootstrap **only empty staging DB** with privileged migration flag temporarily enabled, then disable it | One-time receipt + fresh database backup |
| A7 | Open https://STAGING_DOMAIN/v7/health | ready:true, authority:mysql, api_protocol:7 |
| A8 | After approved merge of workflows: GitHub Actions → **Hostinger Staging - Verify Only** → Run workflow; enter staging URL and exact full Hostinger deployed SHA | Successful read-only preflight; NO automatic deployment |

**Important:** Creating a Node.js website consumes an applicable Hostinger site slot. Verify plan limits before adding. Hostinger's Node.js GitHub connection can **auto-deploy on every push to its selected branch**; don't connect an unprotected branch. This project does not use the separate PHP/HTML Advanced → Git setup.

If external MySQL access is unavailable on Hostinger shared hosting, use hPanel's native backup/export feature and a separate staged restore. The project's off-host encrypted backup CLI requires a permitted MySQL client connection and must NOT be run as a continuous Hostinger background process.

## B. GitHub release protection (Owner in repository Settings)

1. Open [Repository Settings](https://github.com/r8898278453-coder/SUTRADHAR/settings) → **Rules → Rulesets** (or Branches/branch protection). Protect **main**: required PR reviews, no direct pushes/force pushes, CI checks on exact commit, non-bypassable except clearly controlled Owner recovery.
2. Under **Settings → Environments**, create **sutradhar-desktop-signing**. Before adding ANY certificate, require Owner (or dedicated release reviewer) approval, prevent self-review if appropriate, restrict deployments to **main**, and disable admin bypass if available. GitHub plan/repository visibility affects available protection features: inspect the UI instead of assuming.
3. Only after those rules are saved, add **environment secrets** WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or an approved hardware/cloud signing provider configured and tested against the actual electron-builder version). NEVER store certificates in repo variables or ordinary text files.
4. Add **environment variables** (not secrets): SUTRADHAR_WINDOWS_PUBLISHER_NAME (exact Authenticode certificate subject starting CN=), and SUTRADHAR_RELEASE_UPDATE_PUBLIC_KEY_PEM_B64 (the *public* Owner Ed25519 verification key in base64).
5. **Last switch:** environment variable **SUTRADHAR_SIGNING_CONTROLS_VERIFIED=READY_BY_OWNER**. Leave unset until certificate ownership, environment reviewer/branch restrictions, secret scope and CI dependency locks have been independently checked.
6. Before a real stable release, developers must commit reviewed reproducible lockfiles (package-lock.json and apps/desktop/package-lock.json) and replace alpha version with a reviewed stable semver. Create an immutable desktop-vX.Y.Z tag pointing to reviewed **main HEAD**. This is NOT done.
7. Then, after Owner approval, GitHub Actions → **Desktop Windows - Owner Protected Signing (NO PUBLICATION)** → Run workflow. Enter exact full main SHA, tag and confirmation **APPROVE SIGNING WITHOUT PUBLISHING**. The workflow only builds/signs/verifies locally; it **does not upload, distribute or install** the EXE.

**Why so restrictive?** The SUTRADHAR GitHub repo is currently **PUBLIC**. A signing secret is sensitive even though source code is public; only a protected environment should ever see it. A manually set Boolean in a developer shell is not a substitute for GitHub environment approval. Signing is blocked until a trusted certificate and proven release integrity exist.

**Workflow availability:** New workflow files live on draft PR #1. GitHub shows manual **Run workflow** once the reviewed workflow exists on default branch; no approval to merge PR #1 has been given, so these workflows are not yet ready for Owner use.

## C. Real Windows PCs (Owner)

1. Choose **PC-A** and **PC-B** on different physical machines, then **PC-C**. Record friendly names, Windows build, network and Central URL in your secure test inventory, not private device keys.
2. Do not install an unsigned QA EXE. A trusted installer requires Windows code signing and an Owner-approved tested release. Prior QA CI only proved the installer can be generated; it did not prove software safety.
3. First-run wizard target: Central HTTPS URL → PC name → local agent count → one-time enrollment → explicit Owner approval of **node and agent identities** in Central.
4. Check approx. **60-second signed heartbeat**. Master first election must respect **08:00 Asia/Kolkata**, healthy incumbency stays sticky; backups should live on different PCs.
5. Do controlled **staging-only Master shutdown**, wait for ~180-second lease expiration, and capture distinct read-only before/after receipts using the [PC pilot guide](PRODUCTION_READINESS_V7_2026-11-12.md). Recover old Master without duplicates.
6. With 3 PCs, test Backup 2; with 8–10, test intermittent network, reboot/login, QA independence, Git receipts, central restart, key vault persistence, signed update and rollbacks. All 71 acceptance requirements need evidence.

## Current status (no guesswork)

| Gate | Status |
| --- | --- |
| GitHub public repository; draft PR and source | VERIFIED |
| Read-only Hostinger verification workflow | CODE ADDED, not run |
| Manually gated Windows signing workflow | CODE ADDED, not run; locked |
| GitHub main branch/ruleset approval configuration | **NOT VERIFIED / OWNER MUST SET** |
| Hostinger staging site / MySQL credentials / backups | **NO ACCESS — NOT RUN** |
| Owner certificate, signing key, stable tag, dependency locks | **NOT PROVIDED / NOT READY** |
| 2–3 Windows PC trial and 8–10 PC pilot | **NOT RUN** |
| Safe automatic update/rollback distribution | **NOT IMPLEMENTED** |
| Actual deployment, production merge | **NOT PERFORMED** |

## What to share back safely

To resume actual environment-specific work, provide **only non-secret status**: “staging domain ready” and its *public* HTTPS URL, “Windows certificate available: yes/no” (no certificate content), “GitHub environment reviewers enabled: yes/no”, and “2 physical PCs available: yes/no”. All actual passwords/private keys should remain in secure Hostinger/GitHub settings and not in this conversation.

[Main README](../README.md) · [Full Owner setup](OWNER_SETUP_AND_DEPLOYMENT.md) · [Release acceptance](PRODUCTION_READINESS_V7_2026-11-12.md) · [Technical tracker](IMPLEMENTATION_TRACKER.md)
