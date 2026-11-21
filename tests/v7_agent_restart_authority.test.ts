import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExistingAgentOnOwnNode} from '../v7/agent_restart_authority.ts';
const node='node_'+'a'.repeat(32),
  other='node_'+'b'.repeat(32),
  agent='agent_one';
const sample={node_id:node,agents:[
  {agent_id:agent,state:'APPROVED',status:'BUSY'},
  {agent_id:'agent_two',state:'PENDING'}]};
const check=(value:unknown=sample,id=agent)=>
  verifyExistingAgentOnOwnNode(value,node,id);
test('same approved node-and-agent from signed Central owns duplicate ID',()=>{
  assert.equal(check(),true);
  assert.equal(check({...sample,agents:[{agent_id:agent,state:'APPROVED'}]}),true);
});
test('other-node duplicates and forged/malformed node listings cannot be adopted',()=>{
  for(const x of [
    {node_id:other,agents:sample.agents},
    {node_id:node,agents:[]},
    {node_id:node,agents:[{agent_id:'agent_else',state:'APPROVED'}]},
    {node_id:node,agents:[sample.agents[0],sample.agents[0]]},
    {node_id:node,agents:Array.from({length:31},()=>({agent_id:agent,state:'APPROVED'}))},
    {node_id:node,agents:null},null,[],{}
  ])assert.throws(()=>check(x));
});
test('pending/revoked agent must await independent Owner approval after restart',()=>{
  for(const state of ['PENDING','REVOKED',null,'READY',undefined]){
    const x={node_id:node,agents:[{agent_id:agent,state}]};
    assert.throws(()=>check(x),/AGENT_RESTART_APPROVAL_REQUIRED/);
  }
  assert.throws(()=>check(sample,'agent_two'),/AGENT_RESTART_APPROVAL_REQUIRED/);
});
test('invalid requested identity never passes stale cached Central response',()=>{
  for(const name of ['','../../evil','@admin','a',null,2])
    assert.throws(()=>verifyExistingAgentOnOwnNode(sample,node,name));
  for(const n of ['',other.toUpperCase(),null,3])
    assert.throws(()=>verifyExistingAgentOnOwnNode(sample,n,agent));
});
