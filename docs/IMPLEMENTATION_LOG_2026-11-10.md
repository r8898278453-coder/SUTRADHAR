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

## Remaining priorities

P0: rotate leaked master signer, revoke old tokens, owner-approved live
GitHub acceptance, verified Git revert rollback. P1: robust authorization
renewal across human review, distributed PR creation reservation, real
provider credentials/branch protection, production dashboard truthfulness,
language-specific images and dependency lockfiles.

**CI evidence:** Consult the Actions runs attached to the final commit SHA;
do not infer it from older green commits.

References: [Implementation Tracker](./IMPLEMENTATION_TRACKER.md) ·
[Worker Publication](./WORKER_BRANCH_PUBLICATION.md) ·
[GitHub Verification](./GITHUB_MERGE_VERIFICATION.md).
