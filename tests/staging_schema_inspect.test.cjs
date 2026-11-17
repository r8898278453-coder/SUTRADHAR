'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {expectedTables,validateTarget,inspect}=require('../scripts/ops/staging-schema-inspect.cjs');
const schema='CREATE TABLE IF NOT EXISTS v7_schema_versions (id INT) ENGINE=InnoDB;\n'+
  ['v7_cluster','v7_nodes','v7_agents','v7_tasks','v7_events'].map(t=>
    'CREATE TABLE IF NOT EXISTS '+t+' (id INT) ENGINE=InnoDB;').join('\n');
const sha=crypto.createHash('sha256').update(schema).digest('hex');
const base={target:'sutradhar_staging_ci',source:'sutradhar_live',approved:'yes',expectedSha:sha,schemaText:schema};
const all=expectedTables(schema);
async function fake(sql){
  if(sql.includes('information_schema.tables'))return [all.map(name=>({table_name:name,engine:'InnoDB'}))];
  if(sql.includes('information_schema.columns'))return [all.map(table_name=>({table_name,column_name:'id',column_type:'int',is_nullable:'YES'}))];
  if(sql.includes('information_schema.statistics'))return [[]];
  if(sql.includes('v7_schema_versions'))return [[{version:7}]];
  throw Error('Unexpected query');
}
test('read-only staging inventory reports expected InnoDB tables and schema version',async()=>{
  const result=await inspect({...base,query:fake});
  assert.equal(result.accepted,true);
  assert.equal(result.migration_executed,false);
  assert.equal(result.production_accepted,false);
  assert.equal(result.restore_proven,false);
});
test('refuses production names, same source, missing approval or mismatched schema digest',()=>{
  for(const changes of [{target:'sutradhar_live'},{target:'sutradhar_production'},
    {target:'sutradhar_live',source:'sutradhar_live'},{approved:'no'},
    {expectedSha:'a'.repeat(64)}]){
    assert.throws(()=>validateTarget({...base,...changes}));
  }
});
test('missing, unexpected, non-InnoDB tables and wrong version fail closed',async()=>{
  const missing=async sql=>sql.includes('information_schema.tables')?
    [all.slice(1).map(table_name=>({table_name,engine:'InnoDB'}))]:[[{version:7}]];
  const m=await inspect({...base,query:missing});
  assert.equal(m.accepted,false);assert.equal(m.missing.length,1);
  const wrong=async sql=>sql.includes('information_schema.tables')?
    [all.map(table_name=>({table_name,engine:'InnoDB'}))]:[[{version:8}]];
  assert.equal((await inspect({...base,query:wrong})).accepted,false);
  const extra=async sql=>sql.includes('information_schema.tables')?
    [[...all.map(table_name=>({table_name,engine:'InnoDB'})),{table_name:'v7_unknown',engine:'InnoDB'}]]:[[ {version:7} ]];
  assert.equal((await inspect({...base,query:extra})).accepted,false);
  const bad=async sql=>sql.includes('information_schema.tables')?
    [all.map(table_name=>({table_name,engine:'MyISAM'}))]:[[{version:7}]];
  await assert.rejects(inspect({...base,query:bad}),/NON_INNODB/);
});

test('missing and unexpected columns reject otherwise matching staging tables',async()=>{
  const query=(columns)=>async sql=>{
    if(sql.includes('information_schema.tables'))return [all.map(table_name=>({table_name,engine:'InnoDB'}))];
    if(sql.includes('information_schema.columns'))return [columns];
    if(sql.includes('information_schema.statistics'))return [[]];
    return [[{version:7}]];
  };
  const baseline=all.map(table_name=>({table_name,column_name:'id',column_type:'int',is_nullable:'YES'}));
  const missing=await inspect({...base,query:query(baseline.slice(1))});
  assert.equal(missing.accepted,false);
  assert.ok(missing.column_inventory.missing.includes(all[0]+'.id'));
  const extra=await inspect({...base,query:query([...baseline,{table_name:all[0],column_name:'unexpected',column_type:'int',is_nullable:'YES'}])});
  assert.equal(extra.accepted,false);
  assert.ok(extra.column_inventory.extra.includes(all[0]+'.unexpected'));
});
