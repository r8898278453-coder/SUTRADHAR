'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const browser={};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
  '../v7/ui/owner-crash-crosscheck.js'),'utf8'),{window:browser},
  {filename:'owner-crash-crosscheck.js'});
const {inspect,inspectPair}=browser.SutradharCrashCrosscheck;
const NODE='node_'+'a'.repeat(32),FP='c'.repeat(64);
const record=(state='MISSING',bytes=10)=>state==='MISSING'||state==='UNSAFE_OR_UNREADABLE'?
  {state}:{state,bytes,sha256:'b'.repeat(64)};
function fixture(){
  const records={
    session_intent:record('PRESENT_VALID_SHAPE'),
    encrypted_identity:record('PRESENT_HASHED'),
    vault_write_intent:record(),enrollment_receipt:record(),
    last_local_status:record(),maintenance_hold:record(),
    restart_ack:record(),installer_execution_attempt:record()
  };
  const local={schema:1,kind:'SUTRADHAR_LOCAL_CRASH_EVIDENCE_V1',
    state:'OWNER_REVIEW_REQUIRED',evidence_signed:false,
    central_verified:false,physical_pc_verified:false,
    agent_restart_allowed:false,installer_allowed:false,
    marker_removal_allowed:false,production_release_allowed:false,
    records,other_directory_entries_count:5};
  const central={schema:1,mode:'OWNER_CENTRAL_NODE_CRASH_RECOVERY_OBSERVATION',
    node_id:NODE,node_state:'APPROVED',node_public_key_fingerprint_sha256:FP,
    accepted_boot_id:'boot_fixture_001',heartbeat_age_seconds:17,
    accepted_node_sequence_decimal:'18446744073709551615',
    agents:[{agent_id:'agent_local_01',state:'APPROVED',status:'ONLINE',master_eligible:true,
      qa_eligible:false,heartbeat_age_seconds:18,accepted_sequence_decimal:'2'}],
    cluster:{epoch_decimal:'18446744073709551615',phase:'READY',paused:false,
      master_agent_id:null,backup1:null,backup2:null,original_pc_in_cluster_roles:false},
    maintenance:{active_fence:false,fence_state:null,plan_id:null,
      expected_epoch_decimal:null,unresolved_intent_count:0},
    active_worker_lease_count:0,outstanding_worker_ticket_count:0,
    unresolved_git_job_count:0,
    historical_effects:{
      global_audit_event_high_watermark_decimal:'1',
      retained_pilot_signed_heartbeat_packet_count:1,
      signed_heartbeat_history_complete:false,
      qa_receipts_created_by_this_pc_count:0,
      qa_receipts_on_worker_tickets_for_this_pc_count:0,
      pending_qa_owner_reviews_for_worker_tickets_count:0,
      pending_qa_owner_reviews_global_count:0,
      centrally_confirmed_git_jobs_involving_this_pc_count:0,
      local_agent_checkpoint_record_count:0,
      qa_effects_independently_reconciled:false,
      external_git_effects_independently_reconciled:false,
      qa_only_pc_pending_review_coverage_complete:false
    },
    observed_at_central_ms:1770000000000,
    read_only:true,central_state_modified:false,
    device_signature_verified_by_this_request:false,
    local_os_vault_verified:false,physical_pc_verified:false,
    owner_reconciliation_complete:false,agent_restart_allowed:false,
    marker_removal_allowed:false,installer_execution_allowed:false,
    production_release_authorized:false};
  return {local,central,nodeId:NODE,pinnedPublicKeySha256:FP};
}
test('matching owner pin and valid local hashes remain explicitly NOT an authorization',()=>{
  const f=fixture(),original=JSON.stringify(f),result=inspect(f);
  assert.equal(result.central_fingerprint_matches_independent_enrollment_pin,true);
  assert.equal(result.local_session_marker_shape_valid,true);
  assert.equal(result.state,'OWNER_REVIEW_REQUIRED');
  assert.equal(result.preliminary_inconsistency_count,0);
  assert.equal(result.local_evidence_cryptographically_authenticated,false);
  assert.equal(result.local_device_node_binding_verified,false);
  assert.equal(result.accepted_counter_continuity_verified,false);
  assert.equal(result.owner_reconciliation_complete,false);
  assert.equal(result.agent_restart_allowed,false);
  assert.equal(result.marker_removal_allowed,false);
  assert.equal(result.production_release_authorized,false);
  assert.equal(result.finding_codes.includes('LOCAL_TO_CENTRAL_IDENTITY_LINK_NOT_AUTHENTICATED'),true);
  assert.equal(JSON.stringify(f),original,'pure inspector cannot alter input evidence');
});
test('mismatched independently pinned key is detected even if every count is zero',()=>{
  const f=fixture();f.pinnedPublicKeySha256='d'.repeat(64);
  const r=inspect(f);
  assert.equal(r.central_fingerprint_matches_independent_enrollment_pin,false);
  assert.ok(r.finding_codes.includes('CENTRAL_PUBLIC_KEY_DIFFERS_FROM_INDEPENDENT_ENROLLMENT_PIN'));
  assert.equal(r.agent_restart_allowed,false);
});
test('corrupt marker, pending vault write, work/maintenance/Git and revoked PC remain held',()=>{
  const f=fixture();
  f.local.records.session_intent=record('PRESENT_INVALID_SHAPE');
  f.local.records.vault_write_intent=record('PRESENT_HASHED');
  f.local.records.encrypted_identity=record('UNSAFE_OR_UNREADABLE');
  f.central.node_state='REVOKED';
  f.central.cluster.original_pc_in_cluster_roles=true;
  f.central.maintenance.active_fence=true;
  f.central.active_worker_lease_count=3;
  f.central.outstanding_worker_ticket_count=1;
  f.central.unresolved_git_job_count=2;
  const r=inspect(f);
  for(const c of ['LOCAL_SESSION_MARKER_MISSING_TAMPERED_OR_UNSAFE',
    'LOCAL_ENCRYPTED_IDENTITY_MISSING_OR_UNSAFE','OS_VAULT_COUNTER_WRITE_INTENT_UNCERTAIN',
    'CENTRAL_NODE_NOT_APPROVED','CENTRAL_CLUSTER_ROLE_NEEDS_OWNER_REVIEW',
    'CENTRAL_MAINTENANCE_UNRESOLVED','CENTRAL_LIVE_WORKER_LEASES_PRESENT',
    'CENTRAL_OUTSTANDING_WORKER_TICKETS','CENTRAL_UNRESOLVED_GIT_EFFECTS'])
    assert.ok(r.finding_codes.includes(c),c);
  assert.equal(r.owner_reconciliation_complete,false);
});
test('rejects forged approval flags, malformed or extra local record fields, duplicate agents and numeric-rounded counters',()=>{
  const scenarios=[
    x=>{x.local.agent_restart_allowed=true;},
    x=>{x.local.records.encrypted_identity.private_key_pem='SECRET';},
    x=>{x.local.records.session_intent.sha256='nope';},
    x=>{x.local.records.vault_write_intent={state:'PRESENT_HASHED',bytes:999999,sha256:'b'.repeat(64)};},
    x=>{x.central.central_state_modified=true;},
    x=>{x.central.agent_restart_allowed=true;},
    x=>{x.central.accepted_node_sequence_decimal=Number.MAX_SAFE_INTEGER;},
    x=>{x.central.agents.push({...x.central.agents[0]});},
    x=>{x.central.node_id='node_'+'f'.repeat(32);},
    x=>{x.pinnedPublicKeySha256='';},
    x=>{x.nodeId='node_not_valid';}
  ];
  for(const mutate of scenarios){
    const input=fixture();mutate(input);
    assert.throws(()=>inspect(input),/INVALID|REQUIRED|UNTRUSTED/,mutate.toString());
  }
});

