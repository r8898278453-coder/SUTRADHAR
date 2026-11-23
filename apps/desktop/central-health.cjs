/**
 * Bounded, read-only first-run Central /v7/health verification.
 * This cannot approve enrollment, deployment or physical PC acceptance.
 */
'use strict';
const {normalizeCentralUrl}=require('./desktop-config.cjs');
const {boundedCentralJson}=require('./bounded-central-json.cjs');
function fail(code){throw Error(code);}
async function verifyCentralHealth({origin,expectedProtocol,fetcher=fetch}={}){
  if(typeof origin!=='string'||normalizeCentralUrl(origin)!==origin||
     !Number.isSafeInteger(expectedProtocol)||expectedProtocol<1)
    fail('CENTRAL_HEALTH_CONFIG_INVALID');
  let response;
  try{
    response=await fetcher(origin+'/v7/health',{method:'GET',
      headers:{Accept:'application/json'},redirect:'error',
      cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(12000)});
  }catch{fail('Central health check network unavailable');}
  if(!response?.ok)
    fail('Central health check failed (HTTP '+String(response?.status||'unavailable')+
      '). Ask the Owner to verify Hostinger and MySQL.');
  let obj;
  try{obj=await boundedCentralJson(response);}
  catch{fail('Central health check response invalid or too large');}
  if(obj.service!=='sutradhar-v7'||obj.ready!==true||obj.authority!=='mysql')
    fail('This is not a ready SUTRADHAR Central server');
  if(obj.api_protocol!==expectedProtocol)
    fail('Central/Desktop protocol mismatch. Update the compatible Desktop version first.');
  return Object.freeze({verified:true,api_protocol:expectedProtocol,
    owner_approval_verified:false,production_approved:false});
}
module.exports={verifyCentralHealth};
