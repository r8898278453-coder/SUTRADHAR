'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {verifyRuntime,policy}=require('../apps/desktop/runtime-policy.cjs');
const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../apps/desktop/package.json'),'utf8'));
const now=Date.parse('2026-11-13T09:00:00Z');
test('Desktop dependencies use reviewed, supported Electron and builder versions',()=>{
  assert.equal(pkg.devDependencies.electron,'45.3.1');
  assert.equal(pkg.devDependencies['electron-builder'],'26.18.0');
  assert.equal(verifyRuntime({electronVersion:pkg.devDependencies.electron,
    builderVersion:pkg.devDependencies['electron-builder'],now}).accepted,true);
});
test('Production signing cannot accept EOL Electron 33 or version ranges',()=>{
  for(const electronVersion of ['33.4.11','42.11.18','43.8.8','44.11.1',
    '^45.3.1','latest','45.3.0','45.0.0','46.0.0',null]){
    const v=verifyRuntime({electronVersion,builderVersion:'26.18.0',now});
    assert.equal(v.accepted,false,'not rejected: '+String(electronVersion));
  }
});
test('Reject unknown builder, and fail closed on support review deadline',()=>{
  for(const builderVersion of ['25.1.8','latest','^26.18.0','27.0.0',null]){
    assert.equal(verifyRuntime({electronVersion:'45.3.1',builderVersion,now}).accepted,false);
  }
  assert.equal(verifyRuntime({electronVersion:'45.3.1',builderVersion:'26.18.0',
    now:Date.parse(policy.supportReviewDeadlineUtc)}).error_code,'ELECTRON_SUPPORT_WINDOW_EXPIRED');
});
