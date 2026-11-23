'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit,inspect,REQUIRED,boundedGithubJson}=
  require('../scripts/ops/github-g0-protection-readonly.cjs');
const repository='r8898278453-coder/SUTRADHAR';
const sha='a'.repeat(40);
function valid(){
  return {repository,expectedMainSha:sha,
    branch:{name:'main',protected:true,commit:{sha}},
    rules:[
      {type:'deletion'},{type:'non_fast_forward'},
      {type:'pull_request',parameters:{
        required_approving_review_count:2,
        dismiss_stale_reviews_on_push:true,
        require_last_push_approval:true
      }},
      {type:'required_status_checks',parameters:{
        strict_required_status_checks_policy:true,
        required_status_checks:REQUIRED.map(context=>({context}))
      }}
    ]};
}
test('even a compatible GitHub protection snapshot never authorizes release',()=>{
  const result=inspect(valid());
  assert.equal(result.accepted,true);
  assert.equal(result.g0_release_gate,'HOLD');
  assert.equal(result.production_release_authorized,false);
  assert.equal(result.actual_human_review_verified,false);
  assert.equal(result.bypass_actors_independently_audited,false);
});
test('unprotected main, wrong SHA and missing independent review controls stop',()=>{
  const cases=[
    x=>x.branch.protected=false,
    x=>x.branch.commit.sha='b'.repeat(40),
    x=>x.rules=[],
    x=>x.rules.splice(0,1),
    x=>x.rules.find(r=>r.type==='pull_request').parameters.required_approving_review_count=0,
    x=>x.rules.find(r=>r.type==='pull_request').parameters.dismiss_stale_reviews_on_push=false,
    x=>x.rules.find(r=>r.type==='pull_request').parameters.require_last_push_approval=false,
    x=>x.rules.find(r=>r.type==='required_status_checks').parameters.strict_required_status_checks_policy=false,
    x=>x.rules.find(r=>r.type==='required_status_checks').parameters.required_status_checks.pop()
  ];
  for(const change of cases){
    const x=valid();change(x);
    const result=inspect(x);
    assert.equal(result.accepted,false,result.error_code);
    assert.equal(result.g0_release_gate,'HOLD');
    assert.equal(result.production_release_authorized,false);
  }
});
test('read-only GitHub API calls have exact GET URLs and no mutation rights',async()=>{
  const sent=[];
  const fixture=valid();
  const fetcher=async(url,opts)=>{
    sent.push({url,opts});
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.credentials,'omit');
    assert.ok(!opts.headers.Authorization);
    return new Response(JSON.stringify(url.endsWith('/branches/main')?
      fixture.branch:fixture.rules),{status:200});
  };
  const result=await audit({repository,expectedMainSha:sha,fetcher});
  assert.equal(result.accepted,true);
  assert.equal(sent.length,2);
  assert.ok(sent.every(x=>x.url.startsWith('https://api.github.com/repos/'+repository+'/')));
});
test('403 permission failure, oversized JSON and malformed data cannot become PASS',async()=>{
  for(const fetcher of [
    async()=>new Response(JSON.stringify({error:'Forbidden'}),{status:403}),
    async()=>new Response('x'.repeat(132000),{status:200}),
    async()=>new Response('{broken json}',{status:200})
  ]){
    const result=await audit({repository,expectedMainSha:sha,fetcher});
    assert.equal(result.accepted,false);
    assert.equal(result.g0_release_gate,'HOLD');
  }
});
test('private token is used only as bearer header on read-only requests',async()=>{
  const x=valid(),seen=[];
  const result=await audit({repository,expectedMainSha:sha,token:'test-only-token',
    fetcher:async(url,opts)=>{
      seen.push(opts.headers.Authorization);
      return new Response(JSON.stringify(url.endsWith('/branches/main')?
        x.branch:x.rules),{status:200});
    }});
  assert.equal(result.accepted,true);
  assert.deepEqual(seen,['Bearer test-only-token','Bearer test-only-token']);
  assert.equal(JSON.stringify(result).includes('test-only-token'),false);
});
