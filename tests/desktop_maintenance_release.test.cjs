'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {verifyRecoveryGrant}=require('../apps/desktop/maintenance-release-grant.cjs');
const {releaseHold}=require('../apps/desktop/maintenance-release-executor.cjs');
const {requiresReconciliation}=require('../apps/desktop/maintenance-reconciliation-barrier.cjs');
const nodeId='node_'+'a'.repeat(32),planId='plan_pc_123',waveId='wave_pilot01';
const offerSha256='b'.repeat(64),grantId='c'.repeat(64);
const keys=crypto.generateKeyPairSync('ed25519');
const pub=keys.publicKey.export({type:'spki',format:'pem'});
function sample(now=Date.now()){
  const signed={schema:1,action:'release_maintenance_hold',node_id:nodeId,
    plan_id:planId,wave_id:waveId,offer_sha256:offerSha256,
    grant_id:grantId,issued_ms:now-1000,expires_ms:now+120000};
  return {signed,signature_base64:crypto.sign(null,Buffer.from(JSON.stringify(signed)),
    keys.privateKey).toString('base64')};
}
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-release-'));
  const cleanup=()=>fs.rmSync(dir,{recursive:true,force:true});
  try{return Promise.resolve(fn(dir)).finally(cleanup);}catch(e){cleanup();throw e;}
}
const signer={sign:({uri})=>({'x-sutradhar-node':nodeId,
  'x-sutradhar-nonce':'nonce','x-sutradhar-signature':'sig'})};
const evidence={node_id:nodeId,plan_id:planId,wave_id:waveId,offer_sha256:offerSha256,
  state:'CANCELLED',cancellation_verified:true,any_active_fence:false,
  any_active_maintenance_intent:false,local_hold_release_allowed:false,
  installer_execution_allowed:false,recovery_requires_owner:true};
const makeFetch=(e=evidence)=>async()=>new Response(JSON.stringify(e),{
  headers:{'content-type':'application/json'}});
function hold(dir){createHold({dir,nodeId,planId,waveId,offerSha256});}
const base={centralOrigin:'https://central.example.com',nodeId,signer,
  pinnedPublicKeyPem:pub,agentStopped:true};
test('only distinct, signed, time-bounded and exact device release grants verify',()=>{
  const held={active:true,node_id:nodeId,plan_id:planId,wave_id:waveId,offer_sha256:offerSha256};
  const good=sample();
  assert.equal(verifyRecoveryGrant({envelope:good,pinnedPublicKeyPem:pub,held}).accepted,true);
  for(const change of [{node_id:'node_'+'d'.repeat(32)},
    {wave_id:'wave_other'},{plan_id:'plan_other'},{offer_sha256:'d'.repeat(64)},
    {action:'run_installer'},{expires_ms:Date.now()-1}]){
    const signed={...good.signed,...change};
    const envelope={signed,signature_base64:crypto.sign(null,
      Buffer.from(JSON.stringify(signed)),keys.privateKey).toString('base64')};
    assert.throws(()=>verifyRecoveryGrant({envelope,pinnedPublicKeyPem:pub,held}));
  }
  assert.throws(()=>verifyRecoveryGrant({envelope:good,pinnedPublicKeyPem:null,held}),/TRUST_UNCONFIGURED/);
  assert.throws(()=>verifyRecoveryGrant({envelope:{...good,signature_base64:'AAAA'},
    pinnedPublicKeyPem:pub,held}),/SIGNATURE_INVALID/);
});
test('Owner-signed cancellation releases hold into archive but never restarts an agent',()=>fixture(async dir=>{
  hold(dir);
  const r=await releaseHold({...base,dir,grantEnvelope:sample(),fetcher:makeFetch()});
  assert.equal(r.released,true);assert.equal(r.agent_started,false);
  assert.equal(inspectHold({dir,nodeId}).active,false);
  assert.equal(requiresReconciliation(dir),true,'Archived hold must not unlock auto-start');
  assert.equal(fs.existsSync(path.join(dir,'maintenance-release-'+grantId+'.json')),true);
  assert.equal(fs.existsSync(path.join(dir,'maintenance-recovery-hold.released.'+grantId+'.json')),true);
  await assert.rejects(releaseHold({...base,dir,grantEnvelope:sample(),fetcher:makeFetch()}),/NO_HOLD/);
}));
test('offline, active fence, missing grant, or running agent cannot release a hold',()=>fixture(async dir=>{
  hold(dir);
  const cases=[
    {...base,grantEnvelope:sample(),agentStopped:false,fetcher:makeFetch()},
    {...base,grantEnvelope:sample(),fetcher:async()=>{throw Error('offline');}},
    {...base,grantEnvelope:sample(),fetcher:makeFetch({...evidence,any_active_fence:true})},
    {...base,grantEnvelope:sample(),pinnedPublicKeyPem:''}
  ];
  for(const c of cases){
    await assert.rejects(releaseHold({...c,dir}));
    assert.equal(inspectHold({dir,nodeId}).active,true);
  }
}));
test('existing attempt receipt blocks release without auto-retry or replacing hold',()=>fixture(async dir=>{
  hold(dir);
  fs.writeFileSync(path.join(dir,'maintenance-release-'+grantId+'.json'),'interrupted');
  await assert.rejects(releaseHold({...base,dir,grantEnvelope:sample(),
    fetcher:makeFetch()}),/ATTEMPT_ALREADY_RECORDED/);
  assert.equal(inspectHold({dir,nodeId}).active,true);
}));

