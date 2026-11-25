/**
 * CI-only dependency lock candidate generator (never commits/deploys).
 *
 * Generate candidate locks from the repository's exact Google AI SDK
 * version in a reviewable artifact; no production signing until an
 * Owner-reviewed PR commits these files and npm ci succeeds.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
if(process.env.SUTRADHAR_PREPARE_LOCK_CANDIDATE!=='true')
  throw Error('LOCK_PROPOSAL_REQUIRES_EXPLICIT_QA_OPT_IN');
function run(args,cwd){
  const p=cp.spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{
    cwd,env:process.env,stdio:'inherit',timeout:240000});
  if(p.error||p.status!==0)throw Error('LOCK_PROPOSAL_NPM_FAILURE');
}
const rootPkg=path.join(root,'package.json');
const pkg=JSON.parse(fs.readFileSync(rootPkg,'utf8'));
const requested=pkg.dependencies?.['@google/genai'];
if(typeof requested!=='string'||!/^\d+\.\d+\.\d+$/.test(requested))
  throw Error('LOCK_PROPOSAL_REQUIRES_EXACT_AI_SDK_VERSION');
run(['install','--ignore-scripts','--no-audit','--no-fund'],root);
const sdk=JSON.parse(fs.readFileSync(path.join(root,'node_modules','@google','genai','package.json'),'utf8'));
if(sdk.version!==requested)throw Error('AI_SDK_RESOLVED_VERSION_MISMATCH');
run(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],root);
run(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],
  path.join(root,'apps','desktop'));
const top=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const desktop=JSON.parse(fs.readFileSync(path.join(root,'apps','desktop','package-lock.json'),'utf8'));
if(top.lockfileVersion<3||desktop.lockfileVersion<3||
  top.packages?.['']?.dependencies?.['@google/genai']!==sdk.version)
  throw Error('LOCK_PROPOSAL_MANIFEST_INCONSISTENT');
fs.writeFileSync(path.join(root,'lock-candidate-summary.json'),JSON.stringify({
  status:'REVIEW_REQUIRED_NOT_COMMITTED',
  sdk_version:sdk.version,root_lockfile_version:top.lockfileVersion,
  desktop_lockfile_version:desktop.lockfileVersion,
  policy:'Review dependency diff, audit, npm ci on Windows/Linux, then Owner PR approval'
},null,2)+'\n');
console.log('Lockfile candidates generated inside CI workspace only; no Git push or signing.');
