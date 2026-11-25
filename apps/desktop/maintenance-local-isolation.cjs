/**
 * Owner-fenced local maintenance isolation (NO installer capability).
 * Reads three signed Central snapshots, requires exact DRAINED fence and
 * independently idle local agents, then writes a durable hold BEFORE callers
 * stop a child agent. Fail closed on stale/offline/mismatched responses.
 */
'use strict';
const {validOrigin}=require('./update-readiness.cjs');
const {boundedCentralJson}=require('./bounded-central-json.cjs');
const {createHold,inspectHold}=require('./maintenance-recovery-hold.cjs');
const NODE=/^node_[0-9a-f]{32}$/;
const AGENT=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const HEX=/^[0-9a-f]{64}$/;
const PLAN=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
function fail(code){throw Error(code);}
async function isolateDrainedPc({dir,centralOrigin,nodeId,agentIds,signer,
  fetcher=fetch,now=Date.now()}={}){
  const origin=validOrigin(centralOrigin);
  if(typeof dir!=='string'||!NODE.test(nodeId||'')||
     !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
     agentIds.some(x=>!AGENT.test(x))||new Set(agentIds).size!==agentIds.length||
     !Number.isSafeInteger(now)||now<0||!signer||typeof signer.sign!=='function')
    fail('MAINTENANCE_ISOLATION_LOCAL_IDENTITY_INVALID');
  const existing=inspectHold({dir,nodeId});
  if(existing.active)fail('MAINTENANCE_ISOLATION_ALREADY_HELD_OWNER_REVIEW');
  async function read(uri){
    const signed=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!signed||signed['x-sutradhar-node']!==nodeId||
       typeof signed['x-sutradhar-signature']!=='string'||
       typeof signed['x-sutradhar-nonce']!=='string')
      fail('MAINTENANCE_ISOLATION_SIGNED_IDENTITY_REQUIRED');
    let response;
    try{response=await fetcher(origin+uri,{method:'GET',
      headers:{...signed,Accept:'application/json'},redirect:'error',
      cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(12000)});}
    catch{fail('MAINTENANCE_ISOLATION_CENTRAL_UNREACHABLE');}
    if(!response?.ok)fail('MAINTENANCE_ISOLATION_CENTRAL_REJECTED');
    let data;
    try{data=await boundedCentralJson(response);}
    catch(error){
      if(error?.message==='CENTRAL_JSON_TOO_LARGE')
        fail('MAINTENANCE_ISOLATION_RESPONSE_TOO_LARGE');
      fail('MAINTENANCE_ISOLATION_RESPONSE_INVALID');
    }
    return data;
  }
  const first=await read('/v7/nodes/maintenance');
  const intent=first.intent;
  if(first.node_id!==nodeId||first.installer_execution_allowed!==false||
     first.owner_maintenance_lease!==false||!intent||
     typeof intent!=='object'||Array.isArray(intent)||
     intent.state!=='DRAINED'||intent.fence_active!==true||
     intent.fence_release_requires_owner!==true||
     !PLAN.test(intent.plan_id||'')||!WAVE.test(intent.wave_id||'')||
     !HEX.test(intent.offer_sha256||'')||
     !Number.isSafeInteger(intent.expected_epoch)||intent.expected_epoch<1)
    fail('MAINTENANCE_ISOLATION_OWNER_DRAIN_NOT_VERIFIED');
  const cluster=await read('/v7/cluster/state');
  if(cluster.epoch!==intent.expected_epoch||cluster.phase!=='READY'||
     cluster.paused!==false||!AGENT.test(cluster.master_agent_id||'')||
     !Array.isArray(cluster.backups)||cluster.backups.length!==2||
     cluster.backups.some(x=>!AGENT.test(x))||
     new Set([cluster.master_agent_id,...cluster.backups]).size!==3)
    fail('MAINTENANCE_ISOLATION_CLUSTER_UNHEALTHY');
  const roles=new Set([cluster.master_agent_id,...cluster.backups]);
  if(agentIds.some(x=>roles.has(x)))
    fail('MAINTENANCE_ISOLATION_MASTER_OR_BACKUP');
  const me=await read('/v7/nodes/me');
  if(me.node_id!==nodeId||!Array.isArray(me.agents)||me.agents.length!==agentIds.length)
    fail('MAINTENANCE_ISOLATION_DEVICE_AGENTS_MISMATCH');
  const seen=new Set();
  for(const agent of me.agents){
    if(!agent||!AGENT.test(agent.agent_id)||seen.has(agent.agent_id)||
       !agentIds.includes(agent.agent_id)||agent.state!=='APPROVED'||
       agent.status!=='IDLE'||agent.active_ticket!==null||
       ![0,false].includes(agent.has_live_work_lease)||
       ![0,false].includes(agent.has_unreconciled_git_job)||
       !Number.isSafeInteger(Number(agent.heartbeat_age_seconds))||
       Number(agent.heartbeat_age_seconds)<0||
       Number(agent.heartbeat_age_seconds)>180)
      fail('MAINTENANCE_ISOLATION_UNFINISHED_WORK');
    seen.add(agent.agent_id);
  }
  // Repeat the authoritative fence read after inspecting independent state:
  // do not act on a stale/withdrawn Owner fence observed only once.
  const final=await read('/v7/nodes/maintenance');
  if(final.node_id!==nodeId||final.installer_execution_allowed!==false||
     final.owner_maintenance_lease!==false||
     final.intent?.plan_id!==intent.plan_id||
     final.intent?.wave_id!==intent.wave_id||
     final.intent?.offer_sha256!==intent.offer_sha256||
     final.intent?.expected_epoch!==intent.expected_epoch||
     final.intent?.state!=='DRAINED'||final.intent?.fence_active!==true||
     final.intent?.fence_release_requires_owner!==true)
    fail('MAINTENANCE_ISOLATION_FENCE_CHANGED');
  const hold=createHold({dir,nodeId,planId:intent.plan_id,
    waveId:intent.wave_id,offerSha256:intent.offer_sha256,now});
  return Object.freeze({isolated_locally:true,hold_created:hold.created,
    node_id:nodeId,plan_id:intent.plan_id,wave_id:intent.wave_id,
    agent_start_allowed:false,installer_execution_allowed:false,
    owner_release_allowed:false,production_approved:false,
    warning:'The local hold is persistent and does not authorize installer execution; Owner-controlled recovery is required.'});
}
module.exports={isolateDrainedPc};
