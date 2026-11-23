'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readStableLocalFile}=require('../apps/desktop/os-vault.cjs');
const inspectSource=fs.readFileSync(
  path.join(__dirname,'../apps/desktop/enrollment-receipt.cjs'),'utf8');
const vaultSource=fs.readFileSync(
  path.join(__dirname,'../apps/desktop/os-vault.cjs'),'utf8');
function withDir(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-local-read-'));
  try{return run(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('identity and enrollment receipt use bounded descriptor reads rather than pathname reads',()=>{
  assert.match(inspectSource,/readStableLocalFile\(receipt,\{minBytes:100,maxBytes:4096\}\)/);
  assert.match(vaultSource,/readStableLocalFile\(file,\{minBytes:30,maxBytes:65536\}\)/);
  assert.doesNotMatch(inspectSource,/JSON\.parse\(fs\.readFileSync\(receipt,'utf8'\)\)/);
  assert.doesNotMatch(vaultSource,/JSON\.parse\(fs\.readFileSync\(file,'utf8'\)\)/);
});
test('small regular private file opens by fd and enforces a strict size cap',()=>withDir(dir=>{
  const file=path.join(dir,'receipt.json');
  const bytes=Buffer.from('authenticated node receipt bytes');
  fs.writeFileSync(file,bytes,{mode:0o600});
  assert.deepEqual(readStableLocalFile(file,{minBytes:10,maxBytes:100}),bytes);
  assert.throws(()=>readStableLocalFile(file,{minBytes:100,maxBytes:200}),
    /LOCAL_PRIVATE_FILE_UNSAFE/);
  assert.throws(()=>readStableLocalFile(file,{minBytes:1,maxBytes:65537}),
    /LOCAL_PRIVATE_FILE_ARGUMENT_INVALID/);
}));
test('initial symlink is rejected before any plaintext read',()=>withDir(dir=>{
  if(process.platform==='win32')return;
  const file=path.join(dir,'receipt.json'),link=path.join(dir,'link.json');
  fs.writeFileSync(file,'safe data',{mode:0o600});
  fs.symlinkSync(file,link);
  assert.throws(()=>readStableLocalFile(link),/LOCAL_PRIVATE_FILE_UNSAFE/);
}));
test('symlink swap between first lstat and open is rejected deterministically',()=>withDir(dir=>{
  if(process.platform==='win32')return;
  const file=path.join(dir,'receipt.json'),other=path.join(dir,'other.json');
  fs.writeFileSync(file,'receipt A',{mode:0o600});
  fs.writeFileSync(other,'receipt B',{mode:0o600});
  const injected={...fs,openSync(p,flags){
    fs.renameSync(file,path.join(dir,'original.json'));
    fs.symlinkSync(other,file);
    return fs.openSync(p,flags);
  }};
  assert.throws(()=>readStableLocalFile(file,{io:injected}),
    /LOCAL_PRIVATE_FILE_UNSAFE/);
}));
test('replacing a regular file after descriptor open fails, even with identical bytes',()=>withDir(dir=>{
  const file=path.join(dir,'identity.json'),second=path.join(dir,'second.json');
  fs.writeFileSync(file,'same bytes',{mode:0o600});
  fs.writeFileSync(second,'same bytes',{mode:0o600});
  let changed=false;
  const injected={...fs,readSync(...args){
    const n=fs.readSync(...args);
    if(!changed){
      changed=true;
      fs.renameSync(file,path.join(dir,'original.json'));
      fs.renameSync(second,file);
    }
    return n;
  }};
  assert.throws(()=>readStableLocalFile(file,{io:injected}),
    /LOCAL_PRIVATE_FILE_CHANGED/);
  assert.equal(changed,true);
}));
test('short read cannot return partially read sensitive identity or receipt',()=>withDir(dir=>{
  const file=path.join(dir,'identity.json');
  fs.writeFileSync(file,'encrypted metadata record',{mode:0o600});
  assert.throws(()=>readStableLocalFile(file,{io:{...fs,readSync:()=>0}}),
    /LOCAL_PRIVATE_FILE_CHANGED/);
}));
