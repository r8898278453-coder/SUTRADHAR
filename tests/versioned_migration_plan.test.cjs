'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {validateManifest,plan,hash}=require('../scripts/ops/versioned-migration-plan.cjs');
const manifest=require('../migrations/manifest.json');
const schema=fs.readFileSync(path.join(__dirname,'../v7/schema.sql'));
test('pinned v7 baseline is immutable; committed v8 index is a read-only migration PLAN',()=>{
  assert.equal(manifest.baseline_schema_sha256,hash(schema));
  const readFile=name=>fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8');
  const p=plan({manifest,readFile,observedVersions:[7],
    actualBaselineSha:hash(schema),expectedTarget:8});
  assert.equal(p.accepted,true);
  assert.equal(p.pending.length,1);
  assert.equal(p.pending[0].file,'v8__nonce_received_at.sql');
  assert.equal(p.pending[0].sha256,
    hash(readFile('v8__nonce_received_at.sql')));
  assert.equal(p.migration_execution_allowed,false);
  assert.equal(p.production_approved,false);
});
test('manifest refuses invalid paths, gaps, reorder, duplicates, changed bytes',()=>{
  const sql='ALTER TABLE v7_nodes ADD COLUMN label VARCHAR(10);\n';
  const migration={from_version:7,to_version:8,file:'v8__add_node_label.sql',
    sha256:crypto.createHash('sha256').update(sql).digest('hex')};
  const good={...manifest,migrations:[migration]};
  const readFile=x=>{assert.equal(x,migration.file);return sql;};
  const result=plan({manifest:good,readFile,observedVersions:[7],
    actualBaselineSha:manifest.baseline_schema_sha256,expectedTarget:8});
  assert.equal(result.pending.length,1);
  for(const altered of [
    {...migration,file:'../escape.sql'},
    {...migration,file:'v9__add_node_label.sql'},
    {...migration,from_version:9},
    {...migration,sha256:'f'.repeat(64)}
  ])assert.throws(()=>validateManifest({...manifest,migrations:[altered]},readFile));
  assert.throws(()=>validateManifest({...manifest,migrations:[migration,migration]},readFile));
  assert.throws(()=>validateManifest(good,()=>sql+'-- tampered'));
});
test('read-only plan rejects schema drift, missing version, gaps and future db',()=>{
  const make=(patch={})=>plan({manifest,readFile:name=>
    fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'),observedVersions:[7],
    actualBaselineSha:manifest.baseline_schema_sha256,expectedTarget:8,...patch});
  for(const patch of [
    {observedVersions:[]},{observedVersions:[8]},{observedVersions:[7,9]},
    {observedVersions:[7,7]},{actualBaselineSha:'0'.repeat(64)},
    {expectedTarget:7}
  ])assert.throws(()=>make(patch));
});
