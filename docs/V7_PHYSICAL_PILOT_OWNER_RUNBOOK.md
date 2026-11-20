# SUTRADHAR v7 — Owner physical Windows PC acceptance pilot

**Status: alpha / HOLD.** This offline Owner evidence workflow is not proof that a real test happened. CI uses mocked Central snapshots and synthetic signatures, not genuine physical PCs, real OS-vault keys or a production installer.

## Owner workflow — nondeveloper guide

1. Keep production and main untouched. Provision Hostinger staging independently, with approved Windows PCs on genuinely separate hardware. Record each actual Windows machine serial or asset label, operating system, separately enrolled node ID, public OS-vault fingerprint, test operator, and exact Central source SHA in a PRIVATE Owner ledger, not in Git or chat.
2. Pin the exact Central staging hostname independently. Set private environment values SUTRADHAR_CENTRAL_URL (the full HTTPS origin), SUTRADHAR_PILOT_ALLOWED_HOSTNAME (hostname only), SUTRADHAR_PILOT_SOURCE_SHA (the complete 40-character lowercase source Git commit), SUTRADHAR_PILOT_NODE_IDS (ordered comma-separated set of 2, 3, 8, 9 or 10 real node_ IDs) and SUTRADHAR_ADMIN_KEY (from your protected credential store). The pilot script only records a source SHA CLAIM; independently inspect Hostinger release manifest and deployed commit, and document the result separately.
3. Create a private folder accessible to the Owner. Set SUTRADHAR_PILOT_RECEIPT_PATH to the absolute path of a NEW baseline JSON file; run **npm run ops:pc-pilot**. It ONLY issues two GETs to the independently pinned Central /v7/health and /v7/cluster, checks healthy roles and online heartbeat timestamps, and writes a private never-overwritten snapshot with SHA-256. It never powers off, runs an installer, shuts down or elects a Master.
4. For a two-/three-PC failover pilot, a human physically isolates the ORIGINAL Master and records the independent action in a private physical witness file. Set SUTRADHAR_PILOT_INTENTIONALLY_OFFLINE_NODE_IDS to exactly that original Master's node_ ID and set SUTRADHAR_PILOT_RECEIPT_PATH to a different NEW after JSON file; repeat **npm run ops:pc-pilot**. For three-/eight-to-ten-PC sticky-Master role trials, leave the intentionally offline variable empty and create an after snapshot with every node still approved and online. Use exact same ordered node set and source SHA before and after.
5. The optional **npm run ops:pc-pilot -- compare** reads SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH and SUTRADHAR_PILOT_AFTER_RECEIPT_PATH and writes a different reviewed result at SUTRADHAR_PILOT_RECEIPT_PATH. It requires Backup 1 promotion on the original distinct physical node, exactly one leader epoch increment, former Master absent from fresh online nodes, exact node set and chronological timestamps. Never confuse this calculation with physical power/network proof.
6. Independently review the actual machine identities, original/offline Master, timestamps, screenshots, real Central logs, MySQL epoch/fence evidence, roles, and post-update or rollback/restart receipts. Put the true physical evidence in a separate protected witness file of 30 bytes to 16 MiB. Do not put credentials, signing keys or personal data in that file.
7. On an OFFLINE trusted Owner signing machine, generate a new random 32-hex session ID and prepare the session draft JSON below. Protect the Ed25519 private-key PEM using a secrets manager or a file with mode 0600 on Unix / independently reviewed Windows ACLs. Only after actually reviewing all physical facts set SUTRADHAR_PILOT_OWNER_ACKNOWLEDGED_REAL_WORLD_REVIEW=yes. Set SUTRADHAR_PILOT_DRAFT_FILE, SUTRADHAR_PILOT_OWNER_PRIVATE_KEY_FILE, SUTRADHAR_PILOT_OWNER_SIGNED_OUTPUT_FILE, and all three evidence file paths, then run **npm run release:sign-pilot-evidence**. It derives hashes from the ACTUAL files, verifies policy first, and creates an immutable one-hour Owner-signed envelope without making any network request or logging keys.
8. A distinct reviewer with the independently pinned Owner PUBLIC key sets SUTRADHAR_PILOT_OWNER_ENVELOPE_FILE, SUTRADHAR_PILOT_OWNER_PUBLIC_KEY_FILE, SUTRADHAR_PILOT_SESSION_ID, SUTRADHAR_PILOT_SOURCE_SHA, and the same three evidence file paths, then runs **npm run ops:verify-pilot-evidence**. It verifies signature, hashes, exact SHA, unique session, exact node set, timing and roles. It does not prevent cross-run replay by itself: track every used session in an independent private Owner register.

