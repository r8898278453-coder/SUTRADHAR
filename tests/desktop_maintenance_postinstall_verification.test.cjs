'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {prepareInstaller}=require('../apps/desktop/maintenance-install-preparation.cjs');
const {verifyExecutionGrant}=require('../apps/desktop/maintenance-installer-execution-grant.cjs');
const {launchStagedInstaller}=require('../apps/desktop/maintenance-installer-execution.cjs');
const {observePostInstall,verifyObservedReceipt}=
  require('../apps/desktop/maintenance-postinstall-verification.cjs');
const {verifyInstalledDesktopPublisher}=
  require('../apps/desktop/windows-authenticode.cjs');
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
    // Preparation and execution share this mock and predate the hardened
    // observation request. Assert these options on observation-specific
    // requests rather than accidentally failing earlier stages.
    if(options.credentials!==undefined||options.cache!==undefined){
      assert.equal(options.credentials,'omit');
      assert.equal(options.cache,'no-store');
    }
    if(replies.offline)throw Error('offline');
    const p=new URL(url).pathname;
    const d=p==='/v7/nodes/maintenance'?replies.maintenance:
      p==='/v7/cluster/state'?replies.cluster:
      p==='/v7/nodes/me'?replies.me:null;
    if(!d)throw Error('unsupported path '+p);
    return new Response(JSON.stringify(d),{status:200,
      headers:{'content-type':'application/json'}});
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

const installedPublisher=({publisherSubject})=>({
  verified:true,exe_sha256:'a'.repeat(64),
  publisher_subject:publisherSubject,installation_success_proven:false});
async function launched(dir,{rollback=false}={}){
  const f=initial(dir,{rollback});
  await prepareInstaller(f.prep);
  const {runner}=launcherRecorder();
  await launchStagedInstaller({...f.args,grantEnvelope:f.grant(),runner});
  const appPath=path.join(dir,'installed SUTRADHAR.exe');
  fs.writeFileSync(appPath,crypto.randomBytes(1700));
  return {f,check:{dir:f.nodeDir,node,
    agentIds:[agentId],observedVersion:f.offer.signed.version,
    installedExecutable:appPath,publisherSubject:'CN=SUTRADHAR Verified',
    centralOrigin:f.args.centralOrigin,signer:f.args.signer,
    platform:'win32',verifyPublisher:installedPublisher,
    fetcher:f.args.fetcher}};
}
test('target version, same enrolled key, signed launch receipts and fresh Central produce observation only',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  const sourceFetch=check.fetcher;
  let boundedRequests=0;
  check.fetcher=async(url,options)=>{
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.redirect,'error');
    boundedRequests++;
    return sourceFetch(url,options);
  };
  const result=await observePostInstall(check);
  assert.equal(boundedRequests,5);
  assert.equal(result.observed,true);
  assert.equal(result.installer_completion_proven,false);
  assert.equal(result.central_maintenance_reconfirmed,true);
  assert.equal(result.local_hold_still_active,true);
  const record=JSON.parse(fs.readFileSync(path.join(f.nodeDir,'installer-postinstall-observed.json')));
  assert.equal(record.state,'TARGET_VERSION_IDENTITY_CENTRAL_OBSERVED');
  assert.equal(record.installer_completion_proven,false);
  assert.ok(record.signature_base64.length>=80);
  const proof=verifyObservedReceipt({dir:f.nodeDir,node,agentIds:[agentId],observedVersion:'7.1.0',
    installedExecutable:check.installedExecutable,publisherSubject:check.publisherSubject,
    platform:'win32',verifyPublisher:installedPublisher});
  assert.equal(proof.target_version_observed,true);
  assert.equal(proof.auto_release_allowed,false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
  await assert.rejects(observePostInstall(check),/ALREADY_RECORDED/);
}));
test('rollback target version is observed but never described as successful rollback',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir,{rollback:true});
  const result=await observePostInstall(check);
  assert.equal(result.observed_version,'6.9.0');
  assert.equal(result.installer_completion_proven,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.nodeDir,
    'installer-postinstall-observed.json'))).kind,'rollback');
}));
test('old running version and failed publisher cannot produce observation',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  await assert.rejects(observePostInstall({...check,observedVersion:'7.0.0'}),
    /TARGET_VERSION_NOT_OBSERVED/);
  await assert.rejects(observePostInstall({...check,verifyPublisher:()=>({
    verified:false})}),/AUTHENTICODE_REQUIRED/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-postinstall-observed.json')),false);
}));
test('missing or forged signed process-launch evidence fails closed',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  const launchPath=path.join(f.nodeDir,'installer-execution-launch-observed.json');
  const original=fs.readFileSync(launchPath,'utf8');
  const forged=JSON.parse(original);
  forged.target_version='9.9.9';
  fs.writeFileSync(launchPath,JSON.stringify(forged));
  await assert.rejects(observePostInstall(check),/DEVICE_SIGNATURE_INVALID/);
  fs.unlinkSync(launchPath);
  await assert.rejects(observePostInstall(check),/RECEIPT_MISSING_OR_CORRUPT/);
  fs.writeFileSync(launchPath,original);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-postinstall-observed.json')),false);
}));
test('Central offline, revoked fence, busy agent, role rotation, epoch change cannot record',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  const original={maintenance:f.replies.maintenance,
    cluster:f.replies.cluster,me:f.replies.me};
  const changes=[
    {offline:true},
    {maintenance:{...original.maintenance,
      intent:{...original.maintenance.intent,fence_active:false}}},
    {cluster:{...original.cluster,epoch:12}},
    {cluster:{...original.cluster,master_agent_id:agentId}},
    {me:{...original.me,agents:[{...original.me.agents[0],active_ticket:'ticket_busy'}]}}
  ];
  for(const change of changes){
    Object.assign(f.replies,{...original,offline:false,...change});
    await assert.rejects(observePostInstall(check));
    assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-postinstall-observed.json')),false);
  }
}));
test('tampering OS-vault signed postinstall observation fails signature check',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  await observePostInstall(check);
  const file=path.join(f.nodeDir,'installer-postinstall-observed.json');
  const corrupted=JSON.parse(fs.readFileSync(file));
  corrupted.observed_version='9.9.9';fs.writeFileSync(file,JSON.stringify(corrupted));
  assert.throws(()=>verifyObservedReceipt({dir:f.nodeDir,node,
    agentIds:[agentId],observedVersion:'7.1.0',
    installedExecutable:check.installedExecutable,publisherSubject:check.publisherSubject,
    platform:'win32',verifyPublisher:installedPublisher}),/DEVICE_SIGNATURE_INVALID/);
}));
test('installed-app Authenticode verifier checks real file SHA before/after and publisher via encoded PowerShell',()=>fixtures(dir=>{
  const executablePath=path.join(dir,"SUTRADHAR O'Brien.exe");
  fs.writeFileSync(executablePath,crypto.randomBytes(1500));
  let calls=0;
  const verified=verifyInstalledDesktopPublisher({executablePath,
    publisherSubject:'CN=SUTRADHAR Verified',platform:'win32',
    runner:(_cmd,args)=>{
      calls++;
      const cmd=Buffer.from(args.at(-1),'base64').toString('utf16le');
      assert.ok(cmd.includes("O''Brien"));
      assert.ok(cmd.includes('Get-AuthenticodeSignature'));
      return {status:0};
    }});
  assert.equal(verified.verified,true);assert.equal(calls,1);
  assert.equal(verified.installation_success_proven,false);
  assert.throws(()=>verifyInstalledDesktopPublisher({executablePath,
    publisherSubject:'CN=SUTRADHAR Verified',platform:'win32',
    runner:()=>({status:43})}),/PUBLISHER_VERIFICATION_FAILED/);
}));

