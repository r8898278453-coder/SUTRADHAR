# Owner-declared provider workspace bindings (v7 alpha)

This alpha supports both legacy environment declarations and an Owner-managed versioned registry persisted in the existing MySQL event ledger. Neither is live provider authorization. The registry source passed CI at 215e5ee; no schema change. The new dashboard editor is coded, CI pending. Do not alter the reviewed v7/v8 migration files.

## Legacy bootstrap setup (staging only)

In the Central application's protected environment settings, add `SUTRADHAR_PROVIDER_MAPPINGS_JSON` as a single JSON array. Example with fictional IDs:

```json
[
  {
    "project_id": "project_example",
    "agent_id": "agent_pc01",
    "provider": "CHATGPT_WEB",
    "account_ref": "account_operator01",
    "workspace_ref": "workspace_example01"
  }
]
```

Use the exact Central project ID and enrolled developer agent ID. Supported provider labels: CHATGPT_WEB and GOOGLE_AI_STUDIO. Account and workspace references are **local non-secret aliases**, not email addresses, provider URLs, passwords, API keys, tokens or cookies. Maintain the real provider account/workspace association independently in an Owner-controlled record. Never enter credentials into this environment value or Git.

The bounded configuration rejects extra fields, duplicate assignments and conflicting cross-project workspace bindings. Missing configuration is UNCONFIGURED; malformed configuration is INVALID_OWNER_CONFIGURATION. A signed task-detail response exposes only the assigned developer's own declarations when that agent has development access. QA-only and other agents do not receive the declarations. Desktop independently checks the exact project/agent binding digest and displays the metadata separately from the compact task payload. It never selects a browser session, sends a prompt, creates a workspace, grants a lease or permits automation.

## Manual assisted workflow

1. Verify the current task lease and exact Git baseline/worktree using the existing Desktop controls.
2. Preview compact provider context. An unconfigured or invalid mapping is a hold for provider use, not an invitation to guess a similarly named workspace.
3. Independently check the actual signed-in account, correct workspace and provider-permitted operation against the Owner's mapping record. OWNER_DECLARED_UNVERIFIED is not proof of any of these checks.
4. Review prompt data for secrets and authorization. Use only the compact task payload if permitted; keep local account/workspace references out of the prompt.
5. Preserve a verified checkpoint and re-check identity, scope and lease on resumption. Do not transfer cookies, evade quotas or retry uncertain remote writes.

## Remaining acceptance

Real account/workspace verification, target-hosting ledger performance and retention/restore proof, provider capability/terms review, a supported provider adapter, actual token/quota measurement, and a real assisted session on an approved physical PC remain open. The application cannot mark a provider mapping verified on the basis of these declarations. All G0–G7 release gates remain HOLD; no production deployment or signing is implied.


## Durable Owner-managed registry (alpha, source CI pending)

Last fully green application + dependency baseline: `93993a0`. Previous shared-contract HEAD `01ff1ce`: [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45451459381) SUCCESS; [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45451459160) CANCELLED after subsequent branch development. Shared-contract and new registry source still require exact-head application CI.

Use authenticated Owner HTTPS routes on a disposable/staging environment; the API workflow below remains available for reviewed operator diagnostics. The new dashboard editor is described at the end. Never put an admin credential in a URL, Git, chat or browser console history.

