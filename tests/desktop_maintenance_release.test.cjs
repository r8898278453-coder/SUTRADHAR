'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {verifyRecoveryGrant}=require('../apps/desktop/maintenance-release-grant.cjs');
const {releaseHold}=require('../apps/desktop/maintenance-release-executor.cjs');
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
const makeFetch=(e=evidence)=>async()=>({ok:true,json:async()=>e});
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
