'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {createHold,inspectHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {prepareInstaller,identityEvidence,inspectPreparedIdentity}=require('../apps/desktop/maintenance-install-preparation.cjs');
const {psLiteral,verifyWindowsPublisher}=require('../apps/desktop/windows-authenticode.cjs');
const {digestOffer}=require('../scripts/release/print-maintenance-offer-digest.cjs');
const nodeId='node_'+'a'.repeat(32),agentId='agent_noncritical_1';
const keys=crypto.generateKeyPairSync('ed25519');
const pub=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const node={node_id:nodeId,public_key_pem:pub,
  private_key_pem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  agents:[{id:agentId}]};
const makeDir=async(fn)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-escrow-'));
  try{return await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
};
function setup(dir,type='update'){
  const installerPath=path.join(dir,'SUTRADHAR Desktop.exe');
  const bytes=crypto.randomBytes(1800);
  fs.writeFileSync(installerPath,bytes);
  const now=Date.now();
  const signed={schema:2,application:'desktop',channel:'stable',
    type,version:type==='rollback'?'7.0.0':'7.2.0',
    source_sha:'f'.repeat(40),protocol:7,filename:path.basename(installerPath),
    installer_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    installer_bytes:bytes.length,publisher_subject:'CN=SUTRADHAR Verified',
    issued_ms:now-1000,expires_ms:now+180000,
    rollout:{wave_id:'wave_pilot01',node_ids:[nodeId],
      owner_approved_at_ms:now-1000}};
  if(type==='rollback')signed.owner_emergency_rollback_approved=true;
  const envelope={signed,signature_base64:crypto.sign(null,
    Buffer.from(JSON.stringify(signed)),keys.privateKey).toString('base64')};
  const offerSha256=crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  const nodeDir=path.join(dir,'node');fs.mkdirSync(nodeDir);
  createHold({dir:nodeDir,nodeId,planId:'plan_pilot_123',
    waveId:'wave_pilot01',offerSha256});
  const maintenance={node_id:nodeId,installer_execution_allowed:false,
    owner_maintenance_lease:false,intent:{state:'DRAINED',fence_active:true,
      fence_release_requires_owner:true,plan_id:'plan_pilot_123',
      wave_id:'wave_pilot01',offer_sha256:offerSha256,expected_epoch:17}};
  const cluster={epoch:17,phase:'READY',paused:false,
    master_agent_id:'agent_master_1',
    backups:['agent_backup_1','agent_backup_2']};
  const me={node_id:nodeId,agents:[{agent_id:agentId,state:'APPROVED',
    status:'IDLE',active_ticket:null,has_live_work_lease:0,
    has_unreconciled_git_job:0}]};
  let maintenanceCount=0;
  const signer={sign:({kind,method,uri,body})=>{
    assert.equal(kind,'node_api');assert.equal(method,'GET');
    assert.equal(body,'');return {'x-sutradhar-node':nodeId,
      'x-sutradhar-nonce':'nonce','x-sutradhar-signature':'sig'};
  }};
  const responses={maintenance,cluster,me};
  const fetcher=async(url,o)=>{
    assert.equal(o.method,'GET');assert.equal(o.redirect,'error');
    const route=new URL(url).pathname;
    const response=route==='/v7/nodes/maintenance'?
      (++maintenanceCount, responses.maintenance):
      route==='/v7/cluster/state'?responses.cluster:
      route==='/v7/nodes/me'?responses.me:null;
    if(!response)throw Error('unsupported route');
    return {ok:true,json:async()=>typeof response==='function'?response():response};
  };
  const authenticode=({expectedSha256,publisherSubject})=>({
    verified:true,file_sha256:expectedSha256,publisher_subject:publisherSubject,
    installer_execution_allowed:false});
  const params={dir:nodeDir,installerPath,envelope,node,
    agentIds:[agentId],centralOrigin:'https://central.example.com',
    signer,currentVersion:type==='rollback'?'7.1.0':'7.0.0',
    pinnedPublicKeyPem:pub,publisherSubject:'CN=SUTRADHAR Verified',
    platform:'win32',authenticode,fetcher};
  return {params,responses,installerPath,nodeDir,maintenanceCount:()=>maintenanceCount};
}
test('exact drained Owner offer and Authenticode proof stage without executing update',()=>makeDir(async dir=>{
  const {params,installerPath,nodeDir,maintenanceCount}=setup(dir);
  const result=await prepareInstaller(params);
  assert.equal(result.prepared,true);
  assert.equal(result.installer_executed,false);
  assert.equal(result.installer_execution_allowed,false);
  assert.equal(maintenanceCount(),2);
  const escrow=path.join(nodeDir,'installer-escrow','SUTRADHAR Desktop.exe');
  assert.equal(fs.readFileSync(escrow).equals(fs.readFileSync(installerPath)),true);
  const attempt=JSON.parse(fs.readFileSync(path.join(nodeDir,'installer-preparation-attempt.json')));
  const ready=JSON.parse(fs.readFileSync(path.join(nodeDir,'installer-preparation-ready.json')));
  assert.equal(ready.status,'OFFLINE_STAGED_NOT_INSTALLED');
  assert.equal(attempt.identity_public_key_sha256,ready.identity_public_key_sha256);
  assert.equal(attempt.node_id,nodeId);
  assert.equal(attempt.installer_executed,false);
  assert.ok(attempt.signature_base64.length>64);
  assert.ok(ready.signature_base64.length>64);
  assert.equal(inspectHold({dir:nodeDir,nodeId}).active,true);
  await assert.rejects(prepareInstaller(params),/PREVIOUS_ATTEMPT/);
}));
test('Owner-emergency rollback is only staged, not applied',()=>makeDir(async dir=>{
  const {params,nodeDir}=setup(dir,'rollback');
  const result=await prepareInstaller(params);
  assert.equal(result.kind,'rollback');
  assert.equal(result.installer_executed,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(nodeDir,'installer-preparation-ready.json')))
    .rollback_automated,false);
}));
test('tampered offer, wrong agent identity, missing fence and expired offer fail closed',()=>makeDir(async dir=>{
  const {params,responses,nodeDir}=setup(dir);
  const cases=[
    {...params,envelope:{...params.envelope,signed:{
      ...params.envelope.signed,version:'9.0.0'}}},
    {...params,agentIds:['agent_wrong_1']},
    {...params,node:{...node,node_id:'node_'+'b'.repeat(32)}},
    {...params,envelope:{...params.envelope,signed:{
      ...params.envelope.signed,expires_ms:0}}},
    {...params,authenticode:()=>({verified:false})}
  ];
  for(const x of cases){
    await assert.rejects(prepareInstaller(x));
    assert.equal(fs.existsSync(path.join(nodeDir,'installer-preparation-attempt.json')),false);
  }
  responses.maintenance={...responses.maintenance,intent:{...responses.maintenance.intent,
    fence_active:false}};
  await assert.rejects(prepareInstaller(params),/OWNER_DRAIN_UNVERIFIED/);
  assert.equal(fs.existsSync(path.join(nodeDir,'installer-preparation-attempt.json')),false);
}));
test('Master/Backup, busy local agent or Central denial refuse escrow',()=>makeDir(async dir=>{
  const {params,responses,nodeDir}=setup(dir);
  responses.cluster={...responses.cluster,master_agent_id:agentId};
  await assert.rejects(prepareInstaller(params),/CLUSTER_UNHEALTHY/);
  responses.cluster={...responses.cluster,master_agent_id:'agent_master_1'};
  responses.me={...responses.me,agents:[{...responses.me.agents[0],active_ticket:'task_busy'}]};
  await assert.rejects(prepareInstaller(params),/WORK_NOT_DRAINED/);
  assert.equal(fs.existsSync(path.join(nodeDir,'installer-preparation-attempt.json')),false);
}));
test('staging refuses stale or interrupted attempts without overwriting records',()=>makeDir(async dir=>{
  const {params,nodeDir}=setup(dir);
  fs.writeFileSync(path.join(nodeDir,'installer-preparation-attempt.json'),'partial');
  await assert.rejects(prepareInstaller(params),/PREVIOUS_ATTEMPT/);
  assert.equal(fs.readFileSync(path.join(nodeDir,'installer-preparation-attempt.json'),'utf8'),'partial');
}));
test('PowerShell input is literal and SHA is checked on BOTH sides of signature call',()=>makeDir(async dir=>{
  const file=path.join(dir,"SUTRADHAR O'Brien $(bad).exe");
  fs.writeFileSync(file,crypto.randomBytes(1500));
  const digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(psLiteral("O'Brien"),"'O''Brien'");
  let ran=0;
  const yes=verifyWindowsPublisher({installerPath:file,
    publisherSubject:'CN=SUTRADHAR Verified',expectedSha256:digest,
    platform:'win32',runner:(_exec,args)=>{
      ran++;
      const code=Buffer.from(args.at(-1),'base64').toString('utf16le');
      assert.ok(code.includes("O''Brien"));
      assert.ok(code.includes("$(bad)"));
      return {status:0};
    }});
  assert.equal(yes.verified,true);assert.equal(ran,1);
  assert.throws(()=>verifyWindowsPublisher({installerPath:file,
    publisherSubject:'CN=SUTRADHAR Verified',expectedSha256:'0'.repeat(64),
    platform:'win32',runner:()=>{ran++;return {status:0};}}),/PRECHECK/);
  assert.equal(ran,1);
  assert.throws(()=>verifyWindowsPublisher({installerPath:file,
    publisherSubject:'CN=SUTRADHAR Verified',expectedSha256:digest,
    platform:'win32',runner:()=>({status:43})}),/VERIFICATION_FAILED/);
  assert.throws(()=>verifyWindowsPublisher({installerPath:file,
    publisherSubject:'CN=SUTRADHAR Verified',expectedSha256:digest,
    platform:'linux',runner:()=>({status:0})}),/WINDOWS_TRUST_REQUIRED/);
}));

