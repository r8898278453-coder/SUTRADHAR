'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compare,validate,pack}=require('../scripts/ops/staging-restore-verify.cjs');
const sourceDb='sutradhar_source',targetDb='sutradhar_restore_staging_ci';
const approved={sourceDb,targetDb,expectedSourceDb:sourceDb,expectedTargetDb:targetDb,
  approved:'yes',expectedBackupSha:'a'.repeat(64)};
function fixture({sourceRows,targetRows,sourceType='varchar(100)',targetType,
  missingPk=false,extraTable=false}={}){
  const a=sourceRows||[{id:1,marker:'first'},{id:2,marker:'second'}];
  const b=targetRows||a,operations={source:[],target:[]};
  function query(side){return async(sql,params)=>{
    operations[side].push(sql);
    const dest=side==='target';
    if(sql.includes('FROM information_schema.tables'))
      return [{table_name:'backup_probe',engine:'InnoDB',table_type:'BASE TABLE'},
        ...(extraTable&&dest?[{table_name:'extra',engine:'InnoDB',table_type:'BASE TABLE'}]:[])];
    if(sql.includes('FROM information_schema.columns'))
      return [
        {table_name:'backup_probe',column_name:'id',ordinal_position:1,
          column_type:'int',is_nullable:'NO',column_default:null,extra:'',
          character_set_name:null,collation_name:null},
        {table_name:'backup_probe',column_name:'marker',ordinal_position:2,
          column_type:dest?(targetType||sourceType):sourceType,
          is_nullable:'NO',column_default:null,extra:'',
          character_set_name:'utf8mb4',collation_name:'utf8mb4_0900_ai_ci'}
      ];
    if(sql.includes('FROM information_schema.statistics'))
      return missingPk?[]:[{table_name:'backup_probe',index_name:'PRIMARY',
        seq_in_index:1,column_name:'id',non_unique:0,index_type:'BTREE',sub_part:null}];
    if(sql.includes('FROM information_schema.key_column_usage'))return [];
    if(sql.startsWith('SELECT COUNT(*) AS n FROM'))return [{n:(dest?b:a).length}];
    if(sql.startsWith('SELECT ')){
      assert.ok(sql.includes('ORDER BY ')&&sql.includes(' LIMIT ? OFFSET ?'));
      const list=dest?b:a;return list.slice(params[1],params[1]+params[0]);
    }
    throw Error('Unsafe SQL query: '+sql);
  }}
  return {...approved,sourceQuery:query('source'),targetQuery:query('target'),
    operations};
}
test('current source and restored staging content match with read-only cryptographic row digests',async()=>{
  const x=fixture(),r=await compare(x);
  assert.equal(r.accepted,true);
  assert.equal(r.status,'STAGING_RESTORE_CURRENT_SNAPSHOTS_MATCH');
  assert.equal(r.table_count,1);
  assert.equal(r.verified_row_count,2);
  assert.equal(r.source_quiescence_proven,false);
  assert.equal(r.exact_backup_snapshot_proven,false);
  assert.equal(r.production_release_authorized,false);
  assert.equal(r.read_only,true);
  assert.match(r.tables[0].sha256,/^[a-f0-9]{64}$/);
  for(const side of ['source','target']){
    assert.ok(x.operations[side].length>=6);
    assert.ok(x.operations[side].every(s=>s.startsWith('SELECT ')));
  }
});
test('same row count but a tampered value is denied',async()=>{
  await assert.rejects(compare(fixture({targetRows:[
    {id:1,marker:'first'},{id:2,marker:'changed'}]})),/RESTORE_VERIFY_DATA_MISMATCH/);
});
test('different row count is denied',async()=>{
  await assert.rejects(compare(fixture({targetRows:[{id:1,marker:'first'}]})),
    /RESTORE_VERIFY_ROW_COUNT_MISMATCH/);
});
test('schema drift, unexpected table, or missing deterministic primary key denied',async()=>{
  await assert.rejects(compare(fixture({targetType:'varchar(101)'})),
    /RESTORE_VERIFY_SCHEMA_MISMATCH/);
  await assert.rejects(compare(fixture({extraTable:true})),
    /RESTORE_VERIFY_SCHEMA_MISMATCH/);
  await assert.rejects(compare(fixture({missingPk:true})),
    /RESTORE_VERIFY_PRIMARY_KEY_REQUIRED/);
});
test('exact Owner source/target approval and encrypted archive hash mandatory',()=>{
  for(const bad of [{approved:'no'},{targetDb:sourceDb},
    {expectedTargetDb:'other_staging_db'},{expectedSourceDb:'other_source'},
    {expectedBackupSha:'invalid'},{targetDb:'production'},
    {targetDb:'sutradhar_prod'},{targetDb:'sutradhar-staging'}])
    assert.throws(()=>validate({...approved,...bad}),
      /RESTORE_VERIFY_EXACT_OWNER_APPROVAL_REQUIRED/);
});
test('oversized or shape-mismatched source values never enter a successful digest',()=>{
  assert.throws(()=>pack({id:1,marker:'x'.repeat(1024*1024+1)},['id','marker']),
    /RESTORE_VERIFY_ROW_TOO_LARGE/);
  assert.throws(()=>pack({id:1,marker:'ok',extra:'unexpected'},['id','marker']),
    /RESTORE_VERIFY_DATA_SHAPE_INVALID/);
  assert.throws(()=>pack({id:Symbol('bad')},['id']),
    /RESTORE_VERIFY_DATA_TYPE_UNSUPPORTED/);
});
