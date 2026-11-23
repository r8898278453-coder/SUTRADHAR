'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyCentralHealth}=require('../apps/desktop/central-health.cjs');
const origin='https://stage.example.com';
const healthy={service:'sutradhar-v7',ready:true,authority:'mysql',api_protocol:7};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,
  headers:{'content-type':'application/json'}});
test('first-run setup checks exact protocol, not deployment permission',async()=>{
  let calls=0;
  const out=await verifyCentralHealth({origin,expectedProtocol:7,
    fetcher:async(url,opts)=>{
      calls++;assert.equal(url,origin+'/v7/health');
      assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
      assert.equal(opts.cache,'no-store');assert.equal(opts.credentials,'omit');
      return response(healthy);
    }});
  assert.equal(calls,1);
  assert.equal(out.verified,true);
  assert.equal(out.owner_approval_verified,false);
  assert.equal(out.production_approved,false);
});
test('oversized, missing-stream and invalid-content-type Central health fail closed',async()=>{
  for(const fetcher of [
    async()=>response({padding:'x'.repeat(70000)}),
    async()=>({ok:true,json:async()=>healthy,headers:{get:()=>null}}),
    async()=>new Response('<html>unknown</html>',{headers:{'content-type':'text/html'}})
  ])await assert.rejects(verifyCentralHealth({origin,expectedProtocol:7,fetcher}),
    /response invalid or too large/);
});
test('unhealthy service, changed authority, protocol and rejected HTTP block setup',async()=>{
  for(const bad of [
    {...healthy,ready:false},{...healthy,authority:'sqlite'},
    {...healthy,service:'different'}
  ])await assert.rejects(verifyCentralHealth({origin,expectedProtocol:7,
    fetcher:async()=>response(bad)}),/not a ready SUTRADHAR/);
  await assert.rejects(verifyCentralHealth({origin,expectedProtocol:8,
    fetcher:async()=>response(healthy)}),/protocol mismatch/);
  await assert.rejects(verifyCentralHealth({origin,expectedProtocol:7,
    fetcher:async()=>response({error:'not ready'},503)}),/health check failed/);
  await assert.rejects(verifyCentralHealth({origin:'http://stage.example.com',
    expectedProtocol:7,fetcher:async()=>response(healthy)}),/HTTPS/);
});
