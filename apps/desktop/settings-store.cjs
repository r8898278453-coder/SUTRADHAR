/**
 * First-run settings: strict, bounded read, one-time atomic publication.
 * Never silently replace existing enrolled identities or settings.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateSettings}=require('./desktop-config.cjs');
const MAX_SETTINGS_BYTES=4096;
function fail(code){throw Error(code);}
function validPath(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     path.basename(file)!=='desktop-settings.json')
    fail('DESKTOP_SETTINGS_PATH_INVALID');
}
function validate(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).sort().join('|')!=='agentIds|centralUrl|pcName')
    fail('DESKTOP_SETTINGS_SHAPE_INVALID');
  try{return validateSettings(raw);}catch{fail('DESKTOP_SETTINGS_VALUES_INVALID');}
}
function readDesktopSettings({file}={}){
  validPath(file);
  let before;
  try{before=fs.lstatSync(file);}catch(error){
    if(error?.code==='ENOENT')return null;
    fail('DESKTOP_SETTINGS_READ_FAILED');
  }
  if(!before.isFile()||before.isSymbolicLink()||
     before.size<20||before.size>MAX_SETTINGS_BYTES)
    fail('DESKTOP_SETTINGS_FILE_UNSAFE');
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.size!==before.size||
       st.ino!==before.ino||st.dev!==before.dev)
      fail('DESKTOP_SETTINGS_FILE_CHANGED');
    const buffer=Buffer.alloc(st.size);
    let read=0;
    while(read<buffer.length){
      const bytes=fs.readSync(fd,buffer,read,buffer.length-read,read);
      if(bytes<1)fail('DESKTOP_SETTINGS_FILE_CHANGED');
      read+=bytes;
    }
    if(fs.readSync(fd,Buffer.alloc(1),0,1,read)!==0||
       fs.fstatSync(fd).size!==st.size)
      fail('DESKTOP_SETTINGS_FILE_CHANGED');
    let obj;
    try{obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}
    catch{fail('DESKTOP_SETTINGS_JSON_INVALID');}
    return validate(obj);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function writeDesktopSettings({file,settings}={}){
  validPath(file);
  const data=Buffer.from(JSON.stringify(validate(settings),null,2)+'\n');
  if(data.length>MAX_SETTINGS_BYTES)fail('DESKTOP_SETTINGS_TOO_LARGE');
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('DESKTOP_SETTINGS_FOLDER_UNSAFE');
  const temp=path.join(dir,'.desktop-settings.'+process.pid+'.'+
    crypto.randomBytes(8).toString('hex')+'.tmp');
  let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);
    fs.writeFileSync(fd,data);fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    try{fs.linkSync(temp,file);}catch(error){
      if(error?.code==='EEXIST')
        fail('DESKTOP_SETTINGS_ALREADY_PRESENT_OWNER_REVIEW_REQUIRED');
      throw error;
    }
    if(process.platform!=='win32'){
      const folder=fs.openSync(dir,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}
    }
    return Object.freeze({stored:true,replacement_allowed:false});
  }finally{
    if(fd!==undefined){try{fs.closeSync(fd);}catch{}}
    try{fs.rmSync(temp,{force:true});}catch{}
  }
}
module.exports={readDesktopSettings,writeDesktopSettings,MAX_SETTINGS_BYTES};
