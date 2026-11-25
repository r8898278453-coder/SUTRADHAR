/**
 * Bounded local evidence reader for QA/worker journals whose bytes are
 * separately checked by signed Central/OS-vault contracts. No secret-mode
 * requirement: operator-selected bundle manifests may be public.
 *
 * This is a descriptor/pathname identity guard, not evidence authenticity.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function evidenceEntryPresent(file,{io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||!io||
     typeof io.lstatSync!=='function')
    throw Error('LOCAL_EVIDENCE_PATH_INVALID');
  try{io.lstatSync(file);return true;}
  catch(error){
    if(error?.code==='ENOENT')return false;
    throw Error('LOCAL_EVIDENCE_PATH_UNCERTAIN_OWNER_REVIEW');
  }
}
function readEvidenceBytes(file,{minBytes=1,maxBytes=65536,io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !Number.isSafeInteger(minBytes)||minBytes<1||
     !Number.isSafeInteger(maxBytes)||maxBytes<minBytes||maxBytes>65536||
     !io||typeof io.lstatSync!=='function')
    throw Error('LOCAL_EVIDENCE_READ_ARGUMENT_INVALID');
  const valid=s=>s&&s.isFile()&&!s.isSymbolicLink()&&
    s.size>=minBytes&&s.size<=maxBytes;
  const same=(a,b)=>valid(a)&&valid(b)&&a.dev===b.dev&&
    a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&
    a.ctimeMs===b.ctimeMs;
  let original;
  try{original=io.lstatSync(file);}
  catch{throw Error('LOCAL_EVIDENCE_FILE_UNSAFE');}
  if(!valid(original))throw Error('LOCAL_EVIDENCE_FILE_UNSAFE');
  let fd;
  try{
    try{fd=io.openSync(file,fs.constants.O_RDONLY|
      (fs.constants.O_NOFOLLOW||0));}
    catch{throw Error('LOCAL_EVIDENCE_FILE_UNSAFE');}
    const opened=io.fstatSync(fd);
    if(!same(original,opened))throw Error('LOCAL_EVIDENCE_FILE_CHANGED');
    const raw=Buffer.alloc(opened.size);
    let offset=0;
    while(offset<raw.length){
      const count=io.readSync(fd,raw,offset,raw.length-offset,offset);
      if(!Number.isSafeInteger(count)||count<1||
         count>raw.length-offset)
        throw Error('LOCAL_EVIDENCE_READ_SHORT_OR_INVALID');
      offset+=count;
    }
    if(!same(opened,io.fstatSync(fd))||
       !same(opened,io.lstatSync(file)))
      throw Error('LOCAL_EVIDENCE_FILE_CHANGED');
    return raw;
  }finally{if(fd!==undefined)io.closeSync(fd);}
}
module.exports={evidenceEntryPresent,readEvidenceBytes};
