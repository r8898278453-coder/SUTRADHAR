/**
 * Prepackage local CommonJS dependency closure. This verifies literal relative
 * require() paths in ASAR-listed .cjs modules; dynamic requires and real
 * Windows startup require independent acceptance.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
function fail(code){throw Error(code);}
function verifyPackageClosure({dir=__dirname,manifest,checkAssets=false}={}){
  const pkg=manifest||JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const files=pkg?.build?.files;
  if(!Array.isArray(files)||files.length<20||
     files.some(f=>typeof f!=='string'||!/^[A-Za-z0-9_.-]+$/.test(f))||
     new Set(files).size!==files.length)
    fail('DESKTOP_PACKAGE_FILE_ALLOWLIST_INVALID');
  const allowed=new Set(files);
  let scanned=0,requires=0;
  for(const name of files){
    if(checkAssets){
      let stat;
      try{stat=fs.lstatSync(path.join(dir,name));}catch{
        fail('DESKTOP_PACKAGE_ASSET_MISSING:'+name);}
      if(!stat.isFile()||stat.isSymbolicLink())
        fail('DESKTOP_PACKAGE_ASSET_UNSAFE:'+name);
    }
    if(!name.endsWith('.cjs'))continue;
    let source;
    try{source=fs.readFileSync(path.join(dir,name),'utf8');}
    catch{fail('DESKTOP_PACKAGE_CJS_UNREADABLE:'+name);}
    scanned++;
    for(const m of source.matchAll(/\brequire\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g)){
      const requested=m[2];
      const resolved=path.posix.normalize(path.posix.join(
        path.posix.dirname(name),requested));
      if(resolved==='..'||resolved.startsWith('../')||resolved.startsWith('/'))
        fail('DESKTOP_PACKAGE_LOCAL_REQUIRE_ESCAPE:'+name);
      // A relative extensionless require resolves .js, not .cjs, in Node.
      const candidate=path.posix.extname(resolved)?resolved:resolved+'.js';
      requires++;
      if(!allowed.has(candidate))
        fail('DESKTOP_PACKAGE_LOCAL_REQUIRE_MISSING:'+name+':'+candidate);
    }
  }
  if(!allowed.has('main.cjs')||!allowed.has('contract.json')||
     !allowed.has('bounded-central-json.cjs'))
    fail('DESKTOP_PACKAGE_REQUIRED_RUNTIME_MISSING');
  return Object.freeze({accepted:true,scanned_cjs:scanned,
    local_requires:requires,packaged_files:files.length,
    dynamic_require_verified:false,real_windows_startup_verified:false});
}
if(require.main===module){
  try{console.log(JSON.stringify(verifyPackageClosure({checkAssets:true})));}
  catch(e){console.error(e.message||'DESKTOP_PACKAGE_CLOSURE_FAILED');process.exitCode=1;}
}
module.exports={verifyPackageClosure};
