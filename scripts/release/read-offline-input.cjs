/**
 * Bounded, descriptor-stable, strict UTF-8 reader for offline Owner-review CLI
 * inputs. A pathname preflight alone is unsafe: another actor could replace
 * a signed index or evidence manifest between lstat and readFileSync.
 * Public verification keys need not be mode 0600; NO trust is granted here.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function readOfflineText(file,{minBytes=1,maxBytes=131072,io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.length>2048||
     !Number.isSafeInteger(minBytes)||minBytes<1||
     !Number.isSafeInteger(maxBytes)||maxBytes<minBytes||maxBytes>131072||
     !io||typeof io.lstatSync!=='function')
    throw Error('OFFLINE_INPUT_ARGUMENTS_INVALID');
  const safe=s=>s&&s.isFile()&&!s.isSymbolicLink()&&
    s.size>=minBytes&&s.size<=maxBytes;
  const same=(a,b)=>safe(a)&&safe(b)&&a.dev===b.dev&&a.ino===b.ino&&
    a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
  const prior=io.lstatSync(file);
  if(!safe(prior))throw Error('OFFLINE_INPUT_FILE_UNSAFE');
  const fd=io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const opened=io.fstatSync(fd);
    if(!same(prior,opened))throw Error('OFFLINE_INPUT_FILE_CHANGED');
    const buffer=Buffer.alloc(opened.size);
    let offset=0;
    while(offset<buffer.length){
      const n=io.readSync(fd,buffer,offset,buffer.length-offset,offset);
      if(!Number.isSafeInteger(n)||n<=0||n>buffer.length-offset)
        throw Error('OFFLINE_INPUT_TRUNCATED');
      offset+=n;
    }
    if(!same(opened,io.fstatSync(fd))||
       !same(opened,io.lstatSync(file)))
      throw Error('OFFLINE_INPUT_FILE_CHANGED');
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  }finally{io.closeSync(fd);}
}
module.exports={readOfflineText};
