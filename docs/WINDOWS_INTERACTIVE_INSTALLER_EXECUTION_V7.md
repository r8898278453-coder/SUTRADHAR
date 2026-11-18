# SUTRADHAR v7 — Owner-approved Windows installer launch

**Status: ALPHA — code gate implemented, real production execution NOT accepted.**
The UI action is `Owner-authorized Windows installer launch (one time)`.
It is separate from `Stage Owner-signed update / rollback (NO INSTALL)`.

## What the Owner does

1. Do not use an unsigned QA installer. Prepare an immutable, stable Desktop release using a legitimate Windows Authenticode certificate, Owner-protected release keys, an approved source commit, and passing security gates. The default alpha trust files are `UNCONFIGURED_BLOCKED`.
2. For a **noncritical pilot PC**, confirm Central's retained Master and Backup 1/2 are healthy. Use the Owner maintenance drain/finalize workflow until the exact node and plan report `DRAINED`. The PC must be idle with no live leases, unfinished tickets or uncertain Git jobs.
3. On the enrolled Windows PC, choose `Owner maintenance: isolate this drained PC`. Verify the local agent has **exited** and a persistent `maintenance-recovery-hold.json` exists.
4. Use `Stage Owner-signed update / rollback (NO INSTALL)` to select the exact Owner-signed schema-v2 offer JSON beside its Authenticode-signed EXE. Desktop checks Owner signature, recipient node, wave, version, EXE checksum/publisher, Central state and local hold, then saves one immutable local preparation receipt and a signed staged-copy receipt. **Do not remove or edit these files.**
5. Owner reviews `installer-preparation-ready.json` (local OS-vault-signed device receipt), the signed offer and Central epoch. On a separate protected signing machine, explicitly approve **one** interactive execution of that particular staged EXE. For rollback, a second emergency rollback approval is mandatory.
6. Create the short-lived execution grant with `npm run release:sign-installer-execution` on the Owner signing machine, passing the environment variables below. The private key and output path must be absolute and **outside this repository**. Copy the signed grant JSON to the enrolled Windows PC; the private key must never be copied.
7. On the PC select `Owner-authorized Windows installer launch (one time)` and choose that grant. The Desktop requires that its encrypted device identity and agent IDs still match, both signed preparation receipts agree, the held plan and SHA match, staged EXE passes an additional Windows Authenticode verification, and Central is still DRAINED with healthy Master/Backup state and idle local workers. A signed exclusive `installer-execution-attempt.json` is persisted **before** any Windows EXE is started.
8. If approved, SUTRADHAR launches the staged EXE **with no silent arguments and no shell**. Windows' own UAC/setup prompts remain visible. A second device-signed `installer-execution-launch-observed.json` records only the observed process start. Desktop exits so NSIS can replace installed files. **A launch event does not prove successful installation.**
9. After Windows setup ends and the Desktop reopens, use `Check identity after Owner installation (read-only)`. It compares the encrypted OS-vault keypair and agent IDs to signed preparation receipts and compares the observed Desktop version against the intended target. It does not read or export the private key.
10. Have the Owner independently check installed file version, Central compatibility and the actual device's heartbeat, then perform the separately signed maintenance cancellation / hold release / one-time manual restart and reconciliation procedures. Never delete the hold or any signed receipt to force a restart.

## Protected offline signing inputs

| Variable | Value |
| --- | --- |
| `SUTRADHAR_OWNER_INSTALL_EXECUTION_APPROVED` | The literal `yes`, after an Owner decision |
| `SUTRADHAR_INSTALL_NODE_ID` | Exact `node_<32 lowercase hex>` from the held PC |
| `SUTRADHAR_INSTALL_PLAN_ID` | Exact maintenance plan ID |
| `SUTRADHAR_INSTALL_WAVE_ID` | Exact `wave_` rollout ID |
| `SUTRADHAR_INSTALL_OFFER_SHA256` | SHA-256 of canonical signed *offer envelope*, **not** EXE bytes |
| `SUTRADHAR_INSTALL_EXE_SHA256` | Exact staged Authenticode-signed EXE SHA-256 |
| `SUTRADHAR_INSTALL_KIND` | `update` or `rollback` |
| `SUTRADHAR_INSTALL_TARGET_VERSION` | Stable target release, e.g. `7.1.0` |
| `SUTRADHAR_INSTALL_MASTER_EPOCH` | Positive Central epoch of this DRAINED plan |
| `SUTRADHAR_INSTALL_EXECUTION_SIGNING_KEY_FILE` | Owner-protected private Ed25519 key path outside repository |
| `SUTRADHAR_INSTALL_EXECUTION_GRANT_OUTPUT` | New absolute JSON file path outside repository; never overwrite |
| `SUTRADHAR_OWNER_EMERGENCY_ROLLBACK_APPROVED` | `yes` only for independently Owner-approved rollback |

