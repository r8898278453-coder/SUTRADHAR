# SUTRADHAR v7 — Real-world failure audit remediation, first implementation slice

**Date:** 19 November 2026 (Asia/Kolkata)  
**Status:** Draft PR #1 source-only; **no production approval, Hostinger deploy, Windows signed release or physical-PC acceptance**.

This is a traceable engineering response to the 19 November real-world audit. It documents implemented source changes **and deliberately unresolved dependencies**. Keep the audit's full incident/failure taxonomy as the decision contract.

## RWA-001 — One Master recovery validator for both node implementations

- Packaged OS-vault `apps/desktop/secure-agent.ts` now calls the same `v7/recovery_validation.ts` validation used by the developer agent.
- Exactly **300** recent events are permitted; old history is summarized by high-water mark, not treated as unresolved work.
- Invalid epoch, phase, manifest digest, checkpoint hash, ticket duplication and unresolved Git publication **still block** recovery.
- Tests: `tests/v7_recovery_validation.test.ts`, `tests/v7_packaged_agent_contract.test.cjs`, real disposable-MySQL recovery with 320+ historical audit events.

## RWA-002 — Connectivity is not a task status

- Signed heartbeats may report `ONLINE` to mean the process is connected.
- Central now derives `IDLE` / `BUSY` and `active_ticket` from authoritative unfinished ticket ownership, live task leases and unresolved QA/Git publication jobs.
- A declared `BUSY` or `BLOCKED` can only make readiness more conservative; `ONLINE` or `IDLE` cannot override active Central evidence. Unknown activity strings are rejected.
- Real MySQL test sends the packaged-style `ONLINE` heartbeat for an idle agent, then for one with a real claimed lease, and checks `/v7/nodes/me` responses.
- **Limit:** Desktop still requires real target-OS tests. The present v7 worker does not generate autonomous provider activity reports.

## RWA-006 + RWA-010 — Central policy and Git planning parity

- `v7/rules.ts` has `isProtectedScope` for Central/Desktop, scripts, sandbox, shared contracts, GitHub configuration, signers and root build manifests. A self-declared LOW risk cannot skip the Owner proposal gate.
- `validTaskBranch` is shared by task planning and remote Git read verifier; unsupported nested/invalid branch refs fail before task creation.
- Tests cover protected roots, lookalike ordinary paths, wrong branch names and an actual LOW-declared sensitive ticket that remains `WAITING_AUTHORIZATION` in MySQL.
- **Limit:** Stronger semantic contract locks, central calculated risk taxonomy, and independent verification of Git test evidence remain required. Python publisher uses a separate narrower-compatible grammar; a generated cross-language contract is preferable.

## RWA-008 — Developer worker crash/timeout between claim and receipt

- The developer-only `v7/worker_claim_journal.ts` writes an exclusive, checksummed, flushed intent **before** the signed `/v7/tasks/claim` call.
- After an ambiguous or lost response, `worker prepare` reuses the exact request ID, agent, ticket, original expected ticket version and Master epoch. Central returns the original idempotent lease receipt; never create a second claim.
- If the ticket, branch, repo, scope, agent, epoch, local journal or remote claim status differs, the CLI fails closed. It saves a local lease receipt before removing the pending intent.
- Tests cover stable replay, rejected stale epoch/stolen identity/tampered record, and the real disposable-MySQL idempotent claim receipt.
- **Limit:** This is not the OS-vault worker bridge. Checkpoint/submit operation journals, automatic worker operation, and crash/failover reassignment are still incomplete. A local journal is not a substitute for a Central signed receipt.

## RWA-003 + RWA-008 — Packaged Windows verified candidate submission (fourth alpha phase)

- Added an **explicitly confirmed** OS-vault-signed exact candidate submission from packaged Windows Setup: `POST /v7/tasks/submit`. The existing supervised heartbeat child still cannot sign worker mutations, while renderer cannot submit a raw body or choose arbitrary endpoints.
- Before submission: verify original worker claim identity, approved Master/current live lease, a real Central checkpoint, a trusted Git worktree, a clean committed HEAD and tree, and the exact baseline ancestry. Inspect NUL-safe raw diff and allow only regular, added/modified files within approved scopes. Forbid deletions, renames, symlinks, submodules, mode changes and Git metadata affecting future checkouts.
- Durable per-ticket submission intent is created before HTTP; after a timeout the exact original request ID and immutable SHA are replayed only if Central is still in pre-submit state. If Central already holds matching `SUBMITTED_FOR_REVIEW` hashes, a new signed read-only task detail confirms this without another POST. Mismatched local/remote commit requires Owner review.
- A distinct local verified submission receipt is created before removal of the pending intent. No provider command, Git push, PR/merge, QA approval or release can be triggered through the new interface.
- **Known gap:** Central records a candidate hash but does **not** automatically receive its Git object, so it cannot yet prove that a different QA PC can retrieve exactly that candidate. Independent trusted publication, QA artifact verification and real multi-PC acceptance remain production gates.

