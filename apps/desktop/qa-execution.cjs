/**
 * SUTRADHAR Windows Desktop independent QA: one-time, Docker-only, offline
 * execution of previously Central-verified Git objects.
 *
 * No code checkout onto host, no Docker build/pull, no arbitrary test command,
 * no QA receipt/approval, no Git publish and no protected repository writes.
 * Owner-provided image and absolute Docker CLI are disabled by default.
 */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {inspectQAHandoff}=require('./qa-handoff.cjs');
const {inspectWorkerTasks}=require('./worker-inspection.cjs');
const policyDefault=require('./qa-runner-policy.json');
const MAX_ARCHIVE=24*1024*1024,MAX_OUTPUT=256*1024,MAX_TREE=5000;
const SHA=/^[0-9a-f]{40}$/,HASH=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const fail=code=>{throw Error(code);};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function validPolicy(p){
  if(!p||p.schema!==1||p.enabled!==true||
    !HASH.test(p.image_sha256||'')||
    typeof p.docker_exe!=='string'||!path.isAbsolute(p.docker_exe)||
    !/docker(?:\.exe)?$/i.test(path.basename(p.docker_exe))||
    p.test_profile!=='PYTEST_TESTS_DIRECTORY')
    fail('QA_EXECUTION_OWNER_IMAGE_NOT_CONFIGURED');
  const st=fs.lstatSync(p.docker_exe);
  if(!st.isFile()||st.isSymbolicLink())
    fail('QA_EXECUTION_DOCKER_BINARY_UNTRUSTED');
  return p;
}
function sanitizedEnv(){
  // Docker CLI itself receives a minimal host environment: never inherit the
  // heartbeat agent's OS-vault, Central auth or Git credentials accidentally.
  const allow=['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','windir',
    'TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA',
    'PROGRAMDATA','LANG','LC_ALL'];
  return Object.fromEntries(allow.filter(k=>typeof process.env[k]==='string')
    .map(k=>[k,process.env[k]]));
}
function docker(exe,args,{input,timeout=20000,runner=spawnSync}={}){
  const p=runner(exe,args,{encoding:null,timeout,maxBuffer:MAX_OUTPUT,
    windowsHide:true,env:sanitizedEnv(),input});
  if(p.error)return {status:null,stdout:Buffer.alloc(0),
    stderr:Buffer.from(String(p.error.code||'DOCKER_ERROR')),error:true};
  return {status:p.status,stdout:Buffer.isBuffer(p.stdout)?p.stdout:Buffer.from(p.stdout||''),
    stderr:Buffer.isBuffer(p.stderr)?p.stderr:Buffer.from(p.stderr||''),error:false};
}
function dockerPreflight(p,runner){
  const image='sha256:'+p.image_sha256;
  const z=docker(p.docker_exe,['image','inspect','--format','{{.Id}}',image],{runner});
  if(z.error||z.status!==0||z.stdout.toString('utf8').trim()!==image)
    fail('QA_EXECUTION_PINNED_IMAGE_NOT_LOCAL');
  const d=docker(p.docker_exe,['info','--format','{{.ServerVersion}}'],{runner});
  if(d.error||d.status!==0||!d.stdout.toString('utf8').trim())
    fail('QA_EXECUTION_DOCKER_DAEMON_UNAVAILABLE');
  return image;
}
function git(bare,...args){
  const p=spawnSync('git',['-c','core.hooksPath=/dev/null',
    '-c','core.fsmonitor=false','-c','diff.external=',
    '-C',bare,...args],{encoding:null,timeout:30000,
      maxBuffer:MAX_ARCHIVE,windowsHide:true,
      env:{...Object.fromEntries(Object.entries(process.env)
        .filter(([k])=>!k.startsWith('GIT_'))),
        GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
        GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1'}});
  if(p.error||p.status!==0||!Buffer.isBuffer(p.stdout))
    fail('QA_EXECUTION_GIT_ARCHIVE_FAILED');
  return p.stdout;
}
function safeArchivePath(p){
  if(typeof p!=='string'||p.length<1||p.length>450||
    !/^[A-Za-z0-9._/-]+$/.test(p)||p.startsWith('/')||
    p.includes('//')||p.split('/').some(x=>!x||x==='.'||x==='..'))return false;
  const parts=p.toLowerCase().split('/'),last=parts.at(-1);
  if(parts.some(x=>['.git','.gitattributes','.gitmodules','.lfsconfig',
    'secrets','.sutradhar_state'].includes(x)))return false;
  if(last==='.env'||last.startsWith('.env.')&&last!=='.env.example'||
     /\.(pem|key|p12|pfx|sqlite|db)$/i.test(last))return false;
  return true;
}
function candidateArchive(bare,head){
  if(!SHA.test(head||''))fail('QA_EXECUTION_CANDIDATE_INVALID');
  const raw=git(bare,'ls-tree','-r','-z',head);
  const rows=raw.toString('utf8').split('\0');
  if(rows.at(-1)!==''||rows.length<2||rows.length-1>MAX_TREE)
    fail('QA_EXECUTION_TREE_UNTRUSTED');
  for(const row of rows.slice(0,-1)){
    const m=/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(row);
    if(!m||!safeArchivePath(m[2]))
      fail('QA_EXECUTION_TREE_UNSAFE_PATH_OR_MODE');
  }
  const archive=git(bare,'archive','--format=tar',head);
  if(archive.length===0||archive.length>MAX_ARCHIVE)
    fail('QA_EXECUTION_ARCHIVE_TOO_LARGE');
  return archive;
}
function privateDir(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    fail('QA_EXECUTION_EVIDENCE_DIR_INVALID');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('QA_EXECUTION_EVIDENCE_DIR_UNTRUSTED');
  return fs.realpathSync.native(dir);
}
function saveExclusive(file,data){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
function runContainer({p,image,archive,runner}){
  const name='sutradhar_qa_'+crypto.randomUUID().replace(/-/g,'');
  // Caller-chosen commands, paths, credentials, mounts, host namespace or
  // network flags are NEVER accepted; this is a fixed offline pytest profile.
  const command='umask 077; tar -xf - -C /workspace && '+
    'printf "__SUTRADHAR_QA_TEST_STARTED__\\n" && '+
    'python3 -B -m pytest -q tests';
  const args=['create','--name',name,'--pull','never','-i',
    '--network','none','--ipc','none','--read-only',
    '--memory','512m','--memory-swap','512m','--cpus','1.0',
    '--pids-limit','64','--cap-drop','ALL',
    '--security-opt','no-new-privileges:true',
    '--user','10001:10001',
    '--tmpfs','/workspace:rw,noexec,nosuid,size=64m,mode=1777',
    '--tmpfs','/tmp:rw,noexec,nosuid,size=32m,mode=1777',
    '--workdir','/workspace','--entrypoint','/bin/sh',image,
    '-c',command];
  const created=docker(p.docker_exe,args,{runner});
  if(created.error||created.status!==0||
     !/^[0-9a-f]{64}\s*$/.test(created.stdout.toString('utf8')))
    fail('QA_EXECUTION_CONTAINER_CREATE_FAILED');
  let output;
  let cleanupFailed=false;
  try{
    output=docker(p.docker_exe,['start','--attach','--interactive',name],
      {input:archive,timeout:75000,runner});
  }finally{
    const removed=docker(p.docker_exe,['rm','--force',name],
      {timeout:15000,runner});
    cleanupFailed=removed.error||removed.status!==0;
  }
  if(cleanupFailed)fail('QA_EXECUTION_DOCKER_CLEANUP_UNCERTAIN');
  const started=output.stdout.includes(Buffer.from('__SUTRADHAR_QA_TEST_STARTED__'));
  return {test_passed:!output.error&&output.status===0&&started,
    sandbox_started:started,exit_code:output.status,
    stdout_sha256:digest(output.stdout),stderr_sha256:digest(output.stderr),
    stdout_tail:output.stdout.toString('utf8').slice(-3000),
    stderr_tail:output.stderr.toString('utf8').slice(-3000)};
}
async function runIndependentQa({origin,agentId,ticketId,signer,bundlePath,
  repoDir,evidenceDir,fetcher=fetch,policy=policyDefault,
  dockerRunner=spawnSync,recoveryReviewOnly=false}){
  if(!ID.test(agentId||'')||!ID.test(ticketId||'')||
     typeof recoveryReviewOnly!=='boolean')
    fail('QA_EXECUTION_INPUT_INVALID');
  const p=validPolicy(policy),image=dockerPreflight(p,dockerRunner);
  const dir=privateDir(evidenceDir);
  const evidenceFile=path.join(dir,'qa_result_'+ticketId+'.json');
  const intentFile=path.join(dir,'qa_started_'+ticketId+'.json');
  if(fs.existsSync(intentFile)||fs.existsSync(evidenceFile))
    fail('QA_EXECUTION_PREVIOUS_ATTEMPT_OWNER_REVIEW');
  return inspectQAHandoff({origin,agentId,ticketId,signer,
    bundlePath,repoDir,fetcher,recoveryReviewOnly,
    onVerifiedBare:async({bare,task,bundle_sha256})=>{
      const archive=candidateArchive(bare,task.candidate_head_sha);
      // Durable exclusive execution intent BEFORE first possible Docker create.
      // A crash, ambiguous response or failing test is NOT automatically retried.
      saveExclusive(intentFile,{schema:1,state:'EXECUTION_REQUESTED',
        ticket_id:ticketId,qa_agent_id:agentId,
        candidate_head_sha:task.candidate_head_sha,
        candidate_tree_sha:task.candidate_tree_sha,
        bundle_sha256,image_sha256:p.image_sha256,
        requested_at:new Date().toISOString(),
        retry_allowed:false,qa_approved:false});
      const result=runContainer({p,image,archive,runner:dockerRunner});
      const latest=(await inspectWorkerTasks({origin,agentId,ticketId,
        signer,fetcher})).task;
      if(latest.status!==task.status||
         latest.candidate_head_sha!==task.candidate_head_sha||
         latest.candidate_tree_sha!==task.candidate_tree_sha||
         latest.worker_agent_id!==task.worker_agent_id||
         latest.baseline_sha!==task.baseline_sha||
         latest.repository!==task.repository||
         latest.branch_name!==task.branch_name||
         JSON.stringify(latest.write_scopes)!==JSON.stringify(task.write_scopes))
        fail('QA_EXECUTION_CENTRAL_CHANGED_OWNER_REVIEW');
      const evidence={schema:1,status:'LOCAL_QA_TEST_ONLY',
        ticket_id:ticketId,qa_agent_id:agentId,
        developer_agent_id:task.worker_agent_id,
        baseline_sha:task.baseline_sha,
        candidate_head_sha:task.candidate_head_sha,
        candidate_tree_sha:task.candidate_tree_sha,
        bundle_sha256,image_sha256:p.image_sha256,
        archive_sha256:digest(archive),
        recorded_at:new Date().toISOString(),...result,
        evidence_level:'LOCAL_UNATTESTED',
        qa_approved:false,qa_receipt_submitted:false,
        git_published:false,automatic_execution_allowed:false};
      saveExclusive(evidenceFile,evidence);
      return {...evidence,evidence_path:evidenceFile};
    }});
}
module.exports={runIndependentQa,candidateArchive,validPolicy,dockerPreflight};
