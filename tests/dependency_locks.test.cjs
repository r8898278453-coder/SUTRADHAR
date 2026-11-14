'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateTree}=require('../scripts/release/verify-dependency-locks.cjs');
const rootPkg={name:'sutradhar-swarm',version:'7.0.0-alpha.1',
  dependencies:{'@google/genai':'3.3.0'},devDependencies:{esbuild:'^0.25.0'}};
const rootLock={lockfileVersion:3,packages:{
  '':{name:rootPkg.name,version:rootPkg.version,dependencies:rootPkg.dependencies,
    devDependencies:rootPkg.devDependencies},
  'node_modules/@google/genai':{version:'3.3.0',
    resolved:'https://registry.npmjs.org/@google/genai/-/genai-3.3.0.tgz',
    integrity:'sha512-'+Buffer.alloc(64,1).toString('base64')},
  'node_modules/esbuild':{version:'0.25.0',
    resolved:'https://registry.npmjs.org/esbuild/-/esbuild-0.25.0.tgz',
    integrity:'sha512-'+Buffer.alloc(64,2).toString('base64')}
}};
const clone=x=>JSON.parse(JSON.stringify(x));
test('Release lock gate accepts a complete, npm-integrity-pinned dependency tree',()=>{
  assert.equal(validateTree(rootPkg,rootLock,'root').packages,2);
});
test('Floating latest, nonnpm archive and missing integrity are release blockers',()=>{
  const p=clone(rootPkg),l=clone(rootLock);
  p.dependencies['@google/genai']='latest';
  l.packages[''].dependencies['@google/genai']='latest';
  assert.throws(()=>validateTree(p,l,'root'),/FLOATING_OR_UNTRUSTED|AI_SDK/);
  const p2=clone(rootPkg),l2=clone(rootLock);
  p2.dependencies['@google/genai']='^3.3.0';
  l2.packages[''].dependencies['@google/genai']='^3.3.0';
  assert.throws(()=>validateTree(p2,l2,'root'),/AI_SDK_MUST_HAVE_EXACT_VERSION/);
  const m=clone(rootLock);m.packages['node_modules/esbuild'].resolved='http://untrusted.local/pkg.tgz';
  assert.throws(()=>validateTree(rootPkg,m,'root'),/NON_NPM_REGISTRY_DEPENDENCY/);
  const n=clone(rootLock);delete n.packages['node_modules/esbuild'].integrity;
  assert.throws(()=>validateTree(rootPkg,n,'root'),/MISSING_PACKAGE_INTEGRITY/);
});
test('Changed manifest without reviewed lock and unsupported lock format fail closed',()=>{
  const p=clone(rootPkg);p.dependencies['@google/genai']='3.3.1';
  assert.throws(()=>validateTree(p,rootLock,'root'),/MANIFEST_DEPENDENCIES_MISMATCH/);
  const l=clone(rootLock);l.lockfileVersion=2;
  assert.throws(()=>validateTree(rootPkg,l,'root'),/NPM_V3_LOCKFILE_REQUIRED/);
  const x=clone(rootLock);x.packages['node_modules/remote']={link:true,version:'1.0.0'};
  assert.throws(()=>validateTree(rootPkg,x,'root'),/UNVERIFIABLE_SYMLINK/);
});
test('Desktop Electron and builder require exact version pins',()=>{
  const desktop={name:'@sutradhar/desktop',version:'7.0.0-alpha.1',
    devDependencies:{electron:'45.3.1','electron-builder':'26.18.0'}};
  const locks={lockfileVersion:3,packages:{
    '':{name:desktop.name,version:desktop.version,devDependencies:desktop.devDependencies},
    'node_modules/electron':{version:'45.3.1',
      resolved:'https://registry.npmjs.org/electron/-/electron-45.3.1.tgz',
      integrity:'sha512-'+Buffer.alloc(64,3).toString('base64')}
  }};
  assert.equal(validateTree(desktop,locks,'desktop').packages,1);
  const bad=clone(desktop),badLocks=clone(locks);
  bad.devDependencies.electron='^45.3.1';
  badLocks.packages[''].devDependencies.electron='^45.3.1';
  assert.throws(()=>validateTree(bad,badLocks,'desktop'),/ELECTRON_AND_BUILDER_MUST_HAVE_EXACT_VERSION/);
});
