/**
 * Electron main-process vault; no secrets in user-editable settings or child env.
 * Use only when Electron safeStorage uses a real OS cryptographic provider.
 * Fail closed if encryption unavailable, plaintext fallback or legacy cleartext.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
/**
 * Read an existing small private runtime file by descriptor, not by path
 * after lstat(). O_NOFOLLOW where supported, inode/size/time identity checks
 * before and after fixed-length reads; never retries a changed identity.
 *
 * This is a file-race guard, NOT proof of physical Windows DPAPI or ACLs.
 */
function readStableLocalFile(file,{minBytes=1,maxBytes=65536,io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !Number.isSafeInteger(minBytes)||minBytes<1||
     !Number.isSafeInteger(maxBytes)||maxBytes<minBytes||maxBytes>65536)
    throw Error('LOCAL_PRIVATE_FILE_ARGUMENT_INVALID');
  const same=(a,b)=>a&&b&&a.isFile()&&b.isFile()&&
    !a.isSymbolicLink()&&!b.isSymbolicLink()&&
    a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
    a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
  const safe=(s)=>s&&s.isFile()&&!s.isSymbolicLink()&&
    s.size>=minBytes&&s.size<=maxBytes&&
    (process.platform==='win32'||(s.mode&0o077)===0);
  let first;
  try{first=io.lstatSync(file);}catch{
    throw Error('LOCAL_PRIVATE_FILE_UNSAFE');
  }
  if(!safe(first))throw Error('LOCAL_PRIVATE_FILE_UNSAFE');
  let fd;
  try{
    try{fd=io.openSync(file,fs.constants.O_RDONLY|
      (fs.constants.O_NOFOLLOW||0));}
    catch{throw Error('LOCAL_PRIVATE_FILE_UNSAFE');}
    const opened=io.fstatSync(fd);
    if(!safe(opened)||!same(first,opened))
      throw Error('LOCAL_PRIVATE_FILE_CHANGED');
    const buffer=Buffer.alloc(opened.size);
    let offset=0;
    while(offset<buffer.length){
      let n;
      try{n=io.readSync(fd,buffer,offset,buffer.length-offset,offset);}
      catch{throw Error('LOCAL_PRIVATE_FILE_CHANGED');}
      if(!Number.isSafeInteger(n)||n<=0)
        throw Error('LOCAL_PRIVATE_FILE_CHANGED');
      offset+=n;
    }
    let finalFd,finalPath;
    try{finalFd=io.fstatSync(fd);finalPath=io.lstatSync(file);}
    catch{throw Error('LOCAL_PRIVATE_FILE_CHANGED');}
    if(!safe(finalFd)||!safe(finalPath)||
       !same(opened,finalFd)||!same(opened,finalPath))
      throw Error('LOCAL_PRIVATE_FILE_CHANGED');
    return buffer;
  }finally{if(fd!==undefined)io.closeSync(fd);}
}

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
  // A durable write intent must precede every encrypted identity replacement.
  // A crash, interrupted fsync or ambiguous rename retains this fence so
  // another Electron process cannot silently resume with uncertain counters.
  // It contains NO ciphertext, keys, counters, enrollment grant or PC name.
  const intent=path.join(dir,'identity.osvault.write-intent');
  const intentBytes=Buffer.from('SUTRADHAR_OS_VAULT_WRITE_INTENT_V1\n');
  let intentFd;
  try{
    intentFd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
    fs.writeSync(intentFd,intentBytes,0,intentBytes.length,0);
    fs.fsyncSync(intentFd);
    fs.closeSync(intentFd);intentFd=undefined;
    if(process.platform!=='win32'){
      const dfd=fs.openSync(dir,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
    }
  }catch(e){
    if(intentFd!==undefined)try{fs.closeSync(intentFd);}catch{}
    // A partially written marker is evidence too. Never clean it up here.
    if(e?.code==='EEXIST')
      throw Error('OS_VAULT_WRITE_INTENT_OWNER_REVIEW_REQUIRED');
    throw e;
  }
  const tmp=target+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
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
    // Retire the intent ONLY after ciphertext file and directory commits.
    // An interrupted deletion leaves Owner-review evidence. A Windows
    // directory flush is not guaranteed: physical power-loss gate remains HOLD.
    fs.unlinkSync(intent);
    if(process.platform!=='win32'){
      const dfd=fs.openSync(dir,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
    }
  }catch(e){
    if(!renamed){try{fs.unlinkSync(tmp);}catch{}}
    // Never remove the intent on failure, even if rename was successful.
    // The caller poisons this vault object and prevents any further sign.
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
  const intent=path.join(dir,'identity.osvault.write-intent');
  let poisoned=false;
  function refuseLegacyIdentity(){
    // lstat counts dangling legacy aliases as evidence, unlike existsSync.
    // Recheck on every read/save: an identity.json appearing after startup
    // must never silently coexist with the enrolled OS-vault identity.
    try{fs.lstatSync(legacy);}
    catch(error){
      if(error?.code==='ENOENT')return;
      throw Error('LEGACY_PLAINTEXT_IDENTITY_INSPECTION_FAILED');
    }
    throw Error('LEGACY_PLAINTEXT_IDENTITY_REQUIRES_OWNER_MIGRATION');
  }
  refuseLegacyIdentity();
  function assertNotUncertain(){
    if(poisoned)throw Error('OS_VAULT_WRITE_COMMIT_UNCERTAIN_OWNER_REVIEW');
    refuseLegacyIdentity();
    // lstat, not existsSync: a dangling symlink/partial intent also blocks.
    try{fs.lstatSync(intent);}
    catch(e){
      if(e?.code==='ENOENT')return;
      throw Error('OS_VAULT_WRITE_INTENT_INSPECTION_FAILED');
    }
    throw Error('OS_VAULT_WRITE_INTENT_OWNER_REVIEW_REQUIRED');
  }
  function read(){
    assertNotUncertain();
    let stat;
    try{stat=fs.lstatSync(file);}
    catch(e){
      if(e?.code!=='ENOENT')throw e;
      // The original encrypted identity may have been lost in an interrupted
      // write, backup restore or manual deletion. As with the developer Edge,
      // ANY remaining node-directory entry is evidence of prior activity.
      // Never silently generate a new key against an existing Central node.
      let entries;
      try{entries=fs.readdirSync(dir);}
      catch(err){
        if(err?.code==='ENOENT')return null;
        throw Error('OS_VAULT_DIRECTORY_INSPECTION_FAILED');
      }
      if(entries.length!==0)
        throw Error('OS_VAULT_IDENTITY_MISSING_OWNER_RECOVERY_REQUIRED');
      return null;
    }
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<30||
       stat.size>64*1024||
       (process.platform!=='win32'&&(stat.mode&0o077)!==0))
      throw Error('OS_VAULT_FILE_UNSAFE');
    // An exposed parent directory invalidates even a mode-0600 ciphertext.
    const folder=fs.lstatSync(dir);
    if(!folder.isDirectory()||folder.isSymbolicLink()||
       (process.platform!=='win32'&&((folder.mode&0o077)!==0||
         (typeof process.getuid==='function'&&folder.uid!==process.getuid()))))
      throw Error('OS_VAULT_DIRECTORY_NOT_PRIVATE');
    let record;
    try{record=JSON.parse(readStableLocalFile(file,{minBytes:30,maxBytes:65536}).toString('utf8'));}
    catch{throw Error('OS_VAULT_RECORD_INVALID');}
    if(!record||typeof record!=='object'||Array.isArray(record)||
       Object.keys(record).sort().join('|')!=='ciphertext|mode|version'||
       record.version!==1||record.mode!=='os-safeStorage'||
       typeof record.ciphertext!=='string'||record.ciphertext.length>50000||
       record.ciphertext.length<16||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.ciphertext))
      throw Error('OS_VAULT_RECORD_INVALID');
    const encrypted=Buffer.from(record.ciphertext,'base64');
    if(encrypted.toString('base64')!==record.ciphertext)
      throw Error('OS_VAULT_RECORD_INVALID');
    let clear;
    try{clear=safeStorage.decryptString(encrypted);}
    catch{throw Error('OS_VAULT_DECRYPT_FAILED');}
    let identity;
    try{identity=JSON.parse(clear);}catch{throw Error('OS_VAULT_IDENTITY_CORRUPT');}
    validate(identity);
    return identity;
  }
  function validate(x){
    // The encrypted Electron identity and the developer-only identity use
    // the same *shape*, but independent storage/boot handling. Encrypted
    // garbage, unknown fields or invalid keys must never look "enrolled".
    if(!x||typeof x!=='object'||Array.isArray(x)||
      Object.keys(x).sort().join('|')!==
        'agents|boot_id|node_id|node_sequence|private_key_pem|public_key_pem'||
      !/^node_[0-9a-f]{32}$/.test(x.node_id||'')||
      !/^boot_[0-9a-f]{32}$/.test(x.boot_id||'')||
      typeof x.private_key_pem!=='string'||x.private_key_pem.length>8000||
      typeof x.public_key_pem!=='string'||x.public_key_pem.length>4000||
      !Array.isArray(x.agents)||x.agents.length<1||x.agents.length>4||
      x.agents.some(a=>!a||typeof a!=='object'||Array.isArray(a)||
        Object.keys(a).sort().join('|')!=='id|sequence'||
        typeof a.id!=='string'||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(a.id)||
        !Number.isSafeInteger(a.sequence)||a.sequence<0)||
      new Set(x.agents.map(a=>a.id)).size!==x.agents.length||
      !Number.isSafeInteger(x.node_sequence)||x.node_sequence<0)
      throw Error('OS_VAULT_IDENTITY_INVALID');
    try{
      const privateKey=crypto.createPrivateKey(x.private_key_pem);
      const publicKey=crypto.createPublicKey(x.public_key_pem);
      if(privateKey.asymmetricKeyType!=='ed25519'||
         publicKey.asymmetricKeyType!=='ed25519'||
         !crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})
           .equals(publicKey.export({type:'spki',format:'der'})))
        throw Error('MISMATCH');
    }catch{throw Error('OS_VAULT_IDENTITY_KEY_MISMATCH');}
  }
  function save(x){
    assertNotUncertain();
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
        if(x.node_sequence!==old.node_sequence+1)
          throw Error('OS_VAULT_SEQUENCE_GAP_DENIED');
        if(old.agents.some((a,i)=>x.agents[i].sequence<=a.sequence))
          throw Error('OS_VAULT_AGENT_REPLAY_DENIED');
        if(old.agents.some((a,i)=>x.agents[i].sequence!==a.sequence+1))
          throw Error('OS_VAULT_AGENT_SEQUENCE_GAP_DENIED');
      }
    }
    const cipher=safeStorage.encryptString(JSON.stringify(x)).toString('base64');
    try{
      atomicWrite(file,JSON.stringify({version:1,mode:'os-safeStorage',ciphertext:cipher})+'\n');
    }catch(e){
      // No in-process retry, signing, boot rotation or worker action is safe
      // after a possibly completed encrypted-counter write.
      poisoned=true;
      throw e;
    }
    return {node_id:x.node_id,agent_count:x.agents.length};
  }
  function status(){
    let exists=true;
    try{fs.lstatSync(file);}
    catch(error){
      if(error?.code==='ENOENT')exists=false;
      else throw Error('OS_VAULT_STATUS_INSPECTION_FAILED');
    }
    return {exists,backend:platform==='win32'?'Windows DPAPI':
      platform==='darwin'?'macOS Keychain':'OS credential store',encrypted:true};
  }
  return {read,save,status,file};
}
module.exports={createVault,atomicWrite,readStableLocalFile};