function samples(){
  const f=fixture(),first=JSON.parse(JSON.stringify(f.central)),
    second=JSON.parse(JSON.stringify(f.central));
  first.observed_at_central_ms=1770000000000;
  second.observed_at_central_ms=1770000001500;
  second.heartbeat_age_seconds=19;
  second.agents[0].heartbeat_age_seconds=20;
  return {...f,first,second,observedAtClientMs:1770000002500};
}
test('two valid Central snapshots with natural heartbeat-age drift never grant recovery',()=>{
  const x=samples(),result=inspectPair(x);
  assert.equal(result.central_observation_unchanged,true);
  assert.equal(result.central_observation_window_bounded,true);
  assert.equal(result.central_browser_clock_near_central,true);
  assert.equal(result.central_sample_gap_ms,1500);
  assert.equal(result.preliminary_inconsistency_count,0);
  assert.equal(result.state,'OWNER_REVIEW_REQUIRED');
  assert.equal(result.accepted_counter_continuity_verified,false);
  assert.equal(result.owner_reconciliation_complete,false);
  assert.equal(result.agent_restart_allowed,false);
  assert.equal(result.marker_removal_allowed,false);
  assert.equal(result.production_release_authorized,false);
});
test('racing epoch, counter, role, maintenance, worker and Git changes are flagged',()=>{
  const mutate=[
    x=>{x.second.accepted_node_sequence_decimal='1';},
    x=>{x.second.agents[0].accepted_sequence_decimal='3';},
    x=>{x.second.cluster.epoch_decimal='5';},
    x=>{x.second.cluster.backup1='agent_local_01';},
    x=>{x.second.maintenance.active_fence=true;
      x.second.maintenance.fence_state='DRAINING';x.second.maintenance.plan_id='plan_test123';},
    x=>{x.second.active_worker_lease_count=1;},
    x=>{x.second.outstanding_worker_ticket_count=1;},
    x=>{x.second.unresolved_git_job_count=1;},
    x=>{x.second.node_public_key_fingerprint_sha256='f'.repeat(64);}
  ];
  for(const change of mutate){
    const x=samples();change(x);
    const r=inspectPair(x);
    assert.equal(r.central_observation_unchanged,false,change.toString());
    assert.ok(r.finding_codes.includes('CENTRAL_STATE_CHANGED_BETWEEN_OWNER_READS'));
    assert.equal(r.agent_restart_allowed,false);
  }
});
test('stale, reversed, overlong or skewed Central read windows remain HOLD',()=>{
  const scenarios=[
    x=>{x.second.observed_at_central_ms=x.first.observed_at_central_ms-1;},
    x=>{x.second.observed_at_central_ms=x.first.observed_at_central_ms+31000;},
    x=>{x.observedAtClientMs=x.second.observed_at_central_ms+121000;}
  ];
  for(const change of scenarios){
    const x=samples();change(x);
    const r=inspectPair(x);
    assert.ok(r.preliminary_inconsistency_count>0);
    assert.ok(r.finding_codes.some(code=>
      ['CENTRAL_OBSERVATION_WINDOW_UNSAFE','CENTRAL_BROWSER_CLOCK_MISMATCH']
        .includes(code)));
    assert.equal(r.owner_reconciliation_complete,false);
  }
});
test('both remote responses and exact unsigned BIGINT range are validated before comparison',()=>{
  const failures=[
    x=>{x.first.central_state_modified=true;},
    x=>{x.first.node_id='node_'+'f'.repeat(32);},
    x=>{x.second.agents[0].accepted_sequence_decimal=Number.MAX_SAFE_INTEGER;},
    x=>{x.second.accepted_node_sequence_decimal='18446744073709551616';},
    x=>{x.first.cluster.epoch_decimal='99999999999999999999';},
    x=>{x.second.observed_at_central_ms='1770000001500';},
    x=>{x.first.maintenance.fence_state='DRAINING';},
    x=>{x.second.agents[0].state='NOT_RECOGNIZED';},
    x=>{x.observedAtClientMs=NaN;}
  ];
  for(const change of failures){
    const x=samples();change(x);
    assert.throws(()=>inspectPair(x),/INVALID|REQUIRED|UNTRUSTED|MALFORMED|INCONSISTENT/,
      change.toString());
  }
});


