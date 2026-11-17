'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {plan,apply}=require('../scripts/ops/bootstrap-empty-staging.cjs');
const schema=['v7_schema_versions','v7_cluster','v7_nodes','v7_agents','v7_work'].map(t=>
  'CREATE TABLE IF NOT EXISTS '+t+' (id INT PRIMARY KEY) ENGINE=InnoDB;').join('\n');
const sha=crypto.createHash('sha256').update(schema).digest('hex');
const args={target:'sutradhar_staging_ci',source:'sutradhar_live',approved:'yes',expectedSha:sha,schemaText:schema};
test('a reviewed empty staging database can receive only the static bootstrap DDL',async()=>{
  const spec=plan(args);const observed=[];
  const query=async(sql)=>{observed.push(sql);if(sql.startsWith('SELECT'))return [[{n:0}]];return [[],[]];};
  const result=await apply({spec,query});
  assert.equal(result.accepted,true);assert.equal(result.production_accepted,false);
  assert.equal(result.incremental_migration_supported,false);
  assert.equal(observed.filter(x=>x.startsWith('CREATE TABLE')).length,5);
  assert.ok(observed.every(x=>!x.startsWith('DROP')));
});
test('block nonempty database, unsafe target or unreviewed/malicious schema',async()=>{
  const spec=plan(args);
  await assert.rejects(apply({spec,query:async()=>[[{n:1}]]}),/NOT_EMPTY/);
  for(const changes of [{target:'sutradhar_live'},{target:'sutradhar_prod'},
    {approved:'no'},{expectedSha:'f'.repeat(64)}])
    assert.throws(()=>plan({...args,...changes}));
  const malicious=schema+'\nDROP TABLE v7_cluster;';
  assert.throws(()=>plan({...args,schemaText:malicious,
    expectedSha:crypto.createHash('sha256').update(malicious).digest('hex')}),/NOT_ALLOWLISTED/);
});
test('partial DDL failure is explicit, never falsely described as rollback',async()=>{
  const spec=plan(args);let n=0;
  await assert.rejects(apply({spec,query:async(sql)=>{
    if(sql.startsWith('SELECT'))return [[{n:0}]];
    if(++n===3)throw Error('mysql unavailable');return [[],[]];
  }}),/PARTIAL_FAILURE_MANUAL_REVIEW_REQUIRED_AFTER_2/);
});
