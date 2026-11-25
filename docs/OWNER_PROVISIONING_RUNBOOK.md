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
| A8 | Set the exact Owner-controlled **GitHub repository variable** `SUTRADHAR_STAGING_ALLOWED_HOSTNAME` to your staging hostname (example: `stage.yourdomain.com`), **without** `https://`, path, port or secret. Then, only after reviewed workflow merge, run **Hostinger Staging - Verify Only** with that exact HTTPS URL and deployed 40-character SHA. | Same pinned hostname, safe public DNS answer and bounded responses confirmed; no automatic deployment |

**Restore credential separation (G2):** The DB_USER in the staging website
configuration is the Central application's runtime credential, not automatic
permission to run a backup restore. For the independent operator restore,
create/approve a separate login with grants **only** to the empty staging
schema. On the trusted operator workstation, separately set
SUTRADHAR_EXPECTED_RESTORE_DB_USER to the exact DB_USER before running
npm run ops:restore-staging; protect its password and archive key outside
GitHub, chat and deployment logs. The CLI refuses root/admin-style names,
but only a DBA's actual GRANT and role inspection can prove no broader
privileges. Follow the
[staging restore runbook](V7_STAGING_RESTORE_INDEPENDENT_ACCEPTANCE.md)
and require signed independent G2 evidence before production approval.

**Important:** Creating a Node.js website consumes an applicable Hostinger site slot. Verify plan limits before adding. Hostinger's Node.js GitHub connection can **auto-deploy on every push to its selected branch**; don't connect an unprotected branch. This project does not use the separate PHP/HTML Advanced → Git setup.

If external MySQL access is unavailable on Hostinger shared hosting, use hPanel's native backup/export feature and a separate staged restore. The project's off-host encrypted backup CLI requires a permitted MySQL client connection and must NOT be run as a continuous Hostinger background process.

## B. GitHub release protection (Owner in repository Settings)

1. Open [Repository Settings](https://github.com/r8898278453-coder/SUTRADHAR/settings) → **Rules → Rulesets** (or Branches/branch protection). Protect **main**: required PR reviews, no direct pushes/force pushes, CI checks on exact commit, non-bypassable except clearly controlled Owner recovery.
2. Under **Settings → Environments**, create **sutradhar-desktop-signing**. Before adding ANY certificate, require Owner (or dedicated release reviewer) approval, prevent self-review if appropriate, restrict deployments to **main**, and disable admin bypass if available. GitHub plan/repository visibility affects available protection features: inspect the UI instead of assuming.
3. Only after those rules are saved, add **environment secrets** WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or an approved hardware/cloud signing provider configured and tested against the actual electron-builder version). NEVER store certificates in repo variables or ordinary text files.
4. Add **environment variables** (not secrets): `SUTRADHAR_WINDOWS_PUBLISHER_NAME` (exact Authenticode certificate subject starting CN=), plus four **independently generated** Ed25519 *public* key values encoded as base64: `SUTRADHAR_RELEASE_UPDATE_PUBLIC_KEY_PEM_B64`, `SUTRADHAR_INSTALL_EXECUTION_PUBLIC_KEY_PEM_B64`, `SUTRADHAR_MAINTENANCE_RELEASE_PUBLIC_KEY_PEM_B64`, and `SUTRADHAR_FAILURE_REVIEW_PUBLIC_KEY_PEM_B64`. These correspond to separate Owner trust roots; the signing code rejects reused public keys. Store every **private** key separately in protected signing infrastructure, never repository variables, the app, PRs, or chat.
5. **Last switch:** environment variable **SUTRADHAR_SIGNING_CONTROLS_VERIFIED=READY_BY_OWNER**. Leave unset until certificate ownership, environment reviewer/branch restrictions, secret scope and CI dependency locks have been independently checked.
6. Root and Desktop npm v3 lockfiles are now **committed to draft PR #1** and checked by Linux/Windows CI. An independent dependency/security reviewer must approve them before any release. Developers must separately replace the alpha version with approved stable semver and create an immutable desktop-vX.Y.Z tag pointing at reviewed **main HEAD**. None of these release approvals or tags has been performed.
7. Then, after Owner approval, GitHub Actions → **Desktop Windows - Owner Protected Signing (NO PUBLICATION)** → Run workflow. Enter exact full main SHA, tag and confirmation **APPROVE SIGNING WITHOUT PUBLISHING**. The workflow only builds/signs/verifies locally; it **does not upload, distribute or install** the EXE.

**Why so restrictive?** The SUTRADHAR GitHub repo is currently **PUBLIC**. A signing secret is sensitive even though source code is public; only a protected environment should ever see it. A manually set Boolean in a developer shell is not a substitute for GitHub environment approval. Signing is blocked until a trusted certificate and proven release integrity exist.

**Workflow availability:** New workflow files live on draft PR #1. GitHub shows manual **Run workflow** once the reviewed workflow exists on default branch; no approval to merge PR #1 has been given, so these workflows are not yet ready for Owner use.



