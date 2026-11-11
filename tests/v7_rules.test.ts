import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseLeader,chooseBackups,firstElectionOpen,scopesOverlap,safeScope,LEASE_SECONDS,HEARTBEAT_SECONDS} from '../v7/rules.ts';
const day=Date.parse('2026-11-11T00:00:00Z');
const ts=(hour:number,minute=0)=>day+hour*3600000+minute*60000;
const candidate=(id:string,node:string,arrival:number,seen:number)=>({
  agent_id:id,node_id:node,arrival_id:arrival,last_seen_ms:seen,eligible:true
});
const empty={master_agent_id:null,lease_until_ms:null,bootstrapped:false,epoch:0,backup1:null,backup2:null};
test('v7 initial election opens at exactly 08:00 Asia/Kolkata',()=>{
  assert.equal(firstElectionOpen(ts(2,29)),false);
  assert.equal(firstElectionOpen(ts(2,30)),true);
  assert.equal(firstElectionOpen(ts(22,30)),false); // 04:00 following calendar day
});
test('v7 initial candidate before 08:00 is never elected',()=>{
  assert.equal(chooseLeader(empty,[candidate('first','n1',1,ts(2,29))],ts(2,29)),null);
});
test('v7 first eligible accepted arrival wins, uptime not used',()=>{
  const now=ts(2,31),arr=[candidate('late','n2',2,now),candidate('first','n1',1,now)];
  assert.equal(chooseLeader(empty,arr,now),'first');
});
test('v7 single healthy Master stays across all subsequent 8 AM times',()=>{
  const tomorrow=ts(2,30)+86400000;
  const ld={...empty,master_agent_id:'incumbent',lease_until_ms:tomorrow+50000,
    bootstrapped:true,epoch:35,backup1:'backup',backup2:null};
  assert.equal(chooseLeader(ld,[candidate('incumbent','n1',1,tomorrow),
    candidate('backup','n2',2,tomorrow)],tomorrow),'incumbent');
});
test('v7 expired Master promotes backup 1 before backup 2',()=>{
  const now=ts(4),ld={...empty,bootstrapped:true,epoch:7,
    master_agent_id:'master',lease_until_ms:now-1000,backup1:'b1',backup2:'b2'};
  const arr=[candidate('b2','n3',3,now),candidate('b1','n2',2,now),candidate('master','n1',1,now)];
  assert.equal(chooseLeader(ld,arr,now),'b1');
});
test('v7 backup 2 takes over when backup 1 is missing',()=>{
  const now=ts(4),ld={...empty,bootstrapped:true,epoch:4,
    master_agent_id:'master',lease_until_ms:now-1000,backup1:'b1',backup2:'b2'};
  const arr=[candidate('b1','n2',2,now-181000),candidate('b2','n3',3,now)];
  assert.equal(chooseLeader(ld,arr,now),'b2');
});
test('v7 rejects stale and revoked candidates',()=>{
  const now=ts(4);
  const old=candidate('old','n1',1,now-190000);
  const revoked={...candidate('bad','n2',2,now),eligible:false};
  assert.equal(chooseLeader({...empty,bootstrapped:true},[old,revoked],now),null);
});
test('v7 return of former Master does not preempt live successor',()=>{
  const now=ts(4),ld={...empty,bootstrapped:true,epoch:18,
    master_agent_id:'successor',lease_until_ms:now+100000,backup1:'former'};
  assert.equal(chooseLeader(ld,[candidate('former','n1',1,now),
    candidate('successor','n2',2,now)],now),'successor');
});
test('v7 backups prefer physically distinct machines',()=>{
  const now=ts(4),arr=[candidate('master','n1',1,now),candidate('a','n1',2,now),
    candidate('b','n2',3,now),candidate('c','n3',4,now)];
  assert.deepEqual(chooseBackups('master',arr,now),['b','c']);
});
test('v7 fills remaining backup with same PC if none other available',()=>{
  const now=ts(4),arr=[candidate('master','n1',1,now),candidate('a','n1',2,now)];
  assert.deepEqual(chooseBackups('master',arr,now),['a',null]);
});
test('v7 blocked pre-bootstrap election after midnight until 08:00 IST',()=>{
  const now=ts(20);
  assert.equal(chooseLeader(empty,[candidate('first','n1',1,now)],now),null); // 01:30 IST next day
});
test('v7 scope overlap blocks path prefix conflicts, not similar names',()=>{
  assert.equal(scopesOverlap('src/a.ts','src/a.ts'),true);
  assert.equal(scopesOverlap('src','src/a.ts'),true);
  assert.equal(scopesOverlap('src/a','src/ab'),false);
});
test('v7 scope validation excludes traversal, secrets, root and backslash',()=>{
  for(const s of ['/etc/passwd','../secret','.env','src/../secret','src//a','src\\x','node_modules/x','.git/config'])
    assert.equal(safeScope(s),false,s);
  for(const s of ['src/a.ts','contracts/auth/one.ts','components/Button.tsx'])
    assert.equal(safeScope(s),true,s);
});
test('v7 liveness cadence remains 60s / suspicion threshold 180s',()=>{
  assert.equal(HEARTBEAT_SECONDS,60);assert.equal(LEASE_SECONDS,180);
});
