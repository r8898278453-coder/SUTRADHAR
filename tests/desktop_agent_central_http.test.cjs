'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {agentCentralRequest,MAX_AGENT_RESPONSE_BYTES,MAX_AGENT_RECOVERY_BYTES,
  requestLimit}=require('../apps/desktop/agent-central-http.cjs');
const origin='https://stage.example.com';
const headers={'x-sutradhar-node':'node_'+'a'.repeat(32),
  'x-sutradhar-nonce':'nonce_test','x-sutradhar-signature':'sig'};
const reply=(status,data)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'}});
test('signed heartbeat POST rejects redirects and ambient credentials and has strict bounded JSON',async()=>{
  assert.equal(MAX_AGENT_RESPONSE_BYTES,65536);
  assert.equal(MAX_AGENT_RECOVERY_BYTES,524288);
  let called=0;
  const packet='{"boot_id":"boot_test"}';
  const value=await agentCentralRequest({origin,method:'POST',
    uri:'/v7/nodes/heartbeat',headers,body:packet,
    fetcher:async(url,opts)=>{
      called++;
      assert.equal(url,origin+'/v7/nodes/heartbeat');
      assert.equal(opts.body,packet);
      assert.equal(opts.redirect,'error');
      assert.equal(opts.cache,'no-store');
      assert.equal(opts.credentials,'omit');
      assert.equal(opts.headers.Accept,'application/json');
      return reply(200,{epoch:7,server_received_at:'2026-11-23T00:00:00.000Z'});
    }});
  assert.equal(called,1);
  assert.equal(value.epoch,7);
});
test('oversize streamed or declared heartbeat response never becomes a signed ACK',async()=>{
  for(const factory of [
    ()=>reply(200,{epoch:7,padding:'x'.repeat(70000)}),
    ()=>new Response('{"epoch":7}',{headers:{'content-type':'application/json',
      'content-length':String(MAX_AGENT_RESPONSE_BYTES+1)}})
  ]){
    await assert.rejects(agentCentralRequest({origin,method:'POST',
      uri:'/v7/nodes/heartbeat',headers,body:'{}',fetcher:async()=>factory()}),
      /AGENT_CENTRAL_RESPONSE_TOO_LARGE/);
  }
});
test('recovery allows >64KiB and refuses a 512KiB oversize response',async()=>{
  assert.equal(requestLimit('GET','/v7/recovery'),MAX_AGENT_RECOVERY_BYTES);
  const medium={epoch:7,events:[{event_id:1,summary:'x'.repeat(90000)}]};
  const ok=await agentCentralRequest({origin,method:'GET',uri:'/v7/recovery',
    headers,fetcher:async()=>reply(200,medium)});
  assert.deepEqual(ok,medium);
  await assert.rejects(agentCentralRequest({origin,method:'GET',
    uri:'/v7/recovery',headers,fetcher:async()=>reply(200,{padding:'y'.repeat(524300)})}),
    /AGENT_CENTRAL_RESPONSE_TOO_LARGE/);
});
test('malformed status, HTML, array, missing stream, invalid UTF-8 fail closed',async()=>{
  const invalid=[
    new Response('error',{headers:{'content-type':'text/html'}}),
    reply(200,[1,2,3]),
    {ok:true,headers:{get:()=>null},json:async()=>({epoch:1})},
    new Response(Buffer.from([0xc3,0x28]),{
      headers:{'content-type':'application/json'}}),
    new Response('{broken',{headers:{'content-type':'application/json'}})
  ];
  for(const value of invalid)
    await assert.rejects(agentCentralRequest({origin,method:'GET',
      uri:'/v7/nodes/me',headers,fetcher:async()=>value}),
      /AGENT_CENTRAL_RESPONSE_INVALID/);
});
test('known 409 collision and 403 approval status retain narrow error semantics',async()=>{
  for(const [status,code] of [[409,'AGENT_ID_ALREADY_EXISTS'],[403,'NODE_NOT_APPROVED']]){
    await assert.rejects(agentCentralRequest({origin,method:'POST',
      uri:'/v7/agents/register',headers,body:'{}',
      fetcher:async()=>reply(status,{error_code:code})}),
    new RegExp(code));
  }
  await assert.rejects(agentCentralRequest({origin,method:'POST',
    uri:'/v7/agents/register',headers,body:'{}',
    fetcher:async()=>reply(500,{error_code:'INJECTED\r\nSECRET'})}),
    /HTTP_500/);
});
test('an unsupported route, GET body or invalid caller never sends a request',async()=>{
  let count=0;const fetcher=async()=>{count++;return reply(200,{accepted:true});};
  for(const args of [
    {uri:'/v7/owner/command',method:'POST',body:'{}'},
    {uri:'/v7/nodes/me?other=true',method:'GET'},
    {uri:'/v7/nodes/me',method:'GET',body:'{}'},
    {uri:'/v7/nodes/heartbeat',method:'POST',body:'{"x":'+('1'.repeat(20000))+'}'}
  ]){
    await assert.rejects(agentCentralRequest({origin,headers,fetcher,...args}),
      /AGENT_CENTRAL_/);
  }
  assert.equal(count,0);
});
test('network failures are deliberately sanitized',async()=>{
  await assert.rejects(agentCentralRequest({origin,method:'GET',
    uri:'/v7/recovery',headers,
    fetcher:async()=>{throw Error('never log my private host url');}}),
    /AGENT_CENTRAL_NETWORK_UNAVAILABLE/);
});
