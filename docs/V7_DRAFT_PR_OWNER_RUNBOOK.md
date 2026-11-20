# SUTRADHAR v7 — Owner-only Draft PR and read-only recovery

**Date:** 20 November 2026
**Status:** Alpha; feature OFF by default. Live GitHub PR creation NOT performed.

## Simple Owner dashboard workflow

1. Complete independent QA on a separate enrolled QA PC: tested candidate bundle, Docker report, device-signed evidence, authenticated Central evidence upload, actual Owner review and final PASS receipt. The tested commit HEAD/tree is immutable.
2. Complete a separate HIGH/CORE change approval if the exact task requires it. QA evidence approval never authorizes sensitive code publication.
3. Complete Owner-gated one-shot Git branch publication, and obtain Central confirmation of the exact remote commit/tree/parent/scopes and baseline. The default Desktop package cannot push.
4. Owner explicitly enables SUTRADHAR_ENABLE_PR_CREATION=true and provisions SUTRADHAR_GITHUB_PR_TOKEN using a protected Hostinger secret, with minimal Contents-read and Pull-request-write permissions. NEVER put token in Git, request bodies, task text, dashboard input or logs. Configure target-repository branch protection, required independent reviewers and CI checks separately.
5. In Central Owner dashboard enter ticket ID and choose **Inspect Draft PR prerequisites (read-only)**. It displays the repository/base branch and exact 40-character verified candidate commit. Creation remains disabled when the Master is not READY, feature flag is OFF, verified QA/Git proof is absent, or an attempt exists.
6. Re-enter the complete candidate commit SHA, supply an Owner reason of 20–500 characters and explicitly confirm **one real Draft PR only**. It may send ONE GitHub Draft PR creation POST. There is no Git push, main mutation, PR merge, production release or deployment.
7. Before any external POST, Central writes a durable one-shot attempt in existing v7_commands and a pending marker in v7_git_jobs.pr_url under a real MySQL transaction. Other sessions and retries cannot issue a second PR creation for that ticket.
8. The GitHub preflight must match the exact branch, authorized base branch tip, candidate HEAD/tree, single parent, and the complete tested file set. It refuses renames/deletes, unauthorized files and noncanonical PR URLs. A matching already-existing open draft may be registered without a new POST.
9. After an exact verified remote draft, Central atomically records canonical PR URL/number and resolves the original command receipt. The result is REVIEW_REQUIRED, not DONE. Actual independent human approval and GitHub CI are still required before an external manual merge. Owner may later run separate read-only Verify external merge.

## Lost HTTP response or uncertain GitHub creation: no second PR POST

A GitHub Draft PR may exist even when a client sees a timeout. **NEVER click Create again, change request IDs, delete the pending marker, or manually resubmit another PR POST.** Instead:

1. Open Central Owner dashboard: **Uncertain Draft PR creation — Owner read-only recovery**. Alternatively use authenticated GET /v7/owner/pr-recovery. Verify the pending exact ticket, repository, branch and commit.
2. Independently inspect GitHub in your own trusted browser. In the dashboard select the pending attempt, type the full expected commit SHA, enter a 20–500-character incident reason and confirm **read-only recovery**.
3. Central uses only GitHub GET requests to inspect an **already existing open Draft PR**, its canonical repository URL, exact head SHA, one-commit tree, base branch, baseline and all changed files. It never creates another PR, pushes code or merges.
4. If the matching remote draft exists, Central resolves the original pending attempt and the Owner's recovery receipt together atomically in MySQL. If it is missing, closed, changed or ambiguous, recovery stays blocked and the Owner must investigate. Retrying an uncertain **read-only recovery** with unchanged request ID/fields is safe; retrying **Draft PR creation** is not.

## Authenticated API contract

- GET /v7/owner/pr-preflight/:ticketId — read-only metadata and readiness.
- POST /v7/git/pr-draft — required JSON fields: request_id, ticket_id, expected_remote_head_sha, expected_candidate_tree_sha, owner_confirmed_draft_only=true, owner_review_note (20–500 characters). An actual GitHub PR write can occur.
- GET /v7/owner/pr-recovery — pending attempt queue, no secrets.
- POST /v7/git/pr-recover-readonly — request_id, ticket_id, expected_remote_head_sha, owner_confirmed_readonly_proof=true, reason (20–500 characters). GitHub GET-only, no new PR.
- POST /v7/tasks/verify-merge — separate Owner action after external human-reviewed GitHub merge, required CI and exact merged tree verification. Never executes merge.

No new MySQL tables/migrations are introduced. Do NOT bootstrap or reapply the empty-database schema to populated Hostinger staging/production MySQL.

## Automated and real-world acceptance

Automated disposable MySQL and mocked GitHub fixtures verify the durable one-shot reservation, lost-response preservation, blocking a second create, exact existing-PR read-only recovery, replay receipts and strict commit/branch/file matching. UI regression tests cover full-SHA confirmation, meaningful Owner reason and explicit consent. No live GitHub write, real token, independently reviewed external PR, physical multi-PC acceptance or production deployment has occurred. These Owner-controlled gates remain pending.

**Important states:** QA PASSED is not REMOTE BRANCH VERIFIED; remote branch verified is not DRAFT PR CREATED; a draft is not human-approved; human approval is not merge; merge is not production deployment.
