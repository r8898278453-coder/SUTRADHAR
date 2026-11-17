/**
 * Read-only recovery preflight for an existing local maintenance HOLD.
 * Signed node-scoped Central cancellation evidence must match exact plan,
 * wave, offer digest and node. No deletion, restart or installer execution.
 */
'use strict';
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {validOrigin}=require('./update-readiness.cjs');
const NODE=/^node_[a-f0-9]{32}$/;
const fail=code=>{throw Error(code);};
async function checkRecovery({dir,centralOrigin,nodeId,signer,
  fetcher=fetch}={}){
  const origin=validOrigin(centralOrigin);
  if(!NODE.test(nodeId||'')||!signer||typeof signer.sign!=='function')
    fail('MAINTENANCE_RECOVERY_IDENTITY_REQUIRED');
  const held=inspectHold({dir,nodeId});
  if(!held.active)fail('MAINTENANCE_RECOVERY_NO_LOCAL_HOLD');
  const uri='/v7/nodes/maintenance/recovery/'+encodeURIComponent(held.plan_id);
  const signed=signer.sign({kind:'node_api',method:'GET',uri,body:''});
  if(!signed||signed['x-sutradhar-node']!==nodeId||
     typeof signed['x-sutradhar-nonce']!=='string'||
     typeof signed['x-sutradhar-signature']!=='string')
    fail('MAINTENANCE_RECOVERY_NODE_SIGNING_REQUIRED');
  let response;
  try{
    response=await fetcher(origin+uri,{method:'GET',
      headers:{...signed,Accept:'application/json'},redirect:'error',
      signal:AbortSignal.timeout(12000)});
  }catch{fail('MAINTENANCE_RECOVERY_CENTRAL_UNREACHABLE');}
  if(!response?.ok)fail('MAINTENANCE_RECOVERY_CENTRAL_REJECTED');
  let data;
  try{data=await response.json();}catch{fail('MAINTENANCE_RECOVERY_INVALID_EVIDENCE');}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     data.node_id!==nodeId||data.plan_id!==held.plan_id||
     data.wave_id!==held.wave_id||data.offer_sha256!==held.offer_sha256||
     data.state!=='CANCELLED'||data.cancellation_verified!==true||
     data.any_active_fence!==false||
     data.any_active_maintenance_intent!==false||
     data.local_hold_release_allowed!==false||
     data.installer_execution_allowed!==false||
     data.recovery_requires_owner!==true)
    fail('MAINTENANCE_RECOVERY_CANCELLATION_UNVERIFIED');
  // Recheck local identity after network interaction. This remains advisory;
  // a separate Owner-approved, fail-closed release procedure is still needed.
  const again=inspectHold({dir,nodeId});
  if(!again.active||again.plan_id!==held.plan_id||
     again.wave_id!==held.wave_id||again.offer_sha256!==held.offer_sha256)
    fail('MAINTENANCE_RECOVERY_LOCAL_HOLD_CHANGED');
  return Object.freeze({cancellation_verified:true,node_id:nodeId,
    plan_id:held.plan_id,wave_id:held.wave_id,
    local_hold_still_active:true,agent_start_allowed:false,
    local_hold_release_allowed:false,installer_execution_allowed:false,
    owner_review_required:true,
    next_action:'Owner must separately authorize a controlled local release and verify device recovery; do not delete the hold manually.'});
}
module.exports={checkRecovery};
