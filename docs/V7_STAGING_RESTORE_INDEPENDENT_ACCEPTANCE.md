# SUTRADHAR v7 — Independent staging restore and signed evidence-file verification

Date: 20 November 2026. Alpha. Owner-controlled operator procedure; never production release approval.

## Separate systems and proof boundaries

SUTRADHAR uses one monorepo with two independently deployable products: MySQL/Node Central on Hostinger and separately released Windows Desktop PCs. Only disposable CI MySQL is operated automatically by repository tests. The scripts in this guide are offline/operator-only; no live Hostinger account, production database, real Windows PC or actual Owner keys were used.

Encrypted backup authentication proves the archive format and AES-256-GCM tag. Restoring into an initially empty, separately named staging database proves only that MySQL accepted the dump. The new independent read-only content verifier additionally compares the CURRENT source and restored target snapshots: tables, full column inventory, indexes, internal foreign keys, deterministic primary keys, counts, and cryptographic row digests. **It does not prove that the source was unchanged between the historical backup and verification**. For authoritative recovery, independently freeze source writes at backup, document time and source/target server identities, and retain the protected Hostinger deployment/backup logs. Use a DBA and restrict both database logins to read-only SELECT when running verification. If source was modified, stop and do not interpret a mismatch as grounds to overwrite anything.

## Owner workflow (no coding required)

1. Provision an isolated Hostinger staging website and two distinct databases with approved access; never connect the current draft fix branch directly to production. Record full approved source SHA, backup source, restored target and staging URL in a private evidence register.
2. Approve and run the existing encrypted backup tool on a trusted operator workstation after source quiescence. Record its encrypted archive SHA-256 receipt and keep the backup key off GitHub/chat. Authenticate the archive with ops:verify-backup.
3. Approve an initially EMPTY test/staging target DB and run existing ops:restore-staging only there. Never restore over a nonempty DB, production schema, or another Owner's staging database.
4. Switch to dedicated read-only MySQL credentials that can SELECT both source and restored databases on the approved DB host. Review the exact environment names below. Run ops:verify-staging-restore. Keep the receipt in a separate access-controlled Owner evidence folder; do not publish raw database rows, credentials or the decrypted backup.
5. Independently review that the backup and restored state relate to the same frozen source, the real Hostinger deployment log, schema migration plan, test cases, measured restore time and risk assessment. A matching row digest alone does not justify production rollout or migration.
6. Only after separately gathering real CI, Hostinger, Windows signing and physical-PC evidence for G0–G7, produce an Owner-signed acceptance index. Run existing ops:verify-owner-acceptance for signature/format checks. Then optionally run ops:verify-owner-evidence-files with separate private local file mapping to confirm each of the eight referenced hashes matches real accessible local bytes. Both verification commands remain inspection-only and never grant production permission.

## Operator-only environment for read-only staging restore verification

Set these values privately on a trusted workstation, not in a PR, terminal recording or chat:

- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD: restricted MySQL credentials with read access to BOTH databases on that host.
- DB_NAME: exact original approved backup SOURCE database name.
- SUTRADHAR_TARGET_DB_NAME: separate, previously restored STAGING database name.
- SUTRADHAR_RESTORE_VERIFY_SOURCE_DB_NAME: exact repeated source DB name authorized by Owner.
- SUTRADHAR_EXPECTED_TARGET_DB_NAME: exact repeated staging target name.
- SUTRADHAR_RESTORE_VERIFY_APPROVED=yes: explicit current Owner approval for this read-only comparison.
- SUTRADHAR_ENCRYPTED_BACKUP_PATH: full absolute path to immutable encrypted archive.
- SUTRADHAR_BACKUP_KEY_BASE64: original 32-byte AES key encoded as base64, loaded from trusted secrets manager.
- SUTRADHAR_RESTORE_VERIFY_BACKUP_SHA256: exact 64-character encrypted backup SHA-256 printed by backup creation.

Then run **npm run ops:verify-staging-restore**.

The verifier authenticates the immutable encrypted archive before database access. It opens separately named MySQL databases in REPEATABLE READ consistent read-only transactions. It never issues DDL/DML, logs passwords, writes decrypted dumps, or authorizes deployments. It refuses untrusted table names/engines, non-primary-key tables, schema/foreign-key/index drift, row-count mismatches, or changed row content. Read volumes are deliberately bounded (128 tables, 100,000 rows per table, 500,000 total rows, 1 MiB maximum per row, 256 MiB total row bytes). Larger datasets require a separately reviewed operator procedure; NEVER silently skip tables or truncate data and label it PASS. The operator must verify actual privileges, source quiescence and timing independently. A CI test uses disposable MySQL, real mysqldump/restore and a negative tampered-row test.

## Owner acceptance: verify actual local evidence bytes, never self-attest

The offline signed envelope already accepted by ops:verify-owner-acceptance has eight G0–G7 entries with evidence_sha256 fields. Create a separate small, private local mapping JSON file of the following shape (replace placeholders with actual absolute paths on the reviewing workstation):

{
  "schema": 1,
  "artifacts": [
    {"gate_id":"G0","path":"/private/evidence/g0.bin"},
    {"gate_id":"G1","path":"/private/evidence/g1.bin"},
    {"gate_id":"G2","path":"/private/evidence/g2.bin"},
    {"gate_id":"G3","path":"/private/evidence/g3.bin"},
    {"gate_id":"G4","path":"/private/evidence/g4.bin"},
    {"gate_id":"G5","path":"/private/evidence/g5.bin"},
    {"gate_id":"G6","path":"/private/evidence/g6.bin"},
    {"gate_id":"G7","path":"/private/evidence/g7.bin"}
  ]
}

Privately configure: SUTRADHAR_OWNER_ACCEPTANCE_FILE, SUTRADHAR_OWNER_ACCEPTANCE_PUBLIC_KEY_FILE, SUTRADHAR_EXPECTED_COMMIT_SHA and SUTRADHAR_OWNER_EVIDENCE_MAP_FILE (all exact files/paths; the first three are the same settings used by the existing verifier). Run **npm run ops:verify-owner-evidence-files**.

The new verifier first checks the Ed25519 signature/format of the eight-gate Owner envelope using independently pinned public key, then opens each of the eight separate local evidence files read-only. It refuses symlinked or missing files, duplicates, changed files, wrong SHA-256, and files larger than 64 MiB. The output contains only gate IDs, sizes and hashes—not raw evidence. Success proves byte integrity relative to an Owner-signed index, NOT that a real Hostinger/Windows/rollback test occurred or a reviewer told the truth. Independent reviewer must open and examine the underlying original files; actual G0–G7 acceptance and release sign-off remain **Owner-controlled real-world processes**.

## Alpha safety status

Do not connect production databases, sign/install Windows packages or merge main based on these tests. No migration is run by these inspection commands. Owner acceptance gate and production_release_authorized flags remain FALSE even with all valid local hashes. Continue real staging, distinct physical Windows PCs, protected GitHub branch checks, authorized signed installer and rollback gates before promotion.