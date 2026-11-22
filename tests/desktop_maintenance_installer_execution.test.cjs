'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {prepareInstaller}=require('../apps/desktop/maintenance-install-preparation.cjs');
const {verifyExecutionGrant}=require('../apps/desktop/maintenance-installer-execution-grant.cjs');
const {launchStagedInstaller}=require('../apps/desktop/maintenance-installer-execution.cjs');
const {inspectDirectExit,inspectDirectExitFromJournals}=require('../apps/desktop/maintenance-installer-direct-exit.cjs');
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
    child.pid=28050+launches.length;
    launches[launches.length-1].child=child;
    child.unref=()=>{child.unrefCalled=true;};
    setImmediate(()=>child.emit('spawn'));
    return child;
  };
  return {runner,launches};
}
test('distinct exact Owner grant launches ONLY a visible interactive staged EXE once',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const result=await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  assert.equal(result.launched,true);assert.equal(result.installed,false);
  assert.equal(result.rollback_completed,false);
  assert.equal(result.installation_result,'UNKNOWN_OWNER_REVIEW');
  assert.equal(launches.length,1);
  assert.equal(inspectDirectExit({dir:f.nodeDir,node,scope:{
    node_id:nodeId,plan_id:planId,wave_id:waveId,
    offer_sha256:crypto.createHash('sha256').update(JSON.stringify(f.offer)).digest('hex'),
    installer_sha256:f.offer.signed.installer_sha256,
    grant_id:grantId,target_version:f.offer.signed.version,kind:f.offer.signed.type
  }}).observed,false);
  assert.equal(launches[0].file,path.join(f.nodeDir,'installer-escrow','SUTRADHAR Desktop.exe'));
  assert.deepEqual(launches[0].args,[]);
  assert.equal(launches[0].options.shell,false);
  assert.equal(launches[0].options.windowsHide,false);
  const attempt=JSON.parse(fs.readFileSync(path.join(f.nodeDir,'installer-execution-attempt.json')));
  const observed=JSON.parse(fs.readFileSync(path.join(f.nodeDir,'installer-execution-launch-observed.json')));
  assert.equal(attempt.installer_installation_verified,false);
  assert.equal(observed.installer_installation_verified,false);
  assert.ok(attempt.signature_base64.length>70);
  assert.ok(observed.signature_base64.length>70);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
  await assert.rejects(launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner}),
    /ATTEMPT_ALREADY_EXISTS/);
  assert.equal(launches.length,1);
}));
test('release offer cannot double as installer execution grant and altered scope is denied',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const prepared=JSON.parse(fs.readFileSync(path.join(f.nodeDir,'installer-preparation-ready.json')));
  assert.equal(verifyExecutionGrant({envelope:f.grant(),pinnedPublicKeyPem:publicExec,prepared}).accepted,true);
  for(const patch of [
    {action:'release_maintenance_hold'},{node_id:'node_'+'c'.repeat(32)},
    {plan_id:'plan_wrong'},{wave_id:'wave_wrong'},
    {installer_sha256:'c'.repeat(64)},{offer_sha256:'d'.repeat(64)},
    {kind:'rollback'},{target_version:'6.8.0'},{epoch:12},
    {expires_ms:Date.now()-2000}
  ])assert.throws(()=>verifyExecutionGrant({envelope:f.grant(patch),
    pinnedPublicKeyPem:publicExec,prepared}));
  assert.throws(()=>verifyExecutionGrant({envelope:f.grant(),
    pinnedPublicKeyPem:null,prepared}),/OWNER_TRUST_UNCONFIGURED/);
  const other=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  assert.throws(()=>verifyExecutionGrant({envelope:f.grant(),
    pinnedPublicKeyPem:other,prepared}),/SIGNATURE_INVALID/);
}));
test('staged EXE mutation, Central fence withdrawal, cluster flip, busy work and offline reject before spawn',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const attempt=path.join(f.nodeDir,'installer-execution-attempt.json');
  const cases=[
    ()=>(f.replies.maintenance={...f.replies.maintenance,
      intent:{...f.replies.maintenance.intent,fence_active:false}}),
    ()=>(f.replies.cluster={...f.replies.cluster,epoch:12}),
    ()=>(f.replies.cluster={...f.replies.cluster,master_agent_id:agentId}),
    ()=>(f.replies.me={...f.replies.me,agents:[{
      ...f.replies.me.agents[0],has_live_work_lease:1}]}),
    ()=>(f.replies.offline=true)
  ];
  const original={maintenance:f.replies.maintenance,
    cluster:f.replies.cluster,me:f.replies.me};
  for(const change of cases){
    change();
    await assert.rejects(launchStagedInstaller({...f.args,
      grantEnvelope:f.grant(),runner}));
    assert.equal(fs.existsSync(attempt),false);
    Object.assign(f.replies,{...original,offline:false});
  }
  const file=path.join(f.nodeDir,'installer-escrow','SUTRADHAR Desktop.exe');
  fs.appendFileSync(file,'modified');
  await assert.rejects(launchStagedInstaller({...f.args,
    grantEnvelope:f.grant(),runner}),/STAGED_BINARY_TAMPERED/);
  assert.equal(launches.length,0);
}));
test('previous partial attempt prevents any retry, including rollback attempt',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  fs.writeFileSync(path.join(f.nodeDir,'installer-execution-attempt.json'),'partial');
  const {runner,launches}=launcherRecorder();
  await assert.rejects(launchStagedInstaller({...f.args,
    grantEnvelope:f.grant(),runner}),/ATTEMPT_ALREADY_EXISTS/);
  assert.equal(launches.length,0);
}));
test('spawn failure persists signed attempt; no launch or install success inferred',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const runner=()=>{const c=new EventEmitter();c.pid=31801;setImmediate(()=>c.emit('error',Error('denied')));return c;};
  await assert.rejects(launchStagedInstaller({...f.args,
    grantEnvelope:f.grant(),runner}),/SPAWN_FAILED_OWNER_REVIEW/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-execution-attempt.json')),true);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-execution-launch-observed.json')),false);
}));
test('emergency rollback launch also requires separate original signed rollback offer',()=>fixtures(async dir=>{
  const f=initial(dir,{rollback:true});await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const result=await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  assert.equal(result.kind,'rollback');
  assert.equal(result.rollback_completed,false);
  assert.equal(launches.length,1);
}));

