/**
 * Electron MAIN-only: explicit-operator, OS-vault signed task claim.
 * No plaintext identity, browser credentials, Git push, provider automation,
 * checkpoint/QA, or execution from untrusted task descriptions.
 * The Git checkout MUST have been manually selected by the PC operator.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inspectWorkerTasks,compactWorkerContext}=require('./worker-inspection.cjs');
const {evidenceEntryPresent}=require('./local-evidence-file.cjs');
const {readEvidenceBytes}=require('./local-evidence-file.cjs');
const {readStableLocalFile}=require('./os-vault.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[a-f0-9]{40}$/;
const LEASE=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ORIGIN=/^https:\/\/[a-z0-9.-]+(?::443)?$/i;
const fail=code=>{throw Error(code);};
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const {safeScopedPath:safeScope}=require('./worker-scoped-path.cjs');
function assertDirectory(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))fail('WORKER_LOCAL_PATH_INVALID');
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())fail('WORKER_LOCAL_PATH_UNTRUSTED');
  return fs.realpathSync(dir);
}
// Windows Git reports canonical paths with different separators and casing.
// Both values MUST resolve to the same real on-disk directory; never compare
// merely normalized user input or accept paths that do not exist.
function sameRealDirectory(a,b){
  try{
    const x=fs.realpathSync.native(a),y=fs.realpathSync.native(b);
    const norm=p=>process.platform==='win32'?
      path.normalize(p).toLocaleLowerCase('en-US'):path.normalize(p);
    return norm(x)===norm(y);
  }catch{return false;}
}
function atomic(file,data,{exclusive=false}={}){
  const target=path.dirname(file);
  assertDirectory(target);
  if(exclusive){
    const fd=fs.openSync(file,'wx',0o600);
    try{fs.writeSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }else{
    const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomUUID();
    const fd=fs.openSync(tmp,'wx',0o600);
    try{fs.writeSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(tmp,file);
  }
}
function recordFile(dir,ticketId,kind){
  if(!ID.test(ticketId)||!['claim','receipt'].includes(kind))fail('WORKER_LOCAL_RECORD_INVALID');
  return path.join(dir,kind+'_'+ticketId+'.json');
}
function readRecord(file){
  let raw;
  try{raw=readEvidenceBytes(file,{minBytes:1,maxBytes:8192});}
  catch{fail('WORKER_LOCAL_RECORD_UNTRUSTED');}
  let obj;
  try{obj=JSON.parse(raw.toString('utf8'));}
  catch{fail('WORKER_LOCAL_RECORD_CORRUPT');}
  if(!obj||obj.schema!==1||!obj.context||!obj.body||
     !/^[a-f0-9]{64}$/.test(obj.sha256||'')||
     digest({schema:1,context:obj.context,body:obj.body})!==obj.sha256)
    fail('WORKER_LOCAL_RECORD_DIGEST_INVALID');
  return obj;
}
function validateTask(t,agentId,ticketId){
  if(!t||t.ticket_id!==ticketId||!ID.test(t.project_id||'')||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t.repository||'')||
    !/^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(t.branch_name||'')||
    t.branch_name.includes('..')||t.branch_name.endsWith('.lock')||
    !SHA.test(t.baseline_sha||'')||
    !['LOW','MEDIUM','HIGH','CORE'].includes(t.risk)||
    !Number.isSafeInteger(t.version)||t.version<1||
    !['READY','CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(t.status)||
    (t.status!=='READY'&&t.worker_agent_id!==agentId)||
    !Array.isArray(t.write_scopes)||t.write_scopes.length===0||
    t.write_scopes.length>30||t.write_scopes.some(s=>!safeScope(s))||
    new Set(t.write_scopes).size!==t.write_scopes.length)
    fail('WORKER_TASK_NOT_CLAIMABLE_OR_INVALID');
  return t;
}
// An existing nonempty hooksPath is not a disabled hooks directory.
// Refuse it without deleting evidence or running any contained hook.
function assertDisabledHooks(dir){
  assertDirectory(dir);
  if(fs.readdirSync(dir).length!==0)fail('WORKER_DISABLED_GIT_HOOKS_NOT_EMPTY');
}
function git(root,hooks,...args){
  assertDisabledHooks(hooks);
  const p=spawnSync('git',['-c','core.hooksPath='+hooks,'-c','core.fsmonitor=false','-C',root,...args],
    {encoding:'utf8',timeout:20000,maxBuffer:1024*1024,windowsHide:true});
  if(p.error||p.status!==0)fail('WORKER_TRUSTED_GIT_PREFLIGHT_FAILED');
  return p.stdout.trim();
}
function localWorktree({repoDir,t,workerDir,requireExisting=false}){
  const repo=assertDirectory(repoDir),workRoot=path.join(workerDir,'worktrees');
  const hookRoot=path.join(workerDir,'disabled-git-hooks');
  // A dangling worktree/hook directory alias is historical filesystem
  // evidence, not an empty directory. Never follow/create through it.
  if(!evidenceEntryPresent(workRoot))
    fs.mkdirSync(workRoot,{recursive:true,mode:0o700});
  if(!evidenceEntryPresent(hookRoot))
    fs.mkdirSync(hookRoot,{recursive:true,mode:0o700});
  assertDirectory(workRoot);assertDisabledHooks(hookRoot);
  if(!sameRealDirectory(git(repo,hookRoot,'rev-parse','--show-toplevel'),repo))
    fail('WORKER_REPOSITORY_ROOT_MISMATCH');
  let remote=git(repo,hookRoot,'remote','get-url','origin');
  // No embedded credentials, HTTP, non-GitHub remotes or URL redirects.
  remote=remote.replace(/\.git$/,'').replace(/^git@github\.com:/,'https://github.com/');
  if(remote!=='https://github.com/'+t.repository)
    fail('WORKER_REPOSITORY_ORIGIN_MISMATCH');
  if(git(repo,hookRoot,'cat-file','-t',t.baseline_sha)!=='commit')
    fail('WORKER_BASELINE_NOT_LOCAL_COMMIT');
  // Git LFS commonly installs global filter definitions even when no file
  // uses them; blanket rejection breaks every stock Git for Windows install.
  // Instead inspect effective attributes for *every tracked file* at the
  // exact immutable approved baseline, including nested .gitattributes and
  // local/global attributes. Git check-attr does not run smudge programs.
  assertDisabledHooks(hookRoot);
  const tree=spawnSync('git',['-c','core.hooksPath='+hookRoot,'-c','core.fsmonitor=false','-C',repo,
    'ls-tree','-r','--name-only','-z',t.baseline_sha],
    {encoding:null,timeout:15000,maxBuffer:2*1024*1024,windowsHide:true});
  if(tree.error||tree.status!==0||!Buffer.isBuffer(tree.stdout)||
     tree.stdout.length===0||tree.stdout.length>2*1024*1024)
    fail('WORKER_GIT_FILE_INVENTORY_UNTRUSTED');
  const paths=tree.stdout;
  assertDisabledHooks(hookRoot);
  const attr=spawnSync('git',['-c','core.hooksPath='+hookRoot,'-c','core.fsmonitor=false','-C',repo,
    'check-attr','--source='+t.baseline_sha,'--all','-z','--stdin'],
    {input:paths,encoding:null,timeout:20000,maxBuffer:4*1024*1024,windowsHide:true});
  if(attr.error||attr.status!==0||!Buffer.isBuffer(attr.stdout)||
     attr.stdout.length>4*1024*1024)
    fail('WORKER_GIT_ATTRIBUTES_UNREADABLE');
  const fields=attr.stdout.toString('utf8').split('\0');
  if(fields[fields.length-1]!=='')fail('WORKER_GIT_ATTRIBUTES_UNREADABLE');
  for(let n=0;n<fields.length-1;n+=3){
    if(n+2>=fields.length-1)fail('WORKER_GIT_ATTRIBUTES_UNREADABLE');
    const name=fields[n+1],value=fields[n+2];
    if((name==='filter'||name==='working-tree-encoding')&&
      value!=='unset'&&value!=='unspecified')
      fail('WORKER_ACTIVE_GIT_FILTER_REQUIRES_OWNER_REVIEW');
  }
  const target=path.join(workRoot,t.ticket_id);
  if(evidenceEntryPresent(target)){
    const actual=assertDirectory(target);
    if(!sameRealDirectory(actual,target)||
      !sameRealDirectory(git(target,hookRoot,'rev-parse','--show-toplevel'),actual)||
      git(target,hookRoot,'branch','--show-current')!==t.branch_name||
      git(target,hookRoot,'merge-base','HEAD',t.baseline_sha)!==t.baseline_sha)
      fail('WORKER_EXISTING_WORKTREE_MISMATCH');
  }else{
    if(requireExisting)fail('WORKER_PROVIDER_WORKTREE_MISSING');
    // No remote interaction. If the branch exists elsewhere, never overwrite.
    assertDisabledHooks(hookRoot);
    const branch=spawnSync('git',['-c','core.hooksPath='+hookRoot,'-c','core.fsmonitor=false',
      '-C',repo,'show-ref','--verify','--quiet','refs/heads/'+t.branch_name],
      {timeout:10000,windowsHide:true});
    if(branch.error||![0,1].includes(branch.status)||branch.status===0)
      fail('WORKER_BRANCH_ALREADY_EXISTS_OR_UNCERTAIN');
    assertDisabledHooks(hookRoot);
    const added=spawnSync('git',['-c','core.hooksPath='+hookRoot,'-c','core.fsmonitor=false',
      '-C',repo,'worktree','add','-b',t.branch_name,target,t.baseline_sha],
      {encoding:'utf8',timeout:30000,maxBuffer:128*1024,windowsHide:true});
    if(added.error||added.status!==0)
      fail('WORKER_GIT_WORKTREE_CREATION_UNCERTAIN');
    if(!sameRealDirectory(assertDirectory(target),target)||
      git(target,hookRoot,'branch','--show-current')!==t.branch_name||
      git(target,hookRoot,'rev-parse','HEAD')!==t.baseline_sha)
      fail('WORKER_CREATED_WORKTREE_UNVERIFIED');
  }
  return {repository_dir:repo,worktree:target};
}
async function boundedJson(response,maxBytes=16384){
  const rawLength=response.headers?.get('content-length');
  if(rawLength&&Number(rawLength)>maxBytes)fail('WORKER_CENTRAL_RESPONSE_TOO_LARGE');
  if(!response.body?.getReader)fail('WORKER_CENTRAL_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks=[];
  let total=0;
  try{
    while(true){
      const v=await reader.read();
      if(v.done)break;
      total+=v.value.byteLength;
      if(total>maxBytes)fail('WORKER_CENTRAL_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(v.value));
    }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{fail('WORKER_CENTRAL_RESPONSE_INVALID');}
}
async function signedRequest({origin,signer,method,uri,agentId,payload,fetcher}){
  let headers,body;
  if(method==='GET'&&uri==='/v7/cluster/state'){
    headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});body=undefined;
  }else if(method==='POST'&&['claim','resume-check','renew-lease','checkpoint','submit','provider-attempt','plan-batch-preview','plan-batch','plan-batch-receipt','plan-batch-projects','plan-batch-project'].includes(uri)){
    const prepared=signer.signWorkerAction({operation:uri,agent_id:agentId,payload});
    headers=prepared.headers;body=prepared.body;uri=prepared.uri;
  }else fail('WORKER_REQUEST_NOT_ALLOWLISTED');
  const response=await fetcher(origin+uri,{
    method,headers:{...headers,Accept:'application/json',
      ...(method==='POST'?{'content-type':'application/json'}:{})},
    body,cache:'no-store',credentials:'omit',redirect:'error',
    signal:AbortSignal.timeout(15000)
  });
  const data=await boundedJson(response,uri.startsWith('/v7/tasks/plan-batch')?96*1024:16384);
  if(!response.ok){
    const code=typeof data?.error_code==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(data.error_code)
      ?data.error_code:'CENTRAL_REQUEST_FAILED';
    fail('WORKER_'+code);
  }
  return data;
}
function confirmResume(local,proof){
  if(!proof||proof.resume_allowed!==true||
    proof.automatic_execution_allowed!==false||
    !['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(proof.status)||
    proof.agent_id!==local.agent_id||proof.ticket_id!==local.ticket_id||
    proof.epoch!==local.epoch||proof.project_id!==local.project_id||
    proof.repository!==local.repository||proof.branch_name!==local.branch_name||
    proof.baseline_sha!==local.baseline_sha||
    JSON.stringify([...(Array.isArray(proof.write_scopes)?proof.write_scopes:[])].sort())!==
      JSON.stringify([...local.scopes].sort()))
    fail('WORKER_CENTRAL_RESUME_MISMATCH');
}
function context(t,agentId,epoch,work){
  return {agent_id:agentId,ticket_id:t.ticket_id,project_id:t.project_id,
    repository:t.repository,branch_name:t.branch_name,
    baseline_sha:t.baseline_sha,scopes:[...t.write_scopes],
    repository_dir:work.repository_dir,worktree:work.worktree,epoch};
}
async function claimApprovedTask({origin,agentId,ticketId,repoDir,dir,signer,fetcher=fetch}){
  if(!ORIGIN.test(origin||'')||!ID.test(agentId||'')||!ID.test(ticketId||'')||
    !dir||!path.isAbsolute(dir)||!signer||typeof signer.signWorkerAction!=='function')
    fail('WORKER_CLAIM_INPUT_DENIED');
  assertDirectory(dir);
  const t=validateTask((await inspectWorkerTasks({
    origin,agentId,ticketId,signer,fetcher
  })).task,agentId,ticketId);
  const cluster=await signedRequest({origin,signer,method:'GET',
    uri:'/v7/cluster/state',agentId,fetcher});
  if(cluster.phase!=='READY'||cluster.paused!==false||
    !Number.isSafeInteger(cluster.epoch)||cluster.epoch<1||
    !ID.test(cluster.master_agent_id||''))
    fail('WORKER_CLAIM_MASTER_NOT_READY');
  const work=localWorktree({repoDir,t,workerDir:dir});
  const ctx=context(t,agentId,cluster.epoch,work);
  const file=recordFile(dir,ticketId,'claim'),receiptFile=recordFile(dir,ticketId,'receipt');
  if(evidenceEntryPresent(receiptFile))
    fail('WORKER_EXISTING_RECEIPT_REQUIRES_RESUME');
  let body;
  if(evidenceEntryPresent(file)){
    const previous=readRecord(file);
    body=previous.body;
    if(JSON.stringify(previous.context)!==JSON.stringify(ctx)||
      body.agent_id!==agentId||body.ticket_id!==ticketId||
      !ID.test(body.request_id||'')||!body.request_id.startsWith('claim_')||
      !Number.isSafeInteger(body.expected_version)||body.expected_version<1||
      body.expected_master_epoch!==ctx.epoch||
      !['READY','CLAIMED'].includes(t.status)||
      (t.status==='CLAIMED'&&t.worker_agent_id!==agentId))
      fail('WORKER_PENDING_CLAIM_RECONCILIATION_REQUIRED');
  }else{
    if(t.status!=='READY')fail('WORKER_CLAIM_NOT_READY');
    body={request_id:'claim_'+crypto.randomUUID().replace(/-/g,''),
      agent_id:agentId,ticket_id:ticketId,expected_version:t.version,
      expected_master_epoch:cluster.epoch};
    const core={schema:1,context:ctx,body};
    atomic(file,JSON.stringify({...core,sha256:digest(core)})+'\n',{exclusive:true});
  }
  // Ambiguous network response must retain local journal + worktree intact.
  const result=await signedRequest({origin,signer,method:'POST',
    uri:'claim',agentId,payload:body,fetcher});
  if(result.accepted!==true||result.ticket_id!==ticketId||
    !LEASE.test(result.lease_id||'')||result.epoch!==cluster.epoch||
    result.lease_seconds!==600||
    JSON.stringify([...(Array.isArray(result.write_scopes)?result.write_scopes:[])].sort())!==
      JSON.stringify([...ctx.scopes].sort()))
    fail('WORKER_CLAIM_RECEIPT_INVALID');
  const local={...ctx,lease_id:result.lease_id,
    claim_request_id:body.request_id};
  const receiptCore={schema:1,context:ctx,body:local};
  // A previously created/dangling receipt is irreversible recovery evidence.
  // Never rename-overwrite it if a second process races this earlier preflight.
  atomic(receiptFile,JSON.stringify({...receiptCore,sha256:digest(receiptCore)})+'\n',
    {exclusive:true});
  const proof=await signedRequest({origin,signer,method:'POST',uri:'resume-check',
    agentId,payload:{agent_id:agentId,ticket_id:ticketId,
      lease_id:local.lease_id,expected_master_epoch:ctx.epoch},fetcher});
  confirmResume(ctx,proof);
  fs.unlinkSync(file);
  return {ticket_id:ticketId,agent_id:agentId,worktree:work.worktree,
    epoch:ctx.epoch,lease_seconds:600,resume_allowed:true,
    automatic_execution_allowed:false,git_push_allowed:false};
}
// Only Electron MAIN can use this internal contract. The local claim receipt
// is sealed against accidental mutations; Central still independently decides
// whether the original lease is live and authoritative.
function loadWorkerReceipt(dir,agentId,ticketId){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!ID.test(agentId||'')||
     !ID.test(ticketId||''))fail('WORKER_LOCAL_RECEIPT_INPUT_INVALID');
  assertDirectory(dir);
  const record=readRecord(recordFile(dir,ticketId,'receipt'));
  const local=record.body,c=record.context;
  if(local.agent_id!==agentId||local.ticket_id!==ticketId||
     local.epoch!==c.epoch||!Number.isSafeInteger(local.epoch)||local.epoch<1||
     local.project_id!==c.project_id||local.repository!==c.repository||
     local.branch_name!==c.branch_name||local.baseline_sha!==c.baseline_sha||
     local.worktree!==c.worktree||local.repository_dir!==c.repository_dir||
     JSON.stringify(local.scopes)!==JSON.stringify(c.scopes)||
     !Array.isArray(local.scopes)||local.scopes.length===0||
     !local.scopes.every(safeScope)||!LEASE.test(local.lease_id||'')||
     !ID.test(local.claim_request_id||'')||
     !local.claim_request_id.startsWith('claim_'))
    fail('WORKER_LOCAL_RECEIPT_MISMATCH');
  return local;
}
async function resumeApprovedTask({origin,agentId,ticketId,dir,signer,fetcher=fetch}){
  if(!ORIGIN.test(origin||'')||!ID.test(agentId||'')||!ID.test(ticketId||'')||
     !path.isAbsolute(dir||''))fail('WORKER_RESUME_INPUT_DENIED');
  const local=loadWorkerReceipt(dir,agentId,ticketId);
  const proof=await signedRequest({origin,signer,method:'POST',uri:'resume-check',
    agentId,payload:{agent_id:agentId,ticket_id:ticketId,
      lease_id:local.lease_id,expected_master_epoch:local.epoch},fetcher});
  confirmResume(local,proof);
  const work=localWorktree({repoDir:local.repository_dir,
    t:{...local,write_scopes:local.scopes},workerDir:dir});
  if(work.worktree!==local.worktree)fail('WORKER_RESUME_WORKTREE_MISMATCH');
  return {ticket_id:ticketId,agent_id:agentId,worktree:work.worktree,
    epoch:local.epoch,status:proof.status,resume_allowed:true,
    automatic_execution_allowed:false,git_push_allowed:false};
}
// No renderer-supplied request body or signing oracle: construct the exact
// command from a locally sealed receipt, fresh signed Central observations,
// and a digest previously reviewed by the operator. Never send provider data.
async function recordProviderAttempt({origin,agentId,ticketId,dir,signer,action,provider,
  reviewedDigest,reviewedRegistryVersion,reviewedBindingDigest,attemptId,fetcher=fetch,beforeMutation=()=>{}}){
  if(!ORIGIN.test(origin||'')||!['BEGIN','INTERRUPT','CLOSE'].includes(action))
    fail('WORKER_PROVIDER_ATTEMPT_INPUT_DENIED');
  const local=loadWorkerReceipt(dir,agentId,ticketId);
  const detail=async()=>(await inspectWorkerTasks({origin,agentId,ticketId,signer,fetcher})).task;
  const proof=await signedRequest({origin,signer,method:'POST',uri:'resume-check',agentId,
    payload:{agent_id:agentId,ticket_id:ticketId,lease_id:local.lease_id,expected_master_epoch:local.epoch},fetcher});
  confirmResume(local,proof);
  if(proof.lease_id!==local.lease_id)fail('WORKER_PROVIDER_LEASE_MISMATCH');
  // Unlike claim preparation, recovery must never recreate a missing worktree.
  if(!evidenceEntryPresent(local.worktree))fail('WORKER_PROVIDER_WORKTREE_MISSING');
  const work=localWorktree({repoDir:local.repository_dir,t:{...local,write_scopes:local.scopes},workerDir:dir,requireExisting:true});
  if(work.worktree!==local.worktree)fail('WORKER_PROVIDER_WORKTREE_MISMATCH');
  const task=await detail();
  if(task.worker_agent_id!==agentId||task.project_id!==local.project_id||
     task.repository!==local.repository||task.baseline_sha!==local.baseline_sha||
     task.branch_name!==local.branch_name||
     JSON.stringify([...task.write_scopes].sort())!==JSON.stringify([...local.scopes].sort()))
    fail('WORKER_PROVIDER_TASK_MISMATCH');
  const cp=task.latest_checkpoint,previous=task.provider_attempt;
  const body={action,request_id:'provider_'+crypto.randomUUID().replace(/-/g,''),
    agent_id:agentId,ticket_id:ticketId,lease_id:local.lease_id,expected_master_epoch:local.epoch};
  if(action==='BEGIN'){
    if(task.status!=='CHECKPOINTED'||task.provider_mapping_source!=='MYSQL_OWNER_REGISTRY'||!cp||
       !proof.latest_checkpoint||Number(proof.latest_checkpoint.generation)!==cp.generation||
       proof.latest_checkpoint.content_sha256!==cp.content_sha256)
      fail('WORKER_PROVIDER_CHECKPOINT_REQUIRED');
    const preview=compactWorkerContext(task,agentId);
    const mapping=task.provider_mappings.find(m=>m.provider===provider);
    if(!mapping||typeof reviewedDigest!=='string'||reviewedDigest!==preview.context_sha256)
      fail('WORKER_PROVIDER_REVIEWED_CONTEXT_CHANGED');
    if(reviewedRegistryVersion!==task.provider_registry_version||reviewedBindingDigest!==mapping.binding_sha256)
      fail('WORKER_PROVIDER_REVIEWED_MAPPING_CHANGED');
    Object.assign(body,{provider,registry_version:task.provider_registry_version,
      binding_sha256:mapping.binding_sha256,expected_task_version:task.version,checkpoint_generation:cp.generation,
      checkpoint_sha256:cp.content_sha256,context_sha256:preview.context_sha256});
  }else{
    if(!previous||previous.attempt_id!==attemptId||previous.state==='CLOSED'||
       (action==='INTERRUPT'&&previous.state!=='OPEN'))fail('WORKER_PROVIDER_ATTEMPT_STATE_MISMATCH');
    body.attempt_id=attemptId;
    if(action==='CLOSE'){
      if(task.status!=='CHECKPOINTED'||!cp||cp.generation<=previous.checkpoint_generation||
         !proof.latest_checkpoint||Number(proof.latest_checkpoint.generation)!==cp.generation||
         proof.latest_checkpoint.content_sha256!==cp.content_sha256||
         crypto.createHash('sha256').update(cp.summary+'\n'+cp.next_action).digest('hex')!==cp.content_sha256)
        fail('WORKER_PROVIDER_FRESH_CHECKPOINT_REQUIRED');
      Object.assign(body,{external_session_reviewed:true,worktree_reviewed:true});
    }
  }
  // Final local fence after all asynchronous observations.
  beforeMutation();
  try{
    const result=await signedRequest({origin,signer,method:'POST',uri:'provider-attempt',agentId,payload:body,fetcher});
    const expected=action==='BEGIN'?'OPEN':action==='INTERRUPT'?'INTERRUPTED':'CLOSED';
    const x=result?.attempt;
    if(result?.accepted!==true||result.provider_sent!==false||result.provider_mapping_verified!==false||
       result.automatic_execution_allowed!==false||!x||x.ticket_id!==ticketId||x.agent_id!==agentId||
       x.lease_id!==local.lease_id||x.epoch!==local.epoch||x.state!==expected||
       typeof x.attempt_id!=='string'||!/^attempt_[a-f0-9]{32}$/.test(x.attempt_id)||
       (action==='BEGIN'&&(x.context_sha256!==body.context_sha256||x.provider!==body.provider||
         x.registry_version!==body.registry_version||x.binding_sha256!==body.binding_sha256||
         x.checkpoint_generation!==body.checkpoint_generation||x.checkpoint_sha256!==body.checkpoint_sha256))||
       (action!=='BEGIN'&&x.attempt_id!==attemptId))
      fail('WORKER_PROVIDER_RECEIPT_INVALID');
    const latest=await detail(),y=latest.provider_attempt;
    if(!y||y.attempt_id!==x.attempt_id||y.state!==expected||y.provider!==x.provider||
       y.registry_version!==x.registry_version||y.context_sha256!==x.context_sha256||
       y.checkpoint_generation!==x.checkpoint_generation||y.resolution!==x.resolution||
       (expected==='CLOSED'&&y.resolution!=='WORKER_CHECKPOINT'))
      fail('WORKER_PROVIDER_READBACK_REQUIRED');
    return {ticket_id:ticketId,agent_id:agentId,attempt:y,
      provider_sent:false,automatic_execution_allowed:false,provider_mapping_verified:false};
  }catch{fail('WORKER_PROVIDER_OUTCOME_UNCERTAIN_INSPECT_CURRENT_TASK_NO_RETRY');}
}
// Main-process planning review. The renderer cannot choose a signing URL,
// provide an epoch for admission, or replace the reviewed payload at commit.
function validateBatchReceipt(reply,body,{preview=false,historical=false}={}){
  if(!reply||reply.project_id!==body.project_id||reply.request_id!==body.request_id||
     !Number.isSafeInteger(reply.epoch)||reply.epoch<1||
     (!historical&&reply.epoch!==body.expected_master_epoch)||
     reply.automatic_execution_allowed!==false||reply.semantic_discovery_verified!==false||
     reply.baseline_verified!==false||typeof reply.preview_sha256!=='string'||
     !/^[a-f0-9]{64}$/.test(reply.preview_sha256)||
     (!preview&&reply.preview_sha256!==body.preview_sha256)||
     (preview?reply.read_only!==true:reply.accepted!==true)||
     !Array.isArray(reply.plan_order)||reply.plan_order.length<2||reply.plan_order.length>10||
     !Array.isArray(reply.tickets)||reply.tickets.length!==reply.plan_order.length||
     new Set(reply.plan_order.map(x=>typeof x==='string'?x.toLowerCase():null)).size!==reply.plan_order.length)
    fail('WORKER_BATCH_RECEIPT_INVALID');
  const ids=body.tasks?.map(x=>x.ticket_id);
  if(ids&&JSON.stringify([...ids].sort())!==JSON.stringify([...reply.plan_order].sort()))
    fail('WORKER_BATCH_RECEIPT_INVALID');
  for(let i=0;i<reply.tickets.length;i++){
    const t=reply.tickets[i],id=reply.plan_order[i];
    if(typeof id!=='string'||!ID.test(id)||!t||t.ticket_id!==id||
       !['READY','WAITING_AUTHORIZATION'].includes(t.status)||t.version!==1||
       t.owner_approval_required!==(t.status==='WAITING_AUTHORIZATION'))
      fail('WORKER_BATCH_RECEIPT_INVALID');
    if(preview){
      const original=body.tasks.find(x=>x.ticket_id===id);
      if(!original||JSON.stringify(t.dependencies)!==JSON.stringify(original.dependencies)||
         JSON.stringify(t.write_scopes)!==JSON.stringify(original.write_scopes)||
         JSON.stringify(t.contract_keys)!==JSON.stringify([...original.contract_keys].sort()))
        fail('WORKER_BATCH_PREVIEW_DECLARATION_MISMATCH');
    }
  }
  // Keep only the known display fields, never echo arbitrary server data.
  return {project_id:reply.project_id,request_id:reply.request_id,epoch:reply.epoch,
    preview_sha256:reply.preview_sha256,plan_order:[...reply.plan_order],
    tickets:reply.tickets.map(t=>({ticket_id:t.ticket_id,status:t.status,version:1,
      owner_approval_required:t.owner_approval_required})),
    automatic_execution_allowed:false,semantic_discovery_verified:false,baseline_verified:false};
}
async function previewMasterBatch({origin,agentId,projectId,requestId,tasks,signer,fetcher=fetch,beforeMutation=()=>{}}){
  if(!ORIGIN.test(origin||'')||!ID.test(agentId||'')||!ID.test(projectId||'')||!ID.test(requestId||'')||
     !Array.isArray(tasks)||tasks.length<2||tasks.length>10||Buffer.byteLength(JSON.stringify(tasks),'utf8')>65536)
    fail('WORKER_BATCH_INPUT_DENIED');
  const cluster=await signedRequest({origin,signer,method:'GET',uri:'/v7/cluster/state',agentId,fetcher});
  if(cluster?.phase!=='READY'||cluster.paused!==false||cluster.master_agent_id!==agentId||
     !Number.isSafeInteger(cluster.epoch)||cluster.epoch<1)fail('WORKER_BATCH_MASTER_NOT_READY');
  beforeMutation();
  const body={agent_id:agentId,project_id:projectId,request_id:requestId,
    expected_master_epoch:cluster.epoch,tasks:JSON.parse(JSON.stringify(tasks))};
  const reply=await signedRequest({origin,signer,method:'POST',uri:'plan-batch-preview',agentId,payload:body,fetcher});
  return {body,review:validateBatchReceipt(reply,body,{preview:true})};
}
async function commitMasterBatch({origin,agentId,prepared,signer,fetcher=fetch,beforeMutation=()=>{}}){
  if(!prepared||prepared.body?.agent_id!==agentId)fail('WORKER_BATCH_REVIEW_REQUIRED');
  const body={...prepared.body,preview_sha256:prepared.review.preview_sha256};
  beforeMutation();
  try{
    const reply=await signedRequest({origin,signer,method:'POST',uri:'plan-batch',agentId,payload:body,fetcher});
    const result=validateBatchReceipt(reply,body);
    if(JSON.stringify(result.plan_order)!==JSON.stringify(prepared.review.plan_order)||
       JSON.stringify(result.tickets)!==JSON.stringify(prepared.review.tickets))
      fail('WORKER_BATCH_RECEIPT_INVALID');
    return {...result,historical_receipt:true};
  }catch{fail('WORKER_BATCH_OUTCOME_UNCERTAIN_INSPECT_RECEIPT_NO_RETRY');}
}
function validateBatchCancellation(x,body,order=null){
  if(!x||Object.keys(x).sort().join('|')!=='agent_id|automatic_execution_allowed|epoch|owner_review_recorded|plan_order|preview_sha256|project_id|request_id|resolution_id|state'||
     x.agent_id!==body.agent_id||x.project_id!==body.project_id||x.request_id!==body.request_id||
     x.preview_sha256!==body.preview_sha256||x.state!=='ADMISSION_CANCELLED'||
     x.owner_review_recorded!==true||x.automatic_execution_allowed!==false||
     typeof x.resolution_id!=='string'||!/^batch_cancel_[a-f0-9]{32}$/.test(x.resolution_id)||
     !Number.isSafeInteger(x.epoch)||x.epoch<1||
     !Array.isArray(x.plan_order)||x.plan_order.length<2||x.plan_order.length>10||
     x.plan_order.some(id=>typeof id!=='string'||!ID.test(id)||/[\r\n]/.test(id))||
     new Set(x.plan_order.map(id=>id.toLowerCase())).size!==x.plan_order.length||
     (order&&JSON.stringify(x.plan_order)!==JSON.stringify(order)))
    fail('WORKER_BATCH_CANCELLATION_INVALID');
  return {...x};
}
async function inspectMasterBatchReceipt({origin,agentId,projectId,requestId,reviewedDigest,signer,fetcher=fetch}){
  if(!ORIGIN.test(origin||'')||typeof reviewedDigest!=='string'||reviewedDigest.length!==64||
     !/^[a-f0-9]{64}$/.test(reviewedDigest))fail('WORKER_BATCH_RECEIPT_INPUT_DENIED');
  const body={agent_id:agentId,project_id:projectId,request_id:requestId,preview_sha256:reviewedDigest};
  const reply=await signedRequest({origin,signer,method:'POST',uri:'plan-batch-receipt',agentId,payload:body,fetcher});
  if(reply?.read_only!==true||reply.historical_receipt!==true||reply.automatic_execution_allowed!==false)
    fail('WORKER_BATCH_RECEIPT_INVALID');
  if(reply.resolution){
    if(reply.receipt)fail('WORKER_BATCH_RECEIPT_INVALID');
    return {resolution:validateBatchCancellation(reply.resolution,body),historical_receipt:true,automatic_execution_allowed:false};
  }
  return {...validateBatchReceipt(reply.receipt,body,{historical:true}),historical_receipt:true};
}
async function listMasterProjects({origin,agentId,signer,fetcher=fetch,beforeMutation=()=>{}}){
  if(!ORIGIN.test(origin||'')||typeof agentId!=='string'||!ID.test(agentId)||/[\r\n]/.test(agentId))
    fail('WORKER_BATCH_INPUT_DENIED');
  const cluster=await signedRequest({origin,signer,method:'GET',uri:'/v7/cluster/state',agentId,fetcher});
  if(cluster?.phase!=='READY'||cluster.paused!==false||cluster.master_agent_id!==agentId||
     !Number.isSafeInteger(cluster.epoch)||cluster.epoch<1)fail('WORKER_BATCH_MASTER_NOT_READY');
  beforeMutation();
  const r=await signedRequest({origin,signer,method:'POST',uri:'plan-batch-projects',agentId,
    payload:{agent_id:agentId,expected_master_epoch:cluster.epoch},fetcher});
  if(r?.read_only!==true||r.agent_id!==agentId||r.epoch!==cluster.epoch||
     r.automatic_execution_allowed!==false||r.baseline_verified!==false||
     typeof r.truncated!=='boolean'||!Array.isArray(r.projects)||r.projects.length>100)
    fail('WORKER_BATCH_CATALOG_INVALID');
  const seen=new Set();
  const projects=r.projects.map(p=>{
    if(!p||Object.keys(p).sort().join('|')!=='base_branch|display_name|project_id|repository'||
       typeof p.project_id!=='string'||!ID.test(p.project_id)||/[\r\n]/.test(p.project_id)||
       seen.has(p.project_id.toLowerCase())||
       typeof p.display_name!=='string'||!p.display_name.trim()||p.display_name.length>170||
       typeof p.repository!=='string'||p.repository.length>190||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repository)||
       typeof p.base_branch!=='string'||p.base_branch.length>80||! /^[A-Za-z0-9._/-]+$/.test(p.base_branch))
      fail('WORKER_BATCH_CATALOG_INVALID');
    seen.add(p.project_id.toLowerCase());
    return {project_id:p.project_id,display_name:p.display_name,repository:p.repository,base_branch:p.base_branch};
  });
  return {projects,truncated:r.truncated,epoch:r.epoch,baseline_verified:false};
}

// Current signed project identity, independent of the capped catalog list.
async function lookupMasterProject({origin,agentId,projectId,signer,fetcher=fetch,beforeMutation=()=>{}}){
  const exactId=x=>typeof x==='string'&&ID.test(x)&&!/[\r\n]/.test(x);
  if(typeof origin!=='string'||!ORIGIN.test(origin)||!exactId(agentId)||!exactId(projectId))
    fail('MASTER_BASELINE_INPUT_DENIED');
  const cluster=await signedRequest({origin,signer,method:'GET',uri:'/v7/cluster/state',agentId,fetcher});
  if(cluster?.phase!=='READY'||cluster.paused!==false||cluster.master_agent_id!==agentId||
     !Number.isSafeInteger(cluster.epoch)||cluster.epoch<1)fail('WORKER_BATCH_MASTER_NOT_READY');
  beforeMutation();
  const r=await signedRequest({origin,signer,method:'POST',uri:'plan-batch-project',agentId,fetcher,
    payload:{agent_id:agentId,expected_master_epoch:cluster.epoch,project_id:projectId}});
  const p=r?.project;
  if(r?.read_only!==true||r.agent_id!==agentId||r.epoch!==cluster.epoch||
     r.automatic_execution_allowed!==false||r.baseline_verified!==false||!p||
     Object.keys(p).sort().join('|')!=='base_branch|display_name|project_id|repository'||
     p.project_id!==projectId||typeof p.display_name!=='string'||!p.display_name.trim()||p.display_name.length>170||
     typeof p.repository!=='string'||p.repository.length>190||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repository)||
     typeof p.base_branch!=='string'||p.base_branch.length>80||!/^[A-Za-z0-9._/-]+$/.test(p.base_branch))
    fail('MASTER_BASELINE_PROJECT_INVALID');
  return {project:{project_id:p.project_id,repository:p.repository,base_branch:p.base_branch},epoch:r.epoch};
}
// Local, read-only object/ref inspection. Never fetch, checkout, reset, run
// project commands, expose file contents or assert the remote ref is current.
function inspectMasterBaseline({repoDir,project}){
  if(!project||typeof project.project_id!=='string'||!ID.test(project.project_id)||
     typeof project.repository!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.repository)||
     typeof project.base_branch!=='string'||project.base_branch.length>80||
     !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(project.base_branch)||
     project.base_branch.includes('..')||project.base_branch.includes('//')||
     project.base_branch.endsWith('/')||project.base_branch.split('/').some(p=>p.startsWith('.')||p.endsWith('.lock')))
    fail('MASTER_BASELINE_PROJECT_INVALID');
  const repo=assertDirectory(repoDir);
  // Do not inherit Git overrides, injected configuration or replacement
  // objects. Disable all Git transport protocols (including lazy fetching).
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
  Object.assign(env,{GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'});
  const read=(...args)=>{
    const p=spawnSync('git',['--no-optional-locks','-c','protocol.allow=never','-c','core.fsmonitor=false',
      '-C',repo,...args],{env,encoding:'utf8',timeout:10000,maxBuffer:256*1024,windowsHide:true});
    if(p.error||p.status!==0||typeof p.stdout!=='string')fail('MASTER_BASELINE_LOCAL_GIT_READ_FAILED');
    return p.stdout.trim();
  };
  if(!sameRealDirectory(read('rev-parse','--show-toplevel'),repo))fail('MASTER_BASELINE_REPOSITORY_ROOT_MISMATCH');
  const urls=read('config','--local','--no-includes','--get-all','remote.origin.url').split(/\r?\n/);
  if(urls.length!==1||urls[0].replace(/\.git$/,'').replace(/^git@github\.com:/,'https://github.com/')!=='https://github.com/'+project.repository)
    fail('MASTER_BASELINE_REPOSITORY_ORIGIN_MISMATCH');
  const ref='refs/remotes/origin/'+project.base_branch;
  read('check-ref-format',ref);
  const sha=read('show-ref','--verify','--hash',ref);
  if(sha.length!==40||!SHA.test(sha)||read('cat-file','-t',sha)!=='commit')
    fail('MASTER_BASELINE_LOCAL_COMMIT_INVALID');
  const tree=read('rev-parse','--verify',sha+'^{tree}');
  if(tree.length!==40||!SHA.test(tree)||read('cat-file','-t',tree)!=='tree')
    fail('MASTER_BASELINE_LOCAL_TREE_INVALID');
  if(read('show-ref','--verify','--hash',ref)!==sha)fail('MASTER_BASELINE_REF_CHANGED');
  return {project_id:project.project_id,repository:project.repository,base_branch:project.base_branch,
    tracking_ref:ref,baseline_sha:sha,tree_sha:tree,local_tracking_ref_verified:true,
    remote_freshness_verified:false,baseline_verified:false,automatic_execution_allowed:false};
}
function requireMasterBaseline({tasks,observed,current}){
  if(!observed||!current||JSON.stringify(observed)!==JSON.stringify(current)||
     observed.local_tracking_ref_verified!==true||observed.remote_freshness_verified!==false||
     !Array.isArray(tasks)||tasks.length<2||tasks.length>10||
     tasks.some(t=>!t||t.baseline_sha!==observed.baseline_sha))
    fail('MASTER_BASELINE_CHANGED_OR_TASK_BASELINE_MISMATCH');
  // Internal dependencies can be order-only. Their future code is NOT
  // contained in the current immutable baseline; never claim otherwise.
  const ids=new Set(tasks.map(t=>t.ticket_id));
  return {local_tracking_ref_verified:true,remote_freshness_verified:false,
    internal_dependencies:tasks.flatMap(t=>(Array.isArray(t.dependencies)?t.dependencies:[])
      .filter(id=>ids.has(id)).map(id=>({ticket_id:t.ticket_id,depends_on:id}))),
    upstream_changes_in_baseline_verified:false,automatic_execution_allowed:false};
}

// Append-only encrypted admission evidence, one unresolved intent per PC.
// No private keys, arbitrary paths, automated replay or automatic deletion.
// A Windows filesystem power-cut guarantee still requires physical acceptance.
function createMasterBatchJournal({dir,safeStorage,nodeId}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||typeof nodeId!=='string'||!/^node_[a-f0-9]{32}$/.test(nodeId)||
     !safeStorage||safeStorage.isEncryptionAvailable()!==true||
     (typeof safeStorage.getSelectedStorageBackend==='function'&&safeStorage.getSelectedStorageBackend()==='basic_text'))
    fail('MASTER_BATCH_JOURNAL_ENCRYPTION_REQUIRED');
  if(!evidenceEntryPresent(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const folder=fs.lstatSync(dir);
  if(!folder.isDirectory()||folder.isSymbolicLink()||(process.platform!=='win32'&&(folder.mode&0o077)!==0))
    fail('MASTER_BATCH_JOURNAL_DIRECTORY_UNSAFE');
  const hash=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x);
  const exactId=x=>typeof x==='string'&&ID.test(x)&&!/[\r\n]/.test(x);
  const keyFor=x=>digest([nodeId,x.origin,x.body.agent_id,x.body.project_id,x.body.request_id]);
  function validateIntent(x,key){
    if(!x||Object.keys(x).sort().join('|')!=='body|node_id|origin|review|schema'||
       x.schema!==1||x.node_id!==nodeId||!ORIGIN.test(x.origin||'')||
       !x.body||Object.keys(x.body).sort().join('|')!=='agent_id|expected_master_epoch|project_id|request_id|tasks'||
       ![x.body.agent_id,x.body.project_id,x.body.request_id].every(exactId)||
       !Number.isSafeInteger(x.body.expected_master_epoch)||x.body.expected_master_epoch<1||
       !Array.isArray(x.body.tasks)||x.body.tasks.length<2||x.body.tasks.length>10||
       Buffer.byteLength(JSON.stringify(x.body.tasks),'utf8')>65536||
       !x.review||!hash(x.review.preview_sha256)||keyFor(x)!==key)
      fail('MASTER_BATCH_JOURNAL_INTENT_INVALID');
    // Reuse the exact receipt validation without treating it as a live grant.
    const v=validateBatchReceipt({...x.review,accepted:true}, {...x.body,preview_sha256:x.review.preview_sha256});
    if(JSON.stringify(v)!==JSON.stringify(x.review))fail('MASTER_BATCH_JOURNAL_REVIEW_INVALID');
    return x;
  }
  function read(kind,key){
    try{
      const ciphertext=readStableLocalFile(path.join(dir,kind+'_'+key+'.bin'),{maxBytes:65536});
      const envelope=JSON.parse(safeStorage.decryptString(ciphertext));
      if(!envelope||Object.keys(envelope).sort().join('|')!=='kind|payload|sha256'||
         envelope.kind!==kind||digest({kind,payload:envelope.payload})!==envelope.sha256)
        fail('MASTER_BATCH_JOURNAL_DIGEST_INVALID');
      return envelope.payload;
    }catch{fail('MASTER_BATCH_JOURNAL_CORRUPT_OWNER_REVIEW');}
  }
  function write(kind,key,payload){
    const sealed={kind,payload};
    const bytes=safeStorage.encryptString(JSON.stringify({...sealed,sha256:digest(sealed)}));
    if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>65536)
      fail('MASTER_BATCH_JOURNAL_TOO_LARGE_USE_SMALLER_BATCH');
    const file=path.join(dir,kind+'_'+key+'.bin');
    // Exclusive write; even partial evidence remains a blocking incident.
    const fd=fs.openSync(file,'wx',0o600);
    try{
      let offset=0;while(offset<bytes.length){
        const n=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
        if(!Number.isSafeInteger(n)||n<1)fail('MASTER_BATCH_JOURNAL_SHORT_WRITE');
        offset+=n;
      }
      fs.fsyncSync(fd);
    }finally{fs.closeSync(fd);}
    if(process.platform!=='win32'){
      const dfd=fs.openSync(dir,fs.constants.O_RDONLY|(fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
    }
  }
  function validatedReceipt(intent,r){
    if(r?.resolution){
      if(Object.keys(r).sort().join('|')!=='automatic_execution_allowed|historical_receipt|resolution'||
         r.historical_receipt!==true||r.automatic_execution_allowed!==false)
        fail('MASTER_BATCH_JOURNAL_RECEIPT_MISMATCH');
      return {resolution:validateBatchCancellation(r.resolution,
        {...intent.body,preview_sha256:intent.review.preview_sha256},intent.review.plan_order),
        historical_receipt:true,automatic_execution_allowed:false};
    }
    const v=validateBatchReceipt({...r,accepted:true}, {...intent.body,preview_sha256:intent.review.preview_sha256});
    if(JSON.stringify(v)!==JSON.stringify(intent.review)||r.historical_receipt!==true)
      fail('MASTER_BATCH_JOURNAL_RECEIPT_MISMATCH');
    return {...v,historical_receipt:true};
  }
  function pending(){
    const names=fs.readdirSync(dir);
    if(names.length>256||names.some(n=>! /^(intent|receipt)_[a-f0-9]{64}\.bin$/.test(n)))
      fail('MASTER_BATCH_JOURNAL_INVENTORY_OWNER_REVIEW');
    const set=new Set(names),open=[];
    for(const name of names){
      if(!name.startsWith('intent_')){
        if(!set.has(name.replace('receipt_','intent_')))fail('MASTER_BATCH_JOURNAL_ORPHAN_RECEIPT');
        continue;
      }
      const key=name.slice(7,-4),intent=validateIntent(read('intent',key),key);
      if(set.has('receipt_'+key+'.bin'))validatedReceipt(intent,read('receipt',key));
      else open.push({key,intent});
    }
    if(open.length>1)fail('MASTER_BATCH_JOURNAL_MULTIPLE_PENDING_OWNER_REVIEW');
    return open[0]||null;
  }
  function begin(origin,prepared){
    if(pending())fail('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
    const intent={schema:1,node_id:nodeId,origin,body:prepared.body,review:prepared.review};
    const key=keyFor(intent);
    validateIntent(intent,key);
    write('intent',key,intent);
    const saved=pending();
    if(!saved||saved.key!==key||JSON.stringify(saved.intent)!==JSON.stringify(intent))
      fail('MASTER_BATCH_JOURNAL_READBACK_REQUIRED');
    return saved;
  }
  function close(key,receipt){
    const saved=pending();
    if(!saved||saved.key!==key)fail('MASTER_BATCH_JOURNAL_PENDING_MISMATCH');
    const verified=validatedReceipt(saved.intent,receipt);
    write('receipt',key,verified);
    if(pending())fail('MASTER_BATCH_JOURNAL_CLOSE_UNCERTAIN');
    return verified;
  }
  return {pending,begin,close};
}
module.exports={assertDisabledHooks,claimApprovedTask,resumeApprovedTask,localWorktree,loadWorkerReceipt,signedRequest,confirmResume,recordProviderAttempt,previewMasterBatch,commitMasterBatch,inspectMasterBatchReceipt,listMasterProjects,lookupMasterProject,inspectMasterBaseline,requireMasterBaseline,createMasterBatchJournal};
