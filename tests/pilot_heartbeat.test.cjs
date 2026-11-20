'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {captureHeartbeat,parseLastSeen}=
  require('../scripts/ops/pilot-heartbeat-capture.cjs');
const {audit}=require('../scripts/ops/pilot-heartbeat-audit.cjs');
const origin='https://stage.example.com',
  sha='a'.repeat(40),now=Date.parse('2026-11-20T13:30:00Z');
const ids=['node_'+'1'.repeat(32),'node_'+'2'.repeat(32),'node_'+'3'.repeat(32)];
const agents=['agent_one','agent_two','agent_three'];
const key='trusted-ci-owner-key'.repeat(3);
function cluster(at=now,which=0){
  return {cluster:{master_agent_id:agents[0],backup1:agents[1],
    backup2:agents[2],epoch:9,phase:'READY'},
    agents:ids.map((node_id,i)=>({node_id,agent_id:agents[i],
      state:'APPROVED',node_state:'APPROVED',
      last_seen:new Date(at-25000).toISOString().replace(/Z$/,'')}))};
}
function opts({at=now,data=cluster(at),calls=[],redirect=false,
  oversized=false,privateDns=false}={}){
  return {origin,allowedHostname:'stage.example.com',
    expectedSha:sha,nodeIds:ids,adminKey:key,now:at,
    resolveHost:async()=>[{address:privateDns?'127.0.0.1':'8.8.8.8',family:4}],
    fetcher:async(url,request)=>{
      assert.equal(request.method,'GET');
      assert.equal(request.credentials,'omit');
      assert.equal(request.cache,'no-store');
      assert.equal(request.redirect,'error');
      assert.equal(request.headers.Authorization,'Bearer '+key);
      calls.push(new URL(url).pathname);
      if(redirect)return new Response('',{status:302,
        headers:{location:'http://127.0.0.1'}});
      const body=oversized?'X'.repeat(130*1024):JSON.stringify(
        url.endsWith('/health')?
          {service:'sutradhar-v7',ready:true,authority:'mysql',api_protocol:7}:data);
      return new Response(body,{status:200});
    }
  };
}
test('Central last_seen single sample uses only GET and never claims signed packets',async()=>{
  const calls=[],r=await captureHeartbeat(opts({calls}));
  assert.equal(r.accepted,true,JSON.stringify(r));
  assert.equal(r.agent_observations.length,3);
  assert.deepEqual(calls,['/v7/health','/v7/cluster']);
  assert.equal(r.signed_heartbeats_verified,false);
  assert.equal(r.node_key_possession_verified,false);
  assert.equal(r.production_release_authorized,false);
});
test('untrusted URL, private DNS, redirect, oversized JSON and stale agent fail closed',async()=>{
  for(const extra of [
    {allowedHostname:'other.example.com'},
    {expectedSha:'invalid'},
    {adminKey:'short'},
    {privateDns:true},
    {redirect:true},
    {oversized:true},
    {data:cluster(now-300000)}
  ]){
    const r=await captureHeartbeat({...opts(extra),...extra});
    assert.equal(r.accepted,false,JSON.stringify(extra));
  }
  assert.throws(()=>parseLastSeen('yesterday'));
  assert.equal(parseLastSeen(new Date(now).toISOString()),now);
});
function pulse(at){
  return {accepted:true,schema:1,mode:'OWNER_CENTRAL_ACKNOWLEDGED_HEARTBEAT_SAMPLE',
    source_sha_claim:sha,central_origin:origin,checked_node_ids:ids,
    measured_at_ms:at,
    master_agent_id:agents[0],master_node_id:ids[0],
    backup1:agents[1],backup1_node_id:ids[1],
    backup2:agents[2],backup2_node_id:ids[2],
    epoch:9,phase:'READY',
    agent_observations:ids.map((node_id,i)=>({
      node_id,agent_id:agents[i],last_seen_ms:at-20000})),
    signed_heartbeats_verified:false,node_key_possession_verified:false,
    physical_machine_verified:false,production_release_authorized:false,
    read_only:true};
}
function series(){
  return Array.from({length:4},(_,i)=>pulse(now-4*60000+i*60000));
}
const run=(samples=series())=>audit({samples,
  expectedSha:sha,expectedNodeIds:ids,expectedOrigin:origin,now});
test('four successive 60-second central timestamp observations pass narrow policy only',()=>{
  const r=run();
  assert.equal(r.accepted,true,JSON.stringify(r));
  assert.equal(r.sample_count,4);
  assert.equal(r.central_heartbeat_cadence_observed,true);
  assert.equal(r.signed_heartbeats_verified,false);
  assert.equal(r.physical_machine_verified,false);
  assert.equal(r.production_release_authorized,false);
});
test('unchanged or skipped heartbeat and irregular polling timestamps are rejected',()=>{
  const unchanged=series();unchanged[2].agent_observations[1].last_seen_ms=
    unchanged[1].agent_observations[1].last_seen_ms;
  assert.equal(run(unchanged).accepted,false);
  const skip=series();skip[2].measured_at_ms+=120000;
  assert.equal(run(skip).accepted,false);
  const early=series();early[3].measured_at_ms-=30000;
  assert.equal(run(early).accepted,false);
});
test('changed epoch/Master, ghost PC and duplicate agent cannot masquerade as cadence',()=>{
  const changes=[
    p=>{p[2].epoch++;},
    p=>{p[3].master_agent_id='agent_other';},
    p=>{p[2].agent_observations[1].node_id=ids[0];},
    p=>{p[2].agent_observations.push({...p[2].agent_observations[0]});},
    p=>{p[1].phase='RECOVERING';},
    p=>{p[0].source_sha_claim='f'.repeat(40);},
    p=>{p[0].signed_heartbeats_verified=true;}
  ];
  for(const change of changes){
    const readings=series();change(readings);
    assert.equal(run(readings).accepted,false);
  }
});
test('expired readings, too few samples, changed node list, changed agent identity denied',()=>{
  assert.equal(run(series().slice(0,2)).accepted,false);
  const stale=series();
  assert.equal(audit({samples:stale,expectedSha:sha,
    expectedNodeIds:ids,expectedOrigin:origin,now:now+24*3600000}).accepted,false);
  const different=series();different[3].checked_node_ids=[ids[0],ids[1]];
  assert.equal(run(different).accepted,false);
  const substitute=series();substitute[2].agent_observations[1].agent_id='agent_evil';
  assert.equal(run(substitute).accepted,false);
});
