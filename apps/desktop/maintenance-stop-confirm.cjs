/**
 * Request termination and wait for the actual child-process exit event.
 * This is NOT installer authorization, and is never a generic process killer.
 * Caller must have already persisted the Owner-fenced local maintenance hold.
 */
'use strict';
function requestStopAndConfirm(child,{timeoutMs=12000}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)
    throw Error('MAINTENANCE_STOP_TIMEOUT_INVALID');
  if(!child)return Promise.resolve(Object.freeze({agent_stopped:true,
    agent_stop_requested:false,exit_confirmed_by:'NO_TRACKED_CHILD'}));
  if(typeof child.once!=='function'||typeof child.removeListener!=='function'||
     typeof child.kill!=='function')
    throw Error('MAINTENANCE_STOP_CHILD_INVALID');
  // exitCode===null is NOT reliable after signal termination; signalCode
  // may be present. A pre-existing exit must be independently observed.
  if(child.exitCode!==null&&child.exitCode!==undefined||
     child.signalCode!==null&&child.signalCode!==undefined)
    return Promise.resolve(Object.freeze({agent_stopped:true,
      agent_stop_requested:false,exit_confirmed_by:'CHILD_EXIT_STATE'}));
  return new Promise(resolve=>{
    let finished=false,requested=false;
    const clean=()=>{clearTimeout(timer);
      child.removeListener('exit',onExit);
      child.removeListener('error',onError);};
    const finish=(status,reason)=>{
      if(finished)return;finished=true;clean();
      resolve(Object.freeze({agent_stopped:status,agent_stop_requested:requested,
        exit_confirmed_by:reason}));
    };
    const onExit=()=>finish(true,'CHILD_EXIT_EVENT');
    const onError=()=>finish(false,'CHILD_PROCESS_ERROR_OWNER_REVIEW');
    child.once('exit',onExit);
    child.once('error',onError);
    const timer=setTimeout(()=>finish(false,'EXIT_TIMEOUT_OWNER_REVIEW'),timeoutMs);
    try{
      requested=child.kill();
      if(requested!==true)finish(false,'STOP_REQUEST_REJECTED_OWNER_REVIEW');
    }catch{finish(false,'STOP_REQUEST_FAILED_OWNER_REVIEW');}
  });
}
module.exports={requestStopAndConfirm};
