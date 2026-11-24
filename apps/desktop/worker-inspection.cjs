/**
 * Packaged Windows OS-vault worker discovery -- READ ONLY.
 * Runs in Electron MAIN, not the renderer or the supervised heartbeat child.
 * Neither private key nor arbitrary signing operations are returned to UI.
 */
'use strict';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
const SHA=/^[0-9a-f]{40}$/;
const crypto=require('node:crypto');
const {safeScopedPath}=require('./worker-scoped-path.cjs');
const MAX_BYTES=96*1024;
const fail=(code)=>{throw Error(code);};
function plainList(value,max){if(typeof value==='string'){
    try{value=JSON.parse(value);}catch{fail('WORKER_INSPECTION_RESPONSE_INVALID');}
  }
  if(!Array.isArray(value)||value.length>max)return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return value;
}
function validText(v,max){
  // Reject lone UTF-16 surrogates: UTF-8 hashing would replace them silently.
  return typeof v==='string'&&v.length<=max&&!/[\uD800-\uDFFF]/u.test(v);
}
function validId(v){return typeof v==='string'&&ID.test(v);}
function validVersion(v){
  return (typeof v==='number'||(typeof v==='string'&&/^[1-9][0-9]*$/.test(v)))&&
    Number.isSafeInteger(Number(v))&&Number(v)>=1;
}
function textField(v,max){
  if(!validText(v,max))return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return v;
}
function taskItem(x){
  if(!x||!validId(x.ticket_id)||!validId(x.project_id)||
    !['LOW','MEDIUM','HIGH','CORE'].includes(x.risk)||!validVersion(x.version))
    return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return {ticket_id:x.ticket_id,project_id:x.project_id,
    title:textField(x.title,220),risk:x.risk,version:Number(x.version)};
}
function providerDeclarations(x){
  const state=x.provider_mapping_state??'UNCONFIGURED',list=x.provider_mappings??[];
  if(!['NOT_APPLICABLE','UNCONFIGURED','INVALID_OWNER_CONFIGURATION','OWNER_DECLARED_UNVERIFIED'].includes(state)||
     !Array.isArray(list)||list.length>2||
     (state==='OWNER_DECLARED_UNVERIFIED')!==(list.length>0))
    fail('WORKER_PROVIDER_MAPPING_INVALID');
  const seen=new Set();
  const mappings=list.map(m=>{
    if(!m||typeof m!=='object'||Array.isArray(m)||
       Object.keys(m).sort().join('|')!=='account_ref|automatic_execution_allowed|binding_sha256|provider|provider_mapping_verified|state|workspace_ref'||
       !['CHATGPT_WEB','GOOGLE_AI_STUDIO'].includes(m.provider)||seen.has(m.provider)||
       typeof m.account_ref!=='string'||!/^account_[A-Za-z0-9_-]{3,64}$/.test(m.account_ref)||
       typeof m.workspace_ref!=='string'||!/^workspace_[A-Za-z0-9_-]{3,96}$/.test(m.workspace_ref)||
       m.state!=='OWNER_DECLARED_UNVERIFIED'||m.provider_mapping_verified!==false||
       m.automatic_execution_allowed!==false||!validId(x.worker_agent_id))
      fail('WORKER_PROVIDER_MAPPING_INVALID');
    const binding={project_id:x.project_id,agent_id:x.worker_agent_id,provider:m.provider,
      account_ref:m.account_ref,workspace_ref:m.workspace_ref};
    if(m.binding_sha256!==crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex'))
      fail('WORKER_PROVIDER_MAPPING_INVALID');
    seen.add(m.provider);
    return {...m};
  });
  const source=x.provider_mapping_source??'LEGACY_RESPONSE_UNCLASSIFIED';
  const version=x.provider_registry_version??null;
  if(!['MYSQL_OWNER_REGISTRY','LEGACY_ENV_CONFIGURATION','NOT_APPLICABLE','INVALID','LEGACY_RESPONSE_UNCLASSIFIED'].includes(source)||
     (source==='MYSQL_OWNER_REGISTRY'&&(!Number.isSafeInteger(version)||version<1))||
     (source==='LEGACY_ENV_CONFIGURATION'&&version!==0)||
     (!['MYSQL_OWNER_REGISTRY','LEGACY_ENV_CONFIGURATION'].includes(source)&&version!==null)||
     (source==='NOT_APPLICABLE'&&state!=='NOT_APPLICABLE')||
     (source==='INVALID'&&state!=='INVALID_OWNER_CONFIGURATION')||
     (['MYSQL_OWNER_REGISTRY','LEGACY_ENV_CONFIGURATION'].includes(source)&&
       !['OWNER_DECLARED_UNVERIFIED','UNCONFIGURED'].includes(state)))
    fail('WORKER_PROVIDER_MAPPING_INVALID');
  return {provider_mapping_state:state,provider_mappings:mappings,
    provider_mapping_source:source,provider_registry_version:version};
}
function contractDeclaration(value){
  // An older Central response is unclassified, never verified conflict-free.
  if(value===undefined||value===null)return null;
  if(!Array.isArray(value)||value.length>12||
     value.some(x=>typeof x!=='string'||x.length>96||
       !/^(?:api|db|interface|event):[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/.test(x))||
     value.some((x,i)=>value.some((y,j)=>j>i&&
       (x===y||x.startsWith(y+'.')||y.startsWith(x+'.'))))||
     JSON.stringify(value)!==JSON.stringify([...value].sort()))
    fail('WORKER_CONTRACT_DECLARATION_INVALID');
  return [...value];
}
function detailItem(x,expectedId){
  if(!x||!validId(expectedId)||x.ticket_id!==expectedId||!validId(x.project_id)||
    typeof x.repository!=='string'||typeof x.baseline_sha!=='string'||typeof x.branch_name!=='string'||
    (x.worker_agent_id!=null&&!validId(x.worker_agent_id))||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(x.repository||'')||
    x.repository.split('/').some(part=>part==='.'||part==='..')||
    !SHA.test(x.baseline_sha||'')||
    !/^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(x.branch_name||'')||
    x.branch_name.includes('..')||x.branch_name.endsWith('.')||x.branch_name.endsWith('.lock')||
    !['LOW','MEDIUM','HIGH','CORE'].includes(x.risk)||
    !validVersion(x.version))
    return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const scopes=plainList(x.write_scopes,30),criteria=plainList(x.acceptance_criteria,30);
  if(scopes.some(s=>!validText(s,450))||
    criteria.some(s=>!validText(s,500)))fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const checkpoint=x.latest_checkpoint;
  if(checkpoint!==null&&checkpoint!==undefined&&
     (!checkpoint||typeof checkpoint!=='object'||
      !validVersion(checkpoint.generation)||
      typeof checkpoint.content_sha256!=='string'||
      !/^[a-f0-9]{64}$/.test(checkpoint.content_sha256||'')||
      !validText(checkpoint.summary,8000)||!validText(checkpoint.next_action,500)))
    fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const head=x.candidate_head_sha??null,tree=x.candidate_tree_sha??null;
  if((head===null)!==(tree===null)||
    (head!==null&&(typeof head!=='string'||typeof tree!=='string'||!SHA.test(head)||!SHA.test(tree))))
    fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return {
    ticket_id:x.ticket_id,project_id:x.project_id,
    repository:x.repository,title:textField(x.title,220),
    description:textField(x.description,10000),
    branch_name:x.branch_name,baseline_sha:x.baseline_sha,
    risk:x.risk,status:textField(x.status,40),
    version:Number(x.version),write_scopes:scopes,
    acceptance_criteria:criteria,
    contract_keys:contractDeclaration(x.contract_keys),
    worker_agent_id:x.worker_agent_id||null,
    ...providerDeclarations(x),
    candidate_head_sha:head,candidate_tree_sha:tree,
    latest_checkpoint:checkpoint?{
      generation:Number(checkpoint.generation),
      summary:checkpoint.summary,next_action:checkpoint.next_action,
      content_sha256:checkpoint.content_sha256
    }:null
  };
}
async function boundedJson(response){
  const claimed=Number(response.headers?.get('content-length'));
  if(Number.isFinite(claimed)&&claimed>MAX_BYTES)fail('WORKER_INSPECTION_RESPONSE_TOO_LARGE');
  if(!response.body||typeof response.body.getReader!=='function')
    fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const reader=response.body.getReader();
  const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES)fail('WORKER_INSPECTION_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  }catch(e){
    try{await reader.cancel();}catch{}
    throw e;
  }finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{fail('WORKER_INSPECTION_RESPONSE_INVALID');}
}
async function inspectWorkerTasks({origin,agentId,ticketId=null,signer,fetcher=fetch}){
  if(typeof origin!=='string'||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin)||
    origin.length>250||!validId(agentId)||
    (ticketId!==null&&!validId(ticketId))||
    !signer||typeof signer.signWorkerReadOnly!=='function')
    fail('WORKER_INSPECTION_INPUT_DENIED');
  // Fixed relative task endpoints: no URL input from the renderer.
  const uri=ticketId===null?'/v7/tasks/available':'/v7/tasks/detail/'+ticketId;
  const headers=signer.signWorkerReadOnly({method:'GET',uri,agent_id:agentId});
  const response=await fetcher(origin+uri,{
    method:'GET',headers:{...headers,Accept:'application/json'},
    redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
    const error=await boundedJson(response);
    const code=typeof error?.error_code==='string'&&
      /^[A-Z][A-Z0-9_]{1,79}$/.test(error.error_code)?error.error_code:'CENTRAL_READ_FAILED';
    fail('WORKER_INSPECTION_'+code);
  }
  const data=await boundedJson(response);
  return ticketId===null?
    {mode:'AVAILABLE',agent_id:agentId,tasks:plainList(data,50).map(taskItem)}:
    {mode:'DETAIL',agent_id:agentId,task:detailItem(data,ticketId)};
}
// Local operator preview only. The byte ceiling is NOT a tokenizer, provider
// quota estimate, lease authorization, workspace mapping or secret scanner.
const CONTEXT_MAX_BYTES=8192;
function compactWorkerContext(task,agentId){
  const t=detailItem(task,task?.ticket_id);
  if(!validId(agentId)||!validId(t.ticket_id)||
     t.worker_agent_id!==agentId||
     !['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(t.status)||
     !t.write_scopes.length||t.write_scopes.some(s=>!safeScopedPath(s))||
     !t.acceptance_criteria.length||t.acceptance_criteria.some(c=>!c.trim()))fail('WORKER_CONTEXT_REQUIRES_OWN_CLAIMED_TASK');
  const checkpoint=t.latest_checkpoint;
  if(checkpoint&&crypto.createHash('sha256').update(checkpoint.summary+'\n'+checkpoint.next_action).digest('hex')!==checkpoint.content_sha256)
    fail('WORKER_CONTEXT_CHECKPOINT_DIGEST_MISMATCH');
  const context={
    schema:'SUTRADHAR_ASSISTED_CONTEXT_V1',
    project_id:t.project_id,ticket_id:t.ticket_id,ticket_version:t.version,
    repository:t.repository,branch_name:t.branch_name,baseline_sha:t.baseline_sha,
    risk:t.risk,title:t.title,description:t.description,
    write_scopes:[...new Set(t.write_scopes)].sort(),
    acceptance_criteria:[...new Set(t.acceptance_criteria)],
    ...(t.contract_keys===null?{}:{contract_keys:t.contract_keys}),
    checkpoint:checkpoint?{generation:checkpoint.generation,summary:checkpoint.summary,
      next_action:checkpoint.next_action,content_sha256:checkpoint.content_sha256}:null
  };
  // Compact serialization eliminates formatting bytes without changing any
  // task field or dropping acceptance criteria. A digest binds exact bytes.
  const preview=JSON.stringify(context);
  const bytes=Buffer.byteLength(preview,'utf8');
  if(bytes>CONTEXT_MAX_BYTES)fail('WORKER_CONTEXT_BUDGET_EXCEEDED_OWNER_REVIEW');
  return {kind:'PROVIDER_ASSISTED_HANDOFF_PREVIEW',preview,utf8_bytes:bytes,
    byte_budget:CONTEXT_MAX_BYTES,context_sha256:crypto.createHash('sha256').update(preview).digest('hex'),
    provider_mapping_state:t.provider_mapping_state,provider_mappings:t.provider_mappings,
    provider_mapping_source:t.provider_mapping_source,provider_registry_version:t.provider_registry_version,
    provider_mapping_verified:false,lease_verified:false,provider_sent:false,
    automatic_execution_allowed:false,secret_scan_verified:false};
}
module.exports={inspectWorkerTasks,compactWorkerContext};

