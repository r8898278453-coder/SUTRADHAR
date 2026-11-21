# Codebase Map

## Architecture Overview
Sutradhar Multi-Agent Swarm Orchestrator — **current code reflects legacy v5.4/v6.0, NOT a production-ready v7.0 cluster**.

**Target documents (SPECIFIED, not implemented):**
- [Architecture v7.0](docs/SUTRADHAR_ARCHITECTURE_BLUEPRINT_V7.md)
- [Agent / Task / QA / Recovery Contract v7.0](docs/AGENT_TASK_QA_RECOVERY_CONTRACT_V7.md)
- [V7 Requirements / Acceptance Matrix](docs/V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md)

The target architecture uses Hostinger Business + MySQL and Electron worker agents, while the code below still uses SQLite and partial simulator/in-memory state. Use [Implementation Tracker](docs/IMPLEMENTATION_TRACKER.md) for actual verification status.

### Entry Points
- `server.ts`: Express control plane + Vite dev middleware + REST API endpoints on port 3000.
- `server_db.ts`: Authoritative SQLite transactional database layer (`DatabaseSync` on `.sutradhar_state/cluster.db`).
- `index.html`: Client SPA entry point mounting React root (`src/main.tsx`).
- `src/App.tsx`: Central frontend dashboard component managing cluster state polling, failover triggers, ticket actions, and view routing.

### Backend Infrastructure (`server.ts` & `server_db.ts`)
- **Shared State DB (`server_db.ts`)**:
  - `system_state`, `workers`, `projects`, `tickets`, `ticket_dependencies`, `worker_leases`, `audit_log`, `configuration`, `model_usage`, `merge_queue`, `execution_attempts`, `revoked_tokens`.
- **Core Security**:
  - `generateEd25519Token` / `verifyEd25519Token` with Master Ed25519 Keypair in `.sutradhar_state/secrets/`.
- **REST Endpoints**:
  - `GET /api/cluster/state`: Authoritative cluster state + ASCII Live Card.
  - `GET /api/db/all`: Full dump of all 6 core database collections.
  - `POST /api/cluster/ticket/create`: Dispatches new DAG tasks or P0 hotfixes directly into SQLite.
  - `POST /api/tickets/claim`: Atomic ticket claim with DAG dependency verification and worker cap enforcement.
  - `POST /api/cluster/ticket/synthesize`: Code synthesis using `@google/genai` (`gemini-3.8-flash`) with usage tracking.
  - `POST /api/cluster/ticket/test`: Sandbox test execution with 3-tier normalization, execution attempt logging, and dependency unblocking.
  - `POST /api/cluster/ticket/self-heal`: Context-preserved error healing re-prompting with `gemini-3.8-flash`.
  - `POST /api/cluster/ticket/verify-push`: Cryptographic gatekeeper pre-receive verification with real commit SHA tracking.
  - `POST /api/cluster/watchdog/heartbeat`: Worker lease heartbeat update.
  - `POST /api/cluster/watchdog/revoke`: Explicit lease revocation and ticket recycling.
  - `POST /api/tickets/:id/block-clarification`: Halts assumption, records clarification question, frees worker.
  - `POST /api/tickets/:id/answer-clarification`: Applies human answer and returns ticket to PENDING.
  - `POST /api/master/rollback`: Rollback of bad merge, creating an auto-revert hotfix ticket.
  - `POST /api/config/prompts/version`: Switches active prompt version (v1/v2).
  - `GET /api/cluster/security/public-key`: Exports master Ed25519 public key.
  - `POST /api/cluster/security/verify-token`: Standalone token validator.

### Python Core Swarm Engine (`core/`)
- `crypto_signer.py`: Asymmetric Ed25519 signing/verification with OpenSSL CLI fallback.
- `state_db.py`: SQLite connection client with local disk cache fallback.
- `llm_router.py`: Context-preserving LLM cascade router (`gemini-3.8-flash` -> OpenRouter).
- `patch_validator.py`: 3-tier diff normalizer with whitelist blast radius validation.
- `merge_queue.py`: Automated rebase engine with sequential fast-forward merges.
- `leader_election.py`: Consensus protocol with monotonic epoch fencing.
- `protocol.py`: Sutradhar wire message serialization and regex extraction.
- `repo_mapper.py`: AST syntax parser and prompt context assembler.
- `telegram_hub.py`: Telegram bot listener and command handler.

### Frontend Components (`src/components/`)
- `TaskDAGView.tsx`: Interactive DAG dependency graph, node claiming, human review, clarification handling, rollback.
- `ClusterNodeGrid.tsx`: Real-time node status cards, roles, uptime, and health diagnostics.
- `TelegramFeed.tsx`: Live feed of wire protocol transmissions and cluster alerts.
- `SecurityAuditView.tsx`: Cryptographic audit log, Ed25519 token validation, and whitelist verification.
- `SharedStateInspector.tsx`: SQLite shared state inspector and epoch consensus tracker.
- `ArchitectureBlueprintModal.tsx`: Visual architectural reference for Blueprint v5.4.

### Test Suites (`tests/`)
- `tests/security_ed25519.test.ts`: 16 automated cryptographic verification vectors.
- `tests/cluster_db.test.ts`: 9 automated tests for SQLite transactions, dependencies, claims, watchdog, and rollbacks.
- `tests/e2e_lifecycle.test.ts`: 15 automated end-to-end integration tests covering Master CAS election, DAG dependencies, claims, sandbox failure/healing, Ed25519 commit verification, child ticket unblocking, clarification, kill-switch, rollback, and watchdog sweeps.
