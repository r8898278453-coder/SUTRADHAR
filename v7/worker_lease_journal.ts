/**
 * Developer-CLI-only, crash-safe one-shot lease renewal intent.
 * Never auto-renews or bypasses Central's epoch, lease, Owner pause,
 * maximum claim lifetime, or live signed resume preflight.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {ID_RE} from './rules.ts';
import {journalEntryPresent,readStableJournal} from './journal_file.ts';
export type RenewBody={request_id:string;agent_id:string;ticket_id:string;
  lease_id:string;expected_master_epoch:number;reason:string};
type RecordFile={schema_version:1;body:RenewBody;hash_sha256:string};
const hash=(body:unknown)=>crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
const fail=(code:string):never=>{throw Error(code);};
const leaseRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function renewIntentPath(dir:string,ticket:string){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!ID_RE.test(ticket))
    fail('RENEW_INTENT_PATH_INVALID');
  return path.join(dir,'renew_'+ticket+'.json');
}
function read(file:string):RecordFile{
  let raw:Buffer;
  try{raw=readStableJournal(file,{maxBytes:4096});}
  catch{fail('RENEW_INTENT_FILE_UNTRUSTED');}
  let r:RecordFile|undefined;
  try{r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('RENEW_INTENT_CORRUPT');}
  if(!r||r.schema_version!==1||!r.body||!Object.keys(r.body).every(k=>
    ['request_id','agent_id','ticket_id','lease_id','expected_master_epoch','reason'].includes(k))||
    Object.keys(r.body).length!==6||
    !ID_RE.test(r.body.request_id)||!r.body.request_id.startsWith('renew_')||
    !ID_RE.test(r.body.agent_id)||!ID_RE.test(r.body.ticket_id)||
    !leaseRe.test(r.body.lease_id)||
    !Number.isSafeInteger(r.body.expected_master_epoch)||r.body.expected_master_epoch<1||
    typeof r.body.reason!=='string'||r.body.reason.length<12||r.body.reason.length>300||
    typeof r.hash_sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.hash_sha256)||
    r.hash_sha256!==hash({schema_version:1,body:r.body}))
    fail('RENEW_INTENT_DIGEST_OR_FIELDS_INVALID');
  return r as RecordFile;
}
export function getOrCreateRenewIntent(input:{
  dir:string;agent_id:string;ticket_id:string;lease_id:string;epoch:number;reason:string
}){
  const {dir,agent_id,ticket_id,lease_id,epoch,reason}=input;
  if(!ID_RE.test(agent_id)||!ID_RE.test(ticket_id)||!leaseRe.test(lease_id)||
    !Number.isSafeInteger(epoch)||epoch<1||typeof reason!=='string'||
    reason.length<12||reason.length>300)
    fail('RENEW_INTENT_INPUT_INVALID');
  const file=renewIntentPath(dir,ticket_id);
  if(!fs.existsSync(dir)||!fs.lstatSync(dir).isDirectory()||
    fs.lstatSync(dir).isSymbolicLink())
    fail('RENEW_INTENT_DIR_UNTRUSTED');
  if(journalEntryPresent(file)){
    const r=read(file),b=r.body;
    if(b.agent_id!==agent_id||b.ticket_id!==ticket_id||
      b.lease_id!==lease_id||b.expected_master_epoch!==epoch||b.reason!==reason)
      fail('RENEW_INTENT_PENDING_RECONCILIATION');
    return {file,body:b,replayed:true};
  }
  const body:RenewBody={request_id:'renew_'+crypto.randomUUID().replace(/-/g,''),
    agent_id,ticket_id,lease_id,expected_master_epoch:epoch,reason};
  const payload={schema_version:1 as const,body};
  const record:RecordFile={...payload,hash_sha256:hash(payload)};
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return {file,body,replayed:false};
}
export function verifyRenewReceipt(body:RenewBody,reply:any){
  if(!reply||reply.accepted!==true||reply.ticket_id!==body.ticket_id||
    reply.agent_id!==body.agent_id||reply.lease_id!==body.lease_id||
    reply.epoch!==body.expected_master_epoch||
    reply.automatic_execution_allowed!==false||
    typeof reply.lease_expires_at!=='string'||
    !Number.isFinite(Date.parse(reply.lease_expires_at))||
    typeof reply.absolute_claim_deadline!=='string'||
    !Number.isFinite(Date.parse(reply.absolute_claim_deadline))||
    !Number.isSafeInteger(reply.lease_seconds_remaining)||
    reply.lease_seconds_remaining<1||reply.lease_seconds_remaining>600)
    fail('RENEW_RECEIPT_MISMATCH');
}
export function closeRenewIntent(file:string,body:RenewBody){
  if(JSON.stringify(read(file).body)!==JSON.stringify(body))
    fail('RENEW_INTENT_CLOSE_MISMATCH');
  fs.unlinkSync(file);
}
