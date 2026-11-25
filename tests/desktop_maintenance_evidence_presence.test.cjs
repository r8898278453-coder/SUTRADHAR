'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evidenceEntryPresent}=require('../apps/desktop/maintenance-evidence-presence.cjs');
function fixture(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-maint-entry-'));
  try{return run(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('only absent directory entries return false',()=>fixture(dir=>{
  const file=path.join(dir,'attempt.json');
  assert.equal(evidenceEntryPresent(file),false);
  fs.writeFileSync(file,'unfinished');
  assert.equal(evidenceEntryPresent(file),true);
  fs.mkdirSync(path.join(dir,'escrow'));
  assert.equal(evidenceEntryPresent(path.join(dir,'escrow')),true);
}));
test('dangling symlink remains present as Owner-review evidence',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  const file=path.join(dir,'installer-execution-attempt.json');
  fs.symlinkSync(path.join(dir,'missing-target'),file);
  assert.equal(fs.existsSync(file),false);
  assert.equal(evidenceEntryPresent(file),true);
}));
test('uncertain access errors fail closed rather than masquerade as ENOENT',()=>{
  const file=path.join(os.tmpdir(),'sut-evidence.json');
  assert.throws(()=>evidenceEntryPresent('relative.json'),/PATH_INVALID/);
  assert.throws(()=>evidenceEntryPresent(file,{io:{lstatSync(){
    throw Object.assign(Error('permission'),{code:'EACCES'});
  }}}),/PATH_UNCERTAIN_OWNER_REVIEW/);
  assert.equal(evidenceEntryPresent(file,{io:{lstatSync(){
    throw Object.assign(Error('not found'),{code:'ENOENT'});
  }}}),false);
});
test('installer preparation, execution and observation paths use the shared presence guard',()=>{
  const listed=require('../apps/desktop/package.json').build.files;
  assert.ok(listed.includes('maintenance-evidence-presence.cjs'));
  for(const name of ['maintenance-install-preparation.cjs',
    'maintenance-installer-execution.cjs',
    'maintenance-postinstall-verification.cjs']){
    const source=fs.readFileSync(path.join(__dirname,'../apps/desktop',name),'utf8');
    assert.ok(source.includes("require('./maintenance-evidence-presence.cjs')"),name);
    assert.ok(source.includes('evidenceEntryPresent('),name);
    assert.doesNotMatch(source,/fs\.existsSync\(/,name);
  }
});
