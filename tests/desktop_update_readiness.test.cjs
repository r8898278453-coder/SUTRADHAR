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
const signer={sign:({kind,method,uri,body})=>{
  assert.equal(kind,'node_api');assert.equal(method,'GET');assert.equal(body,'');
  assert.ok(['/v7/nodes/me','/v7/cluster/state'].includes(uri));
  return {'x-sutradhar-node':nodeId,
    'x-sutradhar-signature':'test-sig','x-sutradhar-nonce':'test-nonce'};
}};
const makeFetch=(nodeResponse=me,clusterResponse=cluster,calls=[])=>async(url,opts)=>{
  calls.push({url,opts});
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.body,undefined);
  assert.equal(url.startsWith('https://stage.example.com/v7/'),true);
  return {ok:true,json:async()=>url.endsWith('/nodes/me')?nodeResponse:clusterResponse};
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
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),
    ['/v7/nodes/me','/v7/cluster/state']);
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
