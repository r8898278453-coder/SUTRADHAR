/**
 * SUTRADHAR alpha: forensic read-only local crash evidence inventory.
 *
 * Never decrypts OS-vault identity, reads private key PEMs, contacts Central,
 * removes the session fence, restarts an agent, signs requests or repairs files.
 * Snapshot hashes are UNTRUSTED local observations, not Owner acceptance.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectAgentSession}=require('./agent-session-fence.cjs');
const RECORDS=Object.freeze([
  ['session_intent','edge-agent.session-uncertain.json',512],
  ['encrypted_identity','identity.osvault.json',65536],
  ['vault_write_intent','identity.osvault.write-intent',512],
  ['enrollment_receipt','enrollment-receipt.json',16384],
  ['last_local_status','status.json',16384],
  ['maintenance_hold','maintenance-recovery-hold.json',16384],
  ['restart_ack','maintenance-restart-ack.json',8192],
  ['installer_execution_attempt','installer-execution-attempt.json',16384]
]);
function fail(code){throw Error(code);}
function privateNodeDir(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    fail('AGENT_CRASH_DIAGNOSTIC_DIRECTORY_INVALID');
  let s;
  try{s=fs.lstatSync(dir);}
  catch{fail('AGENT_CRASH_DIAGNOSTIC_DIRECTORY_UNAVAILABLE');}
  if(!s.isDirectory()||s.isSymbolicLink()||
     (process.platform!=='win32'&&
       ((s.mode&0o077)!==0||
       (typeof process.getuid==='function'&&s.uid!==process.getuid()))))
    fail('AGENT_CRASH_DIAGNOSTIC_DIRECTORY_UNSAFE');
  return s;
}
function fingerprintFile(dir,filename,max){
  const filepath=path.join(dir,filename);
  let initial;
  try{initial=fs.lstatSync(filepath);}
  catch(e){
    if(e?.code==='ENOENT')return {state:'MISSING'};
    return {state:'UNSAFE_OR_UNREADABLE'};
  }
  if(!initial.isFile()||initial.isSymbolicLink()||
     initial.size>max||initial.size<1||
     (process.platform!=='win32'&&(initial.mode&0o077)!==0))
    return {state:'UNSAFE_OR_UNREADABLE'};
  let fd;
  try{
    fd=fs.openSync(filepath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.dev!==initial.dev||
       opened.ino!==initial.ino||opened.size!==initial.size)
      return {state:'UNSAFE_OR_UNREADABLE'};
    const content=Buffer.alloc(initial.size);
    let offset=0;
    while(offset<content.length){
      const count=fs.readSync(fd,content,offset,content.length-offset,offset);
      if(count<=0)return {state:'UNSAFE_OR_UNREADABLE'};
      offset+=count;
    }
    const finalFd=fs.fstatSync(fd),finalPath=fs.lstatSync(filepath);
    if(finalFd.size!==initial.size||finalPath.size!==initial.size||
       finalPath.dev!==initial.dev||finalPath.ino!==initial.ino||
       finalFd.dev!==initial.dev||finalFd.ino!==initial.ino||
       finalPath.isSymbolicLink())return {state:'UNSAFE_OR_UNREADABLE'};
    const sha256=crypto.createHash('sha256').update(content).digest('hex');
    if(filename==='edge-agent.session-uncertain.json'){
      let parsed;
      try{parsed=JSON.parse(content.toString('utf8'));}catch{return {
        state:'PRESENT_INVALID_SHAPE',bytes:content.length,sha256};}
      const valid=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
        Object.keys(parsed).sort().join('|')===
          'automatic_restart_allowed|schema|session_id|started_at_ms|state'&&
        parsed.schema===1&&parsed.state==='EXIT_UNCONFIRMED_OWNER_REVIEW'&&
        /^[a-f0-9]{32}$/.test(parsed.session_id||'')&&
        Number.isSafeInteger(parsed.started_at_ms)&&parsed.started_at_ms>0&&
        parsed.automatic_restart_allowed===false;
      return {state:valid?'PRESENT_VALID_SHAPE':'PRESENT_INVALID_SHAPE',
        bytes:content.length,sha256};
    }
    return {state:'PRESENT_HASHED',bytes:content.length,sha256};
  }catch{return {state:'UNSAFE_OR_UNREADABLE'};}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function inspectCrashEvidence({dir}={}){
  const folder=privateNodeDir(dir);
  // The deliberate orphaned session marker must still exist; no generic
  // filesystem scanning ability should be granted to the setup renderer.
  if(!inspectAgentSession({dir}).active)
    fail('AGENT_CRASH_DIAGNOSTIC_SESSION_HOLD_REQUIRED');
  const records={};
  for(const [id,filename,max] of RECORDS)
    records[id]=fingerprintFile(dir,filename,max);
  // Unknown filenames are neither read nor returned to renderer/logs.
  let entries;
  try{entries=fs.readdirSync(dir);}catch{
    fail('AGENT_CRASH_DIAGNOSTIC_DIRECTORY_UNREADABLE');
  }
  const presentNames=new Set(RECORDS.map(x=>x[1]));
  const last=fs.lstatSync(dir);
  if(!last.isDirectory()||last.isSymbolicLink()||
     last.dev!==folder.dev||last.ino!==folder.ino)
    fail('AGENT_CRASH_DIAGNOSTIC_DIRECTORY_CHANGED');
  return Object.freeze({
    schema:1,kind:'SUTRADHAR_LOCAL_CRASH_EVIDENCE_V1',
    state:'OWNER_REVIEW_REQUIRED',
    observed_at_untrusted_local:new Date().toISOString(),
    records,other_directory_entries_count:entries.filter(x=>!presentNames.has(x)).length,
    evidence_signed:false,central_verified:false,physical_pc_verified:false,
    agent_restart_allowed:false,installer_allowed:false,
    marker_removal_allowed:false,production_release_allowed:false,
    next_action:'Preserve this PC and all original evidence. Owner must independently review Central signed counters, Master epoch, work/QA/Git effects, OS-vault health and physical process status. This local diagnostic NEVER authorizes restart or marker deletion.'
  });
}
module.exports={inspectCrashEvidence};