test('after installer attempt Owner cannot release hold before postinstall observation; later still needs signed cancellation',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  const releaseKeys=crypto.generateKeyPairSync('ed25519');
  const pub=releaseKeys.publicKey.export({type:'spki',format:'pem'}).toString();
  const now=Date.now();
  const releaseEnvelope=envelope({schema:1,action:'release_maintenance_hold',
    node_id:nodeId,plan_id:planId,wave_id:waveId,
    offer_sha256:f.prep.envelope?crypto.createHash('sha256')
      .update(JSON.stringify(f.prep.envelope)).digest('hex'):f.offer.signed.installer_sha256,
    grant_id:'e'.repeat(64),issued_ms:now-1000,expires_ms:now+120000},releaseKeys);
  const cancelFetcher=async url=>{
    assert.equal(new URL(url).pathname,
      '/v7/nodes/maintenance/recovery/'+planId);
    return new Response(JSON.stringify({
      node_id:nodeId,plan_id:planId,wave_id:waveId,
      offer_sha256:releaseEnvelope.signed.offer_sha256,
      state:'CANCELLED',cancellation_verified:true,any_active_fence:false,
      any_active_maintenance_intent:false,
      local_hold_release_allowed:false,installer_execution_allowed:false,
      recovery_requires_owner:true
    }),{headers:{'content-type':'application/json'}});
  };
  const releaseArgs={dir:f.nodeDir,centralOrigin:check.centralOrigin,
    nodeId,signer:check.signer,grantEnvelope:releaseEnvelope,
    pinnedPublicKeyPem:pub,agentStopped:true,node,
    agentIds:[agentId],currentVersion:'7.1.0',fetcher:cancelFetcher,
    installedExecutable:check.installedExecutable,publisherSubject:check.publisherSubject,
    platform:'win32',verifyPublisher:installedPublisher};
  await assert.rejects(releaseHold(releaseArgs),/POSTINSTALL_RECEIPT_MISSING_OR_CORRUPT/);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,true);
  await observePostInstall(check);
  const released=await releaseHold(releaseArgs);
  assert.equal(released.released,true);
  assert.equal(released.agent_started,false);
  assert.equal(inspectHold({dir:f.nodeDir,nodeId}).active,false);
  assert.equal(fs.existsSync(path.join(f.nodeDir,'installer-postinstall-observed.json')),true);
}));

