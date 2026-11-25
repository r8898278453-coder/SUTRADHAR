/**
 * SUTRADHAR dependency lockfile release gate.
 * The ordinary alpha CI may build without locks, but a signed production
 * installer MUST use exact reviewed dependency trees. No lifecycle scripts,
 * network calls, or changes to package files happen in this checker.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

function validateTree(pkg,lock,app){
  function reject(code){throw Error('DEPENDENCY_LOCK_BLOCKED: '+app+': '+code);}
  if(!pkg||!lock||typeof pkg!=='object'||typeof lock!=='object'||
    lock.lockfileVersion!==3||!lock.packages||typeof lock.packages!=='object')
    reject('NPM_V3_LOCKFILE_REQUIRED');
  const root=lock.packages[''];
  if(!root||root.name!==pkg.name||root.version!==pkg.version)
    reject('MANIFEST_IDENTITY_MISMATCH');
  for(const kind of ['dependencies','devDependencies','optionalDependencies']){
    const wanted=pkg[kind]||{},locked=root[kind]||{};
    if(JSON.stringify(Object.entries(wanted).sort())!==
       JSON.stringify(Object.entries(locked).sort()))
      reject('MANIFEST_DEPENDENCIES_MISMATCH_'+kind);
    for(const [name,spec] of Object.entries(wanted)){
      if(typeof spec!=='string'||/^(?:latest|\*|file:|https?:|git(?:\+|:)|github:|workspace:)/i.test(spec)||
        spec.includes('://')||!name||/\s/.test(spec))
        reject('FLOATING_OR_UNTRUSTED_DIRECT_DEPENDENCY');
    }
  }
  if(app==='root'&&!/^\d+\.\d+\.\d+$/.test(pkg.dependencies?.['@google/genai']||''))
    reject('AI_SDK_MUST_HAVE_EXACT_VERSION');
  if(app==='desktop'){
    if(!/^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.electron||'')||
      !/^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.['electron-builder']||''))
      reject('ELECTRON_AND_BUILDER_MUST_HAVE_EXACT_VERSION');
  }
  let count=0;
  for(const [name,meta] of Object.entries(lock.packages)){
    if(!name)continue;
    if(!name.startsWith('node_modules/')||!meta||typeof meta!=='object')
      reject('UNSUPPORTED_PACKAGE_ENTRY');
    if(meta.link||meta.inBundle)reject('UNVERIFIABLE_SYMLINK_OR_BUNDLED_PACKAGE');
    if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(meta.version||''))
      reject('UNVERIFIED_PACKAGE_VERSION');
    if(typeof meta.resolved!=='string'||!meta.resolved.startsWith('https://registry.npmjs.org/'))
      reject('NON_NPM_REGISTRY_DEPENDENCY');
    if(typeof meta.integrity!=='string'||!/^(?:sha512|sha384|sha256)-[A-Za-z0-9+/=]+$/.test(meta.integrity))
      reject('MISSING_PACKAGE_INTEGRITY');
    count++;
  }
  if(count===0)reject('EMPTY_DEPENDENCY_TREE');
  return {packages:count,lockSha256:crypto.createHash('sha256').update(JSON.stringify(lock)).digest('hex')};
}
function verifyLockfiles(dir){
  function read(rel){
    const p=path.join(dir,rel);
    if(!fs.existsSync(p))throw Error('DEPENDENCY_LOCK_BLOCKED: MISSING_REVIEWED_'+rel);
    return JSON.parse(fs.readFileSync(p,'utf8'));
  }
  const root=validateTree(read('package.json'),read('package-lock.json'),'root');
  const desktop=validateTree(read('apps/desktop/package.json'),
    read('apps/desktop/package-lock.json'),'desktop');
  return {accepted:true,root,desktop,release_approved:false};
}
if(require.main===module){
  try{console.log(JSON.stringify(verifyLockfiles(path.resolve(__dirname,'../..')),null,2));}
  catch(e){console.error(String(e.message||e));process.exitCode=1;}
}
module.exports={validateTree,verifyLockfiles};
