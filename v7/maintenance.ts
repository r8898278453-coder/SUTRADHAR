/**
 * Pure Central maintenance intent guard (not installer authorization).
 *
 * The checks and short expiry are advisory/fenced; roles and leases can
 * change immediately. A future installer must acquire a dedicated,
 * independently reviewed maintenance lease and recheck in its own transaction.
 */
export type MaintenanceDecision={accepted:boolean;error_code?:string};
type Cluster={epoch:unknown;phase:unknown;paused:unknown;master_agent_id:unknown;
  backup1:unknown;backup2:unknown;lease_until_ms:unknown};
type Agent={agent_id:unknown;state:unknown;status:unknown;active_ticket:unknown;
  heartbeat_age_seconds:unknown;has_live_work_lease:unknown;
  has_unreconciled_git_job:unknown};
type Redundancy={agent_id:unknown;node_state:unknown;state:unknown;
  heartbeat_age_seconds:unknown};
const reject=(error_code:string):MaintenanceDecision=>({accepted:false,error_code});
const id=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(s);
const age=(s:unknown)=>s!==null&&s!==undefined&&
  Number.isSafeInteger(Number(s))&&Number(s)>=0&&Number(s)<=180;
export function checkMaintenanceIntent({
  cluster,agents,redundancy,expectedEpoch,nowMs
}:{
  cluster:Cluster;agents:Agent[];redundancy:Redundancy[];
  expectedEpoch:number;nowMs:number;
}):MaintenanceDecision{
  if(!cluster||!Number.isSafeInteger(expectedEpoch)||expectedEpoch<1||
    !Number.isSafeInteger(nowMs)||nowMs<=0||
    Number(cluster.epoch)!==expectedEpoch)
    return reject('MAINTENANCE_STALE_MASTER_EPOCH');
  if(cluster.phase!=='READY'||!(cluster.paused===0||cluster.paused===false)||
    !Number.isSafeInteger(Number(cluster.lease_until_ms))||
    Number(cluster.lease_until_ms)<=nowMs)
    return reject('MAINTENANCE_CLUSTER_UNAVAILABLE');
  const roleIds=[cluster.master_agent_id,cluster.backup1,cluster.backup2];
  if(roleIds.some(v=>!id(v))||new Set(roleIds).size!==3)
    return reject('MAINTENANCE_REDUNDANCY_INCOMPLETE');
  if(!Array.isArray(redundancy)||redundancy.length!==3||
    new Set(redundancy.map(a=>a.agent_id)).size!==3||
    redundancy.some(a=>!roleIds.includes(a.agent_id)||
      a.node_state!=='APPROVED'||a.state!=='APPROVED'||
      !age(a.heartbeat_age_seconds)))
    return reject('MAINTENANCE_REDUNDANCY_NOT_LIVE');
  if(!Array.isArray(agents)||agents.length<1||agents.length>4||
    new Set(agents.map(a=>a.agent_id)).size!==agents.length||
    agents.some(a=>!id(a.agent_id)||a.state!=='APPROVED'))
    return reject('MAINTENANCE_TARGET_AGENTS_INVALID');
  if(agents.some(a=>roleIds.includes(a.agent_id)))
    return reject('MAINTENANCE_ACTIVE_MASTER_OR_BACKUP');
  if(agents.some(a=>!age(a.heartbeat_age_seconds)))
    return reject('MAINTENANCE_TARGET_HEARTBEAT_STALE');
  if(agents.some(a=>a.status!=='IDLE'||a.active_ticket!==null||
    !(a.has_live_work_lease===0||a.has_live_work_lease===false)||
    !(a.has_unreconciled_git_job===0||a.has_unreconciled_git_job===false)))
    return reject('MAINTENANCE_TARGET_WORK_UNFINISHED');
  return {accepted:true};
}
