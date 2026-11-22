'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const browser={};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
  '../v7/ui/owner-crash-crosscheck.js'),'utf8'),{window:browser},
  {filename:'owner-crash-crosscheck.js'});
const {inspect,inspectPair,makeReviewInputBundle}=browser.SutradharCrashCrosscheck;
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
      last_retained_pilot_heartbeat:{
        record_present:true,last_retained_packet_signature_verified:true,
        retained_sequence_equals_current_accepted_node_counter:true,
        retained_agent_sequences_not_ahead_of_central:true,
        retained_boot_id_matches_current:true,last_retained_node_sequence_decimal:'7',
        last_retained_accepted_at_ms:1770000000000,error_code:'NONE',
        read_only:true,complete_signed_heartbeat_history:false,
        local_pc_possession_now_verified:false,physical_pc_verified:false,
        agent_restart_allowed:false,production_release_authorized:false
      },
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
  h.last_retained_pilot_heartbeat.record_present=false;
  h.last_retained_pilot_heartbeat.last_retained_packet_signature_verified=false;
  h.last_retained_pilot_heartbeat.error_code='NO_PILOT_PACKET_RETAINED';
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
test('corrupt retained pilot packet, gap to current counter and counter inconsistency stay HOLD',()=>{
  const f=fixture();
  f.central.historical_effects.last_retained_pilot_heartbeat.last_retained_packet_signature_verified=false;
  f.central.historical_effects.last_retained_pilot_heartbeat.error_code='PILOT_PACKET_SIGNATURE_INVALID';
  const r=inspect(f);
  assert.ok(r.finding_codes.includes('CENTRAL_RETAINED_HEARTBEAT_SIGNATURE_INVALID'));
  const p=fixture();
  p.central.historical_effects.last_retained_pilot_heartbeat.retained_sequence_equals_current_accepted_node_counter=false;
  const gap=inspect(p);
  assert.ok(gap.finding_codes.includes('RETAINED_SIGNED_PACKET_DOES_NOT_COVER_LATEST_COUNTER'));
  for(const item of [r,gap]){
    assert.equal(item.agent_restart_allowed,false);
    assert.equal(item.owner_reconciliation_complete,false);
  }
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
  assert.match(dashboard,/const sameInputs=\(\)=>key===initialKey/);
  assert.match(dashboard,/ownerSessionVersion===initialSessionVersion/);
  assert.match(dashboard,/ownerRecoveryVersion===initialRecoveryVersion/);
  assert.match(dashboard,/if\(!sameInputs\(\)\)throw Error\('OWNER_CRASH_CROSSCHECK_INPUT_CHANGED'\)/);
  assert.match(dashboard,/request\('\/v7\/owner\/node-recovery\/'\+encodeURIComponent\(nodeId\)\)/);
  assert.match(dashboard,/crosscheckOutput\.textContent/);
  assert.doesNotMatch(library,/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|\.sign\(|unlinkSync|writeFileSync/);
  assert.doesNotMatch(dashboard,/crosscheckOutput\.innerHTML\s*=/);
});


const crypto=require('node:crypto');
const {createReviewManifest,verifySignedReview,canonical,SIGN_DOMAIN}=
  require('../scripts/ops/crash-owner-review.cjs');
const ownerKeys=crypto.generateKeyPairSync('ed25519');
const ownerPublic=ownerKeys.publicKey.export({type:'spki',format:'pem'}).toString();
function ownerSigned(input,patch={},now=input.observedAtClientMs){
  const manifest=createReviewManifest(input);
  const signed={schema:1,action:'ACKNOWLEDGE_CRASH_EVIDENCE_REVIEW_ONLY',
    node_id:input.nodeId,
    independent_enrollment_fingerprint_sha256:input.pinnedPublicKeySha256,
    manifest_sha256:manifest.manifest_sha256,
    review_id:'d'.repeat(64),
    review_note:'Owner read-only evidence acknowledgement; manual review still required.',
    issued_at_ms:now-1000,expires_at_ms:now+60000,
    agent_restart_allowed:false,marker_removal_allowed:false,
    installer_execution_allowed:false,production_release_authorized:false,
    ...patch};
  return {signed,signature_base64:crypto.sign(null,
    Buffer.from(SIGN_DOMAIN+canonical(signed)),ownerKeys.privateKey)
    .toString('base64')};
}
test('independent Owner-signed crash review binds exact double GET and local hashes, NOT authority',()=>{
  const input=samples(),prior=JSON.stringify(input);
  const m=createReviewManifest(input),signed=ownerSigned(input);
  assert.match(m.manifest_sha256,/^[a-f0-9]{64}$/);
  assert.equal(m.node_id,input.nodeId);
  const v=verifySignedReview({input,envelope:signed,
    pinnedOwnerReviewPublicKeyPem:ownerPublic,now:input.observedAtClientMs});
  assert.equal(v.owner_review_signature_valid,true);
  assert.equal(v.exact_evidence_digest_match,true);
  assert.equal(v.replay_prevention_enforced,false);
  assert.equal(v.owner_reconciliation_complete,false);
  for(const k of ['agent_restart_allowed','marker_removal_allowed',
    'installer_execution_allowed','production_release_authorized'])
    assert.equal(v[k],false);
  assert.equal(JSON.stringify(input),prior,'input is immutable from verifier');
  assert.equal(JSON.stringify(v).includes('signature_base64'),false);
  assert.equal(JSON.stringify(v).includes('private_key'),false);
});
test('same signed review invalid after local hash, Central counter, epoch or audit shift',()=>{
  const input=samples(),signed=ownerSigned(input);
  const changes=[
    x=>{x.local.records.encrypted_identity.sha256='f'.repeat(64);},
    x=>{x.first.accepted_node_sequence_decimal='2';},
    x=>{x.second.cluster.epoch_decimal='5';},
    x=>{x.second.historical_effects.global_audit_event_high_watermark_decimal='2';},
    x=>{x.pinnedPublicKeySha256='f'.repeat(64);},
    x=>{x.nodeId='node_'+'b'.repeat(32);},
    x=>{x.observedAtClientMs+=1000;}
  ];
  for(const change of changes){
    const altered=JSON.parse(JSON.stringify(input));change(altered);
    assert.throws(()=>verifySignedReview({input:altered,envelope:signed,
      pinnedOwnerReviewPublicKeyPem:ownerPublic,now:input.observedAtClientMs}),
      /CRASH_OWNER_REVIEW_/);
  }
});
test('invalid signature, different key, action, scope, expiry and authorization bits fail closed',()=>{
  const x=samples(),good=ownerSigned(x);
  assert.throws(()=>verifySignedReview({input:x,envelope:good,
    pinnedOwnerReviewPublicKeyPem:crypto.generateKeyPairSync('ed25519')
      .publicKey.export({type:'spki',format:'pem'}).toString(),
    now:x.observedAtClientMs}),/SIGNATURE_INVALID/);
  const change=[
    {action:'restart_after_maintenance'},
    {agent_restart_allowed:true},
    {marker_removal_allowed:true},
    {installer_execution_allowed:true},
    {production_release_authorized:true},
    {manifest_sha256:'f'.repeat(64)},
    {review_id:'not_a_uuid'},
    {review_note:'OK'},
    {expires_at_ms:x.observedAtClientMs+300001},
    {issued_at_ms:x.observedAtClientMs+61000}
  ];
  for(const patch of change){
    assert.throws(()=>verifySignedReview({input:x,
      envelope:ownerSigned(x,patch),
      pinnedOwnerReviewPublicKeyPem:ownerPublic,
      now:x.observedAtClientMs}),/SIGNED_REVIEW_SCOPE_INVALID/,JSON.stringify(patch));
  }
  assert.throws(()=>verifySignedReview({input:x,envelope:good,
    pinnedOwnerReviewPublicKeyPem:ownerPublic,
    now:x.observedAtClientMs+300001}),/SIGNED_REVIEW_SCOPE_INVALID/);
});
test('invalid local or remote data never becomes Owner-signed review',()=>{
  for(const change of [
    x=>{x.local.agent_restart_allowed=true;},
    x=>{x.first.central_state_modified=true;},
    x=>{x.second.node_id='node_'+'f'.repeat(32);},
    x=>{x.first.historical_effects.signed_heartbeat_history_complete=true;}
  ]){
    const x=samples();change(x);
    assert.throws(()=>createReviewManifest(x),/CRASH_OWNER_REVIEW_CROSSCHECK_INVALID/);
  }
});
test('offline Owner review tools remain separate from maintenance release and have no execution path',()=>{
  for(const file of ['../scripts/ops/crash-owner-review.cjs',
    '../scripts/ops/verify-crash-owner-review.cjs',
    '../scripts/release/sign-crash-owner-review.cjs']){
    const source=fs.readFileSync(path.resolve(__dirname,file),'utf8');
    assert.doesNotMatch(source,/spawnSync|execFileSync|child_process|[.]kill[(]|unlinkSync|renameSync|fetch[(]|axios|http[.]request|https[.]request|app[.]post/);
  }
  const source=fs.readFileSync(path.resolve(__dirname,
    '../scripts/release/sign-crash-owner-review.cjs'),'utf8');
  assert.match(source,/SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_APPROVED/);
  assert.match(source,/outputPath,'wx'/);
  assert.match(source,/ACKNOWLEDGE_CRASH_EVIDENCE_REVIEW_ONLY/);
  assert.match(source,/production_release_authorized:false/);
});


test('offline Owner CLI signs, verifies and detects tampered evidence with disposable key only',()=>{
  const os=require('node:os'),childProcess=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-owner-crash-review-'));
  const x=samples(),now=Date.now();
  x.first.observed_at_central_ms=now-1600;
  x.second.observed_at_central_ms=now-900;
  x.observedAtClientMs=now-500;
  const files={
    local:path.join(dir,'local.json'),
    first:path.join(dir,'first.json'),
    second:path.join(dir,'second.json'),
    private:path.join(dir,'owner-private.pem'),
    public:path.join(dir,'owner-public.pem'),
    out:path.join(dir,'owner-review.json')
  };
  try{
    for(const key of ['local','first','second'])
      fs.writeFileSync(files[key],JSON.stringify(x[key]));
    const keys=crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(files.private,keys.privateKey.export({
      format:'pem',type:'pkcs8'}),{mode:0o600});
    fs.writeFileSync(files.public,keys.publicKey.export({
      format:'pem',type:'spki'}),{mode:0o600});
    const env={...process.env,
      SUTRADHAR_CRASH_LOCAL_JSON:files.local,
      SUTRADHAR_CRASH_CENTRAL_FIRST_JSON:files.first,
      SUTRADHAR_CRASH_CENTRAL_SECOND_JSON:files.second,
      SUTRADHAR_CRASH_NODE_ID:x.nodeId,
      SUTRADHAR_CRASH_ENROLLMENT_FINGERPRINT:x.pinnedPublicKeySha256,
      SUTRADHAR_CRASH_OBSERVED_AT_CLIENT_MS:String(x.observedAtClientMs),
      SUTRADHAR_CRASH_OWNER_SIGNING_KEY_FILE:files.private,
      SUTRADHAR_CRASH_OWNER_REVIEW_OUTPUT:files.out,
      SUTRADHAR_CRASH_OWNER_REVIEW_NOTE:
        'Owner reviewed the test-only crash evidence. No restart is permitted.',
      SUTRADHAR_CRASH_OWNER_REVIEW_FILE:files.out,
      SUTRADHAR_CRASH_OWNER_PUBLIC_KEY_FILE:files.public
    };
    const run=(script,patch={})=>childProcess.spawnSync(
      process.execPath,[path.resolve(__dirname,script)],
      {env:{...env,...patch},encoding:'utf8',timeout:10000});
    let r=run('../scripts/release/sign-crash-owner-review.cjs');
    assert.notEqual(r.status,0,'explicit Owner opt-in is mandatory');
    assert.equal(fs.existsSync(files.out),false);
    r=run('../scripts/release/sign-crash-owner-review.cjs',{
      SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_APPROVED:'yes'
    });
    assert.equal(r.status,0,r.stderr);
    assert.equal(JSON.parse(r.stdout).agent_restart_allowed,false);
    const signature=JSON.parse(fs.readFileSync(files.out,'utf8'));
    assert.equal(signature.signed.agent_restart_allowed,false);
    r=run('../scripts/release/sign-crash-owner-review.cjs',{
      SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_APPROVED:'yes'
    });
    assert.notEqual(r.status,0,'signed review output is exclusive; never overwritten');
    r=run('../scripts/ops/verify-crash-owner-review.cjs');
    assert.equal(r.status,0,r.stderr);
    const verified=JSON.parse(r.stdout);
    assert.equal(verified.owner_review_signature_valid,true);
    assert.equal(verified.replay_prevention_enforced,false);
    assert.equal(verified.marker_removal_allowed,false);
    assert.equal(verified.production_release_authorized,false);
    const tampered=JSON.parse(fs.readFileSync(files.second,'utf8'));
    tampered.cluster.epoch_decimal='999';
    fs.writeFileSync(files.second,JSON.stringify(tampered));
    r=run('../scripts/ops/verify-crash-owner-review.cjs');
    assert.notEqual(r.status,0,'new Central epoch invalidates old Owner review');
    assert.match(r.stderr,/CRASH_OWNER_REVIEW_/);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('browser exported review bundle allowlists data and remains irrevocably HOLD',()=>{
  const input=samples();
  input.local.private_key_pem='DO_NOT_EXPORT_PRIVATE_KEY';
  input.first.node_public_key_pem='DO_NOT_EXPORT_CENTRAL_PEM';
  input.second.agents[0].api_token='DO_NOT_EXPORT_TOKEN';
  // Unknown historical-effect field is identical across both reads.
  // A change between the reads must still be treated as a drift warning.
  input.first.historical_effects.internal_session_secret='DO_NOT_EXPORT_SECRET';
  input.second.historical_effects.internal_session_secret='DO_NOT_EXPORT_SECRET';
  const malformed=JSON.parse(JSON.stringify(input));
  malformed.local.records.encrypted_identity.vault_secret='DO_NOT_EXPORT_VAULT_SECRET';
  assert.throws(()=>makeReviewInputBundle(malformed),/LOCAL_CRASH_RECORD_INVALID/,
    'unexpected fields inside hashed local records must fail closed');
  const bundle=makeReviewInputBundle(input);
  assert.equal(bundle.schema,1);
  assert.equal(bundle.kind,'SUTRADHAR_OWNER_CRASH_REVIEW_INPUT_BUNDLE_V1');
  for(const flag of ['agent_restart_allowed','marker_removal_allowed',
    'installer_execution_allowed','production_release_authorized',
    'owner_reconciliation_complete'])
    assert.equal(bundle[flag],false,flag);
  assert.equal(bundle.read_only,true);
  assert.equal(JSON.stringify(bundle).includes('DO_NOT_EXPORT'),false);
  const extracted=JSON.parse(JSON.stringify(bundle.input));
  const result=inspectPair(extracted);
  assert.equal(result.state,'OWNER_REVIEW_REQUIRED');
  assert.equal(result.agent_restart_allowed,false);
  const manifest=createReviewManifest(extracted);
  assert.match(manifest.manifest_sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(bundle).includes('private_key_pem'),false);
  assert.equal(JSON.stringify(bundle).includes('api_token'),false);
});
test('browser export refuses invalid local/Central authority and counters',()=>{
  for(const change of [
    x=>{x.local.marker_removal_allowed=true;},
    x=>{x.first.production_release_authorized=true;},
    x=>{x.second.accepted_node_sequence_decimal='18446744073709551616';},
    x=>{x.nodeId='node_'+'f'.repeat(32);}
  ]){
    const x=samples();change(x);
    assert.throws(()=>makeReviewInputBundle(x));
  }
});
test('offline CLI accepts a single Owner browser bundle and rejects mixed or tampered modes',()=>{
  const os=require('node:os'),childProcess=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-crash-bundle-'));
  const x=samples(),now=Date.now();
  x.first.observed_at_central_ms=now-1300;
  x.second.observed_at_central_ms=now-800;
  x.observedAtClientMs=now-300;
  const inputFile=path.join(dir,'owner-review-input.json'),
    secret=path.join(dir,'owner-ed25519.pem'),
    publicKey=path.join(dir,'owner-ed25519.pub'),
    result=path.join(dir,'signed-review.json');
  try{
    fs.writeFileSync(inputFile,JSON.stringify(makeReviewInputBundle(x)));
    const keys=crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(secret,keys.privateKey.export({
      type:'pkcs8',format:'pem'}),{mode:0o600});
    fs.writeFileSync(publicKey,keys.publicKey.export({
      type:'spki',format:'pem'}),{mode:0o600});
    const clean={...process.env};
    for(const name of Object.keys(clean))
      if(name.startsWith('SUTRADHAR_CRASH_')||
         name==='SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_APPROVED')
        delete clean[name];
    const env={...clean,
      SUTRADHAR_CRASH_REVIEW_BUNDLE_JSON:inputFile,
      SUTRADHAR_CRASH_OWNER_SIGNING_KEY_FILE:secret,
      SUTRADHAR_CRASH_OWNER_REVIEW_OUTPUT:result,
      SUTRADHAR_CRASH_OWNER_REVIEW_NOTE:
        'Owner reviewed this ephemeral test snapshot, no process or release authority.',
      SUTRADHAR_CRASH_OWNER_PUBLIC_KEY_FILE:publicKey,
      SUTRADHAR_CRASH_OWNER_REVIEW_FILE:result,
      SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_APPROVED:'yes'};
    const run=(script,extra={})=>childProcess.spawnSync(
      process.execPath,[path.resolve(__dirname,script)],
      {env:{...env,...extra},encoding:'utf8',timeout:10000});
    let r=run('../scripts/release/sign-crash-owner-review.cjs');
    assert.equal(r.status,0,r.stderr);
    r=run('../scripts/ops/verify-crash-owner-review.cjs');
    assert.equal(r.status,0,r.stderr);
    const verified=JSON.parse(r.stdout);
    assert.equal(verified.owner_review_signature_valid,true);
    assert.equal(verified.agent_restart_allowed,false);
    assert.equal(verified.replay_prevention_enforced,false);
    assert.notEqual(run('../scripts/ops/verify-crash-owner-review.cjs',{
      SUTRADHAR_CRASH_LOCAL_JSON:inputFile
    }).status,0,'mixed file modes are forbidden');
    const tampered=JSON.parse(fs.readFileSync(inputFile,'utf8'));
    tampered.input.second.cluster.epoch_decimal='42';
    fs.writeFileSync(inputFile,JSON.stringify(tampered));
    r=run('../scripts/ops/verify-crash-owner-review.cjs');
    assert.notEqual(r.status,0,'changed evidence must not verify old signature');
    assert.match(r.stderr,/CRASH_OWNER_REVIEW_/);
    tampered.agent_restart_allowed=true;
    fs.writeFileSync(inputFile,JSON.stringify(tampered));
    r=run('../scripts/ops/verify-crash-owner-review.cjs');
    assert.notEqual(r.status,0,'forged authorization flag fails closed');
    assert.match(r.stderr,/BUNDLE_INVALID_OR_UNTRUSTED/);
    // A malicious file can keep all required flags false but insert a
    // sensitive field that a legacy shape-only comparison might ignore.
    const extra=JSON.parse(JSON.stringify(makeReviewInputBundle(x)));
    extra.input.first.private_key_pem='FORGED_BUNDLE_SECRET';
    fs.writeFileSync(inputFile,JSON.stringify(extra));
    r=run('../scripts/ops/verify-crash-owner-review.cjs');
    assert.notEqual(r.status,0,'hidden unallowlisted data must be rejected');
    assert.match(r.stderr,/BUNDLE_NOT_ALLOWLISTED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
