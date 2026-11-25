/**
 * Verify the actual Windows electron-builder unpacked application artifact.
 * Static source closure alone does NOT prove that files made it into app.asar.
 * This never executes or distributes the unsigned/signed Windows installer.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyPackageClosure}=require('./package-closure.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code){throw Error(code);}
function regularFile(file,maximum=512*1024*1024){
  let st;
  try{st=fs.lstatSync(file);}catch{fail('PACKAGED_RUNTIME_FILE_NOT_FOUND');}
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>maximum)
    fail('PACKAGED_RUNTIME_FILE_UNSAFE');
  return st;
}
function verifyPackagedRuntime({desktopDir=__dirname,resourceDir,
  asarApi}={}){
  if(typeof resourceDir!=='string'||!path.isAbsolute(resourceDir))
    fail('PACKAGED_RUNTIME_RESOURCE_DIR_REQUIRED');
  const resource=fs.lstatSync(resourceDir);
  if(!resource.isDirectory()||resource.isSymbolicLink())
    fail('PACKAGED_RUNTIME_RESOURCE_DIR_UNSAFE');
  const pkg=JSON.parse(fs.readFileSync(path.join(desktopDir,'package.json'),'utf8'));
  verifyPackageClosure({dir:desktopDir,manifest:pkg,checkAssets:true});
  if(pkg.build.asar!==true||pkg.main!=='main.cjs'||
     !Array.isArray(pkg.build.extraResources)||
     JSON.stringify(pkg.build.extraResources)!==JSON.stringify(['secure-agent.cjs','master-typescript.cjs',
       'master-typescript-LICENSE.txt','master-typescript-NOTICE.txt'].map(name=>({from:'dist/'+name,to:name}))))
    fail('PACKAGED_RUNTIME_MANIFEST_INVALID');
  const archive=path.join(resourceDir,'app.asar');
  regularFile(archive);
  const reader=asarApi||require('@electron/asar');
  if(typeof reader.listPackage!=='function'||typeof reader.extractFile!=='function')
    fail('PACKAGED_RUNTIME_ASAR_READER_INVALID');
  let entries;
  try{entries=reader.listPackage(archive);}catch{fail('PACKAGED_RUNTIME_ARCHIVE_INVALID');}
  if(!Array.isArray(entries)||entries.length<20||entries.length>25000)
    fail('PACKAGED_RUNTIME_ARCHIVE_LIST_INVALID');
  const found=new Set();
  for(const entry of entries){
    if(typeof entry!=='string'||entry.length>350)
      fail('PACKAGED_RUNTIME_ARCHIVE_PATH_INVALID');
    const normalized=entry.replace(/\\/g,'/').replace(/^\/+/, '');
    if(!normalized||normalized==='.'||normalized==='..'||
       normalized.startsWith('../')||normalized.includes('/../')||
       normalized.includes('\0'))
      continue;
    found.add(normalized);
  }
  const manifest= pkg.build.files;
  let checked=0;
  for(const name of manifest){
    if(!found.has(name))
      fail('PACKAGED_RUNTIME_ASAR_MODULE_MISSING:'+name);
    let actual;
    try{actual=reader.extractFile(archive,name);}
    catch{fail('PACKAGED_RUNTIME_ASAR_EXTRACTION_FAILED:'+name);}
    if(!Buffer.isBuffer(actual)||actual.length>4*1024*1024)
      fail('PACKAGED_RUNTIME_ASAR_FILE_INVALID:'+name);
    if(name==='package.json'){
      let installed;
      try{installed=JSON.parse(actual.toString('utf8'));}catch{
        fail('PACKAGED_RUNTIME_PACKAGE_JSON_INVALID');
      }
      if(installed.main!==pkg.main||installed.name!==pkg.name||
         installed.version!==pkg.version)
        fail('PACKAGED_RUNTIME_IDENTITY_CHANGED');
    }else{
      const source=path.join(desktopDir,name);
      regularFile(source,4*1024*1024);
      if(digest(actual)!==digest(fs.readFileSync(source)))
        fail('PACKAGED_RUNTIME_ASAR_BYTES_CHANGED:'+name);
    }
    checked++;
  }
  for(const banned of ['server.cjs','schema.sql','identity.json']){
    if(found.has(banned))fail('PACKAGED_RUNTIME_CENTRAL_OR_IDENTITY_LEAK:'+banned);
  }
  const expectedAgent=path.join(desktopDir,'dist','secure-agent.cjs');
  const actualAgent=path.join(resourceDir,'secure-agent.cjs');
  regularFile(expectedAgent,16*1024*1024);
  regularFile(actualAgent,16*1024*1024);
  if(digest(fs.readFileSync(expectedAgent))!==
     digest(fs.readFileSync(actualAgent)))
    fail('PACKAGED_RUNTIME_SECURE_AGENT_CHANGED');
  const ast_resource_sha256={};
  for(const [name,max] of [['master-typescript.cjs',16*1024*1024],
    ['master-typescript-LICENSE.txt',256*1024],['master-typescript-NOTICE.txt',512*1024]]){
    const expected=path.join(desktopDir,'dist',name),actual=path.join(resourceDir,name);
    regularFile(expected,max);regularFile(actual,max);
    const hash=digest(fs.readFileSync(actual));
    if(hash!==digest(fs.readFileSync(expected)))fail('PACKAGED_RUNTIME_AST_RESOURCE_CHANGED:'+name);
    ast_resource_sha256[name]=hash;
  }
  return Object.freeze({accepted:true,verified_asar_files:checked,ast_resource_sha256,
    secure_agent_sha256:digest(fs.readFileSync(actualAgent)),
    actual_packaged_bytes_verified:true,windows_install_executed:false,
    authenticode_verified:false,production_approved:false});
}
if(require.main===module){
  try{
    const resourceDir=path.join(__dirname,'out','win-unpacked','resources');
    console.log(JSON.stringify(verifyPackagedRuntime({resourceDir})));
  }catch(e){console.error(e.message||'PACKAGED_RUNTIME_VALIDATION_FAILED');process.exitCode=1;}
}
module.exports={verifyPackagedRuntime};
