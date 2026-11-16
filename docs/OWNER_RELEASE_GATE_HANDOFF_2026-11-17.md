# SUTRADHAR v7 — Owner release-gate handoff (17 November 2026)

**Decision: HOLD. Draft PR #1 only; no production deployment, release signing, installer execution, or merger approval.**

This checklist is the handoff from coded safeguards to **real-environment acceptance**. A passing GitHub build is not evidence that Hostinger, Windows certificates, or physical PCs work. The current branch head before this document was `367dc9124ea5fcba1b8e3ad2e38601ce98f3b32c`; its two PR-triggered workflows completed successfully (SUTRADHAR CI run 43742582888, Dependency Lock Integrity run 43742582887). All future approval requires new CI on the exact subsequently approved head.

## Gate ledger — do not promote based on self-reported PASS

| Gate | Current disposition | What an independent reviewer must inspect | Approval authority |
| --- | --- | --- | --- |
| G0 source + CI | SCOPED CI PASS at prior SHA; new HEAD pending | Exact immutable commit, all relevant Actions jobs, lockfile/advisory results, dependency license review, PR review | Owner + independent QA |
| G1 Hostinger staging | BLOCKED — no live evidence | Separate HTTPS staging domain, isolated MySQL, deployment log, deployed source SHA, read-only `ops:hostinger-preflight` receipt | Owner |
| G2 database recovery | BLOCKED — only disposable CI MySQL test | Encrypted export stored outside repo, verification, approved empty staging restore, record-by-record validation, measured recovery time | Owner + DBA |
| G3 Windows trust | BLOCKED — no certificate or stable tagged release | Real certificate identity, protected signing runner, Authenticode validated exact installer, verified signed offer scoped to pilot PC IDs | Owner + signer |
| G4 OS key continuity | BLOCKED — no physical Windows proof | Windows install/restart, DPAPI identity continuity, enrollment ambiguity, second-launch and tampering regression, distinct PC identities | Owner + QA |
| G5 role/failover | BLOCKED — no physical PC proof | Two-PC then three-PC then eight-to-ten-PC snapshots, 60-second signed heartbeats, sticky Master and 08:00 IST initial election, exactly-once epoch failover | Owner + QA |
| G6 update/rollback safety | BLOCKED — inspection-only, no installer execution | Durable drain fencing, external Git reconciliation, isolated wave signed install, post-install signed heartbeat, safe rollback, unchanged identity | Owner + independent QA |
| G7 go-live | BLOCKED | Owner-approved immutable Central and Desktop releases, documented MySQL migration/restore, independent security review and no unresolved P0 | Owner |

**Never treat a checklist mark, receipt JSON, test database, or CI environment variable as production authorization.** Keep protected production deployment ref unchanged. Do not expose credentials in PR comments, screenshots, logs, or this document.

## Exact sequence for the Owner (no coding required)

1. **Open [PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1)** and leave it in Draft. Inspect checks for the latest SHA. Do not click Merge or connect this branch to the production Hostinger site.
2. **Provision a separate Hostinger staging website and dedicated empty staging MySQL** using [the Owner provisioning runbook](OWNER_PROVISIONING_RUNBOOK.md). Record the staging domain and deployment source SHA privately. Secret values remain inside hPanel, not chat or Git.
3. **Ask an operator to run the read-only staging preflight** at the exact deployed SHA: `SUTRADHAR_STAGING_URL` and `SUTRADHAR_EXPECTED_COMMIT_SHA`; command `npm run ops:hostinger-preflight`. Retain receipt, Hostinger logs and MySQL readiness evidence. This does not apply schema or deploy.
4. **Rehearse encrypted backup and restore against disposable staging ONLY** per [production-readiness instructions](PRODUCTION_READINESS_V7_2026-11-12.md). Require source/target DB distinction, independent restored data checks, restoration time and Owner approval; never restore over a live production database.
5. **Obtain and protect a legitimate Windows Authenticode certificate and separate Ed25519 update signing keys** using a protected release signer. Do not send private keys to the assistant or commit them. Release script currently refuses alpha; do not bypass this.
6. **Test an isolated first physical Windows PC**, then 2-PC, 3-PC, and 8–10-PC scenarios. Collect real timestamps, distinct node IDs (redacted in public reports), signed role observations, failover epochs, task/checkpoint recovery and Owner-confirmed Git reconciliation.
7. **Independently review G0–G7**, upgrade PR from Draft only when approved, and explicitly authorize Central and Desktop promotions separately. A failed gate returns to HOLD; no automatic workaround.

## Evidence index template (private Owner register)

Create a separate access-controlled record for each gate. Minimum fields:
`gate_id`, `status` (BLOCKED / PASS / FAIL), `reviewer`, `reviewed_at_utc`, `exact_git_sha`, `environment` (ci / stage / physical-windows), `evidence_location`, `evidence_sha256`, `test_case_ids`, `limitations`, `owner_approval_reference`.

The evidence register is **not** a credential store. Prefer file hashes and private reference links; keep API keys, signing secrets, raw device keys and database passwords outside all evidence records. A gate PASS must name the actual environment and human reviewer. Expired/stale evidence must be reevaluated after changing installer, schema or commit.

## Explicit outstanding engineering work

- Stable reviewed release, Windows verified installer execution guard and protected signed rollout distribution.
- Versioned safe MySQL migrations and actual Hostinger staging plus owner-owned restore rehearsal.
- Reliable identity-preserving installer/update/rollback, post-install health and recovery path.
- Provider-compliant browser worker, full external-Git side-effect reconciliation, physical concurrency/failover and all 71 acceptance cases.

References: [current readiness](PRODUCTION_READINESS_V7_2026-11-12.md), [release operations](RELEASE_OPERATIONS.md), [PC drain fence](PC_DRAIN_FENCE_V7.md), [acceptance matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md).
