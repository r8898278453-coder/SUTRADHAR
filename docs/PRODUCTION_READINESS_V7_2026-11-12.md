# SUTRADHAR v7 — Production-readiness implementation and Owner checklist

**12 November 2026. Status: Alpha source, not approved for production.** The draft PR now contains deployment-safety building blocks. No actual Hostinger staging deployment, trusted signed Windows release, multi-PC trial, production database restore, protected distribution or merge has been performed.

## Five priority deliverables

| Goal | Code implemented on draft branch | Remaining evidence |
| --- | --- | --- |
| Production-signed Windows installer | apps/desktop/pack-release.cjs demands Owner approval, exact stable version/commit/tag, actual Authenticode certificate and Windows signer verification | Owner-controlled valid certificate and stable release not provided; no production installer signed |
| Secure device identity | apps/desktop/os-vault.cjs and secure-agent.ts use Electron safeStorage (Windows DPAPI / macOS Keychain) through local IPC; no cleartext PEM on disk or in child environment; fail closed if provider missing | Test actual Windows installation, vault restoration, restart, key rotation and legacy key migration; worker signing bridge remains alpha |
| Verified updates and rollback | apps/desktop/update-policy.cjs checks pinned Owner Ed25519 signed offer, exact installer SHA-256, publisher, expiry, protocol and version. Electron can inspect an offer without running it. scripts/release/sign-offline-offer.cjs signs an offer only with Owner release approval and verified Windows Authenticode evidence | Supply release verification public key and protected signing key; verified distribution, unattended updater/identity-preserving auto rollback not built |
| Hostinger staging plus MySQL backup/restore | scripts/ops/hostinger-staging-preflight.cjs reads staging HTTPS health, exact build SHA and dashboard. scripts/ops/mysql-ops.cjs encrypts dumps with AES-256-GCM, authenticates before restore and only restores into an approved empty staging database | Real Hostinger staging URL/credentials and offsite restore evidence not available; no live deployment or backup performed |
| Physical PC acceptance | scripts/ops/pilot-readonly.cjs verifies real distinct node IDs, last heartbeat, Master, Backup 1, and exact failover epoch using before/after snapshots; pure policy tests | Owner must run the 2-PC, 3-PC and 8–10-PC trials on real hardware; no physical acceptance claimed |

## 1. How an Owner approves the first signed Desktop installer

The first trusted installer needs a legitimate Windows Authenticode code-signing certificate, a stable Desktop version (not the present 7.0.0-alpha.1), a reviewed signed-off commit/tag, and a separate Ed25519 update signing key pair. The private signing keys must stay in Owner-controlled signing infrastructure, never in GitHub source, the application, PR logs or ordinary chats.

On an approved Windows release runner, the engineer configures protected environment variables:

- SUTRADHAR_OWNER_RELEASE_APPROVED=true
- SUTRADHAR_EXPECTED_COMMIT_SHA = approved full 40-character Git SHA
- SUTRADHAR_RELEASE_TAG = desktop-v followed by exact stable version
- SUTRADHAR_WINDOWS_PUBLISHER_NAME = exact Windows certificate subject starting CN=
- WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD = protected Windows Authenticode signing material (or supported CSC_* equivalent)
- SUTRADHAR_RELEASE_UPDATE_PUBLIC_KEY_PEM_B64 = base64 encoding of Owner's Ed25519 **public** verification key

After reviewed Desktop build and dependencies, run **npm --prefix apps/desktop run pack:release**. The script refuses alpha/dirty source/wrong tag/no certificate, checks Get-AuthenticodeSignature and produces a local signed-release-evidence.json. It does **not** upload, deploy or distribute an EXE.

To generate an offline update or emergency rollback offer, the Owner separately approves scripts/release/sign-offline-offer.cjs on a trusted Windows signer with SUTRADHAR_OWNER_ROLLOUT_APPROVED=yes, SUTRADHAR_RELEASE_SIGNING_KEY_FILE (outside repo), SUTRADHAR_INSTALLER_PATH, SUTRADHAR_UPDATE_KIND, SUTRADHAR_EXPECTED_COMMIT_SHA, SUTRADHAR_RELEASE_VERSION and SUTRADHAR_WINDOWS_PUBLISHER_NAME. For rollback also set SUTRADHAR_OWNER_EMERGENCY_ROLLBACK_APPROVED=yes. The script verifies the local Authenticode evidence, then writes SUTRADHAR Desktop.offer.json, an Ed25519-signed offline manifest.

Desktop has a **Verify a signed update file** control. It compares the downloaded local installer with pinned Owner signature, hash, version, protocol and Windows publisher. This control **never installs the file** and refuses on unsigned alpha. A separate Owner-approved installation/rollback process remains necessary. The automated update feed and safe staged deployment are **not implemented**.

## 2. Hostinger staging: actions a non-developer can understand

