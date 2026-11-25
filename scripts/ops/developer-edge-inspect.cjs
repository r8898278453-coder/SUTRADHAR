/**
 * Owner's read-only inspection of the developer-only PLAINTEXT v7 Edge state.
 *
 * No process check, key export, chmod, lock unlink, daemon start, network I/O,
 * node re-enrollment, or automatic recovery permission. A PID in a lock is NOT
 * proof that the PID still runs or that the lock is safe to delete.
 */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const PRIVATE_MASK=0o077,MAX_IDENTITY_BYTES=32768,MAX_LOCK_BYTES=2048;
const NODE=/^node_[a-f0-9]{32}$/,BOOT=/^boot_[a-f0-9]{32}$/,
  AGENT=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
function fail(code){throw Error(code);}
function lstatOrNull(p){
  try{return fs.lstatSync(p);}catch(e){if(e&&e.code==='ENOENT')return null;throw e;}
}
function safeFile(dir,basename,maxBytes){
  const target=path.join(dir,basename);
  const st=lstatOrNull(target);
  if(!st)return null;
  if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>maxBytes||
     (process.platform!=='win32'&&(st.mode&PRIVATE_MASK)!==0))
    fail('DEV_EDGE_INSPECT_FILE_UNSAFE');
  const fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const current=fs.fstatSync(fd);
    if(!current.isFile()||current.dev!==st.dev||current.ino!==st.ino||
       current.size!==st.size||current.size>maxBytes||
       (process.platform!=='win32'&&(current.mode&PRIVATE_MASK)!==0))
      fail('DEV_EDGE_INSPECT_FILE_CHANGED');
    return fs.readFileSync(fd,{encoding:'utf8'});
  }finally{fs.closeSync(fd);}
}
function inspectDeveloperEdgeDir(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||dir.length>2048)
    fail('DEV_EDGE_INSPECT_ABSOLUTE_DIR_REQUIRED');
  const st=lstatOrNull(dir);
  if(!st)return {schema:1,mode:'READ_ONLY_DEVELOPER_EDGE_ALPHA',
    state:'NOT_CONFIGURED',identity_present:false,lock_present:false,
    owner_review_required:true,plaintext_identity:true,
    restart_authorized:false,process_alive_verified:false,
    central_verified:false,production_release_authorized:false};
  if(!st.isDirectory()||st.isSymbolicLink()||
     (process.platform!=='win32'&&(st.mode&PRIVATE_MASK)!==0)||
     (process.platform!=='win32'&&typeof process.getuid==='function'&&
       st.uid!==process.getuid()))fail('DEV_EDGE_INSPECT_DIRECTORY_UNSAFE');
  const identityText=safeFile(dir,'identity.json',MAX_IDENTITY_BYTES);
  const lockText=safeFile(dir,'edge-owner.lock',MAX_LOCK_BYTES);
  let identity=null,lock=null;
  if(identityText!==null){
    let parsed;
    try{parsed=JSON.parse(identityText);}catch{fail('DEV_EDGE_INSPECT_IDENTITY_CORRUPT');}
    // Match the EXACT developer-only runtime identity schema, including
    // key material consistency. Otherwise this diagnostic could label an
    // identity as unlocked even though the daemon must reject its restart.
    // Never include either PEM in diagnostics, even on parsing errors.
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       Object.keys(parsed).sort().join('|')!==
         'agents|boot_id|node_id|node_sequence|private_key_pem|public_key_pem'||
       !NODE.test(parsed.node_id||'')||!BOOT.test(parsed.boot_id||'')||
       !Number.isSafeInteger(parsed.node_sequence)||parsed.node_sequence<0||
       !Array.isArray(parsed.agents)||parsed.agents.length<1||
       parsed.agents.length>4||parsed.agents.some(x=>!x||
         typeof x!=='object'||Array.isArray(x)||
         Object.keys(x).sort().join('|')!=='id|sequence'||
         typeof x.id!=='string'||!AGENT.test(x.id)||
         !Number.isSafeInteger(x.sequence)||
         x.sequence<0)||new Set(parsed.agents.map(x=>x.id)).size!==parsed.agents.length||
       typeof parsed.private_key_pem!=='string'||
       parsed.private_key_pem.length>8000||
       typeof parsed.public_key_pem!=='string'||
       parsed.public_key_pem.length>4000)
      fail('DEV_EDGE_INSPECT_IDENTITY_INVALID');
    try{
      const key=crypto.createPrivateKey(parsed.private_key_pem);
      const pub=crypto.createPublicKey(parsed.public_key_pem);
      if(key.asymmetricKeyType!=='ed25519'||pub.asymmetricKeyType!=='ed25519'||
         !crypto.createPublicKey(key).export({type:'spki',format:'der'})
           .equals(pub.export({type:'spki',format:'der'})))
        fail('DEV_EDGE_INSPECT_IDENTITY_KEY_MISMATCH');
    }catch{
      fail('DEV_EDGE_INSPECT_IDENTITY_KEY_MISMATCH');
    }
    // Explicit allowlist. NEVER print/re-serialize private/public PEM fields.
    identity={node_id:parsed.node_id,boot_id:parsed.boot_id,
      node_sequence:parsed.node_sequence,
      agents:parsed.agents.map(x=>({agent_id:x.id,sequence:x.sequence}))};
  }
  if(lockText!==null){
    let parsed;
    try{parsed=JSON.parse(lockText);}catch{fail('DEV_EDGE_INSPECT_LOCK_CORRUPT');}
    if(!parsed||parsed.schema!==1||!Number.isSafeInteger(parsed.pid)||
       parsed.pid<1||!Number.isFinite(Date.parse(parsed.started_at))||
       typeof parsed.token!=='string'||
       !/^[a-f0-9-]{36}$/.test(parsed.token))
      fail('DEV_EDGE_INSPECT_LOCK_INVALID');
    // PID is informational; do NOT use process.kill(pid, 0).
    lock={pid:parsed.pid,started_at:parsed.started_at};
  }
  // The daemon refuses to generate a new identity when ANY residual file
  // survives (including abandoned identity.json.*.tmp). Report counts only
  // for unrecognized names: filenames themselves can expose secrets.
  const entries=fs.readdirSync(dir);
  if(entries.includes('identity.json')!==(identityText!==null)||
     entries.includes('edge-owner.lock')!==(lockText!==null))
    fail('DEV_EDGE_INSPECT_DIRECTORY_CHANGED');
  const recognized=['enrollment_requested','sealed_outbox.jsonl','status.json'];
  const artifacts=recognized.filter(name=>entries.includes(name));
  const known=new Set(['identity.json','edge-owner.lock',...recognized]);
  const unexpectedCount=entries.filter(name=>!known.has(name)).length;
  const missingButOld=identity===null&&
    (lock!==null||artifacts.length>0||unexpectedCount>0);
  const state=lock?'LOCK_PRESENT_OWNER_REVIEW_REQUIRED':
    missingButOld?'MISSING_IDENTITY_OWNER_REVIEW_REQUIRED':
    identity&&unexpectedCount>0?'UNLOCKED_RESIDUAL_ARTIFACTS_OWNER_REVIEW_REQUIRED':
    identity?'UNLOCKED_NOT_RESTART_AUTHORIZED':'NOT_ENROLLED';
  return {schema:1,mode:'READ_ONLY_DEVELOPER_EDGE_ALPHA',
    state,identity_present:identity!==null,lock_present:lock!==null,
    identity,lock,residual_artifacts:artifacts,
    unexpected_artifact_count:unexpectedCount,
    local_ed25519_pair_verified:identity!==null,
    configured_agent_roster_verified:false,counter_rollback_verified:false,
    owner_review_required:true,plaintext_identity:true,
    private_key_exported:false,mutation_performed:false,
    restart_authorized:false,process_alive_verified:false,
    central_verified:false,production_release_authorized:false};
}
if(require.main===module){
  try{
    const dir=process.env.SUTRADHAR_NODE_DIR||
      path.join(os.homedir(),'.sutradhar','v7');
    console.log(JSON.stringify(inspectDeveloperEdgeDir(dir),null,2));
  }catch(e){
    // Do not disclose paths, contents, PEMs, tokens or environment variables.
    const code=typeof e?.message==='string'&&
      /^DEV_EDGE_INSPECT_[A-Z_]+$/.test(e.message)?
      e.message:'DEV_EDGE_INSPECT_FAILED';
    console.error(JSON.stringify({schema:1,state:'BLOCKED',error_code:code,
      owner_review_required:true,mutation_performed:false}));
    process.exitCode=2;
  }
}
module.exports={inspectDeveloperEdgeDir};
