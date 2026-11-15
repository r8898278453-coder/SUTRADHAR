# SUTRADHAR v7 — Owner-Signed Desktop Rollout Waves

**15 November 2026 | Draft PR #1 | Offline verification only; NO actual updater, deployment or installation.**

## Purpose

The first signed PC update must not be a globally reusable offer. The trusted Owner release signing key now signs **schema v2** metadata with a named rollout wave and an exact list of 1–10 existing OS-vault node IDs. The installed Desktop checks that its own node ID appears in the signed list. A matching offer may only be **inspected**, not executed automatically.

## Owner workflow

1. Complete independent QA and build a real stable installer with a trusted Windows Authenticode code-signing certificate. This has NOT yet been performed; the current installer is unsigned alpha.
2. In Central, review the currently approved individual PC node IDs. For the first wave select **one non-critical pilot PC**, e.g. `wave_pilot01` with 1 node ID. For later waves list only the additional explicitly approved machines. Never infer node IDs from PC display names.
3. On the trusted Owner Windows signing machine, retain the private Ed25519 release-offer signing key **outside Git**. The Owner must explicitly approve both the exact installer and the individual wave.
4. The release engineer uses the offline signer `npm run release:sign-offer` with the existing approved release settings AND the additional `SUTRADHAR_ROLLOUT_WAVE_ID=wave_pilot01` and `SUTRADHAR_ROLLOUT_NODE_IDS` as a comma-separated 1–10 element list of exact `node_` IDs. Set `SUTRADHAR_OWNER_ROLLOUT_APPROVED=yes` only after Owner approval. All other signer requirements (exact version, source SHA, Authenticode publisher, local signed-release evidence, installer path, protected Ed25519 key path) still apply.
5. A separate emergency downgrade offer requires `SUTRADHAR_UPDATE_KIND=rollback` and `SUTRADHAR_OWNER_EMERGENCY_ROLLBACK_APPROVED=yes`; it is independently signed for a specified wave. Normal update offers cannot authorize rollback.
6. On the selected **already enrolled** PC, use Desktop → **Verify a signed update file**. Select `SUTRADHAR Desktop.offer.json` adjacent to the signed installer. The local app checks OS-vault node identity, saved enrollment binding, signed v2 wave recipient list, version direction, metadata expiry, exact EXE bytes and Windows Authenticode publisher.
7. Read the displayed verified node ID/wave/version. **The app does NOT install the EXE.** A separate signed release distribution, identity-preserving install, safe rollback, physical QA and Owner acceptance procedure remain to be implemented.

## Fail-closed rules

| Condition | Result |
| --- | --- |
| Unsigned / schema v1 global offer | REJECT |
| Wrong node ID, missing/broken OS-vault identity or enrollment receipt | REJECT |
| Invalid/duplicate/too many wave recipients, malformed wave or Owner timestamp | REJECT |
| Expired or forged offer; wrong publisher, source/installer SHA, protocol or version direction | REJECT |
| Installer changes during signature check or is a symbolic link | REJECT |
| Legitimate signed update targeted to this PC | VERIFIED FOR INSPECTION ONLY, NOT INSTALLED |
| Owner separately approves real rollout after physical acceptance | Future release workflow requirement, NOT implemented |

## Current limitations

The public trust key is intentionally unset in the unsigned alpha, so this screen remains blocked until a real Owner-signed production build pins a trusted key. The rollout approval field is carried in metadata signed by the private key, not validated by any currently connected external approval service. The offline signer does not query Central's live device roster, and it cannot prove a PC is healthy. The full updater, wave delivery/pause/rollback orchestration, signed-install execution, protection against tampering after inspection, recovery of corrupted OS-vault identity and 2/3/8–10 physical PC acceptance are **NOT IMPLEMENTED OR NOT RUN**.

Never paste signing private keys, certificate secrets or enrollment codes into chat, GitHub, screenshots or this documentation. Review [Release Operations](RELEASE_OPERATIONS.md), [Owner Provisioning](OWNER_PROVISIONING_RUNBOOK.md) and [Implementation Tracker](IMPLEMENTATION_TRACKER.md) before signing any real artifact.