## Owner draft JSON example — dummy values only

<escape>
{
  "schema": 1,
  "source_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "session_id": "0123456789abcdef0123456789abcdef",
  "case_type": "failover",
  "central_origin": "https://stage.yourdomain.com",
  "expected_node_ids": [
    "node_11111111111111111111111111111111",
    "node_22222222222222222222222222222222"
  ],
  "owner_review_note": "Owner independently checked real physical PC identities, original Master isolation, private witness files, Central fencing, and observed timestamps."
}
</escape>

Choose case_type **failover** only for 2/3 PCs; case_type **sticky** for 3 or 8–10 PCs. The signer calculates all evidence hashes and signature; never hand-edit the signed envelope. All paths in the operator commands must be absolute, separate and access-controlled.

## Evidence limits and safety

A successful offline receipt says OWNER_SIGNED_PILOT_FILE_HASHES_AND_POLICY_VALID_ONLY, not a physical PASS. The output always marks physical_test_verified:false, node_key_possession_verified:false, installer_success_verified:false and production_release_authorized:false. The signature binds claimed Central states and a witness-file hash but does not itself prove the Central was honest, the node public keys remain in separate Windows vaults, the real machine was disconnected, or any task/installer/rollback safely completed.

Additional Owner G4–G6 proof must include real DPAPI continuity over reboot/login, unique Windows hardware and authenticated node fingerprints, 60-second signed heartbeats, 08:00 IST election behavior and sticky Master, exact Backup 1/2 succession, lease/epoch task fencing, independent QA, confirmed no duplicate Git side effects, real Authenticode, and Owner-approved rollback and 8–10-PC load trials. These scripts DO NOT prove all of those. Existing G0–G7 signed Owner acceptance and independent human review still control production.

**Security:** The Central snapshot GET refuses arbitrary URL inputs, nonpublic DNS, redirects, cookies, cache and oversized JSON. DNS precheck alone does not pin the TLS connection and does not replace network egress controls. No automatic installer, shutdown, failover, restart, rollback, PR merge, migration or Hostinger production operation is permitted.

## 20 November — Interactive Windows node continuity and 60-second heartbeat audit

### G4: One physical Windows PC, same-key BEFORE/AFTER proofs

1. On the Owner's separately trusted workstation, generate a private random 32-hex session ID. Prepare a challenge JSON containing schema=1, session_id, source_sha (exact full 40-hex installed SHA CLAIM), central_origin (the same exact HTTPS origin configured in Desktop), expected_node_ids (2–10 distinct node_ IDs), issued_at_ms and expires_at_ms. The window must be short, future-valid, and at most seven days. The installed source SHA must be verified against the real Hostinger/release manifest independently; neither the challenge nor receipt does that.
2. On an already-enrolled packaged Windows Desktop, click **Export signed BEFORE / AFTER node-key continuity evidence**, choose that reviewed challenge, choose BEFORE, and save a NEW private JSON file. The enrolled OS-vault private key stays in Electron main; neither the renderer nor the receipt contains it. The action never restarts, enrolls, installs or changes Central.
3. The Owner separately performs an actual Windows reboot/reinstall test and records OS event logs, real machine asset label, independent enrolled public key fingerprint, agent reconnect and Central acceptance. Reopen the Desktop with the original approved vault, choose the same challenge, choose AFTER, and save a different NEW private file.
4. On another reviewer machine, pin the device PUBLIC Ed25519 key from the original Owner/approved Central enrollment record (never extract the key from the supplied proof). Configure SUTRADHAR_PILOT_NODE_CHALLENGE_FILE, SUTRADHAR_PILOT_NODE_BEFORE_FILE, SUTRADHAR_PILOT_NODE_AFTER_FILE, SUTRADHAR_PILOT_NODE_PINNED_PUBLIC_KEY_FILE, SUTRADHAR_PILOT_NODE_ID, SUTRADHAR_PILOT_SOURCE_SHA, SUTRADHAR_PILOT_SESSION_ID and run **npm run ops:verify-pilot-node-continuity**. Repeat separately per node.
5. Verification checks same independent public key, exact Owner session/SHA/origin/node, valid Ed25519 signatures on both phases, a changed software boot ID, nondecreasing node/agent counters and chronological observation. A software boot ID change or signed local timestamp is NOT a verified physical OS reboot, DPAPI backend attestation, hardware clone detection or proof of Central authorization. Output ALWAYS records physical_reboot_verified:false, os_vault_backend_verified:false, central_approval_verified:false and production_release_authorized:false.

