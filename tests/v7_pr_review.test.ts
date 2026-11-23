import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectGithubPrReview} from '../v7/pr_review.ts';
import {evaluateGithubReviewPolicy} from '../v7/github_review_policy.ts';
const HEAD='b'.repeat(40),BASE='a'.repeat(40),TREE='c'.repeat(40);
type Opt={
  draft?:boolean;merged?:boolean;head?:string;base?:string;
  tree?:string;extraFile?:boolean;approvalCommit?:string;
  changesRequested?:boolean;checksFail?:boolean;checkCount?:number;
  prAuthor?:string;prNumber?:number;prBase?:string;incompleteReviews?:boolean;
};
function scenario(x:Opt={}){
  const calls:string[]=[];
  const data={
    repo:'example/repo',token:'fixture-only-read-token',prNumber:41,
    baseBranch:'main',branch:'ai/ticket_abc',
    baselineSha:BASE,headSha:HEAD,treeSha:TREE,
    changedFiles:['src/feature.ts'],requiredChecks:['CI / tests'],
    requiredApprovals:1
  };
  const fetcher=async(url:string,init?:RequestInit)=>{
    assert.equal(init?.method,'GET','PR review NEVER POSTs to GitHub');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.redirect,'error');
    assert.equal(init?.cache,'no-store');
    const pathname=new URL(url).pathname;calls.push(pathname);
    const respond=(j:any)=>new Response(JSON.stringify(j),{status:200});
    if(pathname.endsWith('/pulls/41'))return respond({
      number:x.prNumber||41,commits:1,changed_files:1,
      state:x.merged?'closed':'open',draft:x.draft??false,
      merged_at:x.merged?'2026-11-20T12:00:00Z':null,
      user:{login:x.prAuthor||'author'},
      head:{ref:'ai/ticket_abc',sha:x.head||HEAD,
        repo:{full_name:'example/repo'}},
      base:{ref:x.prBase||'main',repo:{full_name:'example/repo'}}
    });
    if(pathname.endsWith('/branches/main'))
      return respond({commit:{sha:x.base||BASE}});
    if(pathname.endsWith('/git/commits/'+HEAD))
      return respond({sha:HEAD,tree:{sha:x.tree||TREE},parents:[{sha:BASE}]});
    if(pathname.endsWith('/compare/'+BASE+'...'+HEAD))
      return respond({status:'ahead',ahead_by:1,behind_by:0,total_commits:1,
        files:[{filename:'src/feature.ts',status:'modified'}]});
    if(pathname.endsWith('/pulls/41/files'))
      return respond([{filename:'src/feature.ts',status:'modified'},
        ...(x.extraFile?[{filename:'src/secret.ts',status:'modified'}]:[])]);
    if(pathname.endsWith('/commits/'+HEAD+'/check-runs'))
      return respond({total_count:x.checkCount??1,check_runs:[{
        name:'CI / tests',head_sha:HEAD,app:{slug:'github-actions'},
        status:'completed',conclusion:x.checksFail?'failure':'success'
      }]});
    if(pathname.endsWith('/pulls/41/reviews'))
      return respond(x.incompleteReviews?Array.from({length:100},()=>({
        user:{login:'spam',type:'User'},state:'APPROVED',commit_id:HEAD,
        submitted_at:'2026-11-18T11:00:00Z'
      })):[{id:1,user:{login:'reviewer',type:'User'},state:x.changesRequested?'CHANGES_REQUESTED':'APPROVED',
        commit_id:x.approvalCommit||HEAD,submitted_at:'2026-11-18T11:00:00Z'}]);
    throw Error('Unexpected read '+pathname);
  };
  return {input:{...data,fetcher},calls};
}
test('Owner review snapshot is READ-ONLY and independent approval + exact checks make ready',async()=>{
  const x=scenario();
  const result=await inspectGithubPrReview(x.input);
  assert.equal(result.checked,true,JSON.stringify(result));
  assert.equal(result.ready_for_manual_merge,true,JSON.stringify(result));
  assert.equal(result.merge_performed,false);
  assert.equal(result.main_modified,false);
  assert.equal(result.independent_approvals,1);
  assert.equal(x.calls.length,7);
});
test('a Draft PR remains review-only even with passing checks and approvals',async()=>{
  const result=await inspectGithubPrReview(scenario({draft:true}).input);
  assert.equal(result.ready_for_manual_merge,false);
  assert.ok(result.blocks.includes('GITHUB_DRAFT_PR_REVIEW_REQUIRED'));
});
test('merged PR is not inferred as verified merely from remote claim',async()=>{
  const x=scenario({merged:true});
  const result=await inspectGithubPrReview(x.input);
  assert.equal(result.ready_for_manual_merge,false);
  assert.equal(result.checked,false);
  assert.deepEqual(result.blocks,['GITHUB_PR_ALREADY_CLOSED_USE_MERGE_VERIFIER']);
  assert.equal(x.calls.length,1);
});
for(const [name,opts,reason] of [
  ['stale human review',{approvalCommit:'d'.repeat(40)},'GITHUB_APPROVAL_NOT_VERIFIED'],
  ['open change request',{changesRequested:true},'GITHUB_REVIEW_CHANGES_REQUESTED'],
  ['failed required CI',{checksFail:true},'GITHUB_REQUIRED_CHECKS_MISSING'],
  ['incomplete check pagination',{checkCount:3},'GITHUB_REQUIRED_CHECKS_MISSING'],
  ['incomplete reviewer pagination',{incompleteReviews:true},'GITHUB_APPROVAL_NOT_VERIFIED']
] as const){
  test('read-only review blocks '+name,async()=>{
    const result=await inspectGithubPrReview(scenario(opts).input);
    assert.equal(result.ready_for_manual_merge,false,JSON.stringify(result));
    assert.ok(result.blocks.includes(reason),JSON.stringify(result.blocks));
  });
}
for(const [name,opts,reason] of [
  ['different head',{head:'d'.repeat(40)},'GITHUB_PR_IDENTITY_CHANGED'],
  ['different target branch',{prBase:'dev'},'GITHUB_PR_IDENTITY_CHANGED'],
  ['base moved after QA',{base:'d'.repeat(40)},'GITHUB_PR_BASELINE_MOVED_RETEST_REQUIRED'],
  ['tree changed',{tree:'d'.repeat(40)},'GITHUB_PR_HEAD_TREE_NOT_TESTED'],
  ['added unauthorized file',{extraFile:true},'GITHUB_PR_FILES_CHANGED']
] as const){
  test('untrusted remote '+name+' denied',async()=>{
    const result=await inspectGithubPrReview(scenario(opts).input);
    assert.equal(result.ready_for_manual_merge,false);
    assert.ok(result.blocks.includes(reason),JSON.stringify(result.blocks));
  });
}
test('missing token or invalid target base branch never touches GitHub',async()=>{
  const a=scenario(),b=scenario();
  assert.equal((await inspectGithubPrReview({...a.input,token:''})).ready_for_manual_merge,false);
  assert.equal((await inspectGithubPrReview({...b.input,baseBranch:'../../main'})).ready_for_manual_merge,false);
  assert.equal(a.calls.length,0);
  assert.equal(b.calls.length,0);
});
test('GitHub outage blocks review without fabricating approval',async()=>{
  const x=scenario();
  const result=await inspectGithubPrReview({...x.input,
    fetcher:async()=>{throw Error('no network');}});
  assert.equal(result.ready_for_manual_merge,false);
  assert.deepEqual(result.blocks,['GITHUB_PR_REVIEW_API_UNAVAILABLE']);
});
test('latest dismissed review overrides an earlier approved review',()=>{
  const policy=evaluateGithubReviewPolicy({
    checks:{total_count:1,check_runs:[{name:'CI / tests',head_sha:HEAD,
      app:{slug:'github-actions'},status:'completed',conclusion:'success'}]},
    reviews:[
      {id:1,user:{login:'reviewer',type:'User'},state:'APPROVED',commit_id:HEAD,
        submitted_at:'2026-11-18T11:00:00Z'},
      {id:2,user:{login:'Reviewer',type:'User'},state:'DISMISSED',commit_id:HEAD,
        submitted_at:'2026-11-20T12:00:00Z'}
    ],
    headSha:HEAD,prAuthor:'author',requiredChecks:['CI / tests'],
    requiredApprovals:1,checkAppSlug:'github-actions',
    cutoff:'2026-11-20T13:00:00Z'
  });
  assert.equal(policy.independent_reviews_passed,false);
  assert.equal(policy.independent_approvals,0);
});