1. GET `/v7/owner/provider-registry` with Owner authentication. Version 0 means legacy environment fallback is active; the returned empty bindings at version 0 are not an export of the environment.
2. Review the complete intended set of non-secret alias bindings independently. Every binding must reference an exact active project and an approved agent/node with development permission.
3. POST `/v7/owner/command` with a unique request ID and `REPLACE_PROVIDER_REGISTRY`. Example JSON (fictional values):
```json
{
  "request_id": "registry_update_001",
  "command": "REPLACE_PROVIDER_REGISTRY",
  "payload": {
    "expected_version": 0,
    "bindings": [
      {
        "project_id": "project_example",
        "agent_id": "agent_pc01",
        "provider": "CHATGPT_WEB",
        "account_ref": "account_operator01",
        "workspace_ref": "workspace_example01"
      }
    ]
  }
}
```
4. Read back the current version/digest and intended bindings. A stale version is refused; re-read and independently review before submitting a new request ID. Replaying identical successful requests returns their historical receipt, not fresh authorization.
5. To revoke a mapping, replace the complete list without that mapping; to revoke all, use `bindings: []` and the current expected version. An empty stored snapshot remains authoritative and **does not reactivate environment fallback**. Once version 1 exists, environment edits no longer change registry behavior. Registry history is retained in MySQL; aliases must remain non-secret.
6. Review the assigned developer's signed task detail and Desktop registry source/version. Losing project grants removes task-detail access; regrant alone does not prove provider authorization. Remove obsolete alias declarations explicitly in the registry. The registry does not revoke external provider sessions or accounts.

The canonical full snapshot has a maximum of 100 bindings / 16 KiB configuration JSON, monotonically increasing safe integer version and SHA-256 digest. Invalid persisted snapshot fails closed rather than using the environment. Current implementation uses an append-only event lookup, not a dedicated indexed registry table; retention policy must preserve the registry history and restore the latest authoritative snapshot. Actual provider identity, provider permissions, automatic continuation, real token accounting and live acceptance remain OPEN.


## Non-developer Owner dashboard workflow (staging alpha)

Verified baseline `215e5ee`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116654) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45453116645) both SUCCESS. This includes the shared-contract and durable provider registry source/regressions. The new dashboard editor is CODED / CI PENDING at this update.

1. Sign in to the Central dashboard using the Owner API key over independently verified HTTPS. Find **Provider workspace registry** and click **Load current registry / discard local draft**.
2. Read the current revision. Version 0 does not display legacy environment aliases; independently inventory the entire intended set first. Initial save supersedes every legacy declaration, including ones not shown.
3. Enter exact project and developer agent IDs, choose ChatGPT Web or Google AI Studio, and enter local non-secret account/workspace aliases. Click **Add to local draft**. Invalid, duplicate, ambiguous and oversized declarations are refused. Remove an existing draft row and add its replacement to edit it. Draft changes do not write to MySQL.
4. Review the complete table and all removals. Check the explicit review box, click **Save exact reviewed registry**, and confirm the replacement. Unadded form input blocks saving. Removing every row and saving is an explicit local declaration revocation, not provider logout.
5. Central independently validates grants and expected version. The dashboard sends one replacement request, then reads current Central state and compares version, digest and full binding list before showing a saved status. If another Owner changed it, the response was lost, or verification fails, the editor is disabled until explicitly reloaded. Never blindly retry or assume a failed response means nothing was committed.
6. Disconnect clears in-tab registry data and blocks stale responses from earlier Owner sessions. A previously accepted command may still have committed. No automatic refresh of the editor, automatic save, provider login, live permission verification or external session revocation occurs.

The dashboard uses existing Owner routes; no new credential stores or schema changes. VM/browser-model regressions are not real-browser/Hostinger acceptance. Independently verify real provider identity and permissions, retention/restore, target hosting performance and physical assisted operation before acceptance. G0–G7 HOLD.


## Manual provider interruption and recovery (alpha)

Verified previous baseline `e935cef`: [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765773) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45455765743) both SUCCESS, including the Owner registry dashboard. Manual provider attempt source is CODED / CI PENDING at this update.

This is local attempt metadata, not an adapter to ChatGPT/AI Studio. Record a manual attempt only after independently reviewing provider permission, the current actual account/workspace, the local worktree and prompt secrets. Use the existing trusted developer CLI with its signed enrolled identity; packaged Desktop currently displays attempt metadata and blocks a new compact handoff during unresolved work, but does not send these mutations.