Owner challenge example with dummy data (replace all placeholders; never use this as real approval):

<escape>
{
  "schema": 1,
  "session_id": "0123456789abcdef0123456789abcdef",
  "source_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "central_origin": "https://stage.yourdomain.com",
  "expected_node_ids": [
    "node_11111111111111111111111111111111",
    "node_22222222222222222222222222222222"
  ],
  "issued_at_ms": 1795181400000,
  "expires_at_ms": 1795185000000
}
</escape>

No signed proof file can be overwritten. The session challenge is hashed into every Ed25519 receipt. Maintain an independent private Owner session ledger: a stateless verifier cannot detect reuse across separate experiments by itself.

### G5: Four or more read-only Central heartbeat samples

Using the same trusted host, existing approved node IDs, protected admin credential and exact source SHA settings described earlier in this guide, set SUTRADHAR_PILOT_RECEIPT_PATH to an unused private absolute file and run **npm run ops:pc-heartbeat-sample**. Manually repeat at approximately 60-second intervals, each with a DIFFERENT receipt path, at least four times and at most twelve. This operation only fetches bounded read-only Central health and cluster JSON; it does not send a heartbeat, run a timer, alter Master or interact with Windows.

Set SUTRADHAR_PILOT_HEARTBEAT_SAMPLE_FILES to those 4–12 absolute paths separated by semicolons (on Windows: C:\secure\sample-1.json;C:\secure\sample-2.json;C:\secure\sample-3.json;C:\secure\sample-4.json). Run **npm run ops:verify-pilot-heartbeats**. The offline audit checks monotonically advancing sample and per-agent Central last_seen timestamps, 45–95 second sampling intervals, 30–105 second Central acknowledgment progression, unchanged approved agent-to-node mapping, stable Master/backup/epoch, and non-stale records.

A successful result intentionally says CENTRAL_LAST_SEEN_60_SECOND_CADENCE_ONLY, signed_heartbeats_verified:false, physical_machine_verified:false, production_release_authorized:false. Real 60-second **node-signed packet** acceptance needs separate server nonce/Ed25519 logs, genuine physical nodes, and human inspection of missing acknowledgments/clock offsets. This collector alone cannot prove an actual reboot, 08:00 IST initial election, task-lease safety, failover, or rollback.

Keep full private BEFORE/AFTER key continuity receipts and cadence reports in the Owner witness/evidence register (with independent hashes). They are supporting G4/G5 artifacts, NOT full G0–G7 approval. Never upload keys, admin tokens, original device private data or sensitive Windows logs to GitHub/chat.


## 20 November — Optional one-time Owner session replay ledger

After the independently reviewed signed evidence verification, optionally register each exact Owner session once with `npm run ops:register-pilot-session`. The new offline command requires a pre-existing private Owner directory, re-verifies the signed evidence and refuses session reuse or partial-file overwrite. It does not certify real PCs, prevent tampering with the register or authorize production. See [Owner session ledger and limits](V7_PILOT_SESSION_LEDGER.md).
