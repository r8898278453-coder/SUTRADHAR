/**
 * Read-only remote proof for a v7 independently QA-accepted candidate tree.
 * This function NEVER performs a GitHub write, push, PR creation or merge.
 */
export type GitRemoteInput = {
  repo:string;token:string;branch:string;baseline:string;tree:string;
  writeScopes:string[];expectedHead?:string;
  fetcher?:(url:string,init?:RequestInit)=>Promise<Response>;
};
export type GitRemoteProof =
  | {verified:true;headSha:string;treeSha:string;baseline:string;branch:string;changedFiles:string[]}
  | {verified:false;error_code:string};
const sha=/^[0-9a-f]{40}$/,repoRe=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  branchRe=/^ai\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
export async function inspectGitRemote(x:GitRemoteInput):Promise<GitRemoteProof>{
  const denied=(error_code:string):GitRemoteProof=>({verified:false,error_code});
  if(!repoRe.test(x.repo)||!branchRe.test(x.branch)||!sha.test(x.baseline)||
    !sha.test(x.tree)||!x.token?.trim()||!x.writeScopes?.length||
    (x.expectedHead!==undefined&&!sha.test(x.expectedHead)))return denied('REMOTE_PROOF_NOT_CONFIGURED');
  const allowed=(file:string)=>x.writeScopes.some(s=>file===s||file.startsWith(s+'/'));
  const origin='https://api.github.com/repos/'+x.repo;
  const fetcher=x.fetcher||fetch;
  async function read(uri:string){
    const response=await fetcher(origin+uri,{method:'GET',headers:{
      Authorization:'Bearer '+x.token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('GITHUB_HTTP_FAILURE');
    return response.json();
  }
  try{
    const branch=await read('/branches/'+x.branch.split('/').map(encodeURIComponent).join('/'));
    const head=String(branch?.commit?.sha||'');
    if(!sha.test(head)||head===x.baseline||(x.expectedHead&&x.expectedHead!==head))
      return denied('REMOTE_HEAD_MISMATCH');
    const [commit,comparison]=await Promise.all([
      read('/git/commits/'+head),
      read('/compare/'+x.baseline+'...'+head)
    ]);
    if(commit?.sha!==head||commit?.tree?.sha!==x.tree||
      !Array.isArray(commit?.parents)||commit.parents.length!==1||
      commit.parents[0]?.sha!==x.baseline||
      comparison?.status!=='ahead'||comparison?.ahead_by!==1||
      comparison?.behind_by!==0||comparison?.total_commits!==1||
      !Array.isArray(comparison?.files)||!comparison.files.length||
      comparison.files.length>99)return denied('REMOTE_COMMIT_TREE_BASELINE_MISMATCH');
    const changedFiles:string[]=[];
    for(const file of comparison.files){
      if(typeof file?.filename!=='string'||!file.filename||
        file.filename.startsWith('/')||file.filename.includes('\\')||
        file.filename.split('/').some((p:string)=>!p||p==='.'||p==='..')||
        !['added','modified'].includes(file.status)||file.previous_filename||
        !allowed(file.filename))return denied('REMOTE_CHANGED_FILE_SCOPE_MISMATCH');
      changedFiles.push(file.filename);
    }
    if(new Set(changedFiles).size!==changedFiles.length)return denied('REMOTE_DUPLICATE_CHANGED_FILES');
    return {verified:true,headSha:head,treeSha:x.tree,baseline:x.baseline,
      branch:x.branch,changedFiles:changedFiles.sort()};
  }catch{return denied('GITHUB_READ_UNAVAILABLE');}
}
