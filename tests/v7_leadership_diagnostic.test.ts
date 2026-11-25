import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLeadershipSafety} from '../v7/leadership_diagnostic.ts';

const clock=Date.parse('2026-11-21T10:00:00Z');
const member=(agent_id:string,node_id:string,last_seen_ms=clock)=>({
  agent_id,node_id,last_seen_ms,arrival_id:1,eligible:true
});
const cluster={
  epoch:8,phase:'READY',paused:false,bootstrapped:true,
  master_agent_id:'master',master_node_id:'node_1',
  master_lease_until_ms:clock+60000,backup1:'backup1',
  backup2:'backup2'
};
const missing={
  required:false,event_present:false,previous_master_agent_id:null,
  previous_master_node_id:null
};
const agents=[member('master','node_1'),member('backup1','node_2'),
  member('backup2','node_3')];
const binding={master:'node_1',backup1:'node_2',backup2:'node_3'};
const inspect=(partial:any={})=>inspectLeadershipSafety({
  cluster,missing,candidates:agents,roleNodes:binding,nowMs:clock,...partial
});

test('healthy observed Master is only a read-only snapshot, never release authority',()=>{
  const result=inspect();
  assert.deepEqual(result.reason_codes,[]);
  assert.equal(result.master_node_id,'node_1');
  assert.equal(result.approved_fresh_eligible_node_count,3);
  assert.equal(result.approved_fresh_independent_node_count,2);
  assert.equal(result.read_only,true);
  assert.equal(result.central_state_modified,false);
  assert.equal(result.automatic_promotion_allowed,false);
  assert.equal(result.restart_authorized,false);
  assert.equal(result.physical_machine_verified,false);
  assert.equal(result.production_release_authorized,false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE KEY'));
});

test('expired Master is observed, not promoted to healthy first Backup',()=>{
  const result=inspect({cluster:{...cluster,master_lease_until_ms:clock-100}});
  assert.equal(result.master_agent_id,'master');
  assert.equal(result.epoch,8);
  assert.ok(result.reason_codes.includes('MASTER_LEASE_EXPIRED_AWAITING_SIGNED_HEARTBEAT'));
  assert.equal(result.backup1,'backup1');
  assert.equal(result.automatic_promotion_allowed,false);
});

test('NO_MASTER with no audit binding explains the fail-closed safety hold',()=>{
  const result=inspect({cluster:{...cluster,phase:'NO_MASTER',
    master_agent_id:null,master_node_id:null,backup1:null,backup2:null,
    master_lease_until_ms:null},
    missing:{required:true,event_present:false,
      previous_master_agent_id:null,previous_master_node_id:null}});
  assert.deepEqual(result.reason_codes,['PREVIOUS_MASTER_IDENTITY_EVIDENCE_MISSING']);
  assert.equal(result.previous_master_missing_event_present,false);
  assert.equal(result.automatic_promotion_allowed,false);
});

test('same-PC agents cannot count toward a distinct successor',()=>{
  const samePc=inspect({cluster:{...cluster,phase:'NO_MASTER',
    master_agent_id:null,master_node_id:null,backup1:null,backup2:null},
    candidates:[member('old','node_1'),member('sibling','node_1')],
    missing:{required:true,event_present:true,
      previous_master_agent_id:'old',previous_master_node_id:'node_1'}});
  assert.ok(samePc.reason_codes.includes('WAITING_FOR_DISTINCT_APPROVED_NODE_HEARTBEAT'));
  assert.equal(samePc.approved_fresh_eligible_node_count,1);
  assert.equal(samePc.approved_fresh_independent_node_count,0);
  const withDistinct=inspect({cluster:{...cluster,phase:'NO_MASTER',
    master_agent_id:null,master_node_id:null,backup1:null,backup2:null},
    candidates:[member('old','node_1'),member('other','node_2')],
    missing:{required:true,event_present:true,
      previous_master_agent_id:'old',previous_master_node_id:'node_1'}});
  assert.ok(withDistinct.reason_codes.includes('AWAITING_SIGNED_HEARTBEAT_FOR_ELECTION'));
  assert.equal(withDistinct.automatic_promotion_allowed,false);
});

test('same-node or missing backup registration is an Owner warning, not an automated fix',()=>{
  const result=inspect({
    roleNodes:{master:'node_1',backup1:'node_1',backup2:'node_2'}});
  assert.ok(result.reason_codes.includes('BACKUP_NODE_ID_COLLISION_OR_BINDING_MISSING'));
  const noThird=inspect({cluster:{...cluster,backup2:null}});
  assert.ok(noThird.reason_codes.includes('FEWER_THAN_TWO_DISTINCT_BACKUP_NODES'));
});

test('INITIAL 08:00 IST gate and RECOVERING phase remain descriptive only',()=>{
  const morning=Date.parse('2026-11-21T02:00:00Z');
  const early=inspect({nowMs:morning,cluster:{
    ...cluster,epoch:0,bootstrapped:false,phase:'NO_MASTER',
    master_agent_id:null,master_node_id:null,backup1:null,backup2:null,
    master_lease_until_ms:null},candidates:[]});
  assert.ok(early.reason_codes.includes('INITIAL_ELECTION_WAIT_UNTIL_08_IST'));
  const recovering=inspect({cluster:{...cluster,phase:'RECOVERING'}});
  assert.ok(recovering.reason_codes.includes('MASTER_RECOVERY_RECONCILIATION_REQUIRED'));
  assert.equal(recovering.central_state_modified,false);
});

test('future-dated and stale heartbeat candidates do not inflate node-health count',()=>{
  const result=inspect({candidates:[member('master','node_1',clock-200000),
    member('futurist','node_2',clock+100000),
    member('backup1','node_3',clock-50000)]});
  assert.equal(result.approved_fresh_eligible_node_count,1);
  assert.ok(result.reason_codes.includes('MASTER_APPROVAL_OR_FRESH_HEARTBEAT_MISSING'));
});
