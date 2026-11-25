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
    return new Response(JSON.stringify(url==='https://api.github.com/repos/'+repository+'/branches/main'?
      fixture.branch:fixture.rules),{status:200});
  };
  const result=await audit({repository,expectedMainSha:sha,fetcher});
  assert.equal(result.accepted,true);
  assert.equal(sent.length,3);
  assert.deepEqual(sent.map(x=>x.url).sort(),[
    'https://api.github.com/repos/'+repository+'/branches/main',
    'https://api.github.com/repos/'+repository+'/branches/main',
    'https://api.github.com/repos/'+repository+'/rules/branches/main'
  ].sort());
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
      return new Response(JSON.stringify(url==='https://api.github.com/repos/'+repository+'/branches/main'?
        x.branch:x.rules),{status:200});
    }});
  assert.equal(result.accepted,true);
  assert.deepEqual(seen,['Bearer test-only-token','Bearer test-only-token','Bearer test-only-token']);
  assert.equal(JSON.stringify(result).includes('test-only-token'),false);
});

test('all seven current CI job names must be present, not only a subset',()=>{
  assert.equal(REQUIRED.length,7);
  for(const name of REQUIRED){
    const x=valid(),p=x.rules.find(r=>r.type==='required_status_checks').parameters;
    p.required_status_checks=p.required_status_checks.filter(c=>c.context!==name);
    p.required_status_checks.push({context:'unrelated check'});
    assert.equal(inspect(x).error_code,'G0_REQUIRED_EXACT_HEAD_CHECKS_MISSING',name);
  }
});
test('dot-segment repository names never perform any network read',async()=>{
  for(const repository of ['owner/..','./repo','../repo','owner/.']){
    const r=await audit({repository,expectedMainSha:sha,fetcher:async()=>assert.fail('unexpected fetch')});
    assert.equal(r.error_code,'G0_AUDIT_INPUT_INVALID');
  }
});
test('main moving or losing protection during read-only inspection fails closed',async()=>{
  for(const changed of [{commit:{sha:'b'.repeat(40)}},{protected:false}]){
    const x=valid();let branchReads=0;
    const result=await audit({repository,expectedMainSha:sha,fetcher:async url=>{
      if(url.endsWith('/rules/branches/main'))return new Response(JSON.stringify(x.rules));
      return new Response(JSON.stringify(++branchReads===1?x.branch:{...x.branch,...changed}));
    }});
    assert.equal(branchReads,2);
    assert.equal(result.error_code,'G0_MAIN_CHANGED_DURING_AUDIT');
    assert.equal(result.production_release_authorized,false);
  }
});