1. In existing Hostinger Business hPanel create a **separate staging subdomain/website** with HTTPS; never overwrite the production site.
2. Create a **new empty dedicated staging MySQL** database and its own user/password. Enter secrets in hPanel's environment UI, not in code.
3. Connect an approved staging source; never use the draft development branch as the production deploy source. Current Central staging build uses repository root ./, Node.js 22, build command **npm run build:central**, output directory **apps/central/dist**, entry **apps/central/dist/server.cjs**.
4. A developer must review schema migration and apply it to staging only. Keep SUTRADHAR_ALLOW_MIGRATIONS=false except during explicitly approved schema setup. This alpha does not have versioned production migrations yet.
5. Inspect the live deployment log, exact commit and **/v7/health**. From a trusted PC, set SUTRADHAR_STAGING_URL (must be HTTPS and clearly named stage/staging/test) and SUTRADHAR_EXPECTED_COMMIT_SHA, then run **npm run ops:hostinger-preflight**. This is read-only and checks source SHA, live MySQL health and UI.
6. Execute an actual backup/restore rehearsal in disposable staging, then physical PC acceptance. Neither is inferred from a green preflight response.

The conversation has no authenticated Hostinger hosting operation or staging domain details, so **no live staging deploy was attempted**.

## 3. MySQL backup and empty staging restore

Use Hostinger hPanel's database backup/export facility if external MySQL access is unavailable under shared hosting. The new CLI assumes a trusted **operator machine** with authorized MySQL connectivity, Node.js, MySQL client and mysqldump installed. Never run long jobs or Docker on Hostinger Business shared hosting.

- Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME using secure environment settings; choose an absolute new SUTRADHAR_ENCRYPTED_BACKUP_PATH. Generate and protect a separate random 32-byte key in base64 as SUTRADHAR_BACKUP_KEY_BASE64. Do not share it in tickets or messages.
- Run **npm run ops:backup**. The script creates a bounded logical dump in memory, encrypts with AES-256-GCM, writes no plaintext dump and outputs checksum/evidence. Maximum supported dump is 80 MiB; larger databases need a separately approved encrypted backup mechanism.
- Run **npm run ops:verify-backup** against the encrypted file. It checks the authentication tag and plaintext checksum before any restore. This is only a cryptographic backup check, not a real recovery proof.
- Create a **different empty** database with a staging/test/disposable/ci name. Set SUTRADHAR_RESTORE_STAGING_APPROVED=yes, SUTRADHAR_TARGET_DB_NAME to that name and SUTRADHAR_EXPECTED_TARGET_DB_NAME to the same exact value, leaving DB_NAME as original backup source. Run **npm run ops:restore-staging**. The tool refuses production/same-source/nonempty destinations.
- Independently verify restored table counts, schema, transactions, active epochs and task/agent recovery, then record evidence and backup/restore timing. Only then may the Owner mark backup recovery accepted.

Never assume reverting a Node bundle reverses MySQL changes. A live restore may lose newer tasks and must require explicit Owner data-loss approval and a reviewed recovery plan.

## 4. Real physical PC acceptance

**2-PC trial:** Enroll two separate physical PCs with distinct node IDs, approve agents, confirm 60-second signed heartbeats, initial 08:00 Asia/Kolkata election and sticky healthy incumbent. Set SUTRADHAR_CENTRAL_URL, SUTRADHAR_ADMIN_KEY, SUTRADHAR_PILOT_NODE_IDS containing the two actual IDs, and an absolute SUTRADHAR_PILOT_RECEIPT_PATH; run **npm run ops:pc-pilot -- snapshot**. Save a baseline.

The Owner then powers down the Master **on staging only** and allows the ~180-second timeout. Use a new receipt path and SUTRADHAR_PILOT_INTENTIONALLY_OFFLINE_NODE_IDS equal to the former Master's physical node ID. Run another read-only snapshot. Set SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH and SUTRADHAR_PILOT_AFTER_RECEIPT_PATH; run **npm run ops:pc-pilot -- compare** with a third new receipt output. The tool requires Backup 1 on a distinct PC to become Master and epoch to advance exactly once. It cannot replace real hardware observation, task fencing/recovery-ACK checks or Owner sign-off.

**3-PC trial:** Prove Master, Backup 1 and Backup 2 on distinct PCs and two successive takeovers. **8–10 PC trial:** Prove reboots, sleep, network partition, Central restart, old-epoch rejection, checkpoint/task recovery, independent QA, no duplicate Git work, signed releases and truthful dashboard/Telegram status. Never mark all 71-case acceptance PASS merely because unit CI passes.

## 5. Honest status / next gates

**CODED / CI dependent:** signing gate, OS-vault runtime, read-only signed update checks, encrypted backup and staging-only restore, staging preflight and pilot evidence policy.  
**NOT RUN:** actual Hostinger stage, live DB backup/restore, signed production Windows installer, real OS vault after installer/restart, owner-controlled update distribution, physical 2/3/8–10 PC trial and full v7 acceptance.  
**NOT IMPLEMENTED:** complete signed auto-updater/rollback distribution, privileged production migration wizard, sealed-vault worker QA signing bridge and release-only deployment pipeline.

Do not merge or deploy the draft PR without separate Owner approval. See [Owner setup](OWNER_SETUP_AND_DEPLOYMENT.md), [Release operations](RELEASE_OPERATIONS.md), [V7 acceptance matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md), and [Implementation tracker](IMPLEMENTATION_TRACKER.md).
