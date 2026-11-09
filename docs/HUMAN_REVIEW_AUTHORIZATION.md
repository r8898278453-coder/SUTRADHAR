# Human-review-safe merge verification — 10 November 2026

**Status:** Code and GitHub Actions test verification on the draft fix branch.
**Live target-repository merged-PR acceptance:** NOT RUN. No PR is merged
by either endpoint.

## Why the extra step is necessary

A worker receives a short-lived, ticket/file-scoped Ed25519 **execution lease**.
Human PR review and required CI can take longer than the worker's TTL.
Previously the watchdog could revert `READY_FOR_REVIEW` to `PENDING` on
heartbeat expiry, and the final merged-PR verifier also demanded the original
worker's unexpired lease. This coupled human delivery to worker execution.

The release-proof check now has a **separate administrator authorization**.
It does not renew or reissue the worker's execution credentials.

## Release verification process

1. A candidate passes **real Docker**, producing a verified candidate tree,
   patch SHA-256 and baseline Git commit.
2. The exact tested branch is pushed with a non-force Git operation; the
   verified worker push SHA is recorded. A GitHub draft PR is created and
   its number/head are persisted.
3. The GitHub PR receives independent human review and required checks.
   Human review, PR merging, branch protection and check execution are
   **GitHub processes**, not actions performed by SUTRADHAR here.
4. An authenticated SUTRADHAR administrator authorizes a read-only proof
   check after review/merge:

```http
POST /api/cluster/ticket/authorize-merge-verification
Content-Type: application/json

{"ticketId":"TKT-EXAMPLE"}
```

   The backend derives the repository, registered PR number, pushed head,
   exact tested tree, patch and epoch **only from SQLite and server config**.
   It rejects a changed patch, kill-switch, changed epoch, missing draft/worker
   push receipt, consumed authorization, and explicitly revoked original
   worker-token provenance. The authorization lasts at most **15 minutes**.
   A failed/unavailable check requires a new explicit admin authorization
   once that window expires.
5. The administrator invokes the existing read-only endpoint:

```http
POST /api/cluster/ticket/verify-push
Content-Type: application/json

{"ticketId":"TKT-EXAMPLE"}
```

   The server demands an active matching grant. Then it queries GitHub's
   authenticated REST API for the **registered PR number and exact pushed
   head**, single-commit baseline parent, merged tree equality, allowed
   file scope, required check success, independent approval and commit
   ancestry on `main`.
6. A single SQLite `BEGIN IMMEDIATE` transaction compares the grant,
   exact tested/pushed/PR evidence, current epoch, patch, kill-switch and
   original token-revocation state **again**, consumes the grant and
   persists the actual merged SHA with `COMMITTED_PUSHED`. Failures
   keep the ticket unmerged and the grant unconsumed (until expiry).

Neither authorization nor verification pushes a branch, merges a PR,
runs untrusted code, or reports a false success.

## Watchdog behavior

A worker lease may be marked revoked after its TTL/heartbeat timeout;
the independently verified `READY_FOR_REVIEW` ticket, assigned provenance
and patch are **preserved** in SQLite and the in-memory dashboard. This
does not make an expired worker lease usable again.

An explicit/manual worker lease revocation still cancels the ticket to
`PENDING` and blocks merge authorization. Revocation of the original
signed token via `revoked_tokens` also prevents issuing or consuming a
merge-verification grant.

## Rejection and limitation cases

- No registered PR, verified pushed commit, Docker attestation, matching
  epoch or explicit admin action -> reject.
- Grant expired, already consumed, wrong PR/head or patch changed -> reject.
- Required GitHub CI/reviewer missing, remote merge absent, wrong merged
  tree or main ancestry missing -> reject (and do not claim `COMMITTED_PUSHED`).
- Kill-switch, explicit signed token revocation or changed epoch -> reject.
- This is **administrator-controlled proof verification**, not an automatic
  human approval workflow. A successful admin authorization is *not proof*
  that the PR was reviewed. The separate live GitHub verification supplies
  independent review/CI/merge evidence.
- The GitHub API fixture tests are deterministic mocks, not proof of live
  target repo acceptance. This system has no ability to recover production
  credentials, rotate leaked signing keys, or verify the user's branch
  protection configuration without owner intervention.
- Multi-host consistency requires all writers to share one authoritative
  SQLite database; HA-backed lease renewal and real rollback remain pending.

## Validation

```bash
npm test
npm run lint
npm run build
npm run test:sandbox-http
```

The new tests cover worker lease/watchdog expiry preserving review status,
admin grant expiry/reissue, single consumption, wrong PR/head, changed patch,
explicit token revocation, and the real Express endpoint with *mocked*
GitHub REST evidence.

See [Implementation Tracker](./IMPLEMENTATION_TRACKER.md),
[GitHub Merge Verification](./GITHUB_MERGE_VERIFICATION.md) and
[10 November Implementation Log](./IMPLEMENTATION_LOG_2026-11-10.md).
