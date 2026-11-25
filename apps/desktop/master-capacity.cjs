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

const {boundedCentralJson}=require('./bounded-central-json.cjs');
async function inspectProjectCapacity({origin,agentId,projectId,signer,fetcher=fetch,guard=()=>{}}){
  if(typeof origin!=='string'||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin)||!id(agentId)||!id(projectId))
    throw Error('WORKER_CAPACITY_INPUT_DENIED');
  const request=async(method,uri,headers,body)=>{
    guard();
    const response=await fetcher(origin+uri,{method,headers:{...headers,Accept:'application/json',
      ...(method==='POST'?{'content-type':'application/json'}:{})},body,
      cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await boundedCentralJson(response);
    if(!response.ok)throw Error('WORKER_CAPACITY_CENTRAL_REFUSED');
    guard();return data;
  };
  guard();
  const stateUri='/v7/cluster/state';
  const cluster=await request('GET',stateUri,signer.sign({kind:'node_api',method:'GET',uri:stateUri,body:''}));
  if(cluster.phase!=='READY'||cluster.paused!==false||cluster.master_agent_id!==agentId||
     !Number.isSafeInteger(cluster.epoch)||cluster.epoch<1)throw Error('WORKER_CAPACITY_MASTER_NOT_READY');
  guard();
  const payload={agent_id:agentId,project_id:projectId,expected_master_epoch:cluster.epoch};
  const packet=signer.signWorkerAction({operation:'plan-batch-capacity',agent_id:agentId,payload});
  if(packet.uri!=='/v7/tasks/plan-batch/capacity'||packet.body!==JSON.stringify(payload))
    throw Error('WORKER_CAPACITY_SIGNED_PACKET_INVALID');
  const report=await request('POST',packet.uri,packet.headers,packet.body);
  return validateCapacity(report,{agentId,projectId,epoch:cluster.epoch});
}
module.exports={validateCapacity,inspectProjectCapacity};

