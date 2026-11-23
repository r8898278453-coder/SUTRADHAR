# SUTRADHAR v7 — GitHub review and exact merge verification

**Status:** Alpha. Existing Hostinger/MySQL Central + independent Windows QA PC architecture. No production merge or deployment.

**Order:** QA PASS → distinct Owner QA evidence review → Central QA receipt → exact remote GitHub branch confirmed → Owner one-shot Draft PR → external human review and target CI → Owner merges externally in GitHub → Central independently verifies merge and stores DONE.

## Owner review status: read-only

Use the Owner dashboard button **Inspect human review + GitHub CI**. Its authenticated endpoint GET /v7/owner/pr-review/:ticketId binds the MySQL-confirmed PR number, repository, base branch, candidate HEAD/tree and changed-file scope. Using the Central-only read token, GitHub GETs inspect original baseline, exact candidate single parent/tree, complete PR and compare file sets, required check runs and human reviews. No PR approval, merge, Git push, code execution or deployment happens.

A PR is eligible only if it is open, not Draft, targets the approved base, and has unchanged HEAD/tree and baseline. Required server-configured CI checks must have complete and successful github-actions check-run evidence bound to the exact HEAD. Independent human review must be an APPROVED GitHub User distinct from the PR author, whose latest review is on the exact candidate commit SHA. A stale review, bot, dismissed review, CHANGES_REQUESTED, incomplete check-run page, moved baseline, altered file or unavailable GitHub API blocks readiness. This snapshot is never a merge authorization. Configure actual GitHub branch protection and required checks independently.

## Read-only verified external merge, with owner intent

Only after manual GitHub human-reviewed merge: supply the exact ticket, registered 40-character candidate head SHA, exact registered PR number, Owner reason of 20–500 characters and explicit read-only verification consent. POST /v7/tasks/verify-merge requires fields request_id, ticket_id, expected_remote_head_sha, expected_pr_number, owner_review_note and owner_confirmed_readonly_verification=true.

Central independently proves the merged PR, unique registered source head, one tested parent, candidate/merged tree equality, permitted changed files, exact-head required CI and human approvals, and merged commit reachability on the configured target branch. It then atomically marks the ticket DONE, preserves a durable Git receipt, and revokes reservations; NO GitHub write occurs. Duplicate retries with the same request ID and identical body read the original MySQL receipt even after DONE; conflicting IDs/bodies are refused.

**Limitations:** Preview or merged-status claims are never production-approval evidence. No schema migration. No actual remote GitHub PR, merge, review, Hostinger/MySQL production change or physical multi-PC acceptance is asserted by automated mocked GitHub tests. Production signing, rollback verification and real Owner acceptance remain separate gates.

## G0 read-only repository rules verification

Before an independent reviewer can request release promotion, run
\`npm run ops:github-g0-protection\` with the **exact main SHA**, not a PR
SHA, on a trusted operator machine. It verifies visible GitHub protection
metadata and effective rules for main; required checks must be bound to
their published job contexts, and force-push/deletion must be disallowed.
No GitHub API POST/PATCH/PUT/DELETE occurs. Unavailable APIs or a 403 mean
HOLD. Even a compatible result explicitly never verifies bypass policies,
human review decisions or production authorization. See the Owner
provisioning runbook B0. The fix branch is not a protected promotion source.
