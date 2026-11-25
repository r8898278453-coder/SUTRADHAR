'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {boundedCentralJson,MAX_CENTRAL_JSON_BYTES}=
  require('../apps/desktop/bounded-central-json.cjs');
const reply=(value,headers={})=>new Response(JSON.stringify(value),{
  headers:{'content-type':'application/json',...headers}});
test('64-KiB streaming bounded Central object reader accepts normal JSON',async()=>{
  assert.equal(MAX_CENTRAL_JSON_BYTES,65536);
  assert.deepEqual(await boundedCentralJson(reply({node_id:'node_abc'})),{node_id:'node_abc'});
});
test('large declared or decompressed response is refused',async()=>{
  await assert.rejects(boundedCentralJson(reply({ok:true},{
    'content-length':String(MAX_CENTRAL_JSON_BYTES+1)})),/CENTRAL_JSON_TOO_LARGE/);
  await assert.rejects(boundedCentralJson(reply({payload:'a'.repeat(70000)})),
    /CENTRAL_JSON_TOO_LARGE/);
});
test('stream, header, type, and JSON-shape inconsistencies fail closed',async()=>{
  await assert.rejects(boundedCentralJson({headers:{get:()=>null},
    json:async()=>({ok:true})}),/STREAM_REQUIRED/);
  await assert.rejects(boundedCentralJson(reply({ok:true},{
    'content-length':'1e6'})),/CONTENT_LENGTH_INVALID/);
  await assert.rejects(boundedCentralJson(reply({ok:true},{
    'content-type':'text/html'})),/CONTENT_TYPE_INVALID/);
  await assert.rejects(boundedCentralJson(new Response('{broken',{
    headers:{'content-type':'application/json'}})),/PARSE_INVALID/);
  await assert.rejects(boundedCentralJson(reply([1,2])),/OBJECT_REQUIRED/);
  await assert.rejects(boundedCentralJson(new Response('',{
    headers:{'content-type':'application/json'}})),/CENTRAL_JSON_EMPTY/);
  await assert.rejects(boundedCentralJson(reply({ok:true}),{limit:100000}),
    /LIMIT_INVALID/);
});
