'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const cp=require('node:child_process');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {prepareInstaller}=require('../apps/desktop/maintenance-install-preparation.cjs');
const {verifyExecutionGrant}=require('../apps/desktop/maintenance-installer-execution-grant.cjs');
const {launchStagedInstaller}=require('../apps/desktop/maintenance-installer-execution.cjs');
const {observeFailedAttempt}=require('../apps/desktop/maintenance-failed-install-review.cjs');
const {verifyFailureReview}=require('../apps/desktop/maintenance-failure-review-verifier.cjs');
const {verifyOwnerFailureReviewGrant}=require('../apps/desktop/maintenance-failure-owner-grant.cjs');
const {prepareFailedInstallRecoveryReview}=
  require('../apps/desktop/maintenance-failure-owner-review.cjs');
const {releaseHold}=require('../apps/desktop/maintenance-release-executor.cjs');
const nodeId='node_'+'a'.repeat(32),agentId='agent_noncritical_1';
const offerKey=crypto.generateKeyPairSync('ed25519');
const execKey=crypto.generateKeyPairSync('ed25519');
const publicOffer=offerKey.publicKey.export({type:'spki',format:'pem'}).toString();
const publicExec=execKey.publicKey.export({type:'spki',format:'pem'}).toString();
const node={node_id:nodeId,agents:[{id:agentId}],
  public_key_pem:publicOffer,
  private_key_pem:offerKey.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
const grantId='f'.repeat(64);
const kind='update',planId='plan_pilot_123',waveId='wave_pilot01';
function envelope(body,key){
  return {signed:body,signature_base64:crypto.sign(null,
    Buffer.from(JSON.stringify(body)),key.privateKey).toString('base64')};
}
function fixtures(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-exec-'));
  try{return Promise.resolve(fn(dir)).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));}
  catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
function initial(dir,{rollback=false}={}){
  const nodeDir=path.join(dir,'node');fs.mkdirSync(nodeDir);
  const installer=path.join(dir,'SUTRADHAR Desktop.exe');
  const bytes=crypto.randomBytes(2200);fs.writeFileSync(installer,bytes);
  const now=Date.now();
  const body={schema:2,application:'desktop',channel:'stable',
    type:rollback?'rollback':'update',version:rollback?'6.9.0':'7.1.0',
    source_sha:'e'.repeat(40),protocol:7,
    filename:path.basename(installer),
    installer_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    installer_bytes:bytes.length,publisher_subject:'CN=SUTRADHAR Verified',
    issued_ms:now-2000,expires_ms:now+180000,
    rollout:{wave_id:waveId,node_ids:[nodeId],owner_approved_at_ms:now-2000}};
  if(rollback)body.owner_emergency_rollback_approved=true;
  const offer=envelope(body,offerKey);
  const offerHash=crypto.createHash('sha256').update(JSON.stringify(offer)).digest('hex');
  createHold({dir:nodeDir,nodeId,planId,waveId,offerSha256:offerHash});
  const intent={state:'DRAINED',fence_active:true,
    fence_release_requires_owner:true,plan_id:planId,
    wave_id:waveId,offer_sha256:offerHash,expected_epoch:11};
  const maintenance={node_id:nodeId,installer_execution_allowed:false,
    owner_maintenance_lease:false,intent};
  const cluster={epoch:11,phase:'READY',paused:false,
    master_agent_id:'agent_master_1',
    backups:['agent_backup_1','agent_backup_2']};
  const me={node_id:nodeId,agents:[{agent_id:agentId,
    state:'APPROVED',status:'IDLE',active_ticket:null,
    has_live_work_lease:0,has_unreconciled_git_job:0}]};
  const replies={maintenance,cluster,me,offline:false};
  const signer={sign:({kind,method,uri,body})=>{
    assert.equal(kind,'node_api');assert.equal(method,'GET');assert.equal(body,'');
    return {'x-sutradhar-node':nodeId,'x-sutradhar-nonce':'nonce',
      'x-sutradhar-signature':'signature'};
  }};
  const fetcher=async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(replies.offline)throw Error('offline');
    const p=new URL(url).pathname;
    const d=p==='/v7/nodes/maintenance'?replies.maintenance:
      p==='/v7/cluster/state'?replies.cluster:
      p==='/v7/nodes/me'?replies.me:null;
    if(!d)throw Error('unsupported path '+p);
    return new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}});
  };
  const authenticode=({expectedSha256,publisherSubject})=>({
    verified:true,file_sha256:expectedSha256,publisher_subject:publisherSubject,
    installer_execution_allowed:false});
  const prep={dir:nodeDir,installerPath:installer,envelope:offer,node,
    agentIds:[agentId],centralOrigin:'https://central.example.com',
    signer,currentVersion:'7.0.0',pinnedPublicKeyPem:publicOffer,
    publisherSubject:'CN=SUTRADHAR Verified',
    platform:'win32',authenticode,fetcher};
  const args={dir:nodeDir,node,agentIds:[agentId],
    observedVersion:'7.0.0',centralOrigin:prep.centralOrigin,
    signer,pinnedExecutionPublicKeyPem:publicExec,
    publisherSubject:prep.publisherSubject,
    platform:'win32',authenticode,fetcher};
  function grant(patch={}){
    const body={schema:1,action:'launch_staged_windows_installer',
      grant_id:grantId,node_id:nodeId,plan_id:planId,wave_id:waveId,
      offer_sha256:offerHash,installer_sha256:offer.signed.installer_sha256,
      kind:offer.signed.type,target_version:offer.signed.version,
      epoch:11,issued_ms:Date.now()-1000,expires_ms:Date.now()+100000,...patch};
    return envelope(body,execKey);
  }
  return {prep,args,replies,offer,grant,nodeDir,installer};
}
function launcherRecorder(){
  const launches=[];
  const runner=(file,args,options)=>{
    launches.push({file,args,options});
    const child=new EventEmitter();
    child.pid=34000+launches.length;
    child.unref=()=>{child.unrefCalled=true;};
    setImmediate(()=>child.emit('spawn'));
    return child;
  };
  return {runner,launches};
}

