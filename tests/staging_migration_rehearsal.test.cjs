'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {validateIntent,additiveStatements,rehearsal}=require('../scripts/ops/staging-migration-rehearsal.cjs');
const manifest=require('../migrations/manifest.json');
const schema=fs.readFileSync(path.resolve(__dirname,'../v7/schema.sql'),'utf8');
const target='sut_staging_ci';
const intent={target,source:'sut_live',approved:'yes',confirmTarget:target,
  backupReceiptSha:'a'.repeat(64),expectedVersion:8};
test('rehearsal requires exact approved staging target, backup reference and v8',()=>{
  validateIntent(intent);
  for(const patch of [{target:'sut_live'},{target:'sut_prod'},{approved:'no'},
    {confirmTarget:'different'},{backupReceiptSha:'BAD'},{expectedVersion:9}])
    assert.throws(()=>validateIntent({...intent,...patch}),/EXACT_INTENT_REQUIRED/);
});
test('only narrow additive, nullable DDL is eligible for a staging rehearsal',()=>{
  assert.equal(additiveStatements('ALTER TABLE v7_nodes ADD COLUMN note VARCHAR(80) NULL;').length,1);
  assert.equal(additiveStatements('CREATE INDEX idx_note ON v7_nodes (node_id);').length,1);
  for(const sql of [
    'DROP TABLE v7_nodes;',
    'ALTER TABLE v7_nodes DROP COLUMN node_id;',
    'ALTER TABLE v7_nodes ADD COLUMN critical VARCHAR(80) NOT NULL;',
    'ALTER TABLE v7_nodes ADD COLUMN note VARCHAR(80) NULL; DELETE FROM v7_nodes;',
    'CREATE INDEX ix ON other_table(id);',
    'ALTER TABLE v7_nodes ADD COLUMN note TEXT NULL /* hidden */;',
    'ALTER TABLE v7_nodes ADD COLUMN note TEXT NULL; -- comment'
  ])assert.throws(()=>additiveStatements(sql));
});
test('missing reviewed v8 migration cannot change database even with operator intent',async()=>{
  const touched=[];
  const db={query:async(sql,args)=>{
    touched.push(sql);
    if(sql.startsWith('SELECT DATABASE()'))return [[{name:target}]];
    if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:1}]];
    if(sql.startsWith('SELECT version'))return [[{version:7}]];
    if(sql.startsWith('SELECT RELEASE_LOCK'))return [[{released:1}]];
    throw Error('Unexpected mutation '+sql);
  }};
  // The committed v8 migration exists, but an operator targeting a manifest
  // with NO explicitly reviewed v8 approval remains forbidden to mutate.
  const unreviewed={...manifest,migrations:[]};
  await assert.rejects(rehearsal({db,manifest:unreviewed,
    readFile:()=>'',schemaText:schema,intent}),/MIGRATION_TARGET_NOT_EXPLICIT/);
  assert.equal(touched.some(x=>/^(?:ALTER|CREATE|INSERT|UPDATE|DELETE)/.test(x)),false);
  assert.equal(touched.some(x=>x.startsWith('SELECT RELEASE_LOCK')),true);
});
test('lock contention and wrong connected DB fail before write',async()=>{
  const db={query:async sql=>{
    if(sql.startsWith('SELECT DATABASE()'))return [[{name:target}]];
    if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:0}]];
    throw Error('Unexpected DB mutation');
  }};
  await assert.rejects(rehearsal({db,manifest,readFile:()=>'',schemaText:schema,intent}),/LOCK_BUSY/);
  const wrong={query:async sql=>{
    if(sql.startsWith('SELECT DATABASE()'))return [[{name:'sut_live'}]];
    throw Error('Unexpected SQL');
  }};
  await assert.rejects(rehearsal({db:wrong,manifest,readFile:()=>'',schemaText:schema,intent}),/DATABASE_MISMATCH/);
});
