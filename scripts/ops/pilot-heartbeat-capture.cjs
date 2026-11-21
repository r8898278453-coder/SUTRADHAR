/**
 * Manual single Central-ACKNOWLEDGED heartbeat sample (not a signed
 * heartbeat or device attestation). Reuses the pilot's exact host pin,
 * public DNS check, bounded GET and role policy; never schedules polls
 * or changes Central. Owners manually repeat at ~60 second intervals.
 */
'use strict';
const dns=require('node:dns').promises,net=require('node:net');
const {parseTarget,readJson}=require('./pilot-capture.cjs');
const {publicAddress}=require('./hostinger-staging-preflight.cjs');
const {evaluatePilot}=require('./pilot-policy.cjs');
const NODE=/^node_[a-f0-9]{32}$/,SHA=/^[a-f0-9]{40}$/;
const failure=code=>({accepted:false,error_code:code,
  signed_heartbeats_verified:false,production_release_authorized:false});
function parseLastSeen(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z?$/.test(value))
    throw Error('PILOT_HEARTBEAT_TIMESTAMP_INVALID');
  const t=Date.parse(value.endsWith('Z')?value:value+'Z');
  if(!Number.isFinite(t))throw Error('PILOT_HEARTBEAT_TIMESTAMP_INVALID');
  return t;
}
async function captureHeartbeat({origin,allowedHostname,expectedSha,nodeIds,
  adminKey,fetcher=fetch,resolveHost=async host=>dns.lookup(host,{all:true}),
  now=Date.now()}={}){
  const url=parseTarget(origin,allowedHostname);
  if(!url||!SHA.test(expectedSha||'')||!Number.isSafeInteger(now)||now<1||
     !Array.isArray(nodeIds)||nodeIds.length<2||nodeIds.length>10||
     nodeIds.some(id=>!NODE.test(id))||
     new Set(nodeIds).size!==nodeIds.length||
     typeof adminKey!=='string'||adminKey.length<32||/\s/.test(adminKey))
    return failure('PILOT_HEARTBEAT_OWNER_CONTEXT_UNTRUSTED');
  try{
    const answers=await resolveHost(url.hostname);
    if(!Array.isArray(answers)||answers.length<1||answers.length>16||
       answers.some(x=>!x||(x.family!==4&&x.family!==6)||
         net.isIP(x.address)!==x.family||!publicAddress(x.address)))
      return failure('PILOT_HEARTBEAT_DNS_UNVERIFIED');
    const health=await readJson(fetcher,url.origin+'/v7/health',adminKey);
    if(health.ready!==true||health.authority!=='mysql'||health.api_protocol!==7)
      return failure('PILOT_HEARTBEAT_CENTRAL_NOT_READY');
    const remote=await readJson(fetcher,url.origin+'/v7/cluster',adminKey);
    const accepted=evaluatePilot(remote,nodeIds,now,[]);
    if(!accepted.accepted)
      return failure('PILOT_HEARTBEAT_ROLE_OR_FRESHNESS_INVALID');
    if(!Array.isArray(remote.agents)||remote.agents.length<nodeIds.length||
       remote.agents.length>200)
      return failure('PILOT_HEARTBEAT_AGENTS_INVALID');
    const observations=[];
    for(const a of remote.agents){
      if(!nodeIds.includes(a.node_id))continue;
      if(a.state!=='APPROVED'||a.node_state!=='APPROVED')
        return failure('PILOT_HEARTBEAT_AGENT_REVOKED');
      const last_seen_ms=parseLastSeen(a.last_seen);
      if(last_seen_ms>now||now-last_seen_ms>=180000||
         typeof a.agent_id!=='string'||a.agent_id.length>100)
        return failure('PILOT_HEARTBEAT_STALE_OR_INVALID');
      observations.push({node_id:a.node_id,agent_id:a.agent_id,
        last_seen_ms});
    }
    observations.sort((a,b)=>a.node_id.localeCompare(b.node_id)||
      a.agent_id.localeCompare(b.agent_id));
    if(new Set(observations.map(a=>a.agent_id)).size!==observations.length||
       new Set(observations.map(a=>a.node_id)).size!==nodeIds.length)
      return failure('PILOT_HEARTBEAT_NONUNIQUE_OR_MISSING');
    return {accepted:true,schema:1,mode:'OWNER_CENTRAL_ACKNOWLEDGED_HEARTBEAT_SAMPLE',
      source_sha_claim:expectedSha,central_origin:url.origin,
      checked_node_ids:[...nodeIds],
      measured_at_ms:now,master_agent_id:accepted.master_agent_id,
      master_node_id:accepted.master_node_id,
      backup1:accepted.backup1,backup1_node_id:accepted.backup1_node_id,
      backup2:accepted.backup2,backup2_node_id:accepted.backup2_node_id,
      epoch:accepted.epoch,phase:accepted.phase,
      agent_observations:observations,
      signed_heartbeats_verified:false,
      node_key_possession_verified:false,
      physical_machine_verified:false,production_release_authorized:false,
      read_only:true};
  }catch{return failure('PILOT_HEARTBEAT_READ_ONLY_CAPTURE_FAILED');}
}
module.exports={captureHeartbeat,parseLastSeen};
