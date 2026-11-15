/**
 * Signed, non-mutating-from-device update safety preflight.
 * Central's GET /v7/cluster/state may itself evaluate expired leases.
 * This is a moment-in-time advisory; NEVER authorizes installer execution.
 */
'use strict';
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
function fail(code){throw Error(code);}
function validOrigin(value){
  let u;
  try{u=new URL(value);}catch{fail('UPDATE_READINESS_CENTRAL_ORIGIN_INVALID');}
  if(typeof value!=='string'||u.protocol!=='https:'||u.username||u.password||
    u.pathname!=='/'||u.search||u.hash||u.origin!==value||
    (u.port&&u.port!=='443'))fail('UPDATE_READINESS_CENTRAL_ORIGIN_INVALID');
  return u.origin;
}
async function checkReadiness({
  centralOrigin,nodeId,agentIds,signer,fetcher=fetch,now=Date.now()
}={}){
  const origin=validOrigin(centralOrigin);
  if(typeof nodeId!=='string'||!NODE.test(nodeId)||
    !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
    agentIds.some(id=>typeof id!=='string'||!ID.test(id))||
    new Set(agentIds).size!==agentIds.length||
    !Number.isSafeInteger(now)||now<0)
    fail('UPDATE_READINESS_LOCAL_IDENTITY_INVALID');
  if(!signer||typeof signer.sign!=='function')
    fail('UPDATE_READINESS_SIGNER_UNAVAILABLE');
  async function read(uri){
    const signed=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!signed||signed['x-sutradhar-node']!==nodeId||
      typeof signed['x-sutradhar-signature']!=='string'||
      typeof signed['x-sutradhar-nonce']!=='string')
      fail('UPDATE_READINESS_SIGNER_PROOF_INVALID');
    let r;
    try{
      r=await fetcher(origin+uri,{method:'GET',
        headers:{...signed,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(12000)});
    }catch{fail('UPDATE_READINESS_CENTRAL_UNREACHABLE');}
    if(!r?.ok)fail('UPDATE_READINESS_CENTRAL_AUTH_OR_HEALTH_FAILED');
    let data;
    try{data=await r.json();}catch{fail('UPDATE_READINESS_INVALID_CENTRAL_RESPONSE');}
    if(!data||typeof data!=='object'||Array.isArray(data))
      fail('UPDATE_READINESS_INVALID_CENTRAL_RESPONSE');
    return data;
  }
  const me=await read('/v7/nodes/me');
  if(me.node_id!==nodeId||!Array.isArray(me.agents))
    fail('UPDATE_READINESS_NODE_ID_MISMATCH');
  const approved=new Set();
  for(const a of me.agents){
    if(!a||typeof a.agent_id!=='string'||!ID.test(a.agent_id)||
       approved.has(a.agent_id)||a.state!=='APPROVED')
      fail('UPDATE_READINESS_AGENTS_NOT_APPROVED');
    approved.add(a.agent_id);
  }
  if(agentIds.some(id=>!approved.has(id))||approved.size!==agentIds.length)
    fail('UPDATE_READINESS_AGENT_IDENTITY_MISMATCH');

  const cluster=await read('/v7/cluster/state');
  if(!Number.isSafeInteger(cluster.epoch)||cluster.epoch<1||
    typeof cluster.master_agent_id!=='string'||!ID.test(cluster.master_agent_id)||
    cluster.phase!=='READY'||cluster.paused!==false||
    !Array.isArray(cluster.backups)||cluster.backups.length!==2||
    cluster.backups.some(id=>id!==null&&(typeof id!=='string'||!ID.test(id)))||
    new Set([cluster.master_agent_id,...cluster.backups].filter(Boolean)).size!==
      [cluster.master_agent_id,...cluster.backups].filter(Boolean).length)
    fail('UPDATE_READINESS_CLUSTER_UNHEALTHY');
  const active=new Set([cluster.master_agent_id,...cluster.backups].filter(Boolean));
  if(agentIds.some(id=>active.has(id)))
    fail('UPDATE_READINESS_ACTIVE_MASTER_OR_BACKUP');
  return Object.freeze({
    accepted:true,status:'NON_CRITICAL_AT_CHECK_TIME',
    node_id:nodeId,epoch:cluster.epoch,checked_at_ms:now,
    installer_execution_allowed:false,requires_owner_approval:true,
    warning:'Cluster roles can change immediately after this check; recheck before any real maintenance.'
  });
}
module.exports={checkReadiness,validOrigin};