### B0 — Read-only GitHub protection audit (does not set any rules)

After configuring protections in Settings, a trusted operator with Node.js 22
can inspect the current **main** branch and effective GitHub branch rules without
editing GitHub. Use a pinned known SHA obtained directly from the protected
GitHub main branch; never substitute the fix/PR SHA:

~~~sh
export SUTRADHAR_G0_REPOSITORY=r8898278453-coder/SUTRADHAR
export SUTRADHAR_G0_EXPECTED_MAIN_SHA=<40-character-main-SHA>
# Optional if public REST visibility is insufficient: set a read-only
# GITHUB_TOKEN using a trusted local credential manager, never in a chat.
npm run ops:github-g0-protection
~~~

The audit checks branch-protected metadata, the exact SHA, applicable rules
reported by GitHub, rejection of force-push/deletion, independent PR approval
with stale-review dismissal and last-push approval, and exact-head CI contexts.
A 403/permission failure, missing rule or incomplete response returns **HOLD**.
A compatible snapshot still reports \`g0_release_gate:HOLD\` and
\`production_release_authorized:false\`: bypass actors, protected signing
environment reviewers, actual human approvals and all live-world G1–G7
evidence require independent Owner verification. This is never a script to
add rules or merge a PR. GitHub plan/repository settings may limit which rules
are available; only the Owner can resolve that safely.

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


## 15 November 2026 — Interrupted PC enrollment recovery

If Desktop says **Submission uncertain — Owner review required**, inspect the **same node ID** and approval state in Central. Do not remove the encrypted OS vault or request a new node to bypass the issue.

For a legitimate already-registered node, the Owner can approve that node and the PC user may click **Recheck uncertain enrollment**. Only signed, read-only proof of the existing approved node finalizes the receipt; no new grant is submitted. If no matching approved node exists, the app must remain blocked until an independent Owner-guided recovery or rotation procedure is designed and approved.

A second Desktop instance is now denied a second local agent process. Real Windows reboot, installer, single-instance and crash tests are NOT RUN.

## 15 November 2026 — Preparing Owner rollout wave approvals

For a future **signed** Desktop update, the Owner must select the **exact existing enrolled node IDs** for a named wave (initially one non-critical PC). The trusted release engineer adds the wave ID and 1–10 approved recipients to the **Owner Ed25519-signed offline offer**; another PC must refuse it. A separate emergency rollback offer requires a separate Owner approval. No credentials are shared in chat or Git.

This is not an update execution or distribution feature. The installed alpha has no configured trust root, and actual certificate signing/physical-PC rollout remain blocked. [Full instructions](SIGNED_DESKTOP_ROLLOUT_WAVES.md).

## 15 November 2026 — Safety before taking a PC offline for an update

The packaged Desktop can now **inspect** a signed update offer and check through Central whether it is currently Master or Backup 1/2. A PC with active role, unknown agents, missing backups, paused cluster or unreachable Central is blocked from claiming update readiness. Even a noncritical result is **not** an installation approval or guaranteed failover; roles may change. Inspection creates a local node-signed **NOT INSTALLED** receipt. For actual updates, get explicit Owner maintenance approval and real physical Windows tests first. [Read the full preflight runbook](DESKTOP_MAINTENANCE_PREFLIGHT_V7.md).


## 15 November 2026 — Owner maintenance-intent dashboard

A new reviewed Central schema table and Owner dashboard panel permit a **five-minute update intention** for a specific idle, approved, noncritical PC and signed-offer SHA. The Owner enters node ID, wave, version and offer hash; current Master epoch is shown automatically. No shell/API coding is required for the Owner after staging has been migrated.

Buttons remain blocked if the new table/endpoint is unavailable. **Recording intent is not permission to stop agents or execute any update.** Never take a Master or either backup offline based on one snapshot. [Owner guide](OWNER_PC_MAINTENANCE_INTENT_V7.md).

## Read-only Hostinger staging preflight containment — 20 November 2026

A GitHub Actions manual input is **not** staging authorization. Before using the `Hostinger Staging - Verify Only` workflow, the Owner must set GitHub repository **Settings → Secrets and variables → Actions → Variables → New repository variable**: `SUTRADHAR_STAGING_ALLOWED_HOSTNAME` = the exact approved staging hostname, e.g. `stage.yourdomain.com`. This is a nonsecret, Owner-controlled configuration; the workflow must not accept it as an input field. Leave it unset until the staging website/domain is actually provisioned and approved. The workflow refuses to contact any target when the variable is absent, wrong or inconsistent with `staging_url`. Only a reviewed main-branch workflow may run it.

For an operator running the read-only CLI from a trusted workstation, set `SUTRADHAR_STAGING_ALLOWED_HOSTNAME` from the same privately reviewed staging domain registry, `SUTRADHAR_STAGING_URL=https://stage.yourdomain.com` and `SUTRADHAR_EXPECTED_COMMIT_SHA` to the **exact deployed full Git commit**. Do not copy the URL from an arbitrary ticket or chat message. The preflight rejects HTTP, custom ports, query strings, credentials, non-staging domains, loopback/internal/reserved DNS answers, redirects, unsigned evidence and oversized HTTP responses. Public DNS verification is an early check, **not a connection-pinned firewall**: administrators must separately configure runner/host network egress, trusted DNS and domain ownership to mitigate later DNS rebinding. If checks fail, do not deploy or reconfigure production as a workaround.

