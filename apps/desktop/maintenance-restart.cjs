/**
 * Prepare ONE manual Owner-authorized restart after maintenance hold archival.
 * This module never executes a process or installer. It persists an attempt
 * before the Electron caller can spawn a child, so crash/replay stays blocked.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validOrigin}=require('./update-readiness.cjs');
const {boundedCentralJson}=require('./bounded-central-json.cjs');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {verifyRestartGrant}=require('./maintenance-restart-grant.cjs');
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const HEX=/^[0-9a-f]{64}$/;
function fail(code){throw Error(code);}
function readRecord(file){
  let s,data;
  try{
    s=fs.lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink()||s.size<100||s.size>8192)
      fail('MAINTENANCE_RESTART_RECEIPT_UNSAFE');
    data=JSON.parse(fs.readFileSync(file,'utf8'));
  }catch{fail('MAINTENANCE_RESTART_RECEIPT_CORRUPT_OWNER_REVIEW');}
  if(!data||typeof data!=='object'||Array.isArray(data))
    fail('MAINTENANCE_RESTART_RECEIPT_CORRUPT_OWNER_REVIEW');
  return data;
}
function readReleased({dir,nodeId}){
  if(!NODE.test(nodeId||'')||!requiresReconciliation(dir))
    fail('MAINTENANCE_RESTART_RELEASE_BARRIER_REQUIRED');
  if(inspectHold({dir,nodeId}).active)
    fail('MAINTENANCE_RESTART_LOCAL_HOLD_STILL_ACTIVE');
  const names=fs.readdirSync(dir).filter(x=>/^maintenance-release-[0-9a-f]{64}\.json$/.test(x));
  if(names.length!==1)fail('MAINTENANCE_RESTART_AMBIGUOUS_RELEASE_RECEIPTS');
  const releaseId=names[0].slice('maintenance-release-'.length,-'.json'.length);
  const record=readRecord(path.join(dir,names[0]));
  const archived=readRecord(path.join(dir,'maintenance-recovery-hold.released.'+releaseId+'.json'));
  if(record.schema!==1||record.status!=='OWNER_RELEASE_REQUEST_RECORDED'||
     record.node_id!==nodeId||record.grant_id!==releaseId||
     record.central_cancellation_verified!==true||
     record.installer_executed!==false||record.automatic_restart!==false||
     archived.schema!==1||archived.state!=='OWNER_REVIEW_REQUIRED'||
     archived.node_id!==nodeId||archived.plan_id!==record.plan_id||
     archived.wave_id!==record.wave_id||
     archived.offer_sha256!==record.offer_sha256||
     archived.installer_execution_allowed!==false||
     archived.owner_release_allowed!==false||
     !HEX.test(record.offer_sha256||'')||
     !ID.test(record.plan_id||'')||
     !/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(record.wave_id||''))
    fail('MAINTENANCE_RESTART_RELEASE_EVIDENCE_MISMATCH');
  return Object.freeze({node_id:nodeId,plan_id:record.plan_id,
    wave_id:record.wave_id,offer_sha256:record.offer_sha256,grant_id:releaseId});
}
function validateCentralCancellation(d,r){
  return Boolean(d&&d.node_id===r.node_id&&d.plan_id===r.plan_id&&
    d.wave_id===r.wave_id&&d.offer_sha256===r.offer_sha256&&
    d.state==='CANCELLED'&&d.cancellation_verified===true&&
    d.any_active_fence===false&&d.any_active_maintenance_intent===false&&
    d.local_hold_release_allowed===false&&
    d.installer_execution_allowed===false&&d.recovery_requires_owner===true);
}
function validateCluster(d,agentIds){
  if(!d||!Number.isSafeInteger(d.epoch)||d.epoch<1||
     d.phase!=='READY'||d.paused!==false||
     !ID.test(d.master_agent_id||'')||!Array.isArray(d.backups)||
     d.backups.length!==2||d.backups.some(x=>!ID.test(x))||
     new Set([d.master_agent_id,...d.backups]).size!==3)
    fail('MAINTENANCE_RESTART_CLUSTER_UNHEALTHY');
  const roles=new Set([d.master_agent_id,...d.backups]);
  if(agentIds.some(id=>roles.has(id)))
    fail('MAINTENANCE_RESTART_ACTIVE_MASTER_OR_BACKUP');
}
function validateAgents(d,nodeId,agentIds){
  if(!d||d.node_id!==nodeId||!Array.isArray(d.agents)||
     d.agents.length!==agentIds.length)
    fail('MAINTENANCE_RESTART_NODE_AGENTS_MISMATCH');
  const seen=new Set();
  for(const a of d.agents){
    if(!a||!ID.test(a.agent_id||'')||seen.has(a.agent_id)||
       !agentIds.includes(a.agent_id)||a.state!=='APPROVED'||
       a.status!=='IDLE'||a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job))
      fail('MAINTENANCE_RESTART_AGENT_NOT_CLEARED');
    // Heartbeat may legitimately be stale after an Owner-approved shutdown.
    seen.add(a.agent_id);
  }
}
async function prepareManualRestart({dir,nodeId,agentIds,centralOrigin,
  signer,grantEnvelope,pinnedPublicKeyPem,fetcher=fetch,now=Date.now()}={}){
  const origin=validOrigin(centralOrigin);
  if(!NODE.test(nodeId||'')||!Array.isArray(agentIds)||
     agentIds.length<1||agentIds.length>4||
     agentIds.some(x=>!ID.test(x))||new Set(agentIds).size!==agentIds.length||
     !signer||typeof signer.sign!=='function')
    fail('MAINTENANCE_RESTART_LOCAL_IDENTITY_INVALID');
  const release=readReleased({dir,nodeId});
  const grant=verifyRestartGrant({envelope:grantEnvelope,pinnedPublicKeyPem,
    release,now});
  const attemptFile=path.join(dir,'maintenance-restart-attempt.json');
  if(fs.existsSync(attemptFile))
    fail('MAINTENANCE_RESTART_PREVIOUS_ATTEMPT_OWNER_REVIEW');
  const uri='/v7/nodes/maintenance/recovery/'+release.plan_id;
  async function read(uri){
    const headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!headers||headers['x-sutradhar-node']!==nodeId||
       typeof headers['x-sutradhar-nonce']!=='string'||
       typeof headers['x-sutradhar-signature']!=='string')
      fail('MAINTENANCE_RESTART_SIGNED_NODE_REQUIRED');
    let res,data;
    try{res=await fetcher(origin+uri,{method:'GET',
      headers:{...headers,Accept:'application/json'},
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(12000)});}
    catch{fail('MAINTENANCE_RESTART_CENTRAL_UNREACHABLE');}
    if(!res?.ok)fail('MAINTENANCE_RESTART_CENTRAL_DENIED');
    try{data=await boundedCentralJson(res);}
    catch(error){
      if(error?.message==='CENTRAL_JSON_TOO_LARGE')
        fail('MAINTENANCE_RESTART_CENTRAL_TOO_LARGE');
      fail('MAINTENANCE_RESTART_CENTRAL_MALFORMED');
    }
    return data;
  }
  const first=await read(uri);
  if(!validateCentralCancellation(first,release))
    fail('MAINTENANCE_RESTART_CANCELLATION_NOT_VERIFIED');
  const cluster=await read('/v7/cluster/state');
  validateCluster(cluster,agentIds);
  validateAgents(await read('/v7/nodes/me'),nodeId,agentIds);
  const afterCluster=await read('/v7/cluster/state');
  validateCluster(afterCluster,agentIds);
  if(afterCluster.epoch!==cluster.epoch||
     afterCluster.master_agent_id!==cluster.master_agent_id||
     afterCluster.backups.join('|')!==cluster.backups.join('|'))
    fail('MAINTENANCE_RESTART_CLUSTER_CHANGED');
  if(!validateCentralCancellation(await read(uri),release))
    fail('MAINTENANCE_RESTART_CANCELLATION_CHANGED');
  if(Date.now()>grant.expires_ms)
    fail('MAINTENANCE_RESTART_GRANT_EXPIRED_DURING_PREFLIGHT');
  const again=readReleased({dir,nodeId});
  if(JSON.stringify(again)!==JSON.stringify(release))
    fail('MAINTENANCE_RESTART_LOCAL_EVIDENCE_CHANGED');
  const intent={schema:1,state:'RESTART_ATTEMPT_REQUIRES_RECONCILIATION',
    node_id:nodeId,plan_id:release.plan_id,wave_id:release.wave_id,
    offer_sha256:release.offer_sha256,release_grant_id:release.grant_id,
    restart_grant_id:grant.grant_id,epoch:cluster.epoch,
    prepared_at_ms:Date.now(),installer_executed:false,
    automatic_restart_authorized:false};
  // Exclusive create is a durable one-shot marker. Incomplete write, process
  // crash, or network uncertainty requires Owner review; never auto-retry.
  const fd=fs.openSync(attemptFile,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(intent,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return Object.freeze({prepared:true,node_id:nodeId,
    grant_id:grant.grant_id,epoch:cluster.epoch,
    agent_start_authorized_once:true,automatic_restart_authorized:false,
    installer_execution_allowed:false,
    restart_receipt_persisted:true});
}
/**
 * Independent post-heartbeat Central confirmation. This does not remove the
 * durable barrier and never authorizes automatic retry after a child exit.
 */
