/**
 * Read-only Hostinger STAGING smoke verification; never deploys or migrates.
 * Requires an intentionally named HTTPS staging hostname and the EXACT SHA.
 */
'use strict';
const SHA=/^[a-f0-9]{40}$/;
async function preflight({origin,expectedSha,fetcher=fetch}){
  const issues=[];
  function reject(code){issues.push(code);}
  let url;
  try{url=new URL(origin);}catch{return {accepted:false,issues:['STAGING_URL_INVALID']};}
  if(url.protocol!=='https:'||!/(?:stage|staging|test)/i.test(url.hostname)||
    url.username||url.password||url.pathname!=='/'||url.search||url.hash||
    !SHA.test(expectedSha||''))return {accepted:false,issues:['STAGING_TARGET_OR_COMMIT_INVALID']};
  async function get(path){
    const r=await fetcher(url.origin+path,{method:'GET',redirect:'error',
      signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('HTTP_'+r.status);
    if(r.headers?.get?.('x-powered-by'))reject('EXPRESS_FINGERPRINT_EXPOSED');
    const body=await r.text();
    if(body.length>100000)throw Error('RESPONSE_TOO_LARGE');
    return body;
  }
  let health=null,manifest=null;
  try{
    health=JSON.parse(await get('/v7/health'));
    if(health.service!=='sutradhar-v7'||health.ready!==true||
      health.authority!=='mysql'||health.api_protocol!==7)
      reject('MYSQL_CONTROL_HEALTH_NOT_READY');
  }catch{reject('HEALTH_CHECK_FAILED');}
  try{
    manifest=JSON.parse(await get('/release-manifest.json'));
    if(manifest.application!=='central'||manifest.source_sha!==expectedSha||
      manifest.api_protocol!==7||manifest.mysql_schema_version!==7||
      !/^[0-9a-f]{64}$/.test(manifest.bundle_sha256||''))
      reject('DEPLOYED_SOURCE_OR_SCHEMA_MISMATCH');
  }catch{reject('RELEASE_MANIFEST_UNAVAILABLE');}
  try{
    const ui=await get('/');
    if(!ui.includes('SUTRADHAR')||!ui.includes('CENTRAL'))reject('DASHBOARD_CONTENT_MISMATCH');
  }catch{reject('DASHBOARD_UNAVAILABLE');}
  return {accepted:issues.length===0,issues,staging_origin:url.origin,
    observed_commit:manifest?.source_sha||null,
    observed_protocol:health?.api_protocol||null,
    production_accepted:false,required_manual_evidence:[
      'Hostinger deployment log','MySQL encrypted backup and empty staging restore',
      'Two actual PCs with unique identities','Owner approval/security review'
    ]};
}
if(require.main===module){
  preflight({origin:process.env.SUTRADHAR_STAGING_URL||'',
    expectedSha:process.env.SUTRADHAR_EXPECTED_COMMIT_SHA||''}).then(result=>{
      console.log(JSON.stringify(result,null,2));
      if(!result.accepted)process.exitCode=1;
    }).catch(()=>{console.error('STAGING_PREFLIGHT_UNAVAILABLE');process.exitCode=1;});
}
module.exports={preflight};
