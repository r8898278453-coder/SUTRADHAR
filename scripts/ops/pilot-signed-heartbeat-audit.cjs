/**
 * Offline Ed25519 verification of a bounded Central heartbeat audit export.
 * Never contacts Central, reads private node keys, or authorizes release.
 * A JSON export is NOT a signed database attestation or physical PC proof.
 */
'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const NODE=/^node_[a-f0-9]{32}$/,
  ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/,
  NONCE=/^nonce_[a-f0-9]{32}$/,
  BASE64=/^[A-Za-z0-9+/]+={0,2}$/;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys;
const deny=error_code=>({accepted:false,error_code,
  packet_signatures_verified:false,central_accepted_event_rows_reviewed:false,
  physical_machine_verified:false,production_release_authorized:false,
  read_only:true});
const base64=(v,min,max)=>typeof v==='string'&&v.length>=min&&
  v.length<=max&&BASE64.test(v)&&v.length%4===0&&
  Buffer.from(v,'base64').toString('base64')===v;
function audit({exported,pinnedPublicKeyPem,expectedNodeId,now=Date.now()}={}){
  if(!NODE.test(expectedNodeId||'')||
     typeof pinnedPublicKeyPem!=='string'||pinnedPublicKeyPem.length>10000||
     !Number.isSafeInteger(now)||now<=0||
     !exact(exported,'mode|node_id|physical_machine_verified|production_release_authorized|read_only|records|schema')||
     exported.schema!==1||exported.mode!=='OWNER_CENTRAL_ACCEPTED_SIGNED_HEARTBEAT_LOG'||
     exported.node_id!==expectedNodeId||exported.read_only!==true||
     exported.physical_machine_verified!==false||
     exported.production_release_authorized!==false||
     !Array.isArray(exported.records)||exported.records.length<4||exported.records.length>8)
    return deny('PILOT_SIGNED_HEARTBEAT_SCOPE_INVALID');
  let publicKey;
  try{
    publicKey=crypto.createPublicKey(pinnedPublicKeyPem);
    if(publicKey.asymmetricKeyType!=='ed25519')
      return deny('PILOT_SIGNED_HEARTBEAT_KEY_INVALID');
  }catch{return deny('PILOT_SIGNED_HEARTBEAT_KEY_INVALID');}
  let previous=null,agentIds=null,nonceSet=new Set();
  for(const record of exported.records){
    if(!exact(record,'committed_at_ms|event_id|payload')||
       !Number.isSafeInteger(record.event_id)||record.event_id<1||
       !Number.isSafeInteger(record.committed_at_ms)||record.committed_at_ms<1||
       !exact(record.payload,'accepted_at_ms|body_base64|node_id|nonce|schema|signature_base64|timestamp_ms'))
      return deny('PILOT_SIGNED_HEARTBEAT_ROW_INVALID');
    const p=record.payload;
    if(p.schema!==1||p.node_id!==expectedNodeId||
       !NONCE.test(p.nonce||'')||nonceSet.has(p.nonce)||
       !Number.isSafeInteger(p.timestamp_ms)||p.timestamp_ms<1||
       !Number.isSafeInteger(p.accepted_at_ms)||p.accepted_at_ms<1||
       Math.abs(p.accepted_at_ms-p.timestamp_ms)>120000||
       record.committed_at_ms<p.accepted_at_ms||
       record.committed_at_ms-p.accepted_at_ms>60000||
       record.committed_at_ms>now+120000||
       !base64(p.signature_base64,88,88)||!base64(p.body_base64,28,11000))
      return deny('PILOT_SIGNED_HEARTBEAT_ENVELOPE_INVALID');
    nonceSet.add(p.nonce);
    const bytes=Buffer.from(p.body_base64,'base64');
    if(bytes.length<20||bytes.length>8192)
      return deny('PILOT_SIGNED_HEARTBEAT_BODY_TOO_LARGE');
    const digest=crypto.createHash('sha256').update(bytes).digest('hex');
    const signed=[String(p.timestamp_ms),p.nonce,'POST','/v7/nodes/heartbeat',digest].join('\n');
    if(!crypto.verify(null,Buffer.from(signed),publicKey,
          Buffer.from(p.signature_base64,'base64')))
      return deny('PILOT_SIGNED_HEARTBEAT_SIGNATURE_INVALID');
    let body;
    try{body=JSON.parse(bytes.toString('utf8'));}
    catch{return deny('PILOT_SIGNED_HEARTBEAT_BODY_INVALID');}
    if(!exact(body,'agents|boot_id|expected_master_epoch|sequence')||
       !ID.test(body.boot_id||'')||
       !Number.isSafeInteger(body.sequence)||body.sequence<1||
       !(body.expected_master_epoch===null||
         Number.isSafeInteger(body.expected_master_epoch)&&body.expected_master_epoch>=0)||
       !Array.isArray(body.agents)||body.agents.length<1||body.agents.length>30)
      return deny('PILOT_SIGNED_HEARTBEAT_BODY_INVALID');
    const currentIds=[];
    for(const agent of body.agents){
      if(!exact(agent,'agent_id|sequence|status')||
         !ID.test(agent.agent_id||'')||
         !Number.isSafeInteger(agent.sequence)||agent.sequence<1||
         !['ONLINE','IDLE','BUSY','BLOCKED'].includes(agent.status)||
         currentIds.includes(agent.agent_id))
        return deny('PILOT_SIGNED_HEARTBEAT_AGENT_INVALID');
      currentIds.push(agent.agent_id);
    }
    currentIds.sort();
    if(agentIds===null)agentIds=currentIds.join('|');
    else if(agentIds!==currentIds.join('|'))
      return deny('PILOT_SIGNED_HEARTBEAT_MEMBERSHIP_CHANGED');
    if(previous){
      const elapsed=record.committed_at_ms-previous.committed;
      if(record.event_id<=previous.eventId||elapsed<45000||elapsed>95000||
         p.timestamp_ms-previous.ts<30000||p.timestamp_ms-previous.ts>105000)
        return deny('PILOT_SIGNED_HEARTBEAT_CADENCE_INVALID');
      if(body.boot_id!==previous.bootId||body.sequence!==previous.sequence+1)
        return deny('PILOT_SIGNED_HEARTBEAT_BOOT_OR_SEQUENCE_CHANGED');
      for(const agent of body.agents){
        if(agent.sequence!==previous.agentSeq.get(agent.agent_id)+1)
          return deny('PILOT_SIGNED_HEARTBEAT_AGENT_SEQUENCE_CHANGED');
      }
    }
    previous={eventId:record.event_id,committed:record.committed_at_ms,
      ts:p.timestamp_ms,sequence:body.sequence,bootId:body.boot_id,
      agentSeq:new Map(body.agents.map(a=>[a.agent_id,a.sequence]))};
  }
  if(now-previous.committed>300000)
    return deny('PILOT_SIGNED_HEARTBEAT_EVIDENCE_STALE');
  return {accepted:true,status:'NODE_ED25519_SIGNED_PACKETS_IN_CENTRAL_EVENT_EXPORT_ONLY',
    node_id:expectedNodeId,sample_count:exported.records.length,
    agent_count:previous.agentSeq.size,packet_signatures_verified:true,
    central_accepted_event_rows_reviewed:true,
    independent_database_attestation_verified:false,
    physical_machine_verified:false,os_vault_backend_verified:false,
    actual_windows_restart_verified:false,production_release_authorized:false,
    read_only:true,
    warning:'Signed packets and event chronology verified in supplied Central JSON; the unsigned export cannot attest MySQL truth, physical hardware or production readiness.'};
}
function readPrivate(file,limit){
  if(typeof file!=='string'||file.length>1024||!path.isAbsolute(file))
    throw Error('PILOT_SIGNED_HEARTBEAT_ABSOLUTE_FILE_REQUIRED');
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size<10||s.size>limit)
    throw Error('PILOT_SIGNED_HEARTBEAT_FILE_UNSAFE');
  return fs.readFileSync(file,'utf8');
}
function main(){
  try{
    const e=process.env;
    const result=audit({
      exported:JSON.parse(readPrivate(e.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EXPORT_FILE,128*1024)),
      pinnedPublicKeyPem:readPrivate(e.SUTRADHAR_PILOT_NODE_PINNED_PUBLIC_KEY_FILE,10000),
      expectedNodeId:e.SUTRADHAR_PILOT_NODE_ID
    });
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{
    console.error('PILOT_SIGNED_HEARTBEAT_OFFLINE_VERIFICATION_FAILED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={audit,readPrivate};
