/**
 * SUTRADHAR v7: Owner READ-ONLY GitHub pre-merge review/CI status.
 * No PR creation, transition-to-ready, merge, status update, push or deploy.
 * This is a snapshot, NOT an authorization to bypass GitHub branch protection.
 */
import {evaluateGithubReviewPolicy} from './github_review_policy.ts';
import {safeScope} from './rules.ts';
import {githubApiJson} from './github_api_json.ts';
export type PrReviewInput={
  repo:string;token:string;prNumber:number;baseBranch:string;branch:string;
  baselineSha:string;headSha:string;treeSha:string;changedFiles:string[];
  requiredChecks:string[];requiredApprovals:number;
  fetcher?:(url:string,init?:RequestInit)=>Promise<Response>;
};
const SHA=/^[a-f0-9]{40}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const SAFE_PATH=(x:any)=>typeof x==='string'&&x.length>0&&x.length<450&&
  !x.startsWith('/')&&!x.startsWith('-')&&!x.includes('\\')&&
  x.split('/').every(p=>p.length>0&&p!=='.'&&p!=='..');
function blocked(reason:string,details:any={}){
  return {checked:false,ready_for_manual_merge:false,blocks:[reason],
    read_only:true,merge_performed:false,main_modified:false,
    production_deployed:false,...details};
}
export async function inspectGithubPrReview(input:PrReviewInput){
  if(!REPO.test(input.repo||'')||!/^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(input.branch||'')||
     !REF.test(input.baseBranch||'')||input.baseBranch.includes('..')||
     input.baseBranch.includes('//')||input.baseBranch.endsWith('/')||
     !SHA.test(input.baselineSha||'')||!SHA.test(input.headSha||'')||
     !SHA.test(input.treeSha||'')||
     !Number.isSafeInteger(input.prNumber)||input.prNumber<1||
     !input.token?.trim()||!Array.isArray(input.changedFiles)||
     input.changedFiles.length<1||input.changedFiles.length>=100||
     new Set(input.changedFiles).size!==input.changedFiles.length||
     !input.changedFiles.every(f=>SAFE_PATH(f)&&safeScope(f))||
     !Array.isArray(input.requiredChecks)||input.requiredChecks.length<1||
     !Number.isSafeInteger(input.requiredApprovals)||input.requiredApprovals<1||
     input.requiredApprovals>5)
    return blocked('GITHUB_PR_REVIEW_NOT_CONFIGURED');
  const api='https://api.github.com/repos/'+input.repo;
  const request=input.fetcher||fetch;
  async function getJson(uri:string):Promise<any>{
    return githubApiJson(api+uri,input.token,request);
  }
  try{
    const p=await getJson('/pulls/'+input.prNumber);
    if(p?.number!==input.prNumber||
       p?.head?.sha!==input.headSha||p?.head?.ref!==input.branch||
       p?.head?.repo?.full_name!==input.repo||
       p?.base?.ref!==input.baseBranch||p?.base?.repo?.full_name!==input.repo||
       p?.commits!==1||p?.changed_files!==input.changedFiles.length||
       typeof p?.user?.login!=='string')
      return blocked('GITHUB_PR_IDENTITY_CHANGED');
    if(p.state!=='open'||p.merged_at){
      return blocked('GITHUB_PR_ALREADY_CLOSED_USE_MERGE_VERIFIER',{
        ticket_bound_head_sha:input.headSha,pr_number:input.prNumber,
        draft:Boolean(p.draft),remote_merge_claimed:Boolean(p.merged_at)});
    }
    const baseEncoded=input.baseBranch.split('/').map(encodeURIComponent).join('/');
    const [base,commit,diff,files,checks,reviews]=await Promise.all([
      getJson('/branches/'+baseEncoded),
      getJson('/git/commits/'+input.headSha),
      getJson('/compare/'+input.baselineSha+'...'+input.headSha),
      getJson('/pulls/'+input.prNumber+'/files?per_page=100'),
      getJson('/commits/'+input.headSha+'/check-runs?per_page=100'),
      getJson('/pulls/'+input.prNumber+'/reviews?per_page=100')
    ]);
    if(base?.commit?.sha!==input.baselineSha)
      return blocked('GITHUB_PR_BASELINE_MOVED_RETEST_REQUIRED');
    // Branch protection is necessary, not sufficient for release.
    // Missing GitHub metadata must never be represented as Owner merge-ready.
    if(base?.protected!==true)
      return blocked('GITHUB_PR_BASE_BRANCH_NOT_PROTECTED');
    if(commit?.sha!==input.headSha||commit?.tree?.sha!==input.treeSha||
       !Array.isArray(commit.parents)||commit.parents.length!==1||
       commit.parents[0]?.sha!==input.baselineSha||
       diff?.status!=='ahead'||diff?.ahead_by!==1||
       diff?.behind_by!==0||diff?.total_commits!==1)
      return blocked('GITHUB_PR_HEAD_TREE_NOT_TESTED');
    const allowed=new Set(input.changedFiles);
    const exactFiles=(entries:any[])=>entries.length===allowed.size&&
      entries.length<100&&entries.every((f:any)=>SAFE_PATH(f?.filename)&&
        safeScope(f.filename)&&
        allowed.has(f.filename)&&
        ['added','modified'].includes(f.status)&&!f.previous_filename);
    if(!Array.isArray(files)||!exactFiles(files)||
       !Array.isArray(diff.files)||!exactFiles(diff.files))
      return blocked('GITHUB_PR_FILES_CHANGED');
    const policy=evaluateGithubReviewPolicy({
      checks,reviews,headSha:input.headSha,prAuthor:p.user.login,
      requiredChecks:input.requiredChecks,
      requiredApprovals:input.requiredApprovals,
      checkAppSlug:'github-actions',cutoff:new Date().toISOString()
    });
    const blocks=[...(p.draft===true?['GITHUB_DRAFT_PR_REVIEW_REQUIRED']:[]),...policy.blocks];
    if(p.draft!==true&&p.draft!==false)blocks.push('GITHUB_PR_DRAFT_STATE_UNTRUSTED');
    return {checked:true,ready_for_manual_merge:blocks.length===0,
      blocks,repository:input.repo,pr_number:input.prNumber,branch:input.branch,
      base_branch:input.baseBranch,head_sha:input.headSha,tree_sha:input.treeSha,
      baseline_sha:input.baselineSha,draft:p.draft,
      independent_approvals:policy.independent_approvals,
      required_approvals:policy.required_approvals,
      required_checks:policy.required_checks,
      checks_passed:policy.checks_passed,
      independent_reviews_passed:policy.independent_reviews_passed,
      snapshot_only:true,external_human_merge_required:true,
      read_only:true,merge_performed:false,main_modified:false,
      production_deployed:false};
  }catch{return blocked('GITHUB_PR_REVIEW_API_UNAVAILABLE');}
}
