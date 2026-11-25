/**
 * Bounded no-redirect transport shared by GitHub source/CI proof readers.
 * Remote JSON is untrusted even when the URL is GitHub's API.
 * Never logs a bearer token or treats an incomplete response as proof.
 */
export type GithubApiFetcher=(url:string,init?:RequestInit)=>Promise<Response>;
// Reject URL normalization/traversal before a bearer credential is attached.
// The repo and endpoint path are deliberately narrower than arbitrary URLs.
function validRepositoryApiUrl(value:unknown):value is string{
  if(typeof value!=='string'||value.length>4096||
    !value.startsWith('https://api.github.com/repos/')||
    /[\u0000-\u0020\u007f\\#]/.test(value))return false;
  try{
    const url=new URL(value);
    if(url.origin!=='https://api.github.com'||url.username||url.password||
      url.hash||url.href!==value)return false;
    const raw=value.slice('https://api.github.com/repos/'.length).split('?')[0];
    const parts=raw.split('/');
    if(parts.length<3||!parts.slice(0,2).every(p=>
      /^[A-Za-z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'))return false;
    return parts.slice(2).every(p=>{
      const decoded=decodeURIComponent(p);
      return /^[A-Za-z0-9._~-]+$/.test(decoded)&&decoded!=='.'&&decoded!=='..';
    });
  }catch{return false;}
}

export async function githubApiJson(url:string,token:string,fetcher:GithubApiFetcher,{
  method='GET',data
}:{method?:'GET'|'POST';data?:unknown}={}):Promise<any>{
  if(!validRepositoryApiUrl(url)||
     typeof token!=='string'||!token.trim()||token.length>8192||
     (method!=='GET'&&method!=='POST')||
     (method==='GET'&&data!==undefined))
    throw Error('GITHUB_BOUNDED_REQUEST_INVALID');
  const response=await fetcher(url,{
    method,redirect:'error',credentials:'omit',cache:'no-store',
    headers:{Authorization:'Bearer '+token,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      ...(data===undefined?{}:{'Content-Type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)}),
    signal:AbortSignal.timeout(15000)
  });
  const max=256*1024;
  const header=response?.headers?.get('content-length');
  if(!response||response.ok!==true||!response.body?.getReader||
    (header!==null&&header!==undefined&&
      (!/^\d+$/.test(header)||Number(header)>max)))
    throw Error('GITHUB_BOUNDED_RESPONSE_UNTRUSTED');
  const reader=response.body.getReader(),parts:Buffer[]=[];
  let length=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error('GITHUB_BOUNDED_CHUNK_INVALID');
      length+=value.byteLength;
      if(length>max)throw Error('GITHUB_BOUNDED_RESPONSE_OVERSIZED');
      parts.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  if(length===0)throw Error('GITHUB_BOUNDED_EMPTY_RESPONSE');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
    Buffer.concat(parts)));
}
