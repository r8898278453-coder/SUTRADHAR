/** Offline Owner maintenance release grant signer. Does not access Central. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function env(name){const x=process.env[name];if(!x)throw Error('OWNER_MAINTENANCE_GRANT_MISSING_'+name);return x;}
function main(){
  if(process.env.SUTRADHAR_OWNER_MAINTENANCE_RELEASE_APPROVED!=='yes')
    throw Error('OWNER_MAINTENANCE_GRANT_EXPLICIT_APPROVAL_REQUIRED');
  const node_id=env('SUTRADHAR_RELEASE_NODE_ID');
  const plan_id=env('SUTRADHAR_RELEASE_PLAN_ID');
  const wave_id=env('SUTRADHAR_RELEASE_WAVE_ID');
  const offer_sha256=env('SUTRADHAR_RELEASE_OFFER_SHA256');
  if(!/^node_[0-9a-f]{32}$/.test(node_id)||
     !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(plan_id)||
     !/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(wave_id)||
     !/^[0-9a-f]{64}$/.test(offer_sha256))
    throw Error('OWNER_MAINTENANCE_GRANT_SCOPE_INVALID');
  const keyFile=env('SUTRADHAR_MAINTENANCE_SIGNING_KEY_FILE');
  const outFile=env('SUTRADHAR_MAINTENANCE_GRANT_OUTPUT');
  const repo=path.resolve(__dirname,'../..');
  if(!path.isAbsolute(keyFile)||!path.isAbsolute(outFile)||
    keyFile===outFile||[keyFile,outFile].some(x=>x===repo||x.startsWith(repo+path.sep)))
    throw Error('OWNER_MAINTENANCE_GRANT_PATH_MUST_BE_OUTSIDE_REPOSITORY');
  const st=fs.lstatSync(keyFile);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16384)
    throw Error('OWNER_MAINTENANCE_SIGNING_KEY_FILE_INVALID');
  const key=crypto.createPrivateKey(fs.readFileSync(keyFile));
  if(key.asymmetricKeyType!=='ed25519')
    throw Error('OWNER_MAINTENANCE_SIGNING_KEY_NOT_ED25519');
  const now=Date.now();
  const signed={schema:1,action:'release_maintenance_hold',
    node_id,plan_id,wave_id,offer_sha256,
    grant_id:crypto.randomBytes(32).toString('hex'),
    issued_ms:now,expires_ms:now+5*60000};
  const signature_base64=crypto.sign(null,Buffer.from(JSON.stringify(signed)),key)
    .toString('base64');
  const fd=fs.openSync(outFile,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({signed,signature_base64},null,2)+'\n');
    fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({grant_file:outFile,node_id,plan_id,wave_id,
    expires_ms:signed.expires_ms,installer_authorized:false,
    automatic_restart_authorized:false,private_key_exported:false}));
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={main};
