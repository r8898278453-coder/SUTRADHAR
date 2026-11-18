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
npm ci --no-audit --no-fund
npm run build:desktop
npm ci --prefix apps/desktop --no-audit --no-fund
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

## Windows OS-vault manual claim + Git worktree (alpha only, 19 November 2026)

This next phase adds **Choose trusted Git checkout and claim** plus **Verify my existing work lease** to the local packaged Windows Setup screen. It is **not autonomous worker execution** and has not been physically accepted.

**Prerequisites:** The Owner has approved the PC and agent, granted that agent development access to the project, and (when required) approved protected-path work. Central is READY and unpaused. The PC has a recent signed heartbeat, no maintenance/recovery/installer hold, Git for Windows installed and a locally trusted checkout of the exact project repository containing the immutable approved baseline commit.

**Manual workflow:** In the local Setup screen, select your agent, inspect a ticket, enter its exact ID, click **Choose trusted Git checkout and claim**, select your previously trusted local repository folder, and explicitly confirm. Electron Main rechecks all safety fences. It validates the remote URL and local baseline, blocks **active** Git smudge/process filter or encoding attributes across the approved baseline tree (without rejecting unused global Git LFS definitions), disables Git hooks, and creates a per-ticket isolated local Git worktree *before* any Central claim request. It persists a checksummed, exclusive private claim intent before sending the signed claim. The OS vault signs **only** the exact ticket claim contract (no arbitrary URL/body). Central still checks current Master lease, project grants, task READY state, dependencies, capacity and overlapping scopes.

If Central accepted the claim but the HTTP response was lost, **repeat the claim for the same ticket, agent and selected checkout**. The pending file replays the original request ID. On success, a local lease receipt is saved before a signed **read-only** `resume-check` verifies the still-live Master epoch and ticket/lease identity. Worktree remains local; no Git push, merge, model API, QA or checkpoint automatically runs.

**Recovery:** If epoch, Git checkout, branch, scope, journal, receipt or server state does not match, stop; do not delete local worker files or create a fresh claim. Ask the Owner to inspect Central's task/lease and audit state. The **Verify my existing work lease** button performs a signed continuity check only and never renews an expired lease. Claim leases remain bounded; the current packaged UI does not yet expose the developer-only renewal/submit/QA capability. This phase is for operator-supervised early pilot tests only.

**Operational limitations:** Git for Windows and an existing trusted project checkout are external prerequisites; the app does not clone external repositories or configure provider accounts. Local worktree creation invokes the trusted installed Git tool after explicit operator confirmation. No remote push or merge is possible from this feature. The desktop packaging still requires code signing, physical Windows/Hostinger multi-PC acceptance and independently verified QA.

Tests: `tests/desktop_worker_claim.test.cjs`, `tests/desktop_worker_inspection.test.cjs`, disposable MySQL `tests/v7_mysql_integration.test.ts`. The Git and network tests use disposable local repositories and simulated Central replies; they are **not a real Windows Hostinger end-to-end acceptance test**.

## Windows OS-vault task discovery (read-only alpha, 19 November 2026)

The packaged Windows Setup screen now includes **My assigned development tasks (read-only)**. After an approved PC/agent has a recent signed Central heartbeat, choose an approved local agent to list READY, dependency-unblocked tasks in projects for which Central grants `can_develop`. Enter an exact ticket ID to inspect its description, allowed scopes and acceptance criteria. Results use text-only rendering; nothing is converted to HTML or executed.

The renderer only invokes `inspectWorkerTasks(agentId,ticketId)`. Electron main checks its own sandboxed setup window, packaged Windows runtime, submitted enrollment receipt, recent Central acknowledgement and absence of maintenance/recovery/installer fences. `worker-inspection.cjs` accepts only fixed HTTPS GET endpoints. The OS vault's **new separate `signWorkerReadOnly` capability** signs only those endpoints for one of this PC's enrolled agent IDs. The existing heartbeat child IPC remains unchanged and **cannot** invoke this worker signer. Central separately verifies the signed approved node/agent and the project ACL.

