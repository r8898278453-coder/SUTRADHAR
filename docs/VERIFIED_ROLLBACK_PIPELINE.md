# Verified GitHub rollback pipeline — 10 November 2026

**Status:** Code and regression tests on draft fix branch. This guide documents
a reviewed rollback workflow, not an executed production revert.

## Security boundary

A rollback is **not** complete just because an administrator requests it,
a Git branch exists or a draft pull request is created. The only completion
event is authenticated read-only GitHub evidence proving that the rollback
PR was independently approved, passed required CI and merged into
`main` with the **exact restored baseline Git tree**.

No SUTRADHAR route pushes to main, force-updates a ref or merges a PR.

## Preconditions

- Original ticket status `COMMITTED_PUSHED` must have been recorded from
  independently verified GitHub merged-PR evidence, not seeded fixtures.
- `verified_git_merges` and `sandbox_attestations` must agree on the
  original merged commit, tested Git tree, worker/epoch and patch hash.
- The original merged commit must still be **the current remote main HEAD**.
  If main advanced since the merge, this implementation **fails closed**
  rather than reverting unrelated subsequent changes.
- The original merge must have one parent (squash/linear merge) or two parents
  (ordinary GitHub merge), and its **first parent must equal the tested
  baseline commit**. Octopus or rebase/multi-commit PRs are not supported.
- The complete changed-file list between first parent and original merge
  must be exactly the Docker-attested changed files, and all files must
  remain within the original ticket whitelist. Symlinks, renames, mode
  changes and protected paths are rejected.

## Deployment configuration

Server environment, not browser request body:

```bash
SUTRADHAR_ENABLE_ROLLBACK=true
SUTRADHAR_TARGET_REPO_ROOT=/trusted/target-checkout
SUTRADHAR_GITHUB_REPOSITORY=owner/target-repo
SUTRADHAR_SANDBOX_TEST_COMMAND="python3 -m pytest -q"
SUTRADHAR_GITHUB_ROLLBACK_TOKEN="<fine-grained Contents read/write token>"
SUTRADHAR_GITHUB_PR_TOKEN="<separate Pull requests write token>"
SUTRADHAR_GITHUB_TOKEN="<read-only Contents/Checks/PR token>"
SUTRADHAR_REQUIRED_CHECKS="required CI check name;second required check"
SUTRADHAR_MIN_GITHUB_APPROVALS=1
```

The feature is **off by default**. Never put these credentials in Git, ticket
patches, the dashboard or a response. Configure protected main and required
CI/review rules independently in GitHub.

## Administrator workflow

1. Request `POST /api/master/rollback` with `{"ticketId":"...","reason":"..."}`.
   Status becomes `ROLLBACK_REQUESTED`. **No Git mutation yet.**
2. Call `POST /api/master/rollback/prepare` with the ticket ID.
   A durable SQLite reservation checks the original merge, baseline, ticket
   status and kill switch. A temporary **bare Git object database/index**
   fetches remote main, verifies the exact merge and its first-parent tree,
   then extracts the original baseline tree into a **disposable candidate**.
   The hardened Docker runner tests that candidate. Only after an actual
   Docker marker and exit code 0 does Git create a single child revert commit
   with the first-parent tree and non-force push it to
   `rollback/<ticketId>`. The endpoint verifies the remote SHA.
   Status is still `ROLLBACK_REQUESTED`, never completed.
3. Call `POST /api/master/rollback/create-draft-pr` with the ticket ID.
   GitHub REST rechecks remote main, branch head, one-commit parent,
   complete changed file scope and restored tree, then opens a **draft PR**
   against main. A SQLite `PR_CREATING` reservation prevents duplicate
   concurrent creation. A partial/uncertain outcome requires **manual
   reconciliation**, never a blind automated retry.
4. The repository's independent human reviewer inspects and approves the
   draft after it is marked ready. Required CI must succeed on the precise
   rollback head. A human merges the PR via GitHub's protected main rules.
   **This backend never invokes GitHub's merge API.**
5. Call `POST /api/master/rollback/verify` with the ticket ID.
   The read-only verifier checks GitHub merged PR number, original merge
   parent, rollback head, exact restored tree at both head and merge SHA,
   required Actions checks, independent approval, allowed files and
   merge ancestry on main. An atomic SQLite CAS writes
   `verified_git_rollbacks`, the actual rollback merged SHA, and finally
   `ROLLBACK_COMPLETED`. Any mismatch leaves `ROLLBACK_REQUESTED`.

## Durable states and crash recovery

`rollback_proposals` has states `PREPARING`, `BRANCH_PUSHED`,
`PR_CREATING`, `DRAFT_PR`, `NEEDS_RECONCILIATION`, and `COMPLETED`.
One ticket has at most one proposal reservation.

