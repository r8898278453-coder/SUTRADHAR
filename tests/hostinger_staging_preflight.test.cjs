'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {preflight,target,publicAddress,MAX_BYTES}=
  require('../scripts/ops/hostinger-staging-preflight.cjs');
const sha='a'.repeat(40),host='stage.sutradhar.example.com';
const origin='https://'+host;
const publicDns=async()=>[{address:'8.8.8.8',family:4},
  {address:'2606:4700:4700::1111',family:6}];
function mock({wrongSha=false,healthReady=true,oversized=false,
  fingerprint=false,redirect=false,seen=[]}={}){
  return async(url,options)=>{
    const path=new URL(url).pathname;
    seen.push({url,options});
    if(redirect)return new Response('redirected',{status:302,
      headers:{location:'http://127.0.0.1/admin'}});
    let body;
    if(path==='/v7/health')body=JSON.stringify({
      service:'sutradhar-v7',ready:healthReady,
      authority:'mysql',api_protocol:7});
    else if(path==='/release-manifest.json')body=JSON.stringify({
      application:'central',source_sha:wrongSha?'b'.repeat(40):sha,
      api_protocol:7,mysql_schema_version:7,bundle_sha256:'c'.repeat(64)});
    else if(path==='/')body='<div>SUTRADHAR / CENTRAL</div>';
    else return new Response('',{status:404});
    if(oversized&&path==='/v7/health')
      body='a'.repeat(MAX_BYTES+1);
    return new Response(body,{status:200,headers:fingerprint?{
      'x-powered-by':'Express'}:{}});
  };
}
const allowed=(other={})=>({
  origin,expectedSha:sha,allowedHostname:host,
  resolveHost:publicDns,fetcher:mock(),...other
});
test('Hostinger read-only preflight accepts exact Owner pinned host and app SHA',async()=>{
  const calls=[];
  const ok=await preflight(allowed({fetcher:mock({seen:calls})}));
  assert.equal(ok.accepted,true,JSON.stringify(ok));
  assert.equal(ok.owner_hostname_pinned,true);
  assert.equal(ok.public_dns_prechecked,true);
  assert.equal(ok.staging_readonly_only,true);
  assert.equal(ok.production_accepted,false);
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),
    ['/v7/health','/release-manifest.json','/']);
  assert.ok(calls.every(x=>x.options.method==='GET'&&
    x.options.redirect==='error'&&x.options.credentials==='omit'&&
    x.options.cache==='no-store'&&x.options.signal));
});
test('wrong live release SHA and MySQL health reject staging acceptance',async()=>{
  const wrong=await preflight(allowed({fetcher:mock({wrongSha:true})}));
  assert.equal(wrong.accepted,false);
  assert.ok(wrong.issues.includes('DEPLOYED_SOURCE_OR_SCHEMA_MISMATCH'));
  const down=await preflight(allowed({fetcher:mock({healthReady:false})}));
  assert.equal(down.accepted,false);
  assert.ok(down.issues.includes('MYSQL_CONTROL_HEALTH_NOT_READY'));
});
test('workflow URL alone cannot authorize a staging probe; exact protected hostname is mandatory',async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;throw Error('must never call');};
  for(const origin of [
    'https://stage.sutradhar.example.com',
    'https://production.example.com',
    'https://stage.other-example.com',
    'https://contest.example.com',
    'https://latest.example.com',
    'http://stage.sutradhar.example.com',
    'https://stage.sutradhar.example.com:8443',
    'https://stage.sutradhar.example.com/?debug=1',
    'https://user:password@stage.sutradhar.example.com',
    'https://stage.sutradhar.example.com/#fragment',
    'https://stage.sutradhar.example.com.evil.test'
  ]){
    const result=await preflight({origin,expectedSha:sha,
      allowedHostname:origin==='https://stage.sutradhar.example.com'?
        undefined:host,fetcher});
    assert.equal(result.accepted,false,origin);
  }
  assert.equal(calls,0);
  assert.equal(target(origin,sha,host).url.origin,origin);
  assert.equal(target(origin,sha,'stage.example.com').error,
    'STAGING_HOSTNAME_NOT_OWNER_PINNED');
});
test('local, private, mapped, metadata and reserved DNS answers block before any HTTP GET',async()=>{
  let calls=0;
  const http=async()=>{calls++;throw Error('HTTP must be blocked');};
  const privateIps=[
    ['127.0.0.1',4],['10.1.2.3',4],['172.16.0.5',4],
    ['192.168.100.1',4],['169.254.169.254',4],['100.65.1.1',4],
    ['198.19.1.1',4],['203.0.113.1',4],
    ['::1',6],['fe80::1',6],['fc00::123',6],
    ['::ffff:127.0.0.1',6],['2001:db8::1',6],['2002:0a00:0001::1',6]
  ];
  for(const [ip,family] of privateIps){
    assert.equal(publicAddress(ip),false,ip);
    const blocked=await preflight(allowed({
      fetcher:http,resolveHost:async()=>[{address:ip,family}]
    }));
    assert.equal(blocked.accepted,false,ip);
    assert.ok(blocked.issues.includes('STAGING_DNS_PRIVATE_OR_UNVERIFIED'),ip);
  }
  const mixed=await preflight(allowed({fetcher:http,resolveHost:async()=>[
    {address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]}));
  assert.equal(mixed.accepted,false);
  assert.equal(calls,0);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('invalid/failed DNS resolution never performs a remote fetch',async()=>{
  let called=0;
  const fetcher=async()=>{called++;throw Error('no network allowed');};
  for(const resolveHost of [
    async()=>[],async()=>[{address:'127.0.0.1',family:6}],
    async()=>{throw Error('DNS outage')}
  ]){
    const r=await preflight(allowed({fetcher,resolveHost}));
    assert.equal(r.accepted,false);
  }
  assert.equal(called,0);
});
test('response body is bounded while streaming, and oversize response refuses readiness',async()=>{
  const result=await preflight(allowed({fetcher:mock({oversized:true})}));
  assert.equal(result.accepted,false);
  assert.ok(result.issues.includes('HEALTH_CHECK_FAILED'));
  assert.equal(result.production_accepted,false);
});
test('redirects, exposed Express fingerprint and missing health proof fail closed',async()=>{
  const redirects=await preflight(allowed({fetcher:mock({redirect:true})}));
  assert.equal(redirects.accepted,false);
  assert.ok(redirects.issues.includes('HEALTH_CHECK_FAILED'));
  const fingerprint=await preflight(allowed({fetcher:mock({fingerprint:true})}));
  assert.equal(fingerprint.accepted,false);
  assert.ok(fingerprint.issues.includes('EXPRESS_FINGERPRINT_EXPOSED'));
});

test('production HTTPS preflight pins one validated IP, preserves SNI and refuses redirects',async()=>{
  const {createPinnedFetcher}=require('../scripts/ops/staging-pinned-https.cjs');
  const {Readable}=require('node:stream');
  const {EventEmitter}=require('node:events');
  const seen=[],responder=(url,options,callback)=>{
    seen.push({url:url.toString(),options});
    const req=new EventEmitter();
    req.end=()=>{
      const text=url.pathname==='/v7/health'?JSON.stringify({
        service:'sutradhar-v7',ready:true,authority:'mysql',api_protocol:7}):
        url.pathname==='/release-manifest.json'?JSON.stringify({
          application:'central',source_sha:sha,api_protocol:7,
          mysql_schema_version:7,bundle_sha256:'c'.repeat(64)}):
        'SUTRADHAR CENTRAL';
      const response=Readable.from([Buffer.from(text)]);
      response.statusCode=200;
      response.headers={'content-type':url.pathname==='/'?'text/html':'application/json'};
      queueMicrotask(()=>callback(response));
    };
    req.destroy=error=>req.emit('error',error);
    return req;
  };
  const result=await preflight({
    origin,expectedSha:sha,allowedHostname:host,resolveHost:publicDns,
    pinnedFetcherFactory:args=>createPinnedFetcher({...args,requester:responder})
  });
  assert.equal(result.accepted,true,JSON.stringify(result));
  assert.equal(result.https_address_pinned,true);
  assert.equal(seen.length,3);
  for(const call of seen){
    assert.equal(new URL(call.url).hostname,host);
    assert.equal(call.options.servername,host);
    assert.equal(call.options.rejectUnauthorized,true);
    assert.equal(call.options.agent,false);
    assert.equal(call.options.method,'GET');
    assert.equal(call.options.timeout,12000);
    assert.equal(typeof call.options.lookup,'function');
    const lookedUp=await new Promise((resolve,reject)=>
      call.options.lookup(host,{},(error,address,family)=>
        error?reject(error):resolve({address,family})));
    assert.deepEqual(lookedUp,{address:'8.8.8.8',family:4});
    const changedHost=await new Promise(resolve=>
      call.options.lookup('internal.local',{},error=>resolve(error)));
    assert.match(changedHost.message,/STAGING_PINNED_HOSTNAME_CHANGED/);
  }
  const transport=createPinnedFetcher({
    origin,hostname:host,address:'8.8.8.8',family:4,requester:responder});
  for(const unsafe of [
    [origin+'/admin',{method:'GET',redirect:'error',credentials:'omit'}],
    [origin+'/v7/health?admin=1',{method:'GET',redirect:'error',credentials:'omit'}],
    ['https://evil.example.com/v7/health',{method:'GET',redirect:'error',credentials:'omit'}],
    [origin+'/v7/health',{method:'POST',redirect:'error',credentials:'omit'}],
    [origin+'/v7/health',{method:'GET',redirect:'follow',credentials:'omit'}]
  ])await assert.rejects(transport(...unsafe),/STAGING_PINNED_HTTPS_METHOD_OR_PATH_DENIED/);
  assert.equal(seen.length,3,'unsafe paths must not reach transport');
});
test('mock preflight cannot claim real HTTPS address pinning',async()=>{
  const result=await preflight(allowed());
  assert.equal(result.accepted,true);
  assert.equal(result.https_address_pinned,false);
});
