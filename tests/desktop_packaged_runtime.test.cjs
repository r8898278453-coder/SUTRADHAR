'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {verifyPackagedRuntime}=require('../apps/desktop/verify-packaged-runtime.cjs');
const source=path.resolve(__dirname,'../apps/desktop');
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-asar-proof-'));
  try{
    const names=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')).build.files;
    for(const name of names){
      const src=path.join(source,name);
      const data=name==='contract.json'?
        fs.readFileSync(path.resolve(__dirname,'../packages/shared/contract.json')):
        fs.readFileSync(src);
      fs.writeFileSync(path.join(dir,name),data);
    }
    fs.mkdirSync(path.join(dir,'dist'));
    fs.writeFileSync(path.join(dir,'dist','secure-agent.cjs'),'secure test agent');
    const resources=path.join(dir,'out','win-unpacked','resources');
    fs.mkdirSync(resources,{recursive:true});
    fs.writeFileSync(path.join(resources,'app.asar'),'fake ASAR fixture');
    fs.copyFileSync(path.join(dir,'dist','secure-agent.cjs'),
      path.join(resources,'secure-agent.cjs'));
    for(const name of ['master-typescript.cjs','master-typescript-LICENSE.txt','master-typescript-NOTICE.txt']){
      fs.writeFileSync(path.join(dir,'dist',name),'fixture '+name);
      fs.copyFileSync(path.join(dir,'dist',name),path.join(resources,name));
    }
    const listed=names.map(n=>'/'+n);
    const overrides={};
    const reader={listPackage:()=>listed,
      extractFile:(_,name)=>overrides[name]||fs.readFileSync(path.join(dir,name))};
    return fn({dir,resources,names,listed,overrides,reader});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('actual app.asar entries and external secure-agent bytes must match declared source',()=>{
  fixture(({dir,resources,reader,names})=>{
    const r=verifyPackagedRuntime({desktopDir:dir,resourceDir:resources,asarApi:reader});
    assert.equal(r.accepted,true);
    assert.equal(r.verified_asar_files,names.length);
    assert.equal(r.actual_packaged_bytes_verified,true);
    assert.equal(r.windows_install_executed,false);
  });
});
test('an ASAR that silently omits a required runtime module is rejected',()=>{
  fixture(({dir,resources,reader,listed})=>{
    reader.listPackage=()=>listed.filter(n=>n!=='/bounded-central-json.cjs');
    assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,
      resourceDir:resources,asarApi:reader}),/PACKAGED_RUNTIME_ASAR_MODULE_MISSING/);
  });
});
test('a modified packaged JS, absent secure agent or mismatched app identity fails',()=>{
  fixture(({dir,resources,reader,overrides})=>{
    overrides['enrollment.cjs']=Buffer.from('injected altered runtime');
    assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,
      resourceDir:resources,asarApi:reader}),/PACKAGED_RUNTIME_ASAR_BYTES_CHANGED/);
    delete overrides['enrollment.cjs'];
    overrides['package.json']=Buffer.from(JSON.stringify({main:'other.js',
      name:'@sutradhar/desktop',version:'7.0.0-alpha.1'}));
    assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,
      resourceDir:resources,asarApi:reader}),/PACKAGED_RUNTIME_IDENTITY_CHANGED/);
    delete overrides['package.json'];
    fs.writeFileSync(path.join(resources,'secure-agent.cjs'),'other agent');
    assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,
      resourceDir:resources,asarApi:reader}),/PACKAGED_RUNTIME_SECURE_AGENT_CHANGED/);
  });
});
test('unexpected Central executable and preloaded identity must not ship in ASAR',()=>{
  fixture(({dir,resources,reader,listed})=>{
    for(const banned of ['server.cjs','identity.json','schema.sql']){
      reader.listPackage=()=>[...listed,'/'+banned];
      assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,
        resourceDir:resources,asarApi:reader}),/PACKAGED_RUNTIME_CENTRAL_OR_IDENTITY_LEAK/);
    }
  });
});

for(const name of ['master-typescript.cjs','master-typescript-LICENSE.txt','master-typescript-NOTICE.txt']){
  test('packaged AST resource exact bytes '+name,()=>fixture(({dir,resources,reader})=>{
    const proof=verifyPackagedRuntime({desktopDir:dir,resourceDir:resources,asarApi:reader});
    assert.match(proof.ast_resource_sha256[name],/^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(resources,name),'changed');
    assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,resourceDir:resources,asarApi:reader}),/AST_RESOURCE_CHANGED/);
    fs.unlinkSync(path.join(resources,name));
    assert.throws(()=>verifyPackagedRuntime({desktopDir:dir,resourceDir:resources,asarApi:reader}),/FILE_NOT_FOUND/);
  }));
}