This does **not** claim work, renew a lease, create a Git worktree, run prompts, read browser sessions, sign QA receipts, publish Git, or run automation. The alpha developer CLI `edge-worker.cjs` still depends on its separate plaintext identity and is **not shipped** in the installer. Real packaged-Windows/Hostinger/physical-PC acceptance is pending.

Tests: `tests/desktop_worker_inspection.test.cjs`, `tests/desktop_signer_bridge.test.cjs`, plus existing signed HTTP/MySQL project ACL tests.

## Private-key-isolated signing bridge — 13 November 2026

For the packaged Desktop, `apps/desktop/vault-bridge.cjs` keeps the Ed25519 key in the **Electron main process OS-backed vault**. The secure child process receives public node metadata, monotonic heartbeat counters and signatures for a small allowlist of Central API paths; it no longer receives `private_key_pem` through IPC. It cannot ask this bridge to sign arbitrary URLs, a database migration or a GitHub release operation. The parent saves and checks counters before heartbeats.

The enrollment grant still travels over the private local IPC for the first enrollment attempt and is held in memory; it is never persisted in settings or passed on the command line. Production acceptance still needs OS/process isolation, Windows signing and restart tests on real hardware. The legacy developer-only `v7/agent.ts` remains a separate plaintext-alpha path and must not be packaged.

Security regression tests: `tests/desktop_signer_bridge.test.cjs`, `tests/desktop_vault.test.cjs`.

## Supported Electron runtime + parent-only enrollment — 13 November 2026

