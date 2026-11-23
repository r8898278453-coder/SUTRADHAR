'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {journalEntryPresent}=require('../apps/desktop/git-publish.cjs');
function withDir(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-git-publish-entry-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('Git publish one-shot intent and confirmation presence is directory-entry based',()=>withDir(dir=>{
  const file=path.join(dir,'git_publish_ticket_abc_intent.json');
  assert.equal(journalEntryPresent(file),false);
  fs.writeFileSync(file,'interrupted');
  assert.equal(journalEntryPresent(file),true);
  fs.unlinkSync(file);
  if(process.platform!=='win32'){
    fs.symlinkSync(path.join(dir,'missing-target'),file);
    assert.equal(fs.existsSync(file),false);
    assert.equal(journalEntryPresent(file),true);
  }
}));
test('ambiguous Git publish journal inspection cannot authorize a fresh remote write',()=>{
  const file=path.join(os.tmpdir(),'git_publish_ticket_abc_intent.json');
  assert.throws(()=>journalEntryPresent('relative.json'),/JOURNAL_PATH_INVALID/);
  assert.throws(()=>journalEntryPresent(file,{io:{lstatSync(){
    throw Object.assign(Error('denied'),{code:'EACCES'});
  }}}),/INSPECTION_UNCERTAIN_OWNER_REVIEW/);
  assert.equal(journalEntryPresent(file,{io:{lstatSync(){
    throw Object.assign(Error('missing'),{code:'ENOENT'});
  }}}),false);
});
test('Git publication source has no follows-link existence preflight',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../apps/desktop/git-publish.cjs'),'utf8');
  assert.doesNotMatch(source,/fs\.existsSync\(/);
  assert.match(source,/journalEntryPresent\(intentPath\)/);
  assert.match(source,/journalEntryPresent\(receiptPath\)/);
});
