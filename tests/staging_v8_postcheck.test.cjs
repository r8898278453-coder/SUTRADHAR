'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {validatePostcheckIntent,verifyPostV8}=require('../scripts/ops/staging-v8-postcheck.cjs');
const {expectedStructure}=require('../scripts/ops/schema-structure-inventory.cjs');
const {expectedForeignKeys}=require('../scripts/ops/schema-foreign-key-inventory.cjs');
const manifest=require('../migrations/manifest.json');
const schemaText=fs.readFileSync(path.resolve(__dirname,'../v7/schema.sql'),'utf8');
const sql=fs.readFileSync(path.resolve(__dirname,'../migrations/v8__nonce_received_at.sql'),'utf8');
const intent={target:'sut_stage_ci',source:'sut_source',
  approved:'yes',confirmTarget:'sut_stage_ci',
  expectedMigrationSha:manifest.migrations[0].sha256};
const readFile=file=>{assert.equal(file,'v8__nonce_received_at.sql');return sql;};
const baseline=expectedStructure(schemaText),expectedFks=expectedForeignKeys(schemaText);
const tables=Object.keys(baseline).map(table_name=>({table_name,engine:'InnoDB'}));
const columns=Object.entries(baseline).flatMap(([table_name,t])=>
  Object.entries(t.columns).map(([column_name,c])=>({table_name,column_name,
    column_type:c.type,is_nullable:c.required_non_null?'NO':'YES'})));
const baselineIndexes=Object.entries(baseline).flatMap(([table_name,t])=>
  Object.entries(t.indexes).flatMap(([index_name,d])=>
    d.columns.map((column_name,i)=>({table_name,index_name,seq_in_index:i+1,
      column_name,non_unique:d.unique?0:1}))));
const fks=expectedFks.flatMap((fk,i)=>fk.columns.map((column_name,j)=>({
  table_name:fk.table,constraint_name:'fk_mock_'+i,column_name,
  ordinal_position:j+1,referenced_table_schema:intent.target,
  referenced_table_name:fk.ref_table,referenced_column_name:fk.ref_columns[j],
  delete_rule:fk.on_delete,update_rule:fk.on_update})));
const goodRows={
  tables,columns,baselineIndexes,fks,
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
    if(sql.includes('information_schema.tables'))return [rows.tables];
    if(sql.includes('information_schema.columns'))return [rows.columns];
    if(sql.includes('information_schema.statistics'))return [rows.baselineIndexes];
    if(sql.includes('information_schema.key_column_usage'))return [rows.fks];
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
  assert.equal(calls.length,10);
  assert.equal(out.baseline_structure_checked,true);
  assert.equal(out.baseline_table_count,tables.length);
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

test('v8 index alone does not conceal missing baseline columns or foreign keys',async()=>{
  for(const patch of [
    {columns:[...columns,{table_name:'v7_nonces',column_name:'unexpected_ci',
      column_type:'varchar(30)',is_nullable:'YES'}]},
    {columns:columns.filter(x=>!(x.table_name==='v7_nonces'&&x.column_name==='nonce'))},
    {fks:[]},
    {tables:tables.filter(x=>x.table_name!=='v7_nodes')},
    {baselineIndexes:[]}
  ]){
    await assert.rejects(verifyPostV8({...args,db:fixture(patch).db}),
      /STAGING_V8_BASELINE_STRUCTURE_DRIFT|STAGING_SCHEMA_/);
  }
});
