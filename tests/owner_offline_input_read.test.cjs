'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readOfflineText}=require('../scripts/release/read-offline-input.cjs');
function withDir(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-owner-read-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('bounded verification inputs read exactly, never requiring secret file mode',()=>withDir(dir=>{
  const p=path.join(dir,'public.pem');
  fs.writeFileSync(p,'PUBLIC-KEY\n');
  assert.equal(readOfflineText(p,{maxBytes:10000}),'PUBLIC-KEY\n');
  assert.throws(()=>readOfflineText(p,{minBytes:100}),/FILE_UNSAFE/);
  assert.throws(()=>readOfflineText(p,{maxBytes:131073}),/ARGUMENTS_INVALID/);
  assert.throws(()=>readOfflineText('relative.json'),/ARGUMENTS_INVALID/);
}));
test('symlink, oversized, invalid UTF-8, truncated file refused before accepting evidence',()=>withDir(dir=>{
  const good=path.join(dir,'good.json'),link=path.join(dir,'alias.json');
  fs.writeFileSync(good,'{"hello":"world"}');
  fs.symlinkSync(good,link);
  assert.throws(()=>readOfflineText(link),/FILE_UNSAFE/);
  fs.writeFileSync(good,'x'.repeat(201));
  assert.throws(()=>readOfflineText(good,{maxBytes:200}),/FILE_UNSAFE/);
  fs.writeFileSync(good,Buffer.from([0xc3,0x28]));
  assert.throws(()=>readOfflineText(good),/The encoded data was not valid|not valid|encoded data/i);
  fs.writeFileSync(good,'{"hello":"world"}');
  assert.throws(()=>readOfflineText(good,{io:{...fs,readSync:()=>0}}),/TRUNCATED/);
}));
test('same-content inode replacement during descriptor read is rejected',()=>withDir(dir=>{
  const file=path.join(dir,'signed-index.json');
  fs.writeFileSync(file,'{"signed":"test-fixture"}');
  const originalBytes=fs.readFileSync(file);
  const io={...fs,readSync(fd,buffer,offset,length,position){
    const n=fs.readSync(fd,buffer,offset,length,position);
    if(!this.swapped){
      this.swapped=true;
      fs.renameSync(file,file+'.old');
      fs.writeFileSync(file,originalBytes);
    }
    return n;
  }};
  assert.throws(()=>readOfflineText(file,{io}),/FILE_CHANGED/);
  assert.equal(io.swapped,true);
}));
test('first lstat to open file-swap is rejected before read',()=>withDir(dir=>{
  const file=path.join(dir,'input.json');
  fs.writeFileSync(file,'{"one":true}');
  const io={...fs,openSync(p,...args){
    fs.renameSync(p,p+'.original');
    fs.writeFileSync(p,'{"one":true}');
    return fs.openSync(p,...args);
  }};
  assert.throws(()=>readOfflineText(file,{io}),/FILE_CHANGED/);
}));
