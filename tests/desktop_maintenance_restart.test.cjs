'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {createHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {requiresReconciliation}=require('../apps/desktop/maintenance-reconciliation-barrier.cjs');
const {verifyRestartGrant}=require('../apps/desktop/maintenance-restart-grant.cjs');
const {readReleased,prepareManualRestart,confirmLiveCentral}=
  require('../apps/desktop/maintenance-restart.cjs');
const {inspectFreshAck,waitForFreshAck,recordFreshAck}=
  require('../apps/desktop/maintenance-restart-ack.cjs');
const nodeId='node_'+'a'.repeat(32),agentId='agent_noncritical_1';
const planId='plan_recovery_123',waveId='wave_pilot01';
const offerSha256='b'.repeat(64),releaseId='c'.repeat(64),restartId='d'.repeat(64);
const keys=crypto.generateKeyPairSync('ed25519');
const pub=keys.publicKey.export({type:'spki',format:'pem'});
const cluster={epoch:21,phase:'READY',paused:false,
  master_agent_id:'agent_master_1',backups:['agent_backup_1','agent_backup_2']};
const recovery={node_id:nodeId,plan_id:planId,wave_id:waveId,
  offer_sha256:offerSha256,state:'CANCELLED',cancellation_verified:true,
  any_active_fence:false,any_active_maintenance_intent:false,
  local_hold_release_allowed:false,installer_execution_allowed:false,
  recovery_requires_owner:true};
const me={node_id:nodeId,agents:[{agent_id:agentId,state:'APPROVED',status:'IDLE',
  active_ticket:null,heartbeat_age_seconds:null,
  has_live_work_lease:0,has_unreconciled_git_job:0}]};
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-restart-'));
  const cleanup=()=>fs.rmSync(dir,{recursive:true,force:true});
  try{return Promise.resolve(fn(dir)).finally(cleanup);}
  catch(e){cleanup();throw e;}
}
function archiveFixture(dir){
  fs.writeFileSync(path.join(dir,'maintenance-release-'+releaseId+'.json'),
    JSON.stringify({schema:1,status:'OWNER_RELEASE_REQUEST_RECORDED',
      node_id:nodeId,plan_id:planId,wave_id:waveId,
      offer_sha256:offerSha256,grant_id:releaseId,
      central_cancellation_verified:true,installer_executed:false,
      automatic_restart:false,released_at_ms:Date.now()}));
  fs.writeFileSync(path.join(dir,'maintenance-recovery-hold.released.'+releaseId+'.json'),
    JSON.stringify({schema:1,state:'OWNER_REVIEW_REQUIRED',node_id:nodeId,
      plan_id:planId,wave_id:waveId,offer_sha256:offerSha256,
      installer_execution_allowed:false,owner_release_allowed:false,
      created_at_ms:Date.now()}));
}
function signedGrant(patch={},now=Date.now()){
  const signed={schema:1,action:'restart_after_maintenance',
    node_id:nodeId,plan_id:planId,wave_id:waveId,
    offer_sha256:offerSha256,release_grant_id:releaseId,
    grant_id:restartId,issued_ms:now-1000,expires_ms:now+120000,...patch};
  return {signed,signature_base64:crypto.sign(null,
    Buffer.from(JSON.stringify(signed)),keys.privateKey).toString('base64')};
}
const signer={sign:({kind,method,uri,body})=>{
  assert.equal(kind,'node_api');assert.equal(method,'GET');assert.equal(body,'');
  assert.ok(['/v7/nodes/maintenance/recovery/'+planId,
    '/v7/nodes/me','/v7/cluster/state','/v7/nodes/maintenance'].includes(uri));
  return {'x-sutradhar-node':nodeId,'x-sutradhar-nonce':'unique',
    'x-sutradhar-signature':'signature'};
}};
function mock({cancel=recovery,roles=cluster,agents=me,secondRoles,
  offline=false,maintenance}={}){
  let calls=[],clusterReads=0;
  const fetcher=async(url,opts)=>{
    assert.equal(opts.redirect,'error');assert.equal(opts.method,'GET');
    assert.equal(opts.headers['x-sutradhar-node'],nodeId);
    const path=new URL(url).pathname;calls.push(path);
    if(offline)throw Error('Central unreachable');
    let d;
    if(path.endsWith('/nodes/maintenance/recovery/'+planId))d=cancel;
    else if(path.endsWith('/cluster/state'))d=(++clusterReads===2&&secondRoles)?secondRoles:roles;
    else if(path.endsWith('/nodes/me'))d=agents;
    else if(path.endsWith('/nodes/maintenance'))d=maintenance||
      {node_id:nodeId,intent:null,installer_execution_allowed:false,owner_maintenance_lease:false};
    else throw Error('Unexpected path '+path);
    return {ok:true,json:async()=>d};
  };
  return {fetcher,calls};
}
const args={nodeId,agentIds:[agentId],centralOrigin:'https://central.example.com',
  signer,pinnedPublicKeyPem:pub};
