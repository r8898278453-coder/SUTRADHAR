/**
 * Guarded QA-PC GitHub branch publication (Windows packaged Electron MAIN).
 *
 * Requires an existing independently Owner-reviewed PASS, immutable bundle,
 * approved Central Git preflight, and an EXPLICIT Owner-enabled packaged
 * policy with Git-for-Windows Credential Manager already authenticated.
 *
 * One remote branch CREATE attempt ONLY. A durable local intent precedes
 * Central reservation. Any ambiguous HTTP/Git status requires Owner recovery,
 * NEVER automatic push retry. Never check out candidate onto host.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inspectWorkerTasks}=require('./worker-inspection.cjs');
const {inspectQAHandoff}=require('./qa-handoff.cjs');
const {verifiedLocal,readRecord}=require('./qa-evidence-submit.cjs');
const policyDefault=require('./git-publish-policy.json');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ORIGIN=/^https:\/\/[a-z0-9.-]+(?::443)?$/i;
const fail=code=>{throw Error(code);};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function journalEntryPresent(file,{io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||!io||
     typeof io.lstatSync!=='function')
    fail('GIT_PUBLISH_JOURNAL_PATH_INVALID');
  try{io.lstatSync(file);return true;}
  catch(error){
    if(error?.code==='ENOENT')return false;
    fail('GIT_PUBLISH_JOURNAL_INSPECTION_UNCERTAIN_OWNER_REVIEW');
  }
}
function validatePolicy(policy){
  if(!policy||policy.schema!==1||policy.enabled!==true||
     policy.credential_mode!=='GCM_PRECONFIGURED_NONINTERACTIVE'||
     typeof policy.git_exe!=='string'||!path.isAbsolute(policy.git_exe)||
     !/^git(?:\.exe)?$/i.test(path.basename(policy.git_exe))||
     !REPO.test(policy.allowed_repository||'')||
     Object.keys(policy).sort().join('|')!==
     ['schema','enabled','credential_mode','git_exe','allowed_repository'].sort().join('|'))
    fail('GIT_PUBLISH_OWNER_POLICY_DISABLED');
  const f=fs.lstatSync(policy.git_exe);
  if(!f.isFile()||f.isSymbolicLink())
    fail('GIT_PUBLISH_EXECUTABLE_UNTRUSTED');
  return policy;
}
function safeGitEnv(gitExe){
  // Never pass Central credentials or secrets to git/GCM subprocesses.
  // GCM may need OS user profile and protected credential store access.
  const allow=['SYSTEMROOT','SystemRoot','WINDIR','windir','HOME','USERPROFILE',
    'LOCALAPPDATA','APPDATA','PROGRAMDATA','TEMP','TMP','LANG','LC_ALL'];
  const env=Object.fromEntries(allow.filter(k=>typeof process.env[k]==='string')
    .map(k=>[k,process.env[k]]));
  const root=env.SystemRoot||env.SYSTEMROOT||'C:\\Windows';
  env.PATH=[path.dirname(gitExe),path.join(root,'System32')].join(path.delimiter);
  env.GIT_CONFIG_NOSYSTEM='1';
  env.GIT_CONFIG_GLOBAL='/dev/null';
  env.GIT_TERMINAL_PROMPT='0';
  env.GCM_INTERACTIVE='never';
  env.GIT_LFS_SKIP_SMUDGE='1';
  return env;
}
function execGit({gitExe,args,runner=spawnSync,input,timeout=25000}){
  const result=runner(gitExe,
    ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',
      '-c','protocol.ext.allow=never','-c','credential.helper=manager',...args],
    {encoding:'utf8',windowsHide:true,timeout,maxBuffer:32*1024,
      env:safeGitEnv(gitExe),input});
  if(result.error||result.status!==0||typeof result.stdout!=='string')
    fail('GIT_PUBLISH_REMOTE_COMMAND_FAILED_OR_UNCERTAIN');
  return result.stdout;
}
function refsFor(preflight){
  if(!preflight||!REPO.test(preflight.repository||'')||
     !/^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(preflight.branch||'')||
     !/^[A-Za-z0-9._/-]{1,80}$/.test(preflight.base_branch||'')||
     preflight.base_branch.includes('..')||
     preflight.base_branch.startsWith('/')||preflight.base_branch.endsWith('/')||
     !SHA.test(preflight.baseline_sha||''))
    fail('GIT_PUBLISH_REMOTE_REF_UNTRUSTED');
  return {url:'https://github.com/'+preflight.repository+'.git',
    destination:'refs/heads/'+preflight.branch,
    source:'refs/heads/'+preflight.base_branch};
}
function parseRefs(output,refs,baseline){
  const rows=output.trim()?output.trim().split(/\r?\n/):[];
  if(rows.length!==1)fail('GIT_PUBLISH_REMOTE_BRANCH_CHANGED_OR_UNCERTAIN');
  const match=/^([0-9a-f]{40})\t(refs\/heads\/[A-Za-z0-9._/-]+)$/.exec(rows[0]);
  if(!match||match[1]!==baseline||match[2]!==refs.source)
    fail('GIT_PUBLISH_REMOTE_BASELINE_CHANGED_OR_DESTINATION_EXISTS');
  return true;
}
function inspectRemote(preflight,{policy,runner}){
  const refs=refsFor(preflight);
  const output=execGit({gitExe:policy.git_exe,runner,args:[
    'ls-remote','--heads','--exit-code',refs.url,refs.source,refs.destination]});
  parseRefs(output,refs,preflight.baseline_sha);
  return refs;
}
function publicationPushArgs({head,destination,url}){
  if(!SHA.test(head||'')||!/^refs\/heads\/ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(destination||'')||
     typeof url!=='string'||!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(url))
    fail('GIT_PUBLISH_PUSH_ARGUMENTS_DENIED');
  // Empty old SHA means CAS: do not update an existing destination.
  // This is ONLY a new-ref creation lease, not a general force push.
  return ['push','--porcelain','--no-verify',
    '--force-with-lease='+destination+':',url,
    head+':'+destination];
}
function verifySingleCommit(bare,task,gitExe,runner){
  function read(...args){
    const output=execGit({gitExe,runner,args:['-C',bare,...args]});
    return output.trim();
  }
  if(!SHA.test(task.candidate_head_sha)||!SHA.test(task.candidate_tree_sha))
    fail('GIT_PUBLISH_CANDIDATE_INVALID');
  const parents=read('rev-list','--parents','-n','1',task.candidate_head_sha);
  if(parents!==task.candidate_head_sha+' '+task.baseline_sha)
    fail('GIT_PUBLISH_REQUIRES_SINGLE_COMMIT_OVER_BASELINE');
  if(read('rev-parse',task.candidate_head_sha+'^{tree}')!==task.candidate_tree_sha)
    fail('GIT_PUBLISH_TREE_CHANGED');
  const count=read('rev-list','--count',task.baseline_sha+'..'+task.candidate_head_sha);
  if(count!=='1')fail('GIT_PUBLISH_REQUIRES_SINGLE_COMMIT_OVER_BASELINE');
}
async function responseJson(response){
  if(!response.body?.getReader)fail('GIT_PUBLISH_CENTRAL_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.length;
      if(bytes>16*1024)fail('GIT_PUBLISH_CENTRAL_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{fail('GIT_PUBLISH_CENTRAL_RESPONSE_INVALID');}
}
async function signedGet({origin,agentId,uri,signer,fetcher}){
  const headers=signer.signWorkerReadOnly({method:'GET',uri,agent_id:agentId});
  const reply=await fetcher(origin+uri,{method:'GET',headers:{...headers,
    Accept:'application/json'},redirect:'error',credentials:'omit',
    cache:'no-store',signal:AbortSignal.timeout(12000)});
  const data=await responseJson(reply);
  if(!reply.ok)fail('GIT_PUBLISH_CENTRAL_PREFLIGHT_DENIED');
  return data;
}
async function signedPost({origin,agentId,operation,payload,signer,fetcher}){
  const post=signer.signWorkerAction({operation,agent_id:agentId,payload});
  const reply=await fetcher(origin+post.uri,{method:'POST',
    headers:{...post.headers,Accept:'application/json',
      'content-type':'application/json'},body:post.body,
    redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(15000)});
  const data=await responseJson(reply);
  if(!reply.ok)fail('GIT_PUBLISH_CENTRAL_'+
    (/^[A-Z_0-9]{2,80}$/.test(data?.error_code||'')?
      data.error_code:'REQUEST_DENIED'));
  return data;
}
function writeExclusive(file,body){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(body,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
function inspectLocalQa({origin,agentId,ticketId,dir,signer,fetcher}){
  return verifiedLocal({origin,agentId,ticketId,signer,dir,fetcher,
    allowReceiptReplay:true});
}
function strictPreflight(p,t,v,policy,agentId,ticketId){
  if(!p||p.preflight_ready!==true||p.one_shot!==true||
     p.automatic_push_allowed!==false||p.git_published!==false||
     p.merge_performed!==false||p.agent_id!==agentId||
     p.ticket_id!==ticketId||p.project_id!==t.project_id||
     p.repository!==t.repository||p.repository!==policy.allowed_repository||
     p.branch!==t.branch_name||p.baseline_sha!==t.baseline_sha||
     p.candidate_head_sha!==t.candidate_head_sha||
     p.candidate_tree_sha!==t.candidate_tree_sha||
     p.qa_evidence_sha256!==v.evidenceSha||
     !HASH.test(p.qa_evidence_sha256||'')||
     !Number.isSafeInteger(p.version)||p.version!==t.version||
     !Number.isSafeInteger(p.epoch)||p.epoch<1||
     typeof p.qa_receipt_id!=='string'||p.qa_receipt_id.length!==36||
     JSON.stringify([...(Array.isArray(p.write_scopes)?p.write_scopes:[])].sort())!==
       JSON.stringify([...t.write_scopes].sort()))
    fail('GIT_PUBLISH_CENTRAL_PREFLIGHT_MISMATCH');
  refsFor(p);
  return p;
}
function safeDir(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    fail('GIT_PUBLISH_JOURNAL_DIR_INVALID');
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('GIT_PUBLISH_JOURNAL_DIR_UNTRUSTED');
  return fs.realpathSync.native(dir);
}
async function publishReviewedCandidate({origin,agentId,ticketId,signer,
  bundlePath,repoDir,evidenceDir,policy=policyDefault,
  fetcher=fetch,gitRunner=spawnSync}){
  if(!ORIGIN.test(origin||'')||!ID.test(agentId||'')||
     !ID.test(ticketId||'')||!signer||
     typeof signer.signWorkerReadOnly!=='function'||
     typeof signer.signWorkerAction!=='function')
    fail('GIT_PUBLISH_INPUT_DENIED');
  const approved=validatePolicy(policy),dir=safeDir(evidenceDir);
  const intentPath=path.join(dir,'git_publish_'+ticketId+'_intent.json');
  const receiptPath=path.join(dir,'git_publish_'+ticketId+'_receipt.json');
  if(journalEntryPresent(intentPath)||journalEntryPresent(receiptPath))
    fail('GIT_PUBLISH_PREVIOUS_ATTEMPT_OWNER_RECONCILIATION');
  const v=await inspectLocalQa({origin,agentId,ticketId,signer,dir,fetcher});
  if(!v.report.test_passed||v.remote.status!=='INTEGRATING'||
     !journalEntryPresent(path.join(dir,'qa_central_receipt_'+ticketId+'_receipt.json')))
    fail('GIT_PUBLISH_REVIEWED_PASS_REQUIRED');
  const localReceipt=readRecord(path.join(dir,'qa_central_receipt_'+ticketId+'_receipt.json'));
  if(JSON.stringify(localReceipt.context)!==JSON.stringify(v.context))
    fail('GIT_PUBLISH_QA_RECEIPT_MISMATCH');
  const initial=await signedGet({origin,agentId,
    uri:'/v7/git/preflight/'+ticketId,signer,fetcher});
  strictPreflight(initial,v.remote,v,approved,agentId,ticketId);
  // ALL Git object checks happen in disposable bare quarantine. The trusted
  // local checkout stays at the baseline HEAD and is never mutated.
  return inspectQAHandoff({origin,agentId,ticketId,signer,bundlePath,repoDir,
    fetcher,mode:'PUBLISH',onVerifiedBare:async({bare,task,bundle_sha256})=>{
      if(bundle_sha256!==v.report.bundle_sha256||
         task.candidate_head_sha!==v.report.candidate_head_sha||
         task.candidate_tree_sha!==v.report.candidate_tree_sha)
        fail('GIT_PUBLISH_QA_BUNDLE_MISMATCH');
      verifySingleCommit(bare,task,approved.git_exe,gitRunner);
      const refs=inspectRemote(initial,{policy:approved,runner:gitRunner});
      const current=await signedGet({origin,agentId,
        uri:'/v7/git/preflight/'+ticketId,signer,fetcher});
      strictPreflight(current,task,v,approved,agentId,ticketId);
      if(JSON.stringify(current)!==JSON.stringify(initial))
        fail('GIT_PUBLISH_CENTRAL_PREFLIGHT_CHANGED');
      // fsync ONE-SHOT intent BEFORE Central reservation and before any push.
      // Every possible crash/unknown response keeps this journal and blocks
      // creating a second remote write.
      const requestId='gitreserve_'+crypto.randomUUID().replace(/-/g,'');
      const confirmId='gitconfirm_'+crypto.randomUUID().replace(/-/g,'');
      const intent={schema:1,state:'PUBLISH_REQUESTED_ONE_SHOT',
        requested_at:new Date().toISOString(),
        agent_id:agentId,ticket_id:ticketId,node_id:signer.snapshot().node_id,
        repository:task.repository,branch:task.branch_name,
        baseline_sha:task.baseline_sha,
        candidate_head_sha:task.candidate_head_sha,
        candidate_tree_sha:task.candidate_tree_sha,
        bundle_sha256,qa_evidence_sha256:v.evidenceSha,
        epoch:initial.epoch,version:initial.version,
        reserve_request_id:requestId,confirm_request_id:confirmId,
        automatic_retry_allowed:false,git_published_unverified:true};
      writeExclusive(intentPath,intent);
      const reserved=await signedPost({origin,agentId,operation:'git-reserve',
        signer,fetcher,payload:{request_id:requestId,agent_id:agentId,
          ticket_id:ticketId,expected_master_epoch:initial.epoch,
          expected_candidate_head_sha:task.candidate_head_sha,
          expected_candidate_tree_sha:task.candidate_tree_sha,
          expected_ticket_version:initial.version}});
      if(reserved.accepted!==true||reserved.one_shot!==true||
         reserved.ticket_id!==ticketId||reserved.repository!==task.repository||
         reserved.base_branch!==initial.base_branch||
         reserved.branch!==task.branch_name||
         reserved.baseline_sha!==task.baseline_sha||
         reserved.candidate_head_sha!==task.candidate_head_sha||
         reserved.candidate_tree_sha!==task.candidate_tree_sha||
         reserved.epoch!==initial.epoch)
        fail('GIT_PUBLISH_RESERVATION_UNCERTAIN');
      // One more remote read. If absent-ref/base changed after reservation,
      // STOP; a reserved task is NOT automatically re-queued for retry.
      inspectRemote(initial,{policy:approved,runner:gitRunner});
      const pushOutput=execGit({gitExe:approved.git_exe,runner:gitRunner,timeout:60000,
        args:['-C',bare,...publicationPushArgs({
          head:task.candidate_head_sha,destination:refs.destination,url:refs.url})]});
      // git push --porcelain returns EXIT 0 for an existing same-SHA ref
      // ([up to date]); this is NOT evidence of an absent-ref CREATE.
      // Only the exact new-ref porcelain marker is admissible. Central
      // independently verifies remote SHA/tree/parent after this witness.
      const marker=task.candidate_head_sha+':'+refs.destination;
      if(!pushOutput.split(/\r?\n/).some(line=>
        line.startsWith('*\t')&&line.includes('\t'+marker+'\t[new branch]')))
        fail('GIT_PUBLISH_NEW_REMOTE_REF_NOT_PROVEN');
      // Only Central may assert GitHub confirmation; it independently reads
      // immutable remote commit+tree/parent/changed files via GitHub API.
      const confirmed=await signedPost({origin,agentId,operation:'git-confirm',
        signer,fetcher,payload:{request_id:confirmId,agent_id:agentId,
          ticket_id:ticketId,expected_master_epoch:initial.epoch,
          expected_remote_head_sha:task.candidate_head_sha}});
      if(confirmed.accepted!==true||
         confirmed.status!=='PUSH_CONFIRMED_NOT_MERGED'||
         confirmed.ticket_id!==ticketId||
         confirmed.remote_head_sha!==task.candidate_head_sha||
         confirmed.tree_sha!==task.candidate_tree_sha)
        fail('GIT_PUBLISH_CONFIRMATION_UNCERTAIN');
      const receipt={schema:1,status:'PUSH_CONFIRMED_NOT_MERGED',
        ticket_id:ticketId,agent_id:agentId,
        candidate_head_sha:task.candidate_head_sha,
        candidate_tree_sha:task.candidate_tree_sha,
        remote_head_sha:confirmed.remote_head_sha,
        repository:task.repository,branch:task.branch_name,
        reserve_request_id:requestId,confirm_request_id:confirmId,
        evidence_sha256:v.evidenceSha,confirmed_at:new Date().toISOString(),
        draft_pr_created:false,merge_performed:false,
        production_deployed:false,automatic_retry_allowed:false};
      writeExclusive(receiptPath,receipt);
      return {...receipt,local_receipt_path:receiptPath};
    }});
}
module.exports={publishReviewedCandidate,validatePolicy,
  refsFor,parseRefs,publicationPushArgs,strictPreflight,verifySingleCommit,
  journalEntryPresent};
