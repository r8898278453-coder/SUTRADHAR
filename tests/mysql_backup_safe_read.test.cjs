'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {readEncryptedArchive,MAX_ARCHIVE_BYTES}=
  require('../scripts/ops/backup-safe-read.cjs');
const {encryptDump,decryptDump}=require('../scripts/ops/backup-crypto.cjs');
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-safe-backup-'));
  try{return fn(dir);}
  finally{fs.rmSync(dir,{force:true,recursive:true});}
}
function archive(file){
  const key=crypto.randomBytes(32).toString('base64');
  const bytes=encryptDump(Buffer.alloc(1024,0x61),{
    keyBase64:key,sourceDb:'sut_backup_ci'});
  fs.writeFileSync(file,bytes,{flag:'wx'});
  return {key,bytes};
}
test('descriptor-based reader verifies a real unmodified encrypted archive',()=>fixture(dir=>{
  const file=path.join(dir,'archive.json'),{key,bytes}=archive(file);
  const loaded=readEncryptedArchive(file);
  assert.deepEqual(loaded,bytes);
  assert.equal(decryptDump(loaded,{keyBase64:key,expectedSourceDb:'sut_backup_ci'})
    .plain.length,1024);
  assert.equal(MAX_ARCHIVE_BYTES,160*1024*1024);
  assert.throws(()=>readEncryptedArchive(file,{maxBytes:bytes.length-1}),
    /BACKUP_ARCHIVE_FILE_UNSAFE/);
}));
test('a symlink at archive pathname never gets read',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  const target=path.join(dir,'valid.json'),link=path.join(dir,'link.json');
  archive(target);fs.symlinkSync(target,link);
  assert.throws(()=>readEncryptedArchive(link),/BACKUP_ARCHIVE_FILE_UNSAFE/);
}));
test('symlink swapped between initial lstat and descriptor open is rejected',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  const file=path.join(dir,'archive.json'),other=path.join(dir,'other.json');
  const {bytes}=archive(file);fs.writeFileSync(other,bytes);
  const io={...fs,openSync(name,flags){
    fs.renameSync(file,path.join(dir,'original.json'));
    fs.symlinkSync(other,file);
    return fs.openSync(name,flags);
  }};
  assert.throws(()=>readEncryptedArchive(file,{io}),/BACKUP_ARCHIVE_FILE_UNSAFE/);
  assert.deepEqual(fs.readFileSync(other),bytes);
}));
test('path replaced with another regular archive while fd is open is rejected',()=>fixture(dir=>{
  const file=path.join(dir,'archive.json'),replacement=path.join(dir,'replacement.json');
  const {bytes}=archive(file);
  fs.writeFileSync(replacement,bytes);
  let replaced=false;
  const io={...fs,readSync(...args){
    const count=fs.readSync(...args);
    if(!replaced){
      replaced=true;
      fs.renameSync(file,path.join(dir,'original.json'));
      fs.renameSync(replacement,file);
    }
    return count;
  }};
  assert.throws(()=>readEncryptedArchive(file,{io}),/BACKUP_ARCHIVE_FILE_CHANGED/);
  assert.equal(replaced,true);
}));
test('short read refuses truncated archive rather than returning partial encrypted bytes',()=>fixture(dir=>{
  const file=path.join(dir,'archive.json');
  archive(file);
  const io={...fs,readSync:()=>0};
  assert.throws(()=>readEncryptedArchive(file,{io}),/BACKUP_ARCHIVE_FILE_CHANGED/);
}));
