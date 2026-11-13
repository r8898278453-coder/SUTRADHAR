/**
 * PRODUCTION SIGNING GATE — build a signed Windows installer only with a
 * real owner-controlled certificate, exact approved commit and stable version.
 * NEVER uploads, publishes, deploys or changes Git refs.
 * Requires Windows signtool/Authenticode verification; refuses CI alpha.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('node:child_process');
const cwd=__dirname,root=path.resolve(__dirname,'../..');
const pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8'));
const version=pkg.version;
const sha=/^[a-f0-9]{40}$/;
function fail(reason){throw Error('RELEASE_BLOCKED: '+reason);}
function git(args){
  return cp.execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:15000}).trim();
}
function required(name){
  const v=process.env[name];
  if(!v||!v.trim())fail(name+' must be provided through protected release environment');
  return v.trim();
}
function main(){
  if(process.platform!=='win32')fail('Windows-signed release requires a trusted Windows runner');
  if(process.env.SUTRADHAR_OWNER_RELEASE_APPROVED!=='true')fail('explicit Owner release approval required');
  if(!/^\d+\.\d+\.\d+$/.test(version))fail('stable semver is required; alpha is not a production release');
  // The 33.x alpha runtime is EOL. Release only with the audited 45.x line;
  // review support window and update this guard with an independent QA signoff
  // whenever the Electron major is intentionally upgraded.
  const electronVersion=pkg.devDependencies?.electron;
  const builderVersion=pkg.devDependencies?.['electron-builder'];
  if(!/^45[.]\d+[.]\d+$/.test(electronVersion||'')||
     !/^26[.]\d+[.]\d+$/.test(builderVersion||''))
    fail('approved supported Electron 45 / builder 26 dependency pins required');
  if(Date.now()>Date.parse('2027-04-27T00:00:00Z'))
    fail('Electron 45 support-window review required; do not release an EOL runtime');

  const expected=required('SUTRADHAR_EXPECTED_COMMIT_SHA');
  if(!sha.test(expected)||git(['rev-parse','HEAD'])!==expected)fail('release commit SHA mismatch');
  if(git(['status','--porcelain'])!=='')fail('dirty source checkout');
  if(required('SUTRADHAR_RELEASE_TAG')!=='desktop-v'+version)fail('wrong immutable desktop release tag');
  let tagCommit;
  try{tagCommit=git(['rev-list','-n','1','refs/tags/desktop-v'+version]);}
  catch{fail('approved immutable desktop version tag does not exist');}
  if(tagCommit!==expected)fail('tag does not point to the approved release SHA');
  const signed=required('SUTRADHAR_WINDOWS_PUBLISHER_NAME');
  if(!/^CN=.+/.test(signed)||signed.length>250)fail('publisher must equal certificate Distinguished Name');
  const trustPem=Buffer.from(required('SUTRADHAR_RELEASE_UPDATE_PUBLIC_KEY_PEM_B64'),'base64').toString('utf8');
  let trustKey;
  try{trustKey=crypto.createPublicKey(trustPem);}catch{fail('Owner Ed25519 update verification public key invalid');}
  if(trustKey.asymmetricKeyType!=='ed25519')fail('Owner update signing public key must be Ed25519');
  const cert=process.env.WIN_CSC_LINK||process.env.CSC_LINK;
  const password=process.env.WIN_CSC_KEY_PASSWORD||process.env.CSC_KEY_PASSWORD;
  if(!cert||!password)fail('approved Authenticode certificate and private signing secret required');
  const agent=path.join(cwd,'dist','secure-agent.cjs');
  if(!fs.existsSync(agent)||!fs.existsSync(path.join(cwd,'contract.json')))
    fail('run the reviewed Desktop build first');
  const manifest=JSON.parse(fs.readFileSync(path.join(cwd,'dist','release-manifest.json'),'utf8'));
  if(manifest.source_sha!==expected||manifest.api_protocol!==7||
     manifest.secure_agent_sha256!==crypto.createHash('sha256').update(fs.readFileSync(agent)).digest('hex'))
    fail('Desktop build provenance mismatch');
  const builder=path.join(cwd,'node_modules','electron-builder','cli.js');
  if(!fs.existsSync(builder))fail('packager dependencies not installed');
  const signingConfig=JSON.parse(JSON.stringify(pkg.build));
  signingConfig.win.publisherName=signed;
  signingConfig.win.verifyUpdateCodeSignature=true;
  signingConfig.publish=null;
  const cfg=path.join(cwd,'.protected-signing-config-'+process.pid+'.json');
  const trustFile=path.join(cwd,'update-trust.json');
  const originalTrust=fs.readFileSync(trustFile,'utf8');
  fs.writeFileSync(cfg,JSON.stringify(signingConfig),{mode:0o600,flag:'wx'});
  try{
    fs.writeFileSync(trustFile,JSON.stringify({
      schema:1,channel:'stable',public_key_pem:trustPem,
      publisher_subject:signed,status:'OWNER_PROTECTED_RELEASE'
    },null,2)+'\n',{mode:0o600});
    const r=cp.spawnSync(process.execPath,[builder,'--win','nsis','--x64','--publish','never',
      '--config',cfg],{cwd,env:process.env,stdio:'inherit',timeout:1200000});
    if(r.error||r.status!==0)fail('Windows signed packager failed');
    const out=path.join(cwd,'out');
    const installers=fs.readdirSync(out).filter(x=>x.endsWith('.exe')).map(x=>path.join(out,x));
    if(!installers.length)fail('no installer artifact');
    const receipts=[];
    for(const file of installers){
      const command='$s=Get-AuthenticodeSignature -LiteralPath '+JSON.stringify(file)+
        '; if($s.Status -ne "Valid" -or $null -eq $s.SignerCertificate){ exit 42 };'+
        ' if($s.SignerCertificate.Subject -cne '+JSON.stringify(signed)+'){ exit 43 };';
      const verify=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],
        {encoding:'utf8',timeout:30000});
      if(verify.error||verify.status!==0)fail('Windows Authenticode signer/signature verification failed');
      receipts.push({filename:path.basename(file),
        sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        signer:signed,verified:true});
    }
    fs.writeFileSync(path.join(out,'signed-release-evidence.json'),JSON.stringify({
      application:'desktop',version,source_sha:expected,tag:'desktop-v'+version,
      verified_by:'Windows Get-AuthenticodeSignature',
      local_signing_verified:true,remote_release_approved:false,
      installers:receipts
    },null,2)+'\n',{mode:0o600});
    console.log('SIGNED_INSTALLERS_VERIFIED_LOCALLY; NOT PUBLISHED. Owner must review evidence.');
  }finally{try{fs.writeFileSync(trustFile,originalTrust);}catch{}
    try{fs.unlinkSync(cfg);}catch{}}
}
main();
