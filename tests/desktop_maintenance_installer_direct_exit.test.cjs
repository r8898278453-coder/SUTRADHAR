'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {createDirectExitTracker,inspectDirectExit}=
  require('../apps/desktop/maintenance-installer-direct-exit.cjs');
const keys=crypto.generateKeyPairSync('ed25519');
const nodeId='node_'+'b'.repeat(32);
const node={node_id:nodeId,
  public_key_pem:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
  private_key_pem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
const scope={node_id:nodeId,plan_id:'plan_direct_exit_123',
  wave_id:'wave_pilot01',offer_sha256:'a'.repeat(64),
  installer_sha256:'b'.repeat(64),grant_id:'c'.repeat(64),
  target_version:'7.1.0',kind:'update'};
function withDir(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-direct-exit-'));
  createHold({dir,nodeId,planId:scope.plan_id,waveId:scope.wave_id,
    offerSha256:scope.offer_sha256});
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function child(pid=13542){
  const c=new EventEmitter();c.pid=pid;return c;
}
test('direct process exit 0 produces signed observation, NEVER installation success',()=>withDir(dir=>{
  const c=child(),tracker=createDirectExitTracker({child:c,dir,node,scope});
  assert.equal(inspectDirectExit({dir,node,scope}).observed,false);
  tracker.arm();
  c.emit('exit',0,null);
  c.emit('exit',7,null);
  const receipt=JSON.parse(fs.readFileSync(path.join(dir,
    'installer-direct-exit-observed.json'),'utf8'));
  assert.equal(receipt.direct_process_pid,13542);
  assert.equal(receipt.direct_process_exit_code,0);
  assert.equal(receipt.installer_completion_proven,false);
  assert.equal(receipt.elevated_process_chain_verified,false);
  assert.equal(receipt.local_hold_release_allowed,false);
  assert.equal(receipt.automatic_retry_allowed,false);
  assert.ok(receipt.signature_base64.length>70);
  const checked=inspectDirectExit({dir,node,scope});
  assert.equal(checked.observed,true);
  assert.equal(checked.installer_completion_proven,false);
  assert.equal(checked.direct_process_exit_code,0);
}));
test('exit before launch receipt arm buffers only until arm',()=>withDir(dir=>{
  const c=child(14002);
  const tracker=createDirectExitTracker({child:c,dir,node,scope});
  c.emit('exit',1603,null);
  assert.equal(inspectDirectExit({dir,node,scope}).observed,false);
  tracker.arm();
  const evidence=inspectDirectExit({dir,node,scope});
  assert.equal(evidence.direct_process_exit_code,1603);
  assert.equal(evidence.installer_completion_proven,false);
}));
test('signal termination is observed but never indicates install completion',()=>withDir(dir=>{
  const c=child();
  const tracker=createDirectExitTracker({child:c,dir,node,scope});
  tracker.arm();c.emit('exit',null,'SIGTERM');
  const evidence=inspectDirectExit({dir,node,scope});
  assert.equal(evidence.direct_process_exit_signal,'SIGTERM');
  assert.equal(evidence.direct_process_exit_code,null);
  assert.equal(evidence.installer_completion_proven,false);
}));
test('missing exit event, ambiguous event, invalid exit data never fabricate evidence',()=>withDir(dir=>{
  const c=child();const tracker=createDirectExitTracker({child:c,dir,node,scope});
  tracker.arm();c.emit('exit',null,null);
  c.emit('exit',{},null);
  assert.equal(inspectDirectExit({dir,node,scope}).observed,false);
}));
test('tampered direct-exit digest, code or signer rejected by device signature check',()=>withDir(dir=>{
  const c=child();const tracker=createDirectExitTracker({child:c,dir,node,scope});
  tracker.arm();c.emit('exit',3010,null);
  const file=path.join(dir,'installer-direct-exit-observed.json');
  const original=fs.readFileSync(file,'utf8');
  const value=JSON.parse(original);
  value.direct_process_exit_code=0;
  fs.writeFileSync(file,JSON.stringify(value));
  assert.throws(()=>inspectDirectExit({dir,node,scope}),/SIGNATURE_INVALID/);
  fs.writeFileSync(file,original);
  assert.throws(()=>inspectDirectExit({dir,node,scope:{
    ...scope,installer_sha256:'d'.repeat(64)}}),/EVIDENCE_MISMATCH/);
  assert.throws(()=>inspectDirectExit({dir,node:{
    ...node,public_key_pem:crypto.generateKeyPairSync('ed25519').publicKey
      .export({type:'spki',format:'pem'}).toString()},scope}),/SIGNATURE_INVALID/);
}));
test('a process tracker cannot operate without a real PID or scope',()=>withDir(dir=>{
  assert.throws(()=>createDirectExitTracker({child:child(0),dir,node,scope}),
    /TRACKER_ARGUMENTS_INVALID/);
  assert.throws(()=>createDirectExitTracker({child:child(),dir,node,
    scope:{...scope,node_id:'node_'+'d'.repeat(32)}}),
    /TRACKER_ARGUMENTS_INVALID/);
}));
test('an interrupted partial exit receipt is never overwritten',()=>withDir(dir=>{
  const file=path.join(dir,'installer-direct-exit-observed.json');
  fs.writeFileSync(file,'incomplete');
  let observed;
  const c=child(),tracker=createDirectExitTracker({child:c,dir,node,scope,
    onRecordingError:e=>{observed=e;}});
  tracker.arm();c.emit('exit',0,null);
  assert.equal(observed.code,'EEXIST');
  assert.equal(fs.readFileSync(file,'utf8'),'incomplete');
  assert.throws(()=>inspectDirectExit({dir,node,scope}),/CORRUPT/);
}));

test('dangling direct installer exit witness is corrupt, never missing',()=>withDir(dir=>{
  if(process.platform==='win32')return;
  const marker=path.join(dir,'installer-direct-exit-observed.json');
  fs.symlinkSync(path.join(dir,'missing-direct-exit'),marker);
  assert.equal(fs.existsSync(marker),false);
  assert.throws(()=>inspectDirectExit({dir,node,scope}),/RECEIPT_CORRUPT/);
}));
