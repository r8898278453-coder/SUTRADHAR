/**
 * Offline Owner grant signer for an exact, device-signed failed-install review.
 * It verifies the device's signed receipts FIRST. Neither a private OS-vault
 * device key nor the Windows installer is touched by this script.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const HEX=/^[0-9a-f]{64}$/,NODE=/^node_[0-9a-f]{32}$/;
const PLAN=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
function fail(code){throw Error(code);}
function required(name){
  const value=process.env[name];
  if(!value)fail('OWNER_FAILURE_GRANT_MISSING_'+name);
  return value;
}
function readExact(file,max=8192){
  if(!path.isAbsolute(file))fail('OWNER_FAILURE_GRANT_ABSOLUTE_PATH_REQUIRED');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>max)
    fail('OWNER_FAILURE_GRANT_SOURCE_FILE_UNSAFE');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function checkedSignature(raw,key,prefix){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     typeof raw.signature_base64!=='string'||
     raw.signature_base64.length<80||raw.signature_base64.length>256)
    fail('OWNER_FAILURE_GRANT_DEVICE_RECEIPT_INVALID');
  const {signature_base64,...payload}=raw;
  // The original escrow v1 journal used a literal backslash + "n"
  // separator, while execution/diagnostic journals use a newline byte.
  // Preserve the actual signed bytes; never skip verification or re-sign.
  const separator=prefix==='SUTRADHAR_INSTALLER_ESCROW_V1'?
    String.fromCharCode(92,110):String.fromCharCode(10);
  if(!crypto.verify(null,Buffer.from(prefix+separator+JSON.stringify(payload)),
      key,Buffer.from(signature_base64,'base64')))
    fail('OWNER_FAILURE_GRANT_DEVICE_SIGNATURE_INVALID');
  return payload;
}
function main(){
  if(process.env.SUTRADHAR_OWNER_FAILURE_RECOVERY_REVIEW_APPROVED!=='yes')
    fail('OWNER_FAILURE_GRANT_EXPLICIT_APPROVAL_REQUIRED');
  const repo=path.resolve(__dirname,'../..');
  const sourceNames=['SUTRADHAR_FAILURE_DIAGNOSTIC_JSON',
    'SUTRADHAR_FAILURE_PREPARED_JSON',
    'SUTRADHAR_FAILURE_EXECUTION_ATTEMPT_JSON',
    'SUTRADHAR_FAILURE_DEVICE_PUBLIC_KEY_FILE'];
  const files=sourceNames.map(required);
  const privateFile=required('SUTRADHAR_FAILURE_OWNER_SIGNING_KEY_FILE');
  const output=required('SUTRADHAR_FAILURE_OWNER_GRANT_OUTPUT');
  if(!path.isAbsolute(privateFile)||!path.isAbsolute(output)||
     privateFile===output||[privateFile,output].some(file=>{
       const full=path.resolve(file);
       return full===repo||full.startsWith(repo+path.sep);
     }))fail('OWNER_FAILURE_GRANT_PRIVATE_PATH_MUST_BE_OUTSIDE_REPO');
  const publicFile=files[3];
  if(!path.isAbsolute(publicFile))fail('OWNER_FAILURE_GRANT_PUBLIC_KEY_PATH_INVALID');
  const st=fs.lstatSync(publicFile);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16384)
    fail('OWNER_FAILURE_GRANT_PUBLIC_KEY_FILE_INVALID');
  const deviceKey=crypto.createPublicKey(fs.readFileSync(publicFile));
  if(deviceKey.asymmetricKeyType!=='ed25519')
    fail('OWNER_FAILURE_GRANT_DEVICE_KEY_INVALID');
  const rawReview=readExact(files[0]);
  const review=checkedSignature(rawReview,deviceKey,'SUTRADHAR_INSTALL_FAILURE_REVIEW_V1');
  const ready=checkedSignature(readExact(files[1]),deviceKey,
    'SUTRADHAR_INSTALLER_ESCROW_V1');
  const attempt=checkedSignature(readExact(files[2]),deviceKey,
    'SUTRADHAR_INSTALL_EXECUTION_V1');
  if(review.schema!==1||
     !['LAUNCH_OBSERVED_OLD_VERSION',
       'LAUNCH_UNCONFIRMED_OLD_VERSION'].includes(review.state)||
     review.installer_outcome_known!==false||
     review.installer_exit_code_known!==false||
     review.installed_target_observed!==false||
     review.owner_hold_release_allowed!==false||
     review.automatic_rollback_allowed!==false||
     review.automatic_retry_allowed!==false||
     ready.schema!==1||ready.status!=='OFFLINE_STAGED_NOT_INSTALLED'||
     attempt.schema!==1||
     attempt.state!=='EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED'||
     !NODE.test(review.node_id||'')||!PLAN.test(review.plan_id||'')||
     !WAVE.test(review.wave_id||'')||
     !HEX.test(review.offer_sha256||'')||
     !HEX.test(review.installer_sha256||'')||
     !HEX.test(review.execution_grant_id||'')||
     !HEX.test(review.identity_public_key_sha256||'')||
     review.node_id!==ready.node_id||review.node_id!==attempt.node_id||
     review.plan_id!==ready.plan_id||review.plan_id!==attempt.plan_id||
     review.wave_id!==ready.wave_id||review.wave_id!==attempt.wave_id||
     review.offer_sha256!==ready.offer_sha256||
     review.offer_sha256!==attempt.offer_sha256||
     review.installer_sha256!==ready.installer_sha256||
     review.installer_sha256!==attempt.installer_sha256||
     review.execution_grant_id!==attempt.grant_id||
     review.identity_public_key_sha256!==ready.identity_public_key_sha256||
     review.identity_public_key_sha256!==attempt.identity_public_key_sha256||
     review.previous_version!==ready.previous_version||
     review.observed_version!==review.previous_version||
     review.target_version!==ready.target_version||
     review.target_version!==attempt.target_version||
     review.expected_epoch!==ready.expected_epoch||
     review.expected_epoch!==attempt.expected_epoch||
     attempt.kind!==ready.kind||
     !['update','rollback'].includes(ready.kind))
    fail('OWNER_FAILURE_GRANT_RECEIPTS_DONT_MATCH');
  const review_sha256=crypto.createHash('sha256').update(
    JSON.stringify(rawReview)).digest('hex');
  const stat=fs.lstatSync(privateFile);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>16384)
    fail('OWNER_FAILURE_GRANT_SIGNING_KEY_FILE_INVALID');
  const privateKey=crypto.createPrivateKey(fs.readFileSync(privateFile));
  if(privateKey.asymmetricKeyType!=='ed25519')
    fail('OWNER_FAILURE_GRANT_SIGNING_KEY_NOT_ED25519');
  const now=Date.now();
  const signed={schema:1,action:'review_failed_install_recovery',
    node_id:review.node_id,plan_id:review.plan_id,wave_id:review.wave_id,
    offer_sha256:review.offer_sha256,installer_sha256:review.installer_sha256,
    execution_grant_id:review.execution_grant_id,review_sha256,
    previous_version:review.previous_version,
    target_version:review.target_version,kind:ready.kind,
    expected_epoch:review.expected_epoch,
    grant_id:crypto.randomBytes(32).toString('hex'),
    issued_ms:now,expires_ms:now+5*60000};
  const signature_base64=crypto.sign(null,
    Buffer.from(JSON.stringify(signed)),privateKey).toString('base64');
  const fd=fs.openSync(output,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({signed,signature_base64},null,2)+'\n');
    fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({grant_file:output,node_id:signed.node_id,
    plan_id:signed.plan_id,review_sha256,
    expires_ms:signed.expires_ms,
    device_receipt_signatures_verified:true,
    hold_release_authorized:false,installer_run_authorized:false,
    retry_authorized:false,agent_restart_authorized:false}));
}
if(require.main===module)try{main();}catch(error){
  console.error(String(error.message||error));process.exitCode=1;
}
module.exports={main};
