/**
 * Request termination and wait for the actual child-process exit event.
 * This is NOT installer authorization, and is never a generic process killer.
 * Caller must have already persisted the Owner-fenced local maintenance hold.
 */
'use strict';
function requestStopAndConfirm(child,{timeoutMs=12000,onStopAccepted=null}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)
    throw Error('MAINTENANCE_STOP_TIMEOUT_INVALID');
  // Only a positively accepted signal request for THIS tracked child may
  // arm session-marker retirement. A prior signalCode or a resolved
  // child-exit event is not evidence that this operation requested a stop.
  if(onStopAccepted!==null&&typeof onStopAccepted!=='function')
    throw Error('MAINTENANCE_STOP_ACCEPTED_CALLBACK_INVALID');
  if(!child)return Promise.resolve(Object.freeze({agent_stopped:true,
    agent_stop_requested:false,exit_confirmed_by:'NO_TRACKED_CHILD'}));
  if(typeof child.once!=='function'||typeof child.removeListener!=='function'||
     typeof child.kill!=='function')
    throw Error('MAINTENANCE_STOP_CHILD_INVALID');
  // A signal request alone does NOT prove process exit. Only a populated
  // exitCode or a subsequently observed 'exit' event counts as stopped.
  if(child.exitCode!==null&&child.exitCode!==undefined)
    return Promise.resolve(Object.freeze({agent_stopped:true,
      agent_stop_requested:false,exit_confirmed_by:'CHILD_EXIT_STATE'}));
  const alreadySignaled=child.signalCode!==null&&child.signalCode!==undefined;
  return new Promise(resolve=>{
    let finished=false,requested=false,timer=null;
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
    timer=setTimeout(()=>finish(false,'EXIT_TIMEOUT_OWNER_REVIEW'),timeoutMs);
    if(!alreadySignaled){
      try{
        requested=child.kill();
        if(requested!==true){
          finish(false,'STOP_REQUEST_REJECTED_OWNER_REVIEW');
        }else if(!finished&&onStopAccepted){
          // A synchronous 'exit' during kill() cannot be retroactively
          // called an accepted Owner stop. Preserve its session marker.
          onStopAccepted(child);
        }
      }catch{finish(false,'STOP_REQUEST_FAILED_OWNER_REVIEW');}
    }
  });
}
module.exports={requestStopAndConfirm};