test('post-install identity check validates unchanged OS-vault public key and agent set',()=>makeDir(async dir=>{
  const {params,nodeDir}=setup(dir);
  await prepareInstaller(params);
  const result=inspectPreparedIdentity({dir:nodeDir,node,agentIds:[agentId],
    observedVersion:'7.2.0'});
  assert.equal(result.identity_preserved,true);
  assert.equal(result.version_matches_target,true);
  assert.equal(result.installer_executed_proven,false);
  assert.equal(result.central_reconciliation_proven,false);
  const oldVersion=inspectPreparedIdentity({dir:nodeDir,node,agentIds:[agentId],
    observedVersion:'7.0.0'});
  assert.equal(oldVersion.identity_preserved,true);
  assert.equal(oldVersion.version_matches_target,false);
  const {publicKey:unrelated}=crypto.generateKeyPairSync('ed25519');
  assert.throws(()=>inspectPreparedIdentity({dir:nodeDir,
    node:{...node,public_key_pem:unrelated.export({type:'spki',format:'pem'}).toString()},
    agentIds:[agentId],observedVersion:'7.2.0'}),/MISMATCH_OWNER_REVIEW/);
  assert.throws(()=>inspectPreparedIdentity({dir:nodeDir,node,
    agentIds:['agent_wrong_1'],observedVersion:'7.2.0'}));
}));
test('post-install check denies corrupt or mismatched escrow evidence',()=>makeDir(async dir=>{
  const {params,nodeDir}=setup(dir);
  await prepareInstaller(params);
  const file=path.join(nodeDir,'installer-preparation-ready.json');
  const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
  receipt.offer_sha256='e'.repeat(64);
  fs.writeFileSync(file,JSON.stringify(receipt));
  assert.throws(()=>inspectPreparedIdentity({dir:nodeDir,node,agentIds:[agentId],
    observedVersion:'7.2.0'}),/MISMATCH_OWNER_REVIEW/);
}));

