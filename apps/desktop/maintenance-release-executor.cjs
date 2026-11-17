/**
 * Owner-guided maintenance HOLD release. Never runs an installer or automatically
 * starts the agent. Requires an independently signed, short-lived grant plus
 * TWO fresh signed Central cancellation proofs on the enrolled node.
 *
 * Fail-closed crash semantics: exclusive receipt is created/fsynced BEFORE
 * rename; interrupted operations are not auto-retried. Do not remove records.
 */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const {inspectHold,location}=require('./maintenance-recovery-hold.cjs');
const {checkRecovery}=require('./maintenance-recovery-preflight.cjs');
const {verifyRecoveryGrant}=require('./maintenance-release-grant.cjs');
function fail(code){throw Error(code);}
function boundedFile(file){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('RECOVERY_RELEASE_GRANT_FILE_INVALID');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<200||st.size>8192)
    fail('RECOVERY_RELEASE_GRANT_FILE_INVALID');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function receiptLocation(dir,grantId){
  return path.join(dir,'maintenance-release-'+grantId+'.json');
}
async function releaseHold({dir,centralOrigin,nodeId,signer,grantEnvelope,
  pinnedPublicKeyPem,agentStopped,fetcher,now=Date.now()}={}){
  if(agentStopped!==true)fail('RECOVERY_RELEASE_AGENT_STOP_NOT_CONFIRMED');
  if(typeof nodeId!=='string'||!Number.isSafeInteger(now))
    fail('RECOVERY_RELEASE_IDENTITY_INVALID');
  const original=inspectHold({dir,nodeId});
  if(!original.active)fail('RECOVERY_RELEASE_NO_HOLD');
  const grant=verifyRecoveryGrant({envelope:grantEnvelope,pinnedPublicKeyPem,
    held:original,now});
  const receipt=receiptLocation(dir,grant.grant_id);
  const archive=path.join(dir,'maintenance-recovery-hold.released.'+grant.grant_id+'.json');
  if(fs.existsSync(receipt)||fs.existsSync(archive))
    fail('RECOVERY_RELEASE_ATTEMPT_ALREADY_RECORDED');
  const evidenceArgs={dir,centralOrigin,nodeId,signer,...(fetcher?{fetcher}:{})};
  const first=await checkRecovery(evidenceArgs);
  if(first.cancellation_verified!==true||first.plan_id!==grant.plan_id)
    fail('RECOVERY_RELEASE_OWNER_CANCELLATION_REQUIRED');
  // Repeat after network interaction to reduce exposure to changes while
  // checking evidence. Central does not supply a permanent restart lease.
  const second=await checkRecovery(evidenceArgs);
  if(second.cancellation_verified!==true||second.plan_id!==grant.plan_id)
    fail('RECOVERY_RELEASE_OWNER_CANCELLATION_CHANGED');
  const current=inspectHold({dir,nodeId});
  if(!current.active||current.plan_id!==grant.plan_id||
     current.wave_id!==grant.wave_id||
     current.offer_sha256!==grant.offer_sha256)
    fail('RECOVERY_RELEASE_HOLD_CHANGED');
  if(Date.now()>grant.expires_ms)
    fail('RECOVERY_RELEASE_GRANT_EXPIRED_DURING_CHECK');
  const source=location(dir);
  const before=fs.lstatSync(source);
  if(!before.isFile()||before.isSymbolicLink())
    fail('RECOVERY_RELEASE_FILE_INVALID');
  const payload={schema:1,status:'OWNER_RELEASE_REQUEST_RECORDED',
    node_id:nodeId,plan_id:grant.plan_id,wave_id:grant.wave_id,
    grant_id:grant.grant_id,offer_sha256:grant.offer_sha256,
    released_at_ms:Date.now(),installer_executed:false,automatic_restart:false,
    central_cancellation_verified:true};
  // A durable, exclusive record precedes the atomic archival rename. If the
  // process crashes between steps, the hold remains and cannot be retried
  // blindly. File-system durability needs physical Windows acceptance.
  const fd=fs.openSync(receipt,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(payload,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  const currentStat=fs.lstatSync(source);
  if(!currentStat.isFile()||currentStat.isSymbolicLink()||
     currentStat.dev!==before.dev||currentStat.ino!==before.ino||
     currentStat.size!==before.size||currentStat.mtimeMs!==before.mtimeMs)
    fail('RECOVERY_RELEASE_HOLD_FILE_CHANGED_OWNER_REVIEW');
  if(fs.existsSync(archive))fail('RECOVERY_RELEASE_ARCHIVE_CONFLICT');
  fs.renameSync(source,archive);
  // Refuse to claim successful release unless archive exists and old hold is absent.
  if(fs.existsSync(source)||!fs.existsSync(archive))
    fail('RECOVERY_RELEASE_RENAME_UNCERTAIN');
  return Object.freeze({released:true,node_id:nodeId,plan_id:grant.plan_id,
    grant_id:grant.grant_id,agent_started:false,installer_executed:false,
    archive_retained:true,post_release_health_verified:false,
    next_action:'Owner must manually reconcile Central and explicitly restart this PC agent; no automatic restart was attempted.'});
}
module.exports={releaseHold,boundedFile};
