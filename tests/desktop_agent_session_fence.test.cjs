'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inspectAgentSession,requireNoAgentSession,
  beginAgentSession,finishObservedSession}=
  require('../apps/desktop/agent-session-fence.cjs');
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-agent-session-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('new or empty enrolled directory has no orphaned child-session hold',()=>fixture(dir=>{
  assert.equal(requireNoAgentSession({dir}),true);
  assert.deepEqual(inspectAgentSession({dir}),{active:false});
}));
test('session marker precedes child spawn and survives simulated Main crash',()=>fixture(dir=>{
  const session=beginAgentSession({dir});
  assert.match(session.session_id,/^[a-f0-9]{32}$/);
  const marker=path.join(dir,'edge-agent.session-uncertain.json');
  const bytes=fs.readFileSync(marker,'utf8');
  assert.ok(bytes.includes('EXIT_UNCONFIRMED_OWNER_REVIEW'));
  assert.doesNotMatch(bytes,/PRIVATE KEY|public_key_pem|node_sequence|enrollment/);
  assert.equal(inspectAgentSession({dir}).active,true);
  assert.throws(()=>requireNoAgentSession({dir}),/AGENT_SESSION_OWNER_REVIEW_REQUIRED/);
  assert.throws(()=>beginAgentSession({dir}),/AGENT_SESSION_OWNER_REVIEW_REQUIRED/);
  assert.equal(fs.readFileSync(marker,'utf8'),bytes,'must never overwrite uncertainty');
}));
test('only exact observed exit closes the correct session',()=>fixture(dir=>{
  const a=beginAgentSession({dir});
  assert.throws(()=>finishObservedSession({dir,session_id:'b'.repeat(32),
    reason:'CLEAN_EXIT'}),/AGENT_SESSION_MARKER_MISMATCH/);
  assert.throws(()=>finishObservedSession({dir,session_id:a.session_id,
    reason:'NETWORK_TIMEOUT'}),/AGENT_SESSION_EXIT_PROOF_INVALID/);
  assert.equal(inspectAgentSession({dir}).active,true);
  assert.equal(finishObservedSession({dir,session_id:a.session_id,
    reason:'CLEAN_EXIT'}).retired,true);
  assert.equal(requireNoAgentSession({dir}),true);
  assert.throws(()=>finishObservedSession({dir,session_id:a.session_id,
    reason:'CLEAN_EXIT'}),/AGENT_SESSION_MARKER_MISSING/);
  const b=beginAgentSession({dir});
  assert.notEqual(a.session_id,b.session_id);
  assert.equal(finishObservedSession({dir,session_id:b.session_id,
    reason:'OBSERVED_OWNER_MAINTENANCE_STOP'}).retired,true);
}));
test('corrupt marker or symlink retains fail-closed hold',()=>fixture(dir=>{
  const file=path.join(dir,'edge-agent.session-uncertain.json');
  fs.writeFileSync(file,'{partial',{mode:0o600});
  assert.throws(()=>requireNoAgentSession({dir}),/OWNER_REVIEW_REQUIRED/);
  assert.throws(()=>finishObservedSession({dir,session_id:'a'.repeat(32),
    reason:'CLEAN_EXIT'}),/AGENT_SESSION_MARKER_UNSAFE|AGENT_SESSION_MARKER_CORRUPT/);
  fs.unlinkSync(file);
  const target=path.join(dir,'unrelated.json');
  fs.writeFileSync(target,'secret');
  fs.symlinkSync(target,file);
  assert.equal(inspectAgentSession({dir}).active,true);
  assert.throws(()=>beginAgentSession({dir}),/OWNER_REVIEW_REQUIRED/);
  assert.equal(fs.readFileSync(target,'utf8'),'secret');
}));
test('untrusted paths and exposed POSIX directory never permit session launch',()=>fixture(dir=>{
  assert.throws(()=>beginAgentSession({dir:'relative'}),/DIRECTORY_INVALID/);
  const link=dir+'-link';
  try{
    fs.symlinkSync(dir,link,'dir');
    assert.throws(()=>beginAgentSession({dir:link}),/DIRECTORY_UNSAFE/);
  }finally{fs.unlinkSync(link);}
  if(process.platform!=='win32'){
    fs.chmodSync(dir,0o755);
    assert.throws(()=>beginAgentSession({dir}),/DIRECTORY_UNSAFE/);
    fs.chmodSync(dir,0o700);
  }
}));
test('failed file flush leaves an orphan marker and refuses a new session',()=>fixture(dir=>{
  const orig=fs.fsyncSync;
  let n=0;
  try{
    fs.fsyncSync=function(fd){if(++n===1)throw Error('TEST_FILE_FSYNC_ERROR');
      return orig(fd);};
    assert.throws(()=>beginAgentSession({dir}),/TEST_FILE_FSYNC_ERROR/);
  }finally{fs.fsyncSync=orig;}
  assert.equal(inspectAgentSession({dir}).active,true);
  assert.throws(()=>beginAgentSession({dir}),/OWNER_REVIEW_REQUIRED/);
}));
test('failed POSIX parent sync likewise keeps the one-shot marker',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  const orig=fs.fsyncSync;
  let n=0;
  try{
    fs.fsyncSync=function(fd){if(++n===2)throw Error('TEST_PARENT_FSYNC_ERROR');
      return orig(fd);};
    assert.throws(()=>beginAgentSession({dir}),/TEST_PARENT_FSYNC_ERROR/);
  }finally{fs.fsyncSync=orig;}
  assert.equal(inspectAgentSession({dir}).active,true);
}));
