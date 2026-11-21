/**
 * Durable per-PC session fence for the packaged Electron heartbeat child.
 *
 * Open BEFORE spawn. Only an observed safe child exit may retire it.
 * If Electron itself crashes, the PC reboots, or IPC/exit is uncertain, the
 * marker survives and a subsequent Electron process refuses ANY signing.
 *
 * This is a local conservative hold, not a cryptographic recovery authority.
 * Do not delete, overwrite or auto-repair it after an uncertain shutdown.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILE='edge-agent.session-uncertain.json';
const ID=/^[a-f0-9]{32}$/;
const END_REASONS=new Set(['CLEAN_EXIT','OBSERVED_OWNER_MAINTENANCE_STOP','OBSERVED_APP_SHUTDOWN']);
function fail(code){throw Error(code);}
function trustedDirectory(dir,create=false){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    fail('AGENT_SESSION_DIRECTORY_INVALID');
  if(create)fs.mkdirSync(dir,{recursive:true,mode:0o700});
  let s;
  try{s=fs.lstatSync(dir);}catch(e){
    if(!create&&e?.code==='ENOENT')return null;
    throw e;
  }
  if(!s.isDirectory()||s.isSymbolicLink()||
    (process.platform!=='win32'&&
      ((s.mode&0o077)!==0||
       (typeof process.getuid==='function'&&s.uid!==process.getuid()))))
    fail('AGENT_SESSION_DIRECTORY_UNSAFE');
  return s;
}
function markerStat(dir){
  try{return fs.lstatSync(path.join(dir,FILE));}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
}
function inspectAgentSession({dir}={}){
  const folder=trustedDirectory(dir);
  if(!folder)return Object.freeze({active:false});
  const stat=markerStat(dir);
  if(!stat)return Object.freeze({active:false});
  // Even an unreadable, partial, symlinked or tampered marker is a hold.
  return Object.freeze({active:true,owner_review_required:true});
}
function requireNoAgentSession({dir}={}){
  if(inspectAgentSession({dir}).active)
    fail('AGENT_SESSION_OWNER_REVIEW_REQUIRED');
  return true;
}
function syncDirectory(dir,expected){
  // Windows directory fsync is not a reliable NTFS power-loss guarantee.
  // Real Windows restart/power-cut acceptance is separately release-blocking.
  if(process.platform==='win32')return;
  let fd;
  try{
    fd=fs.openSync(dir,fs.constants.O_RDONLY|
      (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
    const opened=fs.fstatSync(fd);
    if(opened.dev!==expected.dev||opened.ino!==expected.ino)
      fail('AGENT_SESSION_DIRECTORY_CHANGED');
    fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function beginAgentSession({dir}={}){
  const folder=trustedDirectory(dir,true);
  requireNoAgentSession({dir});
  const session_id=crypto.randomUUID().replace(/-/g,'');
  const record={schema:1,state:'EXIT_UNCONFIRMED_OWNER_REVIEW',
    session_id,started_at_ms:Date.now(),automatic_restart_allowed:false};
  const bytes=Buffer.from(JSON.stringify(record)+'\n');
  const file=path.join(dir,FILE);
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
    let offset=0;
    while(offset<bytes.length){
      const n=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
      if(n<=0)fail('AGENT_SESSION_SHORT_WRITE');
      offset+=n;
    }
    fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  // Failed parent-directory durability leaves the marker for Owner review.
  syncDirectory(dir,folder);
  return Object.freeze({session_id});
}
function finishObservedSession({dir,session_id,reason}={}){
  if(typeof session_id!=='string'||!ID.test(session_id)||
    !END_REASONS.has(reason))fail('AGENT_SESSION_EXIT_PROOF_INVALID');
  const folder=trustedDirectory(dir);
  if(!folder)fail('AGENT_SESSION_MARKER_MISSING');
  const stat=markerStat(dir);
  if(!stat||!stat.isFile()||stat.isSymbolicLink()||
    stat.size<60||stat.size>512||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    fail('AGENT_SESSION_MARKER_UNSAFE');
  let record;
  try{record=JSON.parse(fs.readFileSync(path.join(dir,FILE),'utf8'));}
  catch{fail('AGENT_SESSION_MARKER_CORRUPT');}
  if(!record||typeof record!=='object'||Array.isArray(record)||
    Object.keys(record).sort().join('|')!==
       'automatic_restart_allowed|schema|session_id|started_at_ms|state'||
    record.schema!==1||record.state!=='EXIT_UNCONFIRMED_OWNER_REVIEW'||
    record.automatic_restart_allowed!==false||
    record.session_id!==session_id||
    !Number.isSafeInteger(record.started_at_ms)||record.started_at_ms<1)
    fail('AGENT_SESSION_MARKER_MISMATCH');
  // Only caller's observed safe exit is authority to retire this exact marker.
  fs.unlinkSync(path.join(dir,FILE));
  syncDirectory(dir,folder);
  return Object.freeze({retired:true,observed_exit:reason,
    automatic_restart_allowed:false});
}
module.exports={inspectAgentSession,requireNoAgentSession,
  beginAgentSession,finishObservedSession};
