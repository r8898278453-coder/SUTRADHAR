/**
 * Durable, developer-CLI-only claim intent. A network timeout after a Central
 * claim is UNKNOWN, not FAILED. Replay the IDENTICAL request ID and input;
 * never generate a second claim or resume without a current Master epoch.
 *
 * The packaged Windows OS-vault worker is not yet wired to this module.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {ID_RE,SHA_RE,validTaskBranch,safeScope} from './rules.ts';

type Context={agent_id:string;ticket_id:string;project_id:string;repository:string;
  branch_name:string;baseline_sha:string;scope:string[]};
export type ClaimBody={request_id:string;agent_id:string;ticket_id:string;
  expected_version:number;expected_master_epoch:number};
type Journal={schema_version:1;context:Context;body:ClaimBody;content_sha256:string};

const die=(code:string):never=>{throw Error(code);};
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function claimIntentPath(dir:string,ticketId:string):string{
  if(!path.isAbsolute(dir)||!ID_RE.test(ticketId))die('CLAIM_JOURNAL_PATH_INVALID');
  return path.join(dir,'claim_'+ticketId+'.json');
}
export function hasPendingClaim(dir:string,ticketId:string):boolean{
  const file=claimIntentPath(dir,ticketId);
  if(!fs.existsSync(file))return false;
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192||stat.size===0)
    die('CLAIM_JOURNAL_UNTRUSTED_FILE');
  return true;
}

function contextOf(task:any,agentId:string,scope:string[]):Context{
  if(!ID_RE.test(agentId)||!ID_RE.test(task?.ticket_id)||
    !ID_RE.test(task?.project_id)||typeof task?.repository!=='string'||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(task.repository)||
    !validTaskBranch(task.branch_name)||!SHA_RE.test(task.baseline_sha)||
    !Array.isArray(scope)||!scope.length||!scope.every(safeScope))
    die('CLAIM_JOURNAL_CONTEXT_INVALID');
  return {agent_id:agentId,ticket_id:task.ticket_id,
    project_id:task.project_id,repository:task.repository,
    branch_name:task.branch_name,baseline_sha:task.baseline_sha,scope:[...scope]};
}
function read(file:string):Journal{
  if(!fs.existsSync(file))die('CLAIM_JOURNAL_MISSING');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0||stat.size>8192)
    die('CLAIM_JOURNAL_UNTRUSTED_FILE');
  let record:Journal|undefined;
  try{record=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{die('CLAIM_JOURNAL_CORRUPT');}
  if(!record||record.schema_version!==1||!record.context||!record.body||
    !/^[a-f0-9]{64}$/.test(String(record.content_sha256||''))||
    hash({schema_version:1,context:record.context,body:record.body})!==record.content_sha256)
    die('CLAIM_JOURNAL_DIGEST_INVALID');
  // The strict branch above rejects undefined; keep this explicit for TS.
  return record as Journal;
}
export function getOrCreateClaimIntent(input:{
  dir:string;task:any;agentId:string;scope:string[];epoch:number;
}):{file:string;body:ClaimBody;replayed:boolean}{
  const {dir,task,agentId,scope,epoch}=input;
  if(!fs.existsSync(dir)||!fs.lstatSync(dir).isDirectory()||
    fs.lstatSync(dir).isSymbolicLink())die('CLAIM_JOURNAL_DIR_UNTRUSTED');
  if(!Number.isSafeInteger(epoch)||epoch<1)die('CLAIM_EPOCH_INVALID');
  const context=contextOf(task,agentId,scope);
  const file=claimIntentPath(dir,context.ticket_id);
  if(hasPendingClaim(dir,context.ticket_id)){
    const prior=read(file);
    const body=prior.body;
    if(JSON.stringify(prior.context)!==JSON.stringify(context)||
      body.agent_id!==agentId||body.ticket_id!==context.ticket_id||
      !ID_RE.test(body.request_id)||!body.request_id.startsWith('claim_')||
      !Number.isSafeInteger(body.expected_version)||body.expected_version<1||
      body.expected_master_epoch!==epoch)
      die('CLAIM_PENDING_RECONCILIATION_REQUIRED');
    // Successful but unanswered claims appear as CLAIMED on Central.
    if(!['READY','CLAIMED'].includes(task.status)||
      (task.status==='CLAIMED'&&task.worker_agent_id!==agentId))
      die('CLAIM_REMOTE_STATE_CHANGED');
    return {file,body,replayed:true};
  }
  if(task.status!=='READY'||!Number.isSafeInteger(Number(task.version))||
    Number(task.version)<1)die('CLAIM_NEW_REQUEST_NOT_ALLOWED');
  const body:ClaimBody={request_id:'claim_'+crypto.randomUUID().replace(/-/g,''),
    agent_id:agentId,ticket_id:context.ticket_id,
    expected_version:Number(task.version),expected_master_epoch:epoch};
  const core={schema_version:1 as const,context,body};
  const record:Journal={...core,content_sha256:hash(core)};
  // Exclusive create means concurrent local workers cannot silently replace
  // the pending request. Flush BEFORE sending anything to Central.
  let fd:number|undefined;
  try{
    fd=fs.openSync(file,'wx',0o600);
    fs.writeSync(fd,JSON.stringify(record,null,2)+'\n');
    fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  return {file,body,replayed:false};
}
export function verifyClaimReceipt(body:ClaimBody,reply:any){
  if(!reply||reply.accepted!==true||reply.ticket_id!==body.ticket_id||
    Number(reply.epoch)!==body.expected_master_epoch||
    typeof reply.lease_id!=='string'||!/^[-a-f0-9]{36}$/.test(reply.lease_id)||
    Number(reply.lease_seconds)!==600)
    die('CLAIM_RECEIPT_MISMATCH');
  return reply.lease_id as string;
}
export function closeClaimIntent(file:string,body:ClaimBody){
  const record=read(file);
  if(JSON.stringify(record.body)!==JSON.stringify(body))
    die('CLAIM_JOURNAL_CLOSE_MISMATCH');
  // Local receipt MUST already be durably saved by caller.
  fs.unlinkSync(file);
}
