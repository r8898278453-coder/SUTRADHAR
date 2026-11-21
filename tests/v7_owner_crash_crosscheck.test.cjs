'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const browser={};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
  '../v7/ui/owner-crash-crosscheck.js'),'utf8'),{window:browser},
  {filename:'owner-crash-crosscheck.js'});
const {inspect}=browser.SutradharCrashCrosscheck;
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
    accepted_node_sequence_decimal:'18446744073709551615',
    agents:[{agent_id:'agent_local_01',accepted_sequence_decimal:'2'}],
    cluster:{epoch_decimal:'18446744073709551615',original_pc_in_cluster_roles:false},
    maintenance:{active_fence:false,unresolved_intent_count:0},
    active_worker_lease_count:0,outstanding_worker_ticket_count:0,
    unresolved_git_job_count:0,read_only:true,central_state_modified:false,
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
test('Owner HTML comparison is GET-only and uses textContent, not hidden POST upload',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../v7/ui/index.html'),'utf8');
  const dashboard=fs.readFileSync(path.resolve(__dirname,'../v7/ui/dashboard.js'),'utf8');
  const library=fs.readFileSync(path.resolve(__dirname,'../v7/ui/owner-crash-crosscheck.js'),'utf8');
  for(const id of ['node-recovery-local-json','node-recovery-pin',
    'node-recovery-crosscheck','node-recovery-crosscheck-results'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/src="\/owner-crash-crosscheck\.js"/);
  assert.match(dashboard,/SutradharCrashCrosscheck\.inspect/);
  assert.match(dashboard,/request\('\/v7\/owner\/node-recovery\/'\+encodeURIComponent\(nodeId\)\)/);
  assert.match(dashboard,/crosscheckOutput\.textContent/);
  assert.doesNotMatch(library,/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|\.sign\(|unlinkSync|writeFileSync/);
  assert.doesNotMatch(dashboard,/crosscheckOutput\.innerHTML\s*=/);
});
