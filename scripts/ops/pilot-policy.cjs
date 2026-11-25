/**
 * Pure read-only multi-PC acceptance evidence policy.
 * No simulated PCs, no elections, no remote mutation.
 */
'use strict';
function evaluatePilot(snapshot,expectedNodes,nowMs=Date.now(),allowOfflineNodeIds=[]){
  const failures=[];
  const agents=Array.isArray(snapshot?.agents)?snapshot.agents:[];
  const cluster=snapshot?.cluster||{};
  const nodeFormat=id=>typeof id==='string'&&
    /^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(id);
  if(!Number.isSafeInteger(nowMs)||nowMs<1||
     !Array.isArray(expectedNodes)||expectedNodes.length<2||
     expectedNodes.length>10||expectedNodes.some(id=>!nodeFormat(id))||
     new Set(expectedNodes).size!==expectedNodes.length)
    failures.push('TWO_TO_TEN_DISTINCT_PHYSICAL_NODE_IDS_REQUIRED');
  if(!Array.isArray(allowOfflineNodeIds)||allowOfflineNodeIds.length>1||
     new Set(allowOfflineNodeIds).size!==allowOfflineNodeIds.length||
     allowOfflineNodeIds.some(id=>!expectedNodes?.includes(id)))
    failures.push('PILOT_OFFLINE_NODE_NOT_APPROVED');
  if(agents.length>200||agents.some(a=>!a||
       !nodeFormat(a.agent_id)||!nodeFormat(a.node_id))||
     new Set(agents.map(a=>a.agent_id)).size!==agents.length)
    failures.push('PILOT_AGENT_IDENTITY_LIST_UNTRUSTED');
  const byId=new Map(agents.map(a=>[a?.agent_id,a]));
  const online=agents.filter(a=>{
    const stamp=String(a?.last_seen||'');
    const t=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z?$/.test(stamp)?
      Date.parse(stamp.endsWith('Z')?stamp:stamp+'Z'):NaN;
    return a.state==='APPROVED'&&a.node_state==='APPROVED'&&
      Number.isFinite(t)&&nowMs-t>=0&&nowMs-t<180000;
  });
  for(const nodeId of Array.isArray(expectedNodes)?expectedNodes:[]){
    if(!online.some(a=>a.node_id===nodeId)&&!allowOfflineNodeIds.includes(nodeId))
      failures.push('NO_LIVE_APPROVED_AGENT_ON_'+nodeId);
    if(allowOfflineNodeIds.includes(nodeId)&&online.some(a=>a.node_id===nodeId))
      failures.push('INTENTIONALLY_OFFLINE_NODE_STILL_LIVE');
  }
  const master=byId.get(cluster.master_agent_id);
  if(!master||!online.includes(master))failures.push('NO_LIVE_MASTER');
  const b1=byId.get(cluster.backup1);
  // A two-PC failover has no third physical PC to become the successor's
  // backup. Requiring another backup would falsely fail the correct promotion.
  const onlyTwoPcFailover=expectedNodes?.length===2&&allowOfflineNodeIds?.length===1;
  if((!b1||!online.includes(b1))&&!onlyTwoPcFailover)
    failures.push('NO_LIVE_BACKUP_1');
  if(master&&b1&&master.node_id===b1.node_id)
    failures.push('MASTER_AND_BACKUP1_MUST_BE_ON_DISTINCT_PCS');
  if(master&&(!expectedNodes?.includes(master.node_id)||
      allowOfflineNodeIds?.includes(master.node_id)))
    failures.push('MASTER_OUTSIDE_APPROVED_LIVE_PILOT');
  if(b1&&(!expectedNodes?.includes(b1.node_id)||
      allowOfflineNodeIds?.includes(b1.node_id)))
    failures.push('BACKUP1_OUTSIDE_APPROVED_LIVE_PILOT');
  if(!Number.isSafeInteger(Number(cluster.epoch))||Number(cluster.epoch)<1)
    failures.push('INVALID_MASTER_EPOCH');
  const d2=byId.get(cluster.backup2);
  const threePcFailover=expectedNodes?.length===3&&
    allowOfflineNodeIds?.length===1;
  if(expectedNodes?.length>=3&&!threePcFailover&&
     (!d2||!online.includes(d2)))
    failures.push('NO_LIVE_BACKUP_2');
  if(threePcFailover&&d2&&online.includes(d2))
    failures.push('THREE_PC_FAILOVER_CANNOT_RETAIN_TWO_BACKUPS');
  if(d2&&(!expectedNodes?.includes(d2.node_id)||
      d2.node_id===master?.node_id||d2.node_id===b1?.node_id))
    failures.push('BACKUP2_NOT_ON_SEPARATE_APPROVED_PC');
  if(!['READY','RECOVERING'].includes(cluster.phase)||
     (!allowOfflineNodeIds?.length&&cluster.phase!=='READY'))
    failures.push('PILOT_CLUSTER_PHASE_UNVERIFIED');
  return {
    accepted:failures.length===0,failures,
    measured_at_utc:new Date(nowMs).toISOString(),
    checked_physical_node_ids:Array.isArray(expectedNodes)?[...expectedNodes]:[],
    deliberately_offline_node_ids:Array.isArray(allowOfflineNodeIds)?
      [...allowOfflineNodeIds]:[],
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
  const list=a=>Array.isArray(a)&&a.length>=2&&a.length<=10&&
    a.every(x=>typeof x==='string')&&new Set(a).size===a.length;
  if(!before?.accepted||!after?.accepted)
    failures.push('INVALID_BASELINE_OR_FINAL_SNAPSHOT');
  const beforeNodes=before?.checked_physical_node_ids,
    afterNodes=after?.checked_physical_node_ids;
  if(!list(beforeNodes)||!list(afterNodes)||
     beforeNodes.length!==afterNodes.length||
     afterNodes.some(x=>!beforeNodes.includes(x)))
    failures.push('PILOT_NODE_SET_MISMATCH');
  if(!Array.isArray(before?.deliberately_offline_node_ids)||
     before.deliberately_offline_node_ids.length!==0||
     !Array.isArray(after?.deliberately_offline_node_ids)||
     after.deliberately_offline_node_ids.length!==1||
     after.deliberately_offline_node_ids[0]!==before?.master_node_id)
    failures.push('PILOT_FAILOVER_OFFLINE_MASTER_NOT_PROVEN');
  if(!before?.master_agent_id||!after?.master_agent_id||
     before.master_agent_id===after.master_agent_id)
    failures.push('MASTER_DID_NOT_CHANGE');
  if(after?.master_agent_id!==before?.backup1||
     after?.master_node_id!==before?.backup1_node_id)
    failures.push('BACKUP1_NOT_PROMOTED');
  if(!Number.isSafeInteger(before?.epoch)||!Number.isSafeInteger(after?.epoch)||
     after.epoch!==before.epoch+1)
    failures.push('EPOCH_DID_NOT_INCREMENT_EXACTLY_ONCE');
  if(!before?.backup1_node_id||!before?.master_node_id||
     before.backup1_node_id===before.master_node_id)
    failures.push('NOT_A_DISTINCT_PC_FAILOVER');
  if(beforeNodes?.length===3&&
     (after?.backup1!==before?.backup2||
      after?.backup1_node_id!==before?.backup2_node_id))
    failures.push('BACKUP2_NOT_SHIFTED_TO_BACKUP1_AFTER_FAILOVER');
  const t0=Date.parse(before?.measured_at_utc||''),
    t1=Date.parse(after?.measured_at_utc||'');
  if(!Number.isFinite(t0)||!Number.isFinite(t1)||t1<=t0||
     t1-t0>60*60*1000)
    failures.push('PILOT_FAILOVER_TIME_ORDER_UNVERIFIED');
  if(!Array.isArray(after?.active_approved_nodes)||
     after.active_approved_nodes.includes(before?.master_node_id))
    failures.push('PILOT_PREVIOUS_MASTER_STILL_ACTIVE');
  return {accepted:failures.length===0,failures,
    previous_master:before?.master_agent_id||null,
    previous_master_node:before?.master_node_id||null,
    expected_successor:before?.backup1||null,
    actual_master:after?.master_agent_id||null,
    epoch_before:before?.epoch||null,epoch_after:after?.epoch||null,
    note:'Owner must independently prove real physical isolation, heartbeat cessation, fenced work, and genuine multi-machine identities.'};
}
module.exports={evaluatePilot,compareFailover};
