'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkReadiness}=require('../apps/desktop/update-readiness.cjs');
const nodeId='node_'+'a'.repeat(32);
const mine='agent_worker_1';
const cluster={epoch:17,master_agent_id:'agent_master_01',phase:'READY',
  paused:false,backups:['agent_backup_01','agent_backup_02']};
const safeAgent=(id=mine)=>({agent_id:id,state:'APPROVED',status:'IDLE',
  active_ticket:null,heartbeat_age_seconds:15,
  has_live_work_lease:0,has_unreconciled_git_job:0});
const me={node_id:nodeId,agents:[safeAgent()]};
const maintenance={node_id:nodeId,intent:null,installer_execution_allowed:false,owner_maintenance_lease:false};
const signer={sign:({kind,method,uri,body})=>{
  assert.equal(kind,'node_api');assert.equal(method,'GET');assert.equal(body,'');
  assert.ok(['/v7/nodes/me','/v7/cluster/state','/v7/nodes/maintenance'].includes(uri));
  return {'x-sutradhar-node':nodeId,
    'x-sutradhar-signature':'test-sig','x-sutradhar-nonce':'test-nonce'};
}};
const makeFetch=(nodeResponse=me,clusterResponse=cluster,calls=[],
  intentResponse=maintenance)=>async(url,opts)=>{
  calls.push({url,opts});
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.body,undefined);
  assert.equal(url.startsWith('https://stage.example.com/v7/'),true);
  const body=url.endsWith('/nodes/me')?nodeResponse:
    url.endsWith('/nodes/maintenance')?intentResponse:clusterResponse;
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
};
const args={centralOrigin:'https://stage.example.com',nodeId,agentIds:[mine],signer};
test('signed Central update readiness is advisory, not authorization to execute',async()=>{
  const calls=[];
  const r=await checkReadiness({...args,fetcher:makeFetch(me,cluster,calls),
    now:Date.parse('2026-11-15T12:00:00Z')});
  assert.deepEqual({status:r.status,accepted:r.accepted,epoch:r.epoch,
    installer_execution_allowed:r.installer_execution_allowed},
  {status:'NON_CRITICAL_AT_CHECK_TIME',accepted:true,epoch:17,
    installer_execution_allowed:false});
  assert.equal(r.requires_owner_approval,true);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),
    ['/v7/nodes/me','/v7/cluster/state','/v7/nodes/maintenance']);
});
test('deny signed preflight on Master, Backup 1 or Backup 2 PCs',async()=>{
  for(const role of ['agent_master_01','agent_backup_01','agent_backup_02']){
    const nodeResponse={...me,agents:[safeAgent(role)]};
    await assert.rejects(checkReadiness({...args,agentIds:[role],
      fetcher:makeFetch(nodeResponse)}),/ACTIVE_MASTER_OR_BACKUP/);
  }
});
test('deny unapproved/mismatched identities and unhealthy/paused/recovering clusters',async()=>{
  for(const nodes of [
    {...me,node_id:'node_'+'b'.repeat(32)},
    {...me,agents:[{...safeAgent(),state:'PENDING'}]},
    {...me,agents:[safeAgent('agent_other')]}
  ])await assert.rejects(checkReadiness({...args,fetcher:makeFetch(nodes)}),
    /MISMATCH|NOT_APPROVED/);
  for(const changes of [
    {phase:'RECOVERING'},{phase:'NO_MASTER'},{paused:true},{epoch:-1},
    {master_agent_id:null},{backups:['agent_master_01',null]},
    {backups:['agent_backup_01','agent_backup_01']},
    {backups:[null,null]},{backups:['agent_backup_01',null]},
    {backups:[]}
  ])await assert.rejects(checkReadiness({...args,
    fetcher:makeFetch(me,{...cluster,...changes})}),/CLUSTER_UNHEALTHY/);
});
test('deny malformed URL, leaked credentials, and any remote failure',async()=>{
  for(const centralOrigin of [
    'http://stage.example.com','https://a@stage.example.com',
    'https://stage.example.com/path','https://stage.example.com/?token=x',
    'https://stage.example.com/#fragment'
  ])await assert.rejects(checkReadiness({...args,centralOrigin}),
    /ORIGIN_INVALID/);
  await assert.rejects(checkReadiness({...args,fetcher:async()=>{throw Error('offline');}}),
    /CENTRAL_UNREACHABLE/);
  await assert.rejects(checkReadiness({...args,fetcher:async()=>({ok:false,status:503})}),
    /AUTH_OR_HEALTH_FAILED/);
  await assert.rejects(checkReadiness({...args,signer:{sign:()=>({})},fetcher:makeFetch()}),
    /SIGNER_PROOF_INVALID/);
});

test('refuse maintenance for stale heartbeat, outstanding lease, Git write or busy worker',async()=>{
  for(const patch of [
    {heartbeat_age_seconds:null},{heartbeat_age_seconds:181},
    {heartbeat_age_seconds:-10},{heartbeat_age_seconds:'invalid'},
    {status:'BUSY'},{active_ticket:'ticket_active'},
    {has_live_work_lease:1},{has_unreconciled_git_job:1}
  ]){
    const bad={...me,agents:[{...safeAgent(),...patch}]};
    await assert.rejects(checkReadiness({...args,fetcher:makeFetch(bad)}),
      /HEARTBEAT_STALE|UNFINISHED_AGENT_WORK/,
      'Unfinished/stale condition was not refused: '+JSON.stringify(patch));
  }
});

test('Owner intent is shown only when signed, epoch-matching, unexpired and still no install permission',async()=>{
  const now=Date.parse('2026-11-15T12:00:00Z');
  const intent={plan_id:'plan_pilot_001',state:'INTENT_ONLY',
    wave_id:'wave_pilot01',offer_sha256:'d'.repeat(64),
    expected_epoch:17,target_version:'7.1.0',
    expires_at:'2026-11-15 12:05:00.000'};
  const valid={...maintenance,intent};
  const result=await checkReadiness({...args,now,
    fetcher:makeFetch(me,cluster,[],valid)});
  assert.equal(result.accepted,true);
  assert.equal(result.owner_intent_present,true);
  assert.equal(result.owner_intent_id,intent.plan_id);
  assert.equal(result.installer_execution_allowed,false);
  for(const broken of [
    {...valid,installer_execution_allowed:true},
    {...valid,node_id:'node_'+'b'.repeat(32)},
    {...valid,intent:{...intent,state:'STALE_EPOCH'}},
    {...valid,intent:{...intent,state:'DRAINING',fence_active:true}},
    {...valid,intent:{...intent,state:'DRAINED',fence_active:true}},
    {...valid,intent:{...intent,expected_epoch:16}},
    {...valid,intent:{...intent,offer_sha256:'not-hex'}},
    {...valid,intent:{...intent,expires_at:'2026-11-15 11:59:59.000'}}
  ])await assert.rejects(checkReadiness({...args,now,
    fetcher:makeFetch(me,cluster,[],broken)}),
    /OWNER_INTENT_RESPONSE_INVALID|OWNER_INTENT_STALE_OR_INVALID|OWNER_INTENT_EXPIRED|PC_DRAIN_FENCED/);
});

test('oversized Central body cannot yield maintenance readiness approval',async()=>{
  const giant=async()=>new Response(JSON.stringify({padding:'z'.repeat(70000)}),{
    headers:{'content-type':'application/json'}});
  await assert.rejects(checkReadiness({...args,fetcher:giant}),
    /UPDATE_READINESS_RESPONSE_TOO_LARGE/);
});
