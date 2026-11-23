/**
 * Stable, bounded local journal snapshot for the developer-only CLI.
 * The OS-vault packaged Desktop has a separate trust/identity boundary.
 * This helper is NOT cryptographic attestation or a physical durability proof.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
const fail=(code:string):never=>{throw Error(code);};
export function journalEntryPresent(file:string,io:typeof fs=fs):boolean{
  if(typeof file!=='string'||!path.isAbsolute(file))
    fail('JOURNAL_ENTRY_PATH_INVALID');
  try{io.lstatSync(file);return true;}
  catch(error:any){
    if(error?.code==='ENOENT')return false;
    fail('JOURNAL_ENTRY_STATE_UNCERTAIN');
  }
}
export function readStableJournal(file:string,{
  maxBytes,requirePrivate=false,io=fs
}:{
  maxBytes:number;requirePrivate?:boolean;io?:typeof fs
}):Buffer{
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>65536)
    fail('JOURNAL_SNAPSHOT_ARGUMENT_INVALID');
  const valid=(s:fs.Stats)=>s.isFile()&&!s.isSymbolicLink()&&
    s.size>0&&s.size<=maxBytes&&
    (!requirePrivate||process.platform==='win32'||(s.mode&0o077)===0);
  const same=(a:fs.Stats,b:fs.Stats)=>
    valid(a)&&valid(b)&&a.dev===b.dev&&a.ino===b.ino&&
    a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
  let before:fs.Stats,parent:string;
  try{
    before=io.lstatSync(file);
    parent=io.realpathSync.native(path.dirname(file));
  }catch{return fail('JOURNAL_SNAPSHOT_UNTRUSTED');}
  if(!valid(before))fail('JOURNAL_SNAPSHOT_UNTRUSTED');
  let fd:number|undefined;
  try{
    fd=io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const opened=io.fstatSync(fd);
    if(!same(before,opened))fail('JOURNAL_SNAPSHOT_CHANGED');
    const bytes=Buffer.alloc(opened.size);
    let offset=0;
    while(offset<bytes.length){
      const n=io.readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(!Number.isSafeInteger(n)||n<1||n>bytes.length-offset)
        fail('JOURNAL_SNAPSHOT_SHORT_READ');
      offset+=n;
    }
    if(!same(opened,io.fstatSync(fd))||
       !same(opened,io.lstatSync(file))||
       parent!==io.realpathSync.native(path.dirname(file)))
      fail('JOURNAL_SNAPSHOT_CHANGED');
    return bytes;
  }finally{if(fd!==undefined)io.closeSync(fd);}
}