## RWA-003 + RWA-004 — OS-vault checkpoint and bounded renewal (third alpha phase)

- The Windows packaged Setup window now allows an *explicitly confirmed*, human-written checkpoint summary/next action and a separate, reasoned bounded renewal. Electron Main adds only the exact signed `POST /v7/tasks/checkpoint` and `POST /v7/tasks/renew-lease` contracts. The existing private heartbeat child cannot invoke either signing capability.
- **Before every operation:** verify exact original claim identity, user-owned Git checkout and current Central signed resume; reject unapproved PC, missing heartbeat, installer/maintenance hold and stale Master. Central separately checks task ownership, live original lease and four-hour absolute claim budget. No autonomous execution is authorized.
- Persist an exclusive, flushed per-ticket progress intent **before HTTP**; retry only the original signed request ID and identical payload after an ambiguous response. A different operation, changed summary, tampered journal or changed Master fails closed.
- After Central acknowledgment, separately confirm the original lease is still live. For checkpoints additionally compare exact remote generation, summary, next action and content SHA-256; only then durably write a verified receipt and remove the pending intent.
- Tests verify the same OS-vault signing boundary using real local Git, artificial lost HTTP response, stale state, corrupted journal, changed progress payload and mismatched checkpoint evidence. This is source/CI testing, **not** independent QA or real installed-PC acceptance.
- **Still missing:** OS-vault candidate submission and protected Git publication, QA artifact independence, automatic lease expiry reconciliation and Master task intelligence. Do not interpret checkpoint acknowledgments as proof of passed tests.

## RWA-003 — OS-vault manual claim and signed continuity proof (second alpha phase)

- The packaged Windows Setup window may now initiate an **explicitly confirmed** single-ticket claim after the human selects an existing trusted local Git checkout. No code execution / Git push / AI automation is delegated to the renderer or heartbeat child.
- Electron Main's `signWorkerAction` has two **separate fixed contract endpoints**: exact `POST /v7/tasks/claim` and read-only `POST /v7/tasks/resume-check`. The pre-existing `sign(kind:'node_api')` supervised child bridge remains unchanged and cannot invoke this signer. The private key remains inside the OS-backed Electron vault.
- Before claim, app checks GitHub repository origin, immutable local baseline, Git filters/hooks, project worktree, current Master phase and a fresh approved signed heartbeat/maintenance state. Central independently enforces Owner-approved node/agent/project grants, scopes, deps, capacity and Master epoch.
- A private, checksum-protected local **claim intent is flushed before HTTP**; lost replies replay the same request ID without creating a second claim. A durable local lease receipt and signed current Central resume proof are required before acknowledging a successful claim. Stale epoch, changed scope, invalid journal and existing receipt fail closed.
- New CI tests exercise real local Git worktrees, Ed25519 canonical signatures, ambiguous reply replay, stale Master epochs and rejection of mismatched repository/receipt. This is **source and QA CI** verification, not a physical installed PC test.
- **Still missing:** Packaged OS-vault candidate submission and trusted independently verified QA; an autonomous AI worker/provider orchestrator; Windows Git installer/prerequisite wizard; automated lease expiry/reassignment; end-to-end physical Windows and Hostinger acceptance. The local Git checkout must already be trusted by the Owner.

## RWA-003 — OS-vault packaged worker bridge, first read-only phase

- Windows Electron Main can now use an independent `signWorkerReadOnly` vault capability to query signed HTTPS `GET /v7/tasks/available` and `GET /v7/tasks/detail/:ticketId` on behalf of one of its own approved local agents. A sandboxed Setup UI chooses the agent and displays text-only results.
- This signing method is **not reachable by the supervised heartbeat child IPC**. It requires a packaged Windows PC, locally submitted enrollment, recent Central heartbeat acknowledgement and no active maintenance/recovery/installer hold. Central verifies agent approval and project ACL independently.
- Untrusted response size and shape are bounded, redirects are denied and arbitrary schemes/hosts/paths/payloads are impossible. Unit regression tests verify the Ed25519 signature over the exact GET path, reject write endpoints and wrong-agent requests and verify release packaging includes the inspection module.
- **Not yet worker execution:** This intentionally grants no task claims, worktree/Git writes, renewals, QA, push, model provider automation or browser session access. A separate Owner-reviewed worker-execution contract and real Windows target-host tests remain required.
- **On failure:** Keep task execution disabled. Check Owner grants/project ACL, Central connection and maintenance holds. Do not copy private keys into plaintext identity files or enable the older developer CLI to bypass the OS vault.

