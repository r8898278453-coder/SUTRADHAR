/**
 * SUTRADHAR v7 trusted PC worktree + manual browser handoff + Docker QA CLI.
 * This is an assisted worker, not unauthorized website automation. Trusted
 * local Git and sandbox scripts run only on the workstation, never on Hostinger.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {ID_RE,SHA_RE,safeScope,validTaskBranch} from './rules.ts';
import {verifyWorkerResume} from './worker_resume_validation.ts';
import {getOrCreateClaimIntent,hasPendingClaim,verifyClaimReceipt,closeClaimIntent} from './worker_claim_journal.ts';
import {getOrCreateRenewIntent,verifyRenewReceipt,closeRenewIntent} from './worker_lease_journal.ts';
import {getOrCreateCheckpointIntent,verifyCheckpointReceipt,closeCheckpointIntent,checkpointIntentPath} from './worker_checkpoint_journal.ts';
import {getOrCreateSubmitIntent,hasPendingSubmit,verifySubmitReceipt,verifySubmitObservation,closeSubmitIntent} from './worker_submit_journal.ts';
import {verifyQaReviewStatus,validQaReviewId} from './qa_review_status.ts';
const home=process.env.SUTRADHAR_NODE_DIR||path.join(os.homedir(),'.sutradhar','v7');
const identityFile=path.join(home,'identity.json');
if(!fs.existsSync(identityFile))throw new Error('Run the node agent first; identity missing');
const state=JSON.parse(fs.readFileSync(identityFile,'utf8'));
const key=crypto.createPrivateKey(state.private_key_pem);
const base=(process.env.SUTRADHAR_CENTRAL_URL||'').replace(/\/+$/,'');
if(!/^https:\/\//.test(base)&&!(process.env.SUTRADHAR_ALLOW_HTTP_LOCAL==='true'&&
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(base)))
  throw new Error('HTTPS central URL required');
const action=process.argv[2],agentId=process.argv[3],ticketId=process.argv[4];
if(!ID_RE.test(agentId||'')||!state.agents.some((a:any)=>a.id===agentId))
  throw new Error('Agent must belong to this machine');
const taskDir=path.join(home,'tasks');
fs.mkdirSync(taskDir,{recursive:true,mode:0o700});
const digest=(x:string|Buffer)=>crypto.createHash('sha256').update(x).digest('hex');
const token=()=>crypto.randomUUID().replace(/-/g,'');
const git=(root:string,...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:20000,maxBuffer:1024*1024}).trim();
async function request(pathname:string,payload?:any,method='POST'){
  const body=method==='GET'?'':JSON.stringify(payload);
  const ts=Date.now(),nonce='nonce_'+token();
  const value=[String(ts),nonce,method,pathname,digest(body)].join('\n');
  const sig=crypto.sign(null,Buffer.from(value),key).toString('base64');
  const res=await fetch(base+pathname,{method,headers:{
    'content-type':'application/json','x-sutradhar-node':state.node_id,
    'x-sutradhar-timestamp':String(ts),'x-sutradhar-nonce':nonce,
    'x-sutradhar-signature':sig,'x-sutradhar-agent':agentId
  },body:method==='POST'?body:undefined,signal:AbortSignal.timeout(20000)});
  const out=await res.json() as any;
  if(!res.ok)throw new Error(out.error_code||'HTTP_'+res.status);
  return out;
}
function fileFor(id:string){if(!ID_RE.test(id))throw new Error('Invalid ticket ID');
  return path.join(taskDir,id+'.json');}
function save(id:string,record:any){
  const file=fileFor(id),tmp=file+'.tmp-'+process.pid+'-'+token();
  let fd:number|undefined;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeSync(fd,JSON.stringify(record,null,2));
    fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  fs.renameSync(tmp,file);
}
function read(id:string){return JSON.parse(fs.readFileSync(fileFor(id),'utf8'));}
function array(v:any):string[]{const a=typeof v==='string'?JSON.parse(v):v;
  if(!Array.isArray(a)||!a.every(safeScope))throw new Error('Unsafe file scopes');return a;}
function ensureRepository(t:any):string{
  const root=process.env.SUTRADHAR_PROJECT_REPO;
  if(!root||!path.isAbsolute(root)||!fs.statSync(root).isDirectory())throw new Error('SUTRADHAR_PROJECT_REPO must be an existing absolute trusted checkout');
  const origin=git(root,'remote','get-url','origin').replace(/\.git$/,'');
  const normalized=origin.replace(/^git@github\.com:/,'https://github.com/');
  if(normalized!=='https://github.com/'+t.repository)
    throw new Error('Local origin does not match authorized project repository');
  if(!SHA_RE.test(t.baseline_sha))throw new Error('Bad baseline SHA');
  git(root,'cat-file','-e',t.baseline_sha+'^{commit}');
  return root;
}
function worktree(id:string){
  const root=process.env.SUTRADHAR_WORKTREES_ROOT;
  if(!root||!path.isAbsolute(root))throw new Error('Absolute SUTRADHAR_WORKTREES_ROOT required');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  return path.join(root,id);
}
function pathsAllowed(root:string,baseline:string,scope:string[]){
  const diff=git(root,'diff','--name-status',baseline,'HEAD');
  const changes=diff.split('\n').filter(Boolean);
  if(!changes.length)throw new Error('No code changes to submit');
  for(const row of changes){
    const parts=row.split('\t');if(parts.length!==2||!['A','M'].includes(parts[0]))
      throw new Error('Renames, deletions and type changes are not auto-authorized');
    const f=parts[1];
    if(!safeScope(f)||!scope.some(s=>f===s||f.startsWith(s+'/')))
      throw new Error('Unapproved changed path: '+f);
  }
  if(git(root,'status','--porcelain'))throw new Error('Commit all work on the ticket branch before submitting');
  return changes.length;
}
async function prepare(id:string){
  const t=await request('/v7/tasks/detail/'+id,undefined,'GET');
  if(!validTaskBranch(t.branch_name))throw Error('TASK_BRANCH_NOT_PUBLISHABLE');
  // Only a known pending local claim may replay a CLAIMED ticket. Never
  // manufacture a new request when Central may already own its lease.
  if(t.status!=='READY'&&!(t.status==='CLAIMED'&&
     t.worker_agent_id===agentId&&hasPendingClaim(taskDir,id)))
    throw new Error('Task not READY; unknown prior claim requires Owner review');
  const repo=ensureRepository(t),scope=array(t.write_scopes),target=worktree(id);
  if(!fs.existsSync(target)){
    // A private local worktree only. Never pushes, merges or changes protected main.
    const result=spawnSync('git',['-C',repo,'worktree','add','-b',t.branch_name,target,t.baseline_sha],
      {encoding:'utf8',timeout:30000});
    if(result.status!==0)throw new Error('Worktree creation failed: '+String(result.stderr).slice(0,500));
  }
  if(git(target,'branch','--show-current')!==t.branch_name)
    throw new Error('Refusing worktree on wrong branch');
  if(git(target,'merge-base','HEAD',t.baseline_sha)!==t.baseline_sha)
    throw new Error('Worktree is not based on authorized source commit');
  const state=await request('/v7/cluster/state',undefined,'GET');
  const epoch=Number(state.epoch);
  if(!Number.isSafeInteger(epoch)||epoch<1||state.phase!=='READY'||state.paused)
    throw new Error('Central must have a current READY Master and be unpaused');
  const pending=getOrCreateClaimIntent({
    dir:taskDir,task:{...t,ticket_id:id},agentId,scope,epoch
  });
  // If the HTTP response is lost, this same durable request ID is replayed
  // through Central's command idempotency ledger. Never start a second claim.
  const claim=await request('/v7/tasks/claim',pending.body);
  const leaseId=verifyClaimReceipt(pending.body,claim);
  const local={agent_id:agentId,ticket_id:id,project_id:t.project_id,epoch,
    lease_id:leaseId,baseline_sha:t.baseline_sha,branch_name:t.branch_name,
    repository:t.repository,scope,worktree:target,claim_request_id:pending.body.request_id};
  save(id,local);
  // A replayed idempotent claim receipt may belong to an EXPIRED lease.
  // Do not tell the operator that work may start until Central verifies its
  // live epoch, original lease ID and task state, read only.
  const verified=await request('/v7/tasks/resume-check',{
    agent_id:agentId,ticket_id:id,lease_id:leaseId,
    expected_master_epoch:epoch
  });
  verifyWorkerResume(local,verified,agentId,id);
  // Only erase pending intent AFTER durable local lease AND live Central proof.
  closeClaimIntent(pending.file,pending.body);
  const criteria=typeof t.acceptance_criteria==='string'?JSON.parse(t.acceptance_criteria):t.acceptance_criteria;
  const context=[
    '# SUTRADHAR scoped worker handoff',
    'Ticket: '+id+' / project: '+t.project_id,
    'Repository: '+t.repository+' / branch: '+t.branch_name,
    'Immutable baseline: '+t.baseline_sha,
    'Goal: '+t.title,
    'Task: '+t.description,
    'Allowed write scopes: '+scope.join(', '),
    'Acceptance criteria: '+JSON.stringify(criteria),
    'Recovery summary: '+(t.latest_checkpoint?.summary||'none'),
    'Next action: '+(t.latest_checkpoint?.next_action||'implement and checkpoint'),
    'Do not touch forbidden files, secrets, core, main or unrelated contracts.',
    'Provide implementation in the authorized local worktree; no auto-login or provider account switching.',
    'After coding: commit on ticket branch, checkpoint and submit the exact commit/tree.',
  ].join('\n\n');
  fs.writeFileSync(path.join(taskDir,'handoff_'+id+'.md'),context,{mode:0o600});
  console.log(JSON.stringify({ticket:id,worktree:target,lease_seconds:claim.lease_seconds,
    handoff:path.join(taskDir,'handoff_'+id+'.md')},null,2));
}
async function resume(id:string,quiet=false){
  const local=read(id);
  const proof=await request('/v7/tasks/resume-check',{
    agent_id:agentId,ticket_id:id,lease_id:local.lease_id,
    expected_master_epoch:local.epoch});
  const safe=verifyWorkerResume(local,proof,agentId,id);
  // Only inspect trusted local Git; no fetch, push, rebase or lease renewal.
  ensureRepository(proof);
  const root=process.env.SUTRADHAR_WORKTREES_ROOT;
  if(!root||!path.isAbsolute(root))throw Error('Absolute worktree root required');
  const expected=path.join(root,id);
  if(local.worktree!==expected||!fs.existsSync(expected)||
    fs.lstatSync(expected).isSymbolicLink())throw Error('LOCAL_WORKTREE_MISMATCH');
  if(fs.realpathSync(git(expected,'rev-parse','--show-toplevel'))!==fs.realpathSync(expected))
    throw Error('GIT_WORKTREE_ROOT_MISMATCH');
  if(git(expected,'branch','--show-current')!==proof.branch_name||
    git(expected,'merge-base','HEAD',proof.baseline_sha)!==proof.baseline_sha)
    throw Error('GIT_BRANCH_OR_BASELINE_MISMATCH');
  if(!quiet)console.log(JSON.stringify({...safe,worktree:expected,
    note:'Existing lease and Git checkout verified. Manual continuation only; no automatic provider/Git actions.'},null,2));
  return safe;
}
async function renew(id:string){
  const local=read(id);
  const reason=process.argv[5];
  if(!reason||reason.trim()!==reason||reason.length<12||reason.length>300)
    throw Error('renew requires one 12-300 character progress/recovery reason');
  // Both preflight checks are read-only and do not automatically execute code.
  await resume(id,true);
  const pending=getOrCreateRenewIntent({
    dir:taskDir,agent_id:agentId,ticket_id:id,lease_id:local.lease_id,
    epoch:local.epoch,reason
  });
  // Ambiguous HTTP result is NOT failure. Next manually initiated renewal
  // replays the identical command and retains the local intent.
  const accepted=await request('/v7/tasks/renew-lease',pending.body);
  verifyRenewReceipt(pending.body,accepted);
  await resume(id,true); // Confirm replayed receipt still has a LIVE lease.
  closeRenewIntent(pending.file,pending.body);
  console.log(JSON.stringify({...accepted,
    manual_only:true,
    note:'Signed worker lease is live; only authorized manual coding/checkpoint is permitted.'},null,2));
}
async function checkpoint(id:string){
  const local=read(id);
  const summaryFile=process.argv[5],next=process.argv[6];
  if(!summaryFile||!next)throw new Error('checkpoint <agent> <ticket> <summary-file> <next-action>');
  const summary=fs.readFileSync(summaryFile,'utf8');
  if(summary.length>8000||!summary.trim()||next.length>500||!next.trim())
    throw new Error('Checkpoint length or next-action out of bounds');
  // Fresh signed read-only lease/epoch/Git proof before any new intent.
  await resume(id,true);
  const pending=getOrCreateCheckpointIntent({dir:taskDir,agent_id:agentId,
    ticket_id:id,lease_id:local.lease_id,epoch:local.epoch,
    summary,next_action:next});
  // Preserve the exact request ID across lost HTTP responses and manual retry.
  const accepted=await request('/v7/tasks/checkpoint',pending.body);
  const receipt=verifyCheckpointReceipt(pending.body,accepted);
  const proof=await request('/v7/tasks/resume-check',{
    agent_id:agentId,ticket_id:id,lease_id:local.lease_id,
    expected_master_epoch:local.epoch});
  const checked=verifyWorkerResume(local,proof,agentId,id);
  if(checked.latest_checkpoint_generation!==receipt.generation||
     proof.latest_checkpoint?.content_sha256!==receipt.content_sha256)
    throw Error('CHECKPOINT_REMOTE_PROOF_MISMATCH');
  // Only after durable Central proof can the local pending retry be retired.
  closeCheckpointIntent(pending.file,pending.body);
  console.log(JSON.stringify({...accepted,manual_only:true},null,2));
}
async function submit(id:string){
  const local=read(id),remote=await request('/v7/tasks/detail/'+id,undefined,'GET');
  // An unresolved checkpoint intent may already have reached Central.
  // Never submit while its acknowledgement is still ambiguous.
  if(fs.existsSync(checkpointIntentPath(taskDir,id)))
    throw Error('CHECKPOINT_PENDING_RECONCILIATION_REQUIRED');
  const pendingBefore=hasPendingSubmit(taskDir,id);
  if(!['CHECKPOINTED','TEST_FAILED'].includes(remote.status)&&
     !(pendingBefore&&remote.status==='SUBMITTED_FOR_REVIEW'))
    throw Error('SUBMIT_REMOTE_STATE_REQUIRES_OWNER_RECONCILIATION');
  if(remote.ticket_id!==id||remote.worker_agent_id!==agentId||
     remote.project_id!==local.project_id||remote.repository!==local.repository||
     remote.branch_name!==local.branch_name||remote.baseline_sha!==local.baseline_sha||
     JSON.stringify(array(remote.write_scopes).sort())!==JSON.stringify([...local.scope].sort()))
    throw Error('SUBMIT_TASK_IMMUTABLE_MISMATCH');
  // Initial submission must pass live, signed lease and worktree preflight.
  // A received-but-unacknowledged submission will already be SUBMITTED_FOR_REVIEW,
  // so only that exact pending request may be replayed, after Central re-fences it.
  if(!pendingBefore)await resume(id,true);
  ensureRepository(remote);
  const trustedRoot=process.env.SUTRADHAR_WORKTREES_ROOT;
  if(!trustedRoot||!path.isAbsolute(trustedRoot))
    throw Error('SUBMIT_WORKTREE_ROOT_INVALID');
  const expected=path.join(trustedRoot,id),root=local.worktree;
  if(root!==expected||!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink()||
     fs.realpathSync(git(root,'rev-parse','--show-toplevel'))!==fs.realpathSync(root))
    throw Error('SUBMIT_WORKTREE_IDENTITY_MISMATCH');
  if(git(root,'branch','--show-current')!==local.branch_name||
     git(root,'merge-base','HEAD',local.baseline_sha)!==local.baseline_sha)
    throw Error('SUBMIT_BRANCH_OR_BASELINE_MISMATCH');
  pathsAllowed(root,local.baseline_sha,local.scope);
  const head=git(root,'rev-parse','HEAD'),tree=git(root,'rev-parse','HEAD^{tree}');
  if(!SHA_RE.test(head)||!SHA_RE.test(tree))throw Error('SUBMIT_GIT_SHA_INVALID');
  const intent=getOrCreateSubmitIntent({dir:taskDir,agent_id:agentId,ticket_id:id,
    lease_id:local.lease_id,epoch:local.epoch,project_id:local.project_id,
    repository:local.repository,branch_name:local.branch_name,
    baseline_sha:local.baseline_sha,scope:local.scope,
    candidate_head_sha:head,candidate_tree_sha:tree});
  // A timeout is UNKNOWN. Retain this exact Git candidate and request ID.
  const accepted=await request('/v7/tasks/submit',intent.body);
  const version=verifySubmitReceipt(intent.body,accepted);
  const confirmed=await request('/v7/tasks/detail/'+id,undefined,'GET');
  verifySubmitObservation({body:intent.body,remote:confirmed,version,
    project_id:local.project_id,repository:local.repository,
    branch_name:local.branch_name,baseline_sha:local.baseline_sha});
  closeSubmitIntent(intent.file,intent.body);
  console.log(JSON.stringify({...accepted,manual_only:true,
    note:'Submission recorded for independent QA; no Git publication or merge authorized.'},null,2));
}
// Legacy developer-only QA used a non-vault signature and hash-only
// receipt, incompatible with the required independent Owner evidence review.
// Refuse before starting Docker, touching Git or posting an invalid receipt.
async function qa(_id:string){
  throw Error('QA_LEGACY_CLI_DISABLED_USE_PACKAGED_OWNER_REVIEW');
}
async function qaReviewStatus(id:string){
  const proposalId=process.argv[5];
  if(!ID_RE.test(id)||!validQaReviewId(proposalId))
    throw Error('qa-review requires a ticket ID and qaev_<64 lowercase hex> ID');
  const proof=await request('/v7/tasks/qa-review/'+proposalId,undefined,'GET');
  const state=verifyQaReviewStatus({
    agent_id:agentId,ticket_id:id,review_proposal_id:proposalId
  },proof);
  console.log(JSON.stringify({...state,
    note:'READ ONLY. Owner decision is separate from QA receipt and Git publication.'},null,2));
}
async function publish(id:string,reconcileOnly=false){
  if(!reconcileOnly&&(process.env.SUTRADHAR_ENABLE_V7_GIT_PUSH!=='true'||
    !process.env.SUTRADHAR_GITHUB_PUSH_TOKEN))throw new Error('Git publication OFF without explicit local owner enablement + scoped token');
  const t=await request('/v7/tasks/detail/'+id,undefined,'GET');
  if(t.status!=='INTEGRATING')throw new Error('Task must pass independent QA before publication');
  const repo=ensureRepository(t),qaDir=worktree(id+'_qa');
  const scope=array(t.write_scopes);
  const job=await request('/v7/git/job/'+id,undefined,'GET').catch(()=>null);
  if(!job&&!reconcileOnly){
    const cluster=await request('/v7/cluster/state',undefined,'GET');
    await request('/v7/git/reserve',{request_id:'publish_'+token(),agent_id:agentId,
      expected_master_epoch:cluster.epoch,ticket_id:id,
      expected_candidate_head_sha:t.candidate_head_sha,
      expected_candidate_tree_sha:t.candidate_tree_sha,
      expected_ticket_version:Number(t.version)});
  }else if(!job)throw new Error('Cannot reconcile unreserved Git publication');
  else if(job.state==='CONFIRMED'){
    console.log(JSON.stringify({already_confirmed:true,remote_head_sha:job.remote_head_sha}));
    return;
  }else if(!reconcileOnly)throw new Error('Existing publication reservation uncertain; use reconcile-push, NEVER repush');
  const params=['-m','sandbox.push_tested_branch','--repo-root',repo,
    '--github-repository',t.repository,'--ticket-id',id,'--branch',t.branch_name,
    '--baseline-commit',t.baseline_sha,'--candidate-tree-sha',t.candidate_tree_sha];
  let patchFile='';
  if(reconcileOnly)params.push('--inspect-only');
  else {
    if(!fs.existsSync(qaDir)||git(qaDir,'rev-parse','HEAD')!==t.candidate_head_sha||
       git(qaDir,'rev-parse','HEAD^{tree}')!==t.candidate_tree_sha)
      throw new Error('Only the independently QA-accepted local Git tree can be published');
    if(git(repo,'rev-parse','HEAD')!==t.baseline_sha)
      throw new Error('Trusted repository HEAD changed since Docker QA');
    pathsAllowed(qaDir,t.baseline_sha,scope);
    const diff=execFileSync('git',['-C',qaDir,'diff','--binary','--full-index',t.baseline_sha,'HEAD'],
      {encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
    if(!diff||Buffer.byteLength(diff)>900000)throw new Error('Patch absent or exceeds review budget');
    patchFile=path.join(taskDir,'patch_'+id+'_'+token()+'.diff');
    fs.writeFileSync(patchFile,diff,{mode:0o600});
    params.push('--patch-sha256',digest(diff),'--patch-file',patchFile);
    const changed=git(qaDir,'diff','--name-only',t.baseline_sha,'HEAD').split('\n').filter(Boolean);
    for(const file of changed)params.push('--changed-file',file);
    for(const file of changed)params.push('--allowed-file',file);
  }
  const root=path.resolve(process.env.SUTRADHAR_SUTRADHAR_ROOT||process.cwd());
  if(!fs.existsSync(path.join(root,'sandbox/push_tested_branch.py')))
    throw new Error('Reviewed trusted publisher script not found');
  let result:any;
  try {
    const proc=spawnSync(process.env.SUTRADHAR_PYTHON||'python3',params,{
      cwd:root,env:process.env,encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
    if(proc.status!==0)throw new Error('Trusted publisher process failed');
    result=JSON.parse(String(proc.stdout).trim());
    if(result.success!==true)throw new Error(result.error||'GIT_REMOTE_UNCERTAIN');
    if(result.status==='REMOTE_BRANCH_ABSENT')
      throw new Error('Remote branch absent; do not automatically repush after ambiguity');
    if(!['PUSH_CONFIRMED_NOT_MERGED','REMOTE_BRANCH_CONFIRMED_NOT_MERGED'].includes(result.status))
      throw new Error('Publisher did not prove remote branch');
    const cluster=await request('/v7/cluster/state',undefined,'GET');
    const out=await request('/v7/git/confirm',{request_id:'confirm_'+token(),agent_id:agentId,
      expected_master_epoch:cluster.epoch,ticket_id:id,
      expected_remote_head_sha:result.headSha});
    console.log(JSON.stringify({...out,notice:'Draft PR still needs separate Owner authorization and independent merge review'},null,2));
  }catch(e){
    // A failed remote request does NOT prove the push did not happen.
    const record={ticket:id,at:new Date().toISOString(),action:'GIT_PUBLISH_UNCERTAIN'};
    fs.appendFileSync(path.join(home,'sealed_outbox.jsonl'),
      JSON.stringify({record,signature:crypto.sign(null,Buffer.from(JSON.stringify(record)),key).toString('base64')})+'\n',{mode:0o600});
    console.error('Git result uncertain. DO NOT repush; use reconcile-push after inspecting remote.');
    throw e;
  }finally{if(patchFile){try{fs.unlinkSync(patchFile);}catch{}}}
}
// Explicit manual record only. After an uncertain POST, read signed detail
// before deciding what to do; never automatically repeat a provider action.
async function providerAttempt(id:string){
  const kind=process.argv[5];
  if(!['begin','interrupt','close'].includes(kind||''))throw Error('provider-attempt <agent> <ticket> {begin PROVIDER CONTEXT_SHA256|interrupt ATTEMPT_ID|close ATTEMPT_ID REVIEWED}');
  const local=read(id);
  await resume(id,true);
  const t=await request('/v7/tasks/detail/'+id,undefined,'GET');
  if(t.ticket_id!==id||t.worker_agent_id!==agentId)throw Error('PROVIDER_ATTEMPT_TASK_MISMATCH');
  const body:any={action:kind.toUpperCase(),request_id:'provider_'+token(),agent_id:agentId,
    ticket_id:id,lease_id:local.lease_id,expected_master_epoch:local.epoch};
  if(kind==='begin'){
    const provider=process.argv[6],context_sha256=process.argv[7];
    const mapping=t.provider_mappings?.find((m:any)=>m.provider===provider);
    if(t.status!=='CHECKPOINTED'||t.provider_mapping_source!=='MYSQL_OWNER_REGISTRY'||
       !mapping||!/^[0-9a-f]{64}$/.test(context_sha256||'')||
       !t.latest_checkpoint||t.provider_attempt&&t.provider_attempt.state!=='CLOSED')
      throw Error('PROVIDER_ATTEMPT_BEGIN_REQUIRES_CURRENT_MAPPING_AND_CHECKPOINT');
    Object.assign(body,{provider,context_sha256,registry_version:t.provider_registry_version,
      binding_sha256:mapping.binding_sha256,expected_task_version:Number(t.version),checkpoint_generation:Number(t.latest_checkpoint.generation),
      checkpoint_sha256:t.latest_checkpoint.content_sha256});
  }else{
    const attempt_id=process.argv[6];
    if(!/^attempt_[a-f0-9]{32}$/.test(attempt_id||'')||t.provider_attempt?.attempt_id!==attempt_id||
       t.provider_attempt.state==='CLOSED')throw Error('PROVIDER_ATTEMPT_STATE_MISMATCH');
    body.attempt_id=attempt_id;
    if(kind==='close'){
      if(process.argv[7]!=='REVIEWED')throw Error('Review external session and exact local worktree before using REVIEWED');
      Object.assign(body,{external_session_reviewed:true,worktree_reviewed:true});
    }
  }
  try{
    const result=await request('/v7/tasks/provider-attempt',body);
    const latest=await request('/v7/tasks/detail/'+id,undefined,'GET');
    const expected=kind==='begin'?'OPEN':kind==='interrupt'?'INTERRUPTED':'CLOSED';
    if(result?.accepted!==true||result.automatic_execution_allowed!==false||
       result.provider_mapping_verified!==false||result.provider_sent!==false||
       result.attempt?.state!==expected||latest.provider_attempt?.attempt_id!==result.attempt.attempt_id||
       latest.provider_attempt?.state!==expected)throw Error('PROVIDER_ATTEMPT_READBACK_REQUIRED');
    console.log(JSON.stringify({attempt:latest.provider_attempt,automatic_execution_allowed:false,
      note:'Local metadata only. No provider session or permission verified.'},null,2));
  }catch{
    throw Error('PROVIDER_ATTEMPT_OUTCOME_UNCERTAIN: inspect signed task detail and review before another command; no automatic retry');
  }
}
async function main(){
  if(action==='list')console.log(JSON.stringify(await request('/v7/tasks/available',undefined,'GET'),null,2));
  else if(action==='detail')console.log(JSON.stringify(await request('/v7/tasks/detail/'+ticketId,undefined,'GET'),null,2));
  else if(action==='prepare')await prepare(ticketId);
  else if(action==='resume')await resume(ticketId);
  else if(action==='renew')await renew(ticketId);
  else if(action==='checkpoint')await checkpoint(ticketId);
  else if(action==='provider-attempt')await providerAttempt(ticketId);
  else if(action==='submit')await submit(ticketId);
  else if(action==='qa')await qa(ticketId);
  else if(action==='qa-review')await qaReviewStatus(ticketId);
  else if(action==='publish')await publish(ticketId,false);
  else if(action==='reconcile-push')await publish(ticketId,true);
  else throw new Error('Usage: worker {list|detail|prepare|resume|renew|checkpoint|provider-attempt|submit|qa-review|publish|reconcile-push} AGENT_ID [TICKET_ID] [reason|summary_file] [next_action]');
}
main().catch(e=>{console.error('Worker failed closed:',e.message);process.exitCode=1;});
