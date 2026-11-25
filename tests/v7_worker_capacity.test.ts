import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProjectCapacity} from '../v7/worker_capacity.ts';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {validateCapacity,inspectProjectCapacity}=require('../apps/desktop/master-capacity.cjs');
const master='agent_master',projectId='project_alpha',epoch=5;
const row=(patch:any={})=>({agent_id:'agent_worker',node_id:'node_alpha',agent_state:'APPROVED',node_state:'APPROVED',
  status:'IDLE',can_develop:1,maintenance_fenced:0,has_live_work_lease:0,has_active_task:0,
  has_unreconciled_git_job:0,agent_age_ms:1000,node_age_ms:1000,...patch});
const assess=(rows:any[],backups:(string|null)[]=['agent_backup1','agent_backup2'])=>assessProjectCapacity({rows,master,backups});
const response=(rows:any[])=>({schema:'SUTRADHAR_PROJECT_CAPACITY_V1',read_only:true,agent_id:master,project_id:projectId,epoch,
  observed_at_ms:Date.now(),...assess(rows)});
const validate=(r:any)=>validateCapacity(r,{agentId:master,projectId,epoch});
for(const [field,value,blocker] of [
  ['can_develop',0,'PROJECT_DEVELOPMENT_NOT_GRANTED'],['agent_state','PENDING','AGENT_NOT_APPROVED'],
  ['agent_state','REVOKED','AGENT_NOT_APPROVED'],['node_state','PENDING','NODE_NOT_APPROVED'],
  ['node_state','REVOKED','NODE_NOT_APPROVED'],['maintenance_fenced',1,'NODE_MAINTENANCE_FENCED'],
  ['agent_age_ms',null,'AGENT_HEARTBEAT_NOT_FRESH'],['agent_age_ms',-1,'AGENT_HEARTBEAT_NOT_FRESH'],
  ['agent_age_ms',180000,'AGENT_HEARTBEAT_NOT_FRESH'],['agent_age_ms',180001,'AGENT_HEARTBEAT_NOT_FRESH'],
  ['node_age_ms',null,'NODE_HEARTBEAT_NOT_FRESH'],['node_age_ms',-1,'NODE_HEARTBEAT_NOT_FRESH'],
  ['node_age_ms',180000,'NODE_HEARTBEAT_NOT_FRESH'],['node_age_ms',180001,'NODE_HEARTBEAT_NOT_FRESH'],
  ['status','BUSY','AGENT_NOT_IDLE'],['status','BLOCKED','AGENT_NOT_IDLE'],['status','ONLINE','AGENT_NOT_IDLE'],
  ['status','UNKNOWN','AGENT_NOT_IDLE'],['has_live_work_lease',1,'LIVE_WORK_LEASE'],
  ['has_active_task',1,'ACTIVE_TASK_LEDGER'],['has_unreconciled_git_job',1,'UNRECONCILED_GIT_JOB'],
  ['agent_id',master,'LEADERSHIP_RESERVED'],['agent_id','agent_backup1','LEADERSHIP_RESERVED'],
  ['agent_id','agent_backup2','LEADERSHIP_RESERVED'],['agent_id','AGENT_MASTER','LEADERSHIP_RESERVED']
] as const){
  test('capacity blocker '+field+' '+String(value),()=>{
    const r=response([row({[field]:value})]);
    assert.deepEqual(r.workers[0].blockers,[blocker]);assert.equal(r.observed_candidate_count,0);
    assert.equal(validate(r),r);
  });
}
for(const age of [0,1,60000,179999])test('fresh heartbeat boundary '+age,()=>{
  const r=response([row({agent_age_ms:age,node_age_ms:age})]);assert.equal(r.observed_candidate_count,1);
  assert.equal(validate(r),r);assert.equal(r.automatic_assignment_allowed,false);
});
for(const [field,value] of [['can_develop',2],['maintenance_fenced',null],['has_live_work_lease','0'],
  ['has_active_task',undefined],['has_unreconciled_git_job',-1],['agent_age_ms',1.5],['node_age_ms','10'],
  ['agent_state','UNKNOWN'],['node_state','UNKNOWN'],['agent_id','../bad'],['node_id','bad\n']] as const){
  test('malformed DB row '+field,()=>assert.throws(()=>assess([row({[field]:value})]),/CAPACITY_LEDGER_INVALID/));
}
test('same node is counted once without assuming hardware slots',()=>{
  const r=response([row(),row({agent_id:'agent_other'}),row({agent_id:'agent_third',node_id:'node_beta'})]);
  assert.equal(r.observed_candidate_count,3);assert.equal(r.observed_candidate_node_count,2);
  assert.equal(r.hardware_capacity_verified,false);assert.equal(validate(r),r);
});
test('empty and capped reports are explicit',()=>{
  const empty=response([]);assert.equal(empty.observed_candidate_count,0);assert.equal(validate(empty),empty);
  const r=response(Array.from({length:101},(_,i)=>row({agent_id:'agent_'+i})));
  assert.equal(r.observed_agent_count,100);assert.equal(r.truncated,true);assert.equal(validate(r),r);
});
test('duplicate case aliases and leadership role overlap refused',()=>{
  assert.throws(()=>assess([row(),row({agent_id:'AGENT_WORKER'})]),/CAPACITY_LEDGER_INVALID/);
  assert.throws(()=>assess([],['AGENT_MASTER',null]),/CAPACITY_LEDGER_INVALID/);
});
for(const [key,value] of Object.entries({agent_id:'agent_other',project_id:'project_other',epoch:6,read_only:false,
  automatic_assignment_allowed:true,automatic_execution_allowed:true,hardware_capacity_verified:true,
  provider_capacity_verified:true,task_claimability_verified:true,observed_candidate_count:2,
  observed_agent_count:2,observed_candidate_node_count:2,truncated:true,observed_at_ms:0,extra:true})){
  test('Desktop rejects incorrect '+key,()=>assert.throws(()=>validate({...response([row()]),[key]:value}),/RESPONSE_INVALID/));
}
test('Desktop rejects optimistic stale candidate',()=>{
  const r=response([row()]);r.workers[0].agent_heartbeat_age_ms=180000;
  assert.throws(()=>validate(r),/RESPONSE_INVALID/);
});
test('Desktop rejects unrecognized or duplicate blocker',()=>{
  for(const blockers of [['INVENTED'],['LIVE_WORK_LEASE','LIVE_WORK_LEASE']]){
    const r=response([row()]);Object.assign(r.workers[0],{blockers,candidate_for_manual_review:false});
    assert.throws(()=>validate(r),/RESPONSE_INVALID/);
  }
});
test('signed capacity client uses fixed read-only routes and no credentials',async()=>{
  const calls:any[]=[];
  const signer={sign:()=>({'x-test':'state'}),signWorkerAction:({payload}:any)=>({uri:'/v7/tasks/plan-batch/capacity',headers:{'x-test':'capacity'},body:JSON.stringify(payload)})};
  const fetcher=async(url:string,init:any)=>{calls.push({url,init});return new Response(JSON.stringify(calls.length===1?
    {phase:'READY',paused:false,master_agent_id:master,epoch}:response([row()])),{headers:{'content-type':'application/json'}});};
  const r=await inspectProjectCapacity({origin:'https://central.example.com',agentId:master,projectId,signer,fetcher});
  assert.equal(r.observed_candidate_count,1);assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>[c.url,c.init.method,c.init.credentials,c.init.redirect]),[
    ['https://central.example.com/v7/cluster/state','GET','omit','error'],
    ['https://central.example.com/v7/tasks/plan-batch/capacity','POST','omit','error']]);
});