test('Owner release rejects replaced EXE or changed signing publisher after a valid earlier observation',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  await observePostInstall(check);
  const verified={dir:f.nodeDir,node,agentIds:[agentId],observedVersion:'7.1.0',
    installedExecutable:check.installedExecutable,
    publisherSubject:check.publisherSubject,platform:'win32',
    verifyPublisher:installedPublisher};
  assert.equal(verifyObservedReceipt(verified).observed,true);
  assert.throws(()=>verifyObservedReceipt({...verified,
    verifyPublisher:()=>({...installedPublisher({publisherSubject:check.publisherSubject}),
      exe_sha256:'b'.repeat(64)})}),/INSTALLED_APP_CHANGED/);
  assert.throws(()=>verifyObservedReceipt({...verified,
    verifyPublisher:()=>({...installedPublisher({publisherSubject:check.publisherSubject}),
      publisher_subject:'CN=Untrusted Developer'})}),/INSTALLED_APP_CHANGED/);
  assert.throws(()=>verifyObservedReceipt({...verified,platform:'linux'}),
    /INSTALLED_PUBLISHER_REQUIRED/);
}));


test('oversized Central HTTP response cannot generate signed post-install evidence',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  const huge=async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(65*1024));controller.close();}
  }),{status:200,headers:{'content-type':'application/json'}});
  await assert.rejects(observePostInstall({...check,fetcher:huge}),
    /POSTINSTALL_CENTRAL_RESPONSE_TOO_LARGE/);
  assert.equal(fs.existsSync(path.join(f.nodeDir,
    'installer-postinstall-observed.json')),false);
}));
test('signed observation still rejects forged Central reconfirmation and impossible times',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  await observePostInstall(check);
  const file=path.join(f.nodeDir,'installer-postinstall-observed.json');
  const original=JSON.parse(fs.readFileSync(file,'utf8'));
  const params={dir:f.nodeDir,node,agentIds:[agentId],
    observedVersion:'7.1.0',installedExecutable:check.installedExecutable,
    publisherSubject:check.publisherSubject,platform:'win32',
    verifyPublisher:installedPublisher};
  const resign=change=>{
    const {signature_base64,...payload}=original;
    const updated={...payload,...change};
    const signature=crypto.sign(null,Buffer.from(
      'SUTRADHAR_POSTINSTALL_OBSERVATION_V1\n'+JSON.stringify(updated)),
      node.private_key_pem).toString('base64');
    fs.writeFileSync(file,JSON.stringify({...updated,signature_base64:signature}));
  };
  resign({central_maintenance_reconfirmed:false});
  assert.throws(()=>verifyObservedReceipt(params),
    /POSTINSTALL_OBSERVATION_IDENTITY_MISMATCH/);
  resign({observed_at_ms:1});
  assert.throws(()=>verifyObservedReceipt(params),
    /POSTINSTALL_OBSERVATION_IDENTITY_MISMATCH/);
  resign({observed_at_ms:Date.now()+3600000});
  assert.throws(()=>verifyObservedReceipt(params),
    /POSTINSTALL_OBSERVATION_IDENTITY_MISMATCH/);
  fs.writeFileSync(file,JSON.stringify(original));
  assert.equal(verifyObservedReceipt(params).observed,true);
}));

test('postinstall reauthenticates the second preparation-ready read before trusting it',()=>fixtures(async dir=>{
  const {f,check}=await launched(dir);
  const ready=path.join(f.nodeDir,'installer-preparation-ready.json');
  const originalStat=fs.lstatSync;
  let reads=0,swapped=false;
  try{
    fs.lstatSync=function(file,...options){
      if(file===ready&&++reads===3){
        swapped=true;
        const forged=JSON.parse(fs.readFileSync(ready,'utf8'));
        forged.previous_version='0.0.0';
        fs.writeFileSync(ready,JSON.stringify(forged));
      }
      return originalStat.call(this,file,...options);
    };
    await assert.rejects(observePostInstall(check),
      /UPDATE_PREPARE_RECORD_SIGNATURE_INVALID/);
    assert.equal(swapped,true,'must exercise the separate ready receipt read');
    assert.equal(fs.existsSync(path.join(f.nodeDir,
      'installer-postinstall-observed.json')),false);
  }finally{fs.lstatSync=originalStat;}
}));
test('postinstall journal descriptor read rejects identical-content inode replacement',()=>fixtures(async dir=>{
  const {f}=await launched(dir);
  const {jsonFile}=require('../apps/desktop/maintenance-postinstall-verification.cjs');
  const receipt=path.join(f.nodeDir,'installer-execution-attempt.json');
  const raw=fs.readFileSync(receipt);
  const originalRead=fs.readSync;
  let replaced=false;
  try{
    fs.readSync=function(...args){
      const n=originalRead.apply(this,args);
      if(!replaced){
        replaced=true;
        fs.renameSync(receipt,receipt+'.original');
        fs.writeFileSync(receipt,raw,{mode:0o600});
      }
      return n;
    };
    assert.throws(()=>jsonFile(receipt),/MISSING_OR_CORRUPT/);
    assert.equal(replaced,true);
  }finally{fs.readSync=originalRead;}
}));
