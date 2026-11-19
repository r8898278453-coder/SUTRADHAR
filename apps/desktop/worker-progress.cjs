/**
 * OS-vault, Electron-MAIN-only manually initiated worker progress operations.
 * Exactly one durable pending operation per ticket; ambiguous network results
 * replay the SAME signed request body and request ID (Central idem ledger).
 * No auto-renewal, unbounded scheduler, Git push, QA or provider automation.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadWorkerReceipt,resumeApprovedTask,signedRequest,confirmResume}
  =require('./worker-claim.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const ORIGIN=/^https:\/\/[a-z0-9.-]+(?::443)?$/i;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error(code);};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const stamp=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function checkContent(operation,input){
  if(operation==='renew-lease'){
    if(typeof input.reason!=='string'||input.reason.trim()!==input.reason||
      input.reason.length<12||input.reason.length>300)
      fail('WORKER_RENEW_REASON_INVALID');
    return {reason:input.reason};
  }
  if(operation!=='checkpoint')fail('WORKER_PROGRESS_OPERATION_DENIED');
  if(typeof input.summary!=='string'||!input.summary.trim()||
    input.summary.length>8000||typeof input.next_action!=='string'||
    !input.next_action.trim()||input.next_action.length>500)
    fail('WORKER_CHECKPOINT_CONTENT_INVALID');
  return {summary:input.summary,next_action:input.next_action};
}
function journalPath(dir,ticketId){
  if(!path.isAbsolute(dir)||!ID.test(ticketId))fail('WORKER_PROGRESS_PATH_INVALID');
  return path.join(dir,'progress_'+ticketId+'.json');
}
function readJournal(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size===0||st.size>12*1024)
    fail('WORKER_PROGRESS_JOURNAL_UNTRUSTED');
  let rec;
  try{rec=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{fail('WORKER_PROGRESS_JOURNAL_CORRUPT');}
  if(!rec||rec.schema!==1||!['checkpoint','renew-lease'].includes(rec.operation)||
    !rec.context||typeof rec.context!=='object'||
    !rec.body||typeof rec.body!=='object'||
    !HASH.test(rec.digest||'')||
    rec.digest!==stamp({schema:1,operation:rec.operation,
      context:rec.context,body:rec.body}))
    fail('WORKER_PROGRESS_JOURNAL_DIGEST_INVALID');
  return rec;
}
function saveExclusive(file,record){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
function progressContext(local){
  return {agent_id:local.agent_id,ticket_id:local.ticket_id,
    lease_id:local.lease_id,expected_master_epoch:local.epoch,
    project_id:local.project_id,repository:local.repository,
    branch_name:local.branch_name,baseline_sha:local.baseline_sha,
    scopes:[...local.scopes],worktree:local.worktree};
}
function pendingIntent({dir,operation,local,input}){
  const ctx=progressContext(local),file=journalPath(dir,ctx.ticket_id);
  const content=checkContent(operation,input);
  if(fs.existsSync(file)){
    const r=readJournal(file);
    if(r.operation!==operation||
      JSON.stringify(r.context)!==JSON.stringify(ctx)||
      r.body.agent_id!==local.agent_id||r.body.ticket_id!==local.ticket_id||
      r.body.lease_id!==local.lease_id||
      r.body.expected_master_epoch!==local.epoch||
      !ID.test(r.body.request_id||'')||
      !r.body.request_id.startsWith(operation==='checkpoint'?'checkpoint_':'renew_')||
      JSON.stringify(Object.fromEntries(Object.keys(content).map(k=>[k,r.body[k]])))!==
        JSON.stringify(content)||
      Object.keys(r.body).length!==Object.keys(content).length+5)
      fail('WORKER_PROGRESS_PENDING_RECONCILIATION_REQUIRED');
    return {file,body:r.body,replayed:true};
  }
  const body={request_id:(operation==='checkpoint'?'checkpoint_':'renew_')+
      crypto.randomUUID().replace(/-/g,''),
    agent_id:ctx.agent_id,ticket_id:ctx.ticket_id,lease_id:ctx.lease_id,
    expected_master_epoch:ctx.expected_master_epoch,...content};
  const core={schema:1,operation,context:ctx,body};
  saveExclusive(file,{...core,digest:stamp(core)});
  return {file,body,replayed:false};
}
function validateExpiry(x){
  return typeof x.lease_expires_at==='string'&&
    Number.isFinite(Date.parse(x.lease_expires_at))&&
    typeof x.absolute_claim_deadline==='string'&&
    Number.isFinite(Date.parse(x.absolute_claim_deadline))&&
    Number.isSafeInteger(x.lease_seconds_remaining)&&
    x.lease_seconds_remaining>0&&x.lease_seconds_remaining<=600&&
    Date.parse(x.lease_expires_at)<=Date.parse(x.absolute_claim_deadline);
}
function validateResponse(operation,local,body,reply){
  if(!reply||reply.accepted!==true||reply.ticket_id!==local.ticket_id||
    !validateExpiry(reply))fail('WORKER_PROGRESS_RECEIPT_INVALID');
  if(operation==='renew-lease'){
    if(reply.agent_id!==local.agent_id||reply.lease_id!==local.lease_id||
      reply.epoch!==local.epoch||reply.automatic_execution_allowed!==false)
      fail('WORKER_PROGRESS_RECEIPT_INVALID');
  }else{
    const contentHash=digest(body.summary+'\n'+body.next_action);
    if(!Number.isSafeInteger(Number(reply.generation))||Number(reply.generation)<1||
      !Number.isSafeInteger(Number(reply.version))||Number(reply.version)<1||
      reply.content_sha256!==contentHash)
      fail('WORKER_PROGRESS_RECEIPT_INVALID');
  }
}
function validateCheckpointProof(body,reply,proof){
  const cp=proof?.latest_checkpoint;
  if(proof?.status!=='CHECKPOINTED'||!cp||
    Number(cp.generation)!==Number(reply.generation)||
    cp.summary!==body.summary||cp.next_action!==body.next_action||
    cp.content_sha256!==reply.content_sha256||
    digest(cp.summary+'\n'+cp.next_action)!==cp.content_sha256)
    fail('WORKER_CHECKPOINT_NOT_CONFIRMED');
}
function saveReceipt(dir,body,operation,response){
  const file=path.join(dir,'progress_receipt_'+body.request_id+'.json');
  const core={schema:1,operation,request_id:body.request_id,
    ticket_id:body.ticket_id,response};
  if(fs.existsSync(file))fail('WORKER_PROGRESS_RECEIPT_ALREADY_EXISTS');
  saveExclusive(file,{...core,digest:stamp(core)});
}
async function progressWorkerTask({
  origin,agentId,ticketId,dir,signer,operation,
  reason,summary,next_action,fetcher=fetch
}){
  if(typeof origin!=='string'||!ORIGIN.test(origin)||
     typeof dir!=='string'||!path.isAbsolute(dir)||
     !ID.test(agentId||'')||!ID.test(ticketId||'')||
     !signer||typeof signer.signWorkerAction!=='function')
    fail('WORKER_PROGRESS_INPUT_DENIED');
  const input=checkContent(operation,{reason,summary,next_action});
  const local=loadWorkerReceipt(dir,agentId,ticketId);
  // Both Central signed preflight and exact local Git worktree must be live.
  const initial=await resumeApprovedTask({origin,agentId,ticketId,dir,signer,fetcher});
  if(!initial.resume_allowed)fail('WORKER_PROGRESS_NOT_RESUMABLE');
  const intent=pendingIntent({dir,operation,local,input});
  // Never replace intent after an HTTP timeout. A retry submits the exact
  // original JSON payload under Central's idempotency ledger.
  const response=await signedRequest({origin,signer,method:'POST',
    uri:operation,agentId,payload:intent.body,fetcher});
  validateResponse(operation,local,intent.body,response);
  const proof=await signedRequest({origin,signer,method:'POST',uri:'resume-check',
    agentId,payload:{agent_id:agentId,ticket_id:ticketId,
      lease_id:local.lease_id,expected_master_epoch:local.epoch},fetcher});
  confirmResume(local,proof);
  if(operation==='checkpoint')validateCheckpointProof(intent.body,response,proof);
  // Persist a local evidence receipt only AFTER Central independently verifies
  // current lease and exact checkpoint content. On crash, retain pending
  // intent for Owner-controlled exact replay.
  saveReceipt(dir,intent.body,operation,response);
  fs.unlinkSync(intent.file);
  return {accepted:true,operation,ticket_id:ticketId,agent_id:agentId,
    epoch:local.epoch,worktree:local.worktree,
    replayed:intent.replayed,lease_expires_at:response.lease_expires_at,
    lease_seconds_remaining:response.lease_seconds_remaining,
    checkpoint_generation:operation==='checkpoint'?Number(response.generation):null,
    automatic_execution_allowed:false,git_push_allowed:false};
}
module.exports={progressWorkerTask};
