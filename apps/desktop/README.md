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

## Windows OS-vault verified candidate submission (alpha, 20 November 2026)

After a checkpoint has been confirmed and your approved task's **original Central lease remains live**, the packaged Windows Setup screen offers **Submit committed candidate for review**. This is an explicitly confirmed request. It **does not** clone/push code, create a PR, merge or approve QA.

Before Central is contacted for a write, Electron Main checks the original private claim receipt and Git checkout, verifies that the HEAD commit descends from the exact authorized baseline, requires a completely clean index/worktree (including no untracked files), and inspects the Git binary diff of baseline to HEAD in NUL-safe format. Only added or modified regular files (`100644`) fully inside approved scopes are accepted. Deletions, renames, executable-mode changes, symlinks, submodules, path traversal and changes to `.gitattributes`, `.gitmodules` or `.lfsconfig` are refused. A previous unresolved progress journal blocks submission.

The OS vault signs the **exact** `POST /v7/tasks/submit` contract containing the agent, ticket, original lease, Master epoch and local Git HEAD/tree SHA-1. It never exposes a generic signer to renderer or heartbeat child. Central independently checks the live approved agent/lease, a checkpoint, and current Master before recording `SUBMITTED_FOR_REVIEW`. The app then fetches Central's signed read-only task detail and requires **exact matching commit/tree hashes, scopes, branch, baseline and worker agent ID** before reporting success.

**Ambiguous HTTP response:** An exclusive, fsynced `submission_pending_<ticket>.json` records the exact immutable candidate and original request ID before sending. On retry, if Central already shows matching `SUBMITTED_FOR_REVIEW`, the app verifies that record without a second POST. Otherwise it retries only the exact original request after a live signed resume-check. If HEAD changes, Central hashes differ, the Master epoch is uncertain or a local journal is altered, it refuses and requires Owner-assisted reconciliation. It never silently deletes the pending evidence to issue a fresh request.

**Important:** A Central candidate SHA is a *claim about a commit*, not proof that a separate QA PC can fetch it. No Git push is performed by this feature, and **QA remains pending** until the candidate is independently obtained and verified by the QA workflow. Production releases remain held for a signed installer, real Hostinger staging, physical Windows fleet testing and independent QA evidence.

Source regression tests: `tests/desktop_worker_claim.test.cjs` (real local Git repositories, Ed25519 signatures, unauthorized paths, dirty worktree, response loss and conflicting remote proof). Real disposable-MySQL task submission/QA gates remain in `tests/v7_mysql_integration.test.ts`; these are not equivalent to a physical installed-PC acceptance.

## Windows OS-vault manual checkpoint and bounded renewal (alpha, 19 November 2026)

After the exact local worktree has been claimed and the signed lease remains live, the packaged Windows Setup screen offers **Save signed checkpoint (manual)** and **Request bounded lease renewal**. These are additional *human-confirmed* operations, not an autonomous AI coding service.

**Checkpoint:** Choose the same approved agent and exact ticket. Write a meaningful *summary* of completed work (up to 8,000 characters) and a *next action* (up to 500 characters), avoiding credentials or secrets. Confirm. Electron Main rechecks recent Central heartbeat, Owner enrollment, maintenance/installer holds, local trusted Git worktree and signed current lease. The OS vault only signs `POST /v7/tasks/checkpoint` for this specific agent/ticket/lease/epoch. Central persists an audit/checkpoint record, calculates its SHA-256 digest and extends the live lease within the absolute four-hour claim limit. The app then separately obtains a signed Central `resume-check` and requires its latest checkpoint to match **generation, exact summary, next action and digest** before showing success. Saving a checkpoint is **not** independent QA.

**Renewal:** Record a 12–300-character reason and explicitly confirm **Request bounded lease renewal**. Electron Main sends an OS-vault-signed, exact `POST /v7/tasks/renew-lease`. Central requires the original approved worker, current Master and lease, and a due renewal window. Each renewal grants up to 600 seconds, never past four hours from the initial claim. An expired or stale lease cannot be revived. The app rechecks a signed live `resume-check` before acknowledging the renewal. No timed auto-renewal runs.

**Ambiguous network failure:** Before either request, Electron Main fsyncs an exclusive checksum-verified `node/worker/progress_<ticket>.json` containing the exact operation, immutable identity and request body. Retrying with the same agent, ticket and *identical* summary/next action or reason replays the original request ID. Changing those inputs, switching operation types, modifying local evidence or changing Master epoch **fails closed**. On confirmed success, a separate local verified progress receipt is recorded before the pending intent is removed. Even a crash between receipt persistence and journal cleanup reconciles only identical evidence.

**Operator response:** If anything is ambiguous, preserve both journal and local Git worktree. Do not delete files, change inputs to force a fresh operation, claim another ticket, push Git or declare the task DONE. Consult Central task/lease and Owner audit. GUI still cannot submit a candidate, publish Git, create a QA receipt or control AI provider workflows.