test('expired original signed offer cannot be revived by a new execution grant',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const afterOfferExpiry=f.offer.signed.expires_ms+1;
  await assert.rejects(launchStagedInstaller({...f.args,
    grantEnvelope:f.grant(),runner,now:afterOfferExpiry}),/PREPARATION_NOT_READY/);
  assert.equal(launches.length,0);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-execution-attempt.json')),false);
}));

test('launcher signs DIRECT child exit after spawn without claiming NSIS installation success',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const launched=await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  assert.equal(launched.installed,false);
  launches[0].child.emit('exit',1603,null);
  const scope={node_id:nodeId,plan_id:planId,wave_id:waveId,
    offer_sha256:crypto.createHash('sha256').update(JSON.stringify(f.offer)).digest('hex'),
    installer_sha256:f.offer.signed.installer_sha256,grant_id:grantId,
    target_version:f.offer.signed.version,kind:f.offer.signed.type};
  const observation=inspectDirectExit({dir:f.nodeDir,node,scope});
  assert.equal(observation.direct_process_exit_code,1603);
  assert.equal(observation.installer_completion_proven,false);
  assert.equal(observation.local_hold_release_allowed,false);
  assert.equal(inspectDirectExitFromJournals({dir:f.nodeDir,node,
    agentIds:[agentId],observedVersion:'7.0.0'}).observed,true);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));

