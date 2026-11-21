# SUTRADHAR — Implementation Log, 10 November 2026

**Working branch:** `fix/p0-containment-2026-11-06`  
**Starting branch commit:** `f4bad932770eda847533917859803b4ff1d61045`  
**Review:** [Draft Pull Request #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1)  
**Release status:** Partial — not production ready. No merge into main.

## Objective

Close a high-risk crash/retry gap in the tested worker-branch publisher.
Previously the server held only a JavaScript in-memory lock. If a remote push
succeeded but the Node process exited before SQLite evidence was written, a
subsequent request could mistake the branch for a fresh job. The new design
persists the reservation **before** external Git side effects and refuses
blind retries.

## Changes

| Area | Implemented | Verification |
| --- | --- | --- |
| `server_db.ts` | `worker_push_jobs` table with unique ticket reservation, owner token/epoch, tested tree/patch, explicit `RUNNING`, `NEEDS_RECONCILIATION`, `CONFIRMED` states | SQLite contention, crash expiry, forged reservation, reconciliation and idempotency tests |
| `server.ts` | Request for branch push first acquires `BEGIN IMMEDIATE` DB reservation; error/missing process evidence becomes `NEEDS_RECONCILIATION`. Receipt and CONFIRMED state are atomically recorded. | Existing auth/HTTP guards plus reservation/SQLite tests |
| `server.ts` | New admin-only `POST /api/cluster/ticket/reconcile-tested-branch`, off unless worker push feature enabled | Unconfigured HTTP route denial; real local Git remote inspection tested separately |
| `sandbox/push_tested_branch.py` | Read-only `--inspect-only` mode compares remote main SHA, remote worker commit parent and exact tree; never pushes or merges | Actual temporary local bare Git remote: absent, matching and mismatched branch outcomes |
| `tests/git_merge_attestation.test.ts` | Simulate concurrent processes by independent DB handles; require stored reservation before any worker push receipt | Node SQLite tests |
| `tests/test_tested_branch_push.py` | Verify read-only Git reconciliation with real on-disk bare remotes | Python Git tests |
| `tests/tested_branch_http_guard.test.ts` | Ensure reconciliation remains off without configured protected credentials | HTTP auth tests |
| `src/App.tsx` + DAG + Sandbox console | Administrator `Reconcile Push` action displays recovered/absent/blocked states; no auto-retry | TypeScript build |
| `docs/WORKER_BRANCH_PUBLICATION.md` | Document exact state transitions, explicit retry policy, limitations, and operator recovery | Documentation |

## Crash/retry behavior

1. Before a push starts, the server reserves a single worker-push job under
   `BEGIN IMMEDIATE`, checking the tested patch, ticket owner, current signed
   token, lease, epoch, kill switch and absence of a prior push receipt.
2. A concurrent request or another server process is denied by the same
   SQLite reservation (not an in-memory Set).
3. A push attempt that fails or yields ambiguous output is quarantined as
   `NEEDS_RECONCILIATION`. It is **not** retried automatically.
4. A job that was `RUNNING` and has exceeded its 5-minute processing
   window transitions to `NEEDS_RECONCILIATION`. Expiry is **not** a grant to
   run a second push.
5. An authenticated administrator explicitly calls the reconciliation route:
   - **Remote branch exists and parent/tree match:** accept only if the
     current ticket, epoch, worker lease and attestation still match; then
     persist the original verified SHA and mark `CONFIRMED` atomically.
   - **Remote branch absent, remote main still tested baseline:** clear the
     uncertain reservation, allowing a **separate explicit** push request.
   - **Wrong branch/tree, Git unavailable, moved main or expired/revoked lease:**
     no ticket success; keep for manual investigation/lease renewal.
6. Neither endpoint merges a PR, pushes to main, rewrites history or labels
   a ticket `COMMITTED_PUSHED`.

## Verification boundaries

- Git tests use real Git on **local bare remotes**, not live GitHub.
- REST tests for PR/merge remain mocked GitHub response fixtures.
- Real Docker sandbox checks continue in GitHub Actions.
- No live target-repository worker push, production deployment, credential
  rotation, GitHub PR merge or Git revert was performed in this slice.
- A remote branch may change after a read-only inspection. The existing
  non-force push and post-push SHA check mitigate this but do not replace
  GitHub branch protections; production deployment needs further integration.

## Continuation — human-review-safe GitHub merge verification

The existing short worker execution token previously expired (or was
watchdog-revoked) during a GitHub human review, and both the live verifier
and dashboard had coupled the final merged state to that stale worker lease.

- `server_db.ts`: added `merge_verification_grants` with exact registered
  repository, PR number, already pushed head SHA, candidate Git tree,
  patch hash, epoch, 15-minute expiration and consumed timestamp.
- Only an authenticated administrator may issue or explicitly reissue a
  read-only proof-verification grant. A grant **never** extends, unrevokes or
  replaces the worker's execution token. A previously explicitly revoked
  worker token remains blocked as bad provenance.
- The final merged-state SQLite CAS requires the correct current, unconsumed
  grant plus the tested Docker tree, verified worker push receipt, registered
  PR/head, original token-revocation status, live epoch, patch hash and
  inactive kill switch. It consumes the grant atomically with the
  `COMMITTED_PUSHED` transition and actual merged commit SHA.
- `server.ts`: added admin-only
  `POST /api/cluster/ticket/authorize-merge-verification`; the existing
  `verify-push` route is now independently gated by the grant and actual
  GitHub REST evidence, not an expired worker lease.
- `github_merge_verifier.ts`: expected exact registered GitHub PR number
  and pushed head SHA are now mandatory in the server's verification call.
- `server_db.ts` + `server.ts` watchdogs: preserve
  `READY_FOR_REVIEW`, `COMMITTED_PUSHED` and `ROLLBACK_REQUESTED`
  tickets when the *worker execution lease* expires. Expired workers
  cannot act again; manually cancelling tickets still blocks review proof.
- `src/App.tsx`, DAG and Sandbox Console: separate
  **Authorize Merge Check** and **Verify GitHub Merge** actions.
- Tests: exact PR/head mismatch, stale/mismatched/consumed admin grants,
  explicit token revocation, watchdog lease expiry preserving review,
  and the real Express endpoint with deterministic mocked GitHub REST
  evidence; no live target-repo merge is claimed.
- Manual lease revocation now also revokes its token ID and cannot reset
  `COMMITTED_PUSHED` or rollback-tracking tickets to `PENDING`; security
  regression tests cover both cancelled review and completed merge.
- [Human Review Authorization Guide](./HUMAN_REVIEW_AUTHORIZATION.md)
  documents setup, operator steps, constraints and safety boundaries.

**Validation:** GitHub Actions code-check jobs passed for implementation
commit `e003d5c17503a3e64868226544f1f9e70fb70753`
([run #42700720219](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/42700720219)).
Later documentation/UI commits require fresh current-head CI.

## Continuation — actual Docker-tested revert and reviewed rollback PR

- Added `sandbox/prepare_rollback.py`, a strict real Git object workflow
  that verifies the original GitHub merged commit remains the exact remote
  `main` HEAD. A 1- or 2-parent merged commit must have first parent equal
  to the original tested baseline. Every changed file must exactly match
  the Docker-attested ticket whitelist. No host checkout of generated code.
- A disposable bare Git index restores the original first-parent tree.
  This tree is extracted with the safe Git-archive rules and retested by the
  hardened **real Docker** runner. Without a real container test start marker
  and exit 0 the rollback branch is **never pushed**.
- When Docker passes, a single revert-equivalent Git commit (parent is the
  original merged SHA, tree is the original baseline tree) is pushed by a
  non-force refspec to `rollback/<ticketId>`, never `main`.
  The exact remote branch SHA is confirmed.
- `server_db.ts`: `rollback_proposals`, `verified_git_rollbacks` and
  atomic ticket reservation/CAS for branch, PR and remote completion.
  Uncertain side effects require manual reconciliation; no blind retry.
- `server.ts`: admin-only, off-by-default rollback prepare and draft PR
  endpoints, and read-only GitHub merged rollback PR verification. The
  verifier checks exact registered PR number/head, required CI, independent
  GitHub approval, main ancestry and the full restored tree, then saves
  `ROLLBACK_COMPLETED` transactionally.
- `src/App.tsx` / DAG: explicit three-stage rollback actions. Removed
  misleading one-click “Execute Revert & Auto-Spawn Hotfix” message.
- Regression tests: real disposable Git remote commit/tree restoration,
  main unchanged, scope mismatch, advanced main and duplicate branch denial;
  failed Docker never pushes. GitHub Actions runs the restored tree through
  a **real Docker** test stage. Real Express+SQLite rollback HTTP tests use
  controlled **mock GitHub REST** proof for absent merge, wrong tree,
  missing approval and accepted PR.
- [Verified rollback operator guide](./VERIFIED_ROLLBACK_PIPELINE.md)
  describes configuration, strict preconditions and P0 acceptance gaps.

**Live target GitHub rollback PR merge was NOT performed.** Real local Git
and Docker tests are not a substitute for owner-approved live acceptance.

## Remaining priorities

P0: rotate leaked master signer, revoke old tokens, owner-approved live
GitHub forward/rollback live acceptance and rollback crash reconciliation. P1: distributed PR
creation reservation, external operator/CI integration of administrator
proof grants, multi-host worker coordination, real provider credentials /
branch protection, production dashboard truthfulness, language-specific
images and dependency lockfiles.

**CI evidence:** Consult the Actions runs attached to the final commit SHA;
do not infer it from older green commits.

References: [Implementation Tracker](./IMPLEMENTATION_TRACKER.md) ·
[Worker Publication](./WORKER_BRANCH_PUBLICATION.md) ·
[GitHub Verification](./GITHUB_MERGE_VERIFICATION.md).
