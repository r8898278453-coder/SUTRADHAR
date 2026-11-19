/**
 * Packaged Windows OS-vault worker discovery -- READ ONLY.
 * Runs in Electron MAIN, not the renderer or the supervised heartbeat child.
 * Neither private key nor arbitrary signing operations are returned to UI.
 */
'use strict';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
const SHA=/^[0-9a-f]{40}$/;
const MAX_BYTES=96*1024;
const fail=(code)=>{throw Error(code);};
function plainList(value,max){if(typeof value==='string'){
    try{value=JSON.parse(value);}catch{fail('WORKER_INSPECTION_RESPONSE_INVALID');}
  }
  if(!Array.isArray(value)||value.length>max)return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return value;
}
function textField(v,max){
  if(typeof v!=='string'||v.length>max)return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return v;
}
function taskItem(x){
  if(!x||!ID.test(x.ticket_id||'')||!ID.test(x.project_id||'')||
    !['LOW','MEDIUM','HIGH','CORE'].includes(x.risk)||!Number.isSafeInteger(Number(x.version))||
    Number(x.version)<1)
    return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return {ticket_id:x.ticket_id,project_id:x.project_id,
    title:textField(x.title,220),risk:x.risk,version:Number(x.version)};
}
function detailItem(x,expectedId){
  if(!x||x.ticket_id!==expectedId||!ID.test(x.project_id||'')||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(x.repository||'')||
    !SHA.test(x.baseline_sha||'')||
    !/^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(x.branch_name||'')||
    !['LOW','MEDIUM','HIGH','CORE'].includes(x.risk)||
    !Number.isSafeInteger(Number(x.version))||Number(x.version)<1)
    return fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const scopes=plainList(x.write_scopes,30),criteria=plainList(x.acceptance_criteria,30);
  if(scopes.some(s=>typeof s!=='string'||s.length>450)||
    criteria.some(s=>typeof s!=='string'||s.length>500))fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const checkpoint=x.latest_checkpoint;
  if(checkpoint!==null&&checkpoint!==undefined&&
     (!checkpoint||typeof checkpoint!=='object'||
      !Number.isSafeInteger(Number(checkpoint.generation))||
      Number(checkpoint.generation)<1||
      !/^[a-f0-9]{64}$/.test(checkpoint.content_sha256||'')||
      typeof checkpoint.summary!=='string'||checkpoint.summary.length>8000||
      typeof checkpoint.next_action!=='string'||checkpoint.next_action.length>500))
    fail('WORKER_INSPECTION_RESPONSE_INVALID');
  const head=x.candidate_head_sha??null,tree=x.candidate_tree_sha??null;
  if((head===null)!==(tree===null)||
    (head!==null&&(!SHA.test(head)||!SHA.test(tree))))
    fail('WORKER_INSPECTION_RESPONSE_INVALID');
  return {
    ticket_id:x.ticket_id,project_id:x.project_id,
    repository:x.repository,title:textField(x.title,220),
    description:textField(x.description,10000),
    branch_name:x.branch_name,baseline_sha:x.baseline_sha,
    risk:x.risk,status:textField(x.status,40),
    version:Number(x.version),write_scopes:scopes,
    acceptance_criteria:criteria,
    worker_agent_id:x.worker_agent_id||null,
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
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{fail('WORKER_INSPECTION_RESPONSE_INVALID');}
}
async function inspectWorkerTasks({origin,agentId,ticketId=null,signer,fetcher=fetch}){
  if(typeof origin!=='string'||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin)||
    origin.length>250||!ID.test(agentId||'')||
    (ticketId!==null&&!ID.test(ticketId))||
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
module.exports={inspectWorkerTasks};
