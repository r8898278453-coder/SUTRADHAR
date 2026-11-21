'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {requireNoInstallerIncident}=
  require('../apps/desktop/maintenance-install-incident-barrier.cjs');
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-incident-gate-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('no incident permits ordinary agent start',()=>fixture(dir=>{
  assert.equal(requireNoInstallerIncident({dir}).installer_incident,false);
}));
test('attempt, failed review and exception independently block automatic restart',()=>fixture(dir=>{
  for(const file of ['installer-execution-attempt.json',
    'installer-failure-review-observed.json',
    'installer-failure-exception-reviewed.json']){
    const p=path.join(dir,file);
    fs.writeFileSync(p,'interrupted');
    assert.throws(()=>requireNoInstallerIncident({dir}),/AUTOMATIC_AGENT_START_BLOCKED/);
    assert.equal(requireNoInstallerIncident({dir,manualOwnerRestart:true})
      .installer_incident,true);
    fs.unlinkSync(p);
  }
}));
test('unsafe directory / symlink never bypasses guard',()=>fixture(dir=>{
  assert.throws(()=>requireNoInstallerIncident({dir:'relative'}),
    /DIRECTORY_INVALID/);
  const alias=dir+'-link';
  try{fs.symlinkSync(dir,alias,'dir');
    assert.throws(()=>requireNoInstallerIncident({dir:alias}),/DIRECTORY_UNSAFE/);
  }finally{try{fs.unlinkSync(alias);}catch{}}
}));
