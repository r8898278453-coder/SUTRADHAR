# SUTRADHAR — Rollback Crash Reconciliation Implementation Log
**Date:** 11 November 2026  
**Branch:** `fix/p0-containment-2026-11-06`  
**Review:** [Draft PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1)  
**Starting SHA:** `fd2a9aca59839446a1fbb3abaa55a29361690b2c`  
**Scope:** Recover uncertain remote branch / draft PR evidence. **No live target GitHub push, PR creation or merge executed.**

## Delivered

- `sandbox/prepare_rollback.py`: new `inspect_rollback_for_recovery`
  and `--inspect-only` entry point. It checks the exact remote main SHA,
  original merge first-parent, original tested merged tree, complete file
  scope, rollback commit's single parent and its restored baseline tree.
  Uses a temporary **bare Git repository** with no executable checkout.
  If a branch exists, it **re-runs actual isolated Docker tests** on the
  exact remote branch tree before accepting evidence; wrong tree, missing
  Docker marker or nonzero test exit reject. Rechecks both remote refs.
- `github_rollback_reconciler.ts`: read-only GitHub API inspector; only
  GET calls. Verifies remote main, rollback branch SHA, commit parent/tree,
  one-commit diff, exact changed files and a unique open **draft** PR tied
  to the correct source repository, target repository, PR head and base.
  Fork/conflicting, closed, incomplete or ambiguous responses require review.
- `server_db.ts`: non-destructive schema migration adding
  `recovery_token` and `recovery_started_at` to rollback proposals.
  `reserveRollbackReconciliation` holds a unique SQLite fenced
  recovery lock, with a six-minute stale-operation threshold. It rejects
  concurrent recoveries across independent SQLite connections, wrong epoch,
  kill switch, changed original patch, or missing original verified merge.
  `finishRollbackReconciliation` CAS permits only three outcomes:
  - `ABSENT`: remote rollback branch **and PR** both absent, original
    main still matches, and no prior branch receipt exists; deletes only
    the uncertain reservation, permitting a **separate explicit** prepare.
  - `BRANCH_PUSHED`: existing exact branch re-Docker-tested and independently
    confirmed by GitHub; saves the original pushed SHA/tree, but no PR/merge.
  - `DRAFT_PR`: same proven branch plus unique exact draft PR; saves
    PR number with original SHA and baseline tree.
  Replays, mismatched reservation/recovery tokens and stale epoch fail.
- `server.ts`: new authenticated, off-by-default
  `POST /api/master/rollback/reconcile` orchestration. The request
  accepts only the ticket ID; repository, branch, test command and
  credentials come from trusted server configuration and SQLite. It
  **never** invokes Git push, PR POST or GitHub merge. On failure it
  leaves the proposal uncertain, not completed.
- Dashboard: distinct **Reconcile Uncertain Rollback** control with
  truthful absent, recovered branch and recovered draft PR responses.

## Verification performed

- `tests/test_rollback_pipeline.py`: real disposable local Git remote
  test of absent branch, exact rollback parent/tree, Docker-retest evidence,
  failed Docker, untrusted branch and advanced main.
- `tests/github_rollback_reconciler.test.ts`: mocked authenticated
  read-only GitHub REST GET tests, including changed SHA/tree, wrong PR,
  closed/forked/duplicate PRs, incomplete/out-of-scope changes, main advance
  and provider failure. No write is permitted by the test fetcher.
- `tests/git_merge_attestation.test.ts`: real SQLite CAS with recovery
  token fencing, two independent DB handles, six-minute timeout, forged
  token denial, absent/branch/PR state restoration and kill switch.
- `tests/rollback_http_integration.test.ts`: verifies anonymous,
  disabled and missing-config HTTP recovery rejection.
- Real Docker integration runs in the existing CI Python job for
  rollback preparation **and read-only crash recovery**. The recovery
  test first creates a real local rollback Git branch, then invokes
  `inspect_rollback_for_recovery` without a test stub so the restored
  tree is actually tested inside Docker. This does not verify live GitHub.
- All GitHub API proof tests use **mocked REST responses**, not a live
  target-project PR. Cite the latest exact-head Actions jobs after final
  documentation changes; an older green run does not verify a later commit.

## Intentionally blocked

- A remote branch or PR whose ownership, SHA, tree or parent differs is
  not considered recovery evidence.
- A remote main that advanced beyond the original merged SHA blocks
  automatic recovery. No rebase/cherry-pick/force-push support.
- An external branch may change after read-only verification; there is
  **no atomic remote absent-ref lock**. GitHub branch protection and scoped
  credentials are required in production.
- A PR that is already non-draft/merged or whose source was deleted is
  deliberately left for manual GitHub review rather than inferred.
- No automatic external write is performed as part of crash recovery.
  The administrator must separately request a new prepare or PR creation.
- Production live GitHub acceptance, previously leaked signer rotation,
  HA multi-node operations and rollback of non-tip merges remain pending.

See [Verified Rollback Pipeline](./VERIFIED_ROLLBACK_PIPELINE.md),
[Implementation Tracker](./IMPLEMENTATION_TRACKER.md) and
[Gap Register](../GAP_REGISTER.md).
