/**
 * Bounded signed Central API responses for the packaged Windows edge child.
 * Recovery has a separately bounded 300-row snapshot; routine heartbeats
 * must not accept unbounded JSON or reveal network/header details on error.
 * This module is bundled into dist/secure-agent.cjs by esbuild, not ASAR.
 */
'use strict';
const MAX_AGENT_RESPONSE_BYTES=64*1024;
const MAX_AGENT_RECOVERY_BYTES=512*1024;
const ROUTES=new Map([
  ['GET /v7/recovery',MAX_AGENT_RECOVERY_BYTES],
  ['GET /v7/nodes/me',MAX_AGENT_RESPONSE_BYTES],
  ['POST /v7/agents/register',MAX_AGENT_RESPONSE_BYTES],
  ['POST /v7/leadership/reconcile',MAX_AGENT_RESPONSE_BYTES],
  ['POST /v7/nodes/heartbeat',MAX_AGENT_RESPONSE_BYTES]
]);
function fail(code){throw Error(code);}
function requestLimit(method,uri){
  const limit=ROUTES.get(method+' '+uri);
  if(!limit)fail('AGENT_CENTRAL_ROUTE_DENIED');
  return limit;
}
async function readAgentJson(response,limit){
  if(!response?.headers||typeof response.headers.get!=='function'||
     !response.body||typeof response.body.getReader!=='function')
    fail('AGENT_CENTRAL_RESPONSE_INVALID');
  const length=response.headers.get('content-length');
  if(length!==null){
    if(!/^(?:0|[1-9][0-9]*)$/.test(length)||
       !Number.isSafeInteger(Number(length)))
      fail('AGENT_CENTRAL_RESPONSE_INVALID');
    if(Number(length)>limit)fail('AGENT_CENTRAL_RESPONSE_TOO_LARGE');
  }
  if(!/^application\/json(?:\s*;|\s*$)/i.test(
      response.headers.get('content-type')||''))
    fail('AGENT_CENTRAL_RESPONSE_INVALID');
  const stream=response.body.getReader(),parts=[];
  let size=0;
  try{
    for(;;){
      let chunk;
      try{chunk=await stream.read();}
      catch{fail('AGENT_CENTRAL_RESPONSE_INVALID');}
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array))
        fail('AGENT_CENTRAL_RESPONSE_INVALID');
      size+=chunk.value.byteLength;
      if(size>limit)fail('AGENT_CENTRAL_RESPONSE_TOO_LARGE');
      parts.push(Buffer.from(chunk.value));
    }
    if(!size)fail('AGENT_CENTRAL_RESPONSE_INVALID');
    let json;
    try{
      const raw=new TextDecoder('utf-8',{fatal:true})
        .decode(Buffer.concat(parts,size));
      json=JSON.parse(raw);
    }catch{fail('AGENT_CENTRAL_RESPONSE_INVALID');}
    if(!json||typeof json!=='object'||Array.isArray(json))
      fail('AGENT_CENTRAL_RESPONSE_INVALID');
    return json;
  }finally{
    try{await stream.cancel();}catch{}
    try{stream.releaseLock();}catch{}
  }
}
async function agentCentralRequest({origin,method,uri,headers,body,fetcher=fetch}={}){
  if(typeof origin!=='string'||origin.length>250||
     !/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(origin))
    fail('AGENT_CENTRAL_ORIGIN_INVALID');
  const limit=requestLimit(method,uri);
  if(!headers||typeof headers!=='object'||Array.isArray(headers)||
     typeof fetcher!=='function')
    fail('AGENT_CENTRAL_REQUEST_INVALID');
  if(method==='GET'&&(body!==undefined&&body!==null))
    fail('AGENT_CENTRAL_REQUEST_INVALID');
  if(method==='POST'&&(typeof body!=='string'||
     Buffer.byteLength(body,'utf8')>16*1024||!body.startsWith('{')))
    fail('AGENT_CENTRAL_REQUEST_INVALID');
  let response;
  try{
    response=await fetcher(origin+uri,{
      method,headers:{...headers,Accept:'application/json'},
      body:method==='POST'?body:undefined,
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(15000)
    });
  }catch{fail('AGENT_CENTRAL_NETWORK_UNAVAILABLE');}
  const result=await readAgentJson(response,limit);
  if(!response.ok){
    const code=result.error_code;
    if(typeof code==='string'&&/^[A-Z][A-Z0-9_]{2,79}$/.test(code))
      fail(code);
    const status=Number(response.status);
    fail(Number.isInteger(status)&&status>=400&&status<=599?
      'HTTP_'+status:'AGENT_CENTRAL_RESPONSE_INVALID');
  }
  return result;
}
module.exports={agentCentralRequest,readAgentJson,requestLimit,
  MAX_AGENT_RESPONSE_BYTES,MAX_AGENT_RECOVERY_BYTES};