- Establish a live original worker lease and fresh checkpoint; review the compact Desktop handoff and its SHA-256. A durable Owner registry version and matching binding digest are mandatory for recording an attempt (legacy aliases are insufficient).
- Run `npm run edge:worker -- provider-attempt AGENT_ID TICKET_ID begin CHATGPT_WEB CONTEXT_SHA256` (or GOOGLE_AI_STUDIO). This verifies lease/worktree, submits signed BEGIN metadata and reads back OPEN. It does not send the context or open a browser. The context digest is operator-supplied, not independently recomputed against actual transmitted bytes.
- If interrupted, run `npm run edge:worker -- provider-attempt AGENT_ID TICKET_ID interrupt ATTEMPT_ID`. A process crash that prevents reporting leaves OPEN unresolved. Do not start a second attempt or blindly repeat a remote action. Read signed detail to reconcile an uncertain response.
- After independently reviewing external session state and local worktree, record a new checkpoint using the existing worker checkpoint command. On the same live lease, run `npm run edge:worker -- provider-attempt AGENT_ID TICKET_ID close ATTEMPT_ID REVIEWED`. The fresh generation must be strictly newer than the original attempt checkpoint. Closure is a manual attestation, not provider proof. Never supply REVIEWED without real review.
- If the lease is revoked, do not reuse it. Owner GET `/v7/owner/provider-attempt/:ticketId` observes the latest metadata. With the ticket already RECONCILIATION_REQUIRED and original lease revoked, use Owner command RESOLVE_PROVIDER_ATTEMPT with exact ticket_id, attempt_id, external_session_reviewed:true, worktree_reviewed:true, no_automatic_retry_confirmed:true only after independent review. This records closure without reassigning or releasing reservations. Ordinary RECONCILE_TICKET remains a separate gate.
- An unresolved attempt blocks new attempts, candidate submission, new claim, normal requeue and new compact Desktop handoff. Existing checkpoint and lease recovery operations remain available. No automated external continuation or session termination is performed.

No raw prompt, provider response, chat ID, token count, credential or browser cookie is accepted by the attempt API. The audit ledger retains historical metadata; real provider permissions, exact transmitted context, attempt coverage for operators who bypass recording, dedicated storage/performance/restore, Desktop mutation/Owner resolution UI and actual physical interruption acceptance remain open.


## Non-developer Owner interrupted-attempt review (staging alpha)

At `82e2a8c`, [application CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188656) and [dependency CI](https://github.com/r8898278453-coder/SUTRADHAR/actions/runs/45457188901) FAILED because both Linux typecheck paths reported TS18049 nullable registry/prior state in central.ts. Disposable MySQL integration, unsigned Windows installer smoke, Python/shell/state jobs, Windows lock check and advisory review passed. Explicit return guards in `4d05bde` address the reported compiler diagnostics; its workflows were cancelled by subsequent commits, not verified green. Last fully green combined baseline `e935cef`. New Owner recovery UI and regression changes are CODED / EXACT-HEAD CI PENDING.

1. In the Central dashboard, open **Interrupted provider attempt — Owner review**. Enter the exact ticket ID and click **Inspect current attempt**. The read-only endpoint reports the latest attempt and whether its original lease is revoked and the ticket is RECONCILIATION_REQUIRED. No record does not prove no external effects.
2. Preserve and independently inspect the original PC, worktree/checkpoint and actual provider session. If the lease remains live, use the separate signed worker recovery process; do not force Owner closure. If the server says ineligible, stop and use the appropriate separate recovery process.
3. For an eligible attempt, retype the full displayed attempt ID. Check all three confirmations only after actual independent review. Click **Record exact Owner review and close attempt ONLY**, then confirm. Central rechecks the authoritative state before accepting.
4. The dashboard performs one signed-in Owner POST and reads back the current exact closed attempt with OWNER_REVIEW resolution. Unknown or conflicting outcomes disable closure until fresh inspection. Logout clears local selection and ignores late responses; it does not cancel a committed command.
5. Closure does not requeue the ticket, release reservations, authenticate a provider, terminate a session or establish actual transmitted context. Separate Git/QA and ordinary ticket reconciliation remain required.

The dashboard does not display the original lease identifier, raw prompt or provider session credentials. Existing API remains available to authorized operators. VM browser-model and disposable MySQL fixtures are not actual Hostinger/browser/provider acceptance. Packaged Desktop attempt mutation controls remain open; no production deployment or schema migration. G0–G7 HOLD.