async function confirmLiveCentral({nodeId,agentIds,centralOrigin,signer,
  epoch,fetcher=fetch}={}){
  const origin=validOrigin(centralOrigin);
  if(!NODE.test(nodeId||'')||!Array.isArray(agentIds)||
     agentIds.length<1||agentIds.length>4||
     agentIds.some(x=>!ID.test(x))||new Set(agentIds).size!==agentIds.length||
     !Number.isSafeInteger(epoch)||epoch<1||
     !signer||typeof signer.sign!=='function')
    fail('MAINTENANCE_RESTART_POST_ACK_IDENTITY_INVALID');
  async function read(uri){
    const headers=signer.sign({kind:'node_api',method:'GET',uri,body:''});
    if(!headers||headers['x-sutradhar-node']!==nodeId||
       typeof headers['x-sutradhar-nonce']!=='string'||
       typeof headers['x-sutradhar-signature']!=='string')
      fail('MAINTENANCE_RESTART_POST_ACK_SIGNING_INVALID');
    let response,data;
    try{response=await fetcher(origin+uri,{method:'GET',
      headers:{...headers,Accept:'application/json'},
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(12000)});}
    catch{fail('MAINTENANCE_RESTART_POST_ACK_CENTRAL_UNREACHABLE');}
    if(!response?.ok)
      fail('MAINTENANCE_RESTART_POST_ACK_CENTRAL_DENIED');
    try{data=await boundedCentralJson(response);}
    catch(error){
      if(error?.message==='CENTRAL_JSON_TOO_LARGE')
        fail('MAINTENANCE_RESTART_POST_ACK_RESPONSE_TOO_LARGE');
      fail('MAINTENANCE_RESTART_POST_ACK_RESPONSE_INVALID');
    }
    return data;
  }
  const me=await read('/v7/nodes/me');
  if(me.node_id!==nodeId||!Array.isArray(me.agents)||
     me.agents.length!==agentIds.length)
    fail('MAINTENANCE_RESTART_POST_ACK_NODE_MISMATCH');
  const found=new Set();
  for(const a of me.agents){
    if(!a||!ID.test(a.agent_id||'')||!agentIds.includes(a.agent_id)||
       found.has(a.agent_id)||a.state!=='APPROVED'||
       (a.status!=='IDLE'&&a.status!=='ONLINE')||
       a.active_ticket!==null||
       ![0,false].includes(a.has_live_work_lease)||
       ![0,false].includes(a.has_unreconciled_git_job)||
       a.heartbeat_age_seconds===null||
       !Number.isSafeInteger(Number(a.heartbeat_age_seconds))||
       Number(a.heartbeat_age_seconds)<0||Number(a.heartbeat_age_seconds)>120)
      fail('MAINTENANCE_RESTART_POST_ACK_AGENT_NOT_RECONCILED');
    found.add(a.agent_id);
  }
  const cluster=await read('/v7/cluster/state');
  validateCluster(cluster,agentIds);
  if(cluster.epoch!==epoch)
    fail('MAINTENANCE_RESTART_POST_ACK_EPOCH_CHANGED');
  const maintenance=await read('/v7/nodes/maintenance');
  if(maintenance.node_id!==nodeId||maintenance.intent!==null||
     maintenance.installer_execution_allowed!==false||
     maintenance.owner_maintenance_lease!==false)
    fail('MAINTENANCE_RESTART_POST_ACK_MAINTENANCE_REAPPEARED');
  return Object.freeze({reconciled:true,node_id:nodeId,epoch,
    all_local_agents_acknowledged:true,installer_execution_allowed:false,
    automatic_restart_allowed:false});
}

module.exports={readReleased,prepareManualRestart,confirmLiveCentral};
