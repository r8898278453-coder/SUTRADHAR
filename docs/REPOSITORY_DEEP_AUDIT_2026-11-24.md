# SUTRADHAR — Repository deep audit and gap register (24 November 2026)

**Status: source remediation under review; production RELEASE HOLD.**
**Branch audited:** \`fix/p0-containment-2026-11-06\`, unmerged Draft PR #1.
**Starting source snapshot:** \`dac84ae30ef83a6ec9b40fbd7b7e1313a2bc3337\`.
Check [Draft PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1)
and the three GitHub Actions workflows on its **exact current HEAD** to
determine the final source-level outcome. Earlier green runs do not
authorize a later commit.

## Method, actual coverage and limitations

The GitHub connector returned the complete recursive starting Git tree
(420 entries, not truncated). Reviewed architecture docs, root and
per-application packaging, CI/release policy, Central/MySQL election,
nonce/heartbeat, tasks and QA, GitHub provenance/review/merge/rollback,
Desktop OS vault, worker local Git execution, QA handoff, installer
recovery evidence, four developer CLI journals, key security helpers,
representative tests and recorded workflow logs. Read-only inspection
of GitHub main branch metadata returned \`protected:false\`.

**Scope limit:** A complete tree inventory and targeted security review
are **not** a line-by-line audit of every file, a pentest, an independent
human source review, a production schema audit or a real 8–10-PC test.
Fixture-based REST GitHub and disposable MySQL evidence remains distinct
from a real protected target repository and real Hostinger. Nothing was
merged, deployed, signed, installed or run against live Owner infrastructure.

## System boundaries confirmed from current source

| Boundary | Actual reviewed source | Trust and release constraint |
| --- | --- | --- |
| Hostinger Central | \`v7/central.ts\`, \`v7/schema.sql\`, \`apps/central/build.cjs\` | MySQL/HTTPS Central is sole v7 authority; the build is \`ALPHA_UNAPPROVED\` |
| Windows/Desktop | \`apps/desktop/main.cjs\`, \`os-vault.cjs\`, worker/QA/maintenance modules, \`apps/desktop/package.json\` | Electron MAIN-only OS credential signer; unsigned CI package is QA-only |
| Cross-platform | \`packages/shared/contract.json\`, \`v7/rules.ts\`, separate Central/Desktop build scripts | One monorepo, two distinct applications, no permanent product branches |
| Developer legacy | root \`server.ts\`, \`server_db.ts\`, \`core/\` Python/SQLite, developer-only V7 CLI | Explicitly **not** production Central or Windows OS-vault authority |
| Protected release | \`.github/workflows\`, Owner runbooks, release scripts | CI verifies committed source, not protected reviewer/signing/deployment or physical acceptance |

## Findings repaired in this review (code-level, not production accepted)

| ID | Priority | Verified source gap | Remediation / tests |
| --- | --- | --- | --- |
| DA-P0-01 | P0 | Four developer CLI one-shot worker journals could mistake dangling entries for absent or race a path-based read, risking a new request ID after ambiguous outcomes | \`v7/journal_file.ts\`; applied to claim/checkpoint/renew/submit; \`tests/v7_worker_journal_file.test.ts\` |
| DA-P0-02 | P0 | Malformed latest GitHub review could silently disappear and allow earlier exact-head APPROVED vote to count | \`v7/github_review_policy.ts\` requires every returned review to be valid; negative \`tests/v7_pr_review.test.ts\` |
| DA-P0-03 | P0 | GitHub provenance clients used some unbounded \`response.json()\` and lacked explicit no-redirect response policy | Bounded 256-KiB fatal-UTF-8 GET/Owner Draft PR transport \`v7/github_api_json.ts\`; applied to remote, PR review, Draft PR creator, merged-PR verifier and rollback lookup; tests |
| DA-P0-04 | P0 | Exact-head PR readiness and merged-DONE verifier could report success without independently requiring GitHub target main protection metadata | \`v7/pr_review.ts\` and \`github_merge_verifier.ts\` now refuse missing/\`protected:false\`; unit, legacy HTTP and disposable MySQL fixtures |
| DA-P0-05 | P0 | Parent scope \`src\` could authorize nested \`.env\`, Git metadata, npm build/config files if only scope strings or prefix containment were checked | \`v7/rules.ts\`, actual paths in \`v7/git_remote.ts\`, PR review/Draft PR/merge evidence, and shared packaged Desktop worker claim/submit/QA history policy. Scoped rollback is separate and still human-reviewed |
| DA-P1-01 | P1 | Backup selection accepted an implausibly future-dated heartbeat candidate unlike Master policy | \`v7/rules.ts\` backup timestamp tolerance matched to bounded future clock check |
| DA-P1-02 | P1 | Detached installer liveness diagnostic witness could be swapped during pathname read | \`maintenance-installer-persistent-observer.cjs\` uses existing bounded stable Desktop descriptor reader; witness is **always unsigned diagnostic, never install-completion evidence** |
| DA-DOC-01 | P1 | Root legacy codebase/status docs still claimed v7 was merely specified although a separate v7 alpha codebase/builds exist | Updated current-vs-historical notices in \`CODEBASE_MAP.md\` and \`IMPLEMENTATION_STATE.md\`, linked this audit |

A release claim for any row still requires successful CI on the **exact**
candidate commit, external reviewer evidence and, where applicable,
physical/Hostinger verification. Even when tests pass, "code-level
fix" does not mean "real-world accepted".

## Still open or blocked — **not fixed by this review**

| Gate | Severity | What is missing | Owner/developer next evidence |
| --- | --- | --- | --- |
| G0 | Critical | GitHub \`main\` is reported **unprotected**; effective rules, bypass actors, independent human reviews and signing-environment restrictions are not established | Owner configures protection + nonbypassable review/CI in GitHub Settings; independent read-only audit and human review |
| G1 | Critical | No real isolated Hostinger staging deployment confirmed | Owner provisions staging HTTPS Node.js app, reviewed deployment source and exact SHA |
| G2 | Critical | No off-host/independent real staging MySQL backup→empty-restore evidence | Separate restricted restore credential and signed Owner restore proof |
| G3 | Critical | No legitimate production Windows Authenticode signer/Owner environment approval | Certificate custody, protected approvals and reproducible signed installer validation |
| G4–G5 | Critical | No observed physical 2-PC, 3-PC, and 8–10-PC signed heartbeat, sticky Master and backup failover acceptance | Independently captured node/device receipts and failure injection on separate PCs |
| G6 | Critical | No real signed update, reboot/crash, owner-held failure recovery and rollback proof | Owner-controlled signed update/rollback and power-loss test on staging PCs |
| G7 | Critical | No independent source/release approval, final acceptance of 71 test scenarios, or explicit production authorization | Owner signoff only after the above proof and exact-head CI/reviewer acceptance |
| Other | High | Legacy SQLite/Python and demo/prototype flows still in tree; provider/browser execution, Telegram parity, Python dependency review and hosting load budgets not live accepted | Keep legacy out of production bundle; verify in controlled staging before claims |

See [GAP_REGISTER.md](../GAP_REGISTER.md),
[requirements/71-case matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md),
[Owner provisioning](OWNER_PROVISIONING_RUNBOOK.md) and
[Owner release-gate handoff](OWNER_RELEASE_GATE_HANDOFF_2026-11-17.md).

## Explicit stop rules

1. Do not merge Draft PR #1, tag a release, connect the fix branch to
   Hostinger, sign/publish an installer, or install unsigned QA artifacts.
2. Do not set G0–G7 PASS from simulations, unit tests or disposable CI.
3. Do not add credentials, private signing material, device identities or
   personal PC inventory to this repository, chat or PR.
4. On any failed exact-head CI job, retain HOLD, inspect actual failure
   logs, fix it only on the existing fix branch and re-run exact-head CI.