The private key's **public counterpart** is the `installer-execution-trust.json` key in a **production-signed** package. The protected packager requires `SUTRADHAR_INSTALL_EXECUTION_PUBLIC_KEY_PEM_B64` and `SUTRADHAR_MAINTENANCE_RELEASE_PUBLIC_KEY_PEM_B64` in addition to its existing update-verification public key. They must all validate as Ed25519 public keys before production signing. The packaging script temporarily embeds the public keys for the signed build and restores source trust files afterward. No private Ed25519 key is packaged.

## State and safety boundary

- `installer-preparation-attempt.json`, `installer-preparation-ready.json`, `installer-execution-attempt.json`, and `installer-execution-launch-observed.json` are **audit records**; never manually delete, patch, overwrite or replay them.
- Execution is **one-shot** per local prepared maintenance operation, including when a launch errors or becomes ambiguous. No unattended installer, updater, restart, retry, reinstall or rollback exists.
- The original local maintenance hold is **not deleted by installer launch**. Neither the device identity nor saved agent sequence counter is intentionally modified.
- If no valid Owner execution grant, protected trust configuration, Authenticode-signed EXE, healthy Central, matching OS-vault identity or exact stage exists, the PC must refuse to launch.
- Local user-data files are not hardware-backed anti-replay records. A PC administrator may alter files, and a filesystem race can occur between hashing and Windows process creation. Physical Windows tests, protected ACLs, power-loss simulation and an authoritative Central execution lease are still **production NO-GO** items.
- Because Windows OS installation is a separate process, the app does **not** know the installer's exit code or UAC decision. Version, stable identity, and heartbeat need independent acceptance afterward. Never claim rollback succeeded from a process spawn event.

## CI coverage

`tests/desktop_maintenance_installer_execution.test.cjs` exercises exact grant/signer matching, scope changes, expired grants, replay, malformed or incomplete attempt receipts, tampered staged EXE, withdrawn Central fence, epoch/role changes, active work, offline Central, simulated successful Windows spawn and simulated spawn failures. It runs in `npm run test:desktop`. These are **mock launches** only; the unsigned QA package is never a live production installer.

The full npm high/critical audit (including development dependencies), genuine Owner credentials, Hostinger staging and real multi-PC acceptance remain independent release gates. **Do not merge or deploy based on this code alone.**

## Post-install verification before Owner maintenance release — 18 November 2026

After the interactive Windows installer has finished or the Owner has inspected its result, reopen the installed packaged Desktop on that same PC. Select **Verify installed Desktop and Central before hold release**. This action is explicitly **manual**; it cannot run on an unsigned QA build or silently release the maintenance fence.

The Desktop checks the on-disk original local maintenance hold, the same encrypted OS-vault private/public keypair and enrolled agent IDs, the device-signed installer preparation and process-launch receipts, a matching `app.getVersion()` against the previously signed target version, and a valid Windows Authenticode signature on **the running installed Desktop EXE** (not just the old staged installer). It then sends fresh node-authenticated HTTPS requests for Central maintenance, cluster state, and node-agent state. Both cluster snapshots must retain the expected READY epoch and stable Master/Backup 1/2 roles; both maintenance snapshots must retain the exact DRAINED plan, wave, offer digest and fence; all local agents must be approved, idle and free of tickets/work leases/unreconciled Git jobs. The local evidence and installed executable signature are rechecked after network calls.

