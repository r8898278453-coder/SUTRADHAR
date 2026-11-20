/**
 * Electron main-process vault; no secrets in user-editable settings or child env.
 * Use only when Electron safeStorage uses a real OS cryptographic provider.
 * Fail closed if encryption unavailable, plaintext fallback or legacy cleartext.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
function atomicWrite(target,bytes){
  const dir=path.dirname(target);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  let folder=fs.lstatSync(dir);
  if(!folder.isDirectory()||folder.isSymbolicLink())
    throw Error('OS_VAULT_DIRECTORY_NOT_PRIVATE');
  let current=null;
  try{current=fs.lstatSync(target);}
  catch(e){if(e?.code!=='ENOENT')throw e;}
  if(current&&(!current.isFile()||current.isSymbolicLink()))
    throw Error('OS_VAULT_TARGET_UNSAFE');
  if(process.platform!=='win32'&&(folder.mode&0o077)!==0){
    // Existing identity in an exposed directory requires Owner review.
    // For a NEW identity only, securely restrict the target directory
    // BEFORE writing even encrypted key material (also supports QA fixtures).
    if(current)throw Error('OS_VAULT_DIRECTORY_NOT_PRIVATE');
    let dfd;
    try{
      dfd=fs.openSync(dir,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      const opened=fs.fstatSync(dfd);
      if(opened.dev!==folder.dev||opened.ino!==folder.ino)
        throw Error('OS_VAULT_DIRECTORY_CHANGED');
      fs.fchmodSync(dfd,0o700);
      fs.fsyncSync(dfd);
    }finally{if(dfd!==undefined)fs.closeSync(dfd);}
    folder=fs.lstatSync(dir);
    if(!folder.isDirectory()||folder.isSymbolicLink()||
       (folder.mode&0o077)!==0)
      throw Error('OS_VAULT_DIRECTORY_NOT_PRIVATE');
  }
  const tmp=target+'.'+process.pid+'.'+require('node:crypto').randomUUID()+'.tmp';
  const payload=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  let fd,renamed=false;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    let offset=0;
    while(offset<payload.length){
      const count=fs.writeSync(fd,payload,offset,payload.length-offset,offset);
      if(count<=0)throw Error('OS_VAULT_SHORT_WRITE');
      offset+=count;
    }
    // Must reach the local filesystem before signed counters are sent.
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,target);renamed=true;
    // POSIX: also persist the name replacement. Windows does not reliably
    // support directory fsync via Node; real power-cut acceptance remains G4.
    if(process.platform!=='win32'){
      const dfd=fs.openSync(dir,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      try{
        const again=fs.fstatSync(dfd);
        if(again.dev!==folder.dev||again.ino!==folder.ino)
          throw Error('OS_VAULT_DIRECTORY_CHANGED');
        fs.fsyncSync(dfd);
      }finally{fs.closeSync(dfd);}
    }
  }catch(e){
    if(!renamed){try{fs.unlinkSync(tmp);}catch{}}
    // If rename succeeded but directory sync failed, do not pretend the
    // vault commit was durable or automatically roll back the encrypted file.
    throw e;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function createVault({safeStorage,dir,platform=process.platform}){
  if(!safeStorage||typeof safeStorage.isEncryptionAvailable!=='function')
    throw Error('OS_VAULT_UNAVAILABLE');
  if(!safeStorage.isEncryptionAvailable())throw Error('OS_VAULT_UNAVAILABLE');
  if(platform==='linux'&&safeStorage.getSelectedStorageBackend?.()==='basic_text')
    throw Error('OS_VAULT_PLAINTEXT_FALLBACK_DENIED');
  const file=path.join(dir,'identity.osvault.json');
  const legacy=path.join(dir,'identity.json');
  if(fs.existsSync(legacy))throw Error('LEGACY_PLAINTEXT_IDENTITY_REQUIRES_OWNER_MIGRATION');
  function read(){
    let stat;
    try{stat=fs.lstatSync(file);}
    catch(e){if(e?.code==='ENOENT')return null;throw e;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<30||
       stat.size>64*1024||
       (process.platform!=='win32'&&(stat.mode&0o077)!==0))
      throw Error('OS_VAULT_FILE_UNSAFE');
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(record.version!==1||record.mode!=='os-safeStorage'||typeof record.ciphertext!=='string'||
      record.ciphertext.length>50000)throw Error('OS_VAULT_RECORD_INVALID');
    const clear=safeStorage.decryptString(Buffer.from(record.ciphertext,'base64'));
    try{
      const identity=JSON.parse(clear);
      validate(identity);
      return identity;
    }catch{throw Error('OS_VAULT_IDENTITY_CORRUPT');}
  }
  function validate(x){
    if(!x||typeof x!=='object'||!/^[a-zA-Z0-9_-]{8,100}$/.test(x.node_id)||
      typeof x.private_key_pem!=='string'||!x.private_key_pem.includes('PRIVATE KEY')||
      typeof x.public_key_pem!=='string'||!Array.isArray(x.agents)||
      x.agents.length<1||x.agents.length>4||
      !/^boot_[a-zA-Z0-9_-]{4,100}$/.test(x.boot_id||'')||
      x.agents.some(a=>!a||!/^([a-zA-Z0-9][a-zA-Z0-9_-]{2,99})$/.test(a.id||'')||
        !Number.isSafeInteger(a.sequence)||a.sequence<0)||
      new Set(x.agents.map(a=>a.id)).size!==x.agents.length||
      !Number.isSafeInteger(x.node_sequence)||x.node_sequence<0)
      throw Error('OS_VAULT_IDENTITY_INVALID');
  }
  function save(x){
    validate(x);
    const old=read();
    if(old){
      if(old.node_id!==x.node_id||old.public_key_pem!==x.public_key_pem||
         old.private_key_pem!==x.private_key_pem)
        throw Error('OS_VAULT_IDENTITY_ROTATION_REQUIRES_OWNER');
      if(old.agents.length!==x.agents.length||
         old.agents.some((a,i)=>a.id!==x.agents[i].id))
        throw Error('OS_VAULT_AGENT_LIST_CHANGE_REQUIRES_OWNER');
      // initialize() may rotate the ephemeral software boot ID, but may
      // NOT change any counter in that operation. Heartbeat saves must
      // strictly advance node and ALL local agent counters on the same boot.
      if(old.boot_id!==x.boot_id){
        if(x.node_sequence!==old.node_sequence||
          old.agents.some((a,i)=>x.agents[i].sequence!==a.sequence))
          throw Error('OS_VAULT_BOOT_ROTATION_COUNTER_CHANGE_DENIED');
      }else{
        if(x.node_sequence<=old.node_sequence)
          throw Error('OS_VAULT_SEQUENCE_ROLLBACK_OR_REPLAY_DENIED');
        if(old.agents.some((a,i)=>x.agents[i].sequence<=a.sequence))
          throw Error('OS_VAULT_AGENT_REPLAY_DENIED');
      }
    }
    const cipher=safeStorage.encryptString(JSON.stringify(x)).toString('base64');
    atomicWrite(file,JSON.stringify({version:1,mode:'os-safeStorage',ciphertext:cipher})+'\n');
    return {node_id:x.node_id,agent_count:x.agents.length};
  }
  function status(){return {exists:fs.existsSync(file),backend:platform==='win32'?'Windows DPAPI':
    platform==='darwin'?'macOS Keychain':'OS credential store',encrypted:true};}
  return {read,save,status,file};
}
module.exports={createVault,atomicWrite};
