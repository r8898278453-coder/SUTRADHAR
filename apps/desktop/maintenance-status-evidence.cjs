/**
 * Owner-facing Desktop UI evidence summary. An existing filename (including
 * a dangling symlink) is NOT proof of a signed installer/Owner decision.
 * Read-only and never grants launch, hold release, rollback or restart.
 */
'use strict';
const path=require('node:path');
const {evidenceEntryPresent}=require('./maintenance-evidence-presence.cjs');
function summarizeMaintenanceEvidence({dir,present=evidenceEntryPresent}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||typeof present!=='function')
    throw Error('MAINTENANCE_UI_EVIDENCE_DIRECTORY_INVALID');
  const exists=name=>present(path.join(dir,name));
  const guard=(fn,uncertain)=>{try{return fn();}catch{return uncertain;}};
  const failedRecoveryApproval=guard(()=>
    exists('installer-failure-exception-reviewed.json')?
      'OWNER_REVIEW_FILE_PRESENT_UNVERIFIED':'NOT_RECORDED',
    'OWNER_REVIEW_REQUIRED');
  const failedInstallReview=guard(()=>
    exists('installer-failure-review-observed.json')?
      'FAILED_INSTALL_REVIEW_FILE_PRESENT_UNVERIFIED':'NOT_RECORDED',
    'OWNER_REVIEW_REQUIRED');
  const postInstallObservation=guard(()=>
    exists('installer-postinstall-observed.json')?
      'POSTINSTALL_FILE_PRESENT_UNVERIFIED':'NOT_RECORDED',
    'OWNER_REVIEW_REQUIRED');
  const persistentObserver=guard(()=>
    exists('installer-process-observer-unsigned.json')?
      'UNTRUSTED_PROCESS_LIVENESS_WITNESS_PRESENT':'NO_WITNESS_OUTCOME_UNKNOWN',
    'OWNER_REVIEW_REQUIRED');
  const directInstallerExit=guard(()=>
    exists('installer-direct-exit-observed.json')?
      'UNVERIFIED_DIRECT_EXIT_RECEIPT_PRESENT':'NOT_OBSERVED',
    'OWNER_REVIEW_REQUIRED');
  const installerExecution=guard(()=>{
    if(!exists('installer-execution-attempt.json'))return 'NOT_ATTEMPTED';
    return exists('installer-execution-launch-observed.json')?
      'LAUNCH_RECEIPT_PRESENT_INSTALL_UNKNOWN':'ATTEMPT_UNCERTAIN_OWNER_REVIEW';
  },'UNKNOWN_OWNER_REVIEW');
  const installerPreparation=guard(()=>{
    const attempt=exists('installer-preparation-attempt.json');
    const ready=exists('installer-preparation-ready.json');
    return attempt&&ready?'PREPARATION_RECEIPTS_PRESENT_UNVERIFIED':
      attempt||ready?'INTERRUPTED_OWNER_REVIEW':'NONE';
  },'ERROR_OWNER_REVIEW');
  return Object.freeze({failedRecoveryApproval,failedInstallReview,
    postInstallObservation,persistentObserver,directInstallerExit,
    installerExecution,installerPreparation,
    evidence_signature_verified:false,installer_completion_proven:false,
    local_hold_release_allowed:false,automatic_retry_allowed:false});
}
module.exports={summarizeMaintenanceEvidence};