If Git/Docker/GitHub becomes unavailable or a server dies after an external
write, the system **does not claim rollback success**. Retrying preparation
against an existing reservation is denied. The administrator can call the
read-only recovery endpoint below. The system **never automatically retries
Git push, PR creation or merging**.

### Explicit read-only reconciliation — 11 November

```http
POST /api/master/rollback/reconcile
Content-Type: application/json

{"ticketId":"TKT-EXAMPLE"}
```

Requires an authenticated administrator, `SUTRADHAR_ENABLE_ROLLBACK=true`,
the configured trusted target Git checkout, rollback Git token, separate
read-only GitHub token, and the trusted Docker test command. No caller may
override repository, test command or credentials through the request body.

- A single SQLite `recovery_token` fences concurrent inspectors, even from
  different processes sharing the authoritative database. Only uncertain
  operations are eligible. A fresh `PREPARING` or `PR_CREATING` operation
  remains busy until at least **six minutes** have passed; active recovery
  locks must also expire before another explicit attempt.
- The Python inspector uses remote Git read-only requests and checks `main`
  still points to the original verified merge. If a rollback branch exists,
  its exact commit parent and tree must match the original merge and restored
  baseline. The full changed-file set must still be allowed; the remote
  branch is **re-tested inside hardened Docker**. No test marker or failed
  exit means no recovery acceptance.
- The TypeScript inspector uses only GitHub REST **GET** requests, checking
  the exact repository/branch/head/tree, diff and unique open **draft**
  rollback PR. Conflicting, forked, closed, ambiguous and incomplete
  results fail closed.
- **Remote branch and PR both absent**, and no previous branch SHA recorded:
  clear only the uncertain reservation. A fresh explicit prepare request
  may be made separately; this recovery call never creates a branch.
- **Matching branch exists, draft PR absent:** recover
  `BRANCH_PUSHED` with exact SHA and tree. Operator may separately
  create a draft PR after inspection.
- **Matching branch and matching draft PR exist:** recover `DRAFT_PR` with
  the PR number and exact branch SHA. Human review and CI are still required.
- A moved main, altered branch, expired/stale epoch, paused cluster or
  conflicting PR preserves `NEEDS_RECONCILIATION`, requiring operator
  intervention. No remote write or `ROLLBACK_COMPLETED` claim results.

This is read-only **remote evidence recovery**, not proof that a real
GitHub PR has been independently approved or merged. The final
`/api/master/rollback/verify` endpoint separately verifies those facts.
Git ref lookups and GitHub REST reads are snapshots; another actor may
change refs immediately afterwards. Use protected branches and narrow
credentials. Missing/deleted/closed or already merged PR recovery can
still require manual intervention.

An original merge already followed by a newer main commit is deliberately
blocked. The system currently handles only the last verified merge, not
generic cherry-picks, conflict resolution, partial reversions, or merged
revert branches containing multiple commits.

## Verification scope

- Python `tests/test_rollback_pipeline.py` creates actual local Git
  repositories and bare remotes, verifies first-parent commit/tree restoration,
  unchanged main, wrong tree/scope, moved main, duplicate branch and denied
  Docker outcomes.
- The dedicated GitHub Actions Python Docker stage runs a **real container**
  to test the restored Git archive before push. Ordinary Python test jobs
  use a test-only fake runner to verify preflight Git logic.
- TypeScript `tests/git_merge_attestation.test.ts` verifies durable
  reservation, stage CAS, exact PR identity and one-time completion.
- `tests/rollback_http_integration.test.ts` exercises actual Express/SQLite
  endpoints against **mock GitHub REST responses** for unmerged PR,
  wrong restored tree, insufficient approvals and successful evidence.
  Mocked GitHub responses do **not** prove live production delivery.

## Remaining P0 limitations

- Live target GitHub rollback branch → reviewed draft PR → merged PR
  acceptance is **NOT RUN**. Requires owner-approved target repo/credentials.
- Historically exposed master signer must be rotated and legacy leases
  invalidated before release.
- Durable read-only rollback recovery is implemented, but a scheduled
  multi-host queue, protected remote ref policies and dedicated end-to-end
  Docker recovery acceptance tests remain pending.
- Production environment, HTTPS, runner images and branch protection
  require separate security review.

Related: [Implementation Tracker](./IMPLEMENTATION_TRACKER.md),
[Human Review Authorization](./HUMAN_REVIEW_AUTHORIZATION.md),
[Worker Branch Publication](./WORKER_BRANCH_PUBLICATION.md) and
[11 November Recovery Log](./IMPLEMENTATION_LOG_2026-11-11.md).