Tests: `tests/desktop_worker_claim.test.cjs` exercises cryptographic signing, real local Git preflight, crash/replay and mismatched checkpoint proof. `tests/v7_mysql_integration.test.ts` exercises real disposable-MySQL checkpoint/renewal budget and idempotency. **Physical packaged Windows / live Hostinger verification remains pending.**

## Windows OS-vault manual claim + Git worktree (alpha only, 19 November 2026)

This next phase adds **Choose trusted Git checkout and claim** plus **Verify my existing work lease** to the local packaged Windows Setup screen. It is **not autonomous worker execution** and has not been physically accepted.

**Prerequisites:** The Owner has approved the PC and agent, granted that agent development access to the project, and (when required) approved protected-path work. Central is READY and unpaused. The PC has a recent signed heartbeat, no maintenance/recovery/installer hold, Git for Windows installed and a locally trusted checkout of the exact project repository containing the immutable approved baseline commit.

**Manual workflow:** In the local Setup screen, select your agent, inspect a ticket, enter its exact ID, click **Choose trusted Git checkout and claim**, select your previously trusted local repository folder, and explicitly confirm. Electron Main rechecks all safety fences. It validates the remote URL and local baseline, blocks **active** Git smudge/process filter or encoding attributes across the approved baseline tree (without rejecting unused global Git LFS definitions), disables Git hooks, and creates a per-ticket isolated local Git worktree *before* any Central claim request. It persists a checksummed, exclusive private claim intent before sending the signed claim. The OS vault signs **only** the exact ticket claim contract (no arbitrary URL/body). Central still checks current Master lease, project grants, task READY state, dependencies, capacity and overlapping scopes.

If Central accepted the claim but the HTTP response was lost, **repeat the claim for the same ticket, agent and selected checkout**. The pending file replays the original request ID. On success, a local lease receipt is saved before a signed **read-only** `resume-check` verifies the still-live Master epoch and ticket/lease identity. Worktree remains local; no Git push, merge, model API, QA or checkpoint automatically runs.

**Recovery:** If epoch, Git checkout, branch, scope, journal, receipt or server state does not match, stop; do not delete local worker files or create a fresh claim. Ask the Owner to inspect Central's task/lease and audit state. The **Verify my existing work lease** button performs a signed continuity check only and never renews an expired lease. Claim leases remain bounded; the packaged UI supports manual checkpoint and renewal, **not** submission/QA or automatic execution. This phase is for operator-supervised early pilot tests only.

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

## New-file Git attributes at candidate submission (20 November 2026)

The explicit Windows Desktop **Submit candidate** action verifies Git attributes for every changed path against the candidate **HEAD**, not just files tracked in the original baseline. An existing wildcard `.gitattributes` rule can become active when a worker adds a new scoped file. Active `filter` or `working-tree-encoding` on such a file blocks submission for independent Owner review. Missing Git attribute evidence also fails closed. The rule neither fetches nor pushes Git, starts a filter or QA process, or approves a release.

Regression tests cover both a dormant wildcard filter that must be blocked and a safe new file that can be submitted. This is **draft branch code only**; physical Windows, QA and production evidence remain outstanding.

## Git candidate lineage checks for independent QA — 20 November 2026

The packaged Windows Desktop **Submit candidate** action now verifies the entire Git ancestry from the approved baseline to the proposed HEAD, not only the final diff. A submission must contain at most 40 consecutive single-parent commits; **every individual commit** must change only authorized regular-file paths (add/modify), with no file deletion, symlink, unsafe mode, merge or out-of-scope intermediate revision. Each lineage step is checked locally using fixed read-only Git commands before the signed Central submission. Unreadable, shallow, empty, non-linear or excessive history fails closed. The final tree SHA, clean worktree, signed Central checkpoint and effective candidate Git attributes remain separately required.

This reduces the chance that independent QA accepts a clean-looking final snapshot whose Git history carries unauthorized intermediate changes. It **does not** publish the candidate objects to another PC, run QA, attest every local Git-side effect at commit time, or enable automatic Git operations. A separate reviewed, hash-verified transport and independent QA PC remain necessary.

## Offline candidate exchange, separate developer and QA PCs (20 November 2026)

This code is an **inspection-only** Windows Desktop alpha handoff. On Developer PC, use **Submit committed candidate for review** first. After the Central-signed state confirms `SUBMITTED_FOR_REVIEW`, choose **Export exact candidate bundle for QA PC (offline)**, select a new `.bundle` destination and confirm. The app creates a Git bundle of commits after the authorized baseline and a neighboring `.bundle.json` containing the exact Central ticket, repository, baseline, candidate HEAD/tree, allowed paths, bundle size and SHA-256. It refuses existing output files, wrong worktree, changed Central proof and invalid Git candidates. Neither file is a credential, signature of installation, Git push, or QA pass.

