# SUTRADHAR v7 — Owner release-gate handoff (17 November 2026)

**Decision: HOLD. Draft PR #1 only; no production deployment, release signing, installer execution, or merger approval.**

This checklist is the handoff from coded safeguards to **real-environment acceptance**. A passing GitHub build is not evidence that Hostinger, Windows certificates, or physical PCs work. The current branch head before this document was `367dc9124ea5fcba1b8e3ad2e38601ce98f3b32c`; its two PR-triggered workflows completed successfully (SUTRADHAR CI run 43742582888, Dependency Lock Integrity run 43742582887). All future approval requires new CI on the exact subsequently approved head.

## Gate ledger — do not promote based on self-reported PASS

| Gate | Current disposition | What an independent reviewer must inspect | Approval authority |
| --- | --- | --- | --- |
| G0 source + CI | SCOPED CI PASS at prior SHA; new HEAD pending | Exact immutable commit, all relevant Actions jobs, lockfile/advisory results, dependency license review, PR review | Owner + independent QA |
| G1 Hostinger staging | BLOCKED — no live evidence | Separate HTTPS staging domain, isolated MySQL, deployment log, deployed source SHA, read-only `ops:hostinger-preflight` receipt | Owner |
| G2 database recovery | BLOCKED — only disposable CI MySQL test | Encrypted export stored outside repo, verification, approved empty staging restore, record-by-record validation, measured recovery time | Owner + DBA |
| G3 Windows trust | BLOCKED — no certificate or stable tagged release | Real certificate identity, protected signing runner, Authenticode validated exact installer, verified signed offer scoped to pilot PC IDs | Owner + signer |
| G4 OS key continuity | BLOCKED — no physical Windows proof | Windows install/restart, DPAPI identity continuity, enrollment ambiguity, second-launch and tampering regression, distinct PC identities | Owner + QA |
| G5 role/failover | BLOCKED — no physical PC proof | Two-PC then three-PC then eight-to-ten-PC snapshots, 60-second signed heartbeats, sticky Master and 08:00 IST initial election, exactly-once epoch failover | Owner + QA |
| G6 update/rollback safety | BLOCKED — inspection-only, no installer execution | Durable drain fencing, external Git reconciliation, isolated wave signed install, post-install signed heartbeat, safe rollback, unchanged identity | Owner + independent QA |
| G7 go-live | BLOCKED | Owner-approved immutable Central and Desktop releases, documented MySQL migration/restore, independent security review and no unresolved P0 | Owner |

**Never treat a checklist mark, receipt JSON, test database, or CI environment variable as production authorization.** Keep protected production deployment ref unchanged. Do not expose credentials in PR comments, screenshots, logs, or this document.

## Exact sequence for the Owner (no coding required)

