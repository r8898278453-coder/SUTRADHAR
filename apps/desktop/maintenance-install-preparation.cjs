/**
 * Fail-closed, non-executing offline installer/rollback escrow preparation.
 * A durable local DRAINED hold and matching signed Central fence are required.
 * This never runs an EXE, changes installation, restores vault or releases hold.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {validOrigin}=require('./update-readiness.cjs');
const {verifyOffer,sha256File}=require('./update-policy.cjs');
const {verifyWindowsPublisher}=require('./windows-authenticode.cjs');
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const HEX=/^[0-9a-f]{64}$/;
function fail(code){throw Error(code);}
function hash(x){return crypto.createHash('sha256').update(x).digest('hex');}
const SIGNING_PREFIX='SUTRADHAR_INSTALLER_ESCROW_V1';
function signLocalRecord(record,node){
  const key=crypto.createPrivateKey(node.private_key_pem);
  const signature_base64=crypto.sign(null,
    Buffer.from(SIGNING_PREFIX+'\\n'+JSON.stringify(record)),key).toString('base64');
  return {...record,signature_base64};
}
function verifyLocalRecord(record,node){
  if(!record||typeof record!=='object'||Array.isArray(record)||
     typeof record.signature_base64!=='string'||
     record.signature_base64.length>256)
    fail('UPDATE_PREPARE_RECORD_SIGNATURE_REQUIRED');
  const {signature_base64,...payload}=record;
  let verified=false;
  try{
    verified=crypto.verify(null,
      Buffer.from(SIGNING_PREFIX+'\\n'+JSON.stringify(payload)),
      crypto.createPublicKey(node.public_key_pem),
      Buffer.from(signature_base64,'base64'));
  }catch{}
  if(!verified)fail('UPDATE_PREPARE_RECORD_SIGNATURE_INVALID');
  return payload;
}

function identityEvidence(node,agentIds){
  if(!node||!NODE.test(node.node_id||'')||
     typeof node.public_key_pem!=='string'||!Array.isArray(node.agents)||
     node.agents.length!==agentIds.length||node.agents.some(a=>!ID.test(a?.id||''))||
     new Set(node.agents.map(a=>a.id)).size!==agentIds.length||
     agentIds.some(id=>!node.agents.some(a=>a.id===id)))
    fail('UPDATE_PREPARE_IDENTITY_MISMATCH');
  let key,privateKey;
  try{
    key=crypto.createPublicKey(node.public_key_pem);
    privateKey=crypto.createPrivateKey(node.private_key_pem);
  }catch{fail('UPDATE_PREPARE_OS_VAULT_KEY_INVALID');}
  if(key.asymmetricKeyType!=='ed25519'||privateKey.asymmetricKeyType!=='ed25519'||
     !key.export({type:'spki',format:'der'}).equals(
       crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})))
    fail('UPDATE_PREPARE_OS_VAULT_KEYPAIR_MISMATCH');
  return {node_id:node.node_id,
    public_key_sha256:hash(key.export({type:'spki',format:'der'})),
    agent_ids:[...agentIds].sort()};
}
async function prepareInstaller({dir,installerPath,envelope,node,agentIds,
  centralOrigin,signer,currentVersion,pinnedPublicKeyPem,publisherSubject,
  platform=process.platform,authenticode=verifyWindowsPublisher,
  fetcher=fetch,now=Date.now()}={}){
  if(platform!=='win32'||typeof dir!=='string'||!path.isAbsolute(dir)||
     !Array.isArray(agentIds)||agentIds.length<1||agentIds.length>4||
     agentIds.some(id=>!ID.test(id))||new Set(agentIds).size!==agentIds.length||
     !Number.isSafeInteger(now)||now<0||
     !signer||typeof signer.sign!=='function')
    fail('UPDATE_PREPARE_WINDOWS_DEVICE_REQUIRED');
  const origin=validOrigin(centralOrigin);
  const identity=identityEvidence(node,agentIds);
  const held=inspectHold({dir,nodeId:identity.node_id});
  if(!held.active||requiresReconciliation(dir))
    fail('UPDATE_PREPARE_EXCLUSIVE_DRAIN_HOLD_REQUIRED');
  const offered=hash(JSON.stringify(envelope));
  if(held.offer_sha256!==offered||
     envelope?.signed?.rollout?.wave_id!==held.wave_id)
    fail('UPDATE_PREPARE_HELD_OFFER_MISMATCH');
  const kind=envelope?.signed?.type;
  if(kind!=='update'&&kind!=='rollback')
    fail('UPDATE_PREPARE_OFFER_TYPE_INVALID');
  const verified=verifyOffer({envelope,pinnedPublicKeyPem,
    installerPath,currentVersion,nodeId:identity.node_id,protocol:7,
    publisherSubject,now,rolloutApproved:true,kind});
  if(!verified.accepted)fail('UPDATE_PREPARE_OFFER_'+verified.error_code);
  const stat=fs.lstatSync(installerPath);
  if(!stat.isFile()||stat.isSymbolicLink())
    fail('UPDATE_PREPARE_INSTALLER_INVALID');
  const approved=authenticode({installerPath,publisherSubject,
    expectedSha256:verified.file_sha256,platform});
  if(approved?.verified!==true||
     approved.file_sha256!==verified.file_sha256||
     approved.publisher_subject!==publisherSubject||
     approved.installer_execution_allowed!==false)
    fail('UPDATE_PREPARE_AUTHENTICODE_REQUIRED');
  const attemptFile=path.join(dir,'installer-preparation-attempt.json');
  const readyFile=path.join(dir,'installer-preparation-ready.json');
  if(fs.existsSync(attemptFile)||fs.existsSync(readyFile))
    fail('UPDATE_PREPARE_PREVIOUS_ATTEMPT_OWNER_REVIEW');
  async function signedRead(uri){
    const h=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!h||h['x-sutradhar-node']!==identity.node_id||
       typeof h['x-sutradhar-nonce']!=='string'||
       typeof h['x-sutradhar-signature']!=='string')
      fail('UPDATE_PREPARE_SIGNED_CENTRAL_REQUIRED');
    let res,data;
    try{res=await fetcher(origin+uri,{method:'GET',
      headers:{...h,Accept:'application/json'},redirect:'error',
      signal:AbortSignal.timeout(12000)});}
    catch{fail('UPDATE_PREPARE_CENTRAL_UNREACHABLE');}
    if(!res?.ok)fail('UPDATE_PREPARE_CENTRAL_DENIED');
    try{data=await res.json();}catch{fail('UPDATE_PREPARE_CENTRAL_RESPONSE_INVALID');}
    if(!data||typeof data!=='object'||Array.isArray(data))
      fail('UPDATE_PREPARE_CENTRAL_RESPONSE_INVALID');
    return data;
  }
  function verifyFence(data){
    const i=data?.intent;
    if(data?.node_id!==identity.node_id||
       data.installer_execution_allowed!==false||
       data.owner_maintenance_lease!==false||
       i?.state!=='DRAINED'||i.fence_active!==true||
       i.fence_release_requires_owner!==true||
       i.plan_id!==held.plan_id||i.wave_id!==held.wave_id||
       i.offer_sha256!==held.offer_sha256||
       !Number.isSafeInteger(i.expected_epoch)||i.expected_epoch<1)
      fail('UPDATE_PREPARE_OWNER_DRAIN_UNVERIFIED');
    return i.expected_epoch;
  }
  const epoch=verifyFence(await signedRead('/v7/nodes/maintenance'));
  const cluster=await signedRead('/v7/cluster/state');
  if(cluster.epoch!==epoch||cluster.phase!=='READY'||
     cluster.paused!==false||!ID.test(cluster.master_agent_id||'')||
     !Array.isArray(cluster.backups)||cluster.backups.length!==2||
     cluster.backups.some(x=>!ID.test(x))||
     new Set([cluster.master_agent_id,...cluster.backups]).size!==3||
     agentIds.some(x=>[cluster.master_agent_id,...cluster.backups].includes(x)))
    fail('UPDATE_PREPARE_CLUSTER_UNHEALTHY');
  const me=await signedRead('/v7/nodes/me');
  if(me.node_id!==identity.node_id||!Array.isArray(me.agents)||
     me.agents.length!==agentIds.length)
    fail('UPDATE_PREPARE_NODE_AGENTS_INVALID');
  const seen=new Set();
  for(const a of me.agents){
    if(!ID.test(a?.agent_id||'')||seen.has(a.agent_id)||
       !agentIds.includes(a.agent_id)||a.state!=='APPROVED'||
       a.status!=='IDLE'||a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job))
      fail('UPDATE_PREPARE_AGENT_WORK_NOT_DRAINED');
    seen.add(a.agent_id);
  }
  const finalEpoch=verifyFence(await signedRead('/v7/nodes/maintenance'));
  if(finalEpoch!==epoch)fail('UPDATE_PREPARE_EPOCH_CHANGED');
  const currentHold=inspectHold({dir,nodeId:identity.node_id});
  if(!currentHold.active||currentHold.plan_id!==held.plan_id||
     currentHold.wave_id!==held.wave_id||
     currentHold.offer_sha256!==held.offer_sha256||
     requiresReconciliation(dir))
    fail('UPDATE_PREPARE_LOCAL_HOLD_CHANGED');
  if(Date.now()>=envelope.signed.expires_ms)
    fail('UPDATE_PREPARE_OFFER_EXPIRED_DURING_CHECK');
  const escrow=path.join(dir,'installer-escrow');
  if(fs.existsSync(escrow)){
    const st=fs.lstatSync(escrow);
    if(!st.isDirectory()||st.isSymbolicLink()||
       fs.readdirSync(escrow).length)
      fail('UPDATE_PREPARE_ESCROW_NOT_EMPTY_OWNER_REVIEW');
  }else fs.mkdirSync(escrow,{mode:0o700});
  const stagedPath=path.join(escrow,envelope.signed.filename);
  const receipt={schema:1,status:'PREPARATION_ATTEMPT_OWNER_REVIEW',
    node_id:identity.node_id,plan_id:held.plan_id,wave_id:held.wave_id,
    offer_sha256:offered,installer_sha256:verified.file_sha256,
    kind,target_version:verified.version,previous_version:currentVersion,
    expected_epoch:epoch,
    identity_public_key_sha256:identity.public_key_sha256,
    agent_ids:identity.agent_ids,
    installer_filename:envelope.signed.filename,
    started_at_ms:Date.now(),installer_executed:false,
    installer_execution_allowed:false,rollback_automated:false};
  // Commit a one-shot attempt before copying any EXE. Interrupted attempts
  // are never deleted/retried automatically.
  const fd=fs.openSync(attemptFile,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(signLocalRecord(receipt,node),null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.copyFileSync(installerPath,stagedPath,fs.constants.COPYFILE_EXCL);
  if(sha256File(stagedPath)!==verified.file_sha256||
     sha256File(installerPath)!==verified.file_sha256)
    fail('UPDATE_PREPARE_STAGED_HASH_CHANGED_OWNER_REVIEW');
  const ready={...receipt,status:'OFFLINE_STAGED_NOT_INSTALLED',
    staged_at_ms:Date.now(),staged_sha256:verified.file_sha256};
  const readyFd=fs.openSync(readyFile,'wx',0o600);
  try{fs.writeFileSync(readyFd,JSON.stringify(signLocalRecord(ready,node),null,2)+'\n');
    fs.fsyncSync(readyFd);}finally{fs.closeSync(readyFd);}
  return Object.freeze({prepared:true,node_id:identity.node_id,
    plan_id:held.plan_id,wave_id:held.wave_id,kind,
    target_version:verified.version,identity_fingerprint_recorded:true,
    installer_hash_verified:true,installer_staged:true,
    installer_executed:false,installer_execution_allowed:false,
    automatic_rollback_allowed:false,
    next_action:'Owner must review staged evidence; no Windows installation or rollback has run.'});
}
/**
 * Read-only identity continuity check after any Owner-supervised installation.
 * Does not assume an installer ran merely because app.getVersion() matches.
 * Never imports, overwrites, exports, or resets the OS-vault private key.
 */
