'use strict';
// Streaming-only response reader: no fallback to unbounded Response.json().
const MAX_BYTES=64*1024;
function fail(code){throw Error(code);}
async function boundedCentralJson(response,{limit=MAX_BYTES}={}){
  if(!Number.isSafeInteger(limit)||limit<256||limit>MAX_BYTES)
    fail('CENTRAL_JSON_LIMIT_INVALID');
  if(!response?.headers||typeof response.headers.get!=='function'||
     !response.body||typeof response.body.getReader!=='function')
    fail('CENTRAL_JSON_STREAM_REQUIRED');
  const len=response.headers.get('content-length');
  if(len!==null){
    if(!/^(?:0|[1-9][0-9]*)$/.test(len)||!Number.isSafeInteger(Number(len)))
      fail('CENTRAL_JSON_CONTENT_LENGTH_INVALID');
    if(Number(len)>limit)fail('CENTRAL_JSON_TOO_LARGE');
  }
  if(!/^application\/json(?:\s*;|\s*$)/i.test(
       response.headers.get('content-type')||''))
    fail('CENTRAL_JSON_CONTENT_TYPE_INVALID');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    for(;;){
      let item;
      try{item=await reader.read();}catch{fail('CENTRAL_JSON_STREAM_FAILED');}
      if(item.done)break;
      if(!(item.value instanceof Uint8Array))fail('CENTRAL_JSON_CHUNK_INVALID');
      size+=item.value.byteLength;
      if(size>limit)fail('CENTRAL_JSON_TOO_LARGE');
      parts.push(Buffer.from(item.value));
    }
    if(size===0)fail('CENTRAL_JSON_EMPTY');
    let obj;
    try{obj=JSON.parse(Buffer.concat(parts,size).toString('utf8'));}
    catch{fail('CENTRAL_JSON_PARSE_INVALID');}
    if(!obj||typeof obj!=='object'||Array.isArray(obj))
      fail('CENTRAL_JSON_OBJECT_REQUIRED');
    return obj;
  }finally{
    try{await reader.cancel();}catch{}
    try{reader.releaseLock();}catch{}
  }
}
module.exports={boundedCentralJson,MAX_CENTRAL_JSON_BYTES:MAX_BYTES};
