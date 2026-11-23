import test from 'node:test';
import assert from 'node:assert/strict';
import {githubApiJson} from '../v7/github_api_json.ts';
const url='https://api.github.com/repos/example/repo/branches/main';
test('GitHub proof transport sends exact GET without redirect, cookies or cache',async()=>{
  let count=0;
  const data=await githubApiJson(url,'test-only-token',async(actual,init)=>{
    count++;
    assert.equal(actual,url);
    assert.equal(init?.method,'GET');
    assert.equal(init?.redirect,'error');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal((init?.headers as Record<string,string>).Authorization,
      'Bearer test-only-token');
    return new Response('{"safe":true}',{status:200});
  });
  assert.deepEqual(data,{safe:true});
  assert.equal(count,1);
});
test('oversized, invalid UTF8, malformed, and redirect responses cannot prove GitHub state',async()=>{
  const fake=[
    async()=>new Response('x'.repeat(256*1024+1),{status:200}),
    async()=>new Response('{"safe":true}',{status:200,
      headers:{'content-length':'9999999'}}),
    async()=>new Response(Buffer.from([0xff,0xfe]),{status:200}),
    async()=>new Response('{broken',{status:200}),
    async()=>new Response(null,{status:302,
      headers:{Location:'https://untrusted.invalid/'}})
  ];
  for(const fetcher of fake)
    await assert.rejects(githubApiJson(url,'test-only-token',fetcher));
});
test('Owner-initiated Draft PR POST retains exact JSON body with no redirect',async()=>{
  const data=await githubApiJson(url,'test-only-token',
    async(_url,init)=>{
      assert.equal(init?.method,'POST');
      assert.equal(init?.redirect,'error');
      assert.deepEqual(JSON.parse(String(init?.body)),{draft:true});
      return new Response('{"created":true}',{status:201});
    },{method:'POST',data:{draft:true}});
  assert.equal(data.created,true);
});
