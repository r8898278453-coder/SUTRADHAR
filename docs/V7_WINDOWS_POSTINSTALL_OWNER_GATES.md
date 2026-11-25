# SUTRADHAR v7 — Windows post-install trust and Owner recovery gates

Status: **alpha / HOLD**. This guide describes coded and mocked CI gates, not a real signed Windows release.

**Architecture:** SUTRADHAR is one monorepo with Hostinger Central/MySQL and independent Windows Desktop PCs. Central's Git/QA receipts are distinct from Windows installation evidence. A green Central CI result never substitutes for physically verified Windows Authenticode or Owner release approval.

## What changed

1. `apps/desktop/windows-authenticode.cjs` no longer invokes `powershell.exe` using PATH. Both the staged installer verifier and the running Desktop EXE verifier use the absolute `<OS drive>:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` target and a minimal subprocess environment. The code refuses untrusted or contradictory `SystemRoot`/`WINDIR` settings and custom Windows directories, rather than falling back to searching PATH. Real OS root provenance requires Windows access controls/security review. A mocked subprocess in tests is **not** a real certificate validation.
2. `apps/desktop/maintenance-postinstall-verification.cjs` now bounds each authenticated Central JSON GET response while reading the stream (64 KiB, maximum), denies redirects, refuses remote cookies and HTTP caching, and rejects invalid/missing responses. This reduces resource exhaustion opportunities during Owner-controlled recovery inspections.
3. Post-install observations can only be used for release-hold review when the device-signed fields retain `central_maintenance_reconfirmed:true`, an observation timestamp at/after the original signed installer attempt and launch, and no impossible future timestamp beyond the bounded clock allowance. A valid OS-vault signature on a contradictory payload is **not** a bypass.
4. All existing `installer_completion_proven:false`, `installer_exit_code_verified:false`, `auto_release_allowed:false`, and `automatic_rollback_allowed:false` requirements remain in force. The verifier still rechecks Authenticode and EXE hash when the Owner requests hold release.

## Operator sequence before real Windows acceptance

Keep the agent isolated after any installer attempt. Record the Owner-signed installer intent, immutable local package SHA-256, Authenticode certificate identity, protected OS-vault public key fingerprint, original maintenance fence and live Central epoch. On a physical PC after an Owner-authorized installer launch, independently inspect Windows installation/UAC evidence; **do not** treat process disappearance or an unsigned witness as installer success. Verify the running installed EXE's genuine Authenticode and SHA-256, preserved node/agent identities and the still-active remote maintenance hold. Only after a separate signed Owner cancellation and restart approval may the agent be brought back into work.

For a nonstandard OS install directory, unexpected SystemRoot/WINDIR discrepancy or unresolved Authenticode behavior, remain on HOLD and request a security review. Never change a PATH environment variable or bypass the trusted binary selection to force PASS.

## CI tests and explicit limits

Automated tests use disposable fixture signatures, mocked Windows publisher checks and Central responses, while GitHub Windows runners package **unsigned internal-QA only** executables. They test absolute PowerShell targeting, restricted child environment, injection-safe PowerShell string literals, unauthorized system-root rejection, duplicate/forged signed receipts, oversized HTTP response denial, timestamp ordering and Central readiness. They cannot simulate true UAC elevation, verify an Owner-owned Authenticode certificate, attest installer completion, guarantee identity survives real OS reboot or prove independent multi-PC failover. Full G0–G7 acceptance and physical Windows execution remain Owner-controlled production gates; this work never merges main or deploys anything.

## 24 November — restart evidence must remain unambiguous

A local `maintenance-release-*` file is a restart/reconciliation warning, **including**
an incomplete filename, interrupted write, or filename with changed capitalization.
The packaged Desktop's reconciliation barrier must not interpret those as "no
maintenance happened". A separately signed Owner restart grant does not authorize
ignoring conflicting release-like evidence. Exactly one canonical release receipt
and its matching archived maintenance hold must be verifiable; otherwise manual
restart is denied.

During inspection, the Desktop opens release/archive receipts as bounded file
descriptors and rechecks their on-disk identity after reading. A symlink,
replacement or raced write requires Owner review, **not deletion, renaming or
automatic retry**. Automated tests inject malformed release records and a
replacement during an open file read. These checks reduce local accidental/race
bypasses, but do not prove resistance to a compromised privileged Windows user
or power-loss durability; physical Windows and independent Owner acceptance
remain release blockers. Nothing here authorizes unattended installation,
automatic agent restart, Git publication or production promotion.
