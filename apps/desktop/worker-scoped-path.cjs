/**
 * Untrusted worker scope and changed-Git-file validator for Electron MAIN.
 * A broad scope like "src" must NOT allow nested build execution config,
 * Git repository controls, private environment files or package entrypoints.
 * Independently recheck actual changed paths on submit AND QA import.
 */
'use strict';
const forbidden=new Set([
  '.git','.gitattributes','.gitmodules','.lfsconfig','.gitignore',
  '.env','.npmrc','.yarnrc','.yarnrc.yml','.pnp.cjs','.pnp.loader.mjs',
  'node_modules','package.json','package-lock.json','yarn.lock',
  'pnpm-lock.yaml','bun.lock','bun.lockb','pyproject.toml','setup.py'
]);
function safeScopedPath(value){
  if(typeof value!=='string'||value.length===0||value.length>450||
     !/^[A-Za-z0-9._/-]+$/.test(value)||value.startsWith('/')||
     value.includes('//'))return false;
  const parts=value.toLowerCase().split('/');
  return !parts.some(p=>!p||p==='.'||p==='..'||forbidden.has(p)||
    p.startsWith('.env.'));
}
module.exports={safeScopedPath};
