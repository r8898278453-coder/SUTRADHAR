# Owner-declared provider workspace bindings (v7 alpha)

This is a configuration-only foundation, **not live provider authorization** or a replacement for the planned MySQL provider-workspace registry. It requires no schema change. Do not alter the reviewed v7/v8 migration files.

## Owner setup (staging only)

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

Real account/workspace verification, durable versioned MySQL mapping and revocation history, provider capability/terms review, a supported provider adapter, actual token/quota measurement, and a real assisted session on an approved physical PC remain open. The application cannot mark a provider mapping verified on the basis of these declarations. All G0–G7 release gates remain HOLD; no production deployment or signing is implied.
