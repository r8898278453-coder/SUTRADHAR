/**
 * Read-only verification of LAST opt-in retained signed heartbeat packet.
 *
 * This is a proof of possession by the enrolled public key at the packet
 * timestamp ONLY. Central normally does NOT persist signed heartbeats.
 * No private key, signature export, full payload, replay or automatic
 * recovery action is exposed. Never implies complete counter or QA history.
 */
import * as crypto from 'node:crypto';
import {validSignedHeartbeat} from './heartbeat_validation.ts';

const NODE=/^node_[a-f0-9]{32}$/;
const HEX_U64=/^(0|[1-9][0-9]{0,19})$/;
const MAX_U64='18446744073709551615';
type Agent={agent_id:string;accepted_sequence_decimal:string};
const u64=(s:unknown):s is string=>typeof s==='string'&&HEX_U64.test(s)&&
  (s.length<20||(s.length===20&&s<=MAX_U64));
const obj=(x:unknown):x is Record<string,unknown>=>
  x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,fields:string[])=>{
  const keys=Object.keys(x);
  return keys.length===fields.length&&keys.every(k=>fields.includes(k));
};
function result({present=false,verified=false,nodeMatch=false,agentCheck=false,
  bootMatch=false,lastSequence=null,acceptedAt=null,error='NONE'}:{
  present?:boolean;verified?:boolean;nodeMatch?:boolean;agentCheck?:boolean;
  bootMatch?:boolean;lastSequence?:string|null;acceptedAt?:number|null;error?:string
}={}){
  return Object.freeze({
    record_present:present,
    last_retained_packet_signature_verified:verified,
    retained_sequence_equals_current_accepted_node_counter:nodeMatch,
    retained_agent_sequences_not_ahead_of_central:agentCheck,
    retained_boot_id_matches_current:bootMatch,
    last_retained_node_sequence_decimal:lastSequence,
    last_retained_accepted_at_ms:acceptedAt,
    error_code:error,
    read_only:true,
    complete_signed_heartbeat_history:false,
    local_pc_possession_now_verified:false,
    physical_pc_verified:false,
    agent_restart_allowed:false,
    production_release_authorized:false
  });
}
function fail(error:string,present=true){
  return result({present,error});
}
export function inspectLastRetainedPilotHeartbeat({
  retainedPayload,nodeId,publicKeyPem,acceptedNodeSequenceDecimal,
  acceptedBootId,agents
}:{
  retainedPayload:unknown;nodeId:string;publicKeyPem:string;
  acceptedNodeSequenceDecimal:string;acceptedBootId:string|null;
  agents:Agent[]
}){
  if(!NODE.test(nodeId)||!u64(acceptedNodeSequenceDecimal)||
     !Array.isArray(agents)||agents.length>50||
     agents.some(a=>!obj(a)||typeof a.agent_id!=='string'||
       !u64(a.accepted_sequence_decimal))||
     !(acceptedBootId===null||
       (typeof acceptedBootId==='string'&&acceptedBootId.length<=100)))
    return fail('INVALID_PINNED_CENTRAL_CONTEXT',retainedPayload!==null);
  if(retainedPayload===null)return result({error:'NO_PILOT_PACKET_RETAINED'});
  try{
    const raw=typeof retainedPayload==='string'?JSON.parse(retainedPayload):
      retainedPayload;
    if(!obj(raw)||!exact(raw,['schema','node_id','timestamp_ms','nonce',
      'signature_base64','body_base64','accepted_at_ms'])||
      raw.schema!==1||raw.node_id!==nodeId||
      !Number.isSafeInteger(raw.timestamp_ms)||Number(raw.timestamp_ms)<1||
      !Number.isSafeInteger(raw.accepted_at_ms)||Number(raw.accepted_at_ms)<1||
      Math.abs(Number(raw.accepted_at_ms)-Number(raw.timestamp_ms))>300000||
      typeof raw.nonce!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(raw.nonce)||
      typeof raw.signature_base64!=='string'||
      !/^[A-Za-z0-9+/]{86}==$/.test(raw.signature_base64)||
      typeof raw.body_base64!=='string'||raw.body_base64.length>11000||
      raw.body_base64.length<20)
      return fail('PILOT_PACKET_ENVELOPE_INVALID');
    const body=Buffer.from(raw.body_base64,'base64');
    if(body.length<20||body.length>8192||
       body.toString('base64')!==raw.body_base64)
      return fail('PILOT_PACKET_RAW_BYTES_INVALID');
    const packet=JSON.parse(body.toString('utf8'));
    if(!validSignedHeartbeat(packet))
      return fail('PILOT_PACKET_HEARTBEAT_INVALID');
    const key=crypto.createPublicKey(publicKeyPem);
    if(key.asymmetricKeyType!=='ed25519')
      return fail('PILOT_PACKET_NODE_KEY_INVALID');
    const signature=Buffer.from(raw.signature_base64,'base64');
    if(signature.length!==64||
       signature.toString('base64')!==raw.signature_base64)
      return fail('PILOT_PACKET_SIGNATURE_ENCODING_INVALID');
    const sha=crypto.createHash('sha256').update(body).digest('hex');
    const signed=[String(raw.timestamp_ms),raw.nonce,'POST',
      '/v7/nodes/heartbeat',sha].join('\n');
    if(!crypto.verify(null,Buffer.from(signed),key,signature))
      return fail('PILOT_PACKET_SIGNATURE_INVALID');
    // A valid historical signed packet may be older than the accepted
    // counters. That is an evidence GAP, not a reason to adjust them.
    const validAgents=new Map(agents.map(a=>
      [a.agent_id,a.accepted_sequence_decimal]));
    const agentCheck=packet.agents.every((a:{agent_id:string;sequence:number})=>{
      const accepted=validAgents.get(a.agent_id);
      return accepted!==undefined&&BigInt(accepted)>=BigInt(a.sequence);
    });
    const packetSeq=String(packet.sequence);
    const notAhead=BigInt(acceptedNodeSequenceDecimal)>=BigInt(packetSeq);
    if(!notAhead||!agentCheck)
      return fail('PILOT_PACKET_AHEAD_OF_CENTRAL_ACCEPTED_COUNTERS');
    return result({
      present:true,verified:true,
      nodeMatch:acceptedNodeSequenceDecimal===packetSeq,
      agentCheck,bootMatch:packet.boot_id===acceptedBootId,
      lastSequence:packetSeq,acceptedAt:Number(raw.accepted_at_ms),
      error:'NONE'
    });
  }catch{
    return fail('PILOT_PACKET_UNVERIFIABLE');
  }
}
