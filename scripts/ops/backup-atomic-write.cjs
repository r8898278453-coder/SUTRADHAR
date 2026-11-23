/**
 * Atomically publish a fully fsynced encrypted archive without ever replacing
 * a preexisting destination. Do not fallback to rename() if hard links fail.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function writeEncryptedArchive(file,bytes){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !Buffer.isBuffer(bytes)||bytes.length===0)
    throw Error('BACKUP_DESTINATION_OR_BYTES_INVALID');
  const parent=path.dirname(file);
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const parentStat=fs.lstatSync(parent);
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink())
    throw Error('BACKUP_DESTINATION_DIRECTORY_UNSAFE');
  const temp=path.join(parent,'.'+path.basename(file)+'.'+process.pid+'.'+
    crypto.randomBytes(8).toString('hex')+'.tmp');
  let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    try{
      // link is exclusive: a racing process (or a symlink target) gets EEXIST.
      // It never replaces an existing archive, unlike renameSync.
      fs.linkSync(temp,file);
    }catch(e){
      if(e?.code==='EEXIST')throw Error('BACKUP_DESTINATION_ALREADY_EXISTS');
      throw e;
    }
    return Object.freeze({created:true,encrypted_bytes:bytes.length});
  }finally{
    if(fd!==undefined){try{fs.closeSync(fd);}catch{}}
    try{fs.rmSync(temp,{force:true});}catch{}
  }
}
module.exports={writeEncryptedArchive};
