/**
 * OWNER FAILURE RECOVERY REVIEW: one-shot evidence authorization, NO release.
 *
 * A failed or cancelled Windows setup may have spawned another elevated
 * process; its exit status is unknown. This contract never assumes installer
 * completion or permits automated retry, rollback, hold release or agent start.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyFailureReview}=require('./maintenance-failure-review-verifier.cjs');
const {verifyOwnerFailureReviewGrant}=require('./maintenance-failure-owner-grant.cjs');
const {checkRecovery}=require('./maintenance-recovery-preflight.cjs');
const {validOrigin}=require('./update-readiness.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const PREFIX='SUTRADHAR_FAILURE_EXCEPTION_REVIEW_V1\n';
function fail(code){throw Error(code);}
async function prepareFailedInstallRecoveryReview({
  dir,node,agentIds,observedVersion,installedExecutable,publisherSubject,
  centralOrigin,signer,grantEnvelope,pinnedOwnerPublicKeyPem,
  platform=process.platform,verifyPublisher,fetcher=fetch,now=Date.now()
}={}){
  if(platform!=='win32'||typeof dir!=='string'||!path.isAbsolute(dir)||
     !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
     agentIds.some(id=>!ID.test(id))||new Set(agentIds).size!==agentIds.length||
     !signer||typeof signer.sign!=='function'||
     !Number.isSafeInteger(now)||now<0)
    fail('FAILURE_EXCEPTION_WINDOWS_ENROLLED_PC_REQUIRED');
  const origin=validOrigin(centralOrigin);
  const outfile=path.join(dir,'installer-failure-exception-reviewed.json');
  if(fs.existsSync(outfile))
    fail('FAILURE_EXCEPTION_PREVIOUS_REVIEW_OWNER_INTERVENTION');
  const evidenceArgs={dir,node,agentIds,observedVersion,
    installedExecutable,publisherSubject,platform,
    ...(verifyPublisher?{verifyPublisher}:{})};
  const before=verifyFailureReview(evidenceArgs);
  const grant=verifyOwnerFailureReviewGrant({envelope:grantEnvelope,
    pinnedPublicKeyPem:pinnedOwnerPublicKeyPem,evidence:before,now});
  const first=await checkRecovery({dir,centralOrigin:origin,
    nodeId:node.node_id,signer,fetcher});
  if(first.cancellation_verified!==true||
     first.local_hold_still_active!==true||
     first.local_hold_release_allowed!==false)
    fail('FAILURE_EXCEPTION_OWNER_CANCELLATION_NOT_VERIFIED');
  async function read(uri){
    const headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!headers||headers['x-sutradhar-node']!==node.node_id||
       typeof headers['x-sutradhar-nonce']!=='string'||
       typeof headers['x-sutradhar-signature']!=='string')
      fail('FAILURE_EXCEPTION_SIGNED_NODE_REQUIRED');
    let res,data;
    try{res=await fetcher(origin+uri,{method:'GET',
      headers:{...headers,Accept:'application/json'},redirect:'error',
      signal:AbortSignal.timeout(12000)});}
    catch{fail('FAILURE_EXCEPTION_CENTRAL_UNREACHABLE');}
    if(!res?.ok)fail('FAILURE_EXCEPTION_CENTRAL_DENIED');
    try{data=await res.json();}catch{fail('FAILURE_EXCEPTION_CENTRAL_MALFORMED');}
    if(!data||typeof data!=='object'||Array.isArray(data))
      fail('FAILURE_EXCEPTION_CENTRAL_MALFORMED');
    return data;
  }
  function healthy(c){
    if(!Number.isSafeInteger(c?.epoch)||c.epoch<1||
       c.phase!=='READY'||c.paused!==false||
       !ID.test(c.master_agent_id||'')||
       !Array.isArray(c.backups)||c.backups.length!==2||
       c.backups.some(id=>!ID.test(id))||
       new Set([c.master_agent_id,...c.backups]).size!==3||
       agentIds.some(id=>[c.master_agent_id,...c.backups].includes(id)))
      fail('FAILURE_EXCEPTION_CLUSTER_UNHEALTHY');
    return JSON.stringify({epoch:c.epoch,master:c.master_agent_id,
      backups:c.backups});
  }
  const cluster=healthy(await read('/v7/cluster/state'));
  const me=await read('/v7/nodes/me');
  if(me.node_id!==node.node_id||!Array.isArray(me.agents)||
     me.agents.length!==agentIds.length)
    fail('FAILURE_EXCEPTION_NODE_AGENTS_MISMATCH');
  const found=new Set();
  for(const a of me.agents){
    if(!a||!ID.test(a.agent_id||'')||found.has(a.agent_id)||
       !agentIds.includes(a.agent_id)||a.state!=='APPROVED'||
       a.status!=='IDLE'||a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job))
      fail('FAILURE_EXCEPTION_AGENT_NOT_DRAINED');
    found.add(a.agent_id);
  }
  if(healthy(await read('/v7/cluster/state'))!==cluster)
    fail('FAILURE_EXCEPTION_CLUSTER_CHANGED');
  const last=await checkRecovery({dir,centralOrigin:origin,
    nodeId:node.node_id,signer,fetcher});
  if(last.cancellation_verified!==true)
    fail('FAILURE_EXCEPTION_CANCELLATION_CHANGED');
  if(Date.now()>=grant.expires_ms)
    fail('FAILURE_EXCEPTION_OWNER_GRANT_EXPIRED_DURING_CHECK');
  const after=verifyFailureReview(evidenceArgs);
  if(JSON.stringify(after)!==JSON.stringify(before))
    fail('FAILURE_EXCEPTION_DEVICE_EVIDENCE_CHANGED');
  if(fs.existsSync(outfile))
    fail('FAILURE_EXCEPTION_PREVIOUS_REVIEW_OWNER_INTERVENTION');
  const payload={schema:1,
    state:'OWNER_FAILURE_RECOVERY_REVIEWED_NO_RELEASE',
    node_id:node.node_id,plan_id:before.plan_id,wave_id:before.wave_id,
    offer_sha256:before.offer_sha256,
    installer_sha256:before.installer_sha256,
    execution_grant_id:before.execution_grant_id,
    review_sha256:before.review_sha256,owner_grant_id:grant.grant_id,
    previous_version:before.previous_version,
    target_version:before.target_version,
    kind:before.kind,observed_version:observedVersion,
    reviewed_central_epoch:JSON.parse(cluster).epoch,
    identity_public_key_sha256:crypto.createHash('sha256').update(
      crypto.createPublicKey(node.public_key_pem).export({type:'spki',format:'der'})
    ).digest('hex'),recorded_at_ms:Date.now(),
    cancelled_plan_verified:true,installer_exit_status_proven:false,
    installer_completion_proven:false,hold_release_allowed:false,
    agent_start_allowed:false,automatic_retry_allowed:false,
    automatic_rollback_allowed:false};
  const signed={...payload,signature_base64:crypto.sign(null,
    Buffer.from(PREFIX+JSON.stringify(payload)),
    crypto.createPrivateKey(node.private_key_pem)).toString('base64')};
  const fd=fs.openSync(outfile,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(signed,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return Object.freeze({reviewed:true,node_id:node.node_id,
    previous_version:observedVersion,owner_grant_id:grant.grant_id,
    cancellation_verified:true,hold_still_active:true,
    installer_completion_proven:false,installer_exit_status_proven:false,
    hold_release_allowed:false,agent_start_allowed:false,
    automatic_retry_allowed:false,automatic_rollback_allowed:false,
    next_action:'Owner must review live Windows installer processes and OS logs; this evidence grants no hold release, rollback or agent restart.'});
}
module.exports={prepareFailedInstallRecoveryReview};