Only after all checks succeed does the device write an exclusive OS-vault Ed25519 signed `installer-postinstall-observed.json` record. Its status is `TARGET_VERSION_IDENTITY_CENTRAL_OBSERVED`—**not** `INSTALLATION_COMPLETED`. It explicitly records `installer_completion_proven:false`, `installer_exit_code_verified:false`, `auto_release_allowed:false` and `automatic_rollback_allowed:false`. Installing the same version by some other method, Windows' elevation/UAC choice, or an NSIS failure cannot be conclusively distinguished without separate Windows installer exit evidence and real PC acceptance. Preserve the authentic Windows installer logs for Owner review.

**New hold-release gate:** If any `installer-execution-*.json` journal is present, the existing Owner-signed maintenance-hold release procedure now requires the unmodified, device-signed post-install observation, the same currently running app version, and matching signed launch/preparation evidence. It *still* requires a separate signed Owner release grant and two fresh independent Central **cancellation** checks after the Owner has explicitly cancelled that DRAINED plan. No journal authorizes auto-restart or local hold removal by itself.

If the installer was declined, errored, produced an unexpected version, lost device credentials, changed publisher signature, or Central changed Master roles, **DO NOT delete any file, automatically retry, reinstall, or roll back**. The hold remains active for manual Owner investigation and controlled recovery. There is not yet a production-approved failure exception flow for such cases. Production safety still depends on Owner certificate provisioning, OS ACL/power-loss acceptance, a transactional Central execution lease, real Windows setup completion evidence, Hostinger staging and physical multi-PC testing. The strict dependency audit still blocks production release.

## 18 November 2026 — cancelled/uncertain installer diagnostics, and fresh release-time Authenticode

**New Owner button:** `Record canceled / uncertain installer (NO RECOVERY)`. Use it only when a previously authorized installer process was attempted but the *old approved Desktop version* still runs. After an installer was attempted, the original local hold remains in place, so the local agent cannot auto-restart. The button verifies both signed preparation receipts, the device-signed execution-attempt receipt and an optional device-signed process-spawn record. A missing launch record is explicitly classified as `LAUNCH_UNCONFIRMED_OLD_VERSION`, not proof that Windows never started the installer. A valid launch record plus the old version is `LAUNCH_OBSERVED_OLD_VERSION`, not proof that the installer definitely failed or was cancelled. In either case there is no trusted NSIS exit status.

The diagnostic repeats OS-vault keypair/agent checks and validates the currently running old Desktop EXE against the Owner-pinned Windows Authenticode publisher before and after fresh node-authenticated Central checks for the exact `DRAINED` plan, unchanged Master/Backup epoch/roles and idle approved agents with no work leases or unfinished Git jobs. It writes one exclusive, **device-signed** `installer-failure-review-observed.json` with explicit `installer_outcome_known:false`, `installer_exit_code_known:false`, `owner_hold_release_allowed:false`, `automatic_rollback_allowed:false` and `automatic_retry_allowed:false`. This is an **investigation receipt only**, not an emergency release, rollback permission, update result, or health attestation.

**Stronger successful-path hold release:** Even after a valid earlier post-install observation and separate Owner-signed Central cancellation, hold release rechecks the *currently running* installed Desktop EXE's Authenticode publisher and actual SHA-256 against the signed post-install observation. A changed/replaced executable or lost publisher trust blocks release. For a PC on which no installer launch was attempted, the historical Owner release path remains unchanged. The original device identity must remain intact in either case.

If Windows setup was cancelled, no verified target version is running, or a signed receipt is corrupt, current policy intentionally **does not provide an automatic or self-service hold release path**. Owner must investigate Windows setup logs, installed files, OS-vault integrity and Central state, and authorize a future distinct failure-recovery procedure. Never remove the hold/journals manually to evade this guard. The desktop's installer subprocess is detached and the app exits after process spawn; therefore this release does **not** capture trusted NSIS completion or exit codes. Do not infer such evidence from the diagnostic labels.

This remains alpha: live Windows process-exit tracking, protected durable Windows receipts, code-signing, Hostinger staging, physical multi-PC tests and the full npm supply-chain audit remain production NO-GO gates.

## Owner-signed failed-install investigation after Central cancellation — alpha

The PC's **Record canceled / uncertain installer (NO RECOVERY)** diagnostic must be made **while the exact Central maintenance plan is still DRAINED**, with its persistent local maintenance hold present. This records `installer-failure-review-observed.json` from the device's OS-vault Ed25519 key and confirms only that the **old version remains installed** with the Owner-pinned Windows Authenticode signer. It does not establish installer exit status or authorize release.

