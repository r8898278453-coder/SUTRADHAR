'use strict';
/**
 * Pure, conservative presentation of the local agent's response to its signed HTTPS heartbeat.
 * Never infer Central approval from merely having a running child process.
 */
function summarizeCentralReceipt(detail,nodeId,agentRunning,nowMs=Date.now(),staleMs=180000){
  if(!detail||typeof detail!=='object'||!nodeId||detail.node_id!==nodeId)return null;
  const timestamp=typeof detail.last_accepted_at==='string'
    ?Date.parse(detail.last_accepted_at):NaN;
  const recent=Number.isFinite(timestamp)&&timestamp<=nowMs+5000&&
    timestamp<=nowMs&&nowMs-timestamp<staleMs;
  const acceptedState=detail.connection==='ACKNOWLEDGED'||detail.connection==='RECOVERY_BLOCKED';
  return {
    acknowledgedNow:Boolean(agentRunning&&recent&&acceptedState),
    lastAcceptedAt:Number.isFinite(timestamp)?new Date(timestamp).toISOString():null,
    errorCode:typeof detail.error_code==='string'?detail.error_code.slice(0,100):null,
    phase:typeof detail.phase==='string'?detail.phase.slice(0,80):null,
    masterAgentId:typeof detail.master_agent_id==='string'?detail.master_agent_id:null,
    recoveryBlocked:detail.connection==='RECOVERY_BLOCKED',
    stale:Boolean(Number.isFinite(timestamp)&&!recent)
  };
}
module.exports={summarizeCentralReceipt};
