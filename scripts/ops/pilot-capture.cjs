/**
 * Manual physical-PC pilot GET-only capture. Does NOT prove physical location,
 * machine ownership, Windows reboot, source deployment SHA or OS identity.
 * Exact hostname is provisioned separately by the Owner; dispatch URL alone
 * never authorizes a probe. TLS/DNS egress requires separate network controls.
 */
'use strict';
const dns=require('node:dns').promises;
const {evaluatePilot}=require('./pilot-policy.cjs');
const {publicAddress}=require('./hostinger-staging-preflight.cjs');
const SHA=/^[a-f0-9]{40}$/,NODE=/^node_[a-f0-9]{32}$/;
const MAX=128*1024;
function failure(code){return {accepted:false,failures:[code],
  read_only:true,physical_machine_verified:false,source_sha_verified:false,
  production_release_authorized:false};}
function parseTarget(origin,pinnedHostname){
  try{
    const u=new URL(origin);
    const host=u.hostname.toLowerCase();
    if(typeof pinnedHostname!=='string'||pinnedHostname!==host||
       !/^[a-z0-9](?:[a-z0-9.-]{1,251})[a-z0-9]$/.test(host)||
       host.endsWith('.local')||host.endsWith('.internal')||
       host.endsWith('.localhost')||host.endsWith('.test')||
       host.endsWith('.invalid')||
       u.protocol!=='https:'||u.port||u.username||u.password||
       u.pathname!=='/'||u.search||u.hash)
      return null;
    return u;
  }catch{return null;}
}
async function readJson(fetcher,url,apiKey){
  const res=await fetcher(url,{method:'GET',redirect:'error',
    credentials:'omit',cache:'no-store',
    headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'},
    signal:AbortSignal.timeout(12000)});
  if(!res?.ok||!res.body||typeof res.body.getReader!=='function')
    throw Error('PILOT_CENTRAL_UNAVAILABLE');
  const n=Number(res.headers?.get?.('content-length')||0);
  if(!Number.isSafeInteger(n)||n<0||n>MAX)
    throw Error('PILOT_CENTRAL_RESPONSE_TOO_LARGE');
  const reader=res.body.getReader(),pieces=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!value||!Number.isSafeInteger(value.byteLength))
        throw Error('PILOT_CENTRAL_RESPONSE_INVALID');
      total+=value.byteLength;
      if(total>MAX)throw Error('PILOT_CENTRAL_RESPONSE_TOO_LARGE');
      pieces.push(Buffer.from(value));
    }
  }finally{
    try{await reader.cancel();}catch{}
    reader.releaseLock();
  }
  const parsed=JSON.parse(Buffer.concat(pieces,total).toString('utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    throw Error('PILOT_CENTRAL_RESPONSE_INVALID');
  return parsed;
}
async function capture({origin,allowedHostname,expectedSha,nodeIds,
  offlineNodes=[],adminKey,fetcher=fetch,resolveHost=async host=>
    dns.lookup(host,{all:true}),now=Date.now()}={}){
  const url=parseTarget(origin,allowedHostname);
  if(!url||!SHA.test(expectedSha||'')||
     !Array.isArray(nodeIds)||nodeIds.length<2||nodeIds.length>10||
     nodeIds.some(id=>!NODE.test(id))||new Set(nodeIds).size!==nodeIds.length||
     !Array.isArray(offlineNodes)||offlineNodes.length>1||
     new Set(offlineNodes).size!==offlineNodes.length||
     offlineNodes.some(id=>!nodeIds.includes(id))||
     typeof adminKey!=='string'||adminKey.length<32||
     /\s/.test(adminKey)||!Number.isSafeInteger(now)||now<1)
    return failure('PILOT_OWNER_PINNED_INPUT_INVALID');
  try{
    const dnsAnswers=await resolveHost(url.hostname);
    if(!Array.isArray(dnsAnswers)||dnsAnswers.length<1||
       dnsAnswers.length>16||dnsAnswers.some(x=>
         !x||(x.family!==4&&x.family!==6)||
         require('node:net').isIP(x.address)!==x.family||
         !publicAddress(x.address)))
      return failure('PILOT_DNS_NOT_PUBLIC_OR_UNVERIFIED');
    const health=await readJson(fetcher,url.origin+'/v7/health',adminKey);
    if(health.ready!==true||health.authority!=='mysql'||
       health.api_protocol!==7)
      return failure('PILOT_CENTRAL_NOT_READY');
    const remote=await readJson(fetcher,url.origin+'/v7/cluster',adminKey);
    const result=evaluatePilot(remote,nodeIds,now,offlineNodes);
    return {...result,capture_schema:1,
      capture_mode:'OWNER_READONLY_CENTRAL_PILOT',
      central_origin:url.origin,source_sha_claim:expectedSha,
      source_sha_verified:false,public_dns_prechecked:true,
      owner_hostname_pinned:true,physical_machine_verified:false,
      node_key_possession_verified:false,
      production_release_authorized:false,read_only:true};
  }catch{return failure('PILOT_CENTRAL_GET_OR_JSON_INVALID');}
}
module.exports={capture,parseTarget,readJson,MAX};
