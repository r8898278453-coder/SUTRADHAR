'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {beginAgentSession,requireNoAgentSession}=
  require('../apps/desktop/agent-session-fence.cjs');
const {inspectCrashEvidence}=
  require('../apps/desktop/agent-crash-evidence.cjs');
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-crash-diag-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('only a held private node can request read-only crash evidence',()=>fixture(dir=>{
  assert.throws(()=>inspectCrashEvidence({dir}),/SESSION_HOLD_REQUIRED/);
  assert.throws(()=>inspectCrashEvidence({dir:'relative'}),/DIRECTORY_INVALID/);
  const link=dir+'-alias';
  try{
    fs.symlinkSync(dir,link,'dir');
    assert.throws(()=>inspectCrashEvidence({dir:link}),/DIRECTORY_UNSAFE/);
  }finally{fs.unlinkSync(link);}
  if(process.platform!=='win32'){
    fs.chmodSync(dir,0o755);
    assert.throws(()=>inspectCrashEvidence({dir}),/DIRECTORY_UNSAFE/);
    fs.chmodSync(dir,0o700);
  }
}));
test('diagnostic hashes only allowlisted evidence and neither clears hold nor discloses secrets',()=>fixture(dir=>{
  beginAgentSession({dir});
  const secret='PRIVATE KEY PEM SECRET NEVER LEAK';
  fs.writeFileSync(path.join(dir,'identity.osvault.json'),secret,{mode:0o600});
  fs.writeFileSync(path.join(dir,'status.json'),'sensitive display name',{mode:0o600});
  fs.writeFileSync(path.join(dir,'undisclosed-work-log.private'),'top secret',{mode:0o600});
  const original=fs.readdirSync(dir).sort();
  const captured=inspectCrashEvidence({dir});
  const again=inspectCrashEvidence({dir});
  assert.equal(captured.schema,1);
  assert.equal(captured.state,'OWNER_REVIEW_REQUIRED');
  assert.equal(captured.records.session_intent.state,'PRESENT_VALID_SHAPE');
  assert.equal(captured.records.encrypted_identity.sha256,
    crypto.createHash('sha256').update(secret).digest('hex'));
  assert.equal(captured.other_directory_entries_count,1);
  assert.equal(captured.records.vault_write_intent.state,'MISSING');
  assert.equal(captured.records.session_intent.sha256,again.records.session_intent.sha256);
  assert.equal(captured.evidence_signed,false);
  assert.equal(captured.central_verified,false);
  assert.equal(captured.agent_restart_allowed,false);
  assert.equal(captured.marker_removal_allowed,false);
  assert.doesNotMatch(JSON.stringify(captured),/PRIVATE KEY PEM|sensitive display|undisclosed-work-log|top secret/);
  assert.deepEqual(fs.readdirSync(dir).sort(),original);
  assert.throws(()=>requireNoAgentSession({dir}),/OWNER_REVIEW_REQUIRED/);
}));
test('unsafe symlink, oversized record and tampered marker are reported without following links',()=>fixture(dir=>{
  const marker=path.join(dir,'edge-agent.session-uncertain.json');
  fs.writeFileSync(marker,'{"forged":true}',{mode:0o600});
  const target=path.join(dir,'secret-target');
  fs.writeFileSync(target,'secret remains unread',{mode:0o600});
  const link=path.join(dir,'identity.osvault.json');
  fs.symlinkSync(target,link);
  const status=path.join(dir,'status.json');
  fs.writeFileSync(status,'a'.repeat(16385),{mode:0o600});
  const result=inspectCrashEvidence({dir});
  assert.equal(result.records.session_intent.state,'PRESENT_INVALID_SHAPE');
  assert.equal(result.records.encrypted_identity.state,'UNSAFE_OR_UNREADABLE');
  assert.equal(result.records.last_local_status.state,'UNSAFE_OR_UNREADABLE');
  assert.equal(result.other_directory_entries_count,1);
  assert.equal(fs.readFileSync(target,'utf8'),'secret remains unread');
  assert.throws(()=>requireNoAgentSession({dir}),/OWNER_REVIEW_REQUIRED/);
}));
test('partial or symlinked marker still blocks restart and is never sanitized',()=>fixture(dir=>{
  const file=path.join(dir,'edge-agent.session-uncertain.json');
  fs.writeFileSync(file,'{', {mode:0o600});
  assert.equal(inspectCrashEvidence({dir}).records.session_intent.state,
    'PRESENT_INVALID_SHAPE');
  fs.unlinkSync(file);
  const target=path.join(dir,'secret-target');
  fs.writeFileSync(target,'do not read me');
  fs.symlinkSync(target,file);
  assert.equal(inspectCrashEvidence({dir}).records.session_intent.state,
    'UNSAFE_OR_UNREADABLE');
  assert.equal(fs.readFileSync(target,'utf8'),'do not read me');
  assert.throws(()=>requireNoAgentSession({dir}),/OWNER_REVIEW_REQUIRED/);
}));
