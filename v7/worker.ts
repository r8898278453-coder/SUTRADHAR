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
import {ID_RE,SHA_RE,safeScope} from './rules.ts';
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
  const file=fileFor(id),tmp=file+'.tmp-'+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(record,null,2),{mode:0o600});fs.renameSync(tmp,file);
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
  if(t.status!=='READY')throw new Error('Task is not READY');
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
  const claim=await request('/v7/tasks/claim',{request_id:'claim_'+token(),agent_id:agentId,
    ticket_id:id,expected_version:Number(t.version),expected_master_epoch:epoch});
  const local={agent_id:agentId,ticket_id:id,project_id:t.project_id,epoch,
    lease_id:claim.lease_id,baseline_sha:t.baseline_sha,branch_name:t.branch_name,
    repository:t.repository,scope,worktree:target};
  save(id,local);
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
async function checkpoint(id:string){
  const local=read(id);
  const summaryFile=process.argv[5],next=process.argv[6];
  if(!summaryFile||!next)throw new Error('checkpoint <agent> <ticket> <summary-file> <next-action>');
  const summary=fs.readFileSync(summaryFile,'utf8');
  if(summary.length>8000||!summary.trim())throw new Error('Checkpoint length out of bounds');
  const result=await request('/v7/tasks/checkpoint',{request_id:'checkpoint_'+token(),
    agent_id:agentId,ticket_id:id,lease_id:local.lease_id,
    expected_master_epoch:local.epoch,summary,next_action:next.slice(0,500)});
  console.log(JSON.stringify(result,null,2));
}
async function submit(id:string){
  const local=read(id),remote=await request('/v7/tasks/detail/'+id,undefined,'GET');
  if(remote.status!=='CHECKPOINTED'&&remote.status!=='TEST_FAILED')throw new Error('Checkpoint before submit');
  if(remote.branch_name!==local.branch_name||remote.baseline_sha!==local.baseline_sha)
    throw new Error('Task immutable branch/baseline mismatch');
  const root=local.worktree;
  if(git(root,'branch','--show-current')!==local.branch_name)throw new Error('Wrong branch');
  pathsAllowed(root,local.baseline_sha,local.scope);
  const head=git(root,'rev-parse','HEAD'),tree=git(root,'rev-parse','HEAD^{tree}');
  if(!SHA_RE.test(head)||!SHA_RE.test(tree))throw new Error('Invalid Git SHA');
  // Publishing a Git branch is separate and requires existing guarded v6 operator.
  const out=await request('/v7/tasks/submit',{request_id:'submit_'+token(),
    agent_id:agentId,ticket_id:id,lease_id:local.lease_id,
    expected_master_epoch:local.epoch,candidate_head_sha:head,candidate_tree_sha:tree});
  console.log(JSON.stringify({...out,candidate_head_sha:head,candidate_tree_sha:tree,
    note:'Branch publish and draft PR require independent authorized guarded steps.'},null,2));
}
async function qa(id:string){
  const t=await request('/v7/tasks/detail/'+id,undefined,'GET');
  if(t.status!=='SUBMITTED_FOR_REVIEW')throw new Error('Ticket not awaiting independent QA');
  if(t.worker_agent_id===agentId)throw new Error('Developer cannot self-approve QA');
  const repo=ensureRepository(t),head=t.candidate_head_sha,tree=t.candidate_tree_sha;
  if(!SHA_RE.test(head)||!SHA_RE.test(tree))throw new Error('Candidate hash missing');
  const qaDir=worktree(id+'_qa');
  // Exact SHA must have been fetched by a trusted read-only operator.
  try{git(repo,'cat-file','-e',head+'^{commit}');}
  catch{
    // Read-only fetch of the authorized branch, never push/rebase protected main.
    git(repo,'fetch','--no-tags','origin',t.branch_name);
    git(repo,'cat-file','-e',head+'^{commit}');
  }
  if(!fs.existsSync(qaDir)){
    const p=spawnSync('git',['-C',repo,'worktree','add','--detach',qaDir,head],
      {encoding:'utf8',timeout:30000});
    if(p.status!==0)throw new Error('QA worktree failed');
  }
  if(git(qaDir,'rev-parse','HEAD')!==head||git(qaDir,'rev-parse','HEAD^{tree}')!==tree)
    throw new Error('QA worktree SHA mismatch');
  const command=process.env.SUTRADHAR_TRUSTED_QA_COMMAND;
  if(!command||command.length>180)throw new Error('Configure trusted local QA command');
  const runner=path.resolve(process.env.SUTRADHAR_SUTRADHAR_ROOT||process.cwd(),'sandbox/run_sandbox.sh');
  if(!fs.existsSync(runner))throw new Error('Trusted sandbox script not found');
  const test=spawnSync('bash',[runner,qaDir,command],{encoding:'utf8',timeout:60000,
    maxBuffer:2*1024*1024});
  const passed=test.status===0&&String(test.stdout).includes('__SUTRADHAR_CONTAINER_TEST_STARTED__');
  const evidence={ticket_id:id,agent_id:agentId,head,tree,command_sha256:digest(command),
    runner_sha256:digest(fs.readFileSync(runner)),passed,exit_code:test.status,
    stdout:String(test.stdout).slice(-30000),stderr:String(test.stderr).slice(-30000),
    started_at:new Date().toISOString(),environment:'Docker air-gapped sandbox'};
  const raw=JSON.stringify(evidence),hash=digest(raw),signed=crypto.sign(null,Buffer.from(raw),key).toString('base64');
  const evidenceFile=path.join(taskDir,'qa_'+id+'_'+hash+'.json');
  fs.writeFileSync(evidenceFile,JSON.stringify({evidence,signature:signed},null,2),{mode:0o600});
  const out=await request('/v7/tasks/qa-receipt',{request_id:'qa_'+token(),agent_id:agentId,
    ticket_id:id,candidate_head_sha:head,candidate_tree_sha:tree,passed,
    evidence_sha256:hash,evidence_ref:'local-signed://sha256/'+hash});
  console.log(JSON.stringify({...out,local_evidence:evidenceFile},null,2));
  if(!passed)process.exitCode=1;
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
      expected_master_epoch:cluster.epoch,ticket_id:id});
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
async function main(){
  if(action==='list')console.log(JSON.stringify(await request('/v7/tasks/available',undefined,'GET'),null,2));
  else if(action==='detail')console.log(JSON.stringify(await request('/v7/tasks/detail/'+ticketId,undefined,'GET'),null,2));
  else if(action==='prepare')await prepare(ticketId);
  else if(action==='checkpoint')await checkpoint(ticketId);
  else if(action==='submit')await submit(ticketId);
  else if(action==='qa')await qa(ticketId);
  else if(action==='publish')await publish(ticketId,false);
  else if(action==='reconcile-push')await publish(ticketId,true);
  else throw new Error('Usage: worker {list|detail|prepare|checkpoint|submit|qa|publish|reconcile-push} AGENT_ID [TICKET_ID] [summary_file] [next_action]');
}
main().catch(e=>{console.error('Worker failed closed:',e.message);process.exitCode=1;});
