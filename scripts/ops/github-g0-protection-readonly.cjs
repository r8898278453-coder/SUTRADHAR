/**
 * READ-ONLY G0 GitHub branch safety inspection for the non-developer Owner.
 *
 * Uses public GitHub metadata or an optional read-only token. This is a
 * snapshot, not a signing workflow, branch editor, merge authorizer, or
 * independent security review. API uncertainty ALWAYS remains HOLD.
 */
'use strict';
const SHA=/^[a-f0-9]{40}$/,REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function validRepository(value){
  return typeof value==='string'&&value.length<=200&&REPO.test(value)&&
    value.split('/').every(part=>part!=='.'&&part!=='..');
}
const REQUIRED=Object.freeze([
  'TypeScript, unit checks, and build',
  'V7 real MySQL API integration (disposable database)',
  'Windows Desktop unsigned installer smoke (internal QA only)',
  'Review high/critical npm advisories',
  'Verify committed lockfile on windows-latest',
  'Verify committed lockfile on ubuntu-latest',
  'Python syntax, shell syntax, state tests'
]);
function hold(code,detail){
  return {accepted:false,g0_release_gate:'HOLD',
    error_code:code,...(detail?{detail}:{}),
    independent_review_verified:false,release_authorized:false,
    production_release_authorized:false};
}
function inspect({repository,expectedMainSha,branch,rules}={}){
  if(!validRepository(repository)||!SHA.test(expectedMainSha||''))
    return hold('G0_AUDIT_INPUT_INVALID');
  if(!branch||branch.name!=='main'||!branch.commit||
    !SHA.test(branch.commit.sha||'')||branch.commit.sha!==expectedMainSha)
    return hold('G0_MAIN_SHA_MISMATCH_OR_UNVERIFIED');
  if(branch.protected!==true)
    return hold('G0_MAIN_NOT_PROTECTED');
  if(!Array.isArray(rules)||rules.length===0||rules.length>256||
     rules.some(r=>!r||typeof r!=='object'||typeof r.type!=='string'))
    return hold('G0_EFFECTIVE_BRANCH_RULES_UNVERIFIED');
  const types=new Set(rules.map(r=>r.type));
  if(!types.has('non_fast_forward')||!types.has('deletion'))
    return hold('G0_FORCE_PUSH_OR_DELETION_RULE_MISSING');
  const pr=rules.find(r=>r.type==='pull_request'&&
    Number.isSafeInteger(r.parameters?.required_approving_review_count)&&
    r.parameters.required_approving_review_count>=1&&
    r.parameters.dismiss_stale_reviews_on_push===true&&
    r.parameters.require_last_push_approval===true);
  if(!pr)return hold('G0_INDEPENDENT_PR_REVIEW_RULE_MISSING');
  const status=rules.find(r=>r.type==='required_status_checks'&&
    r.parameters?.strict_required_status_checks_policy===true&&
    Array.isArray(r.parameters.required_status_checks)&&
    r.parameters.required_status_checks.length>=REQUIRED.length&&
    REQUIRED.every(name=>r.parameters.required_status_checks.some(c=>
      c&&c.context===name)));
  if(!status)return hold('G0_REQUIRED_EXACT_HEAD_CHECKS_MISSING');
  return {accepted:true,g0_release_gate:'HOLD',
    status:'VISIBLE_GITHUB_RULE_SNAPSHOT_COMPATIBLE_ONLY',
    repository,main_sha:expectedMainSha,
    minimum_required_checks_seen:REQUIRED.slice(),
    branch_metadata_protected:true,
    rules_visible:true,
    bypass_actors_independently_audited:false,
    required_environment_review_verified:false,
    actual_human_review_verified:false,
    independent_review_verified:false,
    release_authorized:false,production_release_authorized:false,
    warning:'Rule snapshot is not proof of bypass policies, actual PR approvals, staging, signed installer, independent CI review or permission to merge/release.'};
}
async function boundedGithubJson(url,{fetcher=fetch,token}={}){
  const headers={Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'SUTRADHAR-readonly-G0-check'};
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetcher(url,{method:'GET',headers,
    redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(10000)});
  if(!response||response.ok!==true||
     !response.body||typeof response.body.getReader!=='function')
    throw Error('G0_GITHUB_API_UNAVAILABLE');
  const len=response.headers?.get('content-length');
  if(len&&(!/^\d+$/.test(len)||Number(len)>131072))
    throw Error('G0_GITHUB_RESPONSE_OVERSIZED');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw Error('G0_GITHUB_RESPONSE_INVALID');
      size+=value.byteLength;
      if(size>131072)throw Error('G0_GITHUB_RESPONSE_OVERSIZED');
      parts.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
    Buffer.concat(parts)));
}
async function audit({repository,expectedMainSha,fetcher=fetch,token}={}){
  if(!validRepository(repository)||!SHA.test(expectedMainSha||'')||
     (token!==undefined&&(typeof token!=='string'||token.length>1024)))
    return hold('G0_AUDIT_INPUT_INVALID');
  try{
    const base='https://api.github.com/repos/'+repository;
    // The branch rules endpoint provides visible applicable rules. Do not
    // assume it exhaustively proves classic protection or bypass settings.
    // A missing/403 response remains HOLD.
    const [branch,rules]=await Promise.all([
      boundedGithubJson(base+'/branches/main',{fetcher,token}),
      boundedGithubJson(base+'/rules/branches/main',{fetcher,token})
    ]);
    const result=inspect({repository,expectedMainSha,branch,rules});
    if(!result.accepted)return result;
    const after=await boundedGithubJson(base+'/branches/main',{fetcher,token});
    if(after?.name!=='main'||after?.protected!==true||
      after?.commit?.sha!==expectedMainSha)
      return hold('G0_MAIN_CHANGED_DURING_AUDIT');
    return result;
  }catch{return hold('G0_GITHUB_READ_ONLY_AUDIT_UNAVAILABLE');}
}
async function main(){
  const result=await audit({
    repository:process.env.SUTRADHAR_G0_REPOSITORY,
    expectedMainSha:process.env.SUTRADHAR_G0_EXPECTED_MAIN_SHA,
    token:process.env.GITHUB_TOKEN});
  console.log(JSON.stringify(result,null,2));
  if(!result.accepted)process.exitCode=1;
}
if(require.main===module)main();
module.exports={audit,inspect,REQUIRED,boundedGithubJson};
