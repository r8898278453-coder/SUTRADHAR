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
       !isObject(central.historical_effects)||
       !limitedDecimal(central.historical_effects.global_audit_event_high_watermark_decimal)||
       !['retained_pilot_signed_heartbeat_packet_count',
          'qa_receipts_created_by_this_pc_count',
          'qa_receipts_on_worker_tickets_for_this_pc_count',
          'pending_qa_owner_reviews_for_worker_tickets_count',
          'pending_qa_owner_reviews_global_count',
          'centrally_confirmed_git_jobs_involving_this_pc_count',
          'local_agent_checkpoint_record_count'].every(k=>
          nonnegative(central.historical_effects[k]))||
       !isObject(central.historical_effects.last_retained_pilot_heartbeat)||
       !['record_present','last_retained_packet_signature_verified',
         'retained_sequence_equals_current_accepted_node_counter',
         'retained_agent_sequences_not_ahead_of_central',
         'retained_boot_id_matches_current','read_only',
         'complete_signed_heartbeat_history','local_pc_possession_now_verified',
         'physical_pc_verified','agent_restart_allowed',
         'production_release_authorized'].every(k=>
         typeof central.historical_effects.last_retained_pilot_heartbeat[k]==='boolean')||
       central.historical_effects.last_retained_pilot_heartbeat.read_only!==true||
       central.historical_effects.last_retained_pilot_heartbeat.complete_signed_heartbeat_history!==false||
       central.historical_effects.last_retained_pilot_heartbeat.local_pc_possession_now_verified!==false||
       central.historical_effects.last_retained_pilot_heartbeat.agent_restart_allowed!==false||
       central.historical_effects.last_retained_pilot_heartbeat.production_release_authorized!==false||
       (central.historical_effects.last_retained_pilot_heartbeat.last_retained_node_sequence_decimal!==null&&
         !limitedDecimal(central.historical_effects.last_retained_pilot_heartbeat.last_retained_node_sequence_decimal))||
       (central.historical_effects.last_retained_pilot_heartbeat.last_retained_accepted_at_ms!==null&&
         !nonnegative(central.historical_effects.last_retained_pilot_heartbeat.last_retained_accepted_at_ms))||
       typeof central.historical_effects.last_retained_pilot_heartbeat.error_code!=='string'||
       !/^[A-Z_]{3,90}$/.test(central.historical_effects.last_retained_pilot_heartbeat.error_code)||
       central.historical_effects.signed_heartbeat_history_complete!==false||
       central.historical_effects.qa_effects_independently_reconciled!==false||
       central.historical_effects.external_git_effects_independently_reconciled!==false||
       central.historical_effects.qa_only_pc_pending_review_coverage_complete!==false||
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
    const effects=central.historical_effects;
    if(effects.centrally_confirmed_git_jobs_involving_this_pc_count>0)
      add('CENTRAL_CONFIRMED_GIT_HISTORY_REQUIRES_EXTERNAL_REVIEW');
    if(effects.qa_receipts_created_by_this_pc_count>0||
       effects.qa_receipts_on_worker_tickets_for_this_pc_count>0)
      add('CENTRAL_QA_RECEIPT_HISTORY_REQUIRES_INDEPENDENT_REVIEW');
    if(effects.pending_qa_owner_reviews_for_worker_tickets_count>0)
      add('CENTRAL_PENDING_QA_OWNER_REVIEW_ON_PC_WORK');
    if(effects.pending_qa_owner_reviews_global_count>0)
      add('CENTRAL_GLOBAL_QA_QUEUE_INCOMPLETE_CONTEXT');
    if(effects.local_agent_checkpoint_record_count>0)
      add('CENTRAL_CHECKPOINT_HISTORY_REQUIRES_WORK_REVIEW');
    const last=effects.last_retained_pilot_heartbeat;
    if(effects.retained_pilot_signed_heartbeat_packet_count===0){
      add('CENTRAL_RETAINED_SIGNED_HEARTBEAT_EVIDENCE_NOT_FOUND');
      if(last.record_present||last.error_code!=='NO_PILOT_PACKET_RETAINED')
        add('CENTRAL_PILOT_PACKET_COUNT_INCONSISTENT');
    }else{
      if(!last.record_present||!last.last_retained_packet_signature_verified||
         last.error_code!=='NONE')
        add('CENTRAL_RETAINED_HEARTBEAT_SIGNATURE_INVALID');
      if(last.last_retained_packet_signature_verified&&
         !last.retained_sequence_equals_current_accepted_node_counter)
        add('RETAINED_SIGNED_PACKET_DOES_NOT_COVER_LATEST_COUNTER');
      if(!last.retained_agent_sequences_not_ahead_of_central)
        add('RETAINED_AGENT_COUNTERS_REQUIRE_OWNER_REVIEW');
      if(last.last_retained_packet_signature_verified&&
         !last.retained_boot_id_matches_current)
        add('RETAINED_BOOT_ID_DIFFERS_FROM_CURRENT');
    }
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
      unresolved_git_job_count:data.unresolved_git_job_count,
      historical_effects:{
        ...data.historical_effects
      }
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
  // Create an intentionally allowlisted, read-only JSON artifact for the
  // Owner's OFFLINE review signer. It is not a grant or a server upload.
  // Unknown response fields are dropped so an accidental bearer token, key
  // or future sensitive database column can never leak into the file.
  function pick(x,fields){
    if(!isObject(x))fail('OWNER_CRASH_EXPORT_SOURCE_INVALID');
    const out={};
    for(const k of fields)if(Object.prototype.hasOwnProperty.call(x,k))
      out[k]=x[k];
    return out;
  }
  function safeLocal(local){
    const l=pick(local,['schema','kind','state','records',
      'other_directory_entries_count','evidence_signed','central_verified',
      'physical_pc_verified','agent_restart_allowed','installer_allowed',
      'marker_removal_allowed','production_release_allowed']);
    const records={};
    for(const k of Object.keys(RECORDS))
      records[k]=pick(local.records[k],['state','bytes','sha256']);
    l.records=records;
    return l;
  }
  function safeCentral(c){
    const v=pick(c,['schema','mode','node_id','node_state',
      'node_public_key_fingerprint_sha256','accepted_boot_id',
      'accepted_node_sequence_decimal','heartbeat_age_seconds',
      'agents','cluster','maintenance','active_worker_lease_count',
      'outstanding_worker_ticket_count','unresolved_git_job_count',
      'historical_effects','observed_at_central_ms','read_only',
      'central_state_modified','device_signature_verified_by_this_request',
      'local_os_vault_verified','physical_pc_verified',
      'owner_reconciliation_complete','agent_restart_allowed',
      'marker_removal_allowed','installer_execution_allowed',
      'production_release_authorized']);
    v.agents=c.agents.map(a=>pick(a,['agent_id','state',
      'accepted_sequence_decimal','status','master_eligible',
      'qa_eligible','heartbeat_age_seconds']));
    v.cluster=pick(c.cluster,['epoch_decimal','phase','paused',
      'master_agent_id','backup1','backup2',
      'original_pc_in_cluster_roles']);
    v.maintenance=pick(c.maintenance,['active_fence','fence_state',
      'plan_id','expected_epoch_decimal','unresolved_intent_count']);
    v.historical_effects=pick(c.historical_effects,[
      'global_audit_event_high_watermark_decimal',
      'retained_pilot_signed_heartbeat_packet_count',
      'signed_heartbeat_history_complete',
      'qa_receipts_created_by_this_pc_count',
      'qa_receipts_on_worker_tickets_for_this_pc_count',
      'pending_qa_owner_reviews_for_worker_tickets_count',
      'pending_qa_owner_reviews_global_count',
      'centrally_confirmed_git_jobs_involving_this_pc_count',
      'local_agent_checkpoint_record_count',
      'qa_effects_independently_reconciled',
      'external_git_effects_independently_reconciled',
      'qa_only_pc_pending_review_coverage_complete'
    ]);
    v.historical_effects.last_retained_pilot_heartbeat=pick(
      c.historical_effects.last_retained_pilot_heartbeat,[
        'record_present','last_retained_packet_signature_verified',
        'retained_sequence_equals_current_accepted_node_counter',
        'retained_agent_sequences_not_ahead_of_central',
        'retained_boot_id_matches_current',
        'last_retained_node_sequence_decimal','last_retained_accepted_at_ms',
        'error_code','read_only','complete_signed_heartbeat_history',
        'local_pc_possession_now_verified','physical_pc_verified',
        'agent_restart_allowed','production_release_authorized'
      ]);
    return v;
  }
  function makeReviewInputBundle(input){
    // Validate every original field first; then validate the precise
    // allowlisted artifact. Snapshot timestamps and session context come
    // ONLY from the same completed two-GET crosscheck.
    const original=inspectPair(input);
    if(original.read_only!==true||original.owner_reconciliation_complete!==false||
       original.agent_restart_allowed!==false||
       original.marker_removal_allowed!==false||
       original.installer_execution_allowed!==false||
       original.production_release_authorized!==false)
      fail('OWNER_CRASH_EXPORT_UNSAFE_REPORT');
    const safe={
      local:safeLocal(input.local),first:safeCentral(input.first),
      second:safeCentral(input.second),nodeId:input.nodeId,
      pinnedPublicKeySha256:input.pinnedPublicKeySha256,
      observedAtClientMs:input.observedAtClientMs
    };
    const checked=inspectPair(safe);
    if(JSON.stringify(checked.finding_codes)!==
       JSON.stringify(original.finding_codes)||
       checked.central_observation_unchanged!==original.central_observation_unchanged)
      fail('OWNER_CRASH_EXPORT_FINDINGS_CHANGED');
    const bundle={
      schema:1,kind:'SUTRADHAR_OWNER_CRASH_REVIEW_INPUT_BUNDLE_V1',
      read_only:true,owner_reconciliation_complete:false,
      agent_restart_allowed:false,marker_removal_allowed:false,
      installer_execution_allowed:false,production_release_authorized:false,
      input:safe
    };
    const text=JSON.stringify(bundle);
    if(text.length>180000)fail('OWNER_CRASH_EXPORT_TOO_LARGE');
    // JSON roundtrip eliminates VM/prototype aliases and mutable originals.
    return Object.freeze(JSON.parse(text));
  }
  const api=Object.freeze({inspect,inspectPair,makeReviewInputBundle});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SutradharCrashCrosscheck=api;
})(typeof window==='object'?window:null);