## RWA-004 — Signed bounded active-task lease renewal (manual alpha)

- Central has a signed `POST /v7/tasks/renew-lease` endpoint for the **same approved agent, same ticket/lease ID, current Master epoch and READY unpaused cluster**. Expired leases and stale/Owner-revoked Master authority cannot be renewed.
- The initial claim sets the ticket's `updated_at` in MySQL; current schema does not automatically rewrite that column on checkpoint. It is the server-side anchor for an **absolute four-hour claim lifetime**. Each accepted renewal grants at most 600 more seconds, never past the deadline. Requests made with more than seven minutes left are rejected.
- The existing `/v7/tasks/checkpoint` renewal is now bounded by the **same absolute deadline**. A checkpoint cannot silently bypass the manual renewal budget.
- CLI operator workflow: build worker source, then `npm run edge:worker -- renew AGENT_ID TICKET_ID "Reviewed changes and continuing scoped task"`. The PC must already be enrolled in the **developer-only alpha identity mode**, have a trusted worktree, and have an unexpired claim from that same Master epoch.
- The CLI performs an existing signed read-only resume preflight, writes an exclusive local `renew_<ticket>.json` intent **before HTTP**, replays the same request ID after ambiguous results, verifies the response, and checks the **live lease again** before clearing the intent. It does not auto-run provider/Git commands.
- Checkpoint and renewal updates use the Central DB clock; operator wall-clock claims are not trusted. Tests cover in-memory policy budgets plus real disposable MySQL (due/early requests, idempotent lost-reply replay, different agent, cap refusal on both renewal and checkpoint).
- **Failure action:** On expired lease, spent four-hour budget, changed Master epoch, corrupt local journal or unclear Central reply, stop coding/pushing. Preserve local evidence for Owner reconciliation. Never delete a pending journal just to fabricate a fresh renewal.
- **Remaining limitations:** No packaged OS-vault worker bridge yet; no autonomous progress monitor, automatic safe reassignment, per-project quota scheduler, or independently verified QA artifact chain. Four hours is an initial conservative contract and must be reviewed with real worker workloads before release.

## Next prioritized work

1. **RWA-003** — Complete actual work execution using a strictly allowlisted Electron OS-vault signer, per-agent scopes and project/worktree permissions; no plaintext key in packaged worker.
2. **RWA-004 + RWA-008 remainder** — Finish packaged OS-vault signing integration, progress-aware monitoring, lease expiry scanner and authorized reassignment/reconcile; add durable checkpoint/submit receipts. Manual bounded renewal alone is insufficient.
3. **RWA-007** — Independently verified QA artifacts and physical QA host separation for high-risk work. A QA agent's `passed:true` is only an attestation today.
4. **RWA-005 + RWA-011** — Versioned Master knowledge, natural-language Task Creator, dependency DAG, semantic locks, provider registry, quotas and deterministic recovery controller.
5. **External gates** — Hostinger real staging/MySQL restore, full supply-chain clearance, production signing, Windows physical pilot, live protected GitHub PR/merge and Owner acceptance.

## Failed-step operator guidance

- **No HTTP claim receipt:** keep the pending claim file and run the same `worker prepare` only while the same agent, ticket, branch and live Master epoch remain trusted. It replays the saved ID. Never delete the journal to bypass a conflict.
- **Central says stale Master or changed task:** stop task work; obtain current authoritative recovery status. Do not create a fresh claim for an uncertain old operation.
- **Journal unreadable/mismatched:** stop; preserve a forensic copy, compare Central ticket and command audit as an authorized operator. Do not blindly overwrite the file.
- **Worker lease expires mid-session:** stop writes/Git; current implementation requires Owner-assisted reconciliation, **not** automatic reassignment.
- **Independent QA or external Git ambiguous:** no retry, merge or DONE until exact remote/test proof and approval.

Success in CI proves these **specific** source behaviors, not an autonomous production deployment. Always check workflow results for the exact final commit.
