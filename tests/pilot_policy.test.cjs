'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePilot,compareFailover}=require('../scripts/ops/pilot-policy.cjs');
const t=Date.parse('2026-11-12T12:00:00Z');
const at=new Date(t-30000).toISOString().replace(/Z$/,'');
const agent=(agent_id,node_id,last_seen=at)=>({agent_id,node_id,
  state:'APPROVED',node_state:'APPROVED',last_seen});
const before={cluster:{master_agent_id:'agent_a01',backup1:'agent_b01',backup2:'agent_c01',
  epoch:7,phase:'READY'},agents:[agent('agent_a01','pc_1'),agent('agent_b01','pc_2'),agent('agent_c01','pc_3')]};
test('Pilot refuses simulated or non-distinct PCs and stale agents',()=>{
  assert.equal(evaluatePilot(before,['pc_1','pc_2','pc_3'],t).accepted,true);
  assert.equal(evaluatePilot(before,['pc_1','pc_1'],t).accepted,false);
  assert.equal(evaluatePilot(before,['pc_1','pc_4'],t).accepted,false);
  const stale={...before,agents:[agent('agent_a01','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),agent('agent_b01','pc_2')]};
  assert.equal(evaluatePilot(stale,['pc_1','pc_2'],t).accepted,false);
  const colocated={...before,agents:[agent('agent_a01','pc_1'),agent('agent_b01','pc_1')]};
  assert.equal(evaluatePilot(colocated,['pc_1','pc_2'],t).accepted,false);
});
test('Failover exact Backup1 and epoch fencing uses real before/after receipts',()=>{
  const baselineTwo={cluster:{master_agent_id:'agent_a01',
    backup1:'agent_b01',backup2:null,epoch:7,phase:'READY'},
    agents:before.agents.slice(0,2)};
  const one=evaluatePilot(baselineTwo,['pc_1','pc_2'],t);
  assert.equal(one.accepted,true);
  const after={cluster:{master_agent_id:'agent_b01',backup1:null,backup2:null,
    epoch:8,phase:'RECOVERING'},agents:[agent('agent_a01','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),
    agent('agent_b01','pc_2')]};
  const two=evaluatePilot(after,['pc_1','pc_2'],t+10000,['pc_1']);
  assert.equal(two.accepted,true);
  assert.equal(compareFailover(one,two).accepted,true);
  assert.equal(compareFailover(one,{...two,epoch:9}).accepted,false);
  assert.equal(compareFailover(one,{...two,master_agent_id:'agent_c01'}).accepted,false);
});

test('Two-PC promotion can succeed with no remaining backup after Master goes offline',()=>{
  const initial={cluster:{master_agent_id:'agent_a01',backup1:'agent_b01',backup2:null,epoch:11,phase:'READY'},
    agents:[agent('agent_a01','pc_1'),agent('agent_b01','pc_2')]};
  const before=evaluatePilot(initial,['pc_1','pc_2'],t);
  assert.equal(before.accepted,true);
  const promoted={cluster:{master_agent_id:'agent_b01',backup1:null,backup2:null,epoch:12,phase:'RECOVERING'},
    agents:[agent('agent_a01','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),
      agent('agent_b01','pc_2')]};
  const after=evaluatePilot(promoted,['pc_1','pc_2'],t+10000,['pc_1']);
  assert.equal(after.accepted,true);
  assert.equal(compareFailover(before,after).accepted,true);
});


test('failover rejects reverted timestamp, wrong/offline PC, and incomplete same-set evidence',()=>{
  const base=evaluatePilot({cluster:{...before.cluster,backup2:null},
    agents:before.agents.slice(0,2)},['pc_1','pc_2'],t);
  assert.equal(base.accepted,true);
  const afterRaw={cluster:{master_agent_id:'agent_b01',backup1:null,
    backup2:null,epoch:8,phase:'RECOVERING'},agents:[
    agent('agent_a01','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),
    agent('agent_b01','pc_2')]};
  const current=evaluatePilot(afterRaw,['pc_1','pc_2'],t+10000,['pc_1']);
  assert.equal(current.accepted,true,JSON.stringify(current));
  assert.equal(compareFailover(base,current).accepted,true);
  assert.equal(compareFailover(base,{...current,measured_at_utc:base.measured_at_utc}).accepted,false);
  assert.equal(compareFailover(base,{...current,deliberately_offline_node_ids:['pc_2']}).accepted,false);
  assert.equal(compareFailover(base,{...current,checked_physical_node_ids:['pc_2']}).accepted,false);
  assert.equal(compareFailover(base,{...current,master_node_id:'pc_1'}).accepted,false);
  assert.equal(compareFailover(base,{...current,active_approved_nodes:['pc_1','pc_2']}).accepted,false);
});
test('cannot claim online expected PC as deliberately offline or add invalid/offline nodes',()=>{
  assert.equal(evaluatePilot(before,['pc_1','pc_2'],t,['pc_1']).accepted,false);
  assert.equal(evaluatePilot(before,['pc_1','pc_2'],t,['pc_9']).accepted,false);
  assert.equal(evaluatePilot(before,['pc_1','pc_2'],t,['pc_1','pc_2']).accepted,false);
  assert.equal(evaluatePilot(before,['pc_1','pc_2','pc_3','pc_4','pc_5','pc_6',
    'pc_7','pc_8','pc_9','pc_10','pc_11'],t).accepted,false);
});
test('three-PC failover accepts one fewer backup, still requires Backup2 successor',()=>{
  const baseline=evaluatePilot(before,['pc_1','pc_2','pc_3'],t);
  assert.equal(baseline.accepted,true);
  const updated={cluster:{master_agent_id:'agent_b01',backup1:'agent_c01',
    backup2:null,epoch:8,phase:'RECOVERING'},agents:[
    agent('agent_a01','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),
    agent('agent_b01','pc_2'),agent('agent_c01','pc_3')]};
  const after=evaluatePilot(updated,['pc_1','pc_2','pc_3'],t+10000,['pc_1']);
  assert.equal(after.accepted,true,JSON.stringify(after));
  assert.equal(compareFailover(baseline,after).accepted,true);
  assert.equal(compareFailover(baseline,{...after,backup1:'agent_rogue'}).accepted,false);
});