1. **Open [PR #1](https://github.com/r8898278453-coder/SUTRADHAR/pull/1)** and leave it in Draft. Inspect checks for the latest SHA. Do not click Merge or connect this branch to the production Hostinger site.
2. **Provision a separate Hostinger staging website and dedicated empty staging MySQL** using [the Owner provisioning runbook](OWNER_PROVISIONING_RUNBOOK.md). Record the staging domain and deployment source SHA privately. Secret values remain inside hPanel, not chat or Git.
3. **Ask an operator to run the read-only staging preflight** at the exact deployed SHA: `SUTRADHAR_STAGING_URL` and `SUTRADHAR_EXPECTED_COMMIT_SHA`; command `npm run ops:hostinger-preflight`. Retain receipt, Hostinger logs and MySQL readiness evidence. This does not apply schema or deploy.
4. **Rehearse encrypted backup and restore against disposable staging ONLY** per [production-readiness instructions](PRODUCTION_READINESS_V7_2026-11-12.md). Require source/target DB distinction, independent restored data checks, restoration time and Owner approval; never restore over a live production database.
5. **Obtain and protect a legitimate Windows Authenticode certificate and separate Ed25519 update signing keys** using a protected release signer. Do not send private keys to the assistant or commit them. Release script currently refuses alpha; do not bypass this.
6. **Test an isolated first physical Windows PC**, then 2-PC, 3-PC, and 8–10-PC scenarios. Collect real timestamps, distinct node IDs (redacted in public reports), signed role observations, failover epochs, task/checkpoint recovery and Owner-confirmed Git reconciliation.
7. **Independently review G0–G7**, upgrade PR from Draft only when approved, and explicitly authorize Central and Desktop promotions separately. A failed gate returns to HOLD; no automatic workaround.

## Evidence index template (private Owner register)

Create a separate access-controlled record for each gate. Minimum fields:
`gate_id`, `status` (BLOCKED / PASS / FAIL), `reviewer`, `reviewed_at_utc`, `exact_git_sha`, `environment` (ci / stage / physical-windows), `evidence_location`, `evidence_sha256`, `test_case_ids`, `limitations`, `owner_approval_reference`.

The evidence register is **not** a credential store. Prefer file hashes and private reference links; keep API keys, signing secrets, raw device keys and database passwords outside all evidence records. A gate PASS must name the actual environment and human reviewer. Expired/stale evidence must be reevaluated after changing installer, schema or commit.

## Explicit outstanding engineering work

- Stable reviewed release, Windows verified installer execution guard and protected signed rollout distribution.
- Versioned safe MySQL migrations and actual Hostinger staging plus owner-owned restore rehearsal.
- Reliable identity-preserving installer/update/rollback, post-install health and recovery path.
- Provider-compliant browser worker, full external-Git side-effect reconciliation, physical concurrency/failover and all 71 acceptance cases.

References: [current readiness](PRODUCTION_READINESS_V7_2026-11-12.md), [release operations](RELEASE_OPERATIONS.md), [PC drain fence](PC_DRAIN_FENCE_V7.md), [acceptance matrix](V7_REQUIREMENTS_ACCEPTANCE_MATRIX.md).

## Offline machine-readable evidence verifier (draft source)

The implementation under `scripts/release/verify-owner-acceptance.cjs` validates the **format and Ed25519 signature** of one Owner-signed, short-lived evidence index. It **cannot authenticate real-world facts without reviewing the underlying receipts**, cannot install software, and **always returns `production_release_authorized: false`**. It is a reviewer aid only, not a production promotion mechanism.

The envelope is JSON with exactly `payload` and `signature_base64`. Its signature is Ed25519 over UTF-8 bytes of `SUTRADHAR_OWNER_ACCEPTANCE_V1\\n` (actual newline after V1) followed immediately by `JSON.stringify(payload)`. Use a dedicated Owner-controlled signing key and an independently pinned public key (not a key shipped beside a self-asserted report). Never place the private signing key in code, test fixtures, CI artifacts or chat. The payload must contain `schema:1`, exact `source_sha`, millisecond `issued_at_ms` and `expires_at_ms` (valid for no more than seven days), and exactly one G0–G7 gate entry. Each PASS gate must name a reviewer, UTC review timestamp, same source SHA, required real environment, private evidence location, SHA-256, nonempty acceptance-test IDs, limitations and Owner approval reference. Unsigned, malformed, stale, wrong-target, duplicate, incomplete or blocked gate reports are rejected.

A trusted reviewer, on a private operator workstation, may check a prepared envelope as follows (paths must be absolute and controlled):

~~~sh
export SUTRADHAR_OWNER_ACCEPTANCE_FILE=/secure/acceptance-envelope.json
export SUTRADHAR_OWNER_ACCEPTANCE_PUBLIC_KEY_FILE=/secure/owner-acceptance-public.pem
export SUTRADHAR_EXPECTED_COMMIT_SHA=<full-reviewed-40-character-SHA>
npm run ops:verify-owner-acceptance
~~~

A PASS means **signed evidence-index syntax only**. The verifier does not pull files at `evidence_location` or check that their hashes match actual files; reviewers must do that independently. File hashes or references do not make a fictional test real. For this reason production promotion and Windows installation remain manual Owner-controlled processes. Regression coverage runs via `npm run test:release-gates` in existing CI, using temporary test-only keys with no relation to real Owner approval.

## Signed post-update continuity policy (code only, not wired to real installers)

`scripts/release/verify-post-update-health.cjs` exports `verify` for **offline, read-only** inspection of two device-signed `BEFORE` and `AFTER` observations, each carrying exact OS-vault node ID/key SHA-256, target release version, signed wave, signed offer hash, local approved/agent count/heartbeat fields and an observation timestamp. It rejects forged, stale, reordered, wrong-wave, wrong-key, wrong-version and changed-agent-count observations. `npm run test:release-gates` includes test-only cryptographic regression coverage.

**Limitations:** The runtime does not yet produce the required receipts on physical Windows systems. Self-reported `central_approved` is not independent Central authorization. Correct node signatures also cannot prove a real signed installer ran, that MySQL work was completed, that the OS clock was honest, or that rollback is safe. The returned field `installation_verified` is **always false**. A future implementation must obtain independent authenticated Central evidence, actual Windows Authenticode installation receipts, reboot/health telemetry and Owner-approved rollback policy before an installer executor is permitted.

## 17 November follow-on: immutable installer hash and staging schema drift

**Installer inspection hardening:** `apps/desktop/update-policy.cjs` hashes the already opened local file descriptor, validates pre-open and post-read file identity/size/timestamps, rejects symbolic links and oversized changed installer files, and still **never executes** an installer. CI regression includes symlink-file rejection. This narrows common inspection-time substitution attacks but cannot replace a privileged installation service that safely binds execution to already approved bytes.

**Read-only staging schema inventory:** `scripts/ops/staging-schema-inspect.cjs` checks exact SHA-256 of the reviewed `v7/schema.sql`, requires a distinct staging/test database name plus explicit check approval, and only SELECTs MySQL `information_schema.tables` and `v7_schema_versions`. It reports missing/extra `v7_` tables, wrong storage engine or schema version. It **does not run schema migrations, validate every column/index/foreign-key, compare data rows, perform a backup/restore or authorize deployment**. These additional migration-compatibility proofs remain mandatory.

To run on a trusted operator PC with authorized staging DB access only:

~~~sh
export SUTRADHAR_STAGING_SCHEMA_CHECK_APPROVED=yes
export SUTRADHAR_STAGING_DB_NAME=sutradhar_staging_ci
export DB_NAME=sutradhar_source
export DB_HOST=<staging-mysql-host>
export DB_PORT=3306
export DB_USER=<read-only-staging-user>
# Set DB_PASSWORD privately through your operator secret manager.
export SUTRADHAR_EXPECTED_SCHEMA_SHA256=<sha256-of-reviewed-v7/schema.sql>
npm run ops:inspect-staging-schema
~~~

Never use a production DB credential, production name, or the same source DB as the target. A passing inventory is only a snapshot of the staging schema and **not** proof that production migrations are safe. CI uses mocked SELECT responses; no live Hostinger database has been inspected. Engineering still needs reviewed, immutable incremental migration scripts with a deployment gate and proven rollback/forward recovery.

## Approved *empty* staging database bootstrap — operator only

The new `scripts/ops/bootstrap-empty-staging.cjs` can create the baseline v7 tables **only in a separate, initially empty, dedicated staging database**. It is not an in-place schema migration, production cutover, application deployment or recovery tool. It validates the reviewed schema SHA-256 and only allows static `CREATE TABLE IF NOT EXISTS v7_...` statements from repository `v7/schema.sql`, then inserts baseline version 7 and a single cluster row. It refuses an existing nonempty DB, unsafe target name, mismatched reviewed schema, unapproved execution or unallowlisted DDL.

This first-time initialization is operator-controlled and **mutating**. Do not run unless the Owner has explicitly approved that disposable staging database:

~~~sh
export SUTRADHAR_STAGING_DB_NAME=sutradhar_staging_ci
export SUTRADHAR_STAGING_BOOTSTRAP_APPROVED=yes
export SUTRADHAR_EXPECTED_SCHEMA_SHA256=<sha256-of-exact-reviewed-v7/schema.sql>
export DB_NAME=sutradhar_live_source
export DB_HOST=<staging-db-host>
export DB_PORT=3306
export DB_USER=<dedicated-staging-create-tables-user>
# Supply DB_PASSWORD using trusted secret management outside Git/chat.
npm run ops:bootstrap-empty-staging
npm run ops:inspect-staging-schema
~~~

**MySQL DDL is not transactionally reversible as a group.** If a statement fails after others succeeded, the command exits with a partial-failure error and requires manual inspection: it must not be blindly rerun, and a new blank staging DB is preferable. The script never creates the database itself and never touches production intentionally; database-name guardrails are not an authorization substitute for restricted MySQL credentials. It does not validate FK/index drift in an existing database, establish backward-compatible migrations or complete backup/restore rehearsal. No Hostinger account actions or live SQL were executed by this development commit.

## Central API first-bootstrap containment — 17 November 2026

The authenticated `POST /v7/owner/migrate` endpoint is now deliberately **one-time empty-database initialization only**, not a general-purpose migration endpoint. It acquires a per-database MySQL advisory lock for bootstrap serialization, checks `information_schema` for **zero existing tables**, requires `SUTRADHAR_ALLOW_MIGRATIONS=true`, `SUTRADHAR_BOOTSTRAP_EMPTY_DB_APPROVED=yes`, and `SUTRADHAR_BOOTSTRAP_TARGET_DB` matching the database returned by `SELECT DATABASE()` exactly. It returns `SCHEMA_BOOTSTRAP_REQUIRES_EMPTY_DATABASE` for any already initialized DB and refuses missing/incorrect target approval. Its response explicitly marks `bootstrap_only:true` and `production_migration_approved:false`.

These environment controls belong in a tightly scoped *staging-only* operator session, not permanent Hostinger production configuration. Remove or disable them immediately after approved staging initialization. MySQL DDL is not transactionally rolled back by the advisory lock; a partial failure leaves tables requiring independent inspection and a fresh disposable database. An external actor with separate database credentials is not fenced by this advisory lock. Do not attempt to migrate an existing live database with this endpoint.

The disposable MySQL integration test asserts that the first initialization succeeds and a repeat is rejected, preserving existing rows. **Incremental production migrations are still unimplemented**, requiring a reviewed versioned migration engine, backward-compatibility checks, independent restore verification and separately authorized promotion.

## 17 November — Versioned migration planning foundation (strictly read-only)

`migrations/manifest.json` now pins the SHA-256 of the actual v7 baseline schema and contains **zero unreviewed upgrade scripts**. Future upgrades require contiguous `from_version`/`to_version` entries, a safe filename (`v8__description.sql` etc.), and an exact SHA-256 of every reviewed migration file. The validator rejects missing, duplicated or reordered versions, path traversal, tampered files, mismatched baseline and a database version newer than repository source. It never executes migration SQL, applies DDL, or approves release.

An operator with a **read-only credential for a separate staging/test MySQL database** can inspect its actual `v7_schema_versions` history and compare it against the reviewed repository manifest. On the operator machine:

~~~sh
export DB_NAME=sutradhar_source
export SUTRADHAR_STAGING_DB_NAME=sutradhar_staging_ci
export SUTRADHAR_MIGRATION_PLAN_APPROVED=yes
export SUTRADHAR_MIGRATION_TARGET_VERSION=7
export DB_HOST=<approved-db-host>
export DB_PORT=3306
export DB_USER=<read-only-staging-user>
# Set DB_PASSWORD via an approved private operator secret manager.
npm run ops:plan-versioned-migrations
~~~

For this release baseline, the only legitimate plan is version 7 with **no pending migrations**. A future version 8 must be separately developed and reviewed; simply editing the manifest cannot authorize execution. The read-only planner checks version history and source-file hashes, **not actual table definitions, indexes, foreign keys, data integrity, backup restoration, or compatibility with old Desktop agents**. Existing [staging schema inventory](OWNER_RELEASE_GATE_HANDOFF_2026-11-17.md) and real migration rehearsals remain separate gates. The command does not perform any action on Hostinger on its own; no real database was accessed in this implementation.

## 17 November — Staging column drift detection

The staging read-only checker now parses the pinned v7 baseline `CREATE TABLE` definitions, including comma-bearing `ENUM(...)` fields, to derive the expected table-to-column-name inventory. It performs an additional read-only `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=?`, compares each `v7_` table's expected columns, and rejects any missing/extra columns even when the table count and `v7_schema_versions` value appear correct. Report output includes `column_inventory.missing`, `column_inventory.extra`, and `column_inventory.accepted`. Changes are covered by `tests/schema_column_inventory.test.cjs` and `tests/staging_schema_inspect.test.cjs` in `npm run test:ops`.

**This detects column NAMES only.** It does not establish data-type/default/collation equivalence, index or foreign-key integrity, table definition checksum, application backward compatibility, transactional upgrade behavior, or restorable backups. An empty `missing/extra` list is not migration approval; the result continues to set `production_accepted:false` and `migration_executed:false`. No Hostinger MySQL connection was made during this code change.

## 17 November — Read-only structural drift checks

The staging SQL inventory now additionally reads `information_schema.columns` `COLUMN_TYPE` and `IS_NULLABLE`, plus `information_schema.statistics` for declared index names, ordered index columns and unique/non-unique flags. A new `scripts/ops/schema-structure-inventory.cjs` derives the expected structural inventory from the pinned v7 baseline SQL. The checker rejects changed column types, missing explicit `NOT NULL` requirements, and missing/modified **explicitly declared** primary, unique and secondary indexes. It accepts MySQL integer display-width differences where they are semantically equivalent. Negative cases and baseline parsing are tested in `tests/schema_structure_inventory.test.cjs`, included in `npm run test:ops`.

This is **not a complete schema equivalence checker**: default expressions, collations, character sets, generated columns, foreign-key references/actions and implicit indexes remain outside its evidence. In particular, a table may still have incompatible constraints even with a passing structural inventory. It never applies a migration or authorizes production; the report sets `production_accepted:false`. Real Hostinger staging, backups and old/new-client compatibility remain independent gates.

## 17 November — Read-only foreign-key drift verification

Staging schema inspection now also validates foreign-key relationships. It parses the pinned v7 baseline SQL, reads `information_schema.key_column_usage` joined to `information_schema.referential_constraints` using **SELECT only**, and compares child tables, ordered child columns, parent tables, ordered parent columns, and `ON DELETE`/`ON UPDATE` actions. The database may assign foreign-key constraint names automatically; names are not treated as a stable security identity. For InnoDB, `NO ACTION` and `RESTRICT` are normalized for this inspection. Missing, extra, redirected or changed-action relationships block staging acceptance. The referenced database/schema must also match the exact staging database; a foreign key pointing to production or any other schema is rejected.

Regression coverage: `tests/schema_foreign_key_inventory.test.cjs` via `npm run test:ops`. Report: `foreign_key_inventory` with accepted/missing/extra and expected/observed counts. The checker **still does not approve production**, execute migrations, or prove row-level referential integrity, cross-version compatibility, backup restoration, or clean Hostinger staging availability. This is one additional read-only structural gate.

## Experimental staging-only incremental v7→v8 DDL rehearsal

`scripts/ops/staging-migration-rehearsal.cjs` is an **operator-controlled staging experiment**, not a general migration runner or production release permission. It requires an exact, distinct staging database name and separate approval, a 64-character backup receipt reference, the pinned repository manifest, an exact v7 schema history, an actual **complete read-only v7 schema-drift check**, a MySQL advisory lock, and a single reviewed SHA-256-pinned v8 script. Only a narrow set of additive `ALTER TABLE v7_* ADD COLUMN ... NULL` and `CREATE [UNIQUE] INDEX ... ON v7_*` SQL is supported; no destructive/drop/update/delete statements or unreviewed SQL. The MySQL `v7_migration_audit` attempt record is written **before** the first DDL statement. If an operation fails or the process crashes, the persistent attempt blocks blind retries and requires independent operator recovery. The command does **not** automatically undo MySQL DDL because it cannot be atomically rolled back as a group.

The committed `migrations/manifest.json` **contains no v8 script**, so running the command against current repository source cannot execute an upgrade. A future v8 must undergo separate code review, Owner approval, disposable-database backup and restore rehearsal, compatibility testing and post-DDL schema acceptance. This implementation has **no production authority** and must never be given production credentials.

The operator invocation (ONLY after a separately reviewed v8 manifest and an isolated staging backup) is:

~~~sh
export SUTRADHAR_STAGING_DB_NAME=sutradhar_staging_ci
export DB_NAME=sutradhar_source
export SUTRADHAR_STAGING_REHEARSAL_APPROVED=yes
export SUTRADHAR_STAGING_REHEARSAL_CONFIRM_DB=sutradhar_staging_ci
export SUTRADHAR_STAGING_REHEARSAL_TARGET_VERSION=8
export SUTRADHAR_STAGING_BACKUP_RECEIPT_SHA256=<verified-backup-receipt-sha256>
# DB_HOST, DB_PORT, DB_USER, DB_PASSWORD must be restricted STAGING credentials
npm run ops:rehearse-staging-migration
~~~

A backup hash supplied by an operator is only a **self-reported reference**; this runner does not independently validate backup media or prove restore success. It also cannot prove old/new client compatibility, migration semantic correctness, post-DDL data correctness, exact per-constraint schema equivalence or safe production upgrade. The result explicitly sets `production_approved:false` and `restore_verified:false`. This tool must not run with permanent Hostinger production environment variables. Zero live migrations have been executed by this repository change.

## 17 November — Real disposable MySQL migration rehearsal verification

The dedicated MySQL 8 CI job now additionally executes `tests/staging_migration_mysql_e2e.test.cjs` against a **new fixed-name disposable database**, `sut_rehearsal_ci`. The test has multiple explicit environment sentinels and hardcoded localhost-only conditions, creates the v7 baseline schema, exercises an in-memory SHA-pinned **synthetic** additive v8 migration through the same staging rehearsal runner, queries the actual resulting column, version rows and durable migration-audit JSON, verifies a second run is refused, and drops the disposable DB. The actual committed manifest remains version 7 with zero migration entries; the CI-only synthetic SQL is **not** a deployable production migration.

Two additional failure-mode hardenings are in place: the executor re-reads and re-hashes the exact SQL bytes immediately before the audit claim and DDL (preventing a read-between-validation/execution swap), and it rejects a failed or zero-row audit finalization rather than reporting success. The staging structure checker now retrieves MySQL `COLUMN_TYPE` and `IS_NULLABLE` from `information_schema.columns` in its actual query, instead of relying on fields supplied only by unit-test fixtures.

Passing this CI integration proves only isolated MySQL 8 staging mechanics and post-DDL receipt checks; it **does not** prove Hostinger behavior, production backup restore, transactional rollback of DDL, client compatibility or safe version-8 production migration. Current source still intentionally provides no approved v8 migration file. Do not use a real Hostinger or production database for CI.

## Desktop maintenance recovery hold — 17 November

A new `apps/desktop/maintenance-recovery-hold.cjs` provides an exclusive-create, crash-persistent **local hold record** under the Desktop node directory. It records a validated local node ID, approved maintenance plan ID, rollout wave and offer digest. Its only effect is to forbid automatic local agent startup while a hold exists; it **never runs installers, authorizes release, deletes the file, or performs rollback**. A corrupted, interrupted, mismatched-identity, or symlink hold fails closed and requires Owner-assisted examination. The Electron main process checks it before launching/restarting the edge agent and exposes a status marker in its local status response. Clean first-run nodes without a node directory remain supported.

This is a **foundational local guard only**: the Owner maintenance workflow does not yet create the hold automatically and there is intentionally **no self-service unlock**. Physical Windows tests, filesystem durability under actual OS crashes, secure recovery/removal of a hold, and Central epoch/fence reconciliation remain outstanding. Do not mistake the existence of this module for a complete production installer/update execution path. Tests: `tests/desktop_maintenance_recovery_hold.test.cjs` via `npm run test:desktop`.

## 17 November — Owner-fenced manual Desktop isolation

A packaged Windows Desktop now has a manual **Owner maintenance: isolate this drained PC** action in the Setup UI. It is available only for the locally enrolled OS-vault node identity. After a local confirmation dialog, the main process uses its signer to read Central's authenticated `/v7/nodes/maintenance`, `/v7/cluster/state`, `/v7/nodes/me`, and repeats `/v7/nodes/maintenance`. It requires the **same Owner-created DRAINED fence** on both reads, matching non-stale Master epoch, healthy READY cluster, a node which is neither Master nor backup, and fully idle, approved local agents with no live lease or unreconciled Git job. Offline/stale/changed/unauthorized states reject isolation without creating a new hold.

When these checks pass, `maintenance-local-isolation.cjs` uses the exclusive-create durable local `maintenance-recovery-hold.json`; the Electron process only **then** requests child-agent termination and clears any retry timer. An outstanding child process exit is **not** presented as proven stopped until independently observed. On relaunch, a local hold prevents agent auto-start. The UI reports local hold status. No installer/rollback is executed, Central maintenance fences are not removed, and **there is no automatic or self-service local hold release**. Owner-assisted recovery and real Windows power-loss/role-change tests remain mandatory.

Tests: `tests/desktop_maintenance_local_isolation.test.cjs` through `npm run test:desktop`, including signed-identity proof, stale/withdrawn fence, Master/backup exclusion, stale/working agents and persistent hold. This is a useful prerequisite for safe maintenance but is still an **alpha control**, not production installation authorization.

## Desktop agent stop confirmation — 17 November

The Owner-fenced manual Desktop isolation now waits for its **actual child-process exit event** after saving the crash-persistent hold. Merely sending a kill request is **not** recorded as a successful stop. A bounded 12-second wait reports `agent_stopped:false` on timeout, rejected termination or process errors; the local hold persists and requires Owner examination. A missing tracked process or one with an already observed exit code is reported separately; this is **not OS-wide process enumeration**. The child exit handler additionally refuses to schedule an automatic restart when a valid or malformed local maintenance hold exists. The Desktop UI distinguishes a confirmed stop from an unconfirmed attempt.

Regression coverage: `tests/desktop_maintenance_stop_confirm.test.cjs` runs through `npm run test:desktop`. This is not proof that no other untracked worker process exists, not proof that Central has reconciled its final lease state, not an installation/rollback permission and not a substitute for physical Windows acceptance. Owner-controlled local hold release and installer execution remain unimplemented.

## Owner cancellation recovery proof (read-only) — 17 November

Central adds node-signed `GET /v7/nodes/maintenance/recovery/:planId`. It returns evidence **only for the calling node's exact historical plan**, including the matching rollout wave and offer SHA, plan state, whether Owner cancellation was recorded, whether the plan has a close timestamp, and whether **any** active fence or maintenance intent remains for that node. It never creates a lease or authorizes installation, local hold removal, or auto-restart. Cancellation is still performed separately by the existing Owner-admin `CANCEL_PC_UPDATE` command; ordinary node credentials cannot cancel.

Packaged Windows Desktop adds **Verify Owner cancellation (no restart)**. It reads and validates its existing local recovery hold, sends a signed request using its OS-vault node identity, requires an exact match on node, plan, wave and offer SHA, a `CANCELLED` plan with independently checked absence of all fences/active intents, then rereads the hold to detect any concurrent identity change. Offline, wrong-node, stale, ambiguous, or incomplete evidence fails closed. The local hold **remains on disk**, and the agent stays blocked; no new installer permission or release action is generated. Tests are in `tests/desktop_maintenance_recovery_preflight.test.cjs`.

This increment proves a recovery *preflight*, not full Owner-controlled local release: a separate independently reviewed device-side authorization and restart reconciliation flow is still required. Do not manually delete the local hold or attempt production maintenance based on this preliminary read-only result.

The recovery plan ID is part of the Ed25519-signed node request **path**, not an unsigned query parameter, matching Central's existing node authentication contract.

## Owner-signed local maintenance hold archival — alpha

The Desktop now has an intentionally **disabled-by-default** Owner-controlled hold release mechanism. The trust anchor `apps/desktop/maintenance-release-trust.json` ships as `UNCONFIGURED_BLOCKED` with no signing key. Only a separately protected Owner Ed25519 **public** key and deliberate `OWNER_PROTECTED_RELEASE` state can enable grant verification for an approved build. Never bundle a private signing key or store it in Hostinger/public assets.

For each maintenance recovery, the Owner first cancels the exact Central plan using the existing administrative `CANCEL_PC_UPDATE` command. The Windows Desktop verifies cancellation for its OS-vault node and matches the held node ID, plan, wave and offer SHA. A **separate short-lived five-minute** Owner-signed release grant is required. Its payload is restricted to `release_maintenance_hold`, one node, one plan, one wave, one offer SHA and an unpredictable grant ID; it is not an update/installer authorization.

The protected offline signing tool is `npm run release:sign-maintenance-grant`. On the Owner's trusted signing machine, after manually reviewing Central cancellation and PC evidence, set `SUTRADHAR_OWNER_MAINTENANCE_RELEASE_APPROVED=yes`, `SUTRADHAR_RELEASE_NODE_ID`, `SUTRADHAR_RELEASE_PLAN_ID`, `SUTRADHAR_RELEASE_WAVE_ID`, `SUTRADHAR_RELEASE_OFFER_SHA256`, `SUTRADHAR_MAINTENANCE_SIGNING_KEY_FILE` (private Ed25519 key outside the repository) and `SUTRADHAR_MAINTENANCE_GRANT_OUTPUT` (new absolute file path, also outside the repository). The signing tool never contacts Central or executes an installer and refuses to overwrite an existing grant.

On an enrolled, packaged Windows PC, **Owner-signed hold release (no restart)** requires a local confirmation and chosen grant JSON. The main process refuses a tracked running agent, validates its current OS-vault identity, checks the independent Owner signature against a pinned public key, and performs **two fresh signed Central cancellation checks**. Only then does it write/fsync an exclusive release attempt receipt and archive the original hold via a same-directory rename. Interrupted or existing attempts never auto-retry. The release receipt and archived hold are retained for Owner inspection; the receipt itself is a **persistent restart barrier** so the agent is NOT automatically restarted after releasing the original hold. No installer is run and no post-release Central reconciliation is claimed.

**Remaining NO-GO:** This code is an alpha building block. It does not implement the separate controlled post-release reconciliation and restart step. Owner protected trust provision, Authenticode-signed Windows binary, offline signing-machine controls, active-process enumeration, file-system power-failure behavior, tamper-resistant receipt storage, true Hostinger testing and physical Windows-PC acceptance are not yet verified. Do **not** manually delete hold, receipt, archive or OS-vault files. A partially written receipt must remain fail-closed for manual review. No production update or deployment is authorized by this implementation.

## 18 November 2026 — Supply-chain advisory containment (NOT a waiver)

GitHub GHSA-fc5q-39xc-vjpf / CVE-2026-112366 reports a high-severity `picomatch` regular-expression denial-of-service vulnerability affecting releases through 4.0.7; the GitHub-reviewed advisory lists **no patched version** as of this review. The committed root npm lock contains multiple affected copies, all reached from development-only toolchains `tailwindcss` and `vite` (and, conservatively, their peer-dependency roots). The 11 npm audit entries are *propagated dependency-chain findings*, not 11 independently confirmed code-level defects in Central. A remote full npm advisory audit remains mandatory and presently **fails**. Do not bypass/suppress it, force-upgrade Tailwind CSS 3 to 4 without a migration, or rely on an unreviewed third-party picomatch fork.

New offline `npm run check:dependency-exposure` traces production vs development reachability using the exact committed npm v3 lock and **fails closed** if any known-vulnerable `picomatch` path becomes a production runtime dependency, if a found affected package lacks a root dependency path, or if package-lock/root manifest dependencies diverge. `npm run test:dependency-exposure` tests both safe and intentionally unsafe synthetic graphs. The default CI runs this structural guard; the separate Dependency Lock Integrity workflow also runs a fresh network advisory audit on **production-only** dependencies, then the unchanged strict **full production-and-development** audit, and finally the Desktop Electron audit. A passing structural guard is NOT a passing vulnerability audit or approval for production.

Remediation choices require a verified fixed upstream version compatible with the current build chain, or a carefully reviewed build-system migration that preserves legacy UI/build behavior and supplies new integrity-locked source dependencies. Until the full audit is green, the release gate is **NO-GO** even if current production runtime reachability stays clean. Do not mark SUTRADHAR production-ready.

## 18 November 2026 — one-time manual agent restart and live Central reconciliation (alpha)

**Do not interpret hold archival as automatic restart permission.** The existing `maintenance-release-<releaseGrantId>.json` receipt remains a permanent auto-restart barrier. A new explicit **Owner-approved manual recovery restart** button is available on packaged Windows Desktop, but ships disabled by the same `maintenance-release-trust.json` default `UNCONFIGURED_BLOCKED` trust setting. It requires a *second*, independently signed Ed25519 grant whose `action` is `restart_after_maintenance` (a hold-release grant cannot be reused). Each grant binds exact enrolled OS-vault node, plan, wave, original offer digest, **previous release grant ID**, a new random one-time grant ID, and a five-minute maximum validity window. This action grants no installer execution.

The protected Owner signing machine can issue the second grant using `npm run release:sign-maintenance-restart` with **all** of: `SUTRADHAR_OWNER_MAINTENANCE_RESTART_APPROVED=yes`, `SUTRADHAR_RELEASE_NODE_ID`, `SUTRADHAR_RELEASE_PLAN_ID`, `SUTRADHAR_RELEASE_WAVE_ID`, `SUTRADHAR_RELEASE_OFFER_SHA256`, `SUTRADHAR_PREVIOUS_RELEASE_GRANT_ID` (from the archived first release receipt), `SUTRADHAR_MAINTENANCE_SIGNING_KEY_FILE` (protected private Ed25519 key outside the repo) and `SUTRADHAR_MAINTENANCE_RESTART_GRANT_OUTPUT` (new absolute path outside repo). The script refuses overwriting output or storing the private key in the repository and never contacts Central.

Before the one-time manual restart the Desktop checks: exactly one retained first release receipt and matching archived original hold, no active local hold, absence of prior restart-attempt receipt, a separately signed unexpired restart grant, exact node/plan/wave/digest/release ID, two fresh signed Central Owner cancellation proofs, two healthy cluster snapshots with unchanged Master epoch and roles, and Central confirmation that the PC's agents are approved/idle without live leases, unfinished Git jobs or active tickets. **Stale heartbeat ages are allowed only before restarting**, because an intentionally stopped PC is expected to be offline.

The Desktop writes and fsyncs `maintenance-restart-attempt.json` **before** it launches one local agent. On restart, it waits for a new local record of an accepted Central heartbeat matching node/agents/epoch, then makes independent signed Central calls to confirm current agent membership and fresh heartbeats, cluster readiness, unchanged epoch and absence of new maintenance intent. Only then does it write a separate `maintenance-restart-ack.json` observation receipt and report reconciliation observed. A child process existing is not success. A failed or timed-out verification attempts to stop the one launched child and leaves all receipts in place for Owner review. The local ACK observation is **not a cryptographically signed server attestation**, and test coverage cannot replace real physical Windows and Hostinger staging acceptance.

**No automatic restart, including after a crash, is enabled by this feature.** The original release receipt stays on disk and keeps the local login/child restart barrier active; additional attempts are blocked by the fixed one-shot attempt receipt even if the first attempt failed. Only the Owner can inspect an interrupted or corrupt attempt and decide next physical recovery procedure. Never manually delete any hold, archived original hold, attempt, ACK or OS-vault file. A future production implementation requires OS-level process inventory, durable credential-protected journal, power-loss verification, a transactional Central restart authorization mechanism and physical multi-PC tests. The full npm supply-chain audit remains a separate **NO-GO** release gate.

## 18 November 2026 — Windows signed installer and rollback escrow (NOT execution)

The Windows Desktop gains **Stage Owner-signed update / rollback (NO INSTALL)**, an explicit Owner-reviewed *preparation* step. This is not an updater, installer or one-click rollback. The current alpha's `apps/desktop/update-trust.json` remains `UNCONFIGURED_BLOCKED`, and `7.0.0-alpha.1` is not a stable semver eligible for production Desktop rollout, so this remains a gated engineering implementation pending a properly signed stable installer and protected release keys. The only Windows binary the existing CI builds is an **unsigned internal QA** package; it is never published.

A safe staging attempt requires a packaged Windows Desktop with the **existing enrolled OS-vault identity**, a confirmed stopped local agent, an active crash-persistent local maintenance hold, **exact signed offer SHA-256 and rollout wave matching that hold**, a stable compatible version (including separately Owner-approved lower-version **rollback**), an Owner-pinned Ed25519 update key, and a matching **Windows Authenticode publisher**. The Authenticode helper uses escaped single-quoted PowerShell literals in an encoded command and checks EXE SHA-256 both before and after Windows signature verification. The Desktop obtains node-signed Central maintenance state twice and requires the same `DRAINED` fence and epoch, a healthy READY cluster with two backups, a node that is neither Master nor backup, and no active ticket/work lease/unreconciled Git job on the PC.

**Offer fingerprint:** `offer_sha256` in Central's maintenance plan and local hold is `SHA256(JSON.stringify(parsed signed offer envelope))`, **not** the EXE's `installer_sha256`. Use `npm run release:offer-maintenance-digest -- "C:\\path\\to\\SUTRADHAR Desktop.offer.json"` on the Owner signing/release machine to print the matching fingerprint for an intended Central plan. This digest helper does **not** validate an Owner signature, Authenticode or approval; those are enforced separately during Desktop preparation. Never confuse this with the signed binary checksum.

After all checks pass, Desktop writes/fsyncs a one-time `node/installer-preparation-attempt.json` **before** copying anything, exclusively stages the exact signed EXE under `node/installer-escrow/`, verifies source and staged binary checksums again, then writes/fsyncs `node/installer-preparation-ready.json`. It records only the OS-vault **public-key fingerprint**, enrolled node ID, expected agent IDs, offer digest, installer digest, versions, rollout and maintenance plan; it does **not export, copy, reset or re-enroll the private key**. The original local hold remains active and blocks agent auto-start. If a crash, tamper, partial copy, changed fence, or interrupted write occurs, the attempt receipt is deliberately never overwritten and Owner must inspect it: no unattended retry or cleanup.

After a separately Owner-supervised installation outside this capability, **Check identity after Owner installation (read-only)** compares the still-enrolled OS-vault identity and agent set against the prepared baseline and displays observed vs targeted version. **A matching version/fingerprint is NOT proof that Windows installation ran, that Central acknowledged it or that automatic rollback is safe.** Actual installer execution, a signed execution-only authorization, post-install Central health proof, preserving the encrypted OS-vault through NSIS update/uninstall behavior, downgrade safety, and physical two-PC/Hostinger acceptance remain independent **NO-GO** gates. Never manually delete vault, hold, escrow or preparation journals. The strict full npm supply-chain audit also remains a production blocker.

**Escrow receipt authenticity hardening:** Both the one-shot `installer-preparation-attempt.json` and `installer-preparation-ready.json` now carry a domain-separated Ed25519 signature from the same existing OS-vault device private key. The read-only post-install identity check verifies these signatures against the device's public key and validates that this public key corresponds to the private key decrypted from the OS vault. The escrow contains **no exported key material**. A modified, unsigned or corrupt receipt must be treated as Owner-review, and the hold stays active. These records are still files in the device user's data directory and are not hardware-enforced, deletion-proof anti-replay storage; physical Windows power-loss and access-control acceptance is pending.

## 18 November 2026 — independent Owner-authorized Windows installer process launch

The Desktop now contains a fail-closed **one-time, interactive** staged Windows EXE launcher. See [Owner Windows installation and emergency rollback runbook](WINDOWS_INTERACTIVE_INSTALLER_EXECUTION_V7.md). This is an explicit additional stage **after** signed-offer inspection and immutable EXE staging, and requires a separately signed, five-minute, exact node/plan/wave/offer/EXE/version/epoch Owner execution grant, plus the protected `installer-execution-trust.json` signing public key. Alpha trust remains `UNCONFIGURED_BLOCKED`; no production certificate or Owner credentials were supplied. The protected Windows release packager now also requires validated Owner installation-execution and maintenance-release Ed25519 public keys and returns the source trust files to their original disabled state after packaging.

Launch preparation rereads OS-vault signed preparation receipts and validates the saved OS-vault keypair, agent IDs, still-valid original signed offer expiry, exact staged EXE SHA-256, fresh Windows Authenticode signer, active matching local DRAINED hold, stable noncritical Master/Backup 1/2 roles, idle node and no unfinished Central work. It checks the Owner signing grant and records a new **exclusive device-signed execution attempt before spawn**. The Owner's OS-visible Windows setup/UAC prompts are *never silently accepted*. A separate device-signed launch-observed receipt reports only the EXE process spawn, **not** that Windows software installation or rollback succeeded. Desktop quits after observed launch to avoid file locks; original hold continues to block agent automatic restart. Interrupted, rejected and already-attempted launches cannot auto-retry.

**Production NO-GO remains** until real Authenticode-signed Owner release, Windows process/exit/version identity evidence, protected file ACL and power-failure tests, Hostinger staging and physical multi-PC tests pass; the full npm dependency audit remains red. Central does not issue an atomic per-PC installer execution lease today; signed Owner grant + point-in-time Central state are not a substitute for one. Never call this an accepted production updater or fully verified rollback.

## 20 November — Staging hostname pinning and bounded HTTP preflight

Before using `ops:hostinger-preflight`, the Owner now sets `SUTRADHAR_STAGING_ALLOWED_HOSTNAME` to the exact approved staging hostname **separately** from the URL input. GitHub's read-only workflow passes this value from Owner-maintained repository variables, not from a `workflow_dispatch` input. An unset or nonmatching hostname fails before any fetch. A private, loopback, link-local, CGNAT or reserved DNS answer also fails before HTTP requests; responses stream under a 100-KiB body cap and redirects are denied. No credentials are sent.

DNS is checked before requests but **is not pinned to the TLS transport**; true protection from DNS rebinding requires separate trusted DNS/egress rules and Owner-controlled domain registration. Staging health/manifest match is an inspection receipt, not proof of database restore, signed installer, physical independent PCs or production permission. No live Hostinger deployment was executed by CI.
## 20 November 2026 — Trusted Windows Authenticode subprocess and post-install observation hardening

**No real installer was launched or approved.** When the Owner-controlled Windows staging release reaches physical testing, verify the EXE on a dedicated Windows PC using a trusted system installation. The Authenticode verifier now uses the absolute Windows System32 WindowsPowerShell executable, not a caller-controlled PATH lookup, with `shell:false`, a trusted System32 working directory, and a narrowly scoped child environment. It accepts conventional `C:\\Windows` or other drive root `X:\\Windows` only when SystemRoot and WINDIR match. A custom/unknown Windows directory fails closed; obtain security review rather than weakening this check. Verify that the selected OS root is genuine and protected by Windows ACLs; an environment variable alone is **not** independent OS provenance.

Post-install signed observations now read Central's fresh maintenance/cluster/agent status through GET-only HTTPS requests with no redirects, cookies, or cache, and a 64 KiB streamed-response cap. The node-signed observation must have explicit Central fence reconfirmation, a valid observation timestamp no earlier than the original signed installer launch/attempt, and cannot claim successful installer completion, automatic rollback or automatic hold release. The Owner must still independently review real Windows installer outcome, Authenticode, OS-vault identity, complete epoch/failover, Central cancellation and controlled signed restart.

**Proof limits:** A correct publisher signature and OS-vault-signed receipt prove integrity of those observed bytes, not a successful elevated NSIS/UAC installation, safe rollback or a real physical-PC test. The detached process-liveness observer is unsigned diagnostic only. Post-install state does not auto-restart agents or authorize unattended installation. No Hostinger, production DB, Windows signing secrets, real PCs or main merge were accessed by CI.

## 20 November 2026 — Owner physical-PC pilot evidence collection (alpha)

A read-only multi-PC observer and offline Owner evidence bundle verifier now exist for physical G4/G5/G6 acceptance preparation. Start at [Owner physical-PC pilot runbook](V7_PHYSICAL_PILOT_OWNER_RUNBOOK.md). Provision and independently verify actual Windows PCs and approved node identities first. Set SUTRADHAR_PILOT_ALLOWED_HOSTNAME separately from SUTRADHAR_CENTRAL_URL and SUTRADHAR_PILOT_SOURCE_SHA to the full deployed-commit claim; capture **distinct immutable before/after Central GET snapshots**, physically isolate the original Master ONLY by an Owner-managed real-world operation, and save separately reviewed witness documentation.

The upgraded pure policy requires 2–10 unique nodes, exactly one intentional offline original Master for 2/3-PC failover, correct Backup-1 promotion, next epoch, unchanged exact node set, chronological timestamps, and no former Master marked live. Sticky-Master evidence for three or eight-to-ten PCs requires stable Master and epoch. The optional offline Owner signer hashes the two saved snapshots and independent private witness file, signs the exact SHA/node/session/case intent using the protected Owner Ed25519 key, and writes a new sealed index. Independent offline verification checks signature, hash integrity and narrow snapshot rules. This is **not** a real physical evidence attestation and never grants production release. Real Windows vault keys, installer signing, Windows reboot/failover, Hostinger and owner approval remain pending. Record a unique session ID in the private Owner ledger; the stateless verifier alone cannot detect cross-run replay.


## 20 November 2026 — Windows OS-vault key continuity and Central heartbeat cadence acceptance aids

The packaged Windows Desktop now includes an explicit Owner-reviewed **Export signed BEFORE / AFTER node-key continuity evidence** action. The private Ed25519 key remains in the original OS-safeStorage vault (Electron MAIN only). Owner challenge binds a fresh session ID, exact source SHA claim, approved node set, Central origin, issue/expiry and before/after phase. Offline `npm run ops:verify-pilot-node-continuity` pins the independently registered original device PUBLIC key and compares separately signed BEFORE/AFTER receipts, software boot IDs, monotonic node/agent counters and timestamps. It intentionally does not certify actual Windows hardware, successful OS reboot, DPAPI backend or approved enrollment.

Manual `npm run ops:pc-heartbeat-sample` collects immutable, bounded read-only Central heartbeat timestamp samples every approximately 60 seconds (operator manually repeats). Offline `npm run ops:verify-pilot-heartbeats` requires four or more chronological samples, exact same node-agent membership/Master/backup/epoch, 45–95-second collection spacing and 30–105-second per-agent last_seen progression. Central status is NOT independent signed heartbeat-packet verification, live physical-machine proof, 08:00 election testing or task safety.

New tests include wrong owner challenge/SHA/key, swapped/expired signed receipts, unchanged software boot ID, counter rollback, malformed approved agent sets, missing/misordered heartbeat samples, role switch, duplicate/fake agents, stale/oversized/misrouted Central responses and no automatic release. Owner guide: `docs/V7_PHYSICAL_PILOT_OWNER_RUNBOOK.md`. No real multi-PC trial, Hostinger staging, production-signed installer, physical Windows restart or production approval was performed in CI. Production remains HOLD.

