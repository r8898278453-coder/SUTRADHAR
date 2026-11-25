'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {assess,reachable,isKnownAffected}=require('../scripts/release/dependency-exposure.cjs');
const rootDir=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(rootDir,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(rootDir,'package-lock.json'),'utf8'));
test('committed root lock has zero known picomatch exposure in production graph',()=>{
  const report=assess(manifest,lock);
  assert.equal(report.accepted,true);
  assert.equal(report.production_vulnerable_paths.length,0);
  assert.ok(report.development_only_paths.length>=1);
  assert.ok(report.direct_development_roots.includes('tailwindcss'));
  assert.ok(report.direct_development_roots.includes('vite'));
  assert.equal(report.npm_full_audit_still_required,true);
  assert.equal(report.owner_release_approved,false);
});
function fixture(){
  const root={dependencies:{safe:'1.0.0'},devDependencies:{builder:'1.0.0'}};
  const packages={'':{dependencies:{safe:'1.0.0'},devDependencies:{builder:'1.0.0'}},
    'node_modules/safe':{version:'1.0.0'},
    'node_modules/builder':{version:'1.0.0',dependencies:{picomatch:'^2.0.0'}},
    'node_modules/picomatch':{version:'2.3.2'}};
  return {root,lock:{lockfileVersion:3,packages}};
}
test('fail closed if known-vulnerable picomatch becomes a runtime dependency',()=>{
  const {root,lock}=fixture();
  assert.equal(assess(root,lock).accepted,true);
  lock.packages['node_modules/safe'].dependencies={picomatch:'^2.0.0'};
  const out=assess(root,lock);
  assert.equal(out.accepted,false);
  assert.equal(out.production_vulnerable_paths[0].version,'2.3.2');
});
test('nested packages and optional/peer edges are included in runtime reachability',()=>{
  const {root,lock}=fixture();
  lock.packages['node_modules/safe'].optionalDependencies={nested:'^1'};
  lock.packages['node_modules/nested']={version:'1.0.0',
    peerDependencies:{picomatch:'^2.0.0'}};
  assert.ok(reachable(lock.packages,['safe']).has('node_modules/picomatch'));
  assert.equal(assess(root,lock).accepted,false);
});
test('no patched upstream is established, so even a hypothetical future version stays blocked',()=>{
  assert.equal(isKnownAffected('4.0.7'),true);
  assert.equal(isKnownAffected('2.3.2'),true);
  assert.equal(isKnownAffected('broken'),true);
  assert.equal(isKnownAffected('4.0.8'),true);
  assert.equal(isKnownAffected('5.0.0'),true);
});
test('lock/manifest mismatch or missing direct dependency cannot be accepted',()=>{
  const {root,lock}=fixture();
  root.dependencies.safe='2.0.0';
  assert.throws(()=>assess(root,lock),/MANIFEST_MISMATCH/);
  root.dependencies.safe='1.0.0';
  delete lock.packages['node_modules/safe'];
  assert.throws(()=>assess(root,lock),/ROOT_MISSING/);
});
