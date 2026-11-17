'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {rehearsal}=require('../scripts/ops/staging-migration-rehearsal.cjs');
const {expectedStructure}=require('../scripts/ops/schema-structure-inventory.cjs');
const {expectedForeignKeys}=require('../scripts/ops/schema-foreign-key-inventory.cjs');
const schema=fs.readFileSync(path.resolve(__dirname,'../v7/schema.sql'),'utf8');
const baseManifest=require('../migrations/manifest.json');
const sql='ALTER TABLE v7_nodes ADD COLUMN release_note VARCHAR(80) NULL;\n';
const file='v8__add_release_note.sql',sum=crypto.createHash('sha256').update(sql).digest('hex');
const manifest={...baseManifest,migrations:[{file,from_version:7,to_version:8,sha256:sum}]};
const target='sut_staging_ci',intent={target,source:'sut_source',
  approved:'yes',confirmTarget:target,backupReceiptSha:'b'.repeat(64),expectedVersion:8};
function fakeDb({failDDL=false,alreadyAttempted=false}={}){
  const calls=[],structure=expectedStructure(schema),fks=expectedForeignKeys(schema);
  const tables=Object.keys(structure).map(table_name=>({table_name,engine:'InnoDB'}));
  const cols=Object.entries(structure).flatMap(([table_name,def])=>
    Object.entries(def.columns).map(([column_name,c])=>({table_name,column_name,
      column_type:c.type,is_nullable:c.required_non_null?'NO':'YES'})));
  const idx=Object.entries(structure).flatMap(([table_name,def])=>
    Object.entries(def.indexes).flatMap(([index_name,x])=>
      x.columns.map((column_name,i)=>({table_name,index_name,seq_in_index:i+1,
        column_name,non_unique:x.unique?0:1}))));
  const fkRows=fks.flatMap((fk,i)=>fk.columns.map((column_name,j)=>({
    table_name:fk.table,constraint_name:'fk_auto_'+i,column_name,
    ordinal_position:j+1,referenced_table_schema:target,
    referenced_table_name:fk.ref_table,referenced_column_name:fk.ref_columns[j],
    delete_rule:fk.on_delete,update_rule:fk.on_update})));
  const query=async(q,args=[])=>{
    calls.push({q,args});
    if(q.startsWith('SELECT DATABASE()'))return [[{name:target}]];
    if(q.startsWith('SELECT GET_LOCK'))return [[{acquired:1}]];
    if(q.startsWith('SELECT RELEASE_LOCK'))return [[{released:1}]];
    if(q.startsWith('SELECT version FROM v7_schema_versions ORDER BY version ASC'))return [[{version:7}]];
    if(q.includes('information_schema.tables'))return [tables];
    if(q.includes('information_schema.columns'))return [cols];
    if(q.includes('information_schema.statistics'))return [idx];
    if(q.includes('information_schema.key_column_usage'))return [fkRows];
    if(q.startsWith('SELECT version FROM v7_schema_versions ORDER BY version DESC'))return [[{version:7}]];
    if(q.startsWith('SELECT migration_id FROM v7_migration_audit'))return [alreadyAttempted?[{migration_id:'schema_version_8'}]:[]];
    if(q.startsWith('INSERT INTO v7_migration_audit'))return [{affectedRows:1}];
    if(q.startsWith('ALTER TABLE')){if(failDDL)throw Error('DDL failed');return [{affectedRows:0}];}
    if(q.startsWith('INSERT INTO v7_schema_versions'))return [{affectedRows:1}];
    if(q.startsWith('UPDATE v7_migration_audit'))return [{affectedRows:1}];
    throw Error('Unexpected SQL: '+q);
  };
  return {db:{query},calls};
}
test('reviewed additive v8 runs once only in staging with persistent pre-DDL claim',async()=>{
  const {db,calls}=fakeDb();
  const result=await rehearsal({db,manifest,schemaText:schema,intent,readFile:x=>{
    assert.equal(x,file);return sql;
  }});
  assert.equal(result.accepted,true);
  assert.equal(result.production_approved,false);
  const statement=calls.findIndex(x=>x.q.startsWith('ALTER TABLE'));
  const claim=calls.findIndex(x=>x.q.startsWith('INSERT INTO v7_migration_audit'));
  assert.ok(claim>=0&&statement>claim);
  assert.ok(calls.some(x=>x.q.startsWith('SELECT RELEASE_LOCK')));
  assert.equal(calls.some(x=>x.q.startsWith('DROP TABLE')),false);
});
test('failed DDL leaves STARTED receipt and forbids automatic retry',async()=>{
  const {db,calls}=fakeDb({failDDL:true});
  await assert.rejects(rehearsal({db,manifest,schemaText:schema,intent,
    readFile:()=>sql}),/PARTIAL_DDL_MANUAL_REVIEW_AFTER_0/);
  assert.ok(calls.some(x=>x.q.startsWith('INSERT INTO v7_migration_audit')));
  assert.equal(calls.some(x=>x.q.startsWith('INSERT INTO v7_schema_versions')),false);
  const second=fakeDb({alreadyAttempted:true});
  await assert.rejects(rehearsal({db:second.db,manifest,schemaText:schema,intent,
    readFile:()=>sql}),/EXISTING_ATTEMPT/);
  assert.equal(second.calls.some(x=>x.q.startsWith('ALTER TABLE')),false);
});
