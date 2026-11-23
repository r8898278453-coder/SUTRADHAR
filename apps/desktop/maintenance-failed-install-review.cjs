/**
 * Read-only diagnosis of a Windows installer attempt after an Owner returns
 * to the OLD installed Desktop. No installer exit-code proof is fabricated.
 * Writes one device-signed observation, NEVER authorizes hold release/retry.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {identityEvidence,inspectPreparedIdentity}=
  require('./maintenance-install-preparation.cjs');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {verifyInstalledDesktopPublisher}=require('./windows-authenticode.cjs');
const {verifySigned,jsonFile}=require('./maintenance-postinstall-verification.cjs');
const {validOrigin}=require('./update-readiness.cjs');
const {boundedCentralJson}=require('./bounded-central-json.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const HEX=/^[a-f0-9]{64}$/;
const EXEC_PREFIX='SUTRADHAR_INSTALL_EXECUTION_V1\n';
const REVIEW_PREFIX='SUTRADHAR_INSTALL_FAILURE_REVIEW_V1\n';
const fail=code=>{throw Error(code);};
function inspectAttempt({dir,node,agentIds,observedVersion}={}){
  const identity=identityEvidence(node,agentIds);
  const prior=inspectPreparedIdentity({dir,node,agentIds,observedVersion});
  const held=inspectHold({dir,nodeId:node.node_id});
  if(!held.active||requiresReconciliation(dir))
    fail('INSTALL_FAILURE_REVIEW_ORIGINAL_HOLD_REQUIRED');
  if(fs.existsSync(path.join(dir,'installer-postinstall-observed.json')))
    fail('INSTALL_FAILURE_REVIEW_POSTINSTALL_SUCCESS_PATH_ALREADY_RECORDED');
  const ready=jsonFile(path.join(dir,'installer-preparation-ready.json'));
  const attempt=verifySigned(jsonFile(path.join(dir,'installer-execution-attempt.json')),
    node,EXEC_PREFIX);
  if(prior.identity_preserved!==true||
     prior.version_matches_target!==false||
     ready.previous_version!==observedVersion||
     ready.target_version===observedVersion||
     ready.node_id!==node.node_id||
     ready.identity_public_key_sha256!==identity.public_key_sha256||
     attempt.node_id!==node.node_id||
     attempt.identity_public_key_sha256!==identity.public_key_sha256||
     attempt.state!=='EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED'||
     attempt.installer_installation_verified!==false||
     attempt.automatic_retry_allowed!==false||
     !HEX.test(attempt.grant_id||'')||
     attempt.plan_id!==held.plan_id||
     attempt.wave_id!==held.wave_id||
     attempt.offer_sha256!==held.offer_sha256||
     attempt.installer_sha256!==ready.installer_sha256||
     attempt.target_version!==ready.target_version||
     attempt.kind!==ready.kind||
     attempt.expected_epoch!==ready.expected_epoch||
     !Number.isSafeInteger(ready.expected_epoch)||ready.expected_epoch<1)
    fail('INSTALL_FAILURE_REVIEW_EVIDENCE_MISMATCH');
  let launched=false;
  if(fs.existsSync(path.join(dir,'installer-execution-launch-observed.json'))){
    const launch=verifySigned(jsonFile(path.join(dir,'installer-execution-launch-observed.json')),
      node,EXEC_PREFIX);
    if(launch.state!=='WINDOWS_INSTALLER_PROCESS_STARTED_UNVERIFIED'||
       launch.node_id!==node.node_id||
       launch.grant_id!==attempt.grant_id||
       launch.installer_sha256!==attempt.installer_sha256||
       launch.kind!==attempt.kind||
       launch.target_version!==attempt.target_version||
       launch.installer_installation_verified!==false||
       launch.automatic_retry_allowed!==false)
      fail('INSTALL_FAILURE_REVIEW_LAUNCH_EVIDENCE_MISMATCH');
    launched=true;
  }
  return {identity,ready,attempt,held,launched};
}
function verifyLocalPublisher(result,expectedSubject){
  if(result?.verified!==true||
     result.publisher_subject!==expectedSubject||
     !HEX.test(result.exe_sha256||'')||
     result.installation_success_proven!==false)
    fail('INSTALL_FAILURE_REVIEW_INSTALLED_PUBLISHER_INVALID');
}
async function observeFailedAttempt({dir,node,agentIds,observedVersion,
  installedExecutable,publisherSubject,centralOrigin,signer,
  platform=process.platform,verifyPublisher=verifyInstalledDesktopPublisher,
  fetcher=fetch}={}){
  if(platform!=='win32'||typeof dir!=='string'||!path.isAbsolute(dir)||
     !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
     agentIds.some(x=>!ID.test(x))||new Set(agentIds).size!==agentIds.length||
     typeof publisherSubject!=='string'||!/^CN=.{1,220}$/.test(publisherSubject)||
     typeof signer?.sign!=='function')
    fail('INSTALL_FAILURE_REVIEW_PACKAGED_WINDOWS_REQUIRED');
  const origin=validOrigin(centralOrigin);
  const receiptPath=path.join(dir,'installer-failure-review-observed.json');
  if(fs.existsSync(receiptPath))
    fail('INSTALL_FAILURE_REVIEW_ALREADY_RECORDED');
  const before=inspectAttempt({dir,node,agentIds,observedVersion});
  const firstPublisher=verifyPublisher({executablePath:installedExecutable,
    publisherSubject,platform});
  verifyLocalPublisher(firstPublisher,publisherSubject);
  async function read(uri){
    const headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!headers||headers['x-sutradhar-node']!==node.node_id||
       typeof headers['x-sutradhar-nonce']!=='string'||
       typeof headers['x-sutradhar-signature']!=='string')
      fail('INSTALL_FAILURE_REVIEW_NODE_SIGNATURE_REQUIRED');
    let response,data;
    try{
      response=await fetcher(origin+uri,{method:'GET',
        headers:{...headers,Accept:'application/json'},
        redirect:'error',cache:'no-store',credentials:'omit',
        signal:AbortSignal.timeout(12000)});
    }catch{fail('INSTALL_FAILURE_REVIEW_CENTRAL_UNREACHABLE');}
    if(!response?.ok)fail('INSTALL_FAILURE_REVIEW_CENTRAL_DENIED');
    try{data=await boundedCentralJson(response);}
    catch(error){
      if(error?.message==='CENTRAL_JSON_TOO_LARGE')
        fail('INSTALL_FAILURE_REVIEW_CENTRAL_TOO_LARGE');
      fail('INSTALL_FAILURE_REVIEW_CENTRAL_INVALID');
    }
    return data;
  }
  const epoch=before.ready.expected_epoch;
  function checkFence(m){
    const i=m?.intent;
    if(m?.node_id!==node.node_id||m.installer_execution_allowed!==false||
       m.owner_maintenance_lease!==false||i?.state!=='DRAINED'||
       i.fence_active!==true||i.fence_release_requires_owner!==true||
       i.plan_id!==before.held.plan_id||
       i.wave_id!==before.held.wave_id||
       i.offer_sha256!==before.held.offer_sha256||
       i.expected_epoch!==epoch)
      fail('INSTALL_FAILURE_REVIEW_CENTRAL_FENCE_CHANGED');
  }
  function checkCluster(c){
    if(c?.epoch!==epoch||c.phase!=='READY'||c.paused!==false||
       !ID.test(c.master_agent_id||'')||!Array.isArray(c.backups)||
       c.backups.length!==2||c.backups.some(x=>!ID.test(x))||
       new Set([c.master_agent_id,...c.backups]).size!==3||
       agentIds.some(id=>[c.master_agent_id,...c.backups].includes(id)))
      fail('INSTALL_FAILURE_REVIEW_CLUSTER_UNHEALTHY');
    return c.master_agent_id+'|'+c.backups.join('|');
  }
  checkFence(await read('/v7/nodes/maintenance'));
  const roles=checkCluster(await read('/v7/cluster/state'));
  const me=await read('/v7/nodes/me');
  if(me?.node_id!==node.node_id||!Array.isArray(me.agents)||
     me.agents.length!==agentIds.length)
    fail('INSTALL_FAILURE_REVIEW_AGENT_IDENTITIES_CHANGED');
  const seen=new Set();
  for(const a of me.agents){
    if(!a||!ID.test(a.agent_id||'')||seen.has(a.agent_id)||
       !agentIds.includes(a.agent_id)||a.state!=='APPROVED'||
       a.status!=='IDLE'||a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job))
      fail('INSTALL_FAILURE_REVIEW_AGENT_HAS_ACTIVE_WORK');
    seen.add(a.agent_id);
  }
  if(checkCluster(await read('/v7/cluster/state'))!==roles)
    fail('INSTALL_FAILURE_REVIEW_CLUSTER_ROLES_CHANGED');
  checkFence(await read('/v7/nodes/maintenance'));
  const after=inspectAttempt({dir,node,agentIds,observedVersion});
  if(JSON.stringify(after)!==JSON.stringify(before))
    fail('INSTALL_FAILURE_REVIEW_LOCAL_EVIDENCE_CHANGED');
  const finalPublisher=verifyPublisher({executablePath:installedExecutable,
    publisherSubject,platform});
  verifyLocalPublisher(finalPublisher,publisherSubject);
  if(firstPublisher.exe_sha256!==finalPublisher.exe_sha256)
    fail('INSTALL_FAILURE_REVIEW_INSTALLED_EXE_CHANGED');
  if(fs.existsSync(receiptPath))
    fail('INSTALL_FAILURE_REVIEW_ALREADY_RECORDED');
  const payload={schema:1,
    state:before.launched?'LAUNCH_OBSERVED_OLD_VERSION':
      'LAUNCH_UNCONFIRMED_OLD_VERSION',
    node_id:node.node_id,plan_id:before.held.plan_id,
    wave_id:before.held.wave_id,offer_sha256:before.held.offer_sha256,
    installer_sha256:before.ready.installer_sha256,
    execution_grant_id:before.attempt.grant_id,
    previous_version:before.ready.previous_version,
    target_version:before.ready.target_version,
    observed_version:observedVersion,
    installed_exe_sha256:firstPublisher.exe_sha256,
    identity_public_key_sha256:before.identity.public_key_sha256,
    expected_epoch:epoch,observed_at_ms:Date.now(),
    installer_exit_code_known:false,installer_outcome_known:false,
    installed_target_observed:false,automatic_rollback_allowed:false,
    owner_hold_release_allowed:false,automatic_retry_allowed:false};
  const key=crypto.createPrivateKey(node.private_key_pem);
  const signed={...payload,signature_base64:crypto.sign(null,
    Buffer.from(REVIEW_PREFIX+JSON.stringify(payload)),key).toString('base64')};
  const fd=fs.openSync(receiptPath,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(signed,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return Object.freeze({recorded:true,state:payload.state,node_id:node.node_id,
    observed_version:observedVersion,target_version:before.ready.target_version,
    installer_outcome_known:false,hold_release_allowed:false,
    automatic_retry_allowed:false,automatic_rollback_allowed:false,
    next_action:'Owner review of Windows installer logs and PC identity is required. Original hold remains active; no automatic recovery authorization was created.'});
}
module.exports={inspectAttempt,observeFailedAttempt};
