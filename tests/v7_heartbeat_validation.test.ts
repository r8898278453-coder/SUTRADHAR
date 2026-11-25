import test from 'node:test';
import assert from 'node:assert/strict';
import {validSignedHeartbeat} from '../v7/heartbeat_validation.ts';

const good=()=>({boot_id:'boot_'+'a'.repeat(32),sequence:1,
  expected_master_epoch:null as number|null,agents:[
    {agent_id:'agent_one',sequence:1,status:'ONLINE'}
  ]});

test('signed heartbeat accepts only explicit safe numeric and role fields',()=>{
  assert.equal(validSignedHeartbeat(good()),true);
  assert.equal(validSignedHeartbeat({...good(),expected_master_epoch:0}),true);
  assert.equal(validSignedHeartbeat({...good(),expected_master_epoch:7,
    agents:[{agent_id:'agent_one',sequence:2,status:'IDLE'},
      {agent_id:'agent_two',sequence:1,status:'BUSY'},
      {agent_id:'agent_three',sequence:2,status:'BLOCKED'}]}),true);
});

test('signed malformed/coerced envelopes fail closed before database writes',()=>{
  const p=good();
  for(const packet of [
    null,[],{},'heartbeat',
    {...p,sequence:'1'}, {...p,sequence:true}, {...p,sequence:1.1},
    {...p,sequence:0}, {...p,sequence:Number.MAX_SAFE_INTEGER+1},
    {...p,boot_id:'../wrong'}, {...p,boot_id:42},
    {...p,expected_master_epoch:undefined},
    {...p,expected_master_epoch:'0'}, {...p,expected_master_epoch:true},
    {...p,expected_master_epoch:-1}, {...p,expected_master_epoch:1.5},
    {...p,expected_master_epoch:Number.MAX_SAFE_INTEGER+1},
    {...p,unexpected:true}, {...p,agents:[]},
    {...p,agents:null},
    {...p,agents:[{...p.agents[0],sequence:'1'}]},
    {...p,agents:[{...p.agents[0],sequence:0}]},
    {...p,agents:[{...p.agents[0],sequence:true}]},
    {...p,agents:[{...p.agents[0],status:'OFFLINE'}]},
    {...p,agents:[{...p.agents[0],extra:true}]},
    {...p,agents:[{...p.agents[0],agent_id:'..'}]},
    {...p,agents:[p.agents[0],{...p.agents[0]}]},
    {...p,agents:Array.from({length:31},(_,i)=>({
      agent_id:'agent_'+i,sequence:1,status:'ONLINE'
    }))}
  ])assert.equal(validSignedHeartbeat(packet),false,JSON.stringify(packet));
});
