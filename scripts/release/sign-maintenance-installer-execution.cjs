/**
 * Offline Owner signer for one interactive launch of already-staged Windows EXE.
 * Does not run installer, modify a PC, or contact Central. Private key stays
 * on trusted Owner signing machine outside the repository.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
const HEX=/^[0-9a-f]{64}$/;
const VERSION=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function req(name){const value=process.env[name];if(!value)throw Error('OWNER_INSTALL_GRANT_MISSING_'+name);return value.trim();}
function fail(code){throw Error(code);}
function main(){
  if(process.env.SUTRADHAR_OWNER_INSTALL_EXECUTION_APPROVED!=='yes')
    fail('OWNER_INSTALL_GRANT_EXPLICIT_APPROVAL_REQUIRED');
  const node_id=req('SUTRADHAR_INSTALL_NODE_ID');
  const plan_id=req('SUTRADHAR_INSTALL_PLAN_ID');
  const wave_id=req('SUTRADHAR_INSTALL_WAVE_ID');
  const offer_sha256=req('SUTRADHAR_INSTALL_OFFER_SHA256');
  const installer_sha256=req('SUTRADHAR_INSTALL_EXE_SHA256');
  const kind=req('SUTRADHAR_INSTALL_KIND');
  const target_version=req('SUTRADHAR_INSTALL_TARGET_VERSION');
  const epoch=Number(req('SUTRADHAR_INSTALL_MASTER_EPOCH'));
  if(!NODE.test(node_id)||!ID.test(plan_id)||!WAVE.test(wave_id)||
     !HEX.test(offer_sha256)||!HEX.test(installer_sha256)||
     !['update','rollback'].includes(kind)||!VERSION.test(target_version)||
     !Number.isSafeInteger(epoch)||epoch<1)
    fail('OWNER_INSTALL_GRANT_INVALID_SCOPE');
  if(kind==='rollback'&&
     process.env.SUTRADHAR_OWNER_EMERGENCY_ROLLBACK_APPROVED!=='yes')
    fail('OWNER_INSTALL_GRANT_EMERGENCY_ROLLBACK_APPROVAL_REQUIRED');
  const keyFile=req('SUTRADHAR_INSTALL_EXECUTION_SIGNING_KEY_FILE');
  const output=req('SUTRADHAR_INSTALL_EXECUTION_GRANT_OUTPUT');
  const repo=path.resolve(__dirname,'../..');
  if(!path.isAbsolute(keyFile)||!path.isAbsolute(output)||
     path.resolve(keyFile)===path.resolve(output)||
     [keyFile,output].some(x=>{
       const v=path.resolve(x);
       return v===repo||v.startsWith(repo+path.sep);
     }))fail('OWNER_INSTALL_GRANT_PATH_MUST_BE_OUTSIDE_REPOSITORY');
  const stat=fs.lstatSync(keyFile);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>16384)
    fail('OWNER_INSTALL_GRANT_SIGNING_KEY_INVALID');
  const key=crypto.createPrivateKey(fs.readFileSync(keyFile));
  if(key.asymmetricKeyType!=='ed25519')
    fail('OWNER_INSTALL_GRANT_ED25519_REQUIRED');
  const now=Date.now();
  const signed={schema:1,action:'launch_staged_windows_installer',
    grant_id:crypto.randomBytes(32).toString('hex'),node_id,plan_id,
    wave_id,offer_sha256,installer_sha256,kind,target_version,
    epoch,issued_ms:now,expires_ms:now+5*60000};
  const signature_base64=crypto.sign(null,Buffer.from(JSON.stringify(signed)),
    key).toString('base64');
  const fd=fs.openSync(output,'wx',0o600);
  try{
    fs.writeFileSync(fd,JSON.stringify({signed,signature_base64},null,2)+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  console.log(JSON.stringify({grant_file:output,node_id,plan_id,wave_id,
    kind,target_version,expires_ms:signed.expires_ms,
    installed:false,published:false,automatic_retry_allowed:false}));
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={main};
