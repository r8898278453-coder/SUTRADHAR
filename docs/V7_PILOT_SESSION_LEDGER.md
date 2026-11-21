# Owner physical-pilot session replay guard (v7 alpha)

The separate offline Owner evidence verifier checks a signed file index and snapshot policy, but is **stateless**. A signed index can be replayed in a later review unless the Owner independently remembers consumed sessions.

## Optional one-time local session registration

On the separately trusted **reviewer** workstation, first verify the Owner-signed index with:

    npm run ops:verify-pilot-evidence

Create an **existing, private, backup-protected directory outside the repository** (on Unix use mode 0700; on Windows have the directory ACL reviewed and restrict it to the Owner). Supply its ABSOLUTE path in \`SUTRADHAR_PILOT_SESSION_LEDGER_DIR\`. Keep the same Owner public-key, signed envelope, session ID, exact source SHA and three evidence-file environment variables used by \`ops:verify-pilot-evidence\`, then run:

    npm run ops:register-pilot-session

This command re-verifies the Ed25519 signature, exact session/commit, evidence hashes, snapshot chronology, failover/sticky policy and Owner intent **before** making one exclusive \`<session_id>.json\` file in the private register. It never overwrites a file. Running the command again for the same session **fails**, including if a prior crash left a partial file. On Unix the file is created mode 0600 and synchronized along with the directory, or the command fails closed when sync is uncertain.

The record hashes the public key, signed envelope and all three evidence files. The private key is never opened by this command. Do NOT edit, delete or reset a record to obtain another pass; escalate an ambiguous/partial entry to the Owner and use a *new* independently reviewed session after resolving the incident.

## What this does NOT establish

- It does **not** prove any physical PC, a genuine Windows reboot/installer event, Windows DPAPI preservation, actual signed heartbeats, Hostinger acceptance, or safe failover.
- The local ledger is **not tamper-proof, globally synchronized or anti-rollback storage**. File deletion, backup restoration, permission bypass, different workstations or Owner register substitution can defeat cross-run replay detection. Maintain a second independent, access-controlled Owner ledger and protected backups.
- Windows directory/file ACLs, process crashes and power-loss durability must be physically reviewed; the code does not claim them verified.
- The result always states \`physical_test_verified:false\` and \`production_release_authorized:false\`. It never modifies Central, runs an installer, merges a PR, releases a hold or authorizes production.

Run \`npm test\` / \`npm run test:ops\` for the synthetic negative-case tests; they are not real physical acceptance.
