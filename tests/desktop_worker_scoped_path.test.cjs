'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {safeScopedPath}=require('../apps/desktop/worker-scoped-path.cjs');
test('broad parent scope never authorizes nested Git, package or secret controls',()=>{
  for(const value of [
    'src/.git','src/.git/config','src/.gitignore',
    'src/.gitattributes','src/.gitmodules','src/.lfsconfig',
    'src/.env','src/.env.production','src/.npmrc','src/.yarnrc.yml',
    'src/.pnp.cjs','src/package.json','src/package-lock.json',
    'src/node_modules/lib','src/bun.lock','src/pyproject.toml',
    'src/setup.py','src/../elsewhere','/src/feature.ts'
  ])assert.equal(safeScopedPath(value),false,value);
  for(const value of ['src','src/feature.ts',
    'src/.well-known/feature.ts','docs/example.md'])
    assert.equal(safeScopedPath(value),true,value);
});
test('policy is part of packaged Electron Desktop closure',()=>{
  const pkg=require('../apps/desktop/package.json');
  assert.ok(pkg.build.files.includes('worker-scoped-path.cjs'));
});
