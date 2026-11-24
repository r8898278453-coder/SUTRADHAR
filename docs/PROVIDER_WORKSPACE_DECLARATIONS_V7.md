# Owner-declared provider workspace bindings (v7 alpha)

This alpha supports both legacy environment declarations and an Owner-managed versioned registry persisted in the existing MySQL event ledger. Neither is live provider authorization. The registry is coded, CI pending; no schema change. Do not alter the reviewed v7/v8 migration files.

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

Use authenticated Owner HTTPS routes on a disposable/staging environment; a non-developer dashboard editor is not yet implemented. Never put an admin credential in a URL, Git, chat or browser console history.

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
