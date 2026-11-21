/**
 * Offline Owner signer for an additional one-time post-maintenance restart.
 * NOT the same signature/action as maintenance hold release; no installer.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function env(n){const v=process.env[n];if(!v)throw Error('OWNER_RESTART_GRANT_MISSING_'+n);return v;}
function main(){
  if(process.env.SUTRADHAR_OWNER_MAINTENANCE_RESTART_APPROVED!=='yes')
    throw Error('OWNER_RESTART_GRANT_EXPLICIT_APPROVAL_REQUIRED');
  const node_id=env('SUTRADHAR_RELEASE_NODE_ID');
  const plan_id=env('SUTRADHAR_RELEASE_PLAN_ID');
  const wave_id=env('SUTRADHAR_RELEASE_WAVE_ID');
  const offer_sha256=env('SUTRADHAR_RELEASE_OFFER_SHA256');
  const release_grant_id=env('SUTRADHAR_PREVIOUS_RELEASE_GRANT_ID');
  if(!/^node_[0-9a-f]{32}$/.test(node_id)||
     !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(plan_id)||
     !/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(wave_id)||
     !/^[0-9a-f]{64}$/.test(offer_sha256)||
     !/^[0-9a-f]{64}$/.test(release_grant_id))
    throw Error('OWNER_RESTART_GRANT_SCOPE_INVALID');
  const keyFile=env('SUTRADHAR_MAINTENANCE_SIGNING_KEY_FILE');
  const outFile=env('SUTRADHAR_MAINTENANCE_RESTART_GRANT_OUTPUT');
  const repo=path.resolve(__dirname,'../..');
  if(!path.isAbsolute(keyFile)||!path.isAbsolute(outFile)||
     keyFile===outFile||
     [keyFile,outFile].some(x=>x===repo||path.resolve(x).startsWith(repo+path.sep)))
    throw Error('OWNER_RESTART_GRANT_PATH_MUST_BE_OUTSIDE_REPOSITORY');
  const st=fs.lstatSync(keyFile);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>16384)
    throw Error('OWNER_RESTART_GRANT_SIGNING_KEY_INVALID');
  const privateKey=crypto.createPrivateKey(fs.readFileSync(keyFile));
  if(privateKey.asymmetricKeyType!=='ed25519')
    throw Error('OWNER_RESTART_GRANT_KEY_MUST_BE_ED25519');
  const now=Date.now();
  const signed={schema:1,action:'restart_after_maintenance',
    node_id,plan_id,wave_id,offer_sha256,release_grant_id,
    grant_id:crypto.randomBytes(32).toString('hex'),
    issued_ms:now,expires_ms:now+5*60000};
  const signature_base64=crypto.sign(null,Buffer.from(JSON.stringify(signed)),
    privateKey).toString('base64');
  const fd=fs.openSync(outFile,'wx',0o600);
  try{
    fs.writeFileSync(fd,JSON.stringify({signed,signature_base64},null,2)+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  console.log(JSON.stringify({grant_file:outFile,node_id,plan_id,wave_id,
    release_grant_id,expires_ms:signed.expires_ms,
    installer_authorized:false,automatic_retry_authorized:false,
    private_key_exported:false}));
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={main};
