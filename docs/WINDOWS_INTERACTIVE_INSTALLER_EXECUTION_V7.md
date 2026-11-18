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
