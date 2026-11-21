import test from 'node:test';
import assert from 'node:assert/strict';
import {permitSignedHeartbeatPilotRecord,
  PILOT_PACKET_MAX_RECORDS_PER_NODE,
  PILOT_PACKET_MAX_WINDOW_MS} from '../v7/pilot_heartbeat_window.ts';

const start=Date.parse('2026-11-21T10:00:00.000Z');
const args={enabled:'true',
  startsAt:new Date(start).toISOString(),
  endsAt:new Date(start+20*60_000).toISOString(),
  serverNowMs:start+60_000,rawBodyLength:100,
  existingNodeRecords:0};
const permit=(overrides:Record<string,unknown>={})=>
  permitSignedHeartbeatPilotRecord({...args,...overrides});

test('only explicit bounded owner UTC window allows evidence logging',()=>{
  assert.equal(permit(),true);
  assert.equal(permit({existingNodeRecords:63}),true);
  assert.equal(permit({enabled:false}),false);
  assert.equal(permit({enabled:'TRUE'}),false);
  assert.equal(permit({startsAt:undefined}),false);
  assert.equal(permit({endsAt:undefined}),false);
  assert.equal(permit({startsAt:'2026-11-21T10:00:00Z'}),false);
  assert.equal(permit({startsAt:'2026-11-35T10:00:00.000Z'}),false);
  assert.equal(permit({serverNowMs:start-1}),false);
  assert.equal(permit({serverNowMs:start+20*60_000}),false);
});
test('expiry longer than one hour, malformed windows and record cap fail closed',()=>{
  assert.equal(PILOT_PACKET_MAX_WINDOW_MS,3_600_000);
  assert.equal(PILOT_PACKET_MAX_RECORDS_PER_NODE,64);
  assert.equal(permit({endsAt:new Date(start+PILOT_PACKET_MAX_WINDOW_MS+1).toISOString()}),false);
  assert.equal(permit({endsAt:new Date(start).toISOString()}),false);
  assert.equal(permit({endsAt:new Date(start-1).toISOString()}),false);
  assert.equal(permit({existingNodeRecords:64}),false);
  assert.equal(permit({existingNodeRecords:-1}),false);
  assert.equal(permit({existingNodeRecords:1.5}),false);
  assert.equal(permit({existingNodeRecords:Infinity}),false);
});
test('oversize/empty bodies and non-integer times never enter pilot event store',()=>{
  for(const n of [0,1,19,8193,100000,-1,1.5,NaN,Infinity])
    assert.equal(permit({rawBodyLength:n}),false);
  assert.equal(permit({rawBodyLength:20}),true);
  assert.equal(permit({rawBodyLength:8192}),true);
  for(const t of [NaN,Infinity,1.5,'bad'])
    assert.equal(permit({serverNowMs:t}),false);
});