Carry **both files manually via a trusted method** to a separate QA PC. On that machine, choose the different approved QA agent, the same exact ticket, and **On QA PC: inspect copied bundle (NO TEST)**. Select the bundle and a previously trusted Git checkout whose `origin` and HEAD still match the Central-approved repository and immutable baseline. Electron main sends a scoped, node-signed HTTPS GET for the candidate and matches it to the manifest; the .bundle SHA-256 and advertised HEAD are verified; Git objects are fetched only into a **temporary disposable bare quarantine**, with no trusted-repo mutation or checkout. Every ancestry step and file mode/scope and candidate Git attributes are verified. The temporary object store is deleted after inspection, so no QA Docker test or QA evidence submission is enabled by this button.

Limits: the bundle must be at most 32 MiB, at most 40 linear commits/1,200 authorized path edits; a malformed/tampered/stale handoff must go back to the Owner. Local machine compromise, Git vulnerabilities, unsafe handling of files outside this tool, and transfer-channel theft remain possible. **No code is executed, imported into the QA checkout, approved, published or merged.** A separate reviewed safe QA execution/import pipeline, real Windows physical acceptance and Owner release approval are required.

**Windows compatibility note:** Isolated inspection compares the trusted checkout's exact Git `HEAD` to the authorized baseline and consumes Git objects, not local working files. It does not require the working tree to be clean, because Git for Windows may normalize CRLF differently under the intentionally disabled global Git configuration. This is inspection-only. Any future **execution** on a QA PC must use a fresh isolated checkout and enforce clean-source/filters/attributes policy before running code inside a trusted Docker image. Bundle durability uses a writable flush handle on Windows; failure still blocks.

## Independent QA Docker execution gate (20 November 2026)

**Default: DISABLED.** `apps/desktop/qa-runner-policy.json` intentionally sets `enabled:false`, `image_sha256:null`, and `docker_exe:null`. No public image tag, dynamic build, registry pull, shell script from a ticket, user-supplied command, or default GitHub credential is accepted. The protected Desktop build must be configured by the Owner *before packaging* with the verified **local** Docker image ID (`image_sha256`: 64 lowercase hex digits), a trusted absolute installed Docker binary path (`docker_exe`, ending in docker.exe on Windows), `enabled:true` and the fixed `PYTEST_TESTS_DIRECTORY` profile. The default bundle cannot execute QA tests. Production signing/trust and actual Windows Docker Desktop acceptance are separate gates.

On the *independent* QA PC, first inspect the transferred `.bundle` plus its `.bundle.json`. If the image is Owner-configured, use **On QA PC: run pinned offline Docker pytest (Owner gated)** and explicitly confirm. The program rechecks the Central-signed task and bundle/manifest/commit/tree/linear history, imports Git objects into temporary bare quarantine, rejects unsafe archive paths, Git metadata/submodules/symlinks and common secret filenames, and streams a bounded `git archive` only to Docker stdin. The candidate files never get extracted or checked out on the host, and the trusted QA checkout receives no new Git objects. Docker is forced to use the exact locally installed pinned image ID, no image pulling, no network, no host mounts, no capabilities, non-root UID, read-only root, bounded CPU/memory/PIDs/time and ephemeral tmpfs for candidate files. The only test profile runs `python3 -B -m pytest -q tests` inside the container. No arbitrary command is accepted from Central or from the renderer.

A private, exclusive `qa_started_<ticket>.json` intent is fsynced **before** container creation; a crash, timeout, cleanup uncertainty or other ambiguous result blocks automatic retry. A successful or failed Docker test produces private `qa_result_<ticket>.json` with candidate/tree/bundle/image hashes, output digests, bounded logs, exit status, and `evidence_level:LOCAL_UNATTESTED`. Repeated attempts are rejected. A Central task change after execution blocks any success claim. The app does **not** sign/send `/v7/tasks/qa-receipt` and cannot advance the ticket to INTEGRATING; final QA attestation and independent Owner authorization remain separate.

Known limitations: this is a **fixed Python pytest profile**; Node/TypeScript and other project QA profiles require separately reviewed sandbox images and command contracts. Docker Desktop installation, verified image supply chain, robust host isolation and physical Windows tests are not established by GitHub CI. The QA evidence is intentionally not a device-signed, Central-accepted QA receipt. An explicit Owner-reviewed reconciliation procedure is still needed for one-attempt journals.

## OS-vault-signed independent QA report — 20 November 2026

An existing completed `qa_result_<ticket>.json` and the original, exclusive `qa_started_<ticket>.json` attempt journal are mandatory. The Windows Desktop **On QA PC: sign local test evidence for Owner** button requires a fresh acknowledged heartbeat, enrolled OS-backed identity, no maintenance/installer fence and explicit user confirmation. Electron MAIN loads the bounded, regular local report, checks **all expected fields**, hashes its exact bytes, and matches the complete one-attempt journal, original QA agent, code hashes and latest Central-signed ticket. A missing, stale, mismatched, symlinked or already signed report fails closed.

