import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REVIEWED_V8_MIGRATION_SHA256,supportedSchemaVersion,
  validReviewedV8Schema} from '../v7/schema_compatibility.ts';
const goodVersions=[{version:7},{version:8}];
const goodIndex=[{index_name:'idx_nonce_received_at',seq_in_index:1,
  column_name:'received_at',non_unique:1}];
const goodAudit=[{source_sha256:REVIEWED_V8_MIGRATION_SHA256,
  record_counts:JSON.stringify({status:'STARTED',backup_receipt_sha256:'b'.repeat(64)}),
  destination_counts:JSON.stringify({status:'DDL_COMPLETE_UNVERIFIED',statements:1})}];
test('pinned v8 digest matches reviewed migration manifest',()=>{
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'../migrations/manifest.json'),'utf8'));
  assert.equal(manifest.migrations.length,1);
  assert.equal(manifest.migrations[0].to_version,8);
  assert.equal(REVIEWED_V8_MIGRATION_SHA256,manifest.migrations[0].sha256);
});
test('only exact v7 and v7-v8 histories can serve signed API requests',()=>{
  assert.equal(supportedSchemaVersion([{version:7}]),7);
  assert.equal(supportedSchemaVersion(goodVersions),8);
  for(const bad of [[],null,[{version:8}],[{version:9}],
    [{version:7},{version:9}],[{version:7},{version:8},{version:9}],
    [{version:7},{version:7}],[{version:'7.0'}]])
    assert.equal(supportedSchemaVersion(bad),null);
});
test('v8 requires exact source audit, completed DDL marker and physical age index',()=>{
  assert.equal(validReviewedV8Schema(goodVersions,goodIndex,goodAudit),true);
  for(const bad of [
    {versions:[{version:7}]},
    {indexes:[]},
    {indexes:[{...goodIndex[0],column_name:'nonce'}]},
    {audits:[]},
    {audits:[{...goodAudit[0],source_sha256:'a'.repeat(64)}]},
    {audits:[{...goodAudit[0],record_counts:'{"status":"UNREVIEWED"}'}]},
    {audits:[{...goodAudit[0],destination_counts:'{"status":"STARTED"}'}]},
    {audits:[{...goodAudit[0],destination_counts:'{"status":"DDL_COMPLETE_UNVERIFIED","statements":2}'}]}
  ]){
    assert.equal(validReviewedV8Schema(
      bad.versions??goodVersions,bad.indexes??goodIndex,bad.audits??goodAudit),false);
  }
});
test('Central transaction blocks incompatible schema before any signed mutation',()=>{
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'../v7/central.ts'),'utf8');
  const tx=source.split('async function transaction<T>')[1].split('async function rows(')[0];
  const history=tx.indexOf('supportedSchemaVersion(versions)');
  const audit=tx.indexOf('validReviewedV8Schema(versions,indexRows,auditRows)');
  const commit=tx.indexOf('await c.commit()');
  assert.ok(history>=0&&audit>history&&commit>audit);
  assert.match(tx,/SCHEMA_VERSION_UNSUPPORTED/);
  assert.match(tx,/SCHEMA_V8_MIGRATION_INCOMPLETE/);
});
