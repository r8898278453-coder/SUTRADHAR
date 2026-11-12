/**
 * Pure read-only multi-PC acceptance evidence policy.
 * No simulated PCs, no elections, no remote mutation.
 */
'use strict';
function evaluatePilot(snapshot,expectedNodes,nowMs=Date.now(),allowOfflineNodeIds=[]){
  const failures=[];
  const agents=Array.isArray(snapshot?.agents)?snapshot.agents:[];
  const cluster=snapshot?.cluster||{};
  if(!Array.isArray(expectedNodes)||expectedNodes.length<2||
    new Set(expectedNodes).size!==expectedNodes.length)
    failures.push('TWO_DISTINCT_PHYSICAL_NODE_IDS_REQUIRED');
  const byId=new Map(agents.map(a=>[a.agent_id,a]));
  const online=agents.filter(a=>{
    const t=Date.parse(String(a.last_seen||'')+'Z');
    return a.state==='APPROVED'&&a.node_state==='APPROVED'&&
      Number.isFinite(t)&&nowMs-t>=0&&nowMs-t<180000;
  });
  for(const nodeId of expectedNodes){
    if(!online.some(a=>a.node_id===nodeId)&&!allowOfflineNodeIds.includes(nodeId))
      failures.push('NO_LIVE_APPROVED_AGENT_ON_'+nodeId);
  }
  const master=byId.get(cluster.master_agent_id);
  if(!master||!online.includes(master))failures.push('NO_LIVE_MASTER');
  const b1=byId.get(cluster.backup1);
  // A two-PC failover has no third physical PC to become the successor's
  // backup. Requiring another backup would falsely fail the correct promotion.
  const onlyTwoPcFailover=expectedNodes.length===2&&allowOfflineNodeIds.length===1;
  if((!b1||!online.includes(b1))&&!onlyTwoPcFailover)
    failures.push('NO_LIVE_BACKUP_1');
  if(master&&b1&&master.node_id===b1.node_id)
    failures.push('MASTER_AND_BACKUP1_MUST_BE_ON_DISTINCT_PCS');
  if(!Number.isSafeInteger(Number(cluster.epoch))||Number(cluster.epoch)<1)
    failures.push('INVALID_MASTER_EPOCH');
  const d2=byId.get(cluster.backup2);
  if(expectedNodes.length>=3&&(!d2||!online.includes(d2)))
    failures.push('NO_LIVE_BACKUP_2');
  return {
    accepted:failures.length===0,failures,
    measured_at_utc:new Date(nowMs).toISOString(),
    checked_physical_node_ids:expectedNodes,
    deliberately_offline_node_ids:allowOfflineNodeIds,
    active_approved_nodes:[...new Set(online.map(a=>a.node_id))].sort(),
    master_agent_id:cluster.master_agent_id||null,
    master_node_id:master?.node_id||null,
    backup1:cluster.backup1||null,backup1_node_id:b1?.node_id||null,
    backup2:cluster.backup2||null,backup2_node_id:d2?.node_id||null,
    epoch:Number(cluster.epoch)||0,phase:cluster.phase||null
  };
}
function compareFailover(before,after){
  const failures=[];
  if(!before?.accepted||!after?.accepted)failures.push('INVALID_BASELINE_OR_FINAL_SNAPSHOT');
  if(!before?.master_agent_id||!after?.master_agent_id||
    before.master_agent_id===after.master_agent_id)failures.push('MASTER_DID_NOT_CHANGE');
  if(after.master_agent_id!==before.backup1)failures.push('BACKUP1_NOT_PROMOTED');
  if(after.epoch!==before.epoch+1)failures.push('EPOCH_DID_NOT_INCREMENT_EXACTLY_ONCE');
  if(before.backup1_node_id===before.master_node_id)failures.push('NOT_A_DISTINCT_PC_FAILOVER');
  if(!after.checked_physical_node_ids?.every(x=>before.checked_physical_node_ids?.includes(x)))
    failures.push('PILOT_NODE_SET_MISMATCH');
  return {accepted:failures.length===0,failures,previous_master:before?.master_agent_id,
    expected_successor:before?.backup1,actual_master:after?.master_agent_id,
    epoch_before:before?.epoch,epoch_after:after?.epoch,
    note:'Owner must independently verify actual physical PC power-down, recovery and task fencing evidence.'};
}
module.exports={evaluatePilot,compareFailover};
