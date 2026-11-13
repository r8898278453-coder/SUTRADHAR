# SUTRADHAR Desktop — guided alpha installation

**Important:** This is a first-run setup UI and a packaging prototype, **NOT a production-signed PC installer**. Edge and Worker implementation remains in ../../v7. The signed Desktop update **distribution** channel, physical OS-vault verification, system login/tray tests, worker signing bridge and multi-PC real-world acceptance are outstanding. New secure-agent and OS-vault implementation exists but is not production accepted.

## Non-developer target workflow

1. Download the approved, signed SUTRADHAR Desktop installer from the Owner's verified release.
2. Open installer, enter Central's HTTPS domain and a friendly PC name.
3. Choose 1–4 local agents, enter an Owner-issued enrollment code once.
4. The app checks MySQL-backed Central health and confirms API protocol version 7.
5. The local agent starts and requests enrollment with its own Ed25519 identity.
6. Owner opens Central dashboard and approves the PC and its individual agent/project permissions.
7. The agent signs an aggregate heartbeat approximately every 60 seconds; Central handles initial 08:00 IST election, sticky Master and backups.

**Current alpha reality:** Stages 2–5 are implemented as an Electron-assisted UI but have **NOT** been executed against an approved physical Windows installer. The UI also displays the local agent's last Central-accepted heartbeat, pending/error state, and a conditional opt-in to launch the packaged app when the OS user signs in. A system tray keeps the agent process alive when windows are closed; explicit Quit confirms that heartbeats will stop. These are **unverified on physical target PCs**, and signing in is not the same as a boot-time system service. The child-agent supervisor still needs real packaged-OS testing. The settings file stores Central URL, PC name and generated agent IDs; the enrollment code stays in process memory during enrollment and is not saved to settings. For the **new packaged Electron runtime**, identity is encrypted via Electron safeStorage (Windows DPAPI/macOS Keychain) in node/identity.osvault.json and is only passed to the secure-agent through private IPC. This mechanism still requires real Windows acceptance. The developer-only v7/agent.ts CLI continues to use a restricted **plaintext** identity file and is unsuitable for production release; old legacy identities are not silently imported.

## Developer local prototype (NOT Owner production instructions)

From the repository root with Node.js 22:

~~~sh
npm install --no-audit --no-fund
npm run build:desktop
npm install --prefix apps/desktop --no-audit --no-fund
npm --prefix apps/desktop run start
~~~

The Setup window is local and sandboxed. Dashboard and manual AI provider links open HTTPS web content in isolated windows or the system browser; no automated provider policy evasion is used.

**QA-only unsigned Windows installer:** developer/CI can explicitly run:

~~~sh
# In a trusted Windows QA shell, after the installs and build:
# Set SUTRADHAR_ALLOW_UNSIGNED_QA_PACKAGE=true in that shell.
npm --prefix apps/desktop run pack:qa
~~~

On Windows PowerShell, set $env:SUTRADHAR_ALLOW_UNSIGNED_QA_PACKAGE="true" first. The output goes to apps/desktop/out. It is **not code-signed, not auto-published and must never be distributed as trusted software**.

## Persistent local state

Electron's userData directory contains:

- desktop-settings.json — Central HTTPS URL, PC name and locally generated agent IDs; not admin or enrollment secrets.
- node/identity.osvault.json — OS-safeStorage-encrypted Ed25519 identity and monotonic sequence (packaged secure-agent path; physical Windows acceptance NOT RUN). The legacy node/identity.json cleartext file is rejected by this vault and requires Owner-reviewed migration.
- node/enrollment_requested — marker after Central accepts enrollment request; **not proof of Owner approval**.
- node/status.json — local, informational receipt of last Central heartbeat response, error and phase. This local file is **not the authoritative database**, can become stale and is not a cryptographic server-side attestation.
- edge-agent.log — process diagnostics. Never log or share private keys or enrollment codes.

Do not move/copy device identity to a different PC. Do not delete identity for a simple update.

**Advanced code/QA worker:** apps/desktop/dist/edge-worker.cjs is an independently compiled CLI, not automatically run by the setup UI. It still requires trusted Git, Docker/Python and approved source checkout; consult [v7 technical runbook](../../v7/README.md). It is intentionally not included in the first-run installer.

## Private-key-isolated signing bridge — 13 November 2026

For the packaged Desktop, `apps/desktop/vault-bridge.cjs` keeps the Ed25519 key in the **Electron main process OS-backed vault**. The secure child process receives public node metadata, monotonic heartbeat counters and signatures for a small allowlist of Central API paths; it no longer receives `private_key_pem` through IPC. It cannot ask this bridge to sign arbitrary URLs, a database migration or a GitHub release operation. The parent saves and checks counters before heartbeats.

The enrollment grant still travels over the private local IPC for the first enrollment attempt and is held in memory; it is never persisted in settings or passed on the command line. Production acceptance still needs OS/process isolation, Windows signing and restart tests on real hardware. The legacy developer-only `v7/agent.ts` remains a separate plaintext-alpha path and must not be packaged.

Security regression tests: `tests/desktop_signer_bridge.test.cjs`, `tests/desktop_vault.test.cjs`.

## New Owner-gated installer and update security code

- apps/desktop/pack-release.cjs refuses release without a **stable version, exact immutable tagged SHA, Owner approval and an actual Windows signing certificate**. It verifies the resulting EXE with Get-AuthenticodeSignature and emits local receipt; no automatic publishing.
- apps/desktop/update-policy.cjs validates a **pinned Ed25519 Owner-signed update offer**, matching EXE SHA-256, version, publisher, protocol and expiry. The setup screen can inspect a downloaded update or separately approved emergency rollback **without executing** it. apps/desktop/update-trust.json is intentionally unconfigured in unsigned alpha.
- scripts/release/sign-offline-offer.cjs produces signed update metadata from a verified signed Windows installer. Real Owner signing secrets and certificate were not provided, so no trusted release exists.
- Offline verification does **not** substitute for a safe automatic updater, staged rollout, release signing, real Win32 tests or identity-preserving installation rollback.

See [release readiness checklist](../../docs/PRODUCTION_READINESS_V7_2026-11-12.md) for exact Owner/engineer steps and remaining evidence.

## Blockers before routine non-developer deployment

- Reproducible pinned dependencies and signed artifacts.
- Actual OS-backed vault physical verification, safe migration of older plaintext identities and key rotation/recovery.
- Electron tray/child-agent/login-start supervision and installer tests on real target OS; login auto-start remains user opt-in and not an always-on service.
- Safe, rate-limited enrollment grants and duplicate identity tests.
- Secure staged updates and identity-preserving rollback.
- Physical 2-PC failover and full 8–10-PC acceptance.
- Independent Git/QA/Owner release controls.

See [Owner deployment guide](../../docs/OWNER_SETUP_AND_DEPLOYMENT.md), [Release policy](../../docs/RELEASE_OPERATIONS.md), and [ADR](../../docs/ADR_001_MONOREPO_TWO_APPS.md).
