/**
 * Browser-side, read-only, non-authoritative comparison of Owner snapshots.
 * No network, storage, signing, PC access, release or filesystem operations.
 * Both supplied JSON objects remain UNTRUSTED; a pinned Owner enrollment
 * public-key fingerprint must be obtained independently from these inputs.
 */
(function(root){
  'use strict';
  const NODE=/^node_[a-f0-9]{32}$/;
  const SHA=/^[a-f0-9]{64}$/;
  const DECIMAL=/^(0|[1-9][0-9]{0,19})$/;
  const RECORDS=Object.freeze({
    session_intent:512,encrypted_identity:65536,vault_write_intent:512,
    enrollment_receipt:16384,last_local_status:16384,
    maintenance_hold:16384,restart_ack:8192,
    installer_execution_attempt:16384
  });
  function fail(code){throw Error(code);}
  function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
  function keys(x,want){
    return isObject(x)&&Object.keys(x).sort().join('|')===want.slice().sort().join('|');
  }
  function nonnegative(x){return Number.isSafeInteger(x)&&x>=0;}
  function limitedDecimal(x){return typeof x==='string'&&DECIMAL.test(x);}
  function validateLocal(local){
    if(!isObject(local)||local.schema!==1||
       local.kind!=='SUTRADHAR_LOCAL_CRASH_EVIDENCE_V1'||
       local.state!=='OWNER_REVIEW_REQUIRED'||
       local.evidence_signed!==false||local.central_verified!==false||
       local.physical_pc_verified!==false||
       local.agent_restart_allowed!==false||
       local.installer_allowed!==false||local.marker_removal_allowed!==false||
       local.production_release_allowed!==false||
       !keys(local.records,Object.keys(RECORDS))||
       !nonnegative(local.other_directory_entries_count))
      fail('LOCAL_CRASH_DIAGNOSTIC_INVALID_OR_UNTRUSTED');
    for(const [name,max] of Object.entries(RECORDS)){
      const v=local.records[name];
      if(!isObject(v))fail('LOCAL_CRASH_RECORD_INVALID');
      if(v.state==='MISSING'||v.state==='UNSAFE_OR_UNREADABLE'){
        if(!keys(v,['state']))fail('LOCAL_CRASH_RECORD_INVALID');
      }else{
        if(!['PRESENT_HASHED','PRESENT_VALID_SHAPE',
          'PRESENT_INVALID_SHAPE'].includes(v.state)||
          !keys(v,['state','bytes','sha256'])||
          !nonnegative(v.bytes)||v.bytes<1||v.bytes>max||
          typeof v.sha256!=='string'||!SHA.test(v.sha256))
          fail('LOCAL_CRASH_RECORD_INVALID');
        if(name==='session_intent'&&v.state==='PRESENT_HASHED')
          fail('LOCAL_CRASH_SESSION_RECORD_INVALID');
        if(name!=='session_intent'&&v.state!=='PRESENT_HASHED')
          fail('LOCAL_CRASH_RECORD_INVALID');
      }
    }
  }
  function validateCentral(central,nodeId){
    if(!isObject(central)||central.schema!==1||
       central.mode!=='OWNER_CENTRAL_NODE_CRASH_RECOVERY_OBSERVATION'||
       central.node_id!==nodeId||!NODE.test(nodeId)||
       !['PENDING','APPROVED','REVOKED'].includes(central.node_state)||
       !SHA.test(central.node_public_key_fingerprint_sha256||'')||
       !limitedDecimal(central.accepted_node_sequence_decimal)||
       !Array.isArray(central.agents)||central.agents.length>50||
       !isObject(central.cluster)||!limitedDecimal(central.cluster.epoch_decimal)||
       !isObject(central.maintenance)||
       typeof central.maintenance.active_fence!=='boolean'||
       !nonnegative(central.maintenance.unresolved_intent_count)||
       typeof central.cluster.original_pc_in_cluster_roles!=='boolean'||
       !nonnegative(central.active_worker_lease_count)||
       !nonnegative(central.outstanding_worker_ticket_count)||
       !nonnegative(central.unresolved_git_job_count)||
       central.read_only!==true||central.central_state_modified!==false||
       central.device_signature_verified_by_this_request!==false||
       central.local_os_vault_verified!==false||
       central.physical_pc_verified!==false||
       central.owner_reconciliation_complete!==false||
       central.agent_restart_allowed!==false||
       central.marker_removal_allowed!==false||
       central.installer_execution_allowed!==false||
       central.production_release_authorized!==false)
      fail('CENTRAL_RECOVERY_SNAPSHOT_INVALID_OR_UNTRUSTED');
    const ids=new Set();
    for(const agent of central.agents){
      if(!isObject(agent)||typeof agent.agent_id!=='string'||
         !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(agent.agent_id)||
         ids.has(agent.agent_id)||!limitedDecimal(agent.accepted_sequence_decimal))
        fail('CENTRAL_RECOVERY_AGENT_INVALID');
      ids.add(agent.agent_id);
    }
  }
  function inspect({local,central,nodeId,pinnedPublicKeySha256}={}){
    if(typeof nodeId!=='string'||!NODE.test(nodeId))
      fail('OWNER_PINNED_NODE_ID_REQUIRED');
    if(typeof pinnedPublicKeySha256!=='string'||!SHA.test(pinnedPublicKeySha256))
      fail('INDEPENDENT_ENROLLMENT_FINGERPRINT_REQUIRED');
    validateLocal(local);
    validateCentral(central,nodeId);
    const findings=[];
    const add=x=>findings.push(x);
    const marker=local.records.session_intent;
    if(marker.state!=='PRESENT_VALID_SHAPE')add('LOCAL_SESSION_MARKER_MISSING_TAMPERED_OR_UNSAFE');
    if(local.records.encrypted_identity.state!=='PRESENT_HASHED')
      add('LOCAL_ENCRYPTED_IDENTITY_MISSING_OR_UNSAFE');
    if(local.records.vault_write_intent.state!=='MISSING')
      add('OS_VAULT_COUNTER_WRITE_INTENT_UNCERTAIN');
    if(central.node_public_key_fingerprint_sha256!==pinnedPublicKeySha256)
      add('CENTRAL_PUBLIC_KEY_DIFFERS_FROM_INDEPENDENT_ENROLLMENT_PIN');
    if(central.node_state!=='APPROVED')add('CENTRAL_NODE_NOT_APPROVED');
    if(central.cluster.original_pc_in_cluster_roles)
      add('CENTRAL_CLUSTER_ROLE_NEEDS_OWNER_REVIEW');
    if(central.maintenance.active_fence||central.maintenance.unresolved_intent_count>0)
      add('CENTRAL_MAINTENANCE_UNRESOLVED');
    if(central.active_worker_lease_count>0)
      add('CENTRAL_LIVE_WORKER_LEASES_PRESENT');
    if(central.outstanding_worker_ticket_count>0)
      add('CENTRAL_OUTSTANDING_WORKER_TICKETS');
    if(central.unresolved_git_job_count>0)
      add('CENTRAL_UNRESOLVED_GIT_EFFECTS');
    // These are ALWAYS unresolved because the original PC is intentionally
    // not allowed to unlock/sign after crash; plain local hashes are NOT
    // authoritative evidence of key possession, process stop or counters.
    add('LOCAL_TO_CENTRAL_IDENTITY_LINK_NOT_AUTHENTICATED');
    add('LOCAL_COUNTERS_AND_SIGNED_HEARTBEAT_NOT_RECONCILED');
    add('EXTERNAL_GIT_QA_EFFECTS_NOT_INDEPENDENTLY_VERIFIED');
    add('PHYSICAL_PC_AND_WINDOWS_DPAPI_NOT_VERIFIED');
    return Object.freeze({
      schema:1,kind:'OWNER_PC_CRASH_CROSSCHECK_V1',
      state:'OWNER_REVIEW_REQUIRED',read_only:true,
      compared_node_id:nodeId,
      central_fingerprint_matches_independent_enrollment_pin:
        central.node_public_key_fingerprint_sha256===pinnedPublicKeySha256,
      local_session_marker_shape_valid:marker.state==='PRESENT_VALID_SHAPE',
      preliminary_inconsistency_count:findings.length-4,
      finding_codes:Object.freeze(findings),
      local_evidence_cryptographically_authenticated:false,
      local_device_node_binding_verified:false,
      accepted_counter_continuity_verified:false,
      physical_pc_verified:false,owner_reconciliation_complete:false,
      agent_restart_allowed:false,marker_removal_allowed:false,
      installer_execution_allowed:false,production_release_authorized:false
    });
  }
  const api=Object.freeze({inspect});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SutradharCrashCrosscheck=api;
})(typeof window==='object'?window:null);
