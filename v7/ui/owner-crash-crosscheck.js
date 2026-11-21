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
  // MySQL BIGINT UNSIGNED must remain an exact decimal string. A well-shaped
  // 20-digit number above 2^64-1 is not a valid counter, nor is a JS Number.
  const MAX_U64='18446744073709551615';
  function limitedDecimal(x){
    return typeof x==='string'&&DECIMAL.test(x)&&
      (x.length<MAX_U64.length||
       (x.length===MAX_U64.length&&x<=MAX_U64));
  }
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

  function snapshotVector(data){
    // Explicit allowlist of operational fields. Exclude the observation time
    // and heartbeat-age counters, which naturally move between GET requests.
    // Any other observed Central change is a warning, not a release permit.
    const agents=data.agents.map(a=>({
      agent_id:a.agent_id,state:a.state,status:a.status,
      accepted_sequence_decimal:a.accepted_sequence_decimal,
      master_eligible:a.master_eligible,qa_eligible:a.qa_eligible
    })).sort((a,b)=>a.agent_id.localeCompare(b.agent_id));
    return JSON.stringify({
      node_id:data.node_id,node_state:data.node_state,
      node_public_key_fingerprint_sha256:data.node_public_key_fingerprint_sha256,
      accepted_boot_id:data.accepted_boot_id,
      accepted_node_sequence_decimal:data.accepted_node_sequence_decimal,
      agents,cluster:{
        epoch_decimal:data.cluster.epoch_decimal,
        phase:data.cluster.phase,paused:data.cluster.paused,
        master_agent_id:data.cluster.master_agent_id,
        backup1:data.cluster.backup1,backup2:data.cluster.backup2,
        original_pc_in_cluster_roles:data.cluster.original_pc_in_cluster_roles
      },maintenance:{
        active_fence:data.maintenance.active_fence,
        fence_state:data.maintenance.fence_state,
        plan_id:data.maintenance.plan_id,
        expected_epoch_decimal:data.maintenance.expected_epoch_decimal,
        unresolved_intent_count:data.maintenance.unresolved_intent_count
      },
      active_worker_lease_count:data.active_worker_lease_count,
      outstanding_worker_ticket_count:data.outstanding_worker_ticket_count,
      unresolved_git_job_count:data.unresolved_git_job_count
    });
  }
  function validateObservation(data){
    // A higher-level validation for TWO sequential Owner GETs; no local
    // signer or cryptographic attestation is available while crash-held.
    if(!Number.isSafeInteger(data.observed_at_central_ms)||
       data.observed_at_central_ms<=0||
       !(data.accepted_boot_id===null||
         (typeof data.accepted_boot_id==='string'&&
          data.accepted_boot_id.length>0&&data.accepted_boot_id.length<=100))||
       typeof data.cluster.phase!=='string'||data.cluster.phase.length>32||
       data.cluster.phase.length===0||
       typeof data.cluster.paused!=='boolean')
      fail('CENTRAL_RECOVERY_OBSERVATION_MALFORMED');
    const validAgentId=x=>x===null||
      (typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(x));
    for(const field of ['master_agent_id','backup1','backup2'])
      if(!validAgentId(data.cluster[field]))
        fail('CENTRAL_RECOVERY_CLUSTER_ROLE_INVALID');
    if(!(data.maintenance.fence_state===null||
         ['DRAINING','DRAINED'].includes(data.maintenance.fence_state))||
       !validAgentId(data.maintenance.plan_id)||
       !(data.maintenance.expected_epoch_decimal===null||
         limitedDecimal(data.maintenance.expected_epoch_decimal)))
      fail('CENTRAL_RECOVERY_MAINTENANCE_INVALID');
    if(data.maintenance.active_fence!==(data.maintenance.fence_state!==null)||
       data.maintenance.active_fence!==(data.maintenance.plan_id!==null))
      fail('CENTRAL_RECOVERY_MAINTENANCE_INCONSISTENT');
    const age=x=>x===null||(Number.isSafeInteger(x)&&x>=-120);
    if(!age(data.heartbeat_age_seconds))
      fail('CENTRAL_RECOVERY_HEARTBEAT_AGE_INVALID');
    for(const agent of data.agents){
      if(!['PENDING','APPROVED','REVOKED'].includes(agent.state)||
         typeof agent.status!=='string'||agent.status.length>40||
         typeof agent.master_eligible!=='boolean'||
         typeof agent.qa_eligible!=='boolean'||
         !age(agent.heartbeat_age_seconds))
        fail('CENTRAL_RECOVERY_AGENT_FIELDS_INVALID');
    }
  }
  function inspectPair({local,first,second,nodeId,
    pinnedPublicKeySha256,observedAtClientMs}={}){
    // Validate BOTH responses independently; a tampered first response must
    // never be ignored just because the second looks plausible.
    validateCentral(first,nodeId);
    validateCentral(second,nodeId);
    validateObservation(first);
    validateObservation(second);
    if(!Number.isSafeInteger(observedAtClientMs)||observedAtClientMs<=0)
      fail('OWNER_OBSERVATION_CLIENT_CLOCK_REQUIRED');
    const base=inspect({local,central:second,nodeId,pinnedPublicKeySha256});
    const delta=second.observed_at_central_ms-first.observed_at_central_ms;
    const stable=snapshotVector(first)===snapshotVector(second);
    const bounded=delta>=0&&delta<=30000;
    const clockAligned=Math.abs(observedAtClientMs-
      second.observed_at_central_ms)<=120000;
    const findings=base.finding_codes.slice();
    if(!stable)findings.push('CENTRAL_STATE_CHANGED_BETWEEN_OWNER_READS');
    if(!bounded)findings.push('CENTRAL_OBSERVATION_WINDOW_UNSAFE');
    if(!clockAligned)findings.push('CENTRAL_BROWSER_CLOCK_MISMATCH');
    return Object.freeze({
      ...base,kind:'OWNER_PC_CRASH_DUAL_CROSSCHECK_V1',
      central_observation_unchanged:stable,
      central_observation_window_bounded:bounded,
      central_browser_clock_near_central:clockAligned,
      central_sample_gap_ms:delta,
      preliminary_inconsistency_count:base.preliminary_inconsistency_count+
        Number(!stable)+Number(!bounded)+Number(!clockAligned),
      finding_codes:Object.freeze(findings),
      // A stable pair of MySQL GETs is only two point-in-time observations.
      // It never proves continuity since the last signed agent heartbeat.
      owner_reconciliation_complete:false,agent_restart_allowed:false,
      marker_removal_allowed:false,installer_execution_allowed:false,
      production_release_authorized:false
    });
  }
  const api=Object.freeze({inspect,inspectPair});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SutradharCrashCrosscheck=api;
})(typeof window==='object'?window:null);
