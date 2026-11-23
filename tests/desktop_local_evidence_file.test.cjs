'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readEvidenceBytes,evidenceEntryPresent}=
  require('../apps/desktop/local-evidence-file.cjs');
function withDir(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-qa-evidence-read-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('bounded QA read returns exact bytes and rejects oversize and missing evidence',()=>withDir(dir=>{
  const p=path.join(dir,'qa-signed.json'),content=Buffer.from('{"test":"QA"}');
  fs.writeFileSync(p,content);
  assert.deepEqual(readEvidenceBytes(p,{maxBytes:8192}),content);
  assert.throws(()=>readEvidenceBytes(p,{maxBytes:5}),/FILE_UNSAFE/);
  assert.throws(()=>readEvidenceBytes('relative.json'),/READ_ARGUMENT_INVALID/);
  assert.throws(()=>readEvidenceBytes(path.join(dir,'missing.json')),/FILE_UNSAFE/);
  assert.equal(evidenceEntryPresent(path.join(dir,'missing.json')),false);
}));
test('QA replay guard preserves dangling journal alias as present, never new request',()=>withDir(dir=>{
  if(process.platform==='win32')return;
  const p=path.join(dir,'qa_central_evidence_ticket_abc_pending.json');
  fs.symlinkSync(path.join(dir,'absent-receipt'),p);
  assert.equal(fs.existsSync(p),false);
  assert.equal(evidenceEntryPresent(p),true);
  assert.throws(()=>readEvidenceBytes(p),/FILE_UNSAFE/);
}));
test('unexpected journal access error fails closed',()=>{
  const p=path.join(os.tmpdir(),'qa-upload-journal.json');
  assert.throws(()=>evidenceEntryPresent('relative.json'),/PATH_INVALID/);
  assert.throws(()=>evidenceEntryPresent(p,{io:{lstatSync(){
    throw Object.assign(Error('permission'),{code:'EACCES'});
  }}}),/PATH_UNCERTAIN_OWNER_REVIEW/);
});
test('in-place truncated read is refused',()=>withDir(dir=>{
  const file=path.join(dir,'result.json');fs.writeFileSync(file,'{"case":true}');
  assert.throws(()=>readEvidenceBytes(file,{io:{...fs,readSync:()=>0}}),
    /READ_SHORT_OR_INVALID/);
}));
test('same-byte inode substitution before and during a QA journal read is refused',()=>withDir(dir=>{
  const file=path.join(dir,'receipt.json'),bytes=Buffer.from('{"case":true}');
  fs.writeFileSync(file,bytes);
  const beforeOpen={...fs,openSync(p,...args){
    fs.renameSync(p,p+'.prior');fs.writeFileSync(p,bytes);return fs.openSync(p,...args);
  }};
  assert.throws(()=>readEvidenceBytes(file,{io:beforeOpen}),/FILE_CHANGED/);
  const duringRead={...fs,readSync(fd,buf,offset,len,pos){
    const n=fs.readSync(fd,buf,offset,len,pos);
    if(!this.swapped){
      this.swapped=true;
      fs.renameSync(file,file+'.previous');
      fs.writeFileSync(file,bytes);
    }
    return n;
  }};
  assert.throws(()=>readEvidenceBytes(file,{io:duringRead}),/FILE_CHANGED/);
  assert.equal(duringRead.swapped,true);
}));
test('packaged QA/worker readers use one descriptor-based contract',()=>{
  const folder=path.resolve(__dirname,'../apps/desktop');
  const pkg=require('../apps/desktop/package.json');
  assert.ok(pkg.build.files.includes('local-evidence-file.cjs'));
  for(const name of ['qa-evidence-submit.cjs','qa-evidence.cjs',
    'worker-claim.cjs','qa-handoff.cjs']){
    const source=fs.readFileSync(path.join(folder,name),'utf8');
    assert.ok(source.includes("require('./local-evidence-file.cjs')"),name);
    assert.ok(source.includes('readEvidenceBytes('),name);
  }
  const upload=fs.readFileSync(path.join(folder,'qa-evidence-submit.cjs'),'utf8');
  assert.doesNotMatch(upload,/fs\.existsSync\(/);
});
