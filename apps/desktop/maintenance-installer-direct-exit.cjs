/**
 * Best-effort observation of a DIRECT Windows installer child exit.
 *
 * The Electron Desktop may quit before the installer exits. A missing record
 * means UNKNOWN. Even exit code zero proves only DIRECT process termination,
 * never NSIS completion, UAC child chain success or software installation.
 * Does not grant release, retry, rollback or agent restart authority.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const PREFIX='SUTRADHAR_INSTALLER_DIRECT_EXIT_V1\n';
const NAME='installer-direct-exit-observed.json';
const HEX=/^[0-9a-f]{64}$/;
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
function fail(code){throw Error(code);}
function validScope(scope){
  return Boolean(scope&&NODE.test(scope.node_id||'')&&
    ID.test(scope.plan_id||'')&&WAVE.test(scope.wave_id||'')&&
    HEX.test(scope.offer_sha256||'')&&HEX.test(scope.installer_sha256||'')&&
    HEX.test(scope.grant_id||'')&&
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(scope.target_version||'')&&
    ['update','rollback'].includes(scope.kind));
}
function writeOnce({dir,node,scope,pid,code,signal,clock}){
  const observedAt=clock();
  if(!Number.isSafeInteger(observedAt)||observedAt<1)
    fail('INSTALL_DIRECT_EXIT_CLOCK_INVALID');
  const record={schema:1,
    state:'DIRECT_INSTALLER_PROCESS_EXIT_OBSERVED_UNVERIFIED',
    node_id:scope.node_id,plan_id:scope.plan_id,wave_id:scope.wave_id,
    offer_sha256:scope.offer_sha256,
    installer_sha256:scope.installer_sha256,grant_id:scope.grant_id,
    target_version:scope.target_version,kind:scope.kind,
    direct_process_pid:pid,direct_process_exit_code:code,
    direct_process_exit_signal:signal,observed_at_ms:observedAt,
    installer_completion_proven:false,
    elevated_process_chain_verified:false,
    local_hold_release_allowed:false,
    automatic_retry_allowed:false,automatic_rollback_allowed:false,
    agent_restart_allowed:false};
  const privateKey=crypto.createPrivateKey(node.private_key_pem);
  const signed={...record,signature_base64:crypto.sign(null,
    Buffer.from(PREFIX+JSON.stringify(record)),privateKey).toString('base64')};
  const fd=fs.openSync(path.join(dir,NAME),'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(signed,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return signed;
}
function createDirectExitTracker({child,dir,node,scope,clock=Date.now,
  onRecordingError=()=>{}}={}){
  if(!child||typeof child.on!=='function'||
     !Number.isSafeInteger(child.pid)||child.pid<=0||
     typeof dir!=='string'||!path.isAbsolute(dir)||
     !node||node.node_id!==scope?.node_id||
     typeof node.private_key_pem!=='string'||!validScope(scope)||
     typeof clock!=='function'||typeof onRecordingError!=='function')
    fail('INSTALL_DIRECT_EXIT_TRACKER_ARGUMENTS_INVALID');
  const pid=child.pid;
  let pending=null,armed=false,written=false;
  const capture=(code,signal)=>{
    if(written||pending)return;
    // Node's exit event provides one status or signal; no event means UNKNOWN.
    const validCode=code===null||(Number.isSafeInteger(code)&&code>=0&&code<=4294967295);
    const validSignal=signal===null||
      (typeof signal==='string'&&/^[A-Z][A-Z0-9]{1,20}$/.test(signal));
    if(!validCode||!validSignal||code===null&&signal===null)return;
    pending={code,signal};
    if(armed)flush();
  };
  function flush(){
    if(!armed||!pending||written)return;
    written=true;
    try{writeOnce({dir,node,scope,pid,...pending,clock});}
    catch(error){onRecordingError(error);}
  }
  child.on('exit',capture);
  return Object.freeze({arm(){
    if(armed)return;
    armed=true;flush();
  }});
}
function inspectDirectExit({dir,node,scope}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!node||
     node.node_id!==scope?.node_id||!validScope(scope))
    fail('INSTALL_DIRECT_EXIT_INSPECT_ARGUMENTS_INVALID');
  const file=path.join(dir,NAME);
  if(!fs.existsSync(file))
    return Object.freeze({observed:false,installer_completion_proven:false,
      owner_review_required:true});
  let raw,stat;
  try{
    stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<200||stat.size>8192)
      fail('INSTALL_DIRECT_EXIT_RECEIPT_UNSAFE');
    raw=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch{fail('INSTALL_DIRECT_EXIT_RECEIPT_CORRUPT');}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     typeof raw.signature_base64!=='string'||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.signature_base64))
    fail('INSTALL_DIRECT_EXIT_SIGNATURE_MISSING');
  const {signature_base64,...payload}=raw;
  let verified=false;
  try{verified=crypto.verify(null,Buffer.from(PREFIX+JSON.stringify(payload)),
    crypto.createPublicKey(node.public_key_pem),
    Buffer.from(signature_base64,'base64'));}catch{}
  if(!verified)fail('INSTALL_DIRECT_EXIT_SIGNATURE_INVALID');
  if(payload.schema!==1||
     payload.state!=='DIRECT_INSTALLER_PROCESS_EXIT_OBSERVED_UNVERIFIED'||
     Object.keys(scope).some(k=>payload[k]!==scope[k])||
     !Number.isSafeInteger(payload.direct_process_pid)||
     payload.direct_process_pid<=0||
     !(payload.direct_process_exit_code===null||
       Number.isSafeInteger(payload.direct_process_exit_code)&&
       payload.direct_process_exit_code>=0&&
       payload.direct_process_exit_code<=4294967295)||
     !(payload.direct_process_exit_signal===null||
       typeof payload.direct_process_exit_signal==='string'&&
       /^[A-Z][A-Z0-9]{1,20}$/.test(payload.direct_process_exit_signal))||
     payload.direct_process_exit_code===null&&
       payload.direct_process_exit_signal===null||
     !Number.isSafeInteger(payload.observed_at_ms)||
     payload.observed_at_ms<=0||
     payload.installer_completion_proven!==false||
     payload.elevated_process_chain_verified!==false||
     payload.local_hold_release_allowed!==false||
     payload.automatic_retry_allowed!==false||
     payload.automatic_rollback_allowed!==false||
     payload.agent_restart_allowed!==false)
    fail('INSTALL_DIRECT_EXIT_EVIDENCE_MISMATCH');
  const held=inspectHold({dir,nodeId:node.node_id});
  if(!held.active||held.plan_id!==scope.plan_id||
     held.wave_id!==scope.wave_id||
     held.offer_sha256!==scope.offer_sha256)
    fail('INSTALL_DIRECT_EXIT_LOCAL_HOLD_CHANGED');
  return Object.freeze({observed:true,
    direct_process_pid:payload.direct_process_pid,
    direct_process_exit_code:payload.direct_process_exit_code,
    direct_process_exit_signal:payload.direct_process_exit_signal,
    installer_completion_proven:false,
    elevated_process_chain_verified:false,
    local_hold_release_allowed:false,
    automatic_retry_allowed:false,agent_restart_allowed:false});
}
/**
 * Trusted UI inspection uses the ORIGINAL OS-vault-signed execution chain.
 * No on-disk filename or unsigned JSON determines which grant was launched.
 */
