# SUTRADHAR — Reviewed dependency lockfile gate

**Updated 15 November 2026 | Draft PR #1 | Not a production-release approval**

## Current facts

- Root package-lock.json and apps/desktop/package-lock.json are committed to the draft feature branch.
- CI validates their npm v3 structure, manifest pairing, HTTPS npm registry origins and per-package integrity fields before installing any packages.
- Windows and Linux run clean npm ci directly from these committed source files. The previous temporary artifact generator has been replaced in automated checks; the old candidate artifact remains as historical bootstrap evidence.
- The signed release workflow requires the same locks and a zero-high/critical-advisory npm audit result, plus an authorized certificate, Owner approval and exact stable tagged commit.
- A disposable MySQL 8 CI job now proves the encrypted backup and empty staging restore with real database records, but no Hostinger data was accessed.

## Candidate provenance

| File | Nonroot packages | SHA-256 of exact committed candidate |
| --- | ---: | --- |
| package-lock.json | 348 | 14fd124ae3ae40fbd0b516ba8b01fb7372eab31c62719cd7eea600c41f68722a |
| apps/desktop/package-lock.json | 283 | b4d305eb2abde14ddc42142391c3f7e528ef0a5af55cdc1ab140ec84c727c1d9 |

**Dependency pins:** @google/genai 3.3.0, Electron 45.3.1 and electron-builder 26.18.0. These are exact direct-dependency pins; transitive packages are pinned in the npm integrity lockfiles. Passing CI is not equivalent to an independent vulnerability review.

## Independent reviewer / Owner checklist

1. Open [Draft PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1), review exact source lockfile changes and latest [GitHub Actions](https://github.com/r8898278453-coder/SUTRADHAR/actions).
2. Examine new direct/transitive packages, lockfile registry domains, integrity hashes, npm lifecycle scripts, license obligations and relevant security advisories. Confirm trusted Electron support and exact SDK/API compatibility.
3. Compare the lockfile SHA-256 values shown above with a fresh downloaded copy from the reviewed commit. Re-run Linux and Windows clean npm ci on exact approved SHA.
4. Require a second independent GitHub review under main branch protection. No Owner-held Windows signing private key should be available to an unreviewed PR job.
5. Treat any later dependency or lockfile change as requiring a fresh audit and exact reviewed commit, not an automatic release.

## Acceptance status

| Gate | Status |
| --- | --- |
| Committed npm locks + manifest/integrity validation | CODED / CI-VERIFIED |
| Windows/Linux clean install + security/regression tests | CI-VERIFIED on the exact checked commit |
| Independent known-vulnerability, license and supply-chain approval | NOT APPROVED |
| Signed production installer with protected certificate | NOT RUN |
| Live Hostinger backup/restore, multi-PC acceptance and approved release | NOT RUN |

See [Owner provisioning](OWNER_PROVISIONING_RUNBOOK.md), [Production readiness](PRODUCTION_READINESS_V7_2026-11-12.md) and [Release operations](RELEASE_OPERATIONS.md).
