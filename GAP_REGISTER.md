# Gap Register

| ID | Module | Description | Severity | Status | Mitigation / Notes |
|---|---|---|---|---|---|
| GAP-001 | Dev Server Lifecycle | Stale Node dev server process after container restart | MEDIUM | RESOLVED | Dev server rebooted via `restart_dev_server`, listening on port 3000 verified with curl |
| GAP-002 | TypeScript Compilation | Missing closing brace and handler typing in TaskDAGView & App.tsx | LOW | RESOLVED | Fixed syntax and handlers, `tsc --noEmit` passing cleanly |
| GAP-003 | Telegram Grounding | Telegram bot webhook polling requires real BOT_TOKEN | LOW | MITIGATED | Server gracefully handles missing token by logging and operating in autonomous local simulation mode |
| GAP-004 | Security Gatekeeper | In-memory token verification accepted forged tokens | CRITICAL | RESOLVED | Real Ed25519 asymmetric cryptography implemented in `server.ts` & `core/crypto_signer.py`. 16 automated tests passing in `tests/security_ed25519.test.ts`. |
| GAP-005 | Python Runtime | Syntax error in `core/protocol.py` (f-string backslash) & tuple unpack in `leader_election.py` | HIGH | RESOLVED | Standard regex concatenation used and 3-tuple unpacked. Python compilation test exits 0. |
| GAP-006 | State Persistence | Endpoints operated on ephemeral in-memory arrays instead of ACID database | HIGH | RESOLVED | Built-in Node 22 `node:sqlite` implemented in `server_db.ts` with 11 tables. All endpoints wired to transactional SQLite. |
| GAP-007 | Model Compliance | Deprecated/prohibited models referenced (`gemini-2.0-flash`, `gemini-pro`, `gemini-flash-1.5-8b`) | HIGH | RESOLVED | Models pinned to `@google/genai` compliant `'gemini-3.8-flash'` with `aistudio-build` header across TypeScript and Python routers. |
| GAP-008 | Telegram Security | Telegram command handling vulnerable to spoofing and unescaped HTML injection | MEDIUM | RESOLVED | Implemented `escapeTelegramHtml()` and `isTelegramAuthorized()` restricting admin commands to authorized chat/user IDs. |
| GAP-009 | Browser UX Constraint | `window.alert` used in TelegramLiveCard for test pings violating iframe environment constraint | LOW | RESOLVED | Replaced `window.alert` with reactive inline notification banner and auto-dismiss. |
| GAP-010 | Lifecycle Verification | Lack of comprehensive end-to-end integration test validating Master-Worker-DAG-Ed25519 loop | HIGH | RESOLVED | Implemented `tests/e2e_lifecycle.test.ts` covering 15 distinct assertions across the full workflow (15/15 PASS). |

