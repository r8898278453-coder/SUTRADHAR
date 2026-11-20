'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {capture}=require('../scripts/ops/pilot-capture.cjs');
const now=Date.parse('2026-11-20T10:00:00Z');
const ids=['node_'+'a'.repeat(32),'node_'+'b'.repeat(32),'node_'+'c'.repeat(32)];
const names=['agent_first','agent_second','agent_third'];
const healthy=()=>({
  cluster:{master_agent_id:names[0],backup1:names[1],backup2:names[2],
    epoch:11,phase:'READY'},
  agents:ids.map((node_id,i)=>({node_id,agent_id:names[i],state:'APPROVED',
    node_state:'APPROVED',last_seen:new Date(now-25000).toISOString().replace(/Z$/,'')}))
});
function scenario({status=200,oversize=false,redirect=false,
  cluster=healthy(),count,seen=[]}={}){
  const fetcher=async(url,opts)=>{
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.cache,'no-store');
    assert.ok(opts.signal);
    assert.equal(opts.headers.Authorization,'Bearer '+'private-ci-fixture-key'.repeat(3));
    seen.push(new URL(url).pathname);
    if(redirect)return new Response('',{status:302,headers:{location:'http://127.0.0.1'}});
    const data=url.endsWith('/health')?
      {ready:true,authority:'mysql',api_protocol:7}:cluster;
    let json=JSON.stringify(data);
    if(oversize)json='a'.repeat(129*1024);
    return new Response(json,{status,
      headers:count?{'content-length':String(count)}:{}});
  };
  return {origin:'https://stage.example.com',allowedHostname:'stage.example.com',
    expectedSha:'f'.repeat(40),nodeIds:ids,offlineNodes:[],
    adminKey:'private-ci-fixture-key'.repeat(3),
    resolveHost:async()=>[{address:'8.8.8.8',family:4}],
    fetcher,now,seen};
}
test('read-only trusted pinned Central captures bounded approved three-PC snapshot',async()=>{
  const x=scenario(),r=await capture(x);
  assert.equal(r.accepted,true,JSON.stringify(r));
  assert.equal(r.capture_schema,1);
  assert.equal(r.capture_mode,'OWNER_READONLY_CENTRAL_PILOT');
  assert.equal(r.source_sha_claim,'f'.repeat(40));
  assert.equal(r.source_sha_verified,false);
  assert.equal(r.physical_machine_verified,false);
  assert.equal(r.production_release_authorized,false);
  assert.equal(r.owner_hostname_pinned,true);
  assert.equal(r.public_dns_prechecked,true);
  assert.deepEqual(x.seen,['/v7/health','/v7/cluster']);
});
test('unapproved URL, unpinned hostname or invalid node and SHA block BEFORE any HTTP',async()=>{
  const x=scenario();
  for(const patch of [
    {allowedHostname:''},{allowedHostname:'production.example.com'},
    {origin:'http://stage.example.com'},
    {origin:'https://stage.example.com:8443'},
    {origin:'https://stage.example.com/?x=1'},
    {origin:'https://user:pass@stage.example.com'},
    {origin:'https://stage.example.com/other'},
    {origin:'https://stage.example.com.evil.test'},
    {expectedSha:'too-short'}, {nodeIds:[ids[0],ids[0]]},
    {nodeIds:[ids[0],ids[1],ids[2],'not-a-node']},
    {offlineNodes:[ids[0],ids[1]]},{offlineNodes:['node_'+'d'.repeat(32)]},
    {adminKey:'not-a-real-api-key'}
  ]){
    const y=await capture({...x,...patch});
    assert.equal(y.accepted,false,JSON.stringify(patch));
  }
  assert.equal(x.seen.length,0);
});
test('private, mixed, reserved, or unresolved DNS blocks before HTTPS request',async()=>{
  const x=scenario();
  for(const resolveHost of [
    async()=>[],async()=>{throw Error('no DNS');},
    async()=>[{address:'127.0.0.1',family:4}],
    async()=>[{address:'169.254.169.254',family:4}],
    async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],
    async()=>[{address:'2001:db8::1234',family:6}]
  ]){
    const r=await capture({...x,resolveHost});
    assert.equal(r.accepted,false);
    assert.equal(r.production_release_authorized,false);
  }
  assert.equal(x.seen.length,0);
});
test('redirect, oversized stream, misleading content length and failed HTTP all block',async()=>{
  for(const patch of [
    {redirect:true},{oversize:true},{count:256000},{status:500}
  ]){
    const r=await capture(scenario(patch));
    assert.equal(r.accepted,false,JSON.stringify(patch));
    assert.equal(r.source_sha_verified,false);
  }
});
test('unverified Central role/heartbeat cannot be mistaken for a physical PASS',async()=>{
  const bad=healthy();
  bad.agents[0].last_seen=new Date(now-300000).toISOString().replace(/Z$/,'');
  const result=await capture(scenario({cluster:bad}));
  assert.equal(result.accepted,false);
  assert.equal(result.physical_machine_verified,false);
  assert.ok(result.failures.includes('NO_LIVE_MASTER'));
});
