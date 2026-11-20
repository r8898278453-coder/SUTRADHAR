/**
 * Developer-only v7 Edge identity state. This PLAINTEXT key store is alpha:
 * it is NOT Electron OS-vault/Windows DPAPI and never authorizes production.
 *
 * Fail closed if a second Edge, an abandoned crash lock, a restored/tampered
 * identity, or an ambiguous persistence error could reuse signed sequences.
 * A crash lock is not automatically stolen, even when its PID seems dead.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NODE=/^node_[a-f0-9]{32}$/,BOOT=/^boot_[a-f0-9]{32}$/,
  AGENT=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
const MAX_BYTES=32*1024;
export type DeveloperIdentity={
  node_id:string;boot_id:string;private_key_pem:string;public_key_pem:string;
  node_sequence:number;agents:{id:string;sequence:number}[]
};
export type DeveloperIdentitySession={
  state:DeveloperIdentity;
  persistHeartbeat:(value:DeveloperIdentity)=>void;
  release:()=>void;
};
function blocked(code:string):never {throw Error(code);}
function statOrNull(p:string):fs.Stats|null {
  try{return fs.lstatSync(p);}catch(e:any){if(e?.code==='ENOENT')return null;throw e;}
}
function privateDirectory(dir:string):void {
  if(typeof dir!=='string'||!path.isAbsolute(dir)||dir.length>2048)
    blocked('DEV_EDGE_ABSOLUTE_DIRECTORY_REQUIRED');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (process.platform!=='win32'&&(stat.mode&0o077)!==0)||
     (process.platform!=='win32'&&process.getuid!==undefined&&
       stat.uid!==process.getuid()))
    blocked('DEV_EDGE_PRIVATE_DIRECTORY_REQUIRED');
}
function syncDirectory(dir:string):void {
  if(process.platform==='win32')return; // Windows power-cut durability is unproven.
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|
    (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function validAgentNames(names:unknown):asserts names is string[] {
  if(!Array.isArray(names)||names.length<1||names.length>4||
     names.some(x=>typeof x!=='string'||!AGENT.test(x))||
     new Set(names).size!==names.length)
    blocked('DEV_EDGE_AGENT_IDS_INVALID');
}
function verifyIdentity(value:unknown,requested:string[]):DeveloperIdentity {
  if(!value||typeof value!=='object'||Array.isArray(value))
    blocked('DEV_EDGE_IDENTITY_INVALID');
  const v=value as Record<string,any>;
  if(Object.keys(v).sort().join('|')!==
       'agents|boot_id|node_id|node_sequence|private_key_pem|public_key_pem'||
     !NODE.test(v.node_id||'')||!BOOT.test(v.boot_id||'')||
     !Number.isSafeInteger(v.node_sequence)||v.node_sequence<0||
     !Array.isArray(v.agents)||v.agents.length!==requested.length||
     v.agents.some((x:any,i:number)=>!x||typeof x!=='object'||
       Object.keys(x).sort().join('|')!=='id|sequence'||
       x.id!==requested[i]||!Number.isSafeInteger(x.sequence)||x.sequence<0)||
     typeof v.private_key_pem!=='string'||v.private_key_pem.length>8000||
     typeof v.public_key_pem!=='string'||v.public_key_pem.length>4000)
    blocked('DEV_EDGE_IDENTITY_INVALID_OR_AGENT_ROSTER_CHANGED');
  try{
    const key=crypto.createPrivateKey(v.private_key_pem);
    const pub=crypto.createPublicKey(v.public_key_pem);
    if(key.asymmetricKeyType!=='ed25519'||pub.asymmetricKeyType!=='ed25519'||
       !crypto.createPublicKey(key).export({type:'spki',format:'der'})
         .equals(pub.export({type:'spki',format:'der'})))
      blocked('DEV_EDGE_IDENTITY_KEY_MISMATCH');
  }catch{blocked('DEV_EDGE_IDENTITY_KEY_MISMATCH');}
  return v as DeveloperIdentity;
}
function readStored(file:string,requested:string[]):DeveloperIdentity|null {
  const stat=statOrNull(file);
  if(!stat)return null;
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<150||stat.size>MAX_BYTES||
     (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    blocked('DEV_EDGE_IDENTITY_FILE_UNSAFE');
  let value:unknown;
  try{value=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{blocked('DEV_EDGE_IDENTITY_CORRUPT');}
  return verifyIdentity(value,requested);
}
function atomicIdentityWrite(dir:string,file:string,value:DeveloperIdentity):void {
  const current=statOrNull(file);
  if(current&&(!current.isFile()||current.isSymbolicLink()||
       (process.platform!=='win32'&&(current.mode&0o077)!==0)))
    blocked('DEV_EDGE_IDENTITY_FILE_UNSAFE');
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(bytes.length>MAX_BYTES)blocked('DEV_EDGE_IDENTITY_TOO_LARGE');
  const tmp=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
    (fs.constants.O_NOFOLLOW||0);
  let fd:number|undefined,renamed=false;
  try{
    fd=fs.openSync(tmp,flags,0o600);
    let offset=0;
    while(offset<bytes.length){
      const n=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
      if(n<=0)blocked('DEV_EDGE_IDENTITY_SHORT_WRITE');
      offset+=n;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,file);renamed=true;
    syncDirectory(dir);
  }catch(e){
    if(!renamed){try{fs.unlinkSync(tmp);}catch{}}
    throw e; // Never claim a successful write if fsync/rename failed.
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function openDeveloperIdentity(dir:string,names:string[]):DeveloperIdentitySession {
  validAgentNames(names);
  privateDirectory(dir);
  const file=path.join(dir,'identity.json'),lock=path.join(dir,'edge-owner.lock');
  const token=crypto.randomUUID(),lockBytes=Buffer.from(JSON.stringify({
    schema:1,pid:process.pid,started_at:new Date().toISOString(),token})+'\n');
  let lockFd:number;
  try{
    lockFd=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
  }catch(e:any){
    if(e?.code==='EEXIST')blocked('DEV_EDGE_ALREADY_RUNNING_OR_CRASH_UNRECONCILED');
    throw e;
  }
  let lockStat:fs.Stats,poisoned=false,closed=false;
  try{
    lockStat=fs.fstatSync(lockFd);
    fs.writeSync(lockFd,lockBytes,0,lockBytes.length,0);
    fs.fsyncSync(lockFd);
    fs.closeSync(lockFd);
    syncDirectory(dir);
  }catch(e){
    try{fs.closeSync(lockFd!);}catch{}
    // A partial lock is evidence of ambiguous startup. Owner resolves it.
    throw e;
  }
  function release():void {
    if(closed||poisoned)return;
    closed=true;
    try{
      const current=statOrNull(lock);
      if(current&&current.isFile()&&!current.isSymbolicLink()&&
         current.dev===lockStat.dev&&current.ino===lockStat.ino&&
         fs.readFileSync(lock).equals(lockBytes)){
        fs.unlinkSync(lock);syncDirectory(dir);
      }
    }catch{ /* leave a stale lock for Owner inspection, never steal it */ }
  }
  try{
    let prior=readStored(file,names);
    if(!prior){
      // Any residual marker/outbox/temp file means this PC may have been
      // enrolled before. Do not silently generate another Ed25519 identity.
      if(fs.readdirSync(dir).some(x=>x!==path.basename(lock)))
        blocked('DEV_EDGE_MISSING_IDENTITY_OWNER_RECOVERY_REQUIRED');
      const pair=crypto.generateKeyPairSync('ed25519');
      prior={node_id:'node_'+crypto.randomUUID().replace(/-/g,''),
        boot_id:'boot_'+crypto.randomUUID().replace(/-/g,''),
        private_key_pem:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
        public_key_pem:pair.publicKey.export({type:'spki',format:'pem'}).toString(),
        node_sequence:0,agents:names.map(id=>({id,sequence:0}))};
    }else if(prior.agents.some((x,i)=>x.id!==names[i])){
      blocked('DEV_EDGE_AGENT_ROSTER_OWNER_REVIEW_REQUIRED');
    }
    const state={...prior,boot_id:'boot_'+crypto.randomUUID().replace(/-/g,''),
      agents:prior.agents.map(x=>({...x}))};
    atomicIdentityWrite(dir,file,state);
    let committed:DeveloperIdentity=structuredClone(state);
    return {state,persistHeartbeat(candidate:DeveloperIdentity):void{
      if(poisoned)blocked('DEV_EDGE_IDENTITY_COMMIT_UNCERTAIN');
      const fresh=readStored(file,names);
      if(!fresh||JSON.stringify(fresh)!==JSON.stringify(committed)){
        poisoned=true;
        blocked('DEV_EDGE_IDENTITY_EXTERNAL_CHANGE_OR_ROLLBACK');
      }
      if(candidate.node_id!==committed.node_id||
         candidate.private_key_pem!==committed.private_key_pem||
         candidate.public_key_pem!==committed.public_key_pem||
         candidate.boot_id!==committed.boot_id||
         candidate.agents.length!==committed.agents.length||
         !Number.isSafeInteger(candidate.node_sequence)||
         candidate.node_sequence!==committed.node_sequence+1||
         candidate.agents.some((x,i)=>x.id!==committed.agents[i].id||
           !Number.isSafeInteger(x.sequence)||
           x.sequence!==committed.agents[i].sequence+1)){
        poisoned=true;blocked('DEV_EDGE_HEARTBEAT_REPLAY_OR_IDENTITY_MUTATION');
      }
      try{atomicIdentityWrite(dir,file,candidate);}
      catch(e){poisoned=true;throw e;}
      committed=structuredClone(candidate);
    },release};
  }catch(e){
    // Retain the lock after any uncertain startup, so a crash or disk error
    // cannot silently result in a second process/rekey. Owner review needed.
    poisoned=true;
    throw e;
  }
}
