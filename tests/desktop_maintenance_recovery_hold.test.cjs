'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const nodeId='node_'+'a'.repeat(32),offerSha256='b'.repeat(64);
const intent={nodeId,planId:'plan_123',waveId:'wave_alpha3',offerSha256,now:1700000000000};
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-hold-test-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('crash-persistent hold survives inspect and never grants installer access',()=>fixture(dir=>{
  assert.equal(inspectHold({dir,nodeId}).agent_start_allowed,true);
  const created=createHold({dir,...intent});
  assert.equal(created.created,true);
  const observed=inspectHold({dir,nodeId});
  assert.equal(observed.active,true);
  assert.equal(observed.agent_start_allowed,false);
  assert.equal(observed.installer_execution_allowed,false);
  assert.equal(observed.owner_release_allowed,false);
  assert.equal(createHold({dir,...intent}).created,false);
  assert.throws(()=>createHold({dir,...intent,planId:'plan_different'}),/CONFLICT/);
  assert.throws(()=>inspectHold({dir,nodeId:'node_'+'c'.repeat(32)}),/IDENTITY_MISMATCH/);
}));
test('corrupt, interrupted and symlink hold files remain fail closed',()=>fixture(dir=>{
  const file=path.join(dir,'maintenance-recovery-hold.json');
  fs.writeFileSync(file,'{"schema":1');
  assert.throws(()=>inspectHold({dir,nodeId}),/FILE_INVALID|CORRUPT/);
  assert.throws(()=>createHold({dir,...intent}),/FILE_INVALID|CORRUPT/);
  fs.rmSync(file);
  fs.writeFileSync(file,'x'.repeat(200));
  assert.throws(()=>inspectHold({dir,nodeId}),/CORRUPT/);
  fs.rmSync(file);
  const elsewhere=path.join(dir,'elsewhere');
  fs.writeFileSync(elsewhere,'x'.repeat(200));
  fs.symlinkSync(elsewhere,file);
  assert.throws(()=>inspectHold({dir,nodeId}),/FILE_INVALID/);
}));
test('reject invalid identity, rollout and unsafe node directory',()=>fixture(dir=>{
  for(const patch of [{nodeId:'other'},{planId:'../escape'},
    {waveId:'invalid'},{offerSha256:'A'.repeat(64)},{now:-1}])
    assert.throws(()=>createHold({dir,...intent,...patch}),/RECORD_INVALID/);
  const pathToFile=path.join(dir,'notadir');
  fs.writeFileSync(pathToFile,'hello');
  assert.throws(()=>inspectHold({dir:pathToFile,nodeId}),/DIRECTORY_INVALID/);
}));