test('Owner maintenance offer digest matches exact local held envelope, never EXE SHA',()=>makeDir(async dir=>{
  const {params,nodeDir}=setup(dir);
  const hold=inspectHold({dir:nodeDir,nodeId});
  assert.equal(digestOffer(params.envelope),hold.offer_sha256);
  assert.notEqual(digestOffer(params.envelope),params.envelope.signed.installer_sha256);
  assert.throws(()=>digestOffer({signed:{schema:1},signature_base64:'A'}));
}));

test('escrow receipts must have valid OS-vault signatures; tamper is refused',()=>makeDir(async dir=>{
  const {params,nodeDir}=setup(dir);
  await prepareInstaller(params);
  const file=path.join(nodeDir,'installer-preparation-ready.json');
  const ready=JSON.parse(fs.readFileSync(file,'utf8'));
  ready.target_version='7.9.0';
  fs.writeFileSync(file,JSON.stringify(ready));
  assert.throws(()=>inspectPreparedIdentity({dir:nodeDir,node,agentIds:[agentId],
    observedVersion:'7.9.0'}),/RECORD_SIGNATURE_INVALID/);
  const wrongKey=crypto.generateKeyPairSync('ed25519');
  assert.throws(()=>identityEvidence({...node,
    private_key_pem:wrongKey.privateKey.export({type:'pkcs8',format:'pem'}).toString()},
    [agentId]),/KEYPAIR_MISMATCH/);
}));
