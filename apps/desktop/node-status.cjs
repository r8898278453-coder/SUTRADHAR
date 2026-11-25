/**
 * Informational local edge heartbeat snapshot, never Central authority.
 * All reads are bounded and symlink-safe; a damaged snapshot stays blocked.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_STATUS_BYTES=4096,NODE=/^node_[a-f0-9]{32}$/;
const AGENT=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const FIELDS=new Set(['node_id','observed_at','connection','last_accepted_at',
  'phase','master_agent_id','backups','agent_ids','epoch',
  'error_code','last_error_at']);
const EXTRA=new Set([...FIELDS].filter(x=>!['node_id','observed_at'].includes(x)));
function fail(code){throw Error(code);}
function validate(file,nodeId){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     path.basename(file)!=='status.json'||!NODE.test(nodeId||''))
    fail('LOCAL_STATUS_PATH_OR_ID_INVALID');
}
function readNodeStatus({file,nodeId}={}){
  validate(file,nodeId);
  let first;
  try{first=fs.lstatSync(file);}catch(error){
    if(error?.code==='ENOENT')return null;
    fail('LOCAL_STATUS_READ_FAILED');
  }
  if(!first.isFile()||first.isSymbolicLink()||
     first.size<35||first.size>MAX_STATUS_BYTES||
     (process.platform!=='win32'&&(first.mode&0o077)!==0))
    fail('LOCAL_STATUS_FILE_UNSAFE');
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.dev!==first.dev||stat.ino!==first.ino||
       stat.size!==first.size)fail('LOCAL_STATUS_CHANGED');
    const bytes=Buffer.alloc(stat.size);
    let offset=0;
    while(offset<bytes.length){
      const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(n<1)fail('LOCAL_STATUS_CHANGED');
      offset+=n;
    }
    if(fs.readSync(fd,Buffer.alloc(1),0,1,offset)!==0||
       fs.fstatSync(fd).size!==first.size)
      fail('LOCAL_STATUS_CHANGED');
    let obj;
    try{obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{fail('LOCAL_STATUS_JSON_INVALID');}
    if(!obj||typeof obj!=='object'||Array.isArray(obj)||
       obj.node_id!==nodeId||typeof obj.connection!=='string'||
       obj.connection.length>80||typeof obj.observed_at!=='string'||
       !Number.isFinite(Date.parse(obj.observed_at))||
       Object.keys(obj).some(k=>!FIELDS.has(k)))
      fail('LOCAL_STATUS_CONTENT_INVALID');
    return obj;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function writeNodeStatus({file,nodeId,extra,now=new Date().toISOString()}={}){
  validate(file,nodeId);
  if(!extra||typeof extra!=='object'||Array.isArray(extra)||
     typeof extra.connection!=='string'||extra.connection.length>80||
     Object.keys(extra).some(k=>!EXTRA.has(k))||
     (Object.hasOwn(extra,'backups')&&
       (!Array.isArray(extra.backups)||extra.backups.length!==2||
        extra.backups.some(x=>x!==null&&!AGENT.test(x))))||
     (Object.hasOwn(extra,'agent_ids')&&
       (!Array.isArray(extra.agent_ids)||extra.agent_ids.length<1||
        extra.agent_ids.length>4||new Set(extra.agent_ids).size!==extra.agent_ids.length||
        extra.agent_ids.some(x=>!AGENT.test(x))))||
     typeof now!=='string'||!Number.isFinite(Date.parse(now)))
    fail('LOCAL_STATUS_FIELDS_INVALID');
  const old=readNodeStatus({file,nodeId});
  const last=typeof extra.last_accepted_at==='string'?
    extra.last_accepted_at:(old?.last_accepted_at||null);
  const {last_accepted_at:_unused,...rest}=extra;
  const record={node_id:nodeId,observed_at:now,
    last_accepted_at:last,...rest};
  const bytes=Buffer.from(JSON.stringify(record)+'\n');
  if(bytes.length>MAX_STATUS_BYTES)fail('LOCAL_STATUS_TOO_LARGE');
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const folder=fs.lstatSync(dir);
  if(!folder.isDirectory()||folder.isSymbolicLink())
    fail('LOCAL_STATUS_DIRECTORY_UNSAFE');
  const temp=path.join(dir,'.status.'+process.pid+'.'+
    crypto.randomBytes(8).toString('hex')+'.tmp');
  let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    // Atomic replacement of directory entry, never an external symlink target.
    fs.renameSync(temp,file);
    return Object.freeze({stored:true,authority:false});
  }finally{
    if(fd!==undefined){try{fs.closeSync(fd);}catch{}}
    try{fs.rmSync(temp,{force:true});}catch{}
  }
}
module.exports={readNodeStatus,writeNodeStatus,MAX_STATUS_BYTES};
