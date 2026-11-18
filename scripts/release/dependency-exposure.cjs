/**
 * Deterministic, offline dependency reachability review. Keep npm audit's
 * separate high/critical gate enabled; this tool is NOT an audit waiver.
 *
 * GitHub advisory GHSA-fc5q-39xc-vjpf (CVE-2026-112366) lists no
 * patched picomatch version as of 2026-11-18. Refuse production exposure,
 * and surface exactly which development-only roots introduce it.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');

const AFFECTED=/^picomatch$/;
function fail(code){throw Error(code);}
function packageName(installedPath){
  const index=installedPath.lastIndexOf('node_modules/');
  return index>=0?installedPath.slice(index+'node_modules/'.length):'';
}
function validVersion(version){
  return typeof version==='string'&&/^\d+\.\d+\.\d+$/.test(version);
}
function isKnownAffected(version){
  if(!validVersion(version))return true; // Unknown versions fail closed.
  const n=version.split('.').map(Number);
  return n[0]<4||n[0]===4&&(n[1]===0&&n[2]<=7||n[1]<0);
}
function resolveInstalled(packages,from,name){
  // npm's resolution walks upwards to the nearest node_modules directory.
  if(typeof name!=='string'||!/^(@[\w.-]+\/)?[\w.-]+$/.test(name))
    fail('DEPENDENCY_EXPOSURE_NAME_INVALID');
  let folder=from;
  while(true){
    const candidate=(folder?folder+'/':'')+'node_modules/'+name;
    if(Object.prototype.hasOwnProperty.call(packages,candidate))return candidate;
    const i=folder.lastIndexOf('/node_modules/');
    if(i>=0)folder=folder.slice(0,i);
    else if(folder)folder='';
    else return null;
  }
}
function dependencies(pkg){
  // Include optional and peer edges conservatively. Missing optional
  // platform-specific installs need not create false synthetic packages.
  return new Set([...Object.keys(pkg.dependencies||{}),
    ...Object.keys(pkg.optionalDependencies||{}),
    ...Object.keys(pkg.peerDependencies||{})]);
}
function reachable(packages,rootNames){
  const result=new Set(),work=[];
  for(const name of rootNames){
    const target=resolveInstalled(packages,'',name);
    if(!target)fail('DEPENDENCY_EXPOSURE_ROOT_MISSING_'+name);
    work.push(target);
  }
  while(work.length){
    const key=work.pop();
    if(result.has(key))continue;
    const p=packages[key];
    if(!p)fail('DEPENDENCY_EXPOSURE_LOCK_BROKEN');
    result.add(key);
    for(const name of dependencies(p)){
      const next=resolveInstalled(packages,key,name);
      if(next)work.push(next);
    }
  }
  return result;
}
function assess(root,lock){
  if(!root||!lock||!lock.packages||lock.lockfileVersion!==3)
    fail('DEPENDENCY_EXPOSURE_LOCK_V3_REQUIRED');
  const equal=(a,b)=>{const x=Object.entries(a||{}).sort(([a],[b])=>a.localeCompare(b));
    const y=Object.entries(b||{}).sort(([a],[b])=>a.localeCompare(b));
    return JSON.stringify(x)===JSON.stringify(y);};
  if(!equal(root.dependencies,lock.packages['']?.dependencies)||
     !equal(root.devDependencies,lock.packages['']?.devDependencies))
    fail('DEPENDENCY_EXPOSURE_MANIFEST_MISMATCH');
  const packages=lock.packages;
  const prodRoots=Object.keys(root.dependencies||{});
  const devRoots=Object.keys(root.devDependencies||{});
  const prod=reachable(packages,prodRoots);
  const dev=reachable(packages,devRoots);
  const known=[];
  for(const [key,p] of Object.entries(packages)){
    if(AFFECTED.test(packageName(key))&&isKnownAffected(p.version))
      known.push({path:key,version:p.version,production:prod.has(key),development:dev.has(key)});
  }
  known.sort((a,b)=>a.path.localeCompare(b.path));
  const directDevRoots=devRoots.filter(name=>{
    const tree=reachable(packages,[name]);
    return known.some(x=>tree.has(x.path));
  });
  const impactedProduction=known.filter(x=>x.production);
  const unaccounted=known.filter(x=>!x.production&&!x.development);
  return {accepted:impactedProduction.length===0&&unaccounted.length===0,
    advisory:'GHSA-fc5q-39xc-vjpf',
    patched_version_known:false,
    production_vulnerable_paths:impactedProduction,
    development_only_paths:known.filter(x=>!x.production&&x.development),
    unaccounted_paths:unaccounted,
    direct_development_roots:directDevRoots,
    npm_full_audit_still_required:true,
    owner_release_approved:false};
}
function main(){
  const repo=path.resolve(__dirname,'../..');
  const root=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
  const lock=JSON.parse(fs.readFileSync(path.join(repo,'package-lock.json'),'utf8'));
  const result=assess(root,lock);
  console.log(JSON.stringify(result,null,2));
  if(!result.accepted)process.exitCode=1;
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={assess,reachable,resolveInstalled,isKnownAffected};
