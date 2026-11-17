'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {checkRecovery}=require('../apps/desktop/maintenance-recovery-preflight.cjs');
const nodeId='node_'+'a'.repeat(32);
const planId='plan_pilot_123',waveId='wave_pilot01',offerSha256='b'.repeat(64);
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-recovery-test-'));
  try{return Promise.resolve(fn(dir)).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));}
  catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
const evidence={node_id:nodeId,plan_id:planId,wave_id:waveId,offer_sha256:offerSha256,
  state:'CANCELLED',cancellation_verified:true,any_active_fence:false,
  any_active_maintenance_intent:false,local_hold_release_allowed:false,
  installer_execution_allowed:false,recovery_requires_owner:true};
const signer={sign:({kind,method,uri,body})=>{
  assert.equal(kind,'node_api');assert.equal(method,'GET');assert.equal(body,'');
  assert.equal(uri,'/v7/nodes/maintenance/recovery/'+planId);
  return {'x-sutradhar-node':nodeId,'x-sutradhar-nonce':'nonce',
    'x-sutradhar-signature':'signed'};
}};
function fetcher(value=evidence){return async(url,opts)=>{
  assert.equal(new URL(url).pathname,'/v7/nodes/maintenance/recovery/'+planId);
  assert.equal(opts.redirect,'error');
  return {ok:true,json:async()=>value};
};}
const args={centralOrigin:'https://central.example.com',nodeId,signer};
test('exact signed cancellation is advisory and NEVER deletes the hold',()=>fixture(async dir=>{
  createHold({dir,nodeId,planId,waveId,offerSha256,now:1700000000000});
  const result=await checkRecovery({...args,dir,fetcher:fetcher()});
  assert.equal(result.cancellation_verified,true);
  assert.equal(result.local_hold_release_allowed,false);
  assert.equal(result.agent_start_allowed,false);
  assert.equal(inspectHold({dir,nodeId}).active,true);
}));
test('wrong node, plan, wave, offer and cancellation evidence fail closed',()=>fixture(async dir=>{
  createHold({dir,nodeId,planId,waveId,offerSha256});
  const bad=[{node_id:'node_'+'c'.repeat(32)},
    {plan_id:'plan_other'},{wave_id:'wave_other'},{offer_sha256:'c'.repeat(64)},
    {state:'INTENT_ONLY'},{cancellation_verified:false},{any_active_fence:true},
    {any_active_maintenance_intent:true},{local_hold_release_allowed:true},
    {installer_execution_allowed:true},{recovery_requires_owner:false}];
  for(const patch of bad){
    await assert.rejects(checkRecovery({...args,dir,
      fetcher:fetcher({...evidence,...patch})}),/CANCELLATION_UNVERIFIED/);
    assert.equal(inspectHold({dir,nodeId}).active,true);
  }
}));
test('missing hold, unsigned request and unreachable Central never recover',()=>fixture(async dir=>{
  await assert.rejects(checkRecovery({...args,dir,fetcher:fetcher()}),/NO_LOCAL_HOLD/);
  createHold({dir,nodeId,planId,waveId,offerSha256});
  await assert.rejects(checkRecovery({...args,dir,signer:{sign:()=>({})},
    fetcher:fetcher()}),/NODE_SIGNING_REQUIRED/);
  await assert.rejects(checkRecovery({...args,dir,fetcher:async()=>{throw Error('offline');}}),
    /CENTRAL_UNREACHABLE/);
  assert.equal(inspectHold({dir,nodeId}).active,true);
}));
