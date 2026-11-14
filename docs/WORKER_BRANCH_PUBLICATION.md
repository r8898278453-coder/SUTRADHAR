# Worker branch publication — 8 November 2026

**Scope:** Docker-tested candidate → new remote worker branch.  
**Status:** Local Git bare-remote integration tested; **live GitHub push not performed**.
**Safety:** No host execution of model-generated code; no direct push to main,
no branch replacement/force push, and no automatic PR merge.

## Implemented

- `sandbox/push_tested_branch.py` receives the exact previously Docker-attested
  baseline Git SHA, patch SHA-256, candidate tree SHA and changed-file list.
- A temporary **bare Git repository with a separate index** fetches only the
  trusted baseline object; `git apply --cached` applies the patch to the index.
  The potentially untrusted code is never checked out or run on the host.
- Recomputed changed files must equal the attested file set and be within the
  ticket's whitelist. Symlinks, file-mode changes, protected paths and
  unexpected rename/delete behavior are rejected.
- The new Git tree must equal the **actual candidate tree that passed Docker**;
  mismatch stops publication. Both trusted checkout HEAD and remote `main`
  must still equal the tested baseline.
- `git commit-tree` creates **one child commit** of the Docker-tested baseline.
  The destination must be a previously nonexistent `ai/*` or approved
  `worker-*/ticket-*` branch, never `main`. The push is non-force; the
  server checks the resulting remote SHA before returning
  `PUSH_CONFIRMED_NOT_MERGED`.
- The production origin must match the configured
  `SUTRADHAR_GITHUB_REPOSITORY` exactly on github.com. A disposable local
  bare remote is allowed only by a direct Python test call, not by the HTTP
  endpoint/CLI.
- HTTPS credentials pass through a private `GIT_ASKPASS` helper, not command
  arguments, URLs or logs. Use isolated worker hosts and scoped GitHub tokens.
- `POST /api/cluster/ticket/push-tested-branch` is administrator-only and
  **OFF by default**; validates the current signed worker lease, epoch,
  revocation, unmodified patch, attested tested tree and kill switch.
- `verified_worker_pushes` records the branch, real commit, tree, baseline,
  worker, epoch and patch under a SQLite transaction and audit record. A
  changed or expired lease makes the result non-accepted, even if the remote
  push was completed; this case requires manual reconciliation.
- Draft PR creation **and final verified merge CAS** require the same exact
  persisted worker push receipt. They cannot use an unrelated remote branch.
- Dashboard flow is now: **Real Docker Test → Push Tested Branch → Create
  Draft PR → Human Review + CI → Verify GitHub Merge**.

## Setup

Provide these as server environment variables, not as a user-submitted API
body or committed files:

```bash
SUTRADHAR_TARGET_REPO_ROOT=/absolute/path/to/trusted-git-checkout
SUTRADHAR_GITHUB_REPOSITORY=owner/target-repository
SUTRADHAR_ENABLE_WORKER_PUSH=true
SUTRADHAR_GITHUB_PUSH_TOKEN="<fine-grained token: Contents read/write>"
SUTRADHAR_ENABLE_PR_CREATION=true
SUTRADHAR_GITHUB_PR_TOKEN="<separate fine-grained PR token>"
SUTRADHAR_REQUIRED_CHECKS="CI / tests;Python checks"
SUTRADHAR_MIN_GITHUB_APPROVALS=1
```

The checkout's **origin URL must match** the target GitHub repository, and its
HEAD must be exactly the commit that the Docker snapshot tested. The
publisher never takes a remote URL, GitHub token or branch override from
an HTTP request.

## Verification

```bash
python3 -m unittest discover -s tests -p 'test_tested_branch_push.py' -v
npm test
npm run test:sandbox-http
```

The Python tests create actual temporary Git repositories and a **local bare
remote**, then check: exact tree and parent SHA, no main mutation, no duplicate
branch overwrite, no scope escape, no dirty-workspace contamination,
main-change rejection and source-baseline-change rejection.

These prove real Git object/push behavior *locally*. GitHub authentication,
remote branch protection and a live target-project PR still require
separate owner-approved integration testing.

## Durable push reservations and crash recovery (10 November)

Worker pushes are reserved in SQLite **before** remote Git writes. The
`worker_push_jobs` table stores a unique reservation per ticket across
processes sharing the same SQLite database:

| State | Meaning | Automatic retry? |
| --- | --- | --- |
| `RUNNING` | One push may still be in progress | No |
| `NEEDS_RECONCILIATION` | Process failed, result unknown or five-minute reservation expired | No |
| `CONFIRMED` | Actual remote commit SHA verified, receipt saved atomically | No |

A timed-out reservation **never** automatically permits another push.

Administrator-only manual recovery endpoint:

```http
POST /api/cluster/ticket/reconcile-tested-branch
Content-Type: application/json

{"ticketId":"TKT-EXAMPLE"}
```

Requires administrator authorization, configured server-side Git credentials
and `SUTRADHAR_ENABLE_WORKER_PUSH=true`. It invokes the Python publisher in
`--inspect-only` mode. No Git writes occur during reconciliation.

- **Remote branch exists and exact commit parent/tree match:** recover the
  original pushed SHA only when the current signed lease/token/epoch and
  patch attestation also match. Mark CONFIRMED in the same SQLite transaction.
- **Remote branch absent and main still equals tested baseline:** clear the
  uncertain reservation. An administrator may separately issue a new push.
- **Wrong branch/tree, moved main, Git access failure, expired/revoked lease:**
  preserve the uncertain state for manual investigation; never claim merge.

If a remote branch changes after inspection, the process remains vulnerable
to a race; use protected branches, scoped credentials and trusted workers.
The recovery endpoint does not merge, force-push, rewrite history or
automatically retry a failed remote request.

## Known limitations and next steps

1. GitHub branch publication is feature-flagged and has **not been attempted
   against a real target GitHub repository** in this implementation slice.
2. An external actor racing a new branch before a push is detected before
   and after publication; fully atomic remote absent-ref creation is not
   guaranteed by the standard Git push protocol. Install server-side rules.
3. Push reservation and read-only crash reconciliation are durable in
   SQLite. A fully scheduled distributed worker queue, cancellation, lease
   reissue after human review and multi-process PR creation locks remain pending.
4. The PR/merge verifier is strict about single-commit branches, exact
   baseline and post-merge tested tree. It does not claim support for
   rebase, squash or unrelated main changes without fresh Docker tests.
5. Rotate the historically exposed signer, invalidate old leases, enable
   protected main rules, implement genuine revert-and-merge rollback,
   and test operational HTTPS authentication.

See [Implementation Tracker](./IMPLEMENTATION_TRACKER.md),
[GitHub PR Verification](./GITHUB_MERGE_VERIFICATION.md)
[8 November Implementation Log](./IMPLEMENTATION_LOG_2026-11-08.md)
and [10 November Crash Recovery Log](./IMPLEMENTATION_LOG_2026-11-10.md).
