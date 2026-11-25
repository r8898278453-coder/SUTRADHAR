/**
 * Pure decision for retiring the durable Desktop child-session uncertainty
 * marker. Caller MUST invoke this only upon observing the tracked child's
 * actual 'exit' event. Neither signal delivery nor a maintenance hold ALONE
 * proves that a child was intentionally stopped.
 *
 * This function cannot operate on disk, agents, credentials or Central.
 */
'use strict';
const cleanResult=Object.freeze({retire:true,reason:'CLEAN_EXIT'});
const maintenanceResult=Object.freeze({retire:true,reason:'OBSERVED_OWNER_MAINTENANCE_STOP'});
const applicationResult=Object.freeze({retire:true,reason:'OBSERVED_APP_SHUTDOWN'});
const holdResult=Object.freeze({retire:false,reason:null});
function classifyObservedAgentExit({
  exitCode,signal,ownerHold,ownerStopRequested,appStopRequested,
  shuttingDown,vaultHealthy,holdInspectionHealthy
}={}){
  const flags=[ownerHold,ownerStopRequested,appStopRequested,
    shuttingDown,vaultHealthy,holdInspectionHealthy];
  if(flags.some(x=>typeof x!=='boolean'))
    throw Error('AGENT_SESSION_OBSERVED_EXIT_CONTEXT_INVALID');
  if(!(exitCode===null||(Number.isSafeInteger(exitCode)&&exitCode>=0))||
     !(signal===null||(typeof signal==='string'&&signal.length>0&&
       signal.length<40)))
    throw Error('AGENT_SESSION_OBSERVED_EXIT_STATUS_INVALID');
  if(!vaultHealthy||!holdInspectionHealthy)return holdResult;
  // A kill('SIGTERM') acknowledgement only proves request acceptance.
  // A separate crash/signal can race and must NOT retire the session.
  // Platform variants with different observed signal semantics stay HOLD
  // until real Windows acceptance establishes safe evidence.
  const matchingStopObserved=exitCode===null&&signal==='SIGTERM';
  // The mere existence of a maintenance hold is not a stop request.
  // A clean exit while a hold exists is also ambiguous unless the exact
  // child was explicitly selected for isolation and its exit observed.
  if(ownerHold){
    return ownerStopRequested&&matchingStopObserved?maintenanceResult:holdResult;
  }
  // A shutdown request is only evidence after kill() returned true for
  // THIS tracked child and its actual exit callback was observed.
  // No CLEAN_EXIT fallback while shutdown is in progress or an app-stop
  // request was claimed. A zero exit could race an unconfirmed quit.
  if(shuttingDown||appStopRequested)
    return shuttingDown&&appStopRequested&&matchingStopObserved?
      applicationResult:holdResult;
  // A child terminating naturally with exit 0 and no signal is observed.
  if(exitCode===0&&signal===null)return cleanResult;
  return holdResult;
}
module.exports={classifyObservedAgentExit};
