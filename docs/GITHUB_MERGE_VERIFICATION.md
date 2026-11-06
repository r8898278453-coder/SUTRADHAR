# GitHub delivery verification — SUTRADHAR

**Status:** Implemented and test-covered on `fix/p0-containment-2026-11-06`.
Real remote-merge acceptance remains **unverified** until the repository owner
creates and merges an eligible target-project PR. This capability does **not**
automatically merge, push or modify GitHub branches.

## Purpose

`COMMITTED_PUSHED` must mean **a GitHub PR was actually merged into main
and its resulting tree exactly matches the artifact that passed the isolated
Docker test**. A signing token, a GitHub branch, or successful CI alone
cannot advance this status.

The read-only verifier is `github_merge_verifier.ts`. The Express endpoint is
`POST /api/cluster/ticket/verify-push`, administrator-only.

## Production configuration

The target Git repository must be a committed checkout, used by
`SUTRADHAR_TARGET_REPO_ROOT` for the actual Docker test. GitHub must point
to **that same repository**:

```bash
export SUTRADHAR_TARGET_REPO_ROOT="/absolute/path/to/target-git-checkout"
export SUTRADHAR_SANDBOX_TEST_COMMAND="python3 -m pytest -q"
export SUTRADHAR_GITHUB_REPOSITORY="owner/target-repo"
# Set securely at deploy time; NEVER commit, log, or expose to the browser:
export SUTRADHAR_GITHUB_TOKEN="<read-only token>"
export SUTRADHAR_REQUIRED_CHECKS="TypeScript, unit checks, and build;Python syntax, shell syntax, state tests"
export SUTRADHAR_MIN_GITHUB_APPROVALS=1
```

The checks above are illustrative: use the **exact required check-run names
of the target repository**, not the SUTRADHAR project's own workflows unless
it is also the target repository. The verifier currently requires the
`github-actions` check-run app. The GitHub token needs:
**Contents: read**, **Pull requests: read**, and **Checks: read**. Configure
branch protection to require checks and review independently.

Only the server reads these secrets; no request may override the repo, token,
required checks or minimum approvals. If configuration is missing, the API
returns **503 `GITHUB_VERIFICATION_NOT_CONFIGURED`**.

## Verified delivery sequence

1. A worker claims the ticket. The master issues a ticket-scoped Ed25519 token.
   The **exact signed token ID** is stored in the SQLite lease, along with
   worker, epoch and expiration; invalid/revoked/stale tokens are rejected.
2. A trusted Git source HEAD is archived; the ticket patch is applied to a
   disposable candidate, scope-checked, and tested **inside real Docker**.
3. Real Docker exit 0 causes a **single SQLite transaction** to save the
   candidate tree SHA-1, baseline commit SHA-1, patch SHA-256, worker/epoch,
   allowed changed files and `READY_FOR_REVIEW` status.
4. A branch commit must have **exactly one parent**, that parent must be the
   tested baseline SHA, and its complete tree SHA must equal the tested tree.
   The corresponding PR must contain exactly one commit. Any rebase or source
   change requires a **new Docker test**.
5. An authorized human reviews the GitHub PR. Required `github-actions`
   check runs on its exact head SHA must all have concluded **success**.
   An independent reviewer must have approved the PR (at least one by default).
6. The PR is merged through GitHub into the configured `main` branch. The
   resulting merge/squash commit tree must **still** equal the tested tree.
   The merge commit must be reachable on `main` (GitHub compare ancestry).
   PR files must be wholly within the ticket's allowed-file set, with no
   renames or unknown changes.
7. An administrator calls `POST /api/cluster/ticket/verify-push` with the
   ticket ID. The server validates the signed and live lease, checks durable
   sandbox evidence, fetches GitHub evidence via its configured token, and
   atomically marks `COMMITTED_PUSHED` only if the ticket, epoch, token,
   patch and lease are **still current**.
8. The remote merged commit and PR metadata are persisted in
   `verified_git_merges` and the audit log; `rollback_commit` references
   the actual merged SHA, not a fabricated local `HEAD`.

**No route executes a git push or merges main.** The old Python in-process
merge queue now fails closed with `GITHUB_REVIEWED_PR_REQUIRED`.

## Failures and limitations

- `GITHUB_MERGED_PR_NOT_UNAMBIGUOUS`: no eligible merged PR for the
  exact branch, or multiple candidate PRs.
- `GITHUB_TESTED_TREE_MISMATCH`: wrong head parent, modified commit tree,
  different squash/merge result tree, or more than one PR commit.
- `GITHUB_PR_FILE_SCOPE_MISMATCH`: changed files exceed ticket whitelist,
  rename, or incomplete file enumeration.
- `GITHUB_REQUIRED_CHECKS_MISSING`: required check missing/not complete/not
  successful, or wrong check-run app.
- `GITHUB_APPROVAL_NOT_VERIFIED`: no qualifying independent approval.
- `GITHUB_MERGE_NOT_ON_MAIN`: GitHub merge commit is not reachable on main.
- `GITHUB_API_UNAVAILABLE`: GitHub unavailable/authentication rejected.
- `GITHUB_MERGE_EVIDENCE_STALE`: a new patch, epoch, pause, revoked lease, or
  concurrent status update invalidated verification before SQLite commit.

This intentionally restrictive v1 gate rejects ordinary multi-commit PRs,
repositories with incompatible commit/tree policies and merges that change
the tested tree. It also cannot verify the target repo's GitHub permissions or
required branch-protection rules **without owner configuration**.

## Evidence / testing

```bash
npm test
npm run test:sandbox-http
npm run lint
npm run build
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Unit tests provide a deterministic fake GitHub REST **response fixture** to
exercise positive and negative verification logic; they do **not** prove a
real remote PR was merged. The SQLite regression suite tests durable tree
attestation, epoch/patch/lease fencing and atomic status changes. Real HTTP
Docker tests independently prove the candidate tree and persisted attestation.

**Next:** owner-approved live target-repo PR acceptance test; then implement
safe protected-PR creation and actual revert-and-merge rollback. Keep these
as pending until executed. See [Implementation Tracker](./IMPLEMENTATION_TRACKER.md).
