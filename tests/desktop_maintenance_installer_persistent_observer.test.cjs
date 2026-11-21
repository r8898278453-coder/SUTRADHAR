'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {createHold}=require('../apps/desktop/maintenance-recovery-hold.cjs');
const {buildObserverCommand,launchPersistentObserver,
  inspectObserverWitness}=require('../apps/desktop/maintenance-installer-persistent-observer.cjs');
const keys=crypto.generateKeyPairSync('ed25519');
const nodeId='node_'+'c'.repeat(32),grant='e'.repeat(64);
const node={node_id:nodeId,
  public_key_pem:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
  private_key_pem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  agents:[{id:'agent_a1'}]};
const sha=crypto.createHash('sha256').update('installer').digest('hex');
const scope={node_id:nodeId,plan_id:'plan_observer_123',
  wave_id:'wave_pilot01',offer_sha256:'a'.repeat(64),
  installer_sha256:sha,grant_id:grant,kind:'update',target_version:'7.1.0'};
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-observer-'));
  try{
    createHold({dir,nodeId,planId:scope.plan_id,
      waveId:scope.wave_id,offerSha256:scope.offer_sha256});
    const fingerprint=crypto.createHash('sha256').update(
      keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
    const attempt={schema:1,state:'EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED',
      node_id:nodeId,plan_id:scope.plan_id,wave_id:scope.wave_id,
      offer_sha256:scope.offer_sha256,installer_sha256:sha,grant_id:grant,
      identity_public_key_sha256:fingerprint,target_version:'7.1.0',
      kind:'update',installer_installation_verified:false,
      automatic_retry_allowed:false};
    const launch={schema:1,state:'WINDOWS_INSTALLER_PROCESS_STARTED_UNVERIFIED',
      node_id:nodeId,grant_id:grant,installer_sha256:sha,
      target_version:'7.1.0',kind:'update',direct_process_pid:48812,
      installer_installation_verified:false,automatic_retry_allowed:false};
    const save=(name,value)=>{
      const prefix='SUTRADHAR_INSTALL_EXECUTION_V1\n';
      const signed={...value,signature_base64:crypto.sign(null,
        Buffer.from(prefix+JSON.stringify(value)),keys.privateKey).toString('base64')};
      fs.writeFileSync(path.join(dir,name),JSON.stringify(signed));
    };
    save('installer-execution-attempt.json',attempt);
    save('installer-execution-launch-observed.json',launch);
    return fn(dir);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function witness(dir,patch={}){
  const x={schema:1,state:'DIRECT_PROCESS_DISAPPEARED',
    source:'UNTRUSTED_WINDOWS_CIM_LIVENESS_OBSERVER',
    node_id:nodeId,grant_id:grant,installer_sha256:sha,
    direct_process_pid:48812,
    process_creation_utc:'2026-11-18T12:00:00.000Z',
    observed_utc:'2026-11-18T12:05:00.000Z',
    direct_exit_code_known:false,installer_completion_proven:false,
    elevated_process_chain_verified:false,
    local_hold_release_allowed:false,automatic_retry_allowed:false,
    automatic_rollback_allowed:false,agent_restart_allowed:false,...patch};
  fs.writeFileSync(path.join(dir,'installer-process-observer-unsigned.json'),
    JSON.stringify(x));
}
test('PowerShell liveness script pins exact PID/path, cannot inject arbitrary PowerShell',()=>fixture(dir=>{
  const executable=path.join(dir,"SUTRADHAR O'Brien.exe");
  const cmd=buildObserverCommand({dir,pid:48812,
    installerPath:executable,nodeId,grantId:grant,installerSha256:sha});
  assert.ok(cmd.includes("O''Brien.exe"));
  assert.ok(cmd.includes('$watchedPid=48812'));
  assert.ok(cmd.includes('Get-CimInstance'));
  assert.ok(cmd.includes('CreateNew'));
  assert.ok(cmd.includes('TIMED_OUT_STILL_PRESENT'));
  assert.ok(cmd.includes('Get-Date'));
  assert.ok(!cmd.includes(node.private_key_pem));
  assert.ok(!cmd.includes('Start-Process'));
  assert.ok(!cmd.includes('Invoke-Expression'));
  assert.throws(()=>buildObserverCommand({dir,pid:'48812; exit',
    installerPath:executable,nodeId,grantId:grant,installerSha256:sha}),
    /COMMAND_SCOPE_INVALID/);
  assert.throws(()=>buildObserverCommand({dir,pid:48812,
    installerPath:executable,nodeId,grantId:'bad',installerSha256:sha}),
    /COMMAND_SCOPE_INVALID/);
}));
test('sidecar uses nonprivileged detached PowerShell, never launches EXE or receives device secrets',()=>fixture(dir=>{
  const calls=[];
  const child=new EventEmitter();child.pid=22001;child.unref=()=>{child.unreffed=true;};
  const result=launchPersistentObserver({dir,pid:48812,
    installerPath:path.join(dir,'SUTRADHAR Desktop.exe'),
    nodeId,grantId:grant,installerSha256:sha,platform:'win32',
    runner:(program,args,options)=>{calls.push({program,args,options});return child;}});
  assert.equal(result.started,true);
  assert.equal(result.witness_signed,false);
  assert.equal(calls.length,1);
  assert.ok(calls[0].program.toLowerCase().endsWith('\\system32\\windowspowershell\\v1.0\\powershell.exe'));
  assert.ok(!calls[0].options.env.PATH.includes('node_modules'));
  assert.ok(calls[0].options.env.PSModulePath.includes('WindowsPowerShell'));
  assert.equal(calls[0].options.detached,true);
  assert.equal(calls[0].options.shell,false);
  assert.equal(calls[0].options.windowsHide,true);
  assert.equal(calls[0].options.stdio,'ignore');
  assert.equal(child.unreffed,true);
  assert.deepEqual(calls[0].args.slice(0,2),['-NoProfile','-NonInteractive']);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE KEY'));
  assert.throws(()=>launchPersistentObserver({dir,pid:48812,
    installerPath:path.join(dir,'SUTRADHAR Desktop.exe'),
    nodeId,grantId:grant,installerSha256:sha,platform:'linux'}),
    /WINDOWS_ONLY/);
}));
test('unsigned liveness disappearance is diagnostic only and never grants completion',()=>fixture(dir=>{
  const missing=inspectObserverWitness({dir,node,agentIds:['agent_a1']});
  assert.equal(missing.available,false);
  assert.equal(missing.installer_completion_proven,false);
  witness(dir);
  const evidence=inspectObserverWitness({dir,node,agentIds:['agent_a1']});
  assert.equal(evidence.available,true);
  assert.equal(evidence.process_disappearance_reported_untrusted,true);
  assert.equal(evidence.witness_signed,false);
  assert.equal(evidence.witness_authenticated,false);
  assert.equal(evidence.installer_completion_proven,false);
  assert.equal(evidence.hold_release_allowed,false);
  assert.equal(evidence.automatic_retry_allowed,false);
}));
test('tampered witness scope or permission flags always rejected',()=>fixture(dir=>{
  for(const patch of [
    {node_id:'node_'+'d'.repeat(32)},{grant_id:'f'.repeat(64)},
    {direct_process_pid:5},{installer_sha256:'f'.repeat(64)},
    {local_hold_release_allowed:true},{installer_completion_proven:true},
    {state:'INSTALLATION_SUCCEEDED'}
  ]){
    witness(dir,patch);
    assert.throws(()=>inspectObserverWitness({dir,node,
      agentIds:['agent_a1']}),/SCOPE_OR_FLAGS_INVALID/);
  }
}));
test('signed launch tampering cannot be hidden behind plausible unsigned witness',()=>fixture(dir=>{
  witness(dir);
  const file=path.join(dir,'installer-execution-launch-observed.json');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  data.direct_process_pid=5;
  fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>inspectObserverWitness({dir,node,agentIds:['agent_a1']}),
    /DEVICE_SIGNATURE_INVALID/);
}));
test('observer previous witness blocks new instance and incomplete files fail closed',()=>fixture(dir=>{
  witness(dir);
  assert.throws(()=>launchPersistentObserver({dir,pid:48812,
    installerPath:path.join(dir,'SUTRADHAR Desktop.exe'),
    nodeId,grantId:grant,installerSha256:sha,platform:'win32',
    runner:()=>{throw Error('should not run');}}),/PREVIOUS_WITNESS/);
  fs.writeFileSync(path.join(dir,'installer-process-observer-unsigned.json'),
    'truncated');
  assert.throws(()=>inspectObserverWitness({dir,node,agentIds:['agent_a1']}),
    /WITNESS_CORRUPT/);
}));
