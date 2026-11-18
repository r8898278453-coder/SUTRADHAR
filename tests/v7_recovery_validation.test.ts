import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRecoverySnapshot} from '../v7/recovery_validation.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function snapshot(extra:Record<string,unknown>={}){
  const s={epoch:3,phase:'RECOVERING',tickets:[{ticket_id:'task1',status:'READY'}],
    checkpoints:[{ticket_id:'task1',generation:1,summary:'abc',next_action:'resume',
      content_sha256:digest('abc\nresume')}],events:[{event_id:7}],
    event_high_watermark:7,unresolved_git_jobs:[],...extra};
  return {...s,manifest_sha256:digest(JSON.stringify(s))};
}
test('accepts exact recovery epoch and valid Central digest',()=>{
  const s=snapshot();assert.equal(verifyRecoverySnapshot(s,3),s.manifest_sha256);
});
test('rejects invalid epoch, phase, pagination and missing lists',()=>{
  for(const s of [snapshot({epoch:4}),snapshot({phase:'READY'}),snapshot({tickets:null}),
    snapshot({events:Array(301).fill({event_id:1})})])
    assert.throws(()=>verifyRecoverySnapshot(s,3));
});
test('rejects duplicate ticket, checkpoint and event identities',()=>{
  const cp=snapshot().checkpoints[0];
  for(const s of [snapshot({tickets:[{ticket_id:'x',status:'READY'},{ticket_id:'x',status:'READY'}]}),
    snapshot({checkpoints:[cp,cp]}),snapshot({events:[{event_id:1},{event_id:1}]})])
    assert.throws(()=>verifyRecoverySnapshot(s,3));
});
test('rejects reconciliation-required, changed checkpoint and tampering',()=>{
  assert.throws(()=>verifyRecoverySnapshot(snapshot({tickets:[{ticket_id:'task1',status:'RECONCILIATION_REQUIRED'}]}),3));
  assert.throws(()=>verifyRecoverySnapshot(snapshot({checkpoints:[{ticket_id:'task1',generation:1,
    summary:'changed',next_action:'resume',content_sha256:digest('abc\nresume')}]}),3));
  const s=snapshot();s.tickets[0].status='DONE';
  assert.throws(()=>verifyRecoverySnapshot(s,3));
});

test('allows bounded recent events after historical event count exceeds 300',()=>{
  const events=Array.from({length:300},(_,i)=>({event_id:1000-i}));
  const s=snapshot({events,event_high_watermark:1000});
  assert.equal(verifyRecoverySnapshot(s,3),s.manifest_sha256);
});
test('refuses unresolved remote Git effects even without a live worker lease',()=>{
  for(const state of ['RUNNING','NEEDS_RECONCILIATION']){
    const s=snapshot({unresolved_git_jobs:[{ticket_id:'task_done',agent_id:'qa1',epoch:2,state}]});
    assert.throws(()=>verifyRecoverySnapshot(s,3),/GIT_RECONCILIATION_REQUIRED/);
  }
});
test('refuses malformed Git ledger and forged event high-water cursor',()=>{
  for(const s of [
    snapshot({unresolved_git_jobs:null}),
    snapshot({unresolved_git_jobs:[{ticket_id:'a',state:'CONFIRMED'}]}),
    snapshot({event_high_watermark:6}),
    snapshot({event_high_watermark:-1})
  ])assert.throws(()=>verifyRecoverySnapshot(s,3));
});