The OS-vault signer can sign ONLY a fixed, schema-limited, Ed25519 domain-separated `SUTRADHAR_QA_EVIDENCE_V1` statement. The report SHA-256, test pass boolean, exact ticket, QA agent, device node ID, candidate head and tree are cryptographically bound. It writes `qa_attested_<ticket>.json` once. Neither renderer nor heartbeat child receives private keys, general signing rights or the QA receipt API. A failed test can be signed as FAILED evidence; it never becomes approval.

**Independent Owner verification:** Transfer the original `qa_result_<ticket>.json` and `qa_attested_<ticket>.json` without editing them. Obtain the QA PC's approved **Ed25519 public key from the Central enrollment record by a separately authenticated Owner process**, never by trusting the attestation itself. On a trusted Owner machine run:

```bash
node scripts/qa/verify-device-evidence.cjs \
  /absolute/qa_result_ticket_abc.json \
  /absolute/qa_attested_ticket_abc.json \
  /absolute/approved_qa_pc_public_key.pem \
  node_<32_lowercase_hex> agent_qa ticket_abc \
  <exact_40_hex_candidate_head> <exact_40_hex_candidate_tree>
```

The verifier checks file bounds, strict report schema, externally supplied public-key fingerprint, Ed25519 signature, exact node/agent/ticket/head/tree and report-byte hash. It returns `DEVICE_SIGNED_LOCAL_ONLY` and explicit `qa_approved:false`. This proves **the approved key signed the local report**, not that Docker ran securely, the test was genuinely independent, or Central approved QA. The subsequently implemented, stricter Central flow described below now requires device-signed evidence upload **and separate exact Owner approval before** `/v7/tasks/qa-receipt`; legacy hash-only QA receipts are rejected. Independent verification of runner provenance and real physical-PC independence is still mandatory.

## Central-verified QA evidence and explicit Owner review (20 November 2026)

The QA machine now has two separate, individually confirmed actions after its OS-vault signing step:

1. **Submit signed evidence to Central for Owner review**: Electron MAIN checks the durable one-time QA test journal, signed report and approved agent/ticket, then signs a narrowly allowlisted `POST /v7/tasks/qa-evidence`. Central reads the **currently APPROVED** QA node's public key from its own MySQL enrollment record, authenticates the HTTP caller, checks project `can_qa`, independent Developer/QA identities, exact immutable ticket/head/tree/baseline, canonical report bytes, report SHA-256, node Ed25519 signature and public-key fingerprint. It records a deterministic `qaev_<sha256>` proposal in existing `v7_approvals` with `kind=QA_EVIDENCE_REVIEW`, initially **PENDING**. It cannot progress a task, grant Git rights or publish code.
2. **Request QA receipt ONLY after Owner approval**: An Owner must separately review the original signed report, trust the enrolled device key, verify the actual runner/image provenance and confirm physical independence. Owner submits `APPROVE_QA_EVIDENCE` for the exact proposal through the already Owner-admin-authenticated `/v7/owner/command`, including a meaningful `review_note` (at least 20 characters) and explicit `device_identity_confirmed`, `runner_provenance_reviewed`, `test_evidence_reviewed`, `independence_verified` flags, all true. For a negative determination use `REJECT_QA_EVIDENCE` and a meaningful reason. The legacy generic `APPROVE_PROPOSAL` path cannot approve these protected proposals. **Do not check the flags without performing the actual review.**
3. After such Owner review, QA PC explicitly requests an exact OS-vault-signed `POST /v7/tasks/qa-receipt`. Central checks the immutable approved review, same approved QA node and agent, full hash/commit/tree and access grants. Previously allowed **hash-only** QA receipts are now denied. A passed result may transition to `INTEGRATING`; a failed result to `TEST_FAILED`. Neither path publishes Git, merges a PR or deploys production.

Both QA POST actions use private checksum-verified, exclusive durable request-ID journals, so ambiguous replies do not mint a new idempotency key. The remote exact-body idempotency record returns the original response; a changed local report, signer identity or candidate fails closed. The journal stores only hashes/IDs, not secret keys or a second copy of the report. Since 22 November the packaged QA receipt flow also performs **fresh device-signed read-only Owner-review/receipt UUID reconciliation** before clearing a local intent: after a committed-but-lost response, manual retry reconciles via GET without a second receipt POST. Physical QA machines, real Owner review and signed production release remain open acceptance gates.

**Server bootstrap caution:** The added verification uses the already existing `v7_approvals` schema; it makes no new production migration and does not authorize running the empty-database bootstrap on existing Hostinger MySQL. The current pilot is alpha; never claim a valid signature alone proves sandbox security. Never approve the QA evidence as a stand-in for a separate HIGH/CORE risk Git authorization.

## One-shot guarded QA→GitHub branch publication (20 November 2026)