After reviewing that diagnostic, the Owner may cancel that exact Central plan using the existing protected administrative `CANCEL_PC_UPDATE` action. Only then can an independent Owner issue a short-lived `review_failed_install_recovery` grant, using the offline command `npm run release:sign-failed-install-review` on a trusted signing machine. The signer **verifies three OS-vault-signed device receipts** first; it does not accept an unverified typed-only incident declaration. It requires these environment variables:

| Variable | Purpose |
| --- | --- |
| `SUTRADHAR_OWNER_FAILURE_RECOVERY_REVIEW_APPROVED=yes` | Explicit manual Owner approval |
| `SUTRADHAR_FAILURE_DIAGNOSTIC_JSON` | Absolute path to copied device-signed `installer-failure-review-observed.json` |
| `SUTRADHAR_FAILURE_PREPARED_JSON` | Absolute path to device-signed `installer-preparation-ready.json` |
| `SUTRADHAR_FAILURE_EXECUTION_ATTEMPT_JSON` | Absolute path to device-signed `installer-execution-attempt.json` |
| `SUTRADHAR_FAILURE_DEVICE_PUBLIC_KEY_FILE` | Absolute path to trusted enrolled device **public** key PEM |
| `SUTRADHAR_FAILURE_OWNER_SIGNING_KEY_FILE` | Protected Owner Ed25519 **private** signing key path, outside repository |
| `SUTRADHAR_FAILURE_OWNER_GRANT_OUTPUT` | A **new** absolute JSON grant file, outside repository (exclusive-create; never overwrite) |

Never copy the device private key or Owner signing private key to another PC or the repository. The Owner must separately check the device public key's enrollment fingerprint from original Central records, the physical PC identity, and the Windows setup logs; merely possessing a copied public key file is not independent identity validation.

The Owner transfers the signed grant to the same enrolled Windows PC. In a separately protected signed release, the **Owner-signed failed-install investigation (NO RELEASE)** Desktop action requires the separate `failure-review-trust.json` Ed25519 public key (`UNCONFIGURED_BLOCKED` in alpha) plus an unchanged OS-vault keypair, the old app version and its fresh Authenticode publisher/hash, the exact diagnostic/attempt/plan/offer/grant IDs, and **two fresh node-signed Central CANCELLED checks** separated by a healthy, stable READY Master/Backup cluster and approved idle agent check. It writes one immutable, OS-vault-signed `installer-failure-exception-reviewed.json` receipt.

**The result is NOT an exception to release the hold.** Neither the signing command nor the Desktop action removes the hold, restarts a worker, runs an EXE, grants an automatic retry, grants rollback, claims NSIS exit success, or unlocks the existing post-install release requirement. This preserves the original isolated PC for human investigation. The original plan's cancellation and the new grant are **necessary evidence for review only**.

Production signed packaging now requires a separate validated `SUTRADHAR_FAILURE_REVIEW_PUBLIC_KEY_PEM_B64` public trust root. The release packager restores the source trust JSON afterward; default unsigned QA cannot activate it. A future **distinct** Owner-assisted failed-install *resolution* requires physical Windows installer/NSIS outcome evidence, process inventory/elevation checks, protected durable journals and an atomic Central authorization. Until those real-environment gates exist, do not delete the local hold or grant a recovery restart based on this review receipt.

**Incident fencing strengthened:** The presence of `installer-execution-attempt.json`, `installer-failure-review-observed.json`, or `installer-failure-exception-reviewed.json` now blocks ordinary automatic agent launch, even if the original maintenance hold file is accidentally absent. This is not tamper-proof storage and the manual restart remains independently Owner-controlled. In addition, the normal successful-install Owner hold-release path **explicitly refuses** any failed-install diagnostic or failed-install Owner review receipt. A distinct future Owner-controlled failed-install *resolution* contract is required; a `review_failed_install_recovery` grant **must never be reused** as a release, restart, rollback or installer authorization. Existing receipts are retained; do not manually delete them.

## Optional device-signed direct installer process exit — 18 November 2026

