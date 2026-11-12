/**
 * Electron main-process vault; no secrets in user-editable settings or child env.
 * Use only when Electron safeStorage uses a real OS cryptographic provider.
 * Fail closed if encryption unavailable, plaintext fallback or legacy cleartext.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
function atomicWrite(target,bytes){
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const tmp=target+'.'+process.pid+'.'+require('node:crypto').randomUUID()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  try{fs.renameSync(tmp,target);}catch(e){try{fs.rmSync(tmp);}catch{}throw e;}
  try{fs.chmodSync(target,0o600);}catch{}
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
    if(!fs.existsSync(file))return null;
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
      !Number.isSafeInteger(x.node_sequence)||x.node_sequence<0)
      throw Error('OS_VAULT_IDENTITY_INVALID');
  }
  function save(x){
    validate(x);
    const old=read();
    if(old){
      if(old.node_id!==x.node_id||old.public_key_pem!==x.public_key_pem)
        throw Error('OS_VAULT_IDENTITY_ROTATION_REQUIRES_OWNER');
      if(x.node_sequence<old.node_sequence)
        throw Error('OS_VAULT_SEQUENCE_ROLLBACK_DENIED');
      const oldAgents=new Map(old.agents.map(a=>[a.id,a.sequence]));
      for(const a of x.agents){
        if(oldAgents.has(a.id)&&a.sequence<oldAgents.get(a.id))
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
