'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {expectedStructure,compareStructure,normalizeType}=
  require('../scripts/ops/schema-structure-inventory.cjs');
const source=fs.readFileSync(path.join(__dirname,'../v7/schema.sql'),'utf8');
function evidence(spec){
  const cols=[],indexes=[];
  for(const [table_name,definition] of Object.entries(spec)){
    for(const [column_name,col] of Object.entries(definition.columns))
      cols.push({table_name,column_name,column_type:col.type,
        is_nullable:col.required_non_null?'NO':'YES'});
    for(const [index_name,index] of Object.entries(definition.indexes))
      index.columns.forEach((column_name,i)=>indexes.push({table_name,index_name,
        seq_in_index:i+1,column_name,non_unique:index.unique?0:1}));
  }
  return {cols,indexes};
}
test('real v7 schema structural metadata has a clean read-only match',()=>{
  const spec=expectedStructure(source),e=evidence(spec);
  assert.ok(Object.keys(spec).length>=20);
  assert.ok(Object.keys(spec.v7_tickets.indexes).length>=2);
  assert.deepEqual(spec.v7_cluster.indexes.PRIMARY.columns,['singleton']);
  assert.equal(spec.v7_arrivals.indexes.agent_id.unique,true);
  const result=compareStructure(spec,e.cols,e.indexes);
  assert.equal(result.accepted,true,JSON.stringify(result.problems));
  assert.equal(result.production_approved,false);
  assert.equal(result.foreign_keys_defaults_collations_and_implicit_indexes_verified,false);
  assert.equal(normalizeType('bigint(20) unsigned'),'bigint unsigned');
});
test('wrong data type, missing required NOT NULL, index uniqueness and order fail',()=>{
  const spec=expectedStructure(source),e=evidence(spec);
  function probe(fn){const cols=e.cols.map(x=>({...x})),indexes=e.indexes.map(x=>({...x}));
    fn(cols,indexes);const result=compareStructure(spec,cols,indexes);
    assert.equal(result.accepted,false);return result.problems;
  }
  assert.ok(probe(cols=>{cols.find(x=>x.table_name==='v7_nodes'&&x.column_name==='node_id').column_type='varchar(50)'})
    .some(x=>x.startsWith('TYPE:')));
  assert.ok(probe(cols=>{cols.find(x=>x.table_name==='v7_nodes'&&x.column_name==='public_key_pem').is_nullable='YES'})
    .some(x=>x.startsWith('NULLABILITY:')));
  assert.ok(probe((cols,indexes)=>{indexes.find(x=>x.index_name==='PRIMARY'&&x.table_name==='v7_cluster').non_unique=1})
    .some(x=>x.startsWith('INDEX_MISMATCH:')));
  assert.ok(probe((cols,indexes)=>{indexes.splice(indexes.findIndex(x=>x.table_name==='v7_nodes'&&x.index_name==='idx_state_seen'),1)})
    .some(x=>x.startsWith('INDEX_')));
});
test('duplicate or invalid index metadata rejected',()=>{
  const spec=expectedStructure(source),e=evidence(spec);
  assert.throws(()=>compareStructure(spec,e.cols,[...e.indexes,{...e.indexes[0],seq_in_index:0}]),/INDEX_ROW_INVALID/);
  assert.throws(()=>compareStructure(spec,[...e.cols,e.cols[0]],e.indexes),/DUPLICATE_COLUMN/);
});