**Default: DISABLED.** The protected packaged `apps/desktop/git-publish-policy.json` intentionally contains `enabled:false`, `allowed_repository:null` and `git_exe:null`. Before packaging a QA-only, Owner-approved Windows build, the Owner must explicitly configure `enabled:true`, the exact allowed GitHub `owner/repo`, and a trusted **absolute** Git-for-Windows `git.exe` path, preserving `credential_mode:GCM_PRECONFIGURED_NONINTERACTIVE`. This is NOT production signing. Authenticate a minimally privileged GitHub credential in OS-backed **Git Credential Manager** separately on that QA PC (repo Contents write only; never save a PAT in a config file, task, URL, command line, Git remote, renderer or environment). No Git push button is enabled in the default package.

The Windows operator first completes the independent Docker QA test, device-signed report, Central evidence upload, explicit Owner evidence review and Central accepted PASS receipt. Only a task with status `INTEGRATING` and matching signed Central QA preflight is eligible. The operator selects the **same original** `.bundle` and trusted checkout at baseline and explicitly confirms **one real remote branch creation**. The publisher revalidates the local PASS and signed report, original local one-attempt journal, immutable Central task, exact bundle SHA, history/scope/mode/attrs in a disposable bare Git quarantine, and restricts to **exactly ONE child commit** of approved baseline. Multi-commit changes must be deliberately collapsed and **retested/reapproved**; never silently rewrite the QA-tested SHA.

