'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {preflight}=require('../scripts/ops/hostinger-staging-preflight.cjs');
const sha='a'.repeat(40),base='https://stage.sutradhar.example.com';
function mock({wrongSha=false,healthReady=true}={}){
  return async url=>{
    const path=new URL(url).pathname;
    let json;
    if(path==='/v7/health')json=JSON.stringify({service:'sutradhar-v7',ready:healthReady,
      authority:'mysql',api_protocol:7});
    else if(path==='/release-manifest.json')json=JSON.stringify({
      application:'central',source_sha:wrongSha?'b'.repeat(40):sha,
      api_protocol:7,mysql_schema_version:7,bundle_sha256:'c'.repeat(64)});
    else if(path==='/')json='<div>SUTRADHAR / CENTRAL</div>';
    else return {ok:false,status:404};
    return {ok:true,headers:{get:()=>null},text:async()=>json};
  };
}
test('Hostinger staging preflight only accepts real exact-version app response',async()=>{
  const ok=await preflight({origin:base,expectedSha:sha,fetcher:mock()});
  assert.equal(ok.accepted,true);
  assert.equal(ok.production_accepted,false);
  const wrong=await preflight({origin:base,expectedSha:sha,fetcher:mock({wrongSha:true})});
  assert.equal(wrong.accepted,false);
  const down=await preflight({origin:base,expectedSha:sha,fetcher:mock({healthReady:false})});
  assert.equal(down.accepted,false);
  assert.equal((await preflight({origin:'https://production.example.com',expectedSha:sha,
    fetcher:mock()})).accepted,false);
  assert.equal((await preflight({origin:'http://stage.example.com',expectedSha:sha,
    fetcher:mock()})).accepted,false);
});