test('historical QA, confirmed Git, pending reviews, checkpoints and pilot gaps remain explicit holds',()=>{
  const f=fixture(),h=f.central.historical_effects;
  h.retained_pilot_signed_heartbeat_packet_count=0;
  h.qa_receipts_created_by_this_pc_count=1;
  h.qa_receipts_on_worker_tickets_for_this_pc_count=2;
  h.pending_qa_owner_reviews_for_worker_tickets_count=3;
  h.pending_qa_owner_reviews_global_count=4;
  h.centrally_confirmed_git_jobs_involving_this_pc_count=1;
  h.local_agent_checkpoint_record_count=2;
  const r=inspect(f);
  for(const code of ['CENTRAL_CONFIRMED_GIT_HISTORY_REQUIRES_EXTERNAL_REVIEW',
    'CENTRAL_QA_RECEIPT_HISTORY_REQUIRES_INDEPENDENT_REVIEW',
    'CENTRAL_PENDING_QA_OWNER_REVIEW_ON_PC_WORK',
    'CENTRAL_GLOBAL_QA_QUEUE_INCOMPLETE_CONTEXT',
    'CENTRAL_CHECKPOINT_HISTORY_REQUIRES_WORK_REVIEW',
    'CENTRAL_RETAINED_SIGNED_HEARTBEAT_EVIDENCE_NOT_FOUND'])
    assert.ok(r.finding_codes.includes(code),code);
  assert.equal(r.agent_restart_allowed,false);
  assert.equal(r.owner_reconciliation_complete,false);
});
test('new historical-effect changes or audit watermark changes between GETs are flagged',()=>{
  const mutate=[
    x=>{x.second.historical_effects.qa_receipts_created_by_this_pc_count=1;},
    x=>{x.second.historical_effects.pending_qa_owner_reviews_global_count=1;},
    x=>{x.second.historical_effects.centrally_confirmed_git_jobs_involving_this_pc_count=1;},
    x=>{x.second.historical_effects.global_audit_event_high_watermark_decimal='2';}
  ];
  for(const change of mutate){
    const x=samples();change(x);
    const r=inspectPair(x);
    assert.equal(r.central_observation_unchanged,false);
    assert.ok(r.finding_codes.includes('CENTRAL_STATE_CHANGED_BETWEEN_OWNER_READS'));
    assert.equal(r.marker_removal_allowed,false);
  }
});
test('forged evidence coverage, missing effects and malformed global event counter reject',()=>{
  const mutate=[
    x=>{x.central.historical_effects.signed_heartbeat_history_complete=true;},
    x=>{x.central.historical_effects.external_git_effects_independently_reconciled=true;},
    x=>{delete x.central.historical_effects;},
    x=>{x.central.historical_effects.global_audit_event_high_watermark_decimal='18446744073709551616';},
    x=>{x.central.historical_effects.pending_qa_owner_reviews_global_count=-1;}
  ];
  for(const change of mutate){
    const x=fixture();change(x);
    assert.throws(()=>inspect(x),/INVALID|UNTRUSTED/,change.toString());
  }
});

test('Owner HTML comparison is GET-only and uses textContent, not hidden POST upload',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../v7/ui/index.html'),'utf8');
  const dashboard=fs.readFileSync(path.resolve(__dirname,'../v7/ui/dashboard.js'),'utf8');
  const library=fs.readFileSync(path.resolve(__dirname,'../v7/ui/owner-crash-crosscheck.js'),'utf8');
  for(const id of ['node-recovery-local-json','node-recovery-pin',
    'node-recovery-crosscheck','node-recovery-crosscheck-results'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/src="\/owner-crash-crosscheck\.js"/);
  assert.match(dashboard,/SutradharCrashCrosscheck\.inspectPair/);
  assert.match(dashboard,/centralBefore=await request/);
  assert.match(dashboard,/centralAfter=await request/);
  assert.match(dashboard,/request\('\/v7\/owner\/node-recovery\/'\+encodeURIComponent\(nodeId\)\)/);
  assert.match(dashboard,/crosscheckOutput\.textContent/);
  assert.doesNotMatch(library,/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|\.sign\(|unlinkSync|writeFileSync/);
  assert.doesNotMatch(dashboard,/crosscheckOutput\.innerHTML\s*=/);
});
