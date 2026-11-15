import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMaintenanceIntent} from '../v7/maintenance.ts';
const epoch=10,nowMs=Date.parse('2026-11-15T12:00:00Z');
const cluster={epoch,phase:'READY',paused:0,master_agent_id:'agent_master',
  backup1:'agent_backup1',backup2:'agent_backup2',lease_until_ms:nowMs+120000};
const a=(agent_id:string)=>({agent_id,state:'APPROVED',status:'IDLE',
  active_ticket:null,heartbeat_age_seconds:9,has_live_work_lease:0,
  has_unreconciled_git_job:0});
const redundancy=['agent_master','agent_backup1','agent_backup2'].map(agent_id=>({
  agent_id,node_state:'APPROVED',state:'APPROVED',heartbeat_age_seconds:12}));
const healthy={cluster,agents:[a('agent_noncritical')],redundancy,expectedEpoch:epoch,nowMs};
const decide=(changes:Partial<typeof healthy>)=>checkMaintenanceIntent({...healthy,...changes});
test('Owner maintenance intent is permitted for one idle noncritical PC, not an installer lease',()=>{
  assert.deepEqual(decide({}),{accepted:true});
});
test('Maintenance intent rejects Master, both backups, missing redundancy and stale epochs',()=>{
  for(const role of ['agent_master','agent_backup1','agent_backup2'])
    assert.equal(decide({agents:[a(role)]}).error_code,'MAINTENANCE_ACTIVE_MASTER_OR_BACKUP');
  assert.equal(decide({expectedEpoch:epoch-1}).error_code,'MAINTENANCE_STALE_MASTER_EPOCH');
  assert.equal(decide({cluster:{...cluster,phase:'RECOVERING'}}).accepted,false);
  assert.equal(decide({cluster:{...cluster,paused:1}}).accepted,false);
  assert.equal(decide({cluster:{...cluster,lease_until_ms:nowMs-1}}).accepted,false);
  assert.equal(decide({cluster:{...cluster,backup2:null}}).accepted,false);
  assert.equal(decide({redundancy:redundancy.slice(0,2)}).accepted,false);
  assert.equal(decide({redundancy:[...redundancy.slice(0,2),
    {...redundancy[2],heartbeat_age_seconds:181}]}).accepted,false);
});
test('Maintenance intent rejects busy, stale or unreconciled target PC',()=>{
  for(const patch of [
    {state:'PENDING'},{status:'WORKING'}, {active_ticket:'ticket_unfinished'},
    {heartbeat_age_seconds:null},{heartbeat_age_seconds:181},
    {has_live_work_lease:1},{has_unreconciled_git_job:1}
  ]){
    const res=decide({agents:[{...a('agent_noncritical'),...patch}]});
    assert.equal(res.accepted,false,JSON.stringify(patch));
  }
});
