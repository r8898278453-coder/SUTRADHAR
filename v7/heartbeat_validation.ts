/**
 * Strict shape of the v7 node-signed 60-second heartbeat.
 * The signature proves node-key possession, not semantic packet validity.
 * Reject coercible values BEFORE Central's transaction can update counters or
 * renew a Master lease. Desktop's OS-vault signer has additional constraints.
 */
import {ID_RE} from './rules.ts';

function record(v:unknown):v is Record<string,unknown>{
  return v!==null&&typeof v==='object'&&!Array.isArray(v);
}
function exact(v:Record<string,unknown>,keys:string[]):boolean{
  const actual=Object.keys(v);
  return actual.length===keys.length&&actual.every(k=>keys.includes(k));
}
const STATUSES=new Set(['IDLE','BUSY','BLOCKED','ONLINE']);
export function validSignedHeartbeat(packet:unknown):boolean{
  if(!record(packet)||!exact(packet,
    ['boot_id','sequence','expected_master_epoch','agents']))return false;
  if(typeof packet.boot_id!=='string'||!ID_RE.test(packet.boot_id)||
     typeof packet.sequence!=='number'||!Number.isSafeInteger(packet.sequence)||
     packet.sequence<1)return false;
  const epoch=packet.expected_master_epoch;
  if(epoch!==null&&(typeof epoch!=='number'||!Number.isSafeInteger(epoch)||
     epoch<0))return false;
  if(!Array.isArray(packet.agents)||packet.agents.length<1||
     packet.agents.length>30)return false;
  const ids=new Set<string>();
  for(const item of packet.agents){
    if(!record(item)||!exact(item,['agent_id','sequence','status'])||
       typeof item.agent_id!=='string'||!ID_RE.test(item.agent_id)||
       ids.has(item.agent_id)||
       typeof item.sequence!=='number'||!Number.isSafeInteger(item.sequence)||
       item.sequence<1||typeof item.status!=='string'||
       !STATUSES.has(item.status))return false;
    ids.add(item.agent_id);
  }
  return true;
}
