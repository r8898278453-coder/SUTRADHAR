'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {expectedForeignKeys,compareForeignKeys}=require('../scripts/ops/schema-foreign-key-inventory.cjs');
const sql=fs.readFileSync(path.resolve(__dirname,'../v7/schema.sql'),'utf8');
function rows(spec){
  return spec.flatMap((fk,i)=>fk.columns.map((column_name,j)=>({
    table_name:fk.table,constraint_name:'fk_generated_'+i,referenced_table_schema:'sut_staging',column_name,
    ordinal_position:j+1,referenced_table_name:fk.ref_table,
    referenced_column_name:fk.ref_columns[j],delete_rule:fk.on_delete,
    update_rule:fk.on_update
  })));
}
test('real v7 baseline relationships match observed metadata by meaning not constraint name',()=>{
  const expected=expectedForeignKeys(sql);
  assert.ok(expected.length>=14);
  assert.ok(expected.some(x=>x.table==='v7_agents'&&x.ref_table==='v7_nodes'));
  const good=compareForeignKeys(expected,rows(expected));
  assert.equal(good.accepted,true);assert.equal(good.production_approved,false);
  assert.equal(compareForeignKeys(expected,rows(expected).map(x=>({...x,constraint_name:'renamed_'+x.constraint_name}))).accepted,true);
  assert.equal(compareForeignKeys(expected,rows(expected).map(x=>({...x,delete_rule:'NO ACTION'}))).accepted,true);
});
test('missing, changed parent, wrong referential action and duplicate FK fail closed',()=>{
  const expected=expectedForeignKeys(sql),base=rows(expected);
  assert.equal(compareForeignKeys(expected,base.slice(1)).accepted,false);
  const changed=base.map(x=>({...x}));changed[0].referenced_table_name='v7_tickets';
  assert.equal(compareForeignKeys(expected,changed).accepted,false);
  const action=base.map(x=>({...x}));action[0].delete_rule='CASCADE';
  assert.equal(compareForeignKeys(expected,action).accepted,false);
  const duplicate=[...base,{...base[0],constraint_name:'another_fk'}];
  assert.equal(compareForeignKeys(expected,duplicate).accepted,false);
});
test('out of order and malformed metadata are rejected',()=>{
  const expected=expectedForeignKeys(sql),base=rows(expected);
  assert.throws(()=>compareForeignKeys(expected,[...base,{...base[0],ordinal_position:0}]),/METADATA_INVALID/);
  assert.throws(()=>compareForeignKeys(expected,[...base,{...base[0],constraint_name:base[0].constraint_name}]),/METADATA_CONFLICT/);
  assert.throws(()=>expectedForeignKeys(sql.replace('REFERENCES v7_nodes(node_id)','REFERENCES unknown(node_id)')),/CLAUSE_UNSUPPORTED/);
});

test('cross-database FK target is never accepted for the staging schema',()=>{
  const spec=expectedForeignKeys(sql),matched=rows(spec);
  assert.equal(compareForeignKeys(spec,matched,'sut_staging').accepted,true);
  const redirected=matched.map(x=>({...x}));
  redirected[0].referenced_table_schema='production';
  assert.throws(()=>compareForeignKeys(spec,redirected,'sut_staging'),/CROSS_DATABASE_REFERENCE/);
  assert.throws(()=>compareForeignKeys(spec,matched.map(x=>{
    const out={...x};delete out.referenced_table_schema;return out;
  }),'sut_staging'),/CROSS_DATABASE_REFERENCE/);
});
