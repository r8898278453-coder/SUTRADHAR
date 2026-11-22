'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {validatePostcheckIntent,verifyPostV8}=require('../scripts/ops/staging-v8-postcheck.cjs');
const manifest=require('../migrations/manifest.json');
const schemaText=fs.readFileSync(path.resolve(__dirname,'../v7/schema.sql'),'utf8');
const sql=fs.readFileSync(path.resolve(__dirname,'../migrations/v8__nonce_received_at.sql'),'utf8');
const intent={target:'sut_stage_ci',source:'sut_source',
  approved:'yes',confirmTarget:'sut_stage_ci',
  expectedMigrationSha:manifest.migrations[0].sha256};
const readFile=file=>{assert.equal(file,'v8__nonce_received_at.sql');return sql;};
const goodRows={
  versions:[{version:7},{version:8}],
  audits:[{source_sha256:intent.expectedMigrationSha,
    record_counts:JSON.stringify({status:'STARTED',backup_receipt_sha256:'a'.repeat(64)}),
    destination_counts:JSON.stringify({status:'DDL_COMPLETE_UNVERIFIED',statements:1})}],
  indexes:[{index_name:'idx_nonce_received_at',seq_in_index:1,
    column_name:'received_at',non_unique:1}]
};
function fixture(patch={}){
  const rows={...goodRows,...patch};const calls=[];
  const db={query:async(sql,params)=>{
    calls.push([sql,params]);
    if(sql==='SELECT DATABASE() AS name')return [[{name:patch.database||intent.target}]];
    if(sql.startsWith('SELECT version'))return [rows.versions];
    if(sql.startsWith('SELECT source_sha256'))return [rows.audits];
    if(sql.startsWith('SELECT index_name'))return [rows.indexes];
    throw Error('Unexpected query '+sql);
  }};
  return {db,calls};
}
const args={manifest,readFile,schemaText,intent};
test('postcheck is explicit, pinned, single-version and rejects unreviewed staging intent',()=>{
  validatePostcheckIntent(intent,manifest,readFile,schemaText);
  for(const p of [{target:'sut_prod'},{source:'sut_stage_ci'},
    {approved:'no'},{confirmTarget:'other'},{expectedMigrationSha:'0'.repeat(64)}])
    assert.throws(()=>validatePostcheckIntent({...intent,...p},
      manifest,readFile,schemaText),/STAGING_V8_/);
  assert.throws(()=>validatePostcheckIntent(intent,manifest,readFile,schemaText+' '),
    /STAGING_V8_BASELINE_SOURCE_DRIFT/);
  assert.throws(()=>validatePostcheckIntent(intent,{...manifest,migrations:[]},
    readFile,schemaText),/STAGING_V8_REVIEWED_MIGRATION_MISMATCH/);
});
test('valid v8 metadata check only SELECTs and never grants production acceptance',async()=>{
  const {db,calls}=fixture();
  const out=await verifyPostV8({...args,db});
  assert.equal(out.accepted,true);
  assert.equal(out.sql_writes_performed,false);
  assert.equal(out.production_approved,false);
  assert.equal(out.restore_verified,false);
  assert.equal(out.migration_execution_allowed,false);
  assert.equal(calls.length,5);
  assert.ok(calls.every(([sql])=>sql.startsWith('SELECT ')));
  assert.deepEqual(calls[3][1],['sut_stage_ci','v7_nonces','idx_nonce_received_at']);
});
test('wrong connected DB, missing/gapped version and stale audit fail closed',async()=>{
  for(const [patch,err] of [
    [{database:'sut_source'},/DATABASE_MISMATCH/],
    [{versions:[{version:8}]},/VERSION_HISTORY_DRIFT/],
    [{versions:[{version:7},{version:9}]},/VERSION_HISTORY_DRIFT/],
    [{audits:[]},/AUDIT_SOURCE_DRIFT/],
    [{audits:[{...goodRows.audits[0],source_sha256:'b'.repeat(64)}]},/AUDIT_SOURCE_DRIFT/],
    [{audits:[{...goodRows.audits[0],destination_counts:'{}'}]},/AUDIT_INCOMPLETE/],
    [{audits:[{...goodRows.audits[0],record_counts:'not json'}]},/AUDIT_INVALID/]
  ])await assert.rejects(verifyPostV8({...args,db:fixture(patch).db}),err);
});
test('missing, renamed, nonunique and wrong-column v8 index fail closed',async()=>{
  for(const indexes of [[],[{...goodRows.indexes[0],column_name:'nonce'}],
    [{...goodRows.indexes[0],non_unique:0}],
    [{...goodRows.indexes[0],seq_in_index:2}],
    [{...goodRows.indexes[0],index_name:'wrong'}],
    [...goodRows.indexes,...goodRows.indexes]])
    await assert.rejects(verifyPostV8({...args,db:fixture({indexes}).db}),
      /STAGING_V8_INDEX_DRIFT/);
});
