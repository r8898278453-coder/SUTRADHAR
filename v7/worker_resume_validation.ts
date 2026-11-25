/** Read-only restart preflight. It never renews a lease or changes the task. */
import {createHash} from 'node:crypto';
import {ID_RE,SHA_RE,safeScope} from './rules.ts';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function scopes(value:unknown):string[]{
  const data=typeof value==='string'?JSON.parse(value):value;
  if(!Array.isArray(data)||data.length<1||!data.every(safeScope)||new Set(data).size!==data.length)
    throw Error('INVALID_RESUME_SCOPES');
  return [...data].sort();
}
export function verifyWorkerResume(local:unknown,remote:unknown,agentId:string,ticketId:string){
  if(!local||typeof local!=='object'||Array.isArray(local)||
    !remote||typeof remote!=='object'||Array.isArray(remote)||
    !ID_RE.test(agentId)||!ID_RE.test(ticketId))throw Error('INVALID_RESUME_RECORD');
  const l=local as Record<string,any>,r=remote as Record<string,any>;
  if(r.resume_allowed!==true||r.automatic_execution_allowed!==false||
    r.ticket_id!==ticketId||r.agent_id!==agentId||
    l.ticket_id!==ticketId||l.agent_id!==agentId||
    !Number.isSafeInteger(l.epoch)||l.epoch<1||l.epoch!==r.epoch||
    typeof l.lease_id!=='string'||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(l.lease_id)||
    r.lease_id!==l.lease_id)
    throw Error('RESUME_LEASE_OR_IDENTITY_MISMATCH');
  if(!['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(r.status))
    throw Error('TASK_NOT_RESUMABLE');
  if(l.project_id!==r.project_id||l.branch_name!==r.branch_name||
    l.repository!==r.repository||l.baseline_sha!==r.baseline_sha||
    !SHA_RE.test(l.baseline_sha)||typeof l.worktree!=='string')
    throw Error('RESUME_IMMUTABLE_TASK_MISMATCH');
  if(JSON.stringify(scopes(l.scope))!==JSON.stringify(scopes(r.write_scopes)))
    throw Error('RESUME_SCOPE_MISMATCH');
  const cp=r.latest_checkpoint;
  // A checkpointed or QA-failed ticket must have an authoritative checkpoint.
  // Missing evidence cannot be interpreted as safe-to-resume progress.
  if((r.status==='CHECKPOINTED'||r.status==='TEST_FAILED')&&
     (cp===null||cp===undefined))throw Error('RESUME_CHECKPOINT_REQUIRED');
  if(cp!==null&&cp!==undefined){
    if(!cp||typeof cp!=='object'||Array.isArray(cp)||
      !Number.isSafeInteger(cp.generation)||cp.generation<1||
      typeof cp.summary!=='string'||typeof cp.next_action!=='string'||
      typeof cp.content_sha256!=='string'||
      !/^[a-f0-9]{64}$/.test(cp.content_sha256)||
      sha(cp.summary+'\n'+cp.next_action)!==cp.content_sha256)
      throw Error('RESUME_CHECKPOINT_DIGEST_MISMATCH');
  }
  return {ticket_id:ticketId,agent_id:agentId,status:r.status,epoch:r.epoch,
    latest_checkpoint_generation:cp?cp.generation:null,
    next_action:cp?cp.next_action:'Implement and checkpoint',
    resume_allowed:true,automatic_execution_allowed:false};
}
