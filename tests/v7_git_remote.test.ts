import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGitRemote} from '../v7/git_remote.ts';
const baseline='a'.repeat(40),head='b'.repeat(40),tree='c'.repeat(40);
const input={repo:'example/repository',token:'test-only-token',branch:'ai/ticket-secure',
  baseline,tree,writeScopes:['src/components']};
type Fixture={status?:number;data:any};
const make=(changes:any[],overrides:any={})=>{
  const branch={commit:{sha:head}},commit={sha:head,tree:{sha:tree},parents:[{sha:baseline}]};
  const comparison={status:'ahead',ahead_by:1,behind_by:0,total_commits:1,files:changes};
  const pages:{[key:string]:Fixture}={
    ['branches/ai/ticket-secure']:{data:branch},
    ['git/commits/'+head]:{data:commit},
    ['compare/'+baseline+'...'+head]:{data:comparison}
  };
  for(const [key,value] of Object.entries(overrides))
    (pages[key] as Fixture).data=value;
  return async(url:string,options?:RequestInit)=>{
    assert.equal(options?.method,'GET','read-only API must never mutate GitHub');
    assert.equal(new URL(url).hostname,'api.github.com');
    const suffix=new URL(url).pathname.split('/repos/example/repository/')[1];
    const item=pages[suffix];return new Response(JSON.stringify(item?.data||{}),{status:item?.status||200});
  };
};
test('remote exact single parent/tree/scope accepts verified candidate',async()=>{
  const result=await inspectGitRemote({...input,fetcher:make([
    {filename:'src/components/Button.tsx',status:'modified'},
    {filename:'src/components/Button.test.tsx',status:'added'}
  ])});
  assert.equal(result.verified,true);
  if(result.verified){
    assert.equal(result.headSha,head);
    assert.deepEqual(result.changedFiles,['src/components/Button.test.tsx','src/components/Button.tsx']);
  }
});
test('remote changed file outside reserved scope denied',async()=>{
  const result=await inspectGitRemote({...input,fetcher:make([
    {filename:'core/crypto_signer.py',status:'modified'}])});
  assert.deepEqual(result,{verified:false,error_code:'REMOTE_CHANGED_FILE_SCOPE_MISMATCH'});
});
test('remote rename / deletion denied even if in scope',async()=>{
  for(const item of [
    {filename:'src/components/B.tsx',status:'renamed',previous_filename:'src/components/A.tsx'},
    {filename:'src/components/B.tsx',status:'removed'}]){
    const result=await inspectGitRemote({...input,fetcher:make([item])});
    assert.equal(result.verified,false);
  }
});
test('remote candidate not one commit on frozen baseline rejected',async()=>{
  const result=await inspectGitRemote({...input,fetcher:make(
    [{filename:'src/components/a.ts',status:'modified'}],
    {['git/commits/'+head]:{sha:head,tree:{sha:tree},parents:[{sha:'d'.repeat(40)}]}})});
  assert.equal(result.verified,false);
});
test('replayed branch or changed expected HEAD rejected',async()=>{
  const result=await inspectGitRemote({...input,expectedHead:'f'.repeat(40),
    fetcher:make([{filename:'src/components/a.ts',status:'modified'}])});
  assert.equal(result.verified,false);
});
test('unsafe branch rejected before outbound fetch',async()=>{
  let calls=0;const result=await inspectGitRemote({...input,branch:'main',
    fetcher:async()=>{calls++;throw Error('unexpected');}});
  assert.equal(result.verified,false);assert.equal(calls,0);
});
