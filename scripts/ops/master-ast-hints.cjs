'use strict';
// Developer CLI uses the same bounded parser as packaged Desktop.
const ts=require('typescript');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {TextDecoder}=require('node:util');
const parser=require('../../apps/desktop/master-ast-parser.cjs');
const {LIMITS,safePath,source,resolveReference}=parser;
const parseReferences=(file,raw)=>parser.parseReferences(ts,file,raw);
const sha=s=>typeof s==='string'&&s.length===40&&/^[a-f0-9]{40}$/.test(s);
const order=(a,b)=>a<b?-1:a>b?1:0;
const fail=code=>{throw Error(code);};
function inspectSnapshot(repo,commit,paths){
  if(typeof repo!=='string'||!path.isAbsolute(repo)||!sha(commit)||!Array.isArray(paths)||
     !paths.length||paths.length>LIMITS.files||paths.some(p=>!safePath(p)||!source(p))||
     new Set(paths.map(p=>p.toLowerCase())).size!==paths.length)fail('AST_REQUEST_INVALID');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
  Object.assign(env,{GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'});
  function read(max,...args){
    const result=spawnSync('git',['--no-optional-locks','-c','protocol.allow=never','-c','core.fsmonitor=false','-C',repo,...args],
      {env,encoding:null,timeout:5000,maxBuffer:max,windowsHide:true});
    if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout)||result.stdout.length>max)fail('AST_GIT_READ_FAILED');
    return result.stdout;
  }
  const fs=require('node:fs');
  const root=read(4096,'rev-parse','--show-toplevel').toString('utf8').replace(/\r?\n$/,'');
  if(fs.realpathSync(root)!==fs.realpathSync(repo))fail('AST_REPOSITORY_ROOT_MISMATCH');
  if(read(128,'cat-file','-t',commit).toString('ascii').trim()!=='commit')fail('AST_COMMIT_INVALID');
  const tree=read(128,'rev-parse','--verify',commit+'^{tree}').toString('ascii').trim();
  if(!sha(tree))fail('AST_TREE_INVALID');
  const inventory=new Map(),aliases=new Set();
  const listing=new TextDecoder('utf-8',{fatal:true}).decode(read(LIMITS.tree,'ls-tree','-r','-z',tree));
  for(const line of listing.split('\0')){
    if(!line)continue;
    const m=/^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
    if(!m||!safePath(m[4]))continue;
    const key=m[4].toLowerCase();
    if(aliases.has(key))fail('AST_TREE_PATH_ALIAS');
    aliases.add(key);
    if(m[1]==='100644'||m[1]==='100755')inventory.set(m[4],m[3]);
  }
  const files=[],edges=[];
  for(const file of [...paths].sort(order)){
    const row={source_path:file,status:'MISSING',resolved:0,ambiguous:0,missing:0,unsupported:0};
    files.push(row);
    if(!inventory.has(file))continue;
    const blob=inventory.get(file);
    const sizeText=read(128,'cat-file','-s',blob).toString('ascii').trim();
    if(!/^(?:0|[1-9][0-9]*)$/.test(sizeText))fail('AST_BLOB_SIZE_INVALID');
    const size=Number(sizeText);
    if(!Number.isSafeInteger(size)||size>LIMITS.blob){row.status='SIZE_LIMIT';continue;}
    const raw=read(LIMITS.blob,'cat-file','blob',blob);
    if(raw.length!==size)fail('AST_BLOB_SIZE_MISMATCH');
    let parsed;try{parsed=parseReferences(file,raw);}catch(e){
      if(e.message!=='AST_SOURCE_ENCODING')throw e;
      row.status='ENCODING_ERROR';continue;
    }
    row.status=parsed.status;row.unsupported=parsed.unknown;
    for(const spec of parsed.references){
      const result=resolveReference(file,spec,inventory);
      if(result.status==='RESOLVED'){
        row.resolved++;
        if(edges.length<LIMITS.edges)edges.push({source_path:file,target_path:result.target});
      }else if(result.status==='AMBIGUOUS')row.ambiguous++;
      else if(result.status==='MISSING')row.missing++;
      else row.unsupported++;
    }
  }
  return {schema:'SUTRADHAR_AST_HINTS_V1',commit_sha:commit,tree_sha:tree,files,edges,
    edges_truncated:files.reduce((n,f)=>n+f.resolved,0)>edges.length,
    source_contents_returned:false,semantic_discovery_verified:false,remote_freshness_verified:false,
    provider_sent:false,automatic_execution_allowed:false};
}
module.exports={parseReferences,resolveReference,inspectSnapshot};
if(require.main===module){
  try{const [repo,commit,...files]=process.argv.slice(2);process.stdout.write(JSON.stringify(inspectSnapshot(repo,commit,files),null,2)+'\n');}
  catch{process.stderr.write('AST inspection refused; review local input and repository. No execution authorized.\n');process.exitCode=1;}
}
