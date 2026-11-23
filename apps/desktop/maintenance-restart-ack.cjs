/**
 * Observe a NEW accepted Central heartbeat after a ONE-TIME Owner restart.
 * A running process alone is never proof of successful reconciliation.
 * Audit receipt is local evidence, not a signed Central attestation.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readStableLocalFile}=require('./os-vault.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const NODE=/^node_[0-9a-f]{32}$/;
function fail(code){throw Error(code);}
function inspectFreshAck(raw,{nodeId,agentIds,epoch,startedAtMs,now=Date.now()}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     raw.node_id!==nodeId||raw.connection!=='ACKNOWLEDGED'||
     raw.epoch!==epoch||raw.phase!=='READY'||
     !ID.test(raw.master_agent_id||'')||
     !Array.isArray(raw.backups)||raw.backups.length!==2||
     raw.backups.some(x=>!ID.test(x))||
     new Set([raw.master_agent_id,...raw.backups]).size!==3||
     !Array.isArray(raw.agent_ids)||raw.agent_ids.length!==agentIds.length||
     new Set(raw.agent_ids).size!==agentIds.length||
     raw.agent_ids.some(x=>!agentIds.includes(x))||
     agentIds.some(x=>[raw.master_agent_id,...raw.backups].includes(x)))
    return false;
  const observed=Date.parse(raw.observed_at||'');
  const accepted=Date.parse(raw.last_accepted_at||'');
  return Number.isFinite(observed)&&Number.isFinite(accepted)&&
    observed>=startedAtMs&&accepted>=startedAtMs-10000&&
    observed<=now+60000&&accepted<=now+60000;
}
async function waitForFreshAck({dir,nodeId,agentIds,epoch,startedAtMs,
  isChildActive,timeoutMs=75000,pollMs=1000,readStatus}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!NODE.test(nodeId||'')||
     !Array.isArray(agentIds)||agentIds.some(x=>!ID.test(x))||
     !Number.isSafeInteger(epoch)||epoch<1||
     !Number.isSafeInteger(startedAtMs)||startedAtMs<0||
     typeof isChildActive!=='function'||!Number.isSafeInteger(timeoutMs)||
     timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(pollMs)||
     pollMs<1||pollMs>5000)
    fail('MAINTENANCE_RESTART_ACK_ARGUMENTS_INVALID');
  const file=path.join(dir,'status.json');
  const get=readStatus||(()=>{
    // A genuinely absent snapshot may be retried while the child starts.
    // A dangling symlink or changed/insecure snapshot is corrupt evidence.
    try{fs.lstatSync(file);}
    catch(error){
      if(error?.code==='ENOENT')return null;
      fail('MAINTENANCE_RESTART_ACK_FILE_UNSAFE');
    }
    try{
      const bytes=readStableLocalFile(file,{minBytes:35,maxBytes:4096});
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    }catch{fail('MAINTENANCE_RESTART_ACK_FILE_UNSAFE');}
  });
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(!isChildActive())return {confirmed:false,reason:'CHILD_EXITED_OWNER_REVIEW'};
    let data;
    try{data=get();}catch{
      return {confirmed:false,reason:'STATUS_CORRUPT_OWNER_REVIEW'};
    }
    if(inspectFreshAck(data,{nodeId,agentIds,epoch,startedAtMs}))
      return {confirmed:true,node_id:nodeId,epoch,
        last_accepted_at:data.last_accepted_at,
        observed_at:data.observed_at,installer_execution_allowed:false};
    await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,
      Math.max(1,deadline-Date.now()))));
  }
  return {confirmed:false,reason:'ACK_TIMEOUT_OWNER_REVIEW'};
}
function recordFreshAck({dir,nodeId,grantId,ack}={}){
  if(!NODE.test(nodeId||'')||!/^[0-9a-f]{64}$/.test(grantId||'')||
     !ack?.confirmed||ack.node_id!==nodeId)
    fail('MAINTENANCE_RESTART_ACK_RECORD_INVALID');
  const file=path.join(dir,'maintenance-restart-ack.json');
  const record={schema:1,state:'HEARTBEAT_ACK_OBSERVED',
    node_id:nodeId,restart_grant_id:grantId,epoch:ack.epoch,
    last_accepted_at:ack.last_accepted_at,observed_at:ack.observed_at,
    automatic_restart_allowed:false,installer_executed:false};
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return {recorded:true,central_ack_observed:true,
    automatic_restart_allowed:false,installer_executed:false};
}
module.exports={inspectFreshAck,waitForFreshAck,recordFreshAck};
