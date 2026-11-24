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
async function boundedJson(response){
  const rawLength=response.headers?.get('content-length');
  if(rawLength&&Number(rawLength)>16384)fail('WORKER_CENTRAL_RESPONSE_TOO_LARGE');
  if(!response.body?.getReader)fail('WORKER_CENTRAL_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks=[];
  let total=0;
  try{
    while(true){
      const v=await reader.read();
      if(v.done)break;
      total+=v.value.byteLength;
      if(total>16384)fail('WORKER_CENTRAL_RESPONSE_TOO_LARGE');
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
  }else if(method==='POST'&&['claim','resume-check','renew-lease','checkpoint','submit','provider-attempt'].includes(uri)){
    const prepared=signer.signWorkerAction({operation:uri,agent_id:agentId,payload});
    headers=prepared.headers;body=prepared.body;uri=prepared.uri;
  }else fail('WORKER_REQUEST_NOT_ALLOWLISTED');
  const response=await fetcher(origin+uri,{
    method,headers:{...headers,Accept:'application/json',
      ...(method==='POST'?{'content-type':'application/json'}:{})},
    body,cache:'no-store',credentials:'omit',redirect:'error',
    signal:AbortSignal.timeout(15000)
  });
  const data=await boundedJson(response);
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
module.exports={assertDisabledHooks,claimApprovedTask,resumeApprovedTask,localWorktree,loadWorkerReceipt,signedRequest,confirmResume,recordProviderAttempt};
