/**
 * Packaged Windows, Electron MAIN, explicit human-confirmed candidate submission.
 *
 * Produces a Central "SUBMITTED_FOR_REVIEW" record after strict local Git
 * inspection. It does NOT push/fetch, merge, run tests, launch providers,
 * approve QA, or turn a local Git object into remotely available evidence.
 *
 * Central idempotency + a durable local pending intent reconcile timeouts.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {loadWorkerReceipt,localWorktree,resumeApprovedTask,signedRequest}
  =require('./worker-claim.cjs');
const {inspectWorkerTasks}=require('./worker-inspection.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const ORIGIN=/^https:\/\/[a-z0-9.-]+(?::443)?$/i;
const fail=code=>{throw Error(code);};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function git(dir,hooks,...args){
  const p=spawnSync('git',['-c','core.hooksPath='+hooks,
    '-c','core.fsmonitor=false','-c','diff.external=',
    '-C',dir,...args],
    {encoding:null,timeout:20000,maxBuffer:1024*1024,windowsHide:true});
  if(p.error||p.status!==0||!Buffer.isBuffer(p.stdout))
    fail('SUBMIT_GIT_COMMAND_FAILED');
  return p.stdout;
}
function gitText(dir,hooks,...args){
  const b=git(dir,hooks,...args);
  return b.toString('utf8').trim();
}
function safePath(x){
  if(typeof x!=='string'||x.length===0||x.length>450||
     !/^[A-Za-z0-9._/-]+$/.test(x)||
     x.startsWith('/')||x.includes('//')||
     x.split('/').some(p=>!p||p==='.'||p==='..'))
    return false;
  // Changed Git metadata may cause unsafe future checkouts/QA/transport.
  const parts=x.toLowerCase().split('/');
  if(parts.some(p=>p==='.git'||p==='.gitattributes'||p==='.gitmodules'||
      p==='.lfsconfig'))return false;
  return true;
}
function inScope(file,scopes){
  return scopes.some(s=>file===s||file.startsWith(s+'/'));
}
function sameRealDirectory(a,b){
  try{
    const canonical=v=>{
      const p=fs.realpathSync.native(v);
      return process.platform==='win32'?path.normalize(p).toLowerCase():path.normalize(p);
    };
    return canonical(a)===canonical(b);
  }catch{return false;}
}
function inspectCommittedCandidate(local,dir){
  if(!fs.existsSync(local.worktree)||!fs.lstatSync(local.worktree).isDirectory()||
    fs.lstatSync(local.worktree).isSymbolicLink()||
    !sameRealDirectory(local.worktree,
      path.join(dir,'worktrees',local.ticket_id)))
    fail('SUBMIT_WORKTREE_MISSING_OR_UNTRUSTED');
  const verified=localWorktree({repoDir:local.repository_dir,
    t:{...local,write_scopes:local.scopes},workerDir:dir});
  if(!sameRealDirectory(verified.worktree,local.worktree))
    fail('SUBMIT_WORKTREE_IDENTITY_MISMATCH');
  const hooks=path.join(dir,'disabled-git-hooks');
  const head=gitText(local.worktree,hooks,'rev-parse','--verify','HEAD');
  const tree=gitText(local.worktree,hooks,'rev-parse','--verify','HEAD^{tree}');
  if(!SHA.test(head)||!SHA.test(tree))
    fail('SUBMIT_NO_COMMITTED_CHANGE_OR_INVALID_SHA');
  // Prioritize a dirty/untracked worktree diagnosis even when there is no
  // committed candidate yet; both conditions remain hard stop gates.
  const status=git(local.worktree,hooks,'status','--porcelain=v1',
    '-z','--untracked-files=all');
  if(status.length)fail('SUBMIT_UNCOMMITTED_OR_UNTRACKED_CHANGES');
  if(head===local.baseline_sha)
    fail('SUBMIT_NO_COMMITTED_CHANGE_OR_INVALID_SHA');
  const ancestor=spawnSync('git',['-c','core.hooksPath='+hooks,
    '-c','core.fsmonitor=false','-C',local.worktree,
    'merge-base','--is-ancestor',local.baseline_sha,head],
    {timeout:20000,windowsHide:true});
  if(ancestor.error||ancestor.status!==0)
    fail('SUBMIT_BASELINE_NOT_ANCESTOR');
  const raw=git(local.worktree,hooks,'diff','--raw','-r',
    '--no-renames','-z',local.baseline_sha,head);
  if(!raw.length||raw.length>1024*1024)
    fail('SUBMIT_NO_ALLOWED_DIFF');
  const fields=raw.toString('utf8').split('\0');
  if(fields.at(-1)!=='')fail('SUBMIT_DIFF_FORMAT_INVALID');
  const changed=[];
  for(let i=0;i<fields.length-1;i+=2){
    if(i+1>=fields.length-1)fail('SUBMIT_DIFF_FORMAT_INVALID');
    const meta=fields[i],file=fields[i+1];
    const m=/^:(000000|100644) 100644 [a-f0-9]{4,64} [a-f0-9]{4,64} ([AM])$/.exec(meta);
    if(!m||(m[2]==='A'&&m[1]!=='000000')||
      (m[2]==='M'&&m[1]!=='100644')||
      !safePath(file)||!inScope(file,local.scopes))
      fail('SUBMIT_CHANGED_PATH_OR_MODE_NOT_AUTHORIZED');
    changed.push(file);
    if(changed.length>300)fail('SUBMIT_TOO_MANY_CHANGED_PATHS');
  }
  if(changed.length===0||new Set(changed).size!==changed.length)
    fail('SUBMIT_DIFF_FORMAT_INVALID');
  verifyCandidateHistory(local,dir,head);
  // Claim-time attribute checks only covered paths already tracked at the
  // baseline. New scoped files may match dormant wildcard filters from a
  // previously committed .gitattributes, so inspect the candidate's own tree.
  const attr=spawnSync('git',['-c','core.hooksPath='+hooks,
    '-c','core.fsmonitor=false','-C',local.worktree,
    'check-attr','--source='+head,'--all','-z','--stdin'],
    {input:Buffer.from(changed.join('\0')+'\0','utf8'),encoding:null,
      timeout:20000,maxBuffer:2*1024*1024,windowsHide:true});
  if(attr.error||attr.status!==0||!Buffer.isBuffer(attr.stdout)||
     attr.stdout.length>2*1024*1024)
    fail('SUBMIT_CANDIDATE_ATTRIBUTES_UNREADABLE');
  const attrs=attr.stdout.toString('utf8').split('\0');
  if(attrs.at(-1)!==''||(attrs.length-1)%3!==0)
    fail('SUBMIT_CANDIDATE_ATTRIBUTES_UNREADABLE');
  const allowed=new Set(changed);
  for(let i=0;i<attrs.length-1;i+=3){
    const file=attrs[i],name=attrs[i+1],value=attrs[i+2];
    if(!allowed.has(file)||!name||!value)
      fail('SUBMIT_CANDIDATE_ATTRIBUTES_UNREADABLE');
    if((name==='filter'||name==='working-tree-encoding')&&
       value!=='unset'&&value!=='unspecified')
      fail('SUBMIT_CANDIDATE_ACTIVE_GIT_FILTER_REQUIRES_OWNER_REVIEW');
  }
  return {head,tree,changed_paths:changed.sort()};
}
// The final tree is not sufficient QA provenance: a worker could change an
// unauthorized file in an intermediate commit and revert it before submit.
// Require a bounded, single-parent sequence from the exact approved baseline,
// and independently check the raw path/mode delta at every step.
function verifyCandidateHistory(local,dir,head){
  const hooks=path.join(dir,'disabled-git-hooks');
  const lines=gitText(local.worktree,hooks,'rev-list','--parents',
    '--reverse','--max-count=41',local.baseline_sha+'..'+head).split('\n');
  if(lines.length===0||lines.length>40)
    fail('SUBMIT_HISTORY_TOO_COMPLEX_OR_MISSING');
  let parent=local.baseline_sha,totalChanges=0;
  for(const line of lines){
    const m=/^([a-f0-9]{40}) ([a-f0-9]{40})$/.exec(line);
    if(!m||m[2]!==parent)
      fail('SUBMIT_HISTORY_NON_LINEAR_OR_SHALLOW');
    const commit=m[1];
    const raw=git(local.worktree,hooks,'diff','--raw','-r',
      '--no-renames','-z',parent,commit);
    if(raw.length===0||raw.length>1024*1024)
      fail('SUBMIT_HISTORY_DIFF_MISSING_OR_EXCESSIVE');
    const parts=raw.toString('utf8').split('\0');
    if(parts.at(-1)!==''||(parts.length-1)%2!==0)
      fail('SUBMIT_HISTORY_DIFF_UNTRUSTED');
    for(let i=0;i<parts.length-1;i+=2){
      const meta=parts[i],file=parts[i+1];
      const mode=/^:(000000|100644) 100644 [a-f0-9]{4,64} [a-f0-9]{4,64} ([AM])$/.exec(meta);
      if(!mode||(mode[2]==='A'&&mode[1]!=='000000')||
        (mode[2]==='M'&&mode[1]!=='100644')||
        !safePath(file)||!inScope(file,local.scopes))
        fail('SUBMIT_HISTORY_PATH_OR_MODE_NOT_AUTHORIZED');
      if(++totalChanges>1200)
        fail('SUBMIT_HISTORY_TOO_COMPLEX_OR_MISSING');
    }
    parent=commit;
  }
  if(parent!==head)fail('SUBMIT_HISTORY_NON_LINEAR_OR_SHALLOW');
}
function files(dir,ticket){
  if(!path.isAbsolute(dir)||!ID.test(ticket))
    fail('SUBMIT_JOURNAL_PATH_INVALID');
  return {pending:path.join(dir,'submission_pending_'+ticket+'.json'),
    receipt:path.join(dir,'submission_receipt_'+ticket+'.json')};
}
function readFile(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size===0||st.size>16*1024)
    fail('SUBMIT_JOURNAL_UNTRUSTED');
  let r;
  try{r=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{fail('SUBMIT_JOURNAL_CORRUPT');}
  if(!r||r.schema!==1||!r.context||!r.body||!HASH.test(r.sha256||'')||
    hash({schema:1,context:r.context,body:r.body})!==r.sha256)
    fail('SUBMIT_JOURNAL_DIGEST_INVALID');
  return r;
}
function durableCreate(file,record){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
function context(local,snapshot){
  return {agent_id:local.agent_id,ticket_id:local.ticket_id,
    project_id:local.project_id,repository:local.repository,
    branch_name:local.branch_name,baseline_sha:local.baseline_sha,
    scopes:[...local.scopes],worktree:local.worktree,
    lease_id:local.lease_id,epoch:local.epoch,
    changed_paths:snapshot.changed_paths};
}
function intent(dir,local,snapshot){
  const f=files(dir,local.ticket_id),ctx=context(local,snapshot);
  if(fs.existsSync(f.pending)){
    const prior=readFile(f.pending),body=prior.body;
    if(JSON.stringify(prior.context)!==JSON.stringify(ctx)||
      Object.keys(body).length!==7||
      !ID.test(body.request_id||'')||!body.request_id.startsWith('submit_')||
      body.agent_id!==local.agent_id||body.ticket_id!==local.ticket_id||
      body.lease_id!==local.lease_id||
      body.expected_master_epoch!==local.epoch||
      body.candidate_head_sha!==snapshot.head||
      body.candidate_tree_sha!==snapshot.tree)
      fail('SUBMIT_PENDING_RECONCILIATION_REQUIRED');
    return {file:f.pending,body,replayed:true};
  }
  const body={request_id:'submit_'+crypto.randomUUID().replace(/-/g,''),
    agent_id:local.agent_id,ticket_id:local.ticket_id,
    lease_id:local.lease_id,expected_master_epoch:local.epoch,
    candidate_head_sha:snapshot.head,candidate_tree_sha:snapshot.tree};
  const core={schema:1,context:ctx,body};
  durableCreate(f.pending,{...core,sha256:hash(core)});
  return {file:f.pending,body,replayed:false};
}
function checkRemote(t,local,requireSubmitted,snapshot){
  if(!t||t.ticket_id!==local.ticket_id||
    t.worker_agent_id!==local.agent_id||
    t.project_id!==local.project_id||t.repository!==local.repository||
    t.branch_name!==local.branch_name||
    t.baseline_sha!==local.baseline_sha||
    JSON.stringify([...(Array.isArray(t.write_scopes)?t.write_scopes:[])].sort())!==
      JSON.stringify([...local.scopes].sort()))
    fail('SUBMIT_REMOTE_IMMUTABLE_TASK_MISMATCH');
  if(requireSubmitted){
    if(t.status!=='SUBMITTED_FOR_REVIEW'||
      t.candidate_head_sha!==snapshot.head||
      t.candidate_tree_sha!==snapshot.tree)
      fail('SUBMIT_REMOTE_PROOF_NOT_CONFIRMED');
  }else if(!['CHECKPOINTED','TEST_FAILED'].includes(t.status)||
    !t.latest_checkpoint||
    !Number.isSafeInteger(t.latest_checkpoint.generation)||
    t.latest_checkpoint.generation<1||
    sha(t.latest_checkpoint.summary+'\n'+t.latest_checkpoint.next_action)!==
      t.latest_checkpoint.content_sha256)
    fail('SUBMIT_CHECKPOINT_REQUIRED');
}
function saveReceipt(dir,local,snapshot,pendingBody){
  const f=files(dir,local.ticket_id);
  const core={schema:1,context:context(local,snapshot),
    body:pendingBody};
  const record={...core,sha256:hash(core)};
  if(fs.existsSync(f.receipt)){
    const prior=readFile(f.receipt);
    if(JSON.stringify(prior)!==JSON.stringify(record))
      fail('SUBMIT_EXISTING_RECEIPT_CONFLICT');
    return;
  }
  durableCreate(f.receipt,record);
}
async function submitWorkerCandidate({
  origin,agentId,ticketId,dir,signer,fetcher=fetch
}){
  if(typeof origin!=='string'||!ORIGIN.test(origin)||
    !ID.test(agentId||'')||!ID.test(ticketId||'')||
    typeof dir!=='string'||!path.isAbsolute(dir)||
    !signer||typeof signer.signWorkerAction!=='function')
    fail('SUBMIT_INPUT_DENIED');
  if(fs.existsSync(path.join(dir,'progress_'+ticketId+'.json')))
    fail('SUBMIT_PENDING_PROGRESS_REQUIRES_RECONCILIATION');
  const local=loadWorkerReceipt(dir,agentId,ticketId);
  const snapshot=inspectCommittedCandidate(local,dir);
  const f=files(dir,ticketId);
  const alreadyPending=fs.existsSync(f.pending),alreadyReceipt=fs.existsSync(f.receipt);
  // Check authoritative Central status BEFORE writing any new claim intent.
  const prior=(await inspectWorkerTasks({
    origin,agentId,ticketId,signer,fetcher
  })).task;
  checkRemote(prior,local,falseIfNeverSubmitted(prior),snapshot);
  if(prior.status==='SUBMITTED_FOR_REVIEW'){
    // A lost POST response or app crash after the Central commit is
    // reconciled from a separate signed GET task detail. No second POST.
    if(!alreadyPending&&!alreadyReceipt)
      fail('SUBMIT_EXISTING_REMOTE_SUBMISSION_REQUIRES_OWNER_REVIEW');
    if(alreadyPending){
      const saved=intent(dir,local,snapshot);
      saveReceipt(dir,local,snapshot,saved.body);
      fs.unlinkSync(saved.file);
    }else{
      const receipt=readFile(f.receipt);
      const ctx=context(local,snapshot);
      if(JSON.stringify(receipt.context)!==JSON.stringify(ctx)||
        receipt.body.candidate_head_sha!==snapshot.head||
        receipt.body.candidate_tree_sha!==snapshot.tree)
        fail('SUBMIT_EXISTING_RECEIPT_CONFLICT');
    }
    return {accepted:true,already_submitted:true,ticket_id:ticketId,
      candidate_head_sha:snapshot.head,candidate_tree_sha:snapshot.tree,
      changed_paths:snapshot.changed_paths,git_push_allowed:false,
      qa_passed:false,automatic_execution_allowed:false};
  }
  const proof=await resumeApprovedTask({origin,agentId,ticketId,
    dir,signer,fetcher});
  if(!['CHECKPOINTED','TEST_FAILED'].includes(proof.status))
    fail('SUBMIT_CHECKPOINT_REQUIRED');
  if(alreadyReceipt)fail('SUBMIT_RECEIPT_CONFLICT_REQUIRES_OWNER_REVIEW');
  const pending=intent(dir,local,snapshot);
  const accepted=await signedRequest({origin,signer,method:'POST',
    uri:'submit',agentId,payload:pending.body,fetcher});
  if(!accepted||accepted.accepted!==true||
    accepted.ticket_id!==ticketId||accepted.status!=='SUBMITTED_FOR_REVIEW')
    fail('SUBMIT_ACKNOWLEDGMENT_INVALID');
  const verification=(await inspectWorkerTasks({
    origin,agentId,ticketId,signer,fetcher
  })).task;
  checkRemote(verification,local,true,snapshot);
  saveReceipt(dir,local,snapshot,pending.body);
  fs.unlinkSync(pending.file);
  return {accepted:true,replayed:pending.replayed,ticket_id:ticketId,
    candidate_head_sha:snapshot.head,candidate_tree_sha:snapshot.tree,
    changed_paths:snapshot.changed_paths,status:'SUBMITTED_FOR_REVIEW',
    git_push_allowed:false,qa_passed:false,
    automatic_execution_allowed:false};
}
// Only used to choose expected Central stage; immutable data is verified in
// both branches. Never interpret a submitted ticket as "no checkpoint".
function falseIfNeverSubmitted(t){return t?.status==='SUBMITTED_FOR_REVIEW';}
module.exports={submitWorkerCandidate,inspectCommittedCandidate};
