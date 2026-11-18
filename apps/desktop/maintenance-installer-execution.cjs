/**
 * Owner-gated, one-time INTERACTIVE launch of exact already-staged Windows EXE.
 *
 * This acknowledges only Windows process creation, never successful installation.
 * Original maintenance HOLD and OS-vault keys are neither moved nor deleted.
 * Even a failed / uncertain spawn leaves an exclusive attempt receipt and needs
 * Owner intervention; it must never auto-retry.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {identityEvidence,inspectPreparedIdentity}=require('./maintenance-install-preparation.cjs');
const {verifyExecutionGrant}=require('./maintenance-installer-execution-grant.cjs');
const {verifyWindowsPublisher}=require('./windows-authenticode.cjs');
const {validOrigin}=require('./update-readiness.cjs');
const {sha256File}=require('./update-policy.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const HEX=/^[0-9a-f]{64}$/;
const PREFIX='SUTRADHAR_INSTALL_EXECUTION_V1\n';
function fail(code){throw Error(code);}
function boundedJson(file,max=8192){
  let stat,value;
  try{
    stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>max)
      fail('UPDATE_EXECUTION_JOURNAL_INVALID');
    value=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch{fail('UPDATE_EXECUTION_JOURNAL_CORRUPT_OWNER_REVIEW');}
  if(!value||typeof value!=='object'||Array.isArray(value))
    fail('UPDATE_EXECUTION_JOURNAL_CORRUPT_OWNER_REVIEW');
  return value;
}
function signedRecord(payload,node){
  const signature_base64=crypto.sign(null,Buffer.from(PREFIX+JSON.stringify(payload)),
    crypto.createPrivateKey(node.private_key_pem)).toString('base64');
  return {...payload,signature_base64};
}
function persistNew(file,data){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
function checkPrepared({dir,node,agentIds,observedVersion}){
  const proof=inspectPreparedIdentity({dir,node,agentIds,observedVersion});
  if(!proof.identity_preserved||!proof.agent_id_set_matched||
     !proof.public_key_fingerprint_matched)
    fail('UPDATE_EXECUTION_LOCAL_IDENTITY_NOT_PRESERVED');
  const ready=boundedJson(path.join(dir,'installer-preparation-ready.json'));
  if(ready.status!=='OFFLINE_STAGED_NOT_INSTALLED'||
     !HEX.test(ready.installer_sha256||'')||
     ready.installer_sha256!==ready.staged_sha256||
     !Number.isSafeInteger(ready.offer_expires_at_ms)||
     ready.offer_expires_at_ms<=Date.now()||
     !/^SUTRADHAR[-_ A-Za-z0-9.()]+\.exe$/.test(ready.installer_filename||'')||
     ready.installer_filename.includes('..')||
     !Number.isSafeInteger(ready.expected_epoch)||ready.expected_epoch<1||
     !['update','rollback'].includes(ready.kind)||
     !proof.observed_version||proof.observed_version!==ready.previous_version||
     proof.target_version!==ready.target_version)
    fail('UPDATE_EXECUTION_PREPARATION_NOT_READY');
  const held=inspectHold({dir,nodeId:node.node_id});
  if(!held.active||requiresReconciliation(dir)||
     held.plan_id!==ready.plan_id||held.wave_id!==ready.wave_id||
     held.offer_sha256!==ready.offer_sha256)
    fail('UPDATE_EXECUTION_MAINTENANCE_HOLD_REQUIRED');
  const escrow=path.join(dir,'installer-escrow');
  const dirStat=fs.lstatSync(escrow);
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink())
    fail('UPDATE_EXECUTION_ESCROW_DIRECTORY_UNSAFE');
  const stagedPath=path.join(escrow,ready.installer_filename);
  const st=fs.lstatSync(stagedPath);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1000||st.size>1073741824)
    fail('UPDATE_EXECUTION_STAGED_BINARY_UNSAFE');
  if(sha256File(stagedPath)!==ready.installer_sha256)
    fail('UPDATE_EXECUTION_STAGED_BINARY_TAMPERED');
  return {ready,stagedPath};
}
function safeCluster(d,expectedEpoch,agentIds){
  if(!d||d.epoch!==expectedEpoch||d.phase!=='READY'||d.paused!==false||
     !ID.test(d.master_agent_id||'')||
     !Array.isArray(d.backups)||d.backups.length!==2||
     d.backups.some(x=>!ID.test(x))||
     new Set([d.master_agent_id,...d.backups]).size!==3||
     agentIds.some(id=>[d.master_agent_id,...d.backups].includes(id)))
    fail('UPDATE_EXECUTION_CLUSTER_UNHEALTHY');
}
async function launchStagedInstaller({dir,node,agentIds,observedVersion,
  centralOrigin,signer,grantEnvelope,pinnedExecutionPublicKeyPem,
  publisherSubject,platform=process.platform,fetcher=fetch,
  authenticode=verifyWindowsPublisher,runner=spawn,now=Date.now()}={}){
  if(platform!=='win32'||typeof dir!=='string'||!path.isAbsolute(dir)||
     !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
     agentIds.some(id=>!ID.test(id))||new Set(agentIds).size!==agentIds.length||
     !signer||typeof signer.sign!=='function'||
     !Number.isSafeInteger(now)||now<0)
    fail('UPDATE_EXECUTION_PACKAGED_WINDOWS_DEVICE_REQUIRED');
  const origin=validOrigin(centralOrigin);
  const identity=identityEvidence(node,agentIds);
  const {ready,stagedPath}=checkPrepared({dir,node,agentIds,observedVersion});
  if(identity.node_id!==ready.node_id||
     identity.public_key_sha256!==ready.identity_public_key_sha256)
    fail('UPDATE_EXECUTION_VAULT_IDENTITY_CHANGED');
  const approved=verifyExecutionGrant({envelope:grantEnvelope,
    pinnedPublicKeyPem:pinnedExecutionPublicKeyPem,prepared:ready,now});
  const attemptPath=path.join(dir,'installer-execution-attempt.json');
  const launchedPath=path.join(dir,'installer-execution-launch-observed.json');
  if(fs.existsSync(attemptPath)||fs.existsSync(launchedPath))
    fail('UPDATE_EXECUTION_ATTEMPT_ALREADY_EXISTS_OWNER_REVIEW');
  // Verify actual STAGED bytes, not merely the original downloaded EXE.
  const signature=authenticode({installerPath:stagedPath,
    publisherSubject,expectedSha256:ready.installer_sha256,platform});
  if(signature?.verified!==true||
     signature.file_sha256!==ready.installer_sha256||
     signature.publisher_subject!==publisherSubject||
     signature.installer_execution_allowed!==false)
    fail('UPDATE_EXECUTION_AUTHENTICODE_REQUIRED');
  async function signedRead(uri){
    const headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!headers||headers['x-sutradhar-node']!==node.node_id||
       typeof headers['x-sutradhar-nonce']!=='string'||
       typeof headers['x-sutradhar-signature']!=='string')
      fail('UPDATE_EXECUTION_SIGNED_CENTRAL_REQUIRED');
    let response,data;
    try{response=await fetcher(origin+uri,{method:'GET',
      headers:{...headers,Accept:'application/json'},redirect:'error',
      signal:AbortSignal.timeout(12000)});}
    catch{fail('UPDATE_EXECUTION_CENTRAL_UNREACHABLE');}
    if(!response?.ok)fail('UPDATE_EXECUTION_CENTRAL_REJECTED');
    try{data=await response.json();}catch{fail('UPDATE_EXECUTION_CENTRAL_MALFORMED');}
    if(!data||typeof data!=='object'||Array.isArray(data))
      fail('UPDATE_EXECUTION_CENTRAL_MALFORMED');
    return data;
  }
  function safeFence(d){
    const i=d?.intent;
    if(d.node_id!==node.node_id||d.installer_execution_allowed!==false||
       d.owner_maintenance_lease!==false||
       i?.state!=='DRAINED'||i.fence_active!==true||
       i.fence_release_requires_owner!==true||
       i.plan_id!==ready.plan_id||i.wave_id!==ready.wave_id||
       i.offer_sha256!==ready.offer_sha256||
       i.expected_epoch!==ready.expected_epoch)
      fail('UPDATE_EXECUTION_OWNER_FENCE_CHANGED');
  }
  safeFence(await signedRead('/v7/nodes/maintenance'));
  const firstCluster=await signedRead('/v7/cluster/state');
  safeCluster(firstCluster,ready.expected_epoch,agentIds);
  const me=await signedRead('/v7/nodes/me');
  if(me.node_id!==node.node_id||!Array.isArray(me.agents)||
     me.agents.length!==agentIds.length)
    fail('UPDATE_EXECUTION_NODE_NOT_READY');
  const seen=new Set();
  for(const a of me.agents){
    if(!a||!ID.test(a.agent_id||'')||seen.has(a.agent_id)||
       !agentIds.includes(a.agent_id)||a.state!=='APPROVED'||
       a.status!=='IDLE'||a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job))
      fail('UPDATE_EXECUTION_AGENT_NOT_DRAINED');
    seen.add(a.agent_id);
  }
  safeCluster(await signedRead('/v7/cluster/state'),ready.expected_epoch,agentIds);
  safeFence(await signedRead('/v7/nodes/maintenance'));
  if(Date.now()>=approved.expires_ms)
    fail('UPDATE_EXECUTION_GRANT_EXPIRED_DURING_CHECK');
  // Recheck local file state and signer immediately before creating a
  // permanent one-shot marker. This remains subject to OS-level TOCTOU and
  // ACL acceptance on a real Windows PC.
  checkPrepared({dir,node,agentIds,observedVersion});
  if(sha256File(stagedPath)!==ready.installer_sha256)
    fail('UPDATE_EXECUTION_STAGED_HASH_CHANGED');
  const attempt={schema:1,state:'EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED',
    node_id:node.node_id,plan_id:ready.plan_id,wave_id:ready.wave_id,
    offer_sha256:ready.offer_sha256,installer_sha256:ready.installer_sha256,
    grant_id:approved.grant_id,expected_epoch:ready.expected_epoch,
    target_version:ready.target_version,kind:ready.kind,
    identity_public_key_sha256:identity.public_key_sha256,
    attempted_at_ms:Date.now(),installer_launch_observed:false,
    installer_installation_verified:false,automatic_retry_allowed:false,
    rollback_automated:false};
  persistNew(attemptPath,signedRecord(attempt,node));
  // No --silent, no /S, no shell, no user-supplied arguments or URL.
  // Windows installer shows its own UAC/NSIS prompts to the local Owner.
  let child;
  try{
    child=runner(stagedPath,[],{cwd:path.dirname(stagedPath),
      shell:false,detached:true,windowsHide:false,stdio:'ignore'});
  }catch{fail('UPDATE_EXECUTION_SPAWN_UNCERTAIN_OWNER_REVIEW');}
  if(!child||typeof child.once!=='function'||typeof child.removeListener!=='function')
    fail('UPDATE_EXECUTION_SPAWN_UNCERTAIN_OWNER_REVIEW');
  await new Promise((resolve,reject)=>{
    let finished=false,timer;
    const cleanup=()=>{clearTimeout(timer);child.removeListener('spawn',onSpawn);
      child.removeListener('error',onError);};
    const done=(err)=>{if(finished)return;finished=true;cleanup();
      if(err)reject(err);else resolve();};
    const onSpawn=()=>done();
    const onError=()=>done(Error('UPDATE_EXECUTION_SPAWN_FAILED_OWNER_REVIEW'));
    child.once('spawn',onSpawn);child.once('error',onError);
    timer=setTimeout(()=>done(Error('UPDATE_EXECUTION_SPAWN_TIMEOUT_OWNER_REVIEW')),10000);
  });
  // A spawn event proves process creation only, not user acceptance, NSIS
  // completion, successful version change, nor preserved device identity.
  const observed={schema:1,state:'WINDOWS_INSTALLER_PROCESS_STARTED_UNVERIFIED',
    node_id:node.node_id,grant_id:approved.grant_id,
    installer_sha256:ready.installer_sha256,kind:ready.kind,
    target_version:ready.target_version,observed_at_ms:Date.now(),
    installer_installation_verified:false,
    identity_preservation_verified:false,central_reconciliation_verified:false,
    automatic_retry_allowed:false};
  persistNew(launchedPath,signedRecord(observed,node));
  child.unref?.();
  return Object.freeze({launched:true,installed:false,rollback_completed:false,
    node_id:node.node_id,target_version:ready.target_version,kind:ready.kind,
    grant_id:approved.grant_id,installation_result:'UNKNOWN_OWNER_REVIEW',
    local_hold_retained:true,agent_restart_allowed:false,
    post_install_identity_check_required:true,
    central_reconciliation_required:true});
}
module.exports={launchStagedInstaller,checkPrepared};
