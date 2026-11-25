'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {requestStopAndConfirm}=require('../apps/desktop/maintenance-stop-confirm.cjs');
function child(mode){
  const c=new EventEmitter();
  c.exitCode=null;c.signalCode=null;c.calls=0;
  c.kill=()=>{
    c.calls++;
    if(mode==='throw')throw Error('access denied');
    if(mode==='reject')return false;
    if(mode==='exit')setImmediate(()=>{c.signalCode='SIGTERM';c.emit('exit',null,'SIGTERM');});
    if(mode==='error')setImmediate(()=>c.emit('error',Error('process error')));
    return true;
  };
  return c;
}
test('returns confirmed stop ONLY on observed child exit',async()=>{
  const c=child('exit');
  const result=await requestStopAndConfirm(c,{timeoutMs:200});
  assert.equal(result.agent_stopped,true);
  assert.equal(result.agent_stop_requested,true);
  assert.equal(result.exit_confirmed_by,'CHILD_EXIT_EVENT');
  assert.equal(c.calls,1);
  assert.equal(c.listenerCount('exit'),0);
  assert.equal(c.listenerCount('error'),0);
});
test('timeout, failed kill, and child error remain unconfirmed for Owner review',async()=>{
  for(const mode of ['hang','throw','reject','error']){
    const c=child(mode);
    const result=await requestStopAndConfirm(c,{timeoutMs:20});
    assert.equal(result.agent_stopped,false,mode);
    assert.match(result.exit_confirmed_by,/OWNER_REVIEW/);
    assert.equal(c.listenerCount('exit'),0);
    assert.equal(c.listenerCount('error'),0);
  }
});
test('no tracked child or previously exited child is not killed again',async()=>{
  assert.equal((await requestStopAndConfirm(null)).exit_confirmed_by,'NO_TRACKED_CHILD');
  const c=child('hang');c.exitCode=0;
  const result=await requestStopAndConfirm(c);
  assert.equal(result.agent_stopped,true);
  assert.equal(c.calls,0);
});
test('invalid child and timeout bounds are rejected',async()=>{
  assert.throws(()=>requestStopAndConfirm({},{}),/CHILD_INVALID/);
  assert.throws(()=>requestStopAndConfirm(null,{timeoutMs:0}),/TIMEOUT_INVALID/);
});

test('a preexisting termination signal without observed exit is NOT confirmation',async()=>{
  const c=child('hang');c.signalCode='SIGTERM';
  const result=await requestStopAndConfirm(c,{timeoutMs:15});
  assert.equal(result.agent_stopped,false);
  assert.equal(result.exit_confirmed_by,'EXIT_TIMEOUT_OWNER_REVIEW');
  assert.equal(c.calls,0,'do not send a second signal to a process already signaled');
});


test('only a positively accepted stop for the exact child arms marker retirement',async()=>{
  const c=child('exit'),accepted=[];
  const result=await requestStopAndConfirm(c,{timeoutMs:200,
    onStopAccepted:got=>accepted.push(got)});
  assert.equal(result.agent_stopped,true);
  assert.equal(result.agent_stop_requested,true);
  assert.deepEqual(accepted,[c]);
});
test('preexisting SIGTERM plus eventual exit never masquerades as an accepted stop',async()=>{
  const c=child('hang');c.signalCode='SIGTERM';
  const accepted=[];
  const p=requestStopAndConfirm(c,{timeoutMs:200,
    onStopAccepted:got=>accepted.push(got)});
  setImmediate(()=>c.emit('exit',null,'SIGTERM'));
  const r=await p;
  assert.equal(r.agent_stopped,true);
  assert.equal(r.agent_stop_requested,false);
  assert.equal(c.calls,0);
  assert.deepEqual(accepted,[]);
});
test('rejected, thrown, or synchronous exit inside kill never arms stop authority',async()=>{
  for(const mode of ['reject','throw','sync-exit-false','sync-exit-true']){
    const c=child('hang'),accepted=[];
    c.kill=()=>{
      if(mode==='throw')throw Error('ACCESS_DENIED');
      if(mode.startsWith('sync-exit'))c.emit('exit',null,'SIGTERM');
      return mode==='sync-exit-true';
    };
    const r=await requestStopAndConfirm(c,{timeoutMs:25,
      onStopAccepted:got=>accepted.push(got)});
    assert.deepEqual(accepted,[],mode);
    // Synchronous 'exit' happens BEFORE kill() returns and therefore before
    // request acceptance can be attributed to this Owner operation.
    assert.equal(r.agent_stop_requested,false,mode);
    if(mode.startsWith('sync-exit'))assert.equal(r.agent_stopped,true);
  }
});
test('invalid callback fails closed before any stop request',async()=>{
  const c=child('exit');
  assert.throws(()=>requestStopAndConfirm(c,{
    timeoutMs:200,onStopAccepted:true
  }),/CALLBACK_INVALID/);
  assert.equal(c.calls,0);
});
