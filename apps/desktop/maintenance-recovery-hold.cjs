/**
 * Local crash-persistent maintenance HOLD. Never installs, updates, rolls back,
 * or grants permission. Presence of this file fences local agent autostart.
 * Recovery of a hold requires Owner review; no automatic deletion.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const NODE=/^node_[0-9a-f]{32}$/;
const HEX=/^[0-9a-f]{64}$/;
const PLAN=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const NAME='maintenance-recovery-hold.json';
function fail(code){throw Error(code);}
function location(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    fail('MAINTENANCE_HOLD_PATH_INVALID');
  if(!fs.existsSync(dir))fail('MAINTENANCE_HOLD_NODE_DIRECTORY_ABSENT');
  const stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    fail('MAINTENANCE_HOLD_NODE_DIRECTORY_INVALID');
  return path.join(dir,NAME);
}
function validate(x){
  if(!x||typeof x!=='object'||Array.isArray(x)||
     Object.keys(x).sort().join('|')!==
       'created_at_ms|installer_execution_allowed|node_id|offer_sha256|owner_release_allowed|plan_id|schema|state|wave_id'||
     x.schema!==1||x.state!=='OWNER_REVIEW_REQUIRED'||x.installer_execution_allowed!==false||
     x.owner_release_allowed!==false||!NODE.test(x.node_id)||!PLAN.test(x.plan_id)||
     !/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(x.wave_id)||!HEX.test(x.offer_sha256)||
     !Number.isSafeInteger(x.created_at_ms)||x.created_at_ms<0)
    fail('MAINTENANCE_HOLD_RECORD_INVALID');
  return x;
}
function inspectHold({dir,nodeId}){
  const file=location(dir);
  if(!fs.existsSync(file))return Object.freeze({active:false,agent_start_allowed:true});
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>4096)
    fail('MAINTENANCE_HOLD_FILE_INVALID');
  let record;
  try{record=validate(JSON.parse(fs.readFileSync(file,'utf8')));}
  catch{fail('MAINTENANCE_HOLD_CORRUPT_OWNER_REVIEW_REQUIRED');}
  if(typeof nodeId==='string'&&record.node_id!==nodeId)
    fail('MAINTENANCE_HOLD_IDENTITY_MISMATCH');
  return Object.freeze({active:true,agent_start_allowed:false,
    status:record.state,node_id:record.node_id,plan_id:record.plan_id,
    wave_id:record.wave_id,owner_release_allowed:false,installer_execution_allowed:false});
}
function createHold({dir,nodeId,planId,waveId,offerSha256,now=Date.now()}){
  const file=location(dir);
  const record=validate({schema:1,state:'OWNER_REVIEW_REQUIRED',
    installer_execution_allowed:false,owner_release_allowed:false,
    node_id:nodeId,plan_id:planId,wave_id:waveId,offer_sha256:offerSha256,
    created_at_ms:now});
  // Check what is already on disk; an interrupted or corrupted record must
  // not be overwritten, even if its state is partially written.
  if(fs.existsSync(file)){
    const observed=inspectHold({dir,nodeId});
    if(observed.plan_id!==planId||observed.wave_id!==waveId)
      fail('MAINTENANCE_HOLD_CONFLICT_OWNER_REVIEW_REQUIRED');
    return {created:false,active:true,agent_start_allowed:false};
  }
  const payload=JSON.stringify(record,null,2)+'\n';
  const fd=fs.openSync(file,'wx',0o600);
  try{
    fs.writeFileSync(fd,payload);
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  // Never rename over an existing file; a filesystem crash after wx could
  // retain a partial record. In that case inspectHold fails closed.
  return {created:true,active:true,agent_start_allowed:false};
}
module.exports={createHold,inspectHold,location};
