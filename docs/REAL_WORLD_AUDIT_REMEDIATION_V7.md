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
- **Limit:** This is not the OS-vault worker bridge. Checkpoint/submit operation journals, long-running worker lease renewal, and crash/failover reassignment are still incomplete. A local journal is not a substitute for a Central signed receipt.

## Next prioritized work

1. **RWA-003** — Complete actual work execution using a strictly allowlisted Electron OS-vault signer, per-agent scopes and project/worktree permissions; no plaintext key in packaged worker.
2. **RWA-004 + RWA-008 remainder** — Signed progress lease renewals with bounded budgets, expiration scanner and safe reassign/reconcile, plus durable checkpoint/submit receipts.
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
