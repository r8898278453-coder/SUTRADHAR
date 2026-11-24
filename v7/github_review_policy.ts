/**
 * Shared READ-ONLY GitHub independent-review/required-CI policy.
 * A GitHub APPPROVED review is evidence ONLY for its exact review.commit_id.
 * This module never sends network requests, authenticates an Owner or merges.
 */
export type GithubReviewPolicyInput={
  checks:any;reviews:any;headSha:string;prAuthor:string;
  requiredChecks:string[];requiredApprovals:number;checkAppSlug:string;
  cutoff:string;
};
export type GithubReviewPolicyDecision={
  checks_passed:boolean;independent_reviews_passed:boolean;
  independent_approvals:number;required_approvals:number;
  required_checks:string[];blocks:string[];
};
const strictHead=/^[a-f0-9]{40}$/;
export function evaluateGithubReviewPolicy(x:GithubReviewPolicyInput):GithubReviewPolicyDecision{
  const blockers:string[]=[];
  const checkNames=x.requiredChecks;
  const stamp=Date.parse(x.cutoff||'');
  const configured= strictHead.test(x.headSha||'') &&
    Array.isArray(checkNames)&&checkNames.length>0&&checkNames.length<=30&&
    checkNames.every(s=>typeof s==='string'&&s.length>0&&s.length<=150&&s.trim()===s) &&
    new Set(checkNames).size===checkNames.length &&
    Number.isSafeInteger(x.requiredApprovals)&&x.requiredApprovals>=1&&
    x.requiredApprovals<=5&&typeof x.checkAppSlug==='string'&&
    /^[a-z0-9-]{2,60}$/.test(x.checkAppSlug)&&
    typeof x.prAuthor==='string'&&x.prAuthor.length>0&&
    Number.isFinite(stamp);
  if(!configured){
    return {checks_passed:false,independent_reviews_passed:false,
      independent_approvals:0,required_approvals:x.requiredApprovals||0,
      required_checks:Array.isArray(checkNames)?checkNames:[],
      blocks:['GITHUB_REVIEW_POLICY_NOT_CONFIGURED']};
  }
  const c=x.checks;
  let checksPassed=false;
  if(c&&Array.isArray(c.check_runs)&&
     Number.isSafeInteger(c.total_count)&&c.total_count<100&&
     c.total_count===c.check_runs.length){
    checksPassed=checkNames.every(name=>{
      const matching=c.check_runs.filter((run:any)=>
        run?.name===name&&run?.head_sha===x.headSha&&
        run?.app?.slug===x.checkAppSlug);
      return matching.length===1&&matching[0].status==='completed'&&
        matching[0].conclusion==='success';
    });
  }
  if(!checksPassed)blockers.push('GITHUB_REQUIRED_CHECKS_MISSING');
  let independentApprovals=0,changesRequested=false;
  // An incomplete/malformed later dismissal or CHANGES_REQUESTED must
  // never disappear while an older APPROVED vote remains counted.
  const knownStates=new Set(['APPROVED','CHANGES_REQUESTED','COMMENTED',
    'DISMISSED','PENDING']);
  const reviewsValid=Array.isArray(x.reviews)&&x.reviews.length<100&&
    x.reviews.every((r:any)=>r&&typeof r==='object'&&!Array.isArray(r)&&
      typeof r.user?.login==='string'&&r.user.login.length>0&&
      r.user.login.length<=100&&typeof r.state==='string'&&
      knownStates.has(r.state)&&typeof r.submitted_at==='string'&&
      Number.isFinite(Date.parse(r.submitted_at)));
  if(reviewsValid){
    const chronological=x.reviews
      .filter((review:any)=>Date.parse(review.submitted_at)<=stamp)
      .sort((a:any,b:any)=>{
        const dateDiff=Date.parse(a.submitted_at)-Date.parse(b.submitted_at);
        return dateDiff || (Number(a.id||0)-Number(b.id||0));
      });
    const latest=new Map<string,any>();
    // A comment is not an approval, dismissal or withdrawal of an active
    // change request. Preserve the last decisive review for each login.
    let ambiguous=false;
    for(const review of chronological){
      if(review.state==='COMMENTED'||review.state==='PENDING')continue;
      const user=review.user.login.toLowerCase();
      const prior=latest.get(user);
      if(prior&&Date.parse(prior.submitted_at)===Date.parse(review.submitted_at)&&
         (!Number.isSafeInteger(prior.id)||prior.id<1||
          !Number.isSafeInteger(review.id)||review.id<1||prior.id===review.id)){
        ambiguous=true;break;
      }
      latest.set(user,review);
    }
    if(ambiguous){
      blockers.push('GITHUB_APPROVAL_NOT_VERIFIED');
      return {checks_passed:checksPassed,independent_reviews_passed:false,
        independent_approvals:0,required_approvals:x.requiredApprovals,
        required_checks:[...checkNames],blocks:blockers};
    }
    for(const [user,review] of latest){
      if(user===x.prAuthor.toLowerCase())continue;
      if(review.state==='CHANGES_REQUESTED')changesRequested=true;
      // GitHub Bot approvals are not independent human code reviews.
      if(review.state==='APPROVED'&&review.user?.type==='User'&&
         review.commit_id===x.headSha)
        independentApprovals++;
    }
  }
  if(changesRequested)blockers.push('GITHUB_REVIEW_CHANGES_REQUESTED');
  const reviewPassed=reviewsValid&&!changesRequested&&
    independentApprovals>=x.requiredApprovals;
  if(!reviewPassed&&!changesRequested)blockers.push('GITHUB_APPROVAL_NOT_VERIFIED');
  return {checks_passed:checksPassed,independent_reviews_passed:reviewPassed,
    independent_approvals:independentApprovals,
    required_approvals:x.requiredApprovals,
    required_checks:[...checkNames],blocks:blockers};
}
