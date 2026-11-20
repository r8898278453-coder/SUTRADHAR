/**
 * Offline developer->QA candidate transport, INSPECTION ONLY.
 * Both roles query the authoritative Central task through OS-vault signed GET.
 * QA imports objects into a disposable, isolated bare repository and NEVER
 * checks out, executes, approves, publishes or mutates the trusted checkout.
 */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {inspectCommittedCandidate}=require('./worker-submit.cjs');
const {loadWorkerReceipt}=require('./worker-claim.cjs');
const {inspectWorkerTasks}=require('./worker-inspection.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BUNDLE=32*1024*1024;
const fail=code=>{throw Error(code);};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function realDirectory(p){
  if(typeof p!=='string'||!path.isAbsolute(p))fail('HANDOFF_DIRECTORY_INVALID');
  const st=fs.lstatSync(p);
  if(!st.isDirectory()||st.isSymbolicLink())fail('HANDOFF_DIRECTORY_UNTRUSTED');
  return fs.realpathSync.native(p);
}
function sameRealDirectory(a,b){
  try{
    const normal=x=>{
      const p=path.normalize(fs.realpathSync.native(x));
      return process.platform==='win32'?p.toLowerCase():p;
    };
    return normal(a)===normal(b);
  }catch{return false;}
}
function regularFile(p,max){
  if(typeof p!=='string'||!path.isAbsolute(p))fail('HANDOFF_FILE_PATH_INVALID');
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.size===0||st.size>max)
    fail('HANDOFF_FILE_UNTRUSTED_OR_TOO_LARGE');
  return st.size;
}
function shaFile(p){
  const size=regularFile(p,MAX_BUNDLE);
  const h=crypto.createHash('sha256'),fd=fs.openSync(p,'r');
  const bytes=Buffer.allocUnsafe(64*1024);
  try{
    let n;
    while((n=fs.readSync(fd,bytes,0,bytes.length,null))!==0)h.update(bytes.subarray(0,n));
    if(fs.fstatSync(fd).size!==size)fail('HANDOFF_BUNDLE_CHANGED');
  }finally{fs.closeSync(fd);}
  return {size,hash:h.digest('hex')};
}
function env(){
  const safe=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')));
  return {...safe,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1'};
}
function git(dir,...args){
  const p=spawnSync('git',['-c','core.hooksPath=/dev/null',
    '-c','core.fsmonitor=false','-c','diff.external=',
    '-c','protocol.ext.allow=never','-C',dir,...args],
  {encoding:null,timeout:30000,maxBuffer:2*1024*1024,windowsHide:true,env:env()});
  if(p.error||p.status!==0||!Buffer.isBuffer(p.stdout))fail('HANDOFF_GIT_OPERATION_FAILED');
  return p.stdout;
}
function text(dir,...args){return git(dir,...args).toString('utf8').trim();}
function checkedTask(task,agentId,ticketId,role){
  if(!task||task.ticket_id!==ticketId||!ID.test(ticketId||'')||
     !ID.test(agentId||'')||!ID.test(task.worker_agent_id||'')||
     !ID.test(task.project_id||'')||!REPO.test(task.repository||'')||
     !/^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(task.branch_name||'')||
     !SHA.test(task.baseline_sha||'')||!SHA.test(task.candidate_head_sha||'')||
     !SHA.test(task.candidate_tree_sha||'')||
     task.status!=='SUBMITTED_FOR_REVIEW'||
     (role==='EXPORT'?task.worker_agent_id!==agentId:task.worker_agent_id===agentId)||
     !Array.isArray(task.write_scopes)||task.write_scopes.length<1||
     task.write_scopes.length>30||
     task.write_scopes.some(s=>!safePath(s))||
     new Set(task.write_scopes).size!==task.write_scopes.length)
    fail('HANDOFF_CENTRAL_TASK_NOT_AUTHORIZED');
  return task;
}
function safePath(p){
  if(typeof p!=='string'||p.length===0||p.length>450||
     !/^[A-Za-z0-9._/-]+$/.test(p)||p.startsWith('/')||
     p.includes('//')||p.split('/').some(s=>!s||s==='.'||s==='..'))
    return false;
  return !p.toLowerCase().split('/').some(s=>
    ['.git','.gitattributes','.gitmodules','.lfsconfig'].includes(s));
}
function matchingTask(t,m){
  return t.ticket_id===m.ticket_id&&t.project_id===m.project_id&&
    t.repository===m.repository&&t.branch_name===m.branch_name&&
    t.baseline_sha===m.baseline_sha&&
    t.candidate_head_sha===m.candidate_head_sha&&
    t.candidate_tree_sha===m.candidate_tree_sha&&
    t.worker_agent_id===m.worker_agent_id&&
    JSON.stringify([...t.write_scopes].sort())===JSON.stringify([...m.write_scopes].sort());
}
function bundleRef(repo,bundle,shaExpected){
  const out=text(repo,'bundle','list-heads',bundle);
  if(out!==shaExpected+' HEAD')fail('HANDOFF_BUNDLE_HEAD_MISMATCH');
}
function outputPaths(p){
  if(typeof p!=='string'||!path.isAbsolute(p)||!p.endsWith('.bundle'))
    fail('HANDOFF_OUTPUT_INVALID');
  const parent=realDirectory(path.dirname(p));
  const bundle=path.join(parent,path.basename(p));
  const manifest=bundle+'.json';
  if(fs.existsSync(bundle)||fs.existsSync(manifest))fail('HANDOFF_OUTPUT_EXISTS');
  return {bundle,manifest,parent};
}
function writeExclusive(file,content){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
async function centralTask({origin,agentId,ticketId,signer,fetcher}){
  return (await inspectWorkerTasks({origin,agentId,ticketId,signer,fetcher})).task;
}
async function exportCandidateHandoff({origin,agentId,ticketId,dir,signer,
  bundlePath,fetcher=fetch}){
  if(!dir||!path.isAbsolute(dir))fail('HANDOFF_WORKER_DIR_INVALID');
  const local=loadWorkerReceipt(dir,agentId,ticketId);
  const candidate=inspectCommittedCandidate(local,dir);
  const remote=checkedTask(await centralTask({origin,agentId,ticketId,signer,fetcher}),
    agentId,ticketId,'EXPORT');
  if(!matchingTask(remote,{...local,worker_agent_id:agentId,
      write_scopes:local.scopes,candidate_head_sha:candidate.head,
      candidate_tree_sha:candidate.tree}))
    fail('HANDOFF_SOURCE_CENTRAL_MISMATCH');
  const o=outputPaths(bundlePath);
  const tmp=fs.mkdtempSync(path.join(o.parent,'.sutradhar-bundle-'));
  try{
    const created=path.join(tmp,'candidate.bundle');
    git(local.worktree,'bundle','create',created,'HEAD','^'+local.baseline_sha);
    bundleRef(local.worktree,created,candidate.head);
    const dig=shaFile(created);
    const m={schema:1,kind:'CENTRAL_CONFIRMED_CANDIDATE_BUNDLE',
      ticket_id:remote.ticket_id,project_id:remote.project_id,
      repository:remote.repository,branch_name:remote.branch_name,
      baseline_sha:remote.baseline_sha,
      candidate_head_sha:remote.candidate_head_sha,
      candidate_tree_sha:remote.candidate_tree_sha,
      worker_agent_id:remote.worker_agent_id,
      write_scopes:[...remote.write_scopes].sort(),bundle_size_bytes:dig.size,
      bundle_sha256:dig.hash,qa_approved:false,git_published:false};
    // Check Central again after writing the bundle; Central remains authority.
    const latest=checkedTask(await centralTask({origin,agentId,ticketId,signer,fetcher}),
      agentId,ticketId,'EXPORT');
    if(!matchingTask(latest,m))fail('HANDOFF_CENTRAL_CHANGED_DURING_EXPORT');
    fs.copyFileSync(created,o.bundle,fs.constants.COPYFILE_EXCL);
    const fd=fs.openSync(o.bundle,'r+');
    try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    writeExclusive(o.manifest,JSON.stringify(m,null,2)+'\n');
    return {bundle_path:o.bundle,manifest_path:o.manifest,
      ticket_id:ticketId,candidate_head_sha:candidate.head,
      candidate_tree_sha:candidate.tree,bundle_sha256:dig.hash,
      qa_approved:false,git_published:false,automatic_execution_allowed:false};
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
function readManifest(p){
  regularFile(p,8192);
  let m;
  try{m=JSON.parse(fs.readFileSync(p,'utf8'));}
  catch{fail('HANDOFF_MANIFEST_INVALID');}
  const keys=['schema','kind','ticket_id','project_id','repository','branch_name',
    'baseline_sha','candidate_head_sha','candidate_tree_sha','worker_agent_id',
    'write_scopes','bundle_size_bytes','bundle_sha256','qa_approved','git_published'];
  if(!m||Array.isArray(m)||Object.keys(m).sort().join('|')!==keys.sort().join('|')||
     m.schema!==1||m.kind!=='CENTRAL_CONFIRMED_CANDIDATE_BUNDLE'||
     m.qa_approved!==false||m.git_published!==false||
     !Number.isSafeInteger(m.bundle_size_bytes)||m.bundle_size_bytes<1||
     m.bundle_size_bytes>MAX_BUNDLE||!HASH.test(m.bundle_sha256||''))
    fail('HANDOFF_MANIFEST_INVALID');
  return m;
}
function trustedRepository(repoDir,remote){
  const repo=realDirectory(repoDir);
  if(!sameRealDirectory(text(repo,'rev-parse','--show-toplevel'),repo)||
     text(repo,'rev-parse','--is-bare-repository')!=='false')
    fail('HANDOFF_QA_REPO_NOT_ROOT');
  let origin=text(repo,'remote','get-url','origin');
  origin=origin.replace(/\.git$/,'').replace(/^git@github\.com:/,'https://github.com/');
  if(origin!=='https://github.com/'+remote.repository)
    fail('HANDOFF_QA_REPO_ORIGIN_MISMATCH');
  // Inspection fetches Git OBJECTS only; no working-tree files are opened.
  // Do not mistake CRLF differences under sanitized Windows global config for
  // altered trusted Git history. A future QA EXECUTION gate must separately
  // require a clean, isolated checkout before testing untrusted code.
  if(text(repo,'rev-parse','HEAD')!==remote.baseline_sha)
    fail('HANDOFF_QA_BASELINE_HEAD_MISMATCH');
  if(text(repo,'cat-file','-t',remote.baseline_sha)!=='commit')
    fail('HANDOFF_QA_BASELINE_MISSING');
  return repo;
}
function verifyHistory(bare,t){
  const head=t.candidate_head_sha,baseline=t.baseline_sha;
  if(text(bare,'cat-file','-t',head)!=='commit'||
     text(bare,'rev-parse',head+'^{tree}')!==t.candidate_tree_sha)
    fail('HANDOFF_QA_OBJECT_PROOF_MISMATCH');
  const ancestry=text(bare,'rev-list','--parents','--reverse',
    '--max-count=41',baseline+'..'+head).split('\n');
  if(ancestry.length<1||ancestry.length>40)
    fail('HANDOFF_QA_HISTORY_LIMIT');
  const commits=[];let last=baseline;
  for(const line of ancestry){
    const m=/^([a-f0-9]{40}) ([a-f0-9]{40})$/.exec(line);
    if(!m||m[2]!==last)fail('HANDOFF_QA_NONLINEAR_HISTORY');
    commits.push([m[2],m[1]]);last=m[1];
  }
  if(last!==head)fail('HANDOFF_QA_NONLINEAR_HISTORY');
  let count=0;const all=new Set();
  for(const [parent,commit] of commits){
    const raw=git(bare,'diff','--raw','-r','--no-renames','-z',parent,commit);
    if(!raw.length||raw.length>1024*1024)fail('HANDOFF_QA_DIFF_INVALID');
    const parts=raw.toString('utf8').split('\0');
    if(parts.at(-1)!==''||(parts.length-1)%2!==0)
      fail('HANDOFF_QA_DIFF_INVALID');
    for(let i=0;i<parts.length-1;i+=2){
      const meta=parts[i],file=parts[i+1];
      const mode=/^:(000000|100644) 100644 [a-f0-9]{4,64} [a-f0-9]{4,64} ([AM])$/.exec(meta);
      if(!mode||(mode[2]==='A'&&mode[1]!=='000000')||
         (mode[2]==='M'&&mode[1]!=='100644')||
         !safePath(file)||!t.write_scopes.some(s=>file===s||file.startsWith(s+'/')))
        fail('HANDOFF_QA_OUT_OF_SCOPE_HISTORY');
      if(++count>1200)fail('HANDOFF_QA_HISTORY_LIMIT');
      all.add(file);
    }
  }
  const b=Buffer.from([...all].sort().join('\0')+'\0');
  const p=spawnSync('git',['-C',bare,'check-attr','--source='+head,'--all','-z','--stdin'],
    {input:b,encoding:null,timeout:30000,maxBuffer:2*1024*1024,env:env(),windowsHide:true});
  if(p.error||p.status!==0||!Buffer.isBuffer(p.stdout))
    fail('HANDOFF_QA_ATTRIBUTES_UNREADABLE');
  const attrs=p.stdout.toString('utf8').split('\0');
  if(attrs.at(-1)!==''||(attrs.length-1)%3!==0)
    fail('HANDOFF_QA_ATTRIBUTES_UNREADABLE');
  for(let i=0;i<attrs.length-1;i+=3){
    if(!all.has(attrs[i])||!attrs[i+1]||!attrs[i+2])
      fail('HANDOFF_QA_ATTRIBUTES_UNREADABLE');
    if(['filter','working-tree-encoding'].includes(attrs[i+1])&&
       !['unset','unspecified'].includes(attrs[i+2]))
      fail('HANDOFF_QA_ACTIVE_FILTER');
  }
}
async function inspectQAHandoff({origin,agentId,ticketId,signer,
  bundlePath,repoDir,fetcher=fetch,onVerifiedBare=null}){
  const t=checkedTask(await centralTask({origin,agentId,ticketId,signer,fetcher}),
    agentId,ticketId,'QA');
  if(typeof bundlePath!=='string'||!path.isAbsolute(bundlePath)||
     !bundlePath.endsWith('.bundle'))fail('HANDOFF_BUNDLE_PATH_INVALID');
  const manifestPath=bundlePath+'.json';
  const m=readManifest(manifestPath);
  if(!matchingTask(t,m))fail('HANDOFF_MANIFEST_CENTRAL_MISMATCH');
  const dig=shaFile(bundlePath);
  if(dig.size!==m.bundle_size_bytes||dig.hash!==m.bundle_sha256)
    fail('HANDOFF_BUNDLE_DIGEST_MISMATCH');
  const repo=trustedRepository(repoDir,t);
  // No fetch, checkout, config mutation or refs written into trusted repo.
  const quarantine=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-qa-quarantine-'));
  try{
    const bare=path.join(quarantine,'objects.git');
    git(quarantine,'init','--bare',bare);
    git(bare,'-c','protocol.file.allow=always','fetch','--no-tags',
      '--no-recurse-submodules',repo,t.baseline_sha);
    git(bare,'bundle','verify',bundlePath);
    bundleRef(bare,bundlePath,t.candidate_head_sha);
    git(bare,'-c','protocol.file.allow=always','fetch','--no-tags',
      '--no-recurse-submodules',bundlePath,'HEAD');
    verifyHistory(bare,t);
    if(onVerifiedBare!==null){
      if(typeof onVerifiedBare!=='function')fail('HANDOFF_QA_CALLBACK_INVALID');
      return await onVerifiedBare({bare,task:t,bundle_sha256:dig.hash});
    }
    return {verified:true,kind:'QA_OFFLINE_OBJECTS_INSPECTED_ONLY',
      ticket_id:ticketId,candidate_head_sha:t.candidate_head_sha,
      candidate_tree_sha:t.candidate_tree_sha,bundle_sha256:dig.hash,
      imported_into_trusted_repo:false,qa_approved:false,
      git_published:false,automatic_execution_allowed:false};
  }finally{fs.rmSync(quarantine,{recursive:true,force:true});}
}
module.exports={exportCandidateHandoff,inspectQAHandoff,verifyHistory};
