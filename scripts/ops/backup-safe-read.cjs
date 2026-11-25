/**
 * Open an authenticated encrypted backup archive by descriptor, not by
 * pathname after lstat. Refuse symlink swaps, truncation and changed inode.
 *
 * The AES-GCM tag separately authenticates bytes. This protects the
 * operator's read path, not arbitrary privileged filesystem tampering.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {MAX_DUMP_BYTES}=require('./backup-crypto.cjs');
const MAX_ARCHIVE_BYTES=MAX_DUMP_BYTES*2;
function fail(code){throw Error(code);}
function identity(a,b){
  return a&&b&&a.isFile()&&b.isFile()&&!a.isSymbolicLink()&&
    !b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&
    a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
}
function readEncryptedArchive(file,{io=fs,maxBytes=MAX_ARCHIVE_BYTES}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_ARCHIVE_BYTES)
    fail('BACKUP_ARCHIVE_PATH_OR_LIMIT_INVALID');
  let first;
  try{first=io.lstatSync(file);}
  catch{fail('BACKUP_ARCHIVE_FILE_UNSAFE');}
  if(!first.isFile()||first.isSymbolicLink()||
     first.size<1||first.size>maxBytes)
    fail('BACKUP_ARCHIVE_FILE_UNSAFE');
  let fd;
  try{
    try{
      fd=io.openSync(file,fs.constants.O_RDONLY|
        (fs.constants.O_NOFOLLOW||0));
    }catch{fail('BACKUP_ARCHIVE_FILE_UNSAFE');}
    const opened=io.fstatSync(fd);
    if(!identity(first,opened))
      fail('BACKUP_ARCHIVE_FILE_CHANGED');
    const bytes=Buffer.alloc(opened.size);
    let position=0;
    while(position<bytes.length){
      let n;
      try{n=io.readSync(fd,bytes,position,bytes.length-position,position);}
      catch{fail('BACKUP_ARCHIVE_FILE_CHANGED');}
      if(!Number.isSafeInteger(n)||n<=0)
        fail('BACKUP_ARCHIVE_FILE_CHANGED');
      position+=n;
    }
    // A process may replace the pathname after open; use both file descriptor
    // identity and current path identity before handing bytes to decryptDump.
    let currentPath,currentFd;
    try{currentFd=io.fstatSync(fd);currentPath=io.lstatSync(file);}
    catch{fail('BACKUP_ARCHIVE_FILE_CHANGED');}
    if(!identity(opened,currentFd)||!identity(opened,currentPath))
      fail('BACKUP_ARCHIVE_FILE_CHANGED');
    return bytes;
  }finally{
    if(fd!==undefined)io.closeSync(fd);
  }
}
module.exports={readEncryptedArchive,MAX_ARCHIVE_BYTES};
