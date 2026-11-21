/**
 * Staging-only Central build for Hostinger monorepo deployment from ROOT (./).
 * This build intentionally excludes Electron and PC agent/worker binaries.
 * It never deploys, migrates a database or changes a production release ref.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'../..');
const dest=path.join(__dirname,'dist');
const rootFile=rel=>path.join(root,rel);
const copy=(from,to)=>{
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.copyFileSync(from,to);
};
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function sourceSha(){
  if(/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||''))return process.env.GITHUB_SHA;
  try{
    const s=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:10000}).trim();
    return /^[0-9a-f]{40}$/.test(s)?s:null;
  }catch{return null;}
}
function main(){
  fs.mkdirSync(dest,{recursive:true});
  const target=path.join(dest,'server.cjs');
  esbuild.buildSync({
    entryPoints:[rootFile('v7/central.ts')],
    bundle:true,platform:'node',format:'cjs',target:'node22',
    packages:'external',outfile:target,logLevel:'warning'
  });
  for(const name of ['index.html','dashboard.js','app.css'])
    copy(rootFile('v7/ui/'+name),path.join(dest,name));
  copy(rootFile('v7/schema.sql'),path.join(dest,'v7/schema.sql'));
  const pkg=JSON.parse(fs.readFileSync(rootFile('package.json'),'utf8'));
  const contract=JSON.parse(fs.readFileSync(rootFile('packages/shared/contract.json'),'utf8'));
  const manifest={
    manifest_version:1,application:'central',status:'ALPHA_UNAPPROVED',
    version:pkg.version,source_sha:sourceSha(),api_protocol:contract.api_protocol,
    mysql_schema_version:7,
    bundle_sha256:sha(target),schema_sha256:sha(path.join(dest,'v7/schema.sql')),
    production_approved:false
  };
  fs.writeFileSync(path.join(dest,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const forbidden of ['v7-agent.cjs','v7-worker.cjs','identity.json','private_key_pem']){
    if(fs.existsSync(path.join(dest,forbidden)))throw Error('Central package contains forbidden worker/identity artifact: '+forbidden);
  }
  if(!fs.existsSync(path.join(dest,'index.html')))throw Error('Missing dashboard');
  console.log('Central staging bundle ready (not deployed): apps/central/dist/server.cjs');
}
main();
