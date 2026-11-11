# SUTRADHAR v7.0 — implementation and operator guide

> **Start here if you are the Owner:** [Non-developer setup guide](../docs/OWNER_SETUP_AND_DEPLOYMENT.md) · [Architecture/repository decision](../docs/ADR_001_MONOREPO_TWO_APPS.md) · [Release, update and recovery policy](../docs/RELEASE_OPERATIONS.md) · [Repository README](../README.md).
>
> **Important as of 12 November 2026:** This runbook describes **current alpha source code and technical experiments**, not a finished installer or approved production deployment. The future apps/central and apps/desktop split, one-click Owner approval/release screens, signed desktop installer and Hostinger promotion branch **do not exist yet**. Do **not** set a live Hostinger site to watch this draft fix branch. The current combined build runs at repository root (./); read the Owner guide before staging anything.


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

After independent QA has been accepted (task INTEGRATING), the **same QA agent** can use the v7 guarded Git bridge on a PC. Set SUTRADHAR_ENABLE_V7_GIT_PUSH=true and a limited SUTRADHAR_GITHUB_PUSH_TOKEN only on a trusted PC. Verify the trusted repository HEAD still equals the frozen baseline. Run `npm run edge:worker -- publish qa_agent_id ticket_id`. This invokes the existing Python `sandbox.push_tested_branch` publisher with an exact Docker-QA'd Git tree, creates a new branch only, and requests a separate server-side **read-only remote GitHub SHA/tree/parent/scope verification**. On network ambiguity, do **not** repeat publish; run `npm run edge:worker -- reconcile-push qa_agent_id ticket_id` for remote inspection. Pending/uncertain reservations are not automatically cleared.

Owner may enable `SUTRADHAR_ENABLE_PR_CREATION=true` plus a **separate** limited `SUTRADHAR_GITHUB_PR_TOKEN` on Central, then create a **draft-only** PR using the web dashboard or POST /v7/git/pr-draft. The Owner dashboard has a separate **Verify external merge** control. A submitted candidate is never DONE until independent QA, verified remote branch, draft PR, external independent approval + CI + merge, and exact read-only GitHub merge verification (POST /v7/tasks/verify-merge). The control plane never pushes or auto-merges main. Existing v6 Git and rollback controls remain default-off.

## Real acceptance and limitations

Run npm run lint; npm test; npm run build; npm run test:v7-mysql against a **disposable** MySQL 8 instance; test all 71 V7 matrix scenarios and inspect GitHub Actions CI. Live Hostinger HTTPS, MySQL backup/restore, Ed25519 key rotation, real 2-PC failover, secure OS vault, provider browser compatibility and real GitHub PR review/merge/rollback still require user-controlled environments and independent evidence. These are NOT passed just because this code is committed.

Review SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md, AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md and V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md as the authoritative contracts. Never claim a simulated or mocked test as production acceptance.

## v7 Git bridge caveats

The Git bridge is an alpha integration of the existing hardened publisher. Local QA evidence is signed by the approved agent; live target GitHub auth, reviewer independence and actual merged PR proof are **not yet acceptance tested**. Publishing is a one-shot remote mutation with durable reservation; failed/ambiguous attempts require reconciliation instead of blind retry. The QA PC needs Python 3.11+, Git, Docker and a trusted project checkout pinned to the frozen baseline. The existing Docker runner image is Python-oriented; other stacks need separately reviewed test images.

The 71 v7 acceptance cases are **not** completed simply because the workflow CI passed. Target Hostinger limits, physical 2-PC/10-PC network partition, provider web policies, OS key vault, backup/restore, full migration cutover and production rollbacks still require explicit Owner validation.
