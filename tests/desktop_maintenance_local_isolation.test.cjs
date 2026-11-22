'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {isolateDrainedPc}=require('../apps/desktop/maintenance-local-isolation.cjs');
const {inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const nodeId='node_'+'a'.repeat(32),agentId='agent_worker_1';
const intent={plan_id:'plan_pilot_123',wave_id:'wave_pilot01',offer_sha256:'c'.repeat(64),
  expected_epoch:17,state:'DRAINED',fence_active:true,fence_release_requires_owner:true};
const maintenance={node_id:nodeId,intent,installer_execution_allowed:false,owner_maintenance_lease:false};
const cluster={epoch:17,phase:'READY',paused:false,master_agent_id:'agent_master_1',
  backups:['agent_backup_1','agent_backup_2']};
const me={node_id:nodeId,agents:[{agent_id:agentId,state:'APPROVED',status:'IDLE',
  active_ticket:null,heartbeat_age_seconds:8,has_live_work_lease:0,has_unreconciled_git_job:0}]};
const signer={sign:({kind,method,uri,body})=>{
  assert.equal(kind,'node_api');assert.equal(method,'GET');assert.equal(body,'');
  assert.ok(['/v7/nodes/me','/v7/cluster/state','/v7/nodes/maintenance'].includes(uri));
  return {'x-sutradhar-node':nodeId,'x-sutradhar-signature':'signed',
    'x-sutradhar-nonce':'nonce'};
}};
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-isolation-'));
  return Promise.resolve().then(()=>fn(dir)).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
}
function mock({first=maintenance,last=first,roles=cluster,agents=me,offline=false}={}){
  let n=0;const calls=[];
  return {calls,fetcher:async(url,options)=>{
    calls.push(new URL(url).pathname);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    if(offline)throw Error('offline');
    const pathname=new URL(url).pathname;
    const data=pathname.endsWith('/nodes/maintenance')?(++n===1?first:last):
      pathname.endsWith('/cluster/state')?roles:agents;
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  }};
}
const args={centralOrigin:'https://central.example.com',nodeId,agentIds:[agentId],
  signer,now:1700000000000};
test('only a durable signed DRAINED fence can create a local non-executing hold',()=>fixture(async dir=>{
  const {fetcher,calls}=mock();
  const result=await isolateDrainedPc({...args,dir,fetcher});
  assert.equal(result.isolated_locally,true);
  assert.equal(result.installer_execution_allowed,false);
  assert.equal(result.owner_release_allowed,false);
  assert.deepEqual(calls,['/v7/nodes/maintenance','/v7/cluster/state',
    '/v7/nodes/me','/v7/nodes/maintenance']);
  assert.equal(inspectHold({dir,nodeId}).agent_start_allowed,false);
  await assert.rejects(isolateDrainedPc({...args,dir,fetcher}),/ALREADY_HELD/);
}));
test('no hold when fence missing, stale, withdrawn, or cluster epoch changed',()=>fixture(async dir=>{
  const variations=[
    {first:{...maintenance,intent:{...intent,state:'DRAINING'}}},
    {first:{...maintenance,intent:{...intent,fence_active:false}}},
    {first:{...maintenance,intent:null}},
    {last:{...maintenance,intent:{...intent,state:'INTENT_ONLY'}}},
    {last:{...maintenance,intent:{...intent,offer_sha256:'d'.repeat(64)}}},
    {roles:{...cluster,epoch:18}},
    {roles:{...cluster,phase:'RECOVERING'}},
    {roles:{...cluster,master_agent_id:agentId}},
    {roles:{...cluster,backups:['agent_backup_1',agentId]}},
    {offline:true}
  ];
  for(const x of variations){
    await assert.rejects(isolateDrainedPc({...args,dir,fetcher:mock(x).fetcher}));
    assert.equal(inspectHold({dir,nodeId}).active,false);
  }
}));
test('no hold when local agent work, enrollment or identity evidence is unsafe',()=>fixture(async dir=>{
  const variations=[
    {agents:{...me,node_id:'node_'+'b'.repeat(32)}},
    {agents:{...me,agents:[{...me.agents[0],status:'BUSY'}]}},
    {agents:{...me,agents:[{...me.agents[0],active_ticket:'ticket_active'}]}},
    {agents:{...me,agents:[{...me.agents[0],has_live_work_lease:1}]}},
    {agents:{...me,agents:[{...me.agents[0],has_unreconciled_git_job:1}]}},
    {agents:{...me,agents:[{...me.agents[0],heartbeat_age_seconds:181}]}},
    {agents:{...me,agents:[{...me.agents[0],state:'PENDING'}]}},
  ];
  for(const x of variations){
    await assert.rejects(isolateDrainedPc({...args,dir,fetcher:mock(x).fetcher}));
    assert.equal(inspectHold({dir,nodeId}).active,false);
  }
}));
test('invalid local identity and signed request headers cannot write a hold',()=>fixture(async dir=>{
  await assert.rejects(isolateDrainedPc({...args,dir,
    nodeId:'node_bad',fetcher:mock().fetcher}),/LOCAL_IDENTITY_INVALID/);
  await assert.rejects(isolateDrainedPc({...args,dir,
    signer:{sign:()=>({})},fetcher:mock().fetcher}),/SIGNED_IDENTITY_REQUIRED/);
  assert.equal(inspectHold({dir,nodeId}).active,false);
}));

test('oversized Central signed response cannot activate local PC isolation hold',()=>fixture(async dir=>{
  const oversized=async()=>new Response(JSON.stringify({data:'X'.repeat(70000)}),{
    headers:{'content-type':'application/json'}});
  await assert.rejects(isolateDrainedPc({...args,dir,fetcher:oversized}),
    /MAINTENANCE_ISOLATION_RESPONSE_TOO_LARGE/);
  assert.equal(inspectHold({dir,nodeId}).active,false);
}));
