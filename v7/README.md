# SUTRADHAR v7.0 — implementation and operator guide

Status: **alpha code committed, not production accepted**. Existing v6 security/Git/Docker guards remain in the repository. Only v7 MySQL is authoritative for the new routes; legacy SQLite/demo service is available explicitly via the legacy development command and MUST NOT serve production.

## Central on Hostinger Business

Hostinger Business Node.js supports Express and MySQL, but not inbound WebSockets, Docker or permanent background workers. Hostinger's managed web app should use Node 22, the approved branch, project root, npm build, output directory dist, and entry file dist/server.cjs. Keep the source v7/schema.sql available at runtime. This is a request-driven HTTP API.

1. Back up existing data, provision a **new disposable MySQL database**, and review v7/schema.sql. Never silently overwrite the legacy SQLite database.
2. Set DB_HOST=127.0.0.1 (on Hostinger), DB_PORT=3306, DB_USER, DB_PASSWORD, DB_NAME, SUTRADHAR_ADMIN_KEY (32+ characters), SUTRADHAR_ENROLLMENT_CODE (different 32+ characters) from the Hostinger environment UI. Alternatively use SUTRADHAR_MYSQL_URL. Do not commit keys.
3. Temporarily set SUTRADHAR_ALLOW_MIGRATIONS=true. Build and launch the API; invoke POST /v7/owner/migrate with Authorization: Bearer ADMIN_KEY. Review output. Disable SUTRADHAR_ALLOW_MIGRATIONS, restart, then GET /v7/health. Production schema changes should be applied by a privileged DBA after backup/review.
4. Set SUTRADHAR_GITHUB_TOKEN, SUTRADHAR_REQUIRED_CHECKS, SUTRADHAR_MIN_GITHUB_APPROVALS for optional read-only remote merge verification. Existing worker Git push/PR/rollback guards are still OFF by default. Never enable auto-merge.
5. Serve the dashboard over HTTPS. The Owner key remains in browser tab memory and is never stored in localStorage or cookies. Telegram webhook requires Telegram secret, approved user/chat IDs and bot token, and uses the same Owner Command Service.

## Edge on each PC

Install Node 22 and the exact built project. Run npm run build once and set SUTRADHAR_CENTRAL_URL=https://...; SUTRADHAR_AGENT_IDS=agent_machine1_dev,agent_machine1_qa; SUTRADHAR_NODE_NAME=...; SUTRADHAR_ENROLLMENT_CODE=... (only for enrollment). Start npm run edge:start as a supervised process. A PC gets one persistent random node ID, its own Ed25519 key and independent agent IDs. NEVER duplicate identity.json across machines.

The identity file resides in a user-restricted directory, default ~/.sutradhar/v7/identity.json (mode 0600 on POSIX). This fallback is not a Windows/macOS OS credential vault; a hardened platform vault integration remains required before production. Agents send one aggregated Ed25519-signed heartbeat every 60 seconds. Central uses its MySQL clock; ~180 seconds without accepted heartbeat makes an agent ineligible. No LLM calls are used for heartbeats.

Owner approves each node then each agent from the web control dashboard (or POST /v7/owner/command) with explicit master_eligible/qa_eligible flags. Authorize each project-agent separately using GRANT_PROJECT_AGENT with can_develop and/or can_qa. Unapproved agents cannot act.

Fresh Master election opens at 08:00 Asia/Kolkata, then Master is retained until its accepted lease expires or it is revoked. Backup 1 and 2 order is by first accepted eligible arrival and prefers distinct PCs. Failover increments epoch and fences old tickets; new Master verifies available checkpoints and recovery cursors, then sends explicit recovery ACK. If unfinished tickets need remote reconciliation, it stays in RECOVERING. Never elect locally while Central is unreachable.

## Developer and independent QA

Use the signed, project-ACL-scoped CLI. Configure SUTRADHAR_PROJECT_REPO (trusted absolute Git checkout with exact origin), SUTRADHAR_WORKTREES_ROOT (absolute), and SUTRADHAR_SUTRADHAR_ROOT (location of trusted sandbox scripts).

- npm run edge:worker -- list agent_id
- npm run edge:worker -- detail agent_id ticket_id
- npm run edge:worker -- prepare agent_id ticket_id — preflight immutable baseline + exact repository; create isolated local Git worktree, claim one server lease, write compact handoff under the private node directory
- Use authorized ChatGPT Web or Google AI Studio manually (Electron shell opens normal browser). Implement and commit only scoped source changes on the ticket branch.
- npm run edge:worker -- checkpoint agent_id ticket_id /absolute/summary.txt 'next action'
- npm run edge:worker -- submit agent_id ticket_id — verify clean Git worktree, exact branch/tree and file scope; submit signed candidate SHA (does not claim merge)
- On a different approved QA agent/PC, set a trusted local SUTRADHAR_TRUSTED_QA_COMMAND and run npm run edge:worker -- qa qa_agent_id ticket_id. It uses the existing Docker-isolated sandbox, stores a locally signed evidence receipt and reports success/failure. Docker/test dependencies must be prepared in that tested environment; it never runs on Hostinger.

Worker publication and draft PR creation remain separate, Owner-enabled guarded v6 Git operators. A submitted candidate is not DONE. DONE is accepted only after an independently passing QA receipt plus exact live read-only GitHub PR/CI/merge/tree/reviewer verification, using POST /v7/tasks/verify-merge with the Owner key. Never edit or push protected main automatically.

## Real acceptance and limitations

Run npm run lint; npm test; npm run build; npm run test:v7-mysql against a **disposable** MySQL 8 instance; test all 71 V7 matrix scenarios and inspect GitHub Actions CI. Live Hostinger HTTPS, MySQL backup/restore, Ed25519 key rotation, real 2-PC failover, secure OS vault, provider browser compatibility and real GitHub PR review/merge/rollback still require user-controlled environments and independent evidence. These are NOT passed just because this code is committed.

Review SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md, AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md and V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md as the authoritative contracts. Never claim a simulated or mocked test as production acceptance.
