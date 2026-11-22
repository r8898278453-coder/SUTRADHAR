/**
 * Developer-only worker CLI checkpoint intent.
 * A lost HTTP acknowledgement is UNKNOWN, never an invitation to create a
 * different checkpoint. Reuse the original exact request ID and body.
 * A hash detects accidental changes, not a same-user malicious modification.
 * Central MySQL remains authoritative; packaged Windows worker is separate.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ID_RE} from './rules.ts';

export type CheckpointBody={
  request_id:string;agent_id:string;ticket_id:string;lease_id:string;
  expected_master_epoch:number;summary:string;next_action:string;
};
type IntentRecord={schema_version:1;body:CheckpointBody;hash_sha256:string};
const sha=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const textHash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex');
const fail=(code:string):never=>{throw Error(code);};
const leaseRe=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fields=['request_id','agent_id','ticket_id','lease_id',
  'expected_master_epoch','summary','next_action'];
const exactKeys=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
function validate(b:any):b is CheckpointBody{
  return exactKeys(b,fields)&&typeof b.request_id==='string'&&
    /^checkpoint_[0-9a-f]{32}$/.test(b.request_id)&&
    typeof b.agent_id==='string'&&ID_RE.test(b.agent_id)&&
    typeof b.ticket_id==='string'&&ID_RE.test(b.ticket_id)&&
    typeof b.lease_id==='string'&&leaseRe.test(b.lease_id)&&
    Number.isSafeInteger(b.expected_master_epoch)&&b.expected_master_epoch>0&&
    typeof b.summary==='string'&&b.summary.length<=8000&&
    b.summary.trim().length>0&&
    typeof b.next_action==='string'&&b.next_action.length<=500&&
    b.next_action.trim().length>0;
}
export function checkpointIntentPath(dir:string,ticketId:string){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!ID_RE.test(ticketId))
    fail('CHECKPOINT_INTENT_PATH_INVALID');
  return path.join(dir,'checkpoint_'+ticketId+'.json');
}
function validateDir(dir:string){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('CHECKPOINT_INTENT_DIR_UNTRUSTED');
}
function read(file:string):IntentRecord{
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>20000||
     (process.platform!=='win32'&&(st.mode&0o077)!==0))
    fail('CHECKPOINT_INTENT_FILE_UNTRUSTED');
  let data:any;
  try{data=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{fail('CHECKPOINT_INTENT_CORRUPT');}
  if(!exactKeys(data,['schema_version','body','hash_sha256'])||
    data.schema_version!==1||!validate(data.body)||
    typeof data.hash_sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.hash_sha256)||
    data.hash_sha256!==sha({schema_version:1,body:data.body}))
    fail('CHECKPOINT_INTENT_DIGEST_INVALID');
  return data;
}
export function getOrCreateCheckpointIntent(input:{
  dir:string;agent_id:string;ticket_id:string;lease_id:string;
  epoch:number;summary:string;next_action:string;
}):{file:string;body:CheckpointBody;replayed:boolean}{
  const {dir,epoch,agent_id,ticket_id,lease_id,summary,next_action}=input;
  const file=checkpointIntentPath(dir,ticket_id);
  validateDir(dir);
  const context={agent_id,ticket_id,lease_id,expected_master_epoch:epoch,
    summary,next_action};
  const probe={request_id:'checkpoint_'+'0'.repeat(32),...context};
  if(!validate(probe))fail('CHECKPOINT_INTENT_INPUT_INVALID');
  if(fs.existsSync(file)){
    const old=read(file);
    for(const key of Object.keys(context) as (keyof typeof context)[]){
      if(old.body[key]!==context[key])
        fail('CHECKPOINT_INTENT_PENDING_RECONCILIATION');
    }
    return {file,body:old.body,replayed:true};
  }
  const body:CheckpointBody={request_id:'checkpoint_'+crypto.randomUUID().replace(/-/g,''),
    ...context};
  const core={schema_version:1 as const,body};
  const record:IntentRecord={...core,hash_sha256:sha(core)};
  // Exclusively create and fsync the request BEFORE its first network send.
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return {file,body,replayed:false};
}
export function verifyCheckpointReceipt(body:CheckpointBody,reply:any){
  if(!validate(body)||!reply||typeof reply!=='object'||Array.isArray(reply)||
    reply.accepted!==true||reply.ticket_id!==body.ticket_id||
    reply.agent_id!==body.agent_id||reply.lease_id!==body.lease_id||
    reply.epoch!==body.expected_master_epoch||
    reply.automatic_execution_allowed!==false||
    !Number.isSafeInteger(reply.generation)||reply.generation<1||
    !Number.isSafeInteger(reply.version)||reply.version<1||
    reply.content_sha256!==textHash(body.summary+'\n'+body.next_action)||
    typeof reply.lease_expires_at!=='string'||
    !Number.isFinite(Date.parse(reply.lease_expires_at))||
    typeof reply.absolute_claim_deadline!=='string'||
    !Number.isFinite(Date.parse(reply.absolute_claim_deadline))||
    !Number.isSafeInteger(reply.lease_seconds_remaining)||
    reply.lease_seconds_remaining<1||reply.lease_seconds_remaining>600)
    fail('CHECKPOINT_RECEIPT_MISMATCH');
  return {generation:reply.generation as number,
    content_sha256:reply.content_sha256 as string};
}
export function closeCheckpointIntent(file:string,body:CheckpointBody){
  if(JSON.stringify(read(file).body)!==JSON.stringify(body))
    fail('CHECKPOINT_INTENT_CLOSE_MISMATCH');
  fs.unlinkSync(file);
}
