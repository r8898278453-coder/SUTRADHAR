/**
 * Post-install OBSERVATION, not NSIS/UAC exit-code attestation.
 * Requires signed launch journals, preserved OS-vault identity, target version,
 * Authenticode on the running installed EXE, and fresh node-authenticated
 * Central DRAINED / idle-worker / cluster checks. Never releases the hold.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {inspectPreparedIdentity,identityEvidence}=require('./maintenance-install-preparation.cjs');
const {verifyInstalledDesktopPublisher}=require('./windows-authenticode.cjs');
const {validOrigin}=require('./update-readiness.cjs');
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const HEX=/^[0-9a-f]{64}$/;
const EXEC_PREFIX='SUTRADHAR_INSTALL_EXECUTION_V1\n';
const OBS_PREFIX='SUTRADHAR_POSTINSTALL_OBSERVATION_V1\n';
function fail(code){throw Error(code);}
function jsonFile(file){
  let stat,body;
  try{
    stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>8192)
      fail('POSTINSTALL_RECEIPT_FILE_UNSAFE');
    body=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch{fail('POSTINSTALL_RECEIPT_MISSING_OR_CORRUPT');}
  if(!body||typeof body!=='object'||Array.isArray(body))
    fail('POSTINSTALL_RECEIPT_MISSING_OR_CORRUPT');
  return body;
}
function verifySigned(data,node,prefix){
  if(typeof data.signature_base64!=='string'||data.signature_base64.length>256||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(data.signature_base64))
    fail('POSTINSTALL_DEVICE_SIGNATURE_REQUIRED');
  const {signature_base64,...payload}=data;
  let accepted=false;
  try{
    const key=crypto.createPublicKey(node.public_key_pem);
    if(key.asymmetricKeyType==='ed25519')
      accepted=crypto.verify(null,Buffer.from(prefix+JSON.stringify(payload)),
        key,Buffer.from(signature_base64,'base64'));
  }catch{}
  if(!accepted)fail('POSTINSTALL_DEVICE_SIGNATURE_INVALID');
  return payload;
}
function signObservation(data,node){
  const privateKey=crypto.createPrivateKey(node.private_key_pem);
  return {...data,signature_base64:crypto.sign(null,
    Buffer.from(OBS_PREFIX+JSON.stringify(data)),privateKey).toString('base64')};
}
function baseEvidence({dir,node,agentIds,observedVersion}){
  const identity=identityEvidence(node,agentIds);
  const local=inspectPreparedIdentity({dir,node,agentIds,observedVersion});
  if(local.identity_preserved!==true||local.version_matches_target!==true)
    fail('POSTINSTALL_TARGET_VERSION_NOT_OBSERVED_OWNER_REVIEW');
  const held=inspectHold({dir,nodeId:node.node_id});
  if(!held.active||requiresReconciliation(dir))
    fail('POSTINSTALL_ORIGINAL_MAINTENANCE_HOLD_REQUIRED');
  const ready=jsonFile(path.join(dir,'installer-preparation-ready.json'));
  const attempt=verifySigned(jsonFile(path.join(dir,'installer-execution-attempt.json')),
    node,EXEC_PREFIX);
  const launch=verifySigned(jsonFile(path.join(dir,'installer-execution-launch-observed.json')),
    node,EXEC_PREFIX);
  if(ready.node_id!==node.node_id||attempt.node_id!==node.node_id||
     launch.node_id!==node.node_id||
     !HEX.test(attempt.grant_id||'')||launch.grant_id!==attempt.grant_id||
     attempt.state!=='EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED'||
     launch.state!=='WINDOWS_INSTALLER_PROCESS_STARTED_UNVERIFIED'||
     attempt.plan_id!==held.plan_id||ready.plan_id!==held.plan_id||
     attempt.wave_id!==held.wave_id||ready.wave_id!==held.wave_id||
     attempt.offer_sha256!==held.offer_sha256||
     ready.offer_sha256!==held.offer_sha256||
     !HEX.test(ready.installer_sha256||'')||
     attempt.installer_sha256!==ready.installer_sha256||
     launch.installer_sha256!==ready.installer_sha256||
     attempt.target_version!==ready.target_version||
     launch.target_version!==ready.target_version||
     attempt.kind!==ready.kind||launch.kind!==ready.kind||
     attempt.expected_epoch!==ready.expected_epoch||
     attempt.identity_public_key_sha256!==identity.public_key_sha256||
     ready.identity_public_key_sha256!==identity.public_key_sha256||
     !Number.isSafeInteger(attempt.attempted_at_ms)||
     !Number.isSafeInteger(launch.observed_at_ms)||
     launch.observed_at_ms<attempt.attempted_at_ms||
     !Number.isSafeInteger(ready.expected_epoch)||ready.expected_epoch<1||
     attempt.installer_installation_verified!==false||
     launch.installer_installation_verified!==false||
     launch.identity_preservation_verified!==false||
     launch.central_reconciliation_verified!==false||
     attempt.automatic_retry_allowed!==false||
     launch.automatic_retry_allowed!==false)
    fail('POSTINSTALL_EXECUTION_EVIDENCE_MISMATCH');
  return {identity,ready,attempt,launch,held};
}
function verifyObservedReceipt({dir,node,agentIds,observedVersion}={}){
  if(!node||!NODE.test(node.node_id||'')||
     typeof dir!=='string'||!path.isAbsolute(dir))
    fail('POSTINSTALL_OBSERVATION_ARGUMENTS_INVALID');
  const receipt=verifySigned(
    jsonFile(path.join(dir,'installer-postinstall-observed.json')),
    node,OBS_PREFIX);
  if(receipt.observed_version!==observedVersion)
    fail('POSTINSTALL_CURRENT_APP_VERSION_CHANGED');
  const baseline=baseEvidence({dir,node,agentIds,observedVersion});
  const identity=baseline.identity;
  const held=baseline.held;
  if(baseline.attempt.grant_id!==receipt.execution_grant_id||
     baseline.attempt.installer_sha256!==receipt.installer_sha256||
     baseline.ready.target_version!==receipt.observed_version)
    fail('POSTINSTALL_OBSERVATION_EVIDENCE_CHANGED');
  if(!held.active||receipt.schema!==1||
     receipt.state!=='TARGET_VERSION_IDENTITY_CENTRAL_OBSERVED'||
     receipt.node_id!==node.node_id||
     receipt.identity_public_key_sha256!==identity.public_key_sha256||
     receipt.plan_id!==held.plan_id||
     receipt.wave_id!==held.wave_id||
     receipt.offer_sha256!==held.offer_sha256||
     !HEX.test(receipt.installed_exe_sha256||'')||
     !HEX.test(receipt.installer_sha256||'')||
     !HEX.test(receipt.execution_grant_id||'')||
     !Number.isSafeInteger(receipt.expected_epoch)||receipt.expected_epoch<1||
     receipt.installer_completion_proven!==false||
     receipt.installer_exit_code_verified!==false||
     receipt.auto_release_allowed!==false||
     receipt.automatic_rollback_allowed!==false)
    fail('POSTINSTALL_OBSERVATION_IDENTITY_MISMATCH');
  const attempt=verifySigned(jsonFile(path.join(dir,'installer-execution-attempt.json')),
    node,EXEC_PREFIX);
  if(attempt.grant_id!==receipt.execution_grant_id||
     attempt.installer_sha256!==receipt.installer_sha256||
     attempt.expected_epoch!==receipt.expected_epoch||
     attempt.target_version!==receipt.observed_version||
     attempt.kind!==receipt.kind)
    fail('POSTINSTALL_OBSERVATION_EXECUTION_MISMATCH');
  return Object.freeze({observed:true,node_id:node.node_id,
    plan_id:receipt.plan_id,wave_id:receipt.wave_id,
    offer_sha256:receipt.offer_sha256,
    target_version_observed:true,
    installer_completion_proven:false,auto_release_allowed:false});
}
async function observePostInstall({dir,node,agentIds,observedVersion,
  installedExecutable,publisherSubject,centralOrigin,signer,
  platform=process.platform,verifyPublisher=verifyInstalledDesktopPublisher,
  fetcher=fetch,now=Date.now()}={}){
  if(platform!=='win32'||typeof dir!=='string'||!path.isAbsolute(dir)||
     !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
     agentIds.some(x=>!ID.test(x))||new Set(agentIds).size!==agentIds.length||
     !signer||typeof signer.sign!=='function'||
     !Number.isSafeInteger(now)||now<0)
    fail('POSTINSTALL_WINDOWS_ENROLLED_PC_REQUIRED');
  const origin=validOrigin(centralOrigin);
  if(fs.existsSync(path.join(dir,'installer-postinstall-observed.json')))
    fail('POSTINSTALL_OBSERVATION_ALREADY_RECORDED');
  const before=baseEvidence({dir,node,agentIds,observedVersion});
  if(!/^CN=.{1,220}$/.test(publisherSubject||''))
    fail('POSTINSTALL_PUBLISHER_NOT_PINNED');
  const published=verifyPublisher({executablePath:installedExecutable,
    publisherSubject,platform});
  if(published?.verified!==true||
     published.publisher_subject!==publisherSubject||
     !HEX.test(published.exe_sha256||'')||
     published.installation_success_proven!==false)
    fail('POSTINSTALL_INSTALLED_APP_AUTHENTICODE_REQUIRED');
  async function read(uri){
    const headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!headers||headers['x-sutradhar-node']!==node.node_id||
       typeof headers['x-sutradhar-nonce']!=='string'||
       typeof headers['x-sutradhar-signature']!=='string')
      fail('POSTINSTALL_NODE_SIGNATURE_REQUIRED');
    let response,data;
    try{
      response=await fetcher(origin+uri,{method:'GET',
        headers:{...headers,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(12000)});
    }catch{fail('POSTINSTALL_CENTRAL_UNREACHABLE');}
    if(!response?.ok)fail('POSTINSTALL_CENTRAL_DENIED');
    try{data=await response.json();}catch{fail('POSTINSTALL_CENTRAL_INVALID');}
    if(!data||typeof data!=='object'||Array.isArray(data))
      fail('POSTINSTALL_CENTRAL_INVALID');
    return data;
  }
  function checkMaintenance(m){
    const i=m?.intent,r=before.ready;
    if(m?.node_id!==node.node_id||m.installer_execution_allowed!==false||
       m.owner_maintenance_lease!==false||
       i?.state!=='DRAINED'||i.fence_active!==true||
       i.fence_release_requires_owner!==true||
       i.plan_id!==r.plan_id||i.wave_id!==r.wave_id||
       i.offer_sha256!==r.offer_sha256||i.expected_epoch!==r.expected_epoch)
      fail('POSTINSTALL_CENTRAL_FENCE_NOT_RECONCILED');
  }
  function checkCluster(c){
    if(c?.epoch!==before.ready.expected_epoch||c.phase!=='READY'||
       c.paused!==false||!ID.test(c.master_agent_id||'')||
       !Array.isArray(c.backups)||c.backups.length!==2||
       c.backups.some(x=>!ID.test(x))||
       new Set([c.master_agent_id,...c.backups]).size!==3||
       agentIds.some(x=>[c.master_agent_id,...c.backups].includes(x)))
      fail('POSTINSTALL_CLUSTER_NOT_READY');
    return c.master_agent_id+'|'+c.backups.join('|');
  }
  checkMaintenance(await read('/v7/nodes/maintenance'));
  const cluster1=checkCluster(await read('/v7/cluster/state'));
  const me=await read('/v7/nodes/me');
  if(me?.node_id!==node.node_id||!Array.isArray(me.agents)||
     me.agents.length!==agentIds.length)
    fail('POSTINSTALL_CENTRAL_NODE_IDENTITY_MISMATCH');
  const seen=new Set();
  for(const a of me.agents){
    if(!a||!ID.test(a.agent_id||'')||seen.has(a.agent_id)||
       !agentIds.includes(a.agent_id)||a.state!=='APPROVED'||
       a.status!=='IDLE'||a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job))
      fail('POSTINSTALL_AGENT_BUSY_OR_UNAPPROVED');
    seen.add(a.agent_id);
  }
  if(checkCluster(await read('/v7/cluster/state'))!==cluster1)
    fail('POSTINSTALL_CLUSTER_ROLE_CHANGED');
  checkMaintenance(await read('/v7/nodes/maintenance'));
  const after=baseEvidence({dir,node,agentIds,observedVersion});
  if(JSON.stringify({
    identity:after.identity,ready:after.ready,
    attempt:after.attempt,launch:after.launch,held:after.held
  })!==JSON.stringify(before))
    fail('POSTINSTALL_LOCAL_EVIDENCE_CHANGED');
  const lastPub=verifyPublisher({executablePath:installedExecutable,
    publisherSubject,platform});
  if(lastPub?.verified!==true||
     lastPub.exe_sha256!==published.exe_sha256||
     lastPub.publisher_subject!==published.publisher_subject||
     lastPub.installation_success_proven!==false)
    fail('POSTINSTALL_INSTALLED_APP_CHANGED');
  if(fs.existsSync(path.join(dir,'installer-postinstall-observed.json')))
    fail('POSTINSTALL_OBSERVATION_ALREADY_RECORDED');
  const payload={schema:1,state:'TARGET_VERSION_IDENTITY_CENTRAL_OBSERVED',
    node_id:node.node_id,plan_id:before.ready.plan_id,
    wave_id:before.ready.wave_id,offer_sha256:before.ready.offer_sha256,
    installer_sha256:before.ready.installer_sha256,
    execution_grant_id:before.attempt.grant_id,
    identity_public_key_sha256:before.identity.public_key_sha256,
    observed_version:observedVersion,kind:before.ready.kind,
    expected_epoch:before.ready.expected_epoch,
    installed_exe_sha256:published.exe_sha256,
    publisher_subject:publisherSubject,observed_at_ms:Date.now(),
    installer_completion_proven:false,installer_exit_code_verified:false,
    central_maintenance_reconfirmed:true,auto_release_allowed:false,
    automatic_rollback_allowed:false};
  const file=path.join(dir,'installer-postinstall-observed.json');
  const fd=fs.openSync(file,'wx',0o600);
  try{
    fs.writeFileSync(fd,JSON.stringify(signObservation(payload,node),null,2)+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  return Object.freeze({observed:true,node_id:node.node_id,
    observed_version:observedVersion,installed_exe_publisher_verified:true,
    central_maintenance_reconfirmed:true,identity_preserved:true,
    installer_completion_proven:false,installer_exit_code_verified:false,
    local_hold_still_active:true,agent_restart_allowed:false,
    owner_cancellation_required:true,
    next_action:'Owner reviews Windows setup outcome and version/identity, then separately cancels Central maintenance and signs hold release.'});
}
module.exports={observePostInstall,verifyObservedReceipt};
