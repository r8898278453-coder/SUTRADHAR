/**
 * Offline Owner inspection of successive, Central-ACKNOWLEDGED last_seen
 * readings. Sample interval must be 45..95 seconds and each approved agent
 * must advance its Central timestamp by 30..105 seconds. This is NOT
 * verification of the original Ed25519 heartbeat request or OS identity.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const NODE=/^node_[a-f0-9]{32}$/,SHA=/^[a-f0-9]{40}$/;
const keys=[
  'accepted','schema','mode','source_sha_claim','central_origin',
  'checked_node_ids','measured_at_ms',
  'master_agent_id','master_node_id','backup1','backup1_node_id',
  'backup2','backup2_node_id','epoch','phase','agent_observations',
  'signed_heartbeats_verified','node_key_possession_verified',
  'physical_machine_verified','production_release_authorized','read_only'
].sort().join('|');
function deny(code){return {accepted:false,error_code:code,
  central_heartbeat_cadence_observed:false,
  signed_heartbeats_verified:false,physical_machine_verified:false,
  production_release_authorized:false,read_only:true};}
const exact=x=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===keys;
const agentId=x=>typeof x==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(x);
function audit({samples,expectedSha,expectedNodeIds,expectedOrigin,
  now=Date.now()}={}){
  if(!SHA.test(expectedSha||'')||!Number.isSafeInteger(now)||now<1||
     !Array.isArray(expectedNodeIds)||expectedNodeIds.length<2||
     expectedNodeIds.length>10||expectedNodeIds.some(n=>!NODE.test(n))||
     new Set(expectedNodeIds).size!==expectedNodeIds.length||
     typeof expectedOrigin!=='string'||!/^https:\/\/[a-z0-9][a-z0-9.-]{2,250}$/.test(expectedOrigin)||
     !Array.isArray(samples)||samples.length<4||samples.length>12)
    return deny('PILOT_HEARTBEAT_AUDIT_OWNER_SCOPE_INVALID');
  let previous=null,identity=null,firstTime=0;
  for(const s of samples){
    if(!exact(s)||s.accepted!==true||s.schema!==1||
       s.mode!=='OWNER_CENTRAL_ACKNOWLEDGED_HEARTBEAT_SAMPLE'||
       s.source_sha_claim!==expectedSha||
       s.central_origin!==expectedOrigin||
       JSON.stringify(s.checked_node_ids)!==JSON.stringify(expectedNodeIds)||
       s.signed_heartbeats_verified!==false||
       s.node_key_possession_verified!==false||
       s.physical_machine_verified!==false||
       s.production_release_authorized!==false||s.read_only!==true||
       !Number.isSafeInteger(s.measured_at_ms)||s.measured_at_ms<=0||
       s.measured_at_ms>now+120000||s.phase!=='READY'||
       !Number.isSafeInteger(s.epoch)||s.epoch<1||
       !agentId(s.master_agent_id)||!NODE.test(s.master_node_id||'')||
       !agentId(s.backup1)||!NODE.test(s.backup1_node_id||'')||
       s.master_node_id===s.backup1_node_id||
       (expectedNodeIds.length>=3&&
        (!agentId(s.backup2)||!NODE.test(s.backup2_node_id||'')||
         [s.master_node_id,s.backup1_node_id].includes(s.backup2_node_id)))||
       !Array.isArray(s.agent_observations)||s.agent_observations.length<
         expectedNodeIds.length||s.agent_observations.length>40)
      return deny('PILOT_HEARTBEAT_SNAPSHOT_UNTRUSTED');
    const agentMap=new Map(),seenNodes=new Set();
    for(const a of s.agent_observations){
      if(!a||Object.keys(a).sort().join('|')!=='agent_id|last_seen_ms|node_id'||
         !agentId(a.agent_id)||!expectedNodeIds.includes(a.node_id)||
         !Number.isSafeInteger(a.last_seen_ms)||
         a.last_seen_ms>s.measured_at_ms||
         s.measured_at_ms-a.last_seen_ms>=180000||
         agentMap.has(a.agent_id))
        return deny('PILOT_HEARTBEAT_AGENT_IDENTITY_OR_TIME_INVALID');
      agentMap.set(a.agent_id,a);seenNodes.add(a.node_id);
    }
    if(seenNodes.size!==expectedNodeIds.length||
       !agentMap.has(s.master_agent_id)||
       agentMap.get(s.master_agent_id).node_id!==s.master_node_id||
       !agentMap.has(s.backup1)||
       agentMap.get(s.backup1).node_id!==s.backup1_node_id||
       (expectedNodeIds.length>=3&&
        (!agentMap.has(s.backup2)||
         agentMap.get(s.backup2).node_id!==s.backup2_node_id)))
      return deny('PILOT_HEARTBEAT_ROLES_NOT_IN_APPROVED_NODES');
    const currentRoles=JSON.stringify([s.master_agent_id,s.master_node_id,
      s.backup1,s.backup1_node_id,s.backup2,s.backup2_node_id,s.epoch]);
    if(identity===null)identity=currentRoles;
    else if(identity!==currentRoles)
      return deny('PILOT_HEARTBEAT_MASTER_OR_EPOCH_CHANGED');
    if(previous){
      const delta=s.measured_at_ms-previous.at;
      if(delta<45000||delta>95000||
         agentMap.size!==previous.agentMap.size)
        return deny('PILOT_HEARTBEAT_SAMPLE_INTERVAL_OR_IDENTITY_CHANGED');
      for(const [id,a] of agentMap){
        const old=previous.agentMap.get(id);
        if(!old||old.node_id!==a.node_id||
           a.last_seen_ms-old.last_seen_ms<30000||
           a.last_seen_ms-old.last_seen_ms>105000)
          return deny('PILOT_HEARTBEAT_ACK_PROGRESS_NOT_60_SECOND_CADENCE');
      }
    }else firstTime=s.measured_at_ms;
    previous={at:s.measured_at_ms,agentMap};
  }
  if(now-previous.at>300000||previous.at-firstTime>18*60000)
    return deny('PILOT_HEARTBEAT_EVIDENCE_STALE');
  return {accepted:true,status:'CENTRAL_LAST_SEEN_60_SECOND_CADENCE_ONLY',
    sample_count:samples.length,node_count:expectedNodeIds.length,
    agent_count:previous.agentMap.size,source_sha_claim:expectedSha,
    interval_bounds_ms:{min:45000,max:95000},
    central_heartbeat_cadence_observed:true,
    signed_heartbeats_verified:false,
    physical_machine_verified:false,physical_reboot_verified:false,
    production_release_authorized:false,read_only:true,
    warning:'Central last_seen progress is not independent Ed25519 packet proof, actual physical hardware, or 08:00 election/rollback acceptance.'};
}
function readSample(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.length>1024)
    throw Error('PILOT_HEARTBEAT_SAMPLE_ABSOLUTE_PATH_REQUIRED');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<50||st.size>128*1024)
    throw Error('PILOT_HEARTBEAT_SAMPLE_UNSAFE');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function main(){
  try{
    const env=process.env;
    const files=(env.SUTRADHAR_PILOT_HEARTBEAT_SAMPLE_FILES||'').split(';')
      .map(s=>s.trim()).filter(Boolean);
    if(files.length<4||files.length>12||new Set(files).size!==files.length)
      throw Error('PILOT_HEARTBEAT_UNIQUE_SAMPLE_FILES_REQUIRED');
    const ids=(env.SUTRADHAR_PILOT_NODE_IDS||'').split(',')
      .map(s=>s.trim()).filter(Boolean);
    const result=audit({samples:files.map(readSample),
      expectedSha:env.SUTRADHAR_PILOT_SOURCE_SHA,
      expectedNodeIds:ids,
      expectedOrigin:env.SUTRADHAR_CENTRAL_URL});
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{
    console.error('PILOT_HEARTBEAT_AUDIT_FAILED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={audit,readSample};