Central `GET /v7/git/preflight/:ticketId` requires a live approved Master/epoch, authorized QA agent and distinct enrolled device from Developer, valid exact PASS receipt, project QA ACL, no maintenance fence, no existing publication job, and separate HIGH/CORE Owner change approval. The signed response fixes repository, base branch, target ai/* branch, baseline/candidate HEAD/tree SHA, task version, QA evidence SHA, and epoch. Before reservation the Desktop uses locally trusted Git CLI + noninteractive Git Credential Manager to READ exact remote base branch and absent destination. Neither task text nor renderer can select the remote URL.

After double-checking Central and GitHub, an exclusive fsynced private `git_publish_<ticket>_intent.json` journal is written **before** Central one-time Git reservation. Once reserved, the publisher rechecks remote base and destination, then streams *only the exact verified candidate commit object* from quarantine through `git push` to `https://github.com/<approved_repo>.git`, with hook execution disabled and a Git lease requiring the destination ref to be ABSENT. The lease uses `--force-with-lease=refs/heads/<ai_branch>:` exclusively as a compare-and-swap *new ref creation*; it does not grant rewriting an existing branch, and no `--force`, `+` refspec, main push, PR creation or merge is used. Central `POST /v7/git/confirm` independently inspects real GitHub remote branch, parent, candidate HEAD/tree and exact scoped files before accepting `PUSH_CONFIRMED_NOT_MERGED`. Success creates an exclusive local `git_publish_<ticket>_receipt.json`.

**No automatic retries.** After the initial journal exists, all subsequent attempts for the ticket abort, including interrupted reservation, failed/ambiguous Git transport, changed remote base or denied Central confirmation. The Owner must use existing read-only `GET /v7/owner/git-recovery` and explicit guarded `POST /v7/git/recover-remote-proof` when appropriate. Do NOT clear the intent by hand or re-push. Remote GitHub ref protection still needs separate Owner configuration and actual credential/Windows acceptance.

**Current limitations:** The default configuration cannot publish anything. Automated CI verifies a real local bare-Git absent-ref compare-and-swap and mocked Central/Git credential boundaries; live GitHub write, GCM credential installation, physical independent PCs, signed Windows production release, Hostinger staging/MySQL recovery, production rollout and real Owner QA acceptance are **not** claimed. Existing legacy CLI worker path still requires separate review before use; the packaged Desktop is the intended guarded workflow.

## 21 November — Windows OS-vault crash and restart safeguards (alpha)

The packaged Desktop uses the original OS-encrypted identity record. New local safeguards synchronize the encrypted temporary file before an atomic replacement, and synchronize the parent directory on POSIX systems. For a NEW identity, an otherwise empty POSIX vault directory is restricted to mode 0700 **before** saving any encrypted identity bytes. A directory holding an existing vault that is too permissive, or an unsafe/symlinked vault file, fails closed. A restarted Desktop can rotate its software boot ID while preserving the existing enrolled key, agent IDs and counters. Every heartbeat must strictly advance both the node and all local agent sequence numbers **before sending**. A duplicate/replayed sequence, altered private key, missing agent, or attempted same-operation boot+counter change is blocked.

**Owner action when a vault, filesystem or sequence check fails:** do NOT delete/rename `identity.osvault.json`, copy vaults between machines, re-enroll to bypass a failure, manually modify counters or start multiple competing Desktop processes. Preserve protected diagnostic evidence and seek independent Owner review. No action here automatically resumes uncertain Git work, approves an installer or releases maintenance holds.

These changes are tested on synthetic filesystems/credentials. Real Windows DPAPI storage backend, filesystem ACLs, power-cut/reboot persistence, backup-restore rollback protection and multi-PC failover still need separate physical Owner acceptance. The Windows directory durability property is not certified by Node's POSIX-only directory fsync; signed installer and production remain HOLD.

## 21 November 2026 — Packaged Windows node continuity evidence export safety

Under **Setup → Export pilot node proof**, the Owner selects an existing local Owner challenge, deliberately chooses BEFORE or AFTER, and chooses a new filename. The Desktop signs the challenge-bound node-key observation inside Electron main from the existing enrolled OS-vault identity; the private PEM is never saved to the exported proof or exposed to Setup IPC. This signed JSON is **supporting evidence only**, not a reboot, Master promotion, installer, QA or release approval.

The exported file is now opened with exclusive-create semantics (`O_EXCL`), not check-then-open, and writes are looped until complete. The writer then flushes the file; on POSIX test/utility runs it also requires a private owned parent directory (0700) and flushes the same verified directory inode. A short write or disk/file/parent sync failure **blocks and preserves even a partial file in place**, so the same output name cannot be overwritten by a later attempt. Owner action: preserve the failed filename, independently review the incident and obtain a new approved evidence session/destination; do **not** delete and retry an uncertain proof. Desktop dialog now explicitly warns about this.

Windows file flush does **not** establish a durable directory entry, actual Windows filesystem ACL privacy, physical machine identity or a genuine reboot. The returned receipt expressly says `directory_durability: WINDOWS_POWER_LOSS_UNVERIFIED`, `windows_acl_verified:false`, `physical_reboot_verified:false` and `production_release_authorized:false`. Store proof in an Owner-reviewed restricted folder; test real shutdown/restart, key custody and distinct Windows PCs separately. Synthetic CI tests inject short writes, zero writes, file and POSIX parent sync errors; Windows QA smoke is not hardware acceptance.

## 21 November 2026 — OS-vault lost-identity / cryptographic integrity fence

The packaged Desktop now validates the **exact** six-field encrypted Ed25519 identity schema, exact agent counter records, approved node/boot ID format, and matching real Ed25519 private/public keys whenever the vault is read or saved. Unknown identity fields, malformed keys, mismatched key pairs, malformed/extra encrypted-record fields and noncanonical ciphertext fail closed. The original private key remains inside Electron Main OS-safeStorage; no PEM is included in setup UI, logs or signer IPC. The tests use genuinely generated Ed25519 key pairs, not dummy strings.

If `node/identity.osvault.json` is missing but **any entry remains in the node directory** (enrollment marker, status, maintenance evidence, old outbox or interrupted encrypted-write temporary file), the vault returns `OS_VAULT_IDENTITY_MISSING_OWNER_RECOVERY_REQUIRED` and will **not** silently generate a new device identity. Do not delete or rename the residual entries to bypass this hold. An authorized Owner must reconcile Central's enrolled node, accepted signed sequences, work/QA/Git effects and original PC before deciding on a recovery procedure. These checks **do not prove** the userData directory is protected by Windows ACLs or that encrypted writes survive a real power cut. A real physical Windows installer, OS-user/ACL inspection, independent PCs and power-loss acceptance remain required. Production HOLD.

## 21 November 2026 — Interrupted OS-vault counter writes: durable Owner review fence

The packaged Electron vault now stages an **exclusive, content-free** `node/identity.osvault.write-intent` before each encrypted identity replacement. It flushes the marker, then writes/fsyncs/atomically renames the ciphertext, and retires the intent only after a successful commit. A partial intent, existing intent, failed file flush, failed rename or interrupted retirement leaves a **blocking Owner-review record**. A fresh Electron process refuses to read, initialize, sign or update counters while it exists. An in-process vault additionally becomes poisoned after a failed/ambiguous write even if the marker is later removed.

The secure child treats **any failed or timed-out `saveCounters` IPC** as terminal `OS_VAULT_COUNTER_COMMIT_UNCERTAIN_OWNER_REVIEW`: it does not send a heartbeat, try another sequence or retry that operation. Electron Main records an Owner-review error and suppresses child auto-restart (including manual start within that Desktop process) after a failed counter-save IPC response. The signer bridge itself cannot sign node APIs, worker/QA operations or enrollment with a poisoned vault. The intent contains no PEMs, ciphertext, enrollment codes, secrets, identifiers or node sequence values. Never delete it to "fix" a PC; preserve the original device and consult the Owner's authorized Central recovery process, replay/lease/Git evidence and encrypted-write integrity.

**Acceptance boundary:** These code/CI safeguards do NOT prove Windows userData ACL isolation, real DPAPI key custody, correct behavior through a physical power loss or the durability of directory-name changes on NTFS; Node cannot reliably fsync Windows directories. Owner-controlled physical hardware evidence is still mandatory. Production HOLD.

**IPC timeout / abrupt child exit guard:** If the counter-save acknowledgement never reaches Electron Main, the child exits with a nonzero code; Main now treats any unexpected nonzero or signaled child exit as `OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED`, rather than scheduling a replacement process. This is intentionally conservative, including non-vault child crashes. The process-local hold is not a substitute for physically validating persisted on-disk intent and NTFS power-loss behavior.

## 21 November 2026 — Persisted heartbeat sequence and signer-body binding

The packaged Electron OS-vault signer now enforces **exactly +1** progression of the node sequence and **every** configured local agent sequence before each signed heartbeat counter save. The encrypted vault independently enforces the same exact-step invariant (not just `>`), rejecting skipped values even if code bypasses the child IPC signer. Failed validation makes no file change or write-intent marker; a failed/ambiguous persistence operation still triggers the separate durable Owner-review fence.

The child can request a `POST /v7/nodes/heartbeat` signature **only** for a JSON packet with exactly the expected fields: `boot_id`, `sequence`, `expected_master_epoch` and `agents`. It must match the **already durably persisted** node boot/sequence, the exact enrolled local agent order/IDs/sequences and explicit `ONLINE` status for each. Extra fields, forged agent/boot identity, changed status, invalid epoch and an unsaved future sequence are refused. Generic authorized node GET and separate recovery operations retain their existing scoped request rules; Central still independently verifies the signed sequence, approval and anti-replay policy. This guards the signer boundary against a buggy or manipulated supervised child; it does NOT attest OS-hardware key custody or prove any heartbeat was accepted.

CI unit tests use real generated Ed25519 signatures, verify the accepted canonical packet, and assert denial of altered/unsaved packets and skipped counters. Physical multi-PC acceptance, actual Windows ACLs/DPAPI and power-loss behavior remain HOLD.

## 21 November 2026 — Scoped Desktop node POST signing

The packaged Electron child never receives the OS-vault Ed25519 private key. Its three permitted node POST methods are now **individually** checked against exact request contracts inside Electron Main, before an Ed25519 signature is generated. The aggregate heartbeat remains bound to the already persisted boot ID, local roster and exactly stepped counters. For `POST /v7/agents/register`, only an agent ID already present in this PC's encrypted identity can be signed, with precisely `{engine:"BROWSER_ASSISTED", platform:<local OS>, secure_identity:true}` capabilities; extra keys or invented other-PC IDs are denied. For `POST /v7/leadership/reconcile`, the only signed payload is the exact four-field statement for an enrolled local agent, positive safe-integer epoch, `recovery_<epoch>_<agent>` request ID and lowercase 64-hex recovery manifest SHA-256. Arbitrary or malformed JSON, extra fields, foreign agent IDs and mismatched epochs/hashes fail closed as `VAULT_NODE_POST_CONTRACT_DENIED`.

These new checks do **not** elect a Master, approve a new agent, validate the recovery manifest, bypass QA, or perform Git/installer actions; the Central MySQL authority continues to verify enrollment approval, recovery phase/epoch and exact authoritative manifest before accepting any signed request. A valid local signature is never a Server acceptance receipt. Regression tests verify real Ed25519 signatures for the exact allowed POST bodies and refusal of arbitrary foreign/extra-action payloads. Physical Windows DPAPI, signed installer, multi-PC and Hostinger staging remain production HOLD.

## 21 November 2026 — Durable child-session restart fence

A packaged Electron Main **now creates and flushes** `node/edge-agent.session-uncertain.json` **before** spawning the supervised OS-vault heartbeat child. On a normal verified clean child exit, a confirmed Owner maintenance stop with an already active local hold, or a user-requested app shutdown with a real child exit, Main retires only its matching session marker. The before-quit handler gives the child a bounded 12-second exit-observation window instead of immediately terminating Electron. Any unexpected child signal/nonzero exit, process spawn error, crash of Electron Main itself, failed marker write/retirement or power loss leaves the marker for Owner review. A later Electron launch checks this marker **before constructing the signer**, including when a manual maintenance restart grant exists. It cannot auto-rekey, sign, register, heartbeat, claim work, retry Git or automatically remove the marker. The setup status reports an orphaned session as `OWNER_REVIEW_REQUIRED`; it is not restart authorization.

**Owner action:** preserve the exact original node directory and OS-vault identity, check the local service/process is truly stopped, Central's accepted sequence counters, current Master epoch, worker/Git/QA side effects and maintenance/installer fences. Do **not** manually delete the marker to enable a retry. A separately reviewed safe marker reconciliation/removal protocol is not yet implemented. A legitimate unclean Windows shutdown can intentionally leave the device blocked; safety takes priority over unattended reboots in alpha. POSIX tests cover protected one-shot writes, crash simulation, symlink and corrupt marker refusal, file/directory sync failures and verified retirement. Windows NTFS directory power-loss durability/ACLs and real physical reboot validation remain **not tested**; production HOLD.

## 21 November 2026 — Read-only crash/restart diagnostics for the Owner

A packaged Windows Desktop with an orphaned `edge-agent.session-uncertain.json` marker can now show an **Inspect crash / restart evidence (read-only)** button in Setup. Electron Main reads only fixed, allowlisted local evidence filenames (session intent, encrypted OS-vault record, vault write intent, enrollment receipt, last local status, maintenance hold/restart receipt and installer attempt). It checks the owner-private node directory; rejects unsafe/symlinked, oversized or changed evidence without following it; hashes bounded bytes; flags a malformed session marker; and counts unclassified entries **without revealing their names**. The renderer receives SHA-256 hashes and byte counts, **not** ciphertext contents, secret fields, token, private key, untrusted file text, any arbitrary directory path, or an authority to sign.

The inspector can operate even while vault initialization is blocked by an orphaned child session. It never decrypts or alters vault data, queries Central, deletes journals, signs requests, enrolls, changes counters, closes holds, starts agents or launches installers. The UI explicitly marks this snapshot **unsigned, locally observed, Central unverified, and not an Owner release grant**. Preserve the original PC. The Owner must independently compare Central accepted node/agent sequences, current Master epoch, leases and pending Git/QA effects, original OS-vault/Windows credentials, installed executable and physical shutdown evidence. A separately approved and safe marker recovery procedure is NOT yet implemented. No production signing, Hostinger deployment or real Windows power-cut acceptance: release HOLD.


## Windows package dependency guard — 23 November 2026

The package source allowlist now explicitly includes
`bounded-central-json.cjs`. All declared packaged CJS modules have
their literal relative `require()` dependencies checked before QA or
Owner-gated release packaging. The check prevents known missing-module
startup defects without certifying dynamic module loading or real
Windows installation. Full physical Windows smoke remains necessary.


## Bounded first-run Hostinger health probe

Desktop setup now bounds its HTTPS Central health response to 64 KiB,
requires JSON/MySQL readiness and an exact protocol match, and rejects
redirects or unreadable streams. The module is included in the Windows
package dependency closure. Real staging HTTPS, Windows installed-app
startup, Owner approvals and physical PCs remain unverified.


## Inspect real built ASAR before accepting a Windows package

The QA and protected release packagers now inspect the final unpacked
Windows `app.asar` and compare every declared module's bytes against
reviewed source, then independently verify the external secure-agent
bundle. Static package closure alone was insufficient. Failure leaves
the package unapproved and unpublished. A successful inspection does not
prove a Windows installer can be executed or correctly signed.


## One-time PC settings registration

The local `desktop-settings.json` now has a maximum 4-KiB bounded
read and a create-once write. Duplicate setup cannot overwrite an
existing PC roster or silently change Central. Invalid or symlinked
settings require Owner recovery, not identity deletion. This helper
is included in actual Windows ASAR verification. No physical Windows
installer/DPAPI acceptance is implied.


## Signed child HTTP response size gate

The packaged Windows agent now uses a strict, streaming read of Central
heartbeat and registration replies, maximum 64 KiB. Master recovery
snapshot uses a separate maximum 512 KiB to accommodate the 300-event
validated history. Invalid headers, malformed JSON, unknown API paths,
oversize responses, redirects and ambient web cookies are rejected.
This cannot prove live Hostinger connectivity or physical election
acceptance; independently observe real PC heartbeats before release.


## Local heartbeat display is not authoritative

The Windows packaged child and Electron UI share a 4-KiB bounded
`status.json` reader/writer. Damaged, symlinked or mismatched-node
status cannot silently be shown as a valid Central ACK. The last
accepted timestamp can remain visible during an outage but is never
a fresh ACK or permission to restart, elect or release anything.
Real signed Central state and physical-PC acceptance remain separate.


## 23 November 2026 — OS-vault and receipt reader hardening

Encrypted device identity and the signed-enrollment state receipt
are now read by stable bounded file descriptors, not with an
independent pathname read after checking the file. A changed
inode, truncation, symlink or exposed POSIX file fails closed.
This does not rotate an existing key, remove a write-intent
marker, auto-enroll a PREPARED node, or authorize release.
Actual Windows DPAPI and restart/power-cut acceptance still
need Owner-supervised physical tests.


## 23 November 2026 — Interrupted enrollment markers

Enrollment state inspection now distinguishes an absent file from
a dangling symlink: both current enrollment-receipt.json and legacy
enrollment_requested marker paths are checked with lstat, rather than
existsSync. Any dangling or tampered marker requires Owner review
instead of silently treating the identity as not enrolled. Existing
PREPARED/SUBMITTED and OS-vault fail-closed behavior is unchanged.


## 23 November 2026 — Session uncertainty marker integrity

The one-shot heartbeat child session marker now retires only after
bounded file-descriptor reading and pre-unlink path/inode checks.
Symlink swaps, same-content replacement files and short reads retain
the Owner-review hold instead of silently clearing uncertainty.
A safe tracked child exit is still required, and Node cannot provide
atomic inode-conditional unlink against hostile local processes.
Physical multi-PC, Windows reboot and signed-update tests still HOLD.
