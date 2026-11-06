# Implementation Log — 7 November 2026 (IST)

**Project:** SUTRADHAR  
**Continuation branch:** `fix/p0-containment-2026-11-06`  
**Review PR:** [#1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1) (draft; main not merged)  
**Starting branch commit:** `7c353992aed5f25acf56988861b8eb49286685b0`

## Objective

Connect isolated **real Docker test evidence** to a verified **remote GitHub PR
merge**, without permitting artificial `COMMITTED_PUSHED` status or a direct
`main` push. Preserve the fail-closed rule while GitHub and review prerequisites
are not configured.

## Changes pushed

| Area | Files | Performed |
|---|---|---|
| Tested tree provenance | `sandbox/execute_ticket.py` | Record Git `write-tree` SHA of exact candidate before Docker. Keep complete safe source tree; reject tracked credential files instead of silently omitting them. |
| Durable sandbox attestation | `server_db.ts`, `server.ts` | New `sandbox_attestations` table; atomic `READY_FOR_REVIEW` + baseline commit, patch hash, changed files, tree SHA and worker/epoch evidence. |
| Authenticated worker leases | `server.ts`, `server_db.ts` | Issue real Ed25519 token when claiming a ticket, persist that exact token ID in SQLite, reject wrong/revoked/stale lease on merge confirmation. Re-verify lease identity/expiry inside final SQLite merge transaction. |
| Remote GitHub verifier | `github_merge_verifier.ts`, `server.ts` | Read-only GitHub REST verification of merged PR, correct repo/branch, single commit built on tested baseline, exact head and merge tree, whitelist, required Actions checks, independent approval and `main` ancestry. Never auto-merge. |
| Durable merge evidence | `server_db.ts` | New `verified_git_merges` table; final `COMMITTED_PUSHED` update requires atomic patch/epoch/token/lease attestation consistency and records real PR/SHA. |
| Disable unsafe merge | `core/merge_queue.py` | Reject legacy checkout/merge/push directly into `main`. Owners must use reviewed GitHub PR workflow. |
| Tests | `tests/github_merge_verifier.test.ts`, `tests/git_merge_attestation.test.ts`, `tests/test_merge_queue_guard.py` | Mocked-GitHub positive and denial cases, SQLite merge CAS negative tests, no-direct-main-push unit tests. |
| Operator documentation | `.env.example`, `docs/GITHUB_MERGE_VERIFICATION.md`, `IMPLEMENTATION_STATE.md`, `GAP_REGISTER.md`, `docs/IMPLEMENTATION_TRACKER.md` | Explicit configuration, status truth, release blockers and next steps. |

## Verification evidence

- Previous baseline of this branch: both push and PR GitHub Actions CI
  green for `7c353992aed5f25acf56988861b8eb49286685b0`:
  [PR CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/42260710768).
- Continuation adds deterministic **mocked-GitHub API** tests: missing
  independent approvals, wrong commit parent/tree, failed required checks,
  unmerged PR, wrong file scope, missing main ancestry, and transport failure
  all deny verification. These are *unit tests*, not live GitHub merge proof.
- New SQLite CAS tests verify accepted/rejected transitions, one-time recording,
  changed patch, stale epoch, pause, revoked/forged token. Real Docker suite
  remains separate and continues running in PR CI.
- Added `tests/github_merge_http_integration.test.ts`: test-only mocked GitHub REST responses drive the actual Express endpoint, including wrong-tree denial then signed-lease/SQLite CAS acceptance. This is not live GitHub evidence.
- [GitHub Actions #42283331008](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/42283331008) completed successfully with TypeScript typecheck, Node tests including mocked GitHub HTTP cases, real HTTP-to-Docker integration, Python sandbox/consensus tests and build.
- CI results apply only to the specific branch head tested by GitHub Actions;
  latest-head checks must be green before review.

## Not completed (release blockers)

1. A real target-project PR has **not** been automatically created or merged;
   live GitHub REST acceptance is **NOT RUN**. PR #1 is a draft for the
   SUTRADHAR code changes themselves, not an example ticket delivery.
2. Target-repo `SUTRADHAR_GITHUB_REPOSITORY`, token, required checks,
   approved reviewers and protected-main rules require owner provisioning.
3. The strict v1 verifier requires a **single-commit PR**, exact original
   baseline parent, matching post-merge tree, GitHub Actions check runs,
   and valid unexpired master-issued worker lease. More flexible PR models
   must not be accepted until separately threat-reviewed/tested.
4. Actual Git revert, verified rollback merge, durable DB-backed queue,
   worker-based PR creation and multi-worker credential lifecycle pending.
5. Historically exposed master signing key must be rotated and legacy tokens
   invalidated by the repo owner; no key rotation or history rewrite performed.
6. Production deployment, HTTPS smoke tests, demo seed cleanup, dependency
   lockfiles and PHP/Node-specific Docker image acceptance remain pending.

## Continuation: protected draft PR preparation (7 November)

- Added `github_pr_creator.ts`: read GitHub target `main`, validate
  already-pushed worker branch has one commit whose parent/tree match
  the Docker-tested attestation, and compare exact changed file list.
- Only after those checks, call GitHub's **draft PR creation** endpoint;
  never push, overwrite a branch or auto-merge. Equivalent existing open draft
  PR is returned idempotently; changed branch, moved base or extra files fail closed.
- Added `draft_pr_submissions` SQLite table and atomic CAS method checking
  current worker token ID, revocation, lease expiry, epoch and patch hash.
  Ticket stays `READY_FOR_REVIEW` after PR submission.
- Added administrator-only, off-by-default
  `POST /api/cluster/ticket/create-draft-pr` endpoint; separate GitHub
  PR-write token from read-only merge verification token.
- React DAG and sandbox console now have separate Create Draft PR and
  Verify GitHub Merge controls. Misleading Git Push label removed.
- Added `tests/github_pr_creator.test.ts`,
  `tests/draft_pr_http_integration.test.ts` and draft-PR SQLite CAS tests
  in `tests/git_merge_attestation.test.ts`.
- **Not executed live:** No target-repo branch was pushed or draft PR created
  in this work slice. Controlled REST fixtures are test-only; GitHub Actions
  results must be checked for the final commit SHA.

## Next step

Test an authorized target-repo PR against **live** GitHub read-only
verification. Then implement owner-controlled PR creation/push integration,
Git revert through reviewed PR and release readiness tests. No automatic
merge, force push, or token material should be committed.

References: [Tracker](./IMPLEMENTATION_TRACKER.md) ·
[GitHub verification](./GITHUB_MERGE_VERIFICATION.md) ·
[Docker execution](./SANDBOX_EXECUTION.md).