test('release archival and exact separately signed grant produce a one-shot durable restart attempt',()=>fixture(async dir=>{
  archiveFixture(dir);
  assert.equal(requiresReconciliation(dir),true);
  assert.equal(readReleased({dir,nodeId}).grant_id,releaseId);
  const requests=mock();
  const intent=await prepareManualRestart({...args,dir,grantEnvelope:signedGrant(),
    fetcher:requests.fetcher});
  assert.equal(intent.prepared,true);
  assert.equal(intent.agent_start_authorized_once,true);
  assert.equal(intent.automatic_restart_authorized,false);
  assert.deepEqual(requests.calls,[
    '/v7/nodes/maintenance/recovery/'+planId,'/v7/cluster/state',
    '/v7/nodes/me','/v7/cluster/state',
    '/v7/nodes/maintenance/recovery/'+planId]);
  const durable=JSON.parse(fs.readFileSync(path.join(dir,'maintenance-restart-attempt.json'),'utf8'));
  assert.equal(durable.restart_grant_id,restartId);
  assert.equal(durable.installer_executed,false);
  assert.equal(requiresReconciliation(dir),true);
  await assert.rejects(prepareManualRestart({...args,dir,
    grantEnvelope:signedGrant(),fetcher:mock().fetcher}),/PREVIOUS_ATTEMPT/);
}));
test('Owner signature, action, release grant ID and expiration are independently checked',()=>{
  const release={node_id:nodeId,plan_id:planId,wave_id:waveId,
    offer_sha256:offerSha256,grant_id:releaseId};
  assert.equal(verifyRestartGrant({envelope:signedGrant(),
    pinnedPublicKeyPem:pub,release}).accepted,true);
  for(const patch of [
    {node_id:'node_'+'f'.repeat(32)},{plan_id:'plan_other'},
    {wave_id:'wave_other'},{offer_sha256:'f'.repeat(64)},
    {release_grant_id:'f'.repeat(64)},{action:'release_maintenance_hold'},
    {expires_ms:Date.now()-1}
  ]){
    assert.throws(()=>verifyRestartGrant({envelope:signedGrant(patch),
      pinnedPublicKeyPem:pub,release}),/MAINTENANCE_RESTART_/);
  }
  assert.throws(()=>verifyRestartGrant({envelope:signedGrant(),
    pinnedPublicKeyPem:null,release}),/TRUST_UNCONFIGURED/);
  const wrong=signedGrant();wrong.signature_base64='AAAA';
  assert.throws(()=>verifyRestartGrant({envelope:wrong,
    pinnedPublicKeyPem:pub,release}),/SIGNATURE_INVALID/);
});
test('stale/changed cluster, busy agent, new fence and offline Central cannot create attempt',()=>fixture(async dir=>{
  archiveFixture(dir);
  const failures=[
    {cancel:{...recovery,any_active_fence:true}},
    {cancel:{...recovery,cancellation_verified:false}},
    {roles:{...cluster,phase:'RECOVERING'}},
    {roles:{...cluster,master_agent_id:agentId}},
    {roles:{...cluster,backups:['agent_backup_1',agentId]}},
    {secondRoles:{...cluster,epoch:22}},
    {agents:{...me,agents:[{...me.agents[0],status:'BUSY'}]}},
    {agents:{...me,agents:[{...me.agents[0],active_ticket:'ticket_unfinished'}]}},
    {agents:{...me,agents:[{...me.agents[0],has_live_work_lease:1}]}},
    {offline:true}
  ];
  for(const x of failures){
    await assert.rejects(prepareManualRestart({...args,dir,
      grantEnvelope:signedGrant(),fetcher:mock(x).fetcher}));
    assert.equal(fs.existsSync(path.join(dir,'maintenance-restart-attempt.json')),false);
  }
}));
test('missing/corrupt archive and an active hold always block restart',()=>fixture(async dir=>{
  archiveFixture(dir);
  fs.writeFileSync(path.join(dir,'maintenance-recovery-hold.released.'+releaseId+'.json'),'broken');
  assert.throws(()=>readReleased({dir,nodeId}),/CORRUPT/);
  fs.writeFileSync(path.join(dir,'maintenance-recovery-hold.released.'+releaseId+'.json'),
    JSON.stringify({schema:1,state:'OWNER_REVIEW_REQUIRED',node_id:nodeId,
      plan_id:planId,wave_id:waveId,offer_sha256:offerSha256,
      installer_execution_allowed:false,owner_release_allowed:false}));
  createHold({dir,nodeId,planId,waveId,offerSha256});
  assert.throws(()=>readReleased({dir,nodeId}),/LOCAL_HOLD_STILL_ACTIVE/);
}));
test('new local ACK requires a fresh timestamp, exact epoch, roles and identity',async()=>{
  const started=Date.now()-1000;
  const valid={node_id:nodeId,connection:'ACKNOWLEDGED',epoch:21,phase:'READY',
    master_agent_id:'agent_master_1',backups:['agent_backup_1','agent_backup_2'],
    agent_ids:[agentId],last_accepted_at:new Date(Date.now()).toISOString(),
    observed_at:new Date(Date.now()).toISOString()};
  const params={nodeId,agentIds:[agentId],epoch:21,startedAtMs:started};
  assert.equal(inspectFreshAck(valid,params),true);
  for(const patch of [
    {connection:'RECOVERY_BLOCKED'},{epoch:20},{phase:'RECOVERING'},
    {node_id:'node_'+'f'.repeat(32)},{agent_ids:['other_agent']},
    {master_agent_id:agentId},
    {observed_at:new Date(started-60000).toISOString()},
    {last_accepted_at:new Date(started-60000).toISOString()}
  ])assert.equal(inspectFreshAck({...valid,...patch},params),false);
  let reads=0;
  const ack=await waitForFreshAck({dir:os.tmpdir(),...params,
    isChildActive:()=>true,timeoutMs:200,pollMs:5,
    readStatus:()=>++reads===1?{...valid,connection:'RECOVERY_BLOCKED'}:valid});
  assert.equal(ack.confirmed,true);
  assert.ok(reads>=2);
  const refused=await waitForFreshAck({dir:os.tmpdir(),...params,
    isChildActive:()=>false,timeoutMs:100,pollMs:5,readStatus:()=>valid});
  assert.equal(refused.confirmed,false);
});
test('fresh Central checks after ACK reject withdrawn node or new maintenance, and preserve barrier',()=>fixture(async dir=>{
  archiveFixture(dir);
  const yes=await confirmLiveCentral({...args,epoch:21,fetcher:mock({
    agents:{...me,agents:[{...me.agents[0],status:'ONLINE',
      heartbeat_age_seconds:6}]}
  }).fetcher});
  assert.equal(yes.reconciled,true);
  for(const x of [
    {agents:{...me,agents:[{...me.agents[0],heartbeat_age_seconds:180}]}},
    {roles:{...cluster,epoch:22}},
    {maintenance:{node_id:nodeId,intent:{state:'DRAINING'},
      installer_execution_allowed:false,owner_maintenance_lease:false}},
    {offline:true}
  ])await assert.rejects(confirmLiveCentral({...args,epoch:21,
    fetcher:mock(x).fetcher}));
  const ack={confirmed:true,node_id:nodeId,epoch:21,
    last_accepted_at:new Date().toISOString(),observed_at:new Date().toISOString()};
  const recorded=recordFreshAck({dir,nodeId,grantId:restartId,ack});
  assert.equal(recorded.recorded,true);
  assert.equal(requiresReconciliation(dir),true);
  assert.throws(()=>recordFreshAck({dir,nodeId,grantId:restartId,ack}),/EEXIST/);
}));