test('unreadable later dismissal/change request cannot preserve earlier approval',()=>{
  const context={
    checks:{total_count:1,check_runs:[{name:'CI / tests',head_sha:HEAD,
      app:{slug:'github-actions'},status:'completed',conclusion:'success'}]},
    headSha:HEAD,prAuthor:'author',requiredChecks:['CI / tests'],
    requiredApprovals:1,checkAppSlug:'github-actions',
    cutoff:'2026-11-20T13:00:00Z'
  };
  const approved={id:1,user:{login:'reviewer',type:'User'},state:'APPROVED',
    commit_id:HEAD,submitted_at:'2026-11-18T11:00:00Z'};
  for(const later of [
    {id:2,user:{login:'reviewer',type:'User'},state:'CHANGES_REQUESTED',
      commit_id:HEAD,submitted_at:'broken-timestamp'},
    {id:2,user:{login:'reviewer',type:'User'},state:'DISMISSED',
      commit_id:HEAD,submitted_at:null},
    {id:2,user:{login:'reviewer',type:'User'},state:'UNRECOGNIZED',
      commit_id:HEAD,submitted_at:'2026-11-19T11:00:00Z'},
    null
  ]){
    const decision=evaluateGithubReviewPolicy({...context,reviews:[approved,later]});
    assert.equal(decision.independent_reviews_passed,false);
    assert.equal(decision.independent_approvals,0);
    assert.ok(decision.blocks.includes('GITHUB_APPROVAL_NOT_VERIFIED'));
  }
});
