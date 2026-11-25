'use strict';
/* Detached, nonprivileged Windows process-liveness observer. NEVER an installer
 * launcher or a trusted completion attestation. It receives NO private keys.
 */
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {psLiteral}=require('./windows-authenticode.cjs');
const {readEvidenceBytes}=require('./local-evidence-file.cjs');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {identityEvidence}=require('./maintenance-install-preparation.cjs');
const {verifySigned,jsonFile}=require('./maintenance-postinstall-verification.cjs');
const NAME='installer-process-observer-unsigned.json';
const HEX=/^[0-9a-f]{64}$/;
const STATES=['PROCESS_NOT_PRESENT_AT_START','UNVERIFIABLE_PROCESS_IDENTITY',
  'DIRECT_PROCESS_DISAPPEARED','PROCESS_IDENTITY_CHANGED',
  'TIMED_OUT_STILL_PRESENT','INSPECTION_ERROR'];
const fail=code=>{throw Error(code);};
// Witnesses are evidence even when a symlink target is missing. A prior
// observer entry must never be mistaken for permission to start another.
function witnessEntryPresent(file){
  try{fs.lstatSync(file);return true;}
  catch(error){
    if(error?.code==='ENOENT')return false;
    fail('INSTALL_OBSERVER_FILE_STATE_UNCERTAIN');
  }
}
const SCRIPT=String.raw`
$ErrorActionPreference='Stop'
$watchedPid=__PID__
$expectedExe=__EXE__
$witness=__WITNESS__
$node=__NODE__
$grant=__GRANT__
$digest=__SHA__
$start=(Get-Date).ToUniversalTime()
$end=$start.AddMinutes(__MINUTES__)
$creation=$null
$status='INSPECTION_ERROR'
try {
  $initial=Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = {0}" -f $watchedPid)
  if($null -eq $initial) {
    $status='PROCESS_NOT_PRESENT_AT_START'
  } elseif([string]::IsNullOrWhiteSpace($initial.ExecutablePath) -or
           $null -eq $initial.CreationDate -or
           $initial.ExecutablePath -cne $expectedExe) {
    $status='UNVERIFIABLE_PROCESS_IDENTITY'
  } else {
    $creation=$initial.CreationDate.ToUniversalTime().ToString('o')
    $status='TIMED_OUT_STILL_PRESENT'
    while((Get-Date).ToUniversalTime() -lt $end) {
      Start-Sleep -Seconds 2
      $current=Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = {0}" -f $watchedPid)
      if($null -eq $current) {
        $status='DIRECT_PROCESS_DISAPPEARED'
        break
      }
      if([string]::IsNullOrWhiteSpace($current.ExecutablePath) -or
         $null -eq $current.CreationDate) {
        $status='UNVERIFIABLE_PROCESS_IDENTITY'
        break
      }
      if($current.ExecutablePath -cne $expectedExe -or
         $current.CreationDate.ToUniversalTime().ToString('o') -cne $creation) {
        $status='PROCESS_IDENTITY_CHANGED'
        break
      }
    }
  }
} catch { $status='INSPECTION_ERROR' }
$data=[ordered]@{
  schema=1;state=$status;source='UNTRUSTED_WINDOWS_CIM_LIVENESS_OBSERVER'
  node_id=$node;grant_id=$grant;installer_sha256=$digest
  direct_process_pid=$watchedPid;process_creation_utc=$creation
  observed_utc=(Get-Date).ToUniversalTime().ToString('o')
  direct_exit_code_known=$false;installer_completion_proven=$false
  elevated_process_chain_verified=$false;local_hold_release_allowed=$false
  automatic_retry_allowed=$false;automatic_rollback_allowed=$false
  agent_restart_allowed=$false
}
try {
  $bytes=([System.Text.UTF8Encoding]::new($false)).GetBytes(
    ($data|ConvertTo-Json -Compress))
  $s=[System.IO.File]::Open($witness,[System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
  try{$s.Write($bytes,0,$bytes.Length);$s.Flush($true)}
  finally{$s.Dispose()}
} catch { }
`;
function buildObserverCommand({dir,pid,installerPath,nodeId,grantId,
  installerSha256,maxMinutes=120}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||
     typeof installerPath!=='string'||!path.isAbsolute(installerPath)||
     !Number.isSafeInteger(pid)||pid<=0||
     !/^node_[0-9a-f]{32}$/.test(nodeId||'')||
     !HEX.test(grantId||'')||!HEX.test(installerSha256||'')||
     !Number.isSafeInteger(maxMinutes)||maxMinutes<1||maxMinutes>180)
    fail('INSTALL_OBSERVER_COMMAND_SCOPE_INVALID');
  const values={__PID__:String(pid),__EXE__:psLiteral(installerPath),
    __WITNESS__:psLiteral(path.join(dir,NAME)),
    __NODE__:psLiteral(nodeId),__GRANT__:psLiteral(grantId),
    __SHA__:psLiteral(installerSha256),__MINUTES__:String(maxMinutes)};
  let command=SCRIPT;
  for(const [k,v] of Object.entries(values))command=command.replaceAll(k,v);
  if(/__[A-Z_]+__/.test(command))fail('INSTALL_OBSERVER_TEMPLATE_UNRESOLVED');
  return command;
}
function launchPersistentObserver({dir,pid,installerPath,nodeId,grantId,
  installerSha256,platform=process.platform,runner=spawn,
  onError=()=>{}}={}){
  if(platform!=='win32')fail('INSTALL_OBSERVER_WINDOWS_ONLY');
  if(witnessEntryPresent(path.join(dir,NAME)))
    fail('INSTALL_OBSERVER_PREVIOUS_WITNESS_OWNER_REVIEW');
  const script=buildObserverCommand({dir,pid,installerPath,nodeId,grantId,
    installerSha256});
  const windowsRoot=process.env.SystemRoot||'C:\\Windows';
  if(!/^[A-Za-z]:\\[^<>:"|?*]+$/.test(windowsRoot)||
     windowsRoot.split('\\').some(part=>part==='..'||part==='.'))
    fail('INSTALL_OBSERVER_WINDOWS_ROOT_INVALID');
  const system32=path.win32.join(windowsRoot,'System32');
  const powershell=path.win32.join(system32,
    'WindowsPowerShell','v1.0','powershell.exe');
  const child=runner(powershell,['-NoProfile','-NonInteractive',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {detached:true,stdio:'ignore',windowsHide:true,shell:false,env:{
      SystemRoot:windowsRoot,WINDIR:windowsRoot,
      PATH:system32,
      PSModulePath:path.win32.join(system32,
        'WindowsPowerShell','v1.0','Modules')
    }});
  if(!child||typeof child.once!=='function'||typeof child.unref!=='function')
    fail('INSTALL_OBSERVER_SPAWN_UNCERTAIN');
  child.once('error',onError);
  child.unref();
  return Object.freeze({started:true,witness_signed:false,
    installer_completion_proven:false,hold_release_allowed:false});
}
function trustedLaunch({dir,node,agentIds}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    fail('INSTALL_OBSERVER_DIRECTORY_INVALID');
  const identity=identityEvidence(node,agentIds);
  const hold=inspectHold({dir,nodeId:node.node_id});
  if(!hold.active)fail('INSTALL_OBSERVER_HOLD_REQUIRED');
  const a=verifySigned(jsonFile(path.join(dir,'installer-execution-attempt.json')),
    node,'SUTRADHAR_INSTALL_EXECUTION_V1\n');
  const launch=verifySigned(jsonFile(path.join(dir,
    'installer-execution-launch-observed.json')),node,
    'SUTRADHAR_INSTALL_EXECUTION_V1\n');
  if(a.node_id!==identity.node_id||a.plan_id!==hold.plan_id||
     a.wave_id!==hold.wave_id||a.offer_sha256!==hold.offer_sha256||
     a.identity_public_key_sha256!==identity.public_key_sha256||
     a.state!=='EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED'||
     a.installer_installation_verified!==false||
     a.automatic_retry_allowed!==false||
     launch.state!=='WINDOWS_INSTALLER_PROCESS_STARTED_UNVERIFIED'||
     launch.node_id!==a.node_id||launch.grant_id!==a.grant_id||
     launch.installer_sha256!==a.installer_sha256||
     launch.target_version!==a.target_version||launch.kind!==a.kind||
     !Number.isSafeInteger(launch.direct_process_pid)||
     launch.direct_process_pid<=0||
     launch.installer_installation_verified!==false||
     launch.automatic_retry_allowed!==false)
    fail('INSTALL_OBSERVER_SIGNED_LAUNCH_MISMATCH');
  return {attempt:a,launch};
}
function inspectObserverWitness({dir,node,agentIds}={}){
  const {attempt,launch}=trustedLaunch({dir,node,agentIds});
  const file=path.join(dir,NAME);
  if(!witnessEntryPresent(file))return Object.freeze({available:false,
    state:'NO_WITNESS_OUTCOME_UNKNOWN',witness_signed:false,
    installer_completion_proven:false,hold_release_allowed:false});
  // This witness is unsigned and strictly diagnostic. Even so, a racing
  // filename replacement must not silently substitute different observations.
  // The shared bounded descriptor verifies inode, size and timestamps.
  let raw;
  try{
    const bytes=readEvidenceBytes(file,{minBytes:100,maxBytes:4096});
    raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{fail('INSTALL_OBSERVER_WITNESS_CORRUPT');}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     raw.schema!==1||!STATES.includes(raw.state)||
     raw.source!=='UNTRUSTED_WINDOWS_CIM_LIVENESS_OBSERVER'||
     raw.node_id!==attempt.node_id||raw.grant_id!==attempt.grant_id||
     raw.installer_sha256!==attempt.installer_sha256||
     raw.direct_process_pid!==launch.direct_process_pid||
     !(raw.process_creation_utc===null||
       typeof raw.process_creation_utc==='string'&&raw.process_creation_utc.length<80)||
     typeof raw.observed_utc!=='string'||raw.observed_utc.length>80||
     raw.direct_exit_code_known!==false||
     raw.installer_completion_proven!==false||
     raw.elevated_process_chain_verified!==false||
     raw.local_hold_release_allowed!==false||
     raw.automatic_retry_allowed!==false||
     raw.automatic_rollback_allowed!==false||
     raw.agent_restart_allowed!==false)
    fail('INSTALL_OBSERVER_SCOPE_OR_FLAGS_INVALID');
  return Object.freeze({available:true,state:raw.state,
    witness_signed:false,witness_authenticated:false,
    process_disappearance_reported_untrusted:
      raw.state==='DIRECT_PROCESS_DISAPPEARED',
    direct_exit_code_known:false,installer_completion_proven:false,
    hold_release_allowed:false,automatic_retry_allowed:false,
    owner_review_required:true});
}
module.exports={buildObserverCommand,launchPersistentObserver,
  inspectObserverWitness,trustedLaunch};