function inspectPreparedIdentity({dir,node,agentIds,observedVersion}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||
     !Array.isArray(agentIds)||agentIds.length<1||
     !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(observedVersion||''))
    fail('UPDATE_IDENTITY_POSTCHECK_ARGUMENTS_INVALID');
  const identity=identityEvidence(node,agentIds);
  function read(file){
    let st,p;
    try{
      st=fs.lstatSync(path.join(dir,file));
      if(!st.isFile()||st.isSymbolicLink()||st.size<200||st.size>8192)
        fail('UPDATE_IDENTITY_POSTCHECK_RECEIPT_INVALID');
      p=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    }catch{fail('UPDATE_IDENTITY_POSTCHECK_RECEIPT_CORRUPT');}
    return p;
  }
  const attempt=verifyLocalRecord(read('installer-preparation-attempt.json'),node);
  const ready=verifyLocalRecord(read('installer-preparation-ready.json'),node);
  if(attempt.schema!==1||ready.schema!==1||
     attempt.status!=='PREPARATION_ATTEMPT_OWNER_REVIEW'||
     ready.status!=='OFFLINE_STAGED_NOT_INSTALLED'||
     attempt.node_id!==identity.node_id||
     ready.node_id!==identity.node_id||
     attempt.identity_public_key_sha256!==identity.public_key_sha256||
     ready.identity_public_key_sha256!==identity.public_key_sha256||
     JSON.stringify(attempt.agent_ids)!==JSON.stringify(identity.agent_ids)||
     JSON.stringify(ready.agent_ids)!==JSON.stringify(identity.agent_ids)||
     attempt.offer_sha256!==ready.offer_sha256||
     attempt.installer_sha256!==ready.installer_sha256||
     attempt.target_version!==ready.target_version||
     attempt.kind!==ready.kind||
     attempt.plan_id!==ready.plan_id||attempt.wave_id!==ready.wave_id||
     attempt.installer_executed!==false||ready.installer_executed!==false||
     attempt.installer_execution_allowed!==false||
     ready.installer_execution_allowed!==false||
     !HEX.test(ready.installer_sha256||''))
    fail('UPDATE_IDENTITY_POSTCHECK_MISMATCH_OWNER_REVIEW');
  return Object.freeze({node_id:identity.node_id,
    identity_preserved:true,
    public_key_fingerprint_matched:true,agent_id_set_matched:true,
    observed_version:observedVersion,target_version:ready.target_version,
    version_matches_target:observedVersion===ready.target_version,
    installer_executed_proven:false,
    central_reconciliation_proven:false,
    automatic_rollback_allowed:false});
}

module.exports={prepareInstaller,identityEvidence,inspectPreparedIdentity};