const publisher=({publisherSubject})=>({
  verified:true,publisher_subject:publisherSubject,
  exe_sha256:'9'.repeat(64),installation_success_proven:false
});
async function setupFailure(dir,{launched=true}={}){
  const f=initial(dir);await prepareInstaller(f.prep);
  if(launched){
    const {runner}=launcherRecorder();
    await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  }else{
    const runner=()=>{const c=new EventEmitter();c.pid=34101;
      setImmediate(()=>c.emit('error',Error('setup refused')));return c;};
    await assert.rejects(launchStagedInstaller({...f.args,
      grantEnvelope:f.grant(),runner}),/SPAWN_FAILED_OWNER_REVIEW/);
  }
  const exe=path.join(dir,'Installed SUTRADHAR.exe');
  fs.writeFileSync(exe,crypto.randomBytes(1400));
  return {f,args:{dir:f.nodeDir,node,agentIds:[agentId],
    observedVersion:'7.0.0',installedExecutable:exe,
    publisherSubject:'CN=SUTRADHAR Verified',
    centralOrigin:f.args.centralOrigin,signer:f.args.signer,
    platform:'win32',verifyPublisher:publisher,fetcher:f.args.fetcher}};
}

const ownerKey=crypto.generateKeyPairSync('ed25519');
const ownerPublicKey=ownerKey.publicKey.export({type:'spki',format:'pem'}).toString();
const cancel={node_id:nodeId,plan_id:planId,wave_id:waveId,
  state:'CANCELLED',cancellation_verified:true,
  any_active_fence:false,any_active_maintenance_intent:false,
  local_hold_release_allowed:false,installer_execution_allowed:false,
  recovery_requires_owner:true};
