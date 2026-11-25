'use strict';
const fail=()=>{throw Error('WORKER_CAPACITY_RESPONSE_INVALID');};
const id=x=>typeof x==='string'&&x.length>=3&&x.length<=100&&/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(x)&&!/[\r\n]/.test(x);
const blockers=['PROJECT_DEVELOPMENT_NOT_GRANTED','AGENT_NOT_APPROVED','NODE_NOT_APPROVED','NODE_MAINTENANCE_FENCED',
  'AGENT_HEARTBEAT_NOT_FRESH','NODE_HEARTBEAT_NOT_FRESH','AGENT_NOT_IDLE','LIVE_WORK_LEASE','ACTIVE_TASK_LEDGER',
  'UNRECONCILED_GIT_JOB','LEADERSHIP_RESERVED'];
function validateCapacity(r,{agentId,projectId,epoch}){
  const keys='agent_id|automatic_assignment_allowed|automatic_execution_allowed|epoch|hardware_capacity_verified|observed_agent_count|observed_at_ms|observed_candidate_count|observed_candidate_node_count|project_id|provider_capacity_verified|read_only|schema|task_claimability_verified|truncated|workers';
  const age=x=>x===null||Number.isSafeInteger(x);
  const fresh=x=>Number.isSafeInteger(x)&&x>=0&&x<180000;
  if(!r||Object.keys(r).sort().join('|')!==keys||r.schema!=='SUTRADHAR_PROJECT_CAPACITY_V1'||
     r.read_only!==true||r.agent_id!==agentId||r.project_id!==projectId||r.epoch!==epoch||
     !Number.isSafeInteger(r.observed_at_ms)||r.observed_at_ms<=0||typeof r.truncated!=='boolean'||
     r.automatic_assignment_allowed!==false||r.automatic_execution_allowed!==false||
     r.hardware_capacity_verified!==false||r.provider_capacity_verified!==false||r.task_claimability_verified!==false||
     !Array.isArray(r.workers)||r.workers.length>100||(r.truncated&&r.workers.length!==100))fail();
  const seen=new Set();
  for(const w of r.workers){
    if(!w||Object.keys(w).sort().join('|')!=='agent_heartbeat_age_ms|agent_id|blockers|candidate_for_manual_review|node_heartbeat_age_ms|node_id'||
       !id(w.agent_id)||!id(w.node_id)||seen.has(w.agent_id.toLowerCase())||
       !age(w.agent_heartbeat_age_ms)||!age(w.node_heartbeat_age_ms)||!Array.isArray(w.blockers)||
       w.blockers.some(b=>!blockers.includes(b))||new Set(w.blockers).size!==w.blockers.length||
       w.candidate_for_manual_review!==(w.blockers.length===0)||
       (!fresh(w.agent_heartbeat_age_ms)!==w.blockers.includes('AGENT_HEARTBEAT_NOT_FRESH'))||
       (!fresh(w.node_heartbeat_age_ms)!==w.blockers.includes('NODE_HEARTBEAT_NOT_FRESH'))||
       (w.agent_id.toLowerCase()===agentId.toLowerCase()&&!w.blockers.includes('LEADERSHIP_RESERVED')))fail();
    seen.add(w.agent_id.toLowerCase());
  }
  const candidates=r.workers.filter(w=>w.candidate_for_manual_review);
  if(r.observed_agent_count!==r.workers.length||r.observed_candidate_count!==candidates.length||
     r.observed_candidate_node_count!==new Set(candidates.map(w=>w.node_id.toLowerCase())).size)fail();
  return r;
}
module.exports={validateCapacity};
