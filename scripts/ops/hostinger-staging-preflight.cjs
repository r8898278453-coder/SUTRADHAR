/**
 * SUTRADHAR Hostinger STAGING-only, READ-ONLY preflight.
 *
 * SECURITY: Never accept a workflow-dispatch URL as authorization. An Owner
 * must first pin its EXACT staging hostname in a protected repository variable.
 * DNS observations are checked before GETs, but a DNS rebinding/egress firewall
 * is still a separate infrastructure responsibility (see Owner runbook).
 * This module NEVER deploys, migrates, restores, or invokes credentials.
 */
'use strict';
const dns=require('node:dns').promises;
const net=require('node:net');
const SHA=/^[a-f0-9]{40}$/;
const HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_BYTES=100*1024;
const DANGEROUS_SUFFIX=/(?:^|\.)(?:localhost|local|lan|internal|invalid|test|home\.arpa)$/i;
function publicAddress(address){
  const family=net.isIP(address);
  if(family===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||
      a===100&&b>=64&&b<=127||
      a===169&&b===254||
      a===172&&b>=16&&b<=31||
      a===192&&(b===168||b===0||b===88&&c===99||b===0&&c===2)||
      a===192&&b===0&&c===2||
      a===198&&(b===18||b===19||b===51&&c===100)||
      a===203&&b===0&&c===113);
  }
  if(family===6){
    const value=address.toLowerCase();
    if(value.includes('.')||value.includes('%'))return false;
    const prefix=value.split(':');
    const n=parseInt(prefix[0],16);
    const next=parseInt(prefix[1]||'0',16);
    // Only native IPv6 global-unicast 2000::/3, not ULA/link-local,
    // 6to4, Teredo, benchmarking or documentation ranges.
    if(!Number.isInteger(n)||n<0x2000||n>0x3fff||
       n===0x2002||n===0x2001&&(next===0||next===0x0db8))
      return false;
    return true;
  }
  return false;
}
function target(origin,expectedSha,allowedHostname){
  let url;
  try{url=new URL(origin);}catch{return {error:'STAGING_URL_INVALID'};}
  const name=url.hostname.toLowerCase();
  const trusted=typeof allowedHostname==='string'&&
    allowedHostname.length>0&&allowedHostname===allowedHostname.trim()&&
    allowedHostname.toLowerCase()===name&&HOST.test(allowedHostname.toLowerCase());
  if(!trusted)return {error:'STAGING_HOSTNAME_NOT_OWNER_PINNED'};
  const first=name.split('.')[0];
  if(url.protocol!=='https:'||url.port!==''||
     !/^(?:stage|staging|test|qa)(?:-[a-z0-9]+)*$/.test(first)||
     !HOST.test(name)||DANGEROUS_SUFFIX.test(name)||
     net.isIP(name)||url.username||url.password||
     url.pathname!=='/'||url.search||url.hash||
     !SHA.test(expectedSha||''))
    return {error:'STAGING_TARGET_OR_COMMIT_INVALID'};
  return {url};
}
async function readBounded(response){
  if(!response?.ok)throw Error('STAGING_HTTP_UNAVAILABLE');
  const declared=Number(response.headers?.get?.('content-length')||'0');
  if(!Number.isFinite(declared)||declared>MAX_BYTES)
    throw Error('STAGING_RESPONSE_TOO_LARGE');
  if(!response.body||typeof response.body.getReader!=='function')
    throw Error('STAGING_STREAM_REQUIRED');
  const reader=response.body.getReader(),chunks=[];
  let bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw Error('STAGING_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  return Buffer.concat(chunks,bytes).toString('utf8');
}
async function preflight({origin,expectedSha,allowedHostname,
  fetcher=fetch,resolveHost=async host=>dns.lookup(host,{all:true})}){
  const verified=target(origin,expectedSha,allowedHostname);
  if(verified.error)return {accepted:false,issues:[verified.error],
    production_accepted:false};
  const url=verified.url;
  let addresses;
  try{addresses=await resolveHost(url.hostname);}
  catch{return {accepted:false,issues:['STAGING_DNS_UNVERIFIED'],production_accepted:false};}
  if(!Array.isArray(addresses)||addresses.length===0||addresses.length>16||
     addresses.some(item=>!item||
       (item.family!==4&&item.family!==6)||
       net.isIP(item.address)!==item.family||
       !publicAddress(item.address)))
    return {accepted:false,issues:['STAGING_DNS_PRIVATE_OR_UNVERIFIED'],
      production_accepted:false};
  const issues=[];
  const flag=code=>issues.push(code);
  async function get(path){
    const response=await fetcher(url.origin+path,{
      method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
      headers:{Accept:path==='/'?'text/html':'application/json'},
      signal:AbortSignal.timeout(12000)
    });
    if(response.headers?.get?.('x-powered-by'))
      flag('EXPRESS_FINGERPRINT_EXPOSED');
    return readBounded(response);
  }
  let health=null,manifest=null;
  try{
    health=JSON.parse(await get('/v7/health'));
    if(health?.service!=='sutradhar-v7'||health?.ready!==true||
      health?.authority!=='mysql'||health?.api_protocol!==7)
      flag('MYSQL_CONTROL_HEALTH_NOT_READY');
  }catch{flag('HEALTH_CHECK_FAILED');}
  try{
    manifest=JSON.parse(await get('/release-manifest.json'));
    if(manifest?.application!=='central'||manifest?.source_sha!==expectedSha||
      manifest?.api_protocol!==7||manifest?.mysql_schema_version!==7||
      !/^[0-9a-f]{64}$/.test(manifest?.bundle_sha256||''))
      flag('DEPLOYED_SOURCE_OR_SCHEMA_MISMATCH');
  }catch{flag('RELEASE_MANIFEST_UNAVAILABLE');}
  try{
    const html=await get('/');
    if(!html.includes('SUTRADHAR')||!html.includes('CENTRAL'))
      flag('DASHBOARD_CONTENT_MISMATCH');
  }catch{flag('DASHBOARD_UNAVAILABLE');}
  return {accepted:issues.length===0,issues,staging_origin:url.origin,
    observed_commit:manifest?.source_sha||null,
    observed_protocol:health?.api_protocol||null,
    owner_hostname_pinned:true,public_dns_prechecked:true,
    production_accepted:false,staging_readonly_only:true,
    required_manual_evidence:[
      'Hostinger deployment log','MySQL encrypted backup and empty staging restore',
      'Two actual PCs with unique identities','Owner approval/security review'
    ]};
}
if(require.main===module){
  preflight({origin:process.env.SUTRADHAR_STAGING_URL||'',
    expectedSha:process.env.SUTRADHAR_EXPECTED_COMMIT_SHA||'',
    allowedHostname:process.env.SUTRADHAR_STAGING_ALLOWED_HOSTNAME||''})
    .then(result=>{
      console.log(JSON.stringify(result,null,2));
      if(!result.accepted)process.exitCode=1;
    }).catch(()=>{console.error('STAGING_PREFLIGHT_UNAVAILABLE');process.exitCode=1;});
}
module.exports={preflight,target,publicAddress,readBounded,MAX_BYTES};