test('read-only UI path refuses tampered execution launch receipt even if direct exit exists',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  launches[0].child.emit('exit',0,null);
  const receipt=path.join(f.nodeDir,'installer-execution-launch-observed.json');
  const forged=JSON.parse(fs.readFileSync(receipt,'utf8'));
  forged.target_version='9.9.9';
  fs.writeFileSync(receipt,JSON.stringify(forged));
  assert.throws(()=>inspectDirectExitFromJournals({dir:f.nodeDir,node,
    agentIds:[agentId],observedVersion:'7.0.0'}),/DEVICE_SIGNATURE_INVALID/);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));

test('even a correctly device-signed but different launch PID cannot match direct exit',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  launches[0].child.emit('exit',0,null);
  const file=path.join(f.nodeDir,'installer-execution-launch-observed.json');
  const old=JSON.parse(fs.readFileSync(file,'utf8'));
  const {signature_base64,...payload}=old;
  payload.direct_process_pid+=1;
  const changed={...payload,signature_base64:crypto.sign(null,
    Buffer.from('SUTRADHAR_INSTALL_EXECUTION_V1\n'+JSON.stringify(payload)),
    offerKey.privateKey).toString('base64')};
  fs.writeFileSync(file,JSON.stringify(changed));
  assert.throws(()=>inspectDirectExitFromJournals({dir:f.nodeDir,node,
    agentIds:[agentId],observedVersion:'7.0.0'}),/SIGNED_LAUNCH_PID_MISMATCH/);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));

test('persisted launch journal precedes detached observer; helper never receives OS-vault key',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const handoffs=[];
  const observerLauncher=(payload)=>{
    const launchFile=path.join(f.nodeDir,'installer-execution-launch-observed.json');
    const signedLaunch=JSON.parse(fs.readFileSync(launchFile,'utf8'));
    assert.equal(signedLaunch.direct_process_pid,payload.pid);
    assert.equal(signedLaunch.grant_id,payload.grantId);
    assert.equal(signedLaunch.installer_sha256,payload.installerSha256);
    assert.equal(payload.installerPath,
      path.join(f.nodeDir,'installer-escrow','SUTRADHAR Desktop.exe'));
    assert.ok(!JSON.stringify(payload).includes('PRIVATE KEY'));
    handoffs.push(payload);
    return {started:true,witness_signed:false};
  };
  const result=await launchStagedInstaller({...f.args,
    grantEnvelope:f.grant(),runner,observerLauncher});
  assert.equal(result.launched,true);
  assert.equal(result.persistent_observer_started,true);
  assert.equal(result.observer_witness_trusted,false);
  assert.equal(handoffs.length,1);
  assert.equal(handoffs[0].pid,launches[0].child.pid);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));
test('unavailable detached observer never converts an already launched EXE to success or retry',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner}=launcherRecorder();
  const result=await launchStagedInstaller({...f.args,
    grantEnvelope:f.grant(),runner,
    observerLauncher:()=>{throw Error('PowerShell denied');}});
  assert.equal(result.launched,true);
  assert.equal(result.persistent_observer_started,false);
  assert.equal(result.installed,false);
  assert.equal(result.agent_restart_allowed,false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));

test('oversized Central evidence never creates installer attempt or process',()=>fixtures(async dir=>{
  const f=initial(dir);await prepareInstaller(f.prep);
  const {runner,launches}=launcherRecorder();
  const normal=f.args.fetcher;
  const huge=async(url,opts)=>{
    if(new URL(url).pathname==='/v7/nodes/maintenance')
      return new Response(JSON.stringify({padding:'X'.repeat(70000)}),{
        headers:{'content-type':'application/json'}});
    return normal(url,opts);
  };
  await assert.rejects(launchStagedInstaller({...f.args,fetcher:huge,
    grantEnvelope:f.grant(),runner}),/CENTRAL_RESPONSE_TOO_LARGE/);
  assert.equal(launches.length,0);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-execution-attempt.json')),false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
}));
