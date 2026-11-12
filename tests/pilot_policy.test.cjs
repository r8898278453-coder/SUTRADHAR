'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePilot,compareFailover}=require('../scripts/ops/pilot-policy.cjs');
const t=Date.parse('2026-11-12T12:00:00Z');
const at=new Date(t-30000).toISOString().replace(/Z$/,'');
const agent=(agent_id,node_id,last_seen=at)=>({agent_id,node_id,
  state:'APPROVED',node_state:'APPROVED',last_seen});
const before={cluster:{master_agent_id:'a',backup1:'b',backup2:'c',
  epoch:7,phase:'READY'},agents:[agent('a','pc_1'),agent('b','pc_2'),agent('c','pc_3')]};
test('Pilot refuses simulated or non-distinct PCs and stale agents',()=>{
  assert.equal(evaluatePilot(before,['pc_1','pc_2','pc_3'],t).accepted,true);
  assert.equal(evaluatePilot(before,['pc_1','pc_1'],t).accepted,false);
  assert.equal(evaluatePilot(before,['pc_1','pc_4'],t).accepted,false);
  const stale={...before,agents:[agent('a','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),agent('b','pc_2')]};
  assert.equal(evaluatePilot(stale,['pc_1','pc_2'],t).accepted,false);
  const colocated={...before,agents:[agent('a','pc_1'),agent('b','pc_1')]};
  assert.equal(evaluatePilot(colocated,['pc_1','pc_2'],t).accepted,false);
});
test('Failover exact Backup1 and epoch fencing uses real before/after receipts',()=>{
  const one=evaluatePilot(before,['pc_1','pc_2'],t);
  const after={cluster:{master_agent_id:'b',backup1:'c',backup2:null,
    epoch:8,phase:'RECOVERING'},agents:[agent('a','pc_1',new Date(t-250000).toISOString().replace(/Z$/,'')),
    agent('b','pc_2'),agent('c','pc_3')]};
  const two=evaluatePilot(after,['pc_1','pc_2'],t,['pc_1']);
  assert.equal(two.accepted,true);
  assert.equal(compareFailover(one,two).accepted,true);
  assert.equal(compareFailover(one,{...two,epoch:9}).accepted,false);
  assert.equal(compareFailover(one,{...two,master_agent_id:'c'}).accepted,false);
});
