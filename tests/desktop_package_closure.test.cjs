'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {verifyPackageClosure}=require('../apps/desktop/package-closure.cjs');
const dir=path.resolve(__dirname,'../apps/desktop');
const source=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
const copy=()=>JSON.parse(JSON.stringify(source));
test('Every literal relative CJS dependency is on the Windows ASAR allowlist',()=>{
  const proof=verifyPackageClosure({dir});
  assert.equal(proof.accepted,true);
  assert.ok(proof.local_requires>20);
  assert.equal(proof.real_windows_startup_verified,false);
});
test('Removing a runtime dependency from the installer is rejected before packaging',()=>{
  for(const name of ['bounded-central-json.cjs','vault-bridge.cjs','enrollment.cjs']){
    const m=copy();
    m.build.files=m.build.files.filter(file=>file!==name);
    assert.throws(()=>verifyPackageClosure({dir,manifest:m}),
      /DESKTOP_PACKAGE_LOCAL_REQUIRE_MISSING|DESKTOP_PACKAGE_REQUIRED_RUNTIME_MISSING/);
  }
});
test('Wildcards, escapes and duplicate packaged paths are refused',()=>{
  for(const bad of ['**/*.cjs','../other.cjs','main.cjs']){
    const m=copy();m.build.files.push(bad);
    assert.throws(()=>verifyPackageClosure({dir,manifest:m}),
      /DESKTOP_PACKAGE_FILE_ALLOWLIST_INVALID/);
  }
});
