'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {prepareInstaller}=require('../apps/desktop/maintenance-install-preparation.cjs');
const {verifyExecutionGrant}=require('../apps/desktop/maintenance-installer-execution-grant.cjs');
const {launchStagedInstaller}=require('../apps/desktop/maintenance-installer-execution.cjs');
const {observeFailedAttempt}=require('../apps/desktop/maintenance-failed-install-review.cjs');
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
    child.pid=31000+launches.length;
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
    const runner=()=>{const c=new EventEmitter();c.pid=31401;
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
test('old version with signed spawn is classified as uncertain and never unlocks hold',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir);
  const result=await observeFailedAttempt(args);
  assert.equal(result.recorded,true);
  assert.equal(result.state,'LAUNCH_OBSERVED_OLD_VERSION');
  assert.equal(result.installer_outcome_known,false);
  assert.equal(result.hold_release_allowed,false);
  assert.equal(result.automatic_retry_allowed,false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
  const payload=JSON.parse(fs.readFileSync(path.join(f.nodeDir,
    'installer-failure-review-observed.json'),'utf8'));
  assert.ok(payload.signature_base64.length>80);
  assert.equal(payload.installer_exit_code_known,false);
  assert.equal(payload.automatic_rollback_allowed,false);
  await assert.rejects(observeFailedAttempt(args),/ALREADY_RECORDED/);
}));
test('unconfirmed installer spawn never becomes successful installation',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir,{launched:false});
  const result=await observeFailedAttempt(args);
  assert.equal(result.state,'LAUNCH_UNCONFIRMED_OLD_VERSION');
  assert.equal(result.installer_outcome_known,false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));
test('target-version observation is not misclassified as failed update',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir);
  await assert.rejects(observeFailedAttempt({...args,observedVersion:'7.1.0'}),
    /EVIDENCE_MISMATCH/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-failure-review-observed.json')),false);
}));
test('tampered signed installer-attempt journal blocks diagnosis',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir);
  const file=path.join(f.nodeDir,'installer-execution-attempt.json');
  const record=JSON.parse(fs.readFileSync(file,'utf8'));
  record.kind='rollback';fs.writeFileSync(file,JSON.stringify(record));
  await assert.rejects(observeFailedAttempt(args),/DEVICE_SIGNATURE_INVALID/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-failure-review-observed.json')),false);
}));
test('offline Central, withdrawn fence, changed Master epoch and live lease block record',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir);
  const original={maintenance:f.replies.maintenance,cluster:f.replies.cluster,
    me:f.replies.me};
  const cases=[
    {offline:true},
    {maintenance:{...original.maintenance,intent:{...original.maintenance.intent,
      fence_active:false}}},
    {cluster:{...original.cluster,epoch:13}},
    {cluster:{...original.cluster,master_agent_id:agentId}},
    {me:{...original.me,agents:[{...original.me.agents[0],has_live_work_lease:1}]}}
  ];
  for(const failure of cases){
    Object.assign(f.replies,{...original,offline:false,...failure});
    await assert.rejects(observeFailedAttempt(args));
    assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-failure-review-observed.json')),false);
  }
}));
test('publisher mismatch, changing installed EXE and unrelated node are rejected',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir);
  await assert.rejects(observeFailedAttempt({...args,verifyPublisher:()=>({
    ...publisher({publisherSubject:args.publisherSubject}),
    publisher_subject:'CN=Untrusted'})}),/PUBLISHER_INVALID/);
  let calls=0;
  await assert.rejects(observeFailedAttempt({...args,verifyPublisher:()=>{
    const p=publisher({publisherSubject:args.publisherSubject});
    return {...p,exe_sha256:(++calls===1?'a':'b').repeat(64)};
  }}),/EXE_CHANGED/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-failure-review-observed.json')),false);
}));

test('oversized Central evidence cannot certify a failed installation or release a hold',()=>fixtures(async dir=>{
  const {f,args}=await setupFailure(dir);
  const huge=async()=>new Response(JSON.stringify({padding:'X'.repeat(70000)}),{
    headers:{'content-type':'application/json'}});
  await assert.rejects(observeFailedAttempt({...args,fetcher:huge}),
    /INSTALL_FAILURE_REVIEW_CENTRAL_TOO_LARGE/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-failure-review-observed.json')),false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));

test('dangling postinstall and launch evidence cannot be misclassified as failed-install success',()=>fixtures(async dir=>{
  if(process.platform==='win32')return;
  const {f,args}=await setupFailure(dir);
  const post=path.join(f.nodeDir,'installer-postinstall-observed.json');
  fs.symlinkSync(path.join(f.nodeDir,'missing-postinstall'),post);
  await assert.rejects(observeFailedAttempt(args),
    /POSTINSTALL_SUCCESS_PATH_ALREADY_RECORDED/);
  fs.unlinkSync(post);
  const launch=path.join(f.nodeDir,'installer-execution-launch-observed.json');
  fs.unlinkSync(launch);
  fs.symlinkSync(path.join(f.nodeDir,'missing-launch'),launch);
  await assert.rejects(observeFailedAttempt(args),
    /POSTINSTALL_RECEIPT_MISSING_OR_CORRUPT/);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));
