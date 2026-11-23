/**
 * Bounded no-redirect transport shared by GitHub source/CI proof readers.
 * Remote JSON is untrusted even when the URL is GitHub's API.
 * Never logs a bearer token or treats an incomplete response as proof.
 */
export type GithubApiFetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export async function githubApiJson(url:string,token:string,fetcher:GithubApiFetcher,{
  method='GET',data
}:{method?:'GET'|'POST';data?:unknown}={}):Promise<any>{
  if(typeof url!=='string'||!url.startsWith('https://api.github.com/repos/')||
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
