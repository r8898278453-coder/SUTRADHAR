'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {summarizeMaintenanceEvidence}=require('../apps/desktop/maintenance-status-evidence.cjs');
function withDir(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-owner-ui-evidence-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('empty PC has no claim of installed or Owner-reviewed outcome',()=>withDir(dir=>{
  const s=summarizeMaintenanceEvidence({dir});
  assert.equal(s.installerExecution,'NOT_ATTEMPTED');
  assert.equal(s.installerPreparation,'NONE');
  assert.equal(s.postInstallObservation,'NOT_RECORDED');
  assert.equal(s.failedRecoveryApproval,'NOT_RECORDED');
  assert.equal(s.evidence_signature_verified,false);
  assert.equal(s.installer_completion_proven,false);
  assert.equal(s.local_hold_release_allowed,false);
}));
test('dangling installer evidence is visible but cannot be labeled verified',()=>withDir(dir=>{
  if(process.platform==='win32')return;
  const entries=[
    'installer-failure-exception-reviewed.json',
    'installer-failure-review-observed.json',
    'installer-postinstall-observed.json',
    'installer-execution-attempt.json',
    'installer-execution-launch-observed.json',
    'installer-preparation-attempt.json',
    'installer-preparation-ready.json',
    'installer-direct-exit-observed.json',
    'installer-process-observer-unsigned.json'
  ];
  for(const name of entries)fs.symlinkSync(path.join(dir,'absent-'+name),
    path.join(dir,name));
  const s=summarizeMaintenanceEvidence({dir});
  assert.equal(s.installerExecution,'LAUNCH_RECEIPT_PRESENT_INSTALL_UNKNOWN');
  assert.equal(s.installerPreparation,'PREPARATION_RECEIPTS_PRESENT_UNVERIFIED');
  assert.equal(s.failedRecoveryApproval,'OWNER_REVIEW_FILE_PRESENT_UNVERIFIED');
  assert.equal(s.failedInstallReview,'FAILED_INSTALL_REVIEW_FILE_PRESENT_UNVERIFIED');
  assert.equal(s.postInstallObservation,'POSTINSTALL_FILE_PRESENT_UNVERIFIED');
  assert.equal(s.directInstallerExit,'UNVERIFIED_DIRECT_EXIT_RECEIPT_PRESENT');
  assert.equal(s.persistentObserver,'UNTRUSTED_PROCESS_LIVENESS_WITNESS_PRESENT');
  assert.equal(s.automatic_retry_allowed,false);
}));
test('partial preparation and uncertain inspection never display staged success',()=>withDir(dir=>{
  const attempt=path.join(dir,'installer-preparation-attempt.json');
  fs.writeFileSync(attempt,'interrupted');
  assert.equal(summarizeMaintenanceEvidence({dir}).installerPreparation,
    'INTERRUPTED_OWNER_REVIEW');
  const injected=()=>{throw Error('permission denied');};
  const s=summarizeMaintenanceEvidence({dir,present:injected});
  assert.equal(s.installerExecution,'UNKNOWN_OWNER_REVIEW');
  assert.equal(s.installerPreparation,'ERROR_OWNER_REVIEW');
  assert.equal(s.postInstallObservation,'OWNER_REVIEW_REQUIRED');
}));
test('packaged Electron main consumes the read-only status helper',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../apps/desktop/main.cjs'),'utf8');
  const pkg=require('../apps/desktop/package.json');
  assert.ok(pkg.build.files.includes('maintenance-status-evidence.cjs'));
  assert.ok(main.includes("require('./maintenance-status-evidence.cjs')"));
  assert.ok(main.includes('summarizeMaintenanceEvidence({dir:nodeDir()})'));
  const block=main.slice(main.indexOf('function safeStatus(){'),
    main.indexOf('function startAgent('));
  assert.ok(!block.includes('installer-postinstall-observed.json'),
    'GUI must not bypass the shared evidence summary');
});
