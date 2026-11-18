# Owner review — uncertain Git publication after Master failover

**SUTRADHAR v7 alpha • developer-assisted preview, not production approval**

This guide describes the Owner-facing review added to the Central dashboard. The architecture stays one GitHub repository with two independently built applications: Hostinger Central owns state; a trusted PC performs local Git and worker operations. The dashboard **never pushes, merges, republishes or deploys** source.

## What you will see

After connecting the Central dashboard with the private Owner API key, open **Uncertain Git publication — Owner recovery review**. Central reads `GET /v7/owner/git-recovery`, authenticated using the same key. No job data, Owner key or recovery request ID is stored in the browser's local or session storage.

The table shows exact ticket ID, Git job status (`RUNNING` / `NEEDS_RECONCILIATION`), ticket status, original publication epoch, 40-character candidate Git commit SHA, and a **preflight eligibility** indicator. This is **not** external GitHub evidence. If an old job has no independently matched QA receipt, is attached to the developer instead of a separate QA agent, has a live worker lease, or the current Master is not live in `RECOVERING`, review is blocked.

If more than 300 uncertain jobs exist, Central returns `GIT_RECOVERY_PAGINATION_REQUIRED` and the UI fails closed rather than hiding older work.

## Reviewing one job

1. Confirm the Central dashboard says the live Master is `RECOVERING`; inspect task, current epoch and selected job. If Central is offline, do not use cached task lists as proof.
2. Select **Review** beside an eligible job. The ticket, epoch and expected SHA are filled from Central and remain read-only.
3. Independently inspect the Owner's incident record and the expected tested candidate. Type the entire exact 40-character candidate SHA, record an incident reason of 12–500 characters, and check the explicit read-only authorization.
4. Select **Verify exact remote evidence** and confirm. Central independently reads GitHub branch, commit and comparison using a configured scoped read token. It requires the exact approved head, tested tree, one-parent frozen baseline, allowed paths and original independent QA receipt.
5. On successful positive proof, Central stores a durable `CONFIRMED` job receipt and leaves the ticket `INTEGRATING`; the project still needs the separate verified draft PR / review / merge process. The UI does **not** declare anything DONE.

## Errors, lost response and retries

If the response is lost after submission, **do not re-push**. The tab retains the exact Owner request ID in memory. Leave the fields unchanged and use **Retry same recovery request**; the server returns the prior idempotent receipt if it already committed. Changing the reason, SHA or epoch does not authorize a new attempt. **Clear review / retry** erases only the browser's selection and retry ID; it does not roll back MySQL.

If the tab was closed or a definitive conflict appeared, review the current queue and audit log with an authorized operator before issuing a new request. An absent GitHub branch, missing token, unavailable API or mismatched receipt is **uncertain**, not proof that a new push would be safe.

The dashboard's **preflight eligible** indicator is not permission: the server repeats the epoch, QA, lease, scope and remote checks before accepting any receipt. Server requests use an Owner API key; never enter GitHub/Hostinger passwords or Windows agent private keys into this form.

## Test evidence and operational limits

- `npm run test:v7`: mock-browser checks exact SHA confirmation, explicit consent, disabled controls, and same-request-ID retry after an ambiguous network reply.
- `npm run test:v7-mysql` against disposable MySQL: Owner-only queue authorization, matching QA and lease eligibility, failover recovery, durable record clearing.
- `npm run test:packages`: ensures the Central UI ships in the independent Central bundle.

These are **alpha code-level verifications**, not a real GitHub acceptance, live Hostinger deployment, full dependency audit or physical multi-PC validation. No signed production installer or authorized automatic update is implied.
