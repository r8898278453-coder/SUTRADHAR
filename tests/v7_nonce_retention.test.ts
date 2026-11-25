import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {shouldPruneNonces,hasIndexedNoncePrunePrerequisite,
  NONCE_RETENTION_MINUTES,NONCE_PRUNE_BATCH,
  NONCE_PRUNE_HEARTBEAT_PERIOD} from '../v7/nonce_retention';
test('nonce pruning is bounded, throttled and fail closed on clock skew',()=>{
  assert.equal(NONCE_RETENTION_MINUTES,30);
  assert.equal(NONCE_PRUNE_BATCH,128);
  assert.equal(NONCE_PRUNE_HEARTBEAT_PERIOD,5);
  const now=Date.parse('2026-11-23T00:00:00Z');
  assert.equal(shouldPruneNonces(5,now,now),true);
  assert.equal(shouldPruneNonces(10,now,now-60000),true);
  for(const args of [[4,now,now],[0,now,now],[-5,now,now],
    ['5',now,now],[5,now,now+60001],[5,now,now-60001],
    [5,now,Infinity],[5,NaN,now],[5,now,0],[5,now,undefined],
    [Number.MAX_SAFE_INTEGER+1,now,now]])
    assert.equal(shouldPruneNonces(...args),false,JSON.stringify(args));
});

test('nonce maintenance is post-commit and cannot roll back accepted heartbeat',()=>{
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'../v7/central.ts'),'utf8');
  const route=source.split("app.post('/v7/nodes/heartbeat'")[1].split(
    '// Owner-only, bounded GET export of committed accepted heartbeat packet rows.')[0];
  assert.match(route,/const accepted=await transaction\(async c=>\{/);
  assert.match(route,/if\(shouldPruneNonces\(sequence,Date\.now\(\),Date\.parse\(accepted\.server_received_at\)\)\)/);
  const commitBoundary=route.indexOf('  // The heartbeat has COMMITTED.');
  const heartbeatReturn=route.indexOf('return {accepted:true,server_received_at:');
  const cleanup=route.indexOf("await c.query('DELETE FROM v7_nonces");
  assert.ok(heartbeatReturn>=0&&commitBoundary>heartbeatReturn&&cleanup>commitBoundary);
  assert.match(route,/catch\{ \/\* best-effort housekeeping failure: preserve accepted heartbeat \*\/ \}/);
  assert.match(route,/return accepted;/);
});

test('nonce cleanup requires exact v7/v8 ledger and single reviewed covering index',()=>{
  const versions=[{version:7},{version:8}];
  const index=[{index_name:'idx_nonce_received_at',seq_in_index:1,
    column_name:'received_at',non_unique:1}];
  assert.equal(hasIndexedNoncePrunePrerequisite(versions,index),true);
  assert.equal(hasIndexedNoncePrunePrerequisite(
    [{version:'7'},{version:'8'}],[{...index[0],seq_in_index:'1',non_unique:'1'}]),true);
  for(const v of [[],[{version:7}],[{version:8}],[{version:7},{version:9}],
    [{version:7},{version:8},{version:9}],
    [{version:'7.0'},{version:8}],
    [{version:7},{version:8},{version:8}]])
    assert.equal(hasIndexedNoncePrunePrerequisite(v,index),false);
  for(const ix of [[],[...index,...index],[{...index[0],index_name:'PRIMARY'}],
    [{...index[0],column_name:'nonce'}],[{...index[0],seq_in_index:2}],
    [{...index[0],non_unique:0}],null])
    assert.equal(hasIndexedNoncePrunePrerequisite(versions,ix),false);
});
test('Central post-commit prune checks v8 ledger and physical index before DELETE',()=>{
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'../v7/central.ts'),'utf8');
  const route=source.split("app.post('/v7/nodes/heartbeat'")[1].split(
    '// Owner-only, bounded GET export of committed accepted heartbeat packet rows.')[0];
  const entry=route.indexOf('  // The heartbeat has COMMITTED.');
  const ledger=route.indexOf('SELECT version FROM v7_schema_versions ORDER BY version ASC LIMIT 3');
  const lookup=route.indexOf('FROM information_schema.statistics WHERE table_schema=DATABASE()');
  const guard=route.indexOf('if(!hasIndexedNoncePrunePrerequisite(versions,indexRows))return;');
  const deletion=route.indexOf("await c.query('DELETE FROM v7_nonces");
  assert.ok(entry>=0&&ledger>entry&&lookup>ledger&&guard>lookup&&deletion>guard);
  assert.match(route,/ORDER BY received_at LIMIT 128/);
});
