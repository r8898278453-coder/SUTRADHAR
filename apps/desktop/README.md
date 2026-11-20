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

The verifier checks file bounds, strict report schema, externally supplied public-key fingerprint, Ed25519 signature, exact node/agent/ticket/head/tree and report-byte hash. It returns `DEVICE_SIGNED_LOCAL_ONLY` and explicit `qa_approved:false`. This proves **the approved key signed the local report**, not that Docker ran securely, the test was genuinely independent, or Central approved QA. The current Central `/v7/tasks/qa-receipt` only accepts an evidence hash/reference and could otherwise advance a ticket; **this app does not call it** until genuine server-side evidence verification and Owner policy are implemented. Independent review of Docker image provenance and actual physical multi-PC evidence remains mandatory.