test('a corrupt or interrupted release receipt still preserves the restart barrier',()=>fixture(dir=>{
  assert.equal(requiresReconciliation(dir),false);
  fs.writeFileSync(path.join(dir,'maintenance-release-'+'f'.repeat(64)+'.json'),'interrupted');
  assert.equal(requiresReconciliation(dir),true);
}));

test('reconciliation barrier refuses dangling symlinked node directories',()=>{
  if(process.platform==='win32')return;
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {requiresReconciliation}=require('../apps/desktop/maintenance-reconciliation-barrier.cjs');
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'sut-reconciliation-dangling-'));
  const alias=path.join(parent,'dangling-node-link');
  try{
    fs.symlinkSync(path.join(parent,'missing-node'),alias,'dir');
    assert.equal(fs.existsSync(alias),false);
    assert.throws(()=>requiresReconciliation(alias),
      /RECOVERY_BARRIER_NODE_DIRECTORY_INVALID/);
  }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

test('dangling failure-review and installer attempt evidence block hold release',()=>fixture(async dir=>{
  if(process.platform==='win32')return;
  hold(dir);
  const review=path.join(dir,'installer-failure-review-observed.json');
  fs.symlinkSync(path.join(dir,'missing-review'),review);
  await assert.rejects(releaseHold({...base,dir,grantEnvelope:sample(),
    fetcher:makeFetch()}),/FAILED_INSTALL_REQUIRES_DISTINCT_OWNER_RESOLUTION/);
  fs.unlinkSync(review);
  const attempt=path.join(dir,'installer-execution-attempt.json');
  fs.symlinkSync(path.join(dir,'missing-attempt'),attempt);
  await assert.rejects(releaseHold({...base,dir,grantEnvelope:sample(),
    fetcher:makeFetch()}),/POSTINSTALL_PROOF_REQUIRED/);
  assert.equal(inspectHold({dir,nodeId}).active,true);
}));

test('dangling release and archive receipts preserve the no-retry fence',()=>fixture(async dir=>{
  if(process.platform==='win32')return;
  for(const name of ['maintenance-release-'+grantId+'.json',
    'maintenance-recovery-hold.released.'+grantId+'.json']){
    hold(dir);
    const receipt=path.join(dir,name);
    fs.symlinkSync(path.join(dir,'missing-record'),receipt);
    await assert.rejects(releaseHold({...base,dir,grantEnvelope:sample(),
      fetcher:makeFetch()}),/ATTEMPT_ALREADY_RECORDED/);
    assert.equal(inspectHold({dir,nodeId}).active,true);
    fs.unlinkSync(receipt);
    fs.unlinkSync(path.join(dir,'maintenance-recovery-hold.json'));
  }
}));

test('Owner grant read is bounded, private and revalidated after an inode swap',()=>fixture(dir=>{
  const {boundedFile}=require('../apps/desktop/maintenance-release-executor.cjs');
  const file=path.join(dir,'grant.json'),grant=sample();
  fs.writeFileSync(file,JSON.stringify(grant),{mode:0o600});
  assert.deepEqual(boundedFile(file),grant);
  if(process.platform!=='win32'){
    fs.chmodSync(file,0o644);
    assert.throws(()=>boundedFile(file),/GRANT_FILE_INVALID/);
    fs.chmodSync(file,0o600);
  }
  const read=fs.readSync;
  let injected=false;
  try{
    fs.readSync=function(...args){
      const n=read.apply(this,args);
      if(!injected){
        injected=true;
        fs.renameSync(file,path.join(dir,'original-grant.json'));
        fs.writeFileSync(file,JSON.stringify(grant),{mode:0o600});
      }
      return n;
    };
    assert.throws(()=>boundedFile(file),/GRANT_FILE_INVALID/);
    assert.equal(injected,true);
  }finally{fs.readSync=read;}
}));

test('post-rename dangling archive can never be reported as released',()=>fixture(async dir=>{
  if(process.platform==='win32')return;
  hold(dir);
  const {location}=require('../apps/desktop/maintenance-recovery-hold.cjs');
  const source=location(dir);
  const archive=path.join(dir,'maintenance-recovery-hold.released.'+grantId+'.json');
  const rename=fs.renameSync;
  let injected=false;
  try{
    fs.renameSync=function(from,to){
      rename(from,to);
      if(!injected&&from===source&&to===archive){
        injected=true;
        rename(archive,archive+'.held-for-review');
        fs.symlinkSync(path.join(dir,'missing-archive'),archive);
      }
    };
    await assert.rejects(releaseHold({...base,dir,grantEnvelope:sample(),
      fetcher:makeFetch()}),/RENAME_UNCERTAIN/);
    assert.equal(injected,true);
    assert.equal(fs.existsSync(path.join(dir,
      'maintenance-release-'+grantId+'.json')),true,
      'permanent attempt evidence must survive uncertain archive identity');
  }finally{fs.renameSync=rename;}
}));
