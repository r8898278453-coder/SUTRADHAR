/**
 * Real MySQL 8 CI ONLY. Creates and drops a disposable, fixed-name database.
 * Never runs outside an explicit CI sentinel and localhost MySQL.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {rehearsal}=require('../scripts/ops/staging-migration-rehearsal.cjs');
const {verifyPostV8}=require('../scripts/ops/staging-v8-postcheck.cjs');
const {hash}=require('../scripts/ops/versioned-migration-plan.cjs');
const enabled=process.env.SUTRADHAR_RUN_STAGING_MIGRATION_E2E==='1';
const sentinel=process.env.SUTRADHAR_STAGING_REHEARSAL_TEST_SENTINEL==='disposable-only';
const DB='sut_rehearsal_ci';
test('REAL MySQL 8: staging-only v8 rehearsal persists non-retryable audit after DDL',{skip:!enabled},async()=>{
  if(!sentinel||process.env.DB_HOST!=='127.0.0.1'||process.env.DB_NAME!=='sutradhar_v7_ci'||
     process.env.NODE_ENV!=='test')throw Error('REAL_MYSQL_REHEARSAL_CI_GUARD_MISSING');
  const mysql=require('mysql2/promise');
  const config={host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,multipleStatements:false};
  const admin=await mysql.createConnection(config);
  let staging=null;
  const schemaText=fs.readFileSync(path.resolve(__dirname,'../v7/schema.sql'),'utf8');
  const file='v8__nonce_received_at.sql';
  const sql=fs.readFileSync(path.resolve(__dirname,'../migrations',file),'utf8');
  const sha=hash(sql);
  const manifest=require('../migrations/manifest.json');
  assert.equal(manifest.migrations.length,1);
  assert.equal(manifest.migrations[0].file,file);
  assert.equal(manifest.migrations[0].sha256,sha);
  const intent={target:DB,source:process.env.DB_NAME,approved:'yes',confirmTarget:DB,
    backupReceiptSha:'c'.repeat(64),expectedVersion:8};
  try{
    await admin.query('DROP DATABASE IF EXISTS `'+DB+'`');
    await admin.query('CREATE DATABASE `'+DB+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    staging=await mysql.createConnection({...config,database:DB});
    const statements=schemaText.split('\n').filter(line=>!line.trimStart().startsWith('--'))
      .join('\n').split(';').map(x=>x.trim()).filter(Boolean);
    assert.equal(statements.length,23);
    for(const statement of statements)await staging.query(statement);
    await staging.query('INSERT INTO v7_schema_versions(version) VALUES(7)');
    await staging.query('INSERT INTO v7_cluster(singleton) VALUES(1)');
    const result=await rehearsal({db:staging,schemaText,manifest,intent,
      readFile:name=>{assert.equal(name,file);return sql;}});
    assert.equal(result.accepted,true);
    assert.equal(result.production_approved,false);
    assert.equal(result.restore_verified,false);
    const [versions]=await staging.query('SELECT version FROM v7_schema_versions ORDER BY version');
    assert.deepEqual(versions.map(x=>Number(x.version)),[7,8]);
    const [indexes]=await staging.query(
      'SELECT INDEX_NAME AS index_name,COLUMN_NAME AS column_name,'+
      'NON_UNIQUE AS non_unique FROM information_schema.statistics '+
      'WHERE table_schema=? AND table_name=? AND index_name=?',
      [DB,'v7_nonces','idx_nonce_received_at']);
    assert.equal(indexes.length,1);
    assert.equal(indexes[0].column_name,'received_at');
    assert.equal(Number(indexes[0].non_unique),1);
    const [audit]=await staging.query(
      'SELECT source_sha256,record_counts,destination_counts FROM v7_migration_audit WHERE migration_id=?',
      ['schema_version_8']);
    assert.equal(audit.length,1);assert.equal(audit[0].source_sha256,sha);
    const payload=typeof audit[0].destination_counts==='string'?
      JSON.parse(audit[0].destination_counts):audit[0].destination_counts;
    assert.equal(payload.status,'DDL_COMPLETE_UNVERIFIED');
    await assert.rejects(rehearsal({db:staging,schemaText,manifest,intent,
      readFile:()=>sql}),/REQUIRES_EXACT_V7_BASELINE/);
    const postcheckIntent={target:DB,source:process.env.DB_NAME,approved:'yes',
      confirmTarget:DB,expectedMigrationSha:sha};
    const proof=await verifyPostV8({db:staging,manifest,schemaText,
      intent:postcheckIntent,readFile:()=>sql});
    assert.equal(proof.accepted,true);
    assert.equal(proof.production_approved,false);
    await staging.query('DROP INDEX idx_nonce_received_at ON v7_nonces');
    await assert.rejects(verifyPostV8({db:staging,manifest,schemaText,
      intent:postcheckIntent,readFile:()=>sql}),/STAGING_V8_INDEX_DRIFT/);
    // Restore the reviewed index, then prove a tampered baseline table
    // cannot pass just because the v8 migration audit/index still look valid.
    await staging.query('CREATE INDEX idx_nonce_received_at ON v7_nonces (received_at)');
    await staging.query('ALTER TABLE v7_nonces ADD COLUMN unexpected_ci VARCHAR(30) NULL');
    await assert.rejects(verifyPostV8({db:staging,manifest,schemaText,
      intent:postcheckIntent,readFile:()=>sql}),/STAGING_V8_BASELINE_STRUCTURE_DRIFT/);
    const [after]=await staging.query('SELECT COUNT(*) AS n FROM v7_migration_audit');
    assert.equal(Number(after[0].n),1);
  }finally{
    if(staging)await staging.end();
    await admin.query('DROP DATABASE IF EXISTS `'+DB+'`');
    await admin.end();
  }
});