A PASS is only a read-only **staging** snapshot: Central service health, MySQL readiness claim, release manifest SHA and dashboard content, plus hostname/DNS/response safeguards. It does **not** prove real database row recovery, migration safety, Owner review, physical Windows nodes, code signing or production readiness. Keep `main` and production Hostinger deploy target unchanged. Preserve the runner receipt, deployment log and independent MySQL backup/restore evidence in the Owner's private register, never secrets.

## 20 November 2026 — Owner physical-PC pilot evidence collection (alpha)

A read-only multi-PC observer and offline Owner evidence bundle verifier now exist for physical G4/G5/G6 acceptance preparation. Start at [Owner physical-PC pilot runbook](V7_PHYSICAL_PILOT_OWNER_RUNBOOK.md). Provision and independently verify actual Windows PCs and approved node identities first. Set SUTRADHAR_PILOT_ALLOWED_HOSTNAME separately from SUTRADHAR_CENTRAL_URL and SUTRADHAR_PILOT_SOURCE_SHA to the full deployed-commit claim; capture **distinct immutable before/after Central GET snapshots**, physically isolate the original Master ONLY by an Owner-managed real-world operation, and save separately reviewed witness documentation.

The upgraded pure policy requires 2–10 unique nodes, exactly one intentional offline original Master for 2/3-PC failover, correct Backup-1 promotion, next epoch, unchanged exact node set, chronological timestamps, and no former Master marked live. Sticky-Master evidence for three or eight-to-ten PCs requires stable Master and epoch. The optional offline Owner signer hashes the two saved snapshots and independent private witness file, signs the exact SHA/node/session/case intent using the protected Owner Ed25519 key, and writes a new sealed index. Independent offline verification checks signature, hash integrity and narrow snapshot rules. This is **not** a real physical evidence attestation and never grants production release. Real Windows vault keys, installer signing, Windows reboot/failover, Hostinger and owner approval remain pending. Record a unique session ID in the private Owner ledger; the stateless verifier alone cannot detect cross-run replay.

### Owner key material quality (release-only)

All four protected signing *variables* must contain canonical base64-encoded PEM **public** Ed25519 keys, with each trust role derived from a **different** private/public key pair. The release signing policy rejects malformed encodings, accidentally supplied private PEMs, non-Ed25519 keys, duplicate trust roots and unexpected keys. Owner private keys must remain in separate protected signers; running this validation does not grant release approval or produce a signed installer.

### Staging HTTPS DNS rebinding defense (read-only)

The operator's real `ops:hostinger-preflight` command now validates every resolved public DNS A/AAAA result and connects to **one pinned reviewed public IP** instead of letting a second DNS lookup redirect requests to localhost/private services. HTTPS `servername` remains the exact Owner-registered staging hostname, TLS certificate validation stays enabled, redirects and non-GET paths are forbidden, and responses stay bounded. No request is made if the pinned endpoint fails. This narrow network defense does not replace Owner-managed egress firewall/DNS controls, Hostinger staging ownership verification, staging MySQL backup/restore or real production acceptance. CI simulated HTTP checks explicitly report `https_address_pinned:false`; production CLI uses the pinning path.


## 23 November 2026 — First-run Central URL restriction

The Desktop's Central URL and enrollment grant flow now only accept a
public-domain-form HTTPS hostname on canonical port 443. IP addresses,
`.local`, `.localhost`, `.lan`, `.internal`, `.test`,
invalid domain labels and custom ports fail before any Owner enrollment
grant is transmitted. Existing valid public Hostinger domains remain
supported; if an older Desktop was configured with an internal/IP URL,
stop and request Owner-guided reconciliation rather than deleting the
OS-vault identity. A syntactically public hostname can still resolve to
a private address or be DNS-rebound; this does **not** prove Hostinger
domain control or provide a pinned network firewall. Owner networking,
real HTTPS staging and G0–G7 acceptance are still required.


### G0 audit — complete CI context coverage

The read-only audit now requires all seven source/PR/dependency job contexts, including Python and Ubuntu lockfile verification, and rechecks the pinned main SHA and protected flag after the rule observation. Repository dot segments are rejected before network access. A compatible snapshot remains HOLD: it does not independently verify classic protection, ruleset bypass actors, environment review, or actual approval.