function inspectDirectExitFromJournals({dir,node,agentIds,observedVersion}={}){
  const {inspectPreparedIdentity}=require('./maintenance-install-preparation.cjs');
  const {jsonFile,verifySigned}=require('./maintenance-postinstall-verification.cjs');
  const baseline=inspectPreparedIdentity({dir,node,agentIds,observedVersion});
  if(baseline.identity_preserved!==true)
    fail('INSTALL_DIRECT_EXIT_DEVICE_IDENTITY_CHANGED');
  const attempt=verifySigned(
    jsonFile(path.join(dir,'installer-execution-attempt.json')),node,
    'SUTRADHAR_INSTALL_EXECUTION_V1\n');
  const launched=verifySigned(
    jsonFile(path.join(dir,'installer-execution-launch-observed.json')),node,
    'SUTRADHAR_INSTALL_EXECUTION_V1\n');
  if(attempt.state!=='EXECUTION_ATTEMPT_OWNER_REVIEW_REQUIRED'||
     launched.state!=='WINDOWS_INSTALLER_PROCESS_STARTED_UNVERIFIED'||
     attempt.node_id!==node.node_id||launched.node_id!==node.node_id||
     launched.grant_id!==attempt.grant_id||
     launched.installer_sha256!==attempt.installer_sha256||
     launched.kind!==attempt.kind||
     launched.target_version!==attempt.target_version||
     launched.installer_installation_verified!==false||
     attempt.installer_installation_verified!==false||
     attempt.automatic_retry_allowed!==false||
     launched.automatic_retry_allowed!==false)
    fail('INSTALL_DIRECT_EXIT_EXECUTION_CHAIN_MISMATCH');
  const evidence=inspectDirectExit({dir,node,scope:{
    node_id:attempt.node_id,plan_id:attempt.plan_id,
    wave_id:attempt.wave_id,offer_sha256:attempt.offer_sha256,
    installer_sha256:attempt.installer_sha256,grant_id:attempt.grant_id,
    target_version:attempt.target_version,kind:attempt.kind}});
  if(evidence.observed&&(
     !Number.isSafeInteger(launched.direct_process_pid)||
     launched.direct_process_pid!==evidence.direct_process_pid))
    fail('INSTALL_DIRECT_EXIT_SIGNED_LAUNCH_PID_MISMATCH');
  return evidence;
}

module.exports={createDirectExitTracker,inspectDirectExit,inspectDirectExitFromJournals};
