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

test('dangling maintenance HOLD never permits automatic agent restart',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  const file=path.join(dir,'maintenance-recovery-hold.json');
  fs.symlinkSync(path.join(dir,'missing-hold-target'),file);
  assert.equal(fs.existsSync(file),false,'demonstrates dangling-link hazard');
  assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
  assert.throws(()=>inspectHold({dir,nodeId}),/MAINTENANCE_HOLD_FILE_INVALID/);
  assert.throws(()=>createHold({dir,...intent}),/MAINTENANCE_HOLD_FILE_INVALID/);
  assert.equal(fs.lstatSync(file).isSymbolicLink(),true,'preserve original evidence');
}));
test('swapped symlink after hold lstat is refused instead of following target bytes',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  createHold({dir,...intent});
  const file=path.join(dir,'maintenance-recovery-hold.json');
  const saved=path.join(dir,'original-hold.json');
  const other=path.join(dir,'unrelated.json');
  fs.writeFileSync(other,fs.readFileSync(file),{mode:0o600});
  let changed=false;
  const open=fs.openSync;
  try{
    fs.openSync=function(target,...args){
      if(target===file&&!changed){
        changed=true;
        fs.renameSync(file,saved);
        fs.symlinkSync(other,file);
      }
      return open.call(fs,target,...args);
    };
    assert.throws(()=>inspectHold({dir,nodeId}),
      /MAINTENANCE_HOLD_CORRUPT_OWNER_REVIEW_REQUIRED/);
  }finally{fs.openSync=open;}
  assert.equal(changed,true);
  assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
  assert.throws(()=>inspectHold({dir,nodeId}),/MAINTENANCE_HOLD_FILE_INVALID/);
}));
test('same-content inode replacement during hold read cannot authorize restart',()=>fixture(dir=>{
  createHold({dir,...intent});
  const file=path.join(dir,'maintenance-recovery-hold.json');
  const other=path.join(dir,'replacement.json');
  fs.writeFileSync(other,fs.readFileSync(file),{mode:0o600});
  const read=fs.readSync;
  let replaced=false;
  try{
    fs.readSync=function(...args){
      const n=read(...args);
      if(!replaced){
        replaced=true;
        fs.renameSync(file,path.join(dir,'original.json'));
        fs.renameSync(other,file);
      }
      return n;
    };
    assert.throws(()=>inspectHold({dir,nodeId}),
      /MAINTENANCE_HOLD_CORRUPT_OWNER_REVIEW_REQUIRED/);
  }finally{fs.readSync=read;}
  assert.equal(replaced,true);
  assert.equal(fs.lstatSync(file).isFile(),true);
}));
test('exposed hold record is refused, never considered safe to clear',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  createHold({dir,...intent});
  const file=path.join(dir,'maintenance-recovery-hold.json');
  fs.chmodSync(file,0o644);
  assert.throws(()=>inspectHold({dir,nodeId}),
    /MAINTENANCE_HOLD_CORRUPT_OWNER_REVIEW_REQUIRED/);
  assert.throws(()=>createHold({dir,...intent}),
    /MAINTENANCE_HOLD_CORRUPT_OWNER_REVIEW_REQUIRED/);
}));
