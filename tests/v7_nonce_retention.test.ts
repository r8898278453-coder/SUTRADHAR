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
