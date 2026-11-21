/**
 * Desktop-only staging build. Does not build/ship Central, MySQL or UI assets.
 * Packaging/signature/release is a separate explicitly gated operation.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'../..'),dest=path.join(__dirname,'dist');
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const gitSha=()=>{
  if(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''))return process.env.GITHUB_SHA;
  try{const s=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:10000}).trim();
    return /^[a-f0-9]{40}$/.test(s)?s:null;
  }catch{return null;}
};
fs.mkdirSync(dest,{recursive:true});
for(const [entry,outfile] of [
  ['v7/agent.ts','edge-agent.cjs'],
  ['apps/desktop/secure-agent.ts','secure-agent.cjs'],
  ['v7/worker.ts','edge-worker.cjs']
]){
  esbuild.buildSync({
    entryPoints:[path.join(root,entry)],bundle:true,
    platform:'node',format:'cjs',target:'node22',
    packages:'external',outfile:path.join(dest,outfile),logLevel:'warning'
  });
}
const contractFile=path.join(__dirname,'contract.json');
fs.copyFileSync(path.join(root,'packages/shared/contract.json'),contractFile);
const contract=JSON.parse(fs.readFileSync(contractFile,'utf8'));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const manifest={
  manifest_version:1,application:'desktop',status:'ALPHA_UNAPPROVED',
  version,source_sha:gitSha(),api_protocol:contract.api_protocol,
  agent_bundle_sha256:digest(path.join(dest,'edge-agent.cjs')),
  secure_agent_sha256:digest(path.join(dest,'secure-agent.cjs')),
  worker_bundle_sha256:digest(path.join(dest,'edge-worker.cjs')),
  production_approved:false,
  installer_signed:false,os_vault_runtime_implemented:true,
  identity_os_vault_protected:false,
  updater_verified:false
};
fs.writeFileSync(path.join(dest,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
for(const banned of ['server.cjs','schema.sql','index.html']){
  if(fs.existsSync(path.join(dest,banned)))throw Error('Desktop bundle includes Central artifact: '+banned);
}
console.log('Desktop staging agent/worker build ready. No signed installer was published.');
