/**
 * Real MySQL 8 CI ONLY. Creates and drops a disposable, fixed-name database.
 * Never runs outside an explicit CI sentinel and localhost MySQL.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {rehearsal}=require('../scripts/ops/staging-migration-rehearsal.cjs');
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
  const sql='ALTER TABLE v7_nodes ADD COLUMN ci_rehearsal_note VARCHAR(80) NULL;\n';
  const sha=hash(sql),file='v8__ci_rehearsal_note.sql';
  const root=require('../migrations/manifest.json');
  const manifest={...root,migrations:[{from_version:7,to_version:8,file,sha256:sha}]};
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
    const [columns]=await staging.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?',
      [DB,'v7_nodes','ci_rehearsal_note']);
    assert.equal(columns.length,1);
    const [audit]=await staging.query(
      'SELECT source_sha256,record_counts,destination_counts FROM v7_migration_audit WHERE migration_id=?',
      ['schema_version_8']);
    assert.equal(audit.length,1);assert.equal(audit[0].source_sha256,sha);
    const payload=typeof audit[0].destination_counts==='string'?
      JSON.parse(audit[0].destination_counts):audit[0].destination_counts;
    assert.equal(payload.status,'DDL_COMPLETE_UNVERIFIED');
    await assert.rejects(rehearsal({db:staging,schemaText,manifest,intent,
      readFile:()=>sql}),/REQUIRES_EXACT_V7_BASELINE/);
    const [after]=await staging.query('SELECT COUNT(*) AS n FROM v7_migration_audit');
    assert.equal(Number(after[0].n),1);
  }finally{
    if(staging)await staging.end();
    await admin.query('DROP DATABASE IF EXISTS `'+DB+'`');
    await admin.end();
  }
});
