'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {expectedColumns,compareColumns}=require('../scripts/ops/schema-column-inventory.cjs');
test('actual baseline SQL yields every table and important columns',()=>{
  const schema=fs.readFileSync(path.join(__dirname,'../v7/schema.sql'),'utf8');
  const expected=expectedColumns(schema);
  assert.ok(Object.keys(expected).length>=20);
  for(const col of ['node_id','public_key_pem','last_sequence'])assert.ok(expected.v7_nodes.includes(col));
  for(const col of ['master_agent_id','epoch','backup1','backup2'])assert.ok(expected.v7_cluster.includes(col));
  const rows=Object.entries(expected).flatMap(([table_name,columns])=>columns.map(column_name=>({table_name,column_name})));
  const result=compareColumns(expected,rows);
  assert.equal(result.accepted,true);
  assert.equal(result.types_indexes_and_foreign_keys_verified,false);
});
test('reject duplicate, malformed and missing baseline columns',()=>{
  const schema=fs.readFileSync(path.join(__dirname,'../v7/schema.sql'),'utf8');
  const expected=expectedColumns(schema);
  const rows=Object.entries(expected).flatMap(([table_name,columns])=>columns.map(column_name=>({table_name,column_name})));
  assert.equal(compareColumns(expected,rows.slice(1)).accepted,false);
  assert.equal(compareColumns(expected,[...rows,{table_name:'v7_nodes',column_name:'rogue'}]).accepted,false);
  assert.throws(()=>compareColumns(expected,[...rows,rows[0]]),/DUPLICATE_OBSERVATION/);
  assert.throws(()=>expectedColumns('CREATE TABLE IF NOT EXISTS v7_bad (a INT,'),/PAREN_INVALID/);
});
