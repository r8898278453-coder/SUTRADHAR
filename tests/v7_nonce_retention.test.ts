import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldPruneNonces,NONCE_RETENTION_MINUTES,NONCE_PRUNE_BATCH,
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
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../v7/central.ts'),'utf8');
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
