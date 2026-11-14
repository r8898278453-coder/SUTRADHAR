# SUTRADHAR — Dependency Lockfile Review Gate

**14 November 2026 | Draft PR only | Not production accepted**

## Current implementation

- Root @google/genai was a floating **latest** dependency and has been pinned to **3.3.0** from previously tested Linux/Windows candidate builds.
- Desktop already pins Electron 45.3.1 and electron-builder 26.18.0.
- The review-only GitHub workflow **Dependency Lockfile Proposal (review-only)** generates root and Desktop npm v3 lockfiles and executes independent clean `npm ci --ignore-scripts` checks on Windows and Linux.
- The **check:dependency-locks** command verifies manifest-to-lock consistency, npm registry HTTPS resolution, recorded package integrity, and exact security-sensitive version pins.
- The Owner-protected Windows signing workflow requires **committed lockfiles** and independently rechecks them **before** `npm ci`. An unsigned QA build is not an approved installer.

## Owner-facing review (no terminal or credentials)

1. Open [Draft PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1) and its newest green **Dependency Lockfile Proposal** workflow. Open the artifact named **sutradhar-lockfile-candidate**. This is a proposal, **not a signed installer**.
2. Ask the independent reviewer to examine `package.json`, `package-lock.json`, `apps/desktop/package.json`, and `apps/desktop/package-lock.json`. The generated files should correspond to **exactly the source SHA that was reviewed**.
3. Reviewer checks direct dependency versions, known security advisories, unusual new packages, license obligations, external install scripts and any changes to the production runtime surface. A passing `npm ci` proves clean installation from the locks, not that the dependency set is free of vulnerabilities.
4. The engineer commits the **exact reviewed lockfiles** on the existing draft branch; rerun the same Linux and Windows CI checks against that commit and compare artifact checksums. No automatic dependency bot commit or privileged PR workflow is allowed.
5. Only after the Owner and independent QA review, and GitHub branch/environment protection exists, may the signing workflow use those committed locks. Lockfile approval **does not** approve Hostinger deployment, production installation or database migration.

## Current acceptance status

| Gate | Status |
| --- | --- |
| Pin previously floating AI SDK | **CODED**; exact version 3.3.0 |
| Generate candidate root/Desktop lockfiles | **CODED**, CI artifact |
| Clean Linux/Windows candidate installation | **CI job**; check exact latest commit run |
| Verify registry integrity and manifest pairing | **CODED**, included in CI/release flow |
| Independently review vulnerabilities/licenses | **NOT COMPLETE** |
| Commit reviewed root + Desktop lockfiles | **NOT COMPLETE** |
| Run actual signed release from protected environment | **BLOCKED** |

**Do not put the certificate private key, tokens or credentials in a candidate archive, issue comment or repository file.**

See [Owner provisioning](OWNER_PROVISIONING_RUNBOOK.md), [Production readiness](PRODUCTION_READINESS_V7_2026-11-12.md) and [Release operations](RELEASE_OPERATIONS.md).
