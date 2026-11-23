/**
 * Developer-CLI-only, durable task-submit intent.
 *
 * An unknown HTTP outcome is NOT a rejection. Keep the exact request ID and
 * exact Git candidate for an explicitly initiated retry, then require an
 * independent signed Central task-detail observation before retiring it.
 * Local SHA-256 detects accidental edits only: it does not attest same-user
 * malware or replace protected Windows OS-vault identity.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ID_RE,SHA_RE,validTaskBranch,safeScope} from './rules.ts';
import {journalEntryPresent,readStableJournal} from './journal_file.ts';
export type SubmitBody={
  request_id:string;agent_id:string;ticket_id:string;lease_id:string;
  expected_master_epoch:number;candidate_head_sha:string;candidate_tree_sha:string;
};
type Context={project_id:string;repository:string;branch_name:string;
  baseline_sha:string;scope:string[]};
type Journal={schema_version:1;context:Context;body:SubmitBody;hash_sha256:string};
const fail=(s:string):never=>{throw Error(s);};
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const leaseRe=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const exact=(obj:unknown,keys:string[]):obj is Record<string,unknown>=>
  !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&Object.keys(obj).every(k=>keys.includes(k));
const bodyKeys=['request_id','agent_id','ticket_id','lease_id',
  'expected_master_epoch','candidate_head_sha','candidate_tree_sha'];
const contextKeys=['project_id','repository','branch_name','baseline_sha','scope'];
function validBody(b:unknown):b is SubmitBody{
  if(!exact(b,bodyKeys))return false;
  return typeof b.request_id==='string'&&/^submit_[0-9a-f]{32}$/.test(b.request_id)&&
    typeof b.agent_id==='string'&&ID_RE.test(b.agent_id)&&
    typeof b.ticket_id==='string'&&ID_RE.test(b.ticket_id)&&
    typeof b.lease_id==='string'&&leaseRe.test(b.lease_id)&&
    Number.isSafeInteger(b.expected_master_epoch)&&Number(b.expected_master_epoch)>0&&
    typeof b.candidate_head_sha==='string'&&SHA_RE.test(b.candidate_head_sha)&&
    typeof b.candidate_tree_sha==='string'&&SHA_RE.test(b.candidate_tree_sha);
}
function validContext(c:unknown):c is Context{
  if(!exact(c,contextKeys))return false;
  return typeof c.project_id==='string'&&ID_RE.test(c.project_id)&&
    typeof c.repository==='string'&&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repository)&&
    validTaskBranch(c.branch_name)&&
    typeof c.baseline_sha==='string'&&SHA_RE.test(c.baseline_sha)&&
    Array.isArray(c.scope)&&c.scope.length>0&&c.scope.length<=100&&
    c.scope.every(safeScope)&&new Set(c.scope).size===c.scope.length;
}
export function submitIntentPath(dir:string,ticketId:string):string{
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!ID_RE.test(ticketId))
    fail('SUBMIT_INTENT_PATH_INVALID');
  return path.join(dir,'submit_'+ticketId+'.json');
}
function requireDir(dir:string){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
    (process.platform!=='win32'&&(st.mode&0o022)!==0))
    fail('SUBMIT_INTENT_DIR_UNTRUSTED');
}
function read(file:string):Journal{
  let raw:Buffer;
  try{raw=readStableJournal(file,{maxBytes:16384,requirePrivate:true});}
  catch{return fail('SUBMIT_INTENT_FILE_UNTRUSTED');}
  let j:unknown;
  try{j=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('SUBMIT_INTENT_CORRUPT');}
  if(!exact(j,['schema_version','context','body','hash_sha256'])||
    j.schema_version!==1||!validContext(j.context)||!validBody(j.body)||
    typeof j.hash_sha256!=='string'||!/^[a-f0-9]{64}$/.test(j.hash_sha256)||
    j.hash_sha256!==hash({schema_version:1,context:j.context,body:j.body}))
    fail('SUBMIT_INTENT_DIGEST_OR_FIELDS_INVALID');
  return j as Journal;
}
export function hasPendingSubmit(dir:string,ticketId:string):boolean{
  const file=submitIntentPath(dir,ticketId);
  // Dangling symlinks count as occupied one-shot entries, not permission
  // to generate a new request ID after an ambiguous Central outcome.
  if(!journalEntryPresent(file))return false;
  read(file);
  return true;
}
export function getOrCreateSubmitIntent(input:{
  dir:string;agent_id:string;ticket_id:string;lease_id:string;epoch:number;
  project_id:string;repository:string;branch_name:string;
  baseline_sha:string;scope:string[];candidate_head_sha:string;candidate_tree_sha:string;
}):{file:string;body:SubmitBody;replayed:boolean}{
  const {dir,epoch,agent_id,ticket_id,lease_id,candidate_head_sha,
    candidate_tree_sha,project_id,repository,branch_name,baseline_sha,scope}=input;
  requireDir(dir);
  const file=submitIntentPath(dir,ticket_id);
  const context={project_id,repository,branch_name,baseline_sha,scope};
  const check={request_id:'submit_'+'0'.repeat(32),
    agent_id,ticket_id,lease_id,expected_master_epoch:epoch,
    candidate_head_sha,candidate_tree_sha};
  if(!validContext(context)||!validBody(check))
    fail('SUBMIT_INTENT_INPUT_INVALID');
  if(hasPendingSubmit(dir,ticket_id)){
    const prior=read(file);
    if(JSON.stringify(prior.context)!==JSON.stringify(context)||
       Object.keys(check).some(k=>k!=='request_id'&&
        prior.body[k as keyof SubmitBody]!==check[k as keyof SubmitBody]))
      fail('SUBMIT_INTENT_PENDING_RECONCILIATION');
    return {file,body:prior.body,replayed:true};
  }
  const body:SubmitBody={...check,request_id:'submit_'+crypto.randomUUID().replace(/-/g,'')};
  const core={schema_version:1 as const,context,body};
  const record:Journal={...core,hash_sha256:hash(core)};
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  // On POSIX, fsync the parent directory before sending the network write.
  // Windows directory flush portability remains an external acceptance gate.
  if(process.platform!=='win32'){
    const parent=fs.openSync(dir,'r');
    try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  }
  return {file,body,replayed:false};
}
export function verifySubmitReceipt(body:SubmitBody,reply:unknown):number{
  if(!validBody(body)||!reply||typeof reply!=='object'||Array.isArray(reply))
    fail('SUBMIT_RECEIPT_MISMATCH');
  const r=reply as Record<string,unknown>;
  if(r.accepted!==true||r.automatic_execution_allowed!==false||
    r.status!=='SUBMITTED_FOR_REVIEW'||r.ticket_id!==body.ticket_id||
    r.agent_id!==body.agent_id||r.lease_id!==body.lease_id||
    r.epoch!==body.expected_master_epoch||
    r.candidate_head_sha!==body.candidate_head_sha||
    r.candidate_tree_sha!==body.candidate_tree_sha||
    !Number.isSafeInteger(r.version)||Number(r.version)<1)
    fail('SUBMIT_RECEIPT_MISMATCH');
  return r.version as number;
}
export function verifySubmitObservation(input:{
  body:SubmitBody;remote:unknown;version:number;project_id:string;
  repository:string;branch_name:string;baseline_sha:string;
}):true{
  const {body,remote,version,project_id,repository,branch_name,baseline_sha}=input;
  if(!validBody(body)||!remote||typeof remote!=='object'||Array.isArray(remote))
    fail('SUBMIT_REMOTE_PROOF_MISMATCH');
  const r=remote as Record<string,unknown>;
  if(r.ticket_id!==body.ticket_id||r.worker_agent_id!==body.agent_id||
    r.status!=='SUBMITTED_FOR_REVIEW'||r.version!==version||
    r.project_id!==project_id||r.repository!==repository||
    r.branch_name!==branch_name||r.baseline_sha!==baseline_sha||
    r.candidate_head_sha!==body.candidate_head_sha||
    r.candidate_tree_sha!==body.candidate_tree_sha||
    !r.latest_checkpoint||typeof r.latest_checkpoint!=='object'||
    Array.isArray(r.latest_checkpoint))
    fail('SUBMIT_REMOTE_PROOF_MISMATCH');
  return true;
}
export function closeSubmitIntent(file:string,body:SubmitBody){
  if(JSON.stringify(read(file).body)!==JSON.stringify(body))
    fail('SUBMIT_INTENT_CLOSE_MISMATCH');
  fs.unlinkSync(file);
}
