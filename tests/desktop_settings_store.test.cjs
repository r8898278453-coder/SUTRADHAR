'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {readDesktopSettings,writeDesktopSettings,MAX_SETTINGS_BYTES}=require('../apps/desktop/settings-store.cjs');
const data={centralUrl:'https://stage.example.com',pcName:'PC One',agentIds:['agent_alpha_001']};
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-settings-'));
  try{return fn(path.join(dir,'desktop-settings.json'),dir);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('first-run file is stored once and cannot be replaced',()=>fixture(file=>{
  assert.equal(readDesktopSettings({file}),null);
  assert.equal(writeDesktopSettings({file,settings:data}).stored,true);
  assert.deepEqual(readDesktopSettings({file}),data);
  const bytes=fs.readFileSync(file);
  assert.throws(()=>writeDesktopSettings({file,settings:{...data,pcName:'PC Two'}}),
    /ALREADY_PRESENT_OWNER_REVIEW_REQUIRED/);
  assert.deepEqual(fs.readFileSync(file),bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['desktop-settings.json']);
  if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o077,0);
}));
test('malformed, oversized, symlinked and secret-bearing config fails closed',()=>fixture((file,dir)=>{
  fs.writeFileSync(file,Buffer.alloc(MAX_SETTINGS_BYTES+1,0x61));
  assert.throws(()=>readDesktopSettings({file}),/FILE_UNSAFE/);
  fs.writeFileSync(file,JSON.stringify({...data,ownerGrant:'secret'}));
  assert.throws(()=>readDesktopSettings({file}),/SHAPE_INVALID/);
  fs.writeFileSync(file,JSON.stringify({...data,centralUrl:'http://bad.example.com'}));
  assert.throws(()=>readDesktopSettings({file}),/VALUES_INVALID/);
  fs.writeFileSync(file,'{');
  assert.throws(()=>readDesktopSettings({file}),/FILE_UNSAFE|JSON_INVALID/);
  if(process.platform!=='win32'){
    const original=path.join(dir,'original.json');
    fs.renameSync(file,original);fs.symlinkSync(original,file);
    assert.throws(()=>readDesktopSettings({file}),/FILE_UNSAFE/);
  }
}));
test('untrusted agent list and extra fields cannot persist',()=>fixture(file=>{
  for(const bad of [{...data,agentIds:['agent_abc','agent_abc']},
    {...data,private_key_pem:'bad'}]){
    assert.throws(()=>writeDesktopSettings({file,settings:bad}),/DESKTOP_SETTINGS_/);
    assert.equal(fs.existsSync(file),false);
  }
}));
test('two OS processes racing to save settings result in one complete winner',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-settings-race-'));
  try{
    const file=path.join(dir,'desktop-settings.json');
    const code="const m=require(process.env.SCRIPT);try{m.writeDesktopSettings({file:process.env.FILE,settings:JSON.parse(process.env.DATA)});process.exit(0)}catch(e){process.exit(e.message==='DESKTOP_SETTINGS_ALREADY_PRESENT_OWNER_REVIEW_REQUIRED'?21:22)}";
    const run=pcName=>new Promise((resolve,reject)=>{
      const child=cp.spawn(process.execPath,['-e',code],{stdio:'ignore',
        env:{...process.env,SCRIPT:path.resolve(__dirname,'../apps/desktop/settings-store.cjs'),
          FILE:file,DATA:JSON.stringify({...data,pcName})}});
      child.once('error',reject);child.once('exit',resolve);
    });
    assert.deepEqual((await Promise.all([run('PC A'),run('PC B')])).sort((a,b)=>a-b),[0,21]);
    assert.ok(['PC A','PC B'].includes(readDesktopSettings({file}).pcName));
    assert.deepEqual(fs.readdirSync(dir),['desktop-settings.json']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
