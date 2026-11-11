'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const cfg=require('../apps/desktop/desktop-config.cjs');
test('SUTRADHAR Desktop accepts only host-only HTTPS Central URLs',()=>{
  assert.equal(cfg.normalizeCentralUrl(' https://central.example.com/ '),'https://central.example.com');
  for(const bad of ['http://central.example.com','https://central.example.com/api',
    'https://central.example.com?token=abc','https://central.example.com#admin',
    'https://user:password@central.example.com','file:///etc/passwd',
    'javascript:alert(1)','https://localhost','https://central.example.com/x',
    '',null,[]]){
      assert.throws(()=>cfg.normalizeCentralUrl(bad),undefined,String(bad));
  }
});
test('friendly PC names validated and normalized',()=>{
  assert.equal(cfg.cleanPcName('  Office PC-01  '),'Office PC-01');
  for(const bad of ['', 'x', '<script>', 'a'.repeat(65), '\x00bye', null])
    assert.throws(()=>cfg.cleanPcName(bad));
});
test('generated agents are unique and cannot exceed safe per-PC ceiling',()=>{
  const one=cfg.agentIds(1),four=cfg.agentIds(4);
  assert.equal(one.length,1);assert.equal(four.length,4);
  assert.equal(new Set([...one,...four]).size,5);
  assert.deepEqual(cfg.validateAgentIds(four),four);
  for(const bad of [0,5,-1,'not-a-number',1.1,NaN])
    assert.throws(()=>cfg.agentIds(bad));
});
test('persisted settings cannot include malformed or cloned agent IDs',()=>{
  const x={centralUrl:'https://central.example.com',pcName:'PC 1',agentIds:['agent_aaa','agent_bbb']};
  assert.deepEqual(cfg.validateSettings(x),x);
  assert.throws(()=>cfg.validateSettings({...x,agentIds:['agent_aaa','agent_aaa']}));
  assert.throws(()=>cfg.validateSettings({...x,agentIds:['../../../bad']}));
  assert.throws(()=>cfg.validateSettings({...x,centralUrl:'http://central.example.com'}));
});
test('enrollment code is long, space-free and never derived from PC name',()=>{
  assert.equal(cfg.validateEnrollmentCode('a'.repeat(40)),'a'.repeat(40));
  for(const bad of ['short','a'.repeat(31),'a'.repeat(257),'abc def'.repeat(6),null])
    assert.throws(()=>cfg.validateEnrollmentCode(bad));
});

const {summarizeCentralReceipt}=require('../apps/desktop/status.cjs');
test('signed Central receipt is shown only while fresh, from same node and agent running',()=>{
  const now=Date.parse('2026-11-12T12:00:00Z');
  const detail={node_id:'node_abc',connection:'ACKNOWLEDGED',
    last_accepted_at:new Date(now-60_000).toISOString(),phase:'READY',
    master_agent_id:'agent_a'};
  const good=summarizeCentralReceipt(detail,'node_abc',true,now);
  assert.equal(good.acknowledgedNow,true);
  assert.equal(good.masterAgentId,'agent_a');
  assert.equal(summarizeCentralReceipt(detail,'node_abc',false,now).acknowledgedNow,false);
  assert.equal(summarizeCentralReceipt(detail,'node_other',true,now),null);
  assert.equal(summarizeCentralReceipt(detail,'node_abc',true,now+181000).acknowledgedNow,false);
  assert.equal(summarizeCentralReceipt({...detail,last_accepted_at:new Date(now+60000).toISOString()},
    'node_abc',true,now).acknowledgedNow,false);
});
test('blocked Master reconciliation does not erase a real accepted heartbeat',()=>{
  const now=Date.parse('2026-11-12T12:00:00Z');
  const base={node_id:'node_abc',last_accepted_at:new Date(now-15000).toISOString()};
  const blocked=summarizeCentralReceipt({...base,connection:'RECOVERY_BLOCKED',
    error_code:'TASK_RECONCILIATION_REQUIRED'},'node_abc',true,now);
  assert.equal(blocked.acknowledgedNow,true);
  assert.equal(blocked.recoveryBlocked,true);
  assert.equal(blocked.errorCode,'TASK_RECONCILIATION_REQUIRED');
  assert.equal(summarizeCentralReceipt({...base,connection:'NOT_ACKNOWLEDGED'},
    'node_abc',true,now).acknowledgedNow,false);
  assert.equal(summarizeCentralReceipt({...base,connection:'PENDING'},
    'node_abc',true,now).acknowledgedNow,false);
  assert.equal(summarizeCentralReceipt({node_id:'node_abc',connection:'ACKNOWLEDGED'},
    'node_abc',true,now).acknowledgedNow,false);
});
