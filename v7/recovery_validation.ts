import {createHash} from 'node:crypto';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(v);
const validText=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&Boolean(v.trim())&&!/[\uD800-\uDFFF]/u.test(v);
const validStatus=new Set(['DRAFT','WAITING_AUTHORIZATION','READY','CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED','SUBMITTED_FOR_REVIEW','INTEGRATING','RECONCILIATION_REQUIRED']);
function eventId(v:unknown):number{
  if(typeof v!=='number'&&!(typeof v==='string'&&/^[1-9][0-9]*$/.test(v)))return NaN;
  return Number(v);
}
export function verifyRecoverySnapshot(input:unknown,epoch:number):string {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_RECOVERY_SNAPSHOT');
  const s=input as Record<string,any>;
  if(!Number.isSafeInteger(epoch)||epoch<1||s.epoch!==epoch||s.phase!=='RECOVERING')
    throw Error('RECOVERY_EPOCH_CHANGED');
  for(const k of ['tickets','checkpoints','events'])
    if(!Array.isArray(s[k])||s[k].length>300)throw Error('RECOVERY_PAGINATION_REQUIRED');
  if(!Array.isArray(s.unresolved_git_jobs)||s.unresolved_git_jobs.length>300||
    !Number.isSafeInteger(s.event_high_watermark)||s.event_high_watermark<0)
    throw Error('INVALID_RECOVERY_LEDGER');
  const ids=new Set<string>(),caseIds=new Set<string>(),cpIds=new Set<string>(),events=new Set<number>();
  const gitIds=new Set<string>();
  for(const job of s.unresolved_git_jobs){
    if(!job||!validId(job.ticket_id)||
      gitIds.has(job.ticket_id.toLowerCase())||!['RUNNING','NEEDS_RECONCILIATION'].includes(job.state))
      throw Error('INVALID_RECOVERY_GIT_JOB');
    gitIds.add(job.ticket_id.toLowerCase());
  }
  if(s.unresolved_git_jobs.length)throw Error('GIT_RECONCILIATION_REQUIRED');
  for(const t of s.tickets){
    if(!t||!validId(t.ticket_id)||caseIds.has(t.ticket_id.toLowerCase())||
      !validStatus.has(t.status))throw Error('INVALID_RECOVERY_TICKET');
    ids.add(t.ticket_id);caseIds.add(t.ticket_id.toLowerCase());
    if(t.status==='RECONCILIATION_REQUIRED')throw Error('TASK_RECONCILIATION_REQUIRED');
  }
  for(const cp of s.checkpoints){
    if(!cp||!validId(cp.ticket_id)||!ids.has(cp.ticket_id)||cpIds.has(cp.ticket_id)||
      !Number.isSafeInteger(cp.generation)||cp.generation<1||
      !validText(cp.summary,8000)||!validText(cp.next_action,500)||
      typeof cp.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(cp.content_sha256))throw Error('INVALID_RECOVERY_CHECKPOINT');
    cpIds.add(cp.ticket_id);
    if(hash(cp.summary+'\n'+cp.next_action)!==cp.content_sha256)
      throw Error('CHECKPOINT_DIGEST_MISMATCH');
  }
  let previous=Infinity;
  for(const e of s.events){
    const id=eventId(e?.event_id);
    if(!Number.isSafeInteger(id)||id<1||events.has(id)||id>=previous)throw Error('INVALID_EVENT_CURSOR');
    events.add(id);previous=id;
  }
  if((s.events.length?eventId(s.events[0].event_id):0)!==s.event_high_watermark)
    throw Error('INVALID_EVENT_HIGH_WATERMARK');
  if(typeof s.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.manifest_sha256))
    throw Error('INVALID_RECOVERY_HASH');
  const {manifest_sha256,...payload}=s;
  const verified=hash(JSON.stringify(payload));
  if(verified!==manifest_sha256)throw Error('RECOVERY_MANIFEST_HASH_MISMATCH');
  return verified;
}
