/**
 * Verify a prior OLD-VERSION installer diagnostic against the original
 * device-signed attempt, exact local hold and currently signed installed app.
 * This is read-only; it creates NO recovery, update or hold-release authority.
 */
'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const {inspectAttempt}=require('./maintenance-failed-install-review.cjs');
const {verifySigned,jsonFile}=require('./maintenance-postinstall-verification.cjs');
const {verifyInstalledDesktopPublisher}=require('./windows-authenticode.cjs');
const PREFIX='SUTRADHAR_INSTALL_FAILURE_REVIEW_V1\n';
const HEX=/^[0-9a-f]{64}$/;
function fail(code){throw Error(code);}
function verifyFailureReview({dir,node,agentIds,observedVersion,
  installedExecutable,publisherSubject,platform=process.platform,
  verifyPublisher=verifyInstalledDesktopPublisher}={}){
  if(platform!=='win32'||typeof dir!=='string'||!path.isAbsolute(dir)||
     typeof observedVersion!=='string'||typeof publisherSubject!=='string'||
     !/^CN=.{1,220}$/.test(publisherSubject)||typeof installedExecutable!=='string')
    fail('FAILURE_EXCEPTION_PACKAGED_WINDOWS_REQUIRED');
  const evidence=inspectAttempt({dir,node,agentIds,observedVersion});
  const raw=jsonFile(path.join(dir,'installer-failure-review-observed.json'));
  const signed=verifySigned(raw,node,PREFIX);
  const expected=evidence.launched?'LAUNCH_OBSERVED_OLD_VERSION':
    'LAUNCH_UNCONFIRMED_OLD_VERSION';
  if(signed.schema!==1||signed.state!==expected||
     signed.node_id!==node.node_id||
     signed.plan_id!==evidence.held.plan_id||
     signed.wave_id!==evidence.held.wave_id||
     signed.offer_sha256!==evidence.held.offer_sha256||
     signed.installer_sha256!==evidence.ready.installer_sha256||
     signed.execution_grant_id!==evidence.attempt.grant_id||
     signed.previous_version!==evidence.ready.previous_version||
     signed.observed_version!==observedVersion||
     signed.target_version!==evidence.ready.target_version||
     signed.identity_public_key_sha256!==evidence.identity.public_key_sha256||
     signed.expected_epoch!==evidence.ready.expected_epoch||
     !HEX.test(signed.installed_exe_sha256||'')||
     !Number.isSafeInteger(signed.observed_at_ms)||signed.observed_at_ms<1||
     signed.installer_exit_code_known!==false||
     signed.installer_outcome_known!==false||
     signed.installed_target_observed!==false||
     signed.automatic_rollback_allowed!==false||
     signed.owner_hold_release_allowed!==false||
     signed.automatic_retry_allowed!==false)
    fail('FAILURE_EXCEPTION_DIAGNOSTIC_IDENTITY_MISMATCH');
  const installed=verifyPublisher({executablePath:installedExecutable,
    publisherSubject,platform});
  if(installed?.verified!==true||
     installed.publisher_subject!==publisherSubject||
     installed.exe_sha256!==signed.installed_exe_sha256||
     installed.installation_success_proven!==false)
    fail('FAILURE_EXCEPTION_INSTALLED_EXE_CHANGED');
  // Bind the *whole signed observation*, including its signature, so an
  // Owner authorization for one specific diagnostic cannot be substituted.
  return Object.freeze({node_id:node.node_id,plan_id:signed.plan_id,
    wave_id:signed.wave_id,offer_sha256:signed.offer_sha256,
    installer_sha256:signed.installer_sha256,
    execution_grant_id:signed.execution_grant_id,
    review_sha256:crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    previous_version:signed.previous_version,target_version:signed.target_version,
    kind:evidence.ready.kind,expected_epoch:signed.expected_epoch,
    installed_exe_sha256:signed.installed_exe_sha256,
    diagnostic_state:signed.state,old_version_preserved:true,
    installer_exit_status_proven:false,hold_release_allowed:false,
    automatic_retry_allowed:false,rollback_authorized:false});
}
module.exports={verifyFailureReview};
