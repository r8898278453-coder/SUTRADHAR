'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inspectBuildOutput,inventories}=require('../scripts/build-output-guard.cjs');
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sut-build-'));try{fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
function populate(dir,app){for(const file of inventories[app]){const p=path.join(dir,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture');}}
test('closed Central and Desktop inventories allow repeat builds but no extra files',()=>fixture(root=>{
  for(const app of ['central','desktop']){
    const dir=path.join(root,app);
    assert.equal(inspectBuildOutput(dir,app).accepted,true);
    populate(dir,app);
    assert.equal(inspectBuildOutput(dir,app,{complete:true}).files.length,inventories[app].length);
    fs.writeFileSync(path.join(dir,'unexpected-secret.txt'),'synthetic');
    assert.throws(()=>inspectBuildOutput(dir,app),/BUILD_OUTPUT_UNTRUSTED/);
    assert.equal(fs.readFileSync(path.join(dir,'unexpected-secret.txt'),'utf8'),'synthetic');
  }
}));
test('missing required file cannot pass post-build inventory',()=>fixture(root=>{
  populate(root,'central');fs.unlinkSync(path.join(root,'dashboard.js'));
  assert.throws(()=>inspectBuildOutput(root,'central',{complete:true}),/BUILD_OUTPUT_INCOMPLETE/);
}));
test('unexpected nested directory and hard-linked output are refused',()=>fixture(root=>{
  populate(root,'central');fs.mkdirSync(path.join(root,'v7','private'));
  assert.throws(()=>inspectBuildOutput(root,'central'),/BUILD_OUTPUT_UNTRUSTED/);
  fs.rmdirSync(path.join(root,'v7','private'));
  const file=path.join(root,'server.cjs'),alias=path.join(root,'alias');
  fs.linkSync(file,alias);
  assert.throws(()=>inspectBuildOutput(root,'central'),/BUILD_OUTPUT_UNTRUSTED/);
}));
test('dangling and regular output symlinks fail closed', {skip:process.platform==='win32'},()=>fixture(root=>{
  const dir=path.join(root,'dist');populate(dir,'desktop');
  const file=path.join(dir,'secure-agent.cjs');
  fs.unlinkSync(file);fs.symlinkSync(path.join(root,'missing'),file);
  assert.throws(()=>inspectBuildOutput(dir,'desktop'),/BUILD_OUTPUT_UNTRUSTED/);
  fs.unlinkSync(file);fs.writeFileSync(path.join(root,'external'),'fixture');
  fs.symlinkSync(path.join(root,'external'),file);
  assert.throws(()=>inspectBuildOutput(dir,'desktop'),/BUILD_OUTPUT_UNTRUSTED/);
}));

test('Central build inventory covers all dashboard HTML script/style references',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../v7/ui/index.html'),'utf8');
  const assets=[...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/([^"?#]+)"/gi)].map(m=>m[1]);
  assert.ok(assets.includes('owner-crash-crosscheck.js'));
  for(const asset of assets)assert.ok(inventories.central.includes(asset),asset);
});