- Electron 33.4.11 was **end-of-life** and must never be used for a trusted installer. The Desktop prototype now requests **Electron 45.3.1** and **electron-builder 26.18.0** (both exact pins). apps/desktop/runtime-policy.cjs refuses obsolete majors and blocks signing after 27 April 2027 unless a reviewed support-window update occurs. CI validates the upgrade with QA-only Windows packaging and an independent Linux/Windows lockfile \`npm ci\` review flow.
- The OS-vault Ed25519 private key stays in Electron main process. The agent receives public metadata and narrowly scoped signatures.
- The **one-time enrollment code stays in Electron main process** and is sent directly to Central HTTPS using apps/desktop/enrollment.cjs. The agent's IPC asks only for the enrollment outcome, and the parent checks Central's matching node identity/Owner approval response. It never puts the grant in agent environment, argv, or IPC replies.
- Windows DPAPI protects identity from other OS users, **not necessarily other apps running under the same Windows account**. Hardware-backed code signing and real physical PC compromise/restore tests remain required.
- Electron's synchronous safeStorage APIs are deprecated in current supported versions and need a reviewed migration to the async encryption API before upgrading to a runtime that removes the synchronous interface. Do not silently upgrade to Electron 46 without that work.
- Root + Desktop npm v3 lockfiles are **committed in the draft branch** and verified by clean Linux/Windows npm ci directly from source. The Owner/independent reviewer must still evaluate vulnerabilities, licenses and software provenance; a green CI build does **not** authorize a signed release.

Reference: [Electron supported release policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) and [safeStorage security semantics](https://www.electronjs.org/docs/latest/api/safe-storage).

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


## 15 November 2026 — Identity-bound enrollment and single-instance recovery

**CODED; real Windows installer acceptance NOT RUN.** The packaged Electron main process now acquires a single-instance lock per OS user profile. A second launch focuses the first UI instead of starting a duplicate agent.

First-time enrollment persists a receipt **before the network POST**. PREPARED means an attempt may have reached Central, never confirmed; SUBMITTED means a matching Central enrollment acknowledgment was received, **not that the Owner approved it**. The receipt contains node ID, public-key SHA256, original Central HTTPS origin and status, not an enrollment grant or a private key.

If interrupted, the UI shows Owner recovery required rather than silently enrolling another node. The Owner verifies the original node ID in Central, approves it if legitimate and clicks **Recheck uncertain enrollment**. That sends only a signed read-only GET to /v7/nodes/me; Central independently requires an approved node and matching signed key. On success, the same identity resumes; on pending/unrecognized/mismatched identities it stays blocked. Never delete or manually edit the encrypted identity or receipt. Legacy timestamp-only receipts require Owner-reviewed migration.

Pure tests cover this policy. Real Windows DPAPI, power loss, multiple OS users, app signing and physical multi-PC acceptance are still required.

## Signed update/rollback offer v2: device-bound waves (15 November 2026)

The offline verifier now accepts **only signed schema v2 offers**. The Owner-signed metadata must include a `wave_...` ID and a deduplicated list of 1–10 exact `node_...` recipient IDs. The Desktop reads its own node ID from the OS-backed identity, requires the existing enrollment receipt and refuses offers intended for a different PC. **Legacy v1/global offers are blocked.**

The installer is streamed through SHA-256 verification rather than read entirely into memory. An additional checksum check runs after local Windows Authenticode verification; this remains **inspection only**, not a protected installer execution/update pipeline. No trusted public key is configured in the unsigned alpha.

The separate Windows offline offer signer now demands `SUTRADHAR_ROLLOUT_WAVE_ID` and `SUTRADHAR_ROLLOUT_NODE_IDS` as well as existing Owner-signing approvals. It outputs no private signing keys and never publishes or executes an EXE.

See [Owner-signed rollout wave guide](../../docs/SIGNED_DESKTOP_ROLLOUT_WAVES.md). Real Windows publisher/installer tests, signed distribution, update execution, rollback and device continuity are NOT RUN.

## 15 November 2026 — Live role-aware update inspection and signed local receipts

The packaged setup window now includes **Check whether this PC is Master or backup**. It sends signed read-only GETs from Electron main to Central, rejects unapproved agents, paused/non-READY clusters, absent/duplicate backup assignments and any PC currently assigned Master, Backup 1 or Backup 2. This is an observation, **not a maintenance/installer authorization**: roles can change immediately and Central may evaluate stale leases while answering a GET.

After valid Owner-signed v2 offer, installer bytes and Authenticode verification, Electron main writes a **node-signed OFFLINE_INSPECTED_ONLY receipt**, never `installed=true`. Repeated identical offers validate existing signed evidence; corrupted/incomplete receipts block further journaling without overwriting. This is local audit data, not a hardware anti-replay counter, installer runner or rollback implementation.

See [Owner maintenance preflight and signed inspection receipts](../../docs/DESKTOP_MAINTENANCE_PREFLIGHT_V7.md). No genuine Windows certificate, active role maintenance freeze, physical PC test or signed installation has been run.


## Central Owner maintenance intent — 15 November 2026

The signed Desktop **Check whether this PC is Master or backup** action now also checks live Owner intent through `GET /v7/nodes/maintenance`. Central's signed view must contain the same node ID, current Master epoch and an unexpired `INTENT_ONLY` record. A missing intent is displayed as missing, **not** Owner approval; a stale/malformed intent blocks readiness. The node must also be approved, idle, heartbeat-current and have no active work lease, unresolved Git job or local Master/backup role.

Central's Owner dashboard has a 5-minute maintenance-intent form with cancellation. **This remains an advisory record; no installer is run, agent drained, lease frozen or actual rollback authorized.** [Owner steps](../../docs/OWNER_PC_MAINTENANCE_INTENT_V7.md).


## 15 November 2026 — Central task-drain fencing is NOT installer execution

An Owner may use the Central dashboard to START_PC_DRAIN for a current five-minute maintenance intent, preserving existing worker leases while preventing new work, and FINALIZE_PC_DRAIN only after Central sees no outstanding work. The durable fence persists across the intent deadline until explicit Owner cancellation. The Desktop's signed readiness check blocks on a DRAINING/DRAINED record; it must not treat the task fence as a Windows installer execution capability.

[Owner drain-fence runbook](../../docs/PC_DRAIN_FENCE_V7.md). Code is not deployed to physical PCs and real signing/rollback is still pending.