The **Owner-authorized Windows installer launch** now attaches a best-effort exit-event listener to the **directly spawned Windows EXE**. If Node observes the direct child's `exit` event **before Electron quits**, it records the PID, direct exit code or termination signal, exact node/plan/wave/offer/EXE digest, one-time Owner execution grant ID, target version and operation kind in an exclusively created, OS-vault Ed25519-signed `installer-direct-exit-observed.json`. The listener buffers an unusually early exit until after the existing device-signed launch receipt has been fsynced. A process-exit receipt cannot be overwritten on retry, and recording failure does **not** remove the maintenance hold.

The Desktop's **Inspect direct installer process exit (read-only)** button first verifies the original OS-vault-signed installer attempt, signed launch receipt, enrolled device identity and matching local hold. It then verifies the optional exit receipt's Ed25519 signature and exact scope. If there is **no exit receipt**, it reports **UNKNOWN**. Even **exit code 0** means *only that this direct child exited*: it does **not** prove that an elevated NSIS child/setup process completed, that UAC was approved, that the target software installed, or that Central recovery is safe. A nonzero code is likewise diagnostic, not a definitive whole-installer failure classification.

**Technical limitation:** The current Desktop deliberately quits shortly after launch so NSIS can replace its own files. Therefore a long-running installer may finish **after** Electron has exited and no direct exit receipt will be written. This is a deliberately partial instrumentation step; it is **not** a persistent installer supervisor, OS-native exit attestation, replay-proof event source or production acceptance. A future isolated external Windows supervisor (with preserved device identity, protected ACLs, process-tree/elevation tracking and power-loss testing) is still required to reliably capture completion. No logic uses the direct exit code to automatically grant installation success, rollback, retry, agent startup or hold release.

## Persistent, nonprivileged Windows process observer — 18 November 2026

The packaged Windows Desktop now attempts a **best-effort detached PowerShell / CIM observer** after the one-shot installer launch has been recorded with a **device-signed launch PID**. This watcher is separate from the Desktop and may continue for up to **120 minutes after Electron exits**. It does **not** spawn/restart the EXE, elevate privileges, read the OS-vault private key, contact Central, run rollback, delete files or modify the maintenance hold. Only Windows built-in PowerShell and `Win32_Process` inspection are involved; this feature is diagnostic, not an autonomous updater.

The observer looks for the exact PID and expected staged EXE path at first inspection. It records the Windows process **creation time**, then polls the same PID/path/creation-time combination. If the initial process is already gone, its path/creation time cannot be inspected (e.g. UAC or permission isolation), the PID has been reused, or the maximum observation period expires, it records a specific **uncertain** state. If the original PID disappears after having been verified, it records `DIRECT_PROCESS_DISAPPEARED`—**not** success. The witness is exclusive-create at `installer-process-observer-unsigned.json`; a preexisting or partial file is never overwritten automatically.

The button **Inspect persistent Windows process observer (unsigned)** verifies the existing enrolled OS-vault keypair, local maintenance hold and original **device-signed** installer attempt/launch scope before reading the witness. The witness's PID, node, grant and installer digest must match the signed launch evidence. But the **witness itself is unsigned and is explicitly UNTRUSTED**: its fields can be modified by the Windows account or a sufficiently privileged local adversary. Do not treat a matching witness as authenticated OS process completion. In particular, it contains **no trustworthy installer exit code**, verified elevated child-process chain, setup success proof, or automatic release permission. No maintenance release/restart code consumes this witness.

Expected failure modes: Desktop exits before PowerShell starts; PowerShell is restricted by local endpoint policy; `Get-CimInstance` cannot inspect an elevated installer executable path; installer process exits between initial launch and first observation; Windows reuses the PID; Windows reboots; or a 120-minute timeout occurs. All leave installer outcome **UNKNOWN**. The original one-time execution journal and hold remain in effect. This code was tested with mocks/CI, **not** real installed Windows/UAC/NSIS process-tree acceptance.

A production-credible, signed dedicated Windows supervisor with protected process handles, trusted exit records, elevation handling, power-loss recovery and physical-PC acceptance is still a separate NO-GO gate. Avoid installing a service, granting administrator rights, changing UAC settings or using an unsigned witness to bypass Owner authorization.