function signedGrant(evidence,patch={},now=Date.now()){
  const body={schema:1,action:'review_failed_install_recovery',
    node_id:evidence.node_id,plan_id:evidence.plan_id,wave_id:evidence.wave_id,
    offer_sha256:evidence.offer_sha256,
    installer_sha256:evidence.installer_sha256,
    execution_grant_id:evidence.execution_grant_id,
    review_sha256:evidence.review_sha256,
    previous_version:evidence.previous_version,
    target_version:evidence.target_version,kind:evidence.kind,
    expected_epoch:evidence.expected_epoch,
    grant_id:crypto.randomBytes(32).toString('hex'),
    issued_ms:now-1000,expires_ms:now+240000,...patch};
  return envelope(body,ownerKey);
}
async function preparedReview(dir,options={}){
  const {f,args}=await setupFailure(dir,options);
  await observeFailedAttempt(args);
  const evidence=verifyFailureReview(args);
  const result=structuredClone(cancel);
  result.offer_sha256=evidence.offer_sha256;
  const state={cancellation:result,offline:false};
  const fetcher=async(uri,opts)=>{
    if(state.offline)throw Error('Central unavailable');
    const p=new URL(uri).pathname;
    if(p==='/v7/nodes/maintenance/recovery/'+planId)
      return {ok:true,json:async()=>state.cancellation};
    return f.args.fetcher(uri,opts);
  };
  const context={...args,fetcher,pinnedOwnerPublicKeyPem:ownerPublicKey,
    grantEnvelope:signedGrant(evidence)};
  return {f,args,evidence,state,context};
}
test('Owner-signed review of unchanged old-version PC checks cancellation twice and retains maintenance hold',()=>fixtures(async dir=>{
  const {f,context,evidence}=await preparedReview(dir);
  const proof=verifyOwnerFailureReviewGrant({
    envelope:context.grantEnvelope,pinnedPublicKeyPem:ownerPublicKey,
    evidence});
  assert.equal(proof.accepted,true);
  assert.equal(proof.hold_release_allowed,false);
  const output=await prepareFailedInstallRecoveryReview(context);
  assert.equal(output.reviewed,true);
  assert.equal(output.cancellation_verified,true);
  assert.equal(output.hold_still_active,true);
  assert.equal(output.installer_completion_proven,false);
  assert.equal(output.hold_release_allowed,false);
  assert.equal(output.automatic_rollback_allowed,false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
  const record=JSON.parse(fs.readFileSync(path.join(f.nodeDir,
    'installer-failure-exception-reviewed.json'),'utf8'));
  assert.equal(record.state,'OWNER_FAILURE_RECOVERY_REVIEWED_NO_RELEASE');
  assert.equal(record.review_sha256,evidence.review_sha256);
  assert.equal(record.hold_release_allowed,false);
  assert.ok(record.signature_base64.length>80);
  await assert.rejects(prepareFailedInstallRecoveryReview(context),
    /PREVIOUS_REVIEW_OWNER_INTERVENTION/);
}));
test('grant cross-scope, expiry, spoofed owner signature and wrong trust fail without writing review',()=>fixtures(async dir=>{
  const {f,context,evidence}=await preparedReview(dir);
  for(const patch of [
    {action:'release_maintenance_hold'},
    {node_id:'node_'+'e'.repeat(32)},
    {plan_id:'plan_other'},
    {wave_id:'wave_other'},
    {installer_sha256:'a'.repeat(64)},
    {offer_sha256:'a'.repeat(64)},
    {review_sha256:'c'.repeat(64)},
    {execution_grant_id:'e'.repeat(64)},
    {kind:'rollback'}, {previous_version:'6.0.0'},
    {target_version:'8.0.0'}, {expected_epoch:21},
    {expires_ms:Date.now()-1}
  ]){
    await assert.rejects(prepareFailedInstallRecoveryReview({...context,
      grantEnvelope:signedGrant(evidence,patch)}));
  }
  const forged=signedGrant(evidence);forged.signature_base64='AAAA';
  await assert.rejects(prepareFailedInstallRecoveryReview({...context,
    grantEnvelope:forged}),/SIGNATURE_INVALID/);
  await assert.rejects(prepareFailedInstallRecoveryReview({...context,
    pinnedOwnerPublicKeyPem:null}),/TRUST_UNCONFIGURED/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,
    'installer-failure-exception-reviewed.json')),false);
}));
test('offline, active fence, withdrawn cancellation, unsafe cluster or live lease fail closed',()=>fixtures(async dir=>{
  const {f,context,state}=await preparedReview(dir);
  const first=state.cancellation;
  for(const change of [
    {...first,cancellation_verified:false},
    {...first,any_active_fence:true},
    {...first,any_active_maintenance_intent:true},
    {...first,node_id:'node_'+'e'.repeat(32)}
  ]){
    state.cancellation=change;
    await assert.rejects(prepareFailedInstallRecoveryReview(context));
  }
  state.cancellation=first;
  state.offline=true;
  await assert.rejects(prepareFailedInstallRecoveryReview(context));
  state.offline=false;
  const oldCluster=f.replies.cluster;
  f.replies.cluster={...oldCluster,phase:'RECOVERING'};
  await assert.rejects(prepareFailedInstallRecoveryReview(context));
  f.replies.cluster=oldCluster;
  const oldMe=f.replies.me;
  f.replies.me={...oldMe,agents:[{...oldMe.agents[0],
    has_live_work_lease:1}]};
  await assert.rejects(prepareFailedInstallRecoveryReview(context));
  f.replies.me=oldMe;
  assert.equal(fs.existsSync(path.join(f.nodeDir,
    'installer-failure-exception-reviewed.json')),false);
}));
test('forged device review or changed installed publisher blocks Owner review',()=>fixtures(async dir=>{
  const {f,context}=await preparedReview(dir);
  const recordFile=path.join(f.nodeDir,'installer-failure-review-observed.json');
  const original=fs.readFileSync(recordFile,'utf8');
  const modified=JSON.parse(original);
  modified.state='LAUNCH_UNCONFIRMED_OLD_VERSION';
  fs.writeFileSync(recordFile,JSON.stringify(modified));
  await assert.rejects(prepareFailedInstallRecoveryReview(context),
    /DEVICE_SIGNATURE_INVALID/);
  fs.writeFileSync(recordFile,original);
  await assert.rejects(prepareFailedInstallRecoveryReview({...context,
    verifyPublisher:()=>({
      ...publisher({publisherSubject:context.publisherSubject}),
      exe_sha256:'b'.repeat(64)})}),/INSTALLED_EXE_CHANGED/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,
    'installer-failure-exception-reviewed.json')),false);
}));
test('same request cannot be reused after release-review record exists, even with a new grant',()=>fixtures(async dir=>{
  const {f,context,evidence}=await preparedReview(dir,{launched:false});
  const result=await prepareFailedInstallRecoveryReview(context);
  assert.equal(result.reviewed,true);
  await assert.rejects(prepareFailedInstallRecoveryReview({...context,
    grantEnvelope:signedGrant(evidence)}),/PREVIOUS_REVIEW_OWNER_INTERVENTION/);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));

test('offline Owner signer verifies all three device-signed receipts before granting a one-PC review',()=>fixtures(async dir=>{
  const {f,evidence}=await preparedReview(dir);
  const privateFile=path.join(dir,'owner-review-private.pem');
  const devicePublicFile=path.join(dir,'device-public.pem');
  const output=path.join(dir,'owner-grant.json');
  fs.writeFileSync(privateFile,ownerKey.privateKey.export({
    type:'pkcs8',format:'pem'}).toString());
  fs.writeFileSync(devicePublicFile,node.public_key_pem);
  const env={...process.env,
    SUTRADHAR_OWNER_FAILURE_RECOVERY_REVIEW_APPROVED:'yes',
    SUTRADHAR_FAILURE_DIAGNOSTIC_JSON:path.join(f.nodeDir,
      'installer-failure-review-observed.json'),
    SUTRADHAR_FAILURE_PREPARED_JSON:path.join(f.nodeDir,
      'installer-preparation-ready.json'),
    SUTRADHAR_FAILURE_EXECUTION_ATTEMPT_JSON:path.join(f.nodeDir,
      'installer-execution-attempt.json'),
    SUTRADHAR_FAILURE_DEVICE_PUBLIC_KEY_FILE:devicePublicFile,
    SUTRADHAR_FAILURE_OWNER_SIGNING_KEY_FILE:privateFile,
    SUTRADHAR_FAILURE_OWNER_GRANT_OUTPUT:output};
  const script=path.resolve(__dirname,
    '../scripts/release/sign-failed-install-owner-review.cjs');
  const run=e=>cp.spawnSync(process.execPath,[script],
    {encoding:'utf8',env:e,timeout:10000});
  let result=run(env);
  assert.equal(result.status,0,result.stderr);
  const grant=JSON.parse(fs.readFileSync(output));
  assert.equal(grant.signed.review_sha256,evidence.review_sha256);
  assert.equal(grant.signed.node_id,nodeId);
  assert.equal(grant.signed.expires_ms-grant.signed.issued_ms,300000);
  assert.equal(verifyOwnerFailureReviewGrant({envelope:grant,
    pinnedPublicKeyPem:ownerPublicKey,evidence}).accepted,true);
  assert.equal(run(env).status!==0,true,'never overwrite signed grant');
  fs.unlinkSync(output);
  const corrupted=JSON.parse(fs.readFileSync(env.SUTRADHAR_FAILURE_DIAGNOSTIC_JSON));
  corrupted.installer_outcome_known=true;
  fs.writeFileSync(env.SUTRADHAR_FAILURE_DIAGNOSTIC_JSON,JSON.stringify(corrupted));
  result=run(env);
  assert.notEqual(result.status,0);
  assert.equal(fs.existsSync(output),false);
  result=run({...env,SUTRADHAR_OWNER_FAILURE_RECOVERY_REVIEW_APPROVED:'no'});
  assert.notEqual(result.status,0);
}));

test('standard success-path hold release refuses ANY failed-install diagnostic, even after Owner review',()=>fixtures(async dir=>{
  const {f,context}=await preparedReview(dir);
  const args={dir:f.nodeDir,nodeId,agentStopped:true};
  await assert.rejects(releaseHold(args),
    /FAILED_INSTALL_REQUIRES_DISTINCT_OWNER_RESOLUTION/);
  await prepareFailedInstallRecoveryReview(context);
  await assert.rejects(releaseHold(args),
    /FAILED_INSTALL_REQUIRES_DISTINCT_OWNER_RESOLUTION/);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));
