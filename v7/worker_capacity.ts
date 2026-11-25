// Advisory observation only; no claim, provider or execution authority.
export const CAPACITY_LIMIT=100;
export const CAPACITY_STALE_MS=180000;
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>=3&&x.length<=100&&/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(x)&&!/[\r\n]/.test(x);
const bit=(x:unknown):boolean=>{
  if(x===0||x===false)return false;
  if(x===1||x===true)return true;
  throw Error('CAPACITY_LEDGER_INVALID');
};
function age(value:unknown):number|null{
  if(value===null)return null;
  if(typeof value!=='number'||!Number.isSafeInteger(value))throw Error('CAPACITY_LEDGER_INVALID');
  return value;
}
export function assessProjectCapacity(input:{rows:any[],master:string,backups:(string|null)[]}){
  if(!id(input.master)||!Array.isArray(input.backups)||input.backups.length!==2||
    input.backups.some(b=>b!==null&&!id(b))||!Array.isArray(input.rows)||input.rows.length>CAPACITY_LIMIT+1)
    throw Error('CAPACITY_LEDGER_INVALID');
  const roles=[input.master,...input.backups.filter((b):b is string=>b!==null)].map(x=>x.toLowerCase());
  if(new Set(roles).size!==roles.length)throw Error('CAPACITY_LEDGER_INVALID');
  const seen=new Set<string>();
  const workers=input.rows.slice(0,CAPACITY_LIMIT).map(r=>{
    if(!r||!id(r.agent_id)||!id(r.node_id)||seen.has(r.agent_id.toLowerCase())||
       !['PENDING','APPROVED','REVOKED'].includes(r.agent_state)||
       !['PENDING','APPROVED','REVOKED'].includes(r.node_state)||
       typeof r.status!=='string'||r.status.length>40)
      throw Error('CAPACITY_LEDGER_INVALID');
    seen.add(r.agent_id.toLowerCase());
    const canDevelop=bit(r.can_develop),fenced=bit(r.maintenance_fenced);
    const liveLease=bit(r.has_live_work_lease),activeTask=bit(r.has_active_task),git=bit(r.has_unreconciled_git_job);
    const agentAge=age(r.agent_age_ms),nodeAge=age(r.node_age_ms);
    const reasons:string[]=[];
    if(!canDevelop)reasons.push('PROJECT_DEVELOPMENT_NOT_GRANTED');
    if(r.agent_state!=='APPROVED')reasons.push('AGENT_NOT_APPROVED');
    if(r.node_state!=='APPROVED')reasons.push('NODE_NOT_APPROVED');
    if(fenced)reasons.push('NODE_MAINTENANCE_FENCED');
    if(agentAge===null||agentAge<0||agentAge>=CAPACITY_STALE_MS)reasons.push('AGENT_HEARTBEAT_NOT_FRESH');
    if(nodeAge===null||nodeAge<0||nodeAge>=CAPACITY_STALE_MS)reasons.push('NODE_HEARTBEAT_NOT_FRESH');
    if(r.status!=='IDLE')reasons.push('AGENT_NOT_IDLE');
    if(liveLease)reasons.push('LIVE_WORK_LEASE');
    if(activeTask)reasons.push('ACTIVE_TASK_LEDGER');
    if(git)reasons.push('UNRECONCILED_GIT_JOB');
    if(roles.includes(r.agent_id.toLowerCase()))reasons.push('LEADERSHIP_RESERVED');
    return {agent_id:r.agent_id,node_id:r.node_id,agent_heartbeat_age_ms:agentAge,node_heartbeat_age_ms:nodeAge,
      candidate_for_manual_review:reasons.length===0,blockers:reasons};
  });
  const eligible=workers.filter(w=>w.candidate_for_manual_review);
  return {workers,truncated:input.rows.length>CAPACITY_LIMIT,observed_agent_count:workers.length,
    observed_candidate_count:eligible.length,observed_candidate_node_count:new Set(eligible.map(w=>w.node_id.toLowerCase())).size,
    provider_capacity_verified:false,hardware_capacity_verified:false,task_claimability_verified:false,
    automatic_assignment_allowed:false,automatic_execution_allowed:false};
}
