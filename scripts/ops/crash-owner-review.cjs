/**
 * Offline Owner-signed CRASH EVIDENCE REVIEW; NOT a recovery grant.
 *
 * Materializes a deterministic digest of the exact local crash diagnostic
 * and two Owner-authenticated (but untrusted) Central GET JSON snapshots.
 * Reuses the browser's fail-closed dual crosscheck and binds the resulting
 * findings. Signature proves only which evidence was acknowledged by an
 * independently pinned Owner review key, never actual Windows/DPAPI health.
 *
 * No network calls, file deletion, signing, Central writes or restart.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto');
const NODE=/^node_[a-f0-9]{32}$/;
const HEX=/^[a-f0-9]{64}$/;
const SIGN_DOMAIN='SUTRADHAR_OWNER_CRASH_EVIDENCE_REVIEW_V1\n';
const MAX_FILE=65536;
const MAX_CANONICAL=100000;
function fail(code){throw Error('CRASH_OWNER_REVIEW_'+code);}
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function exact(x,fields){return object(x)&&Object.keys(x).sort().join('|')===
  fields.slice().sort().join('|');}
function canonical(value){
  function walk(v,depth){
    if(depth>64)fail('NESTING_LIMIT_EXCEEDED');
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v==='number'){
      if(!Number.isSafeInteger(v))fail('UNSAFE_NUMBER');
      return v;
    }
    if(Array.isArray(v))return v.map(x=>walk(x,depth+1));
    if(!object(v)||Object.getPrototypeOf(v)!==Object.prototype&&
       Object.getPrototypeOf(v)!==null)
      fail('NON_JSON_INPUT');
    const out={};
    for(const key of Object.keys(v).sort()){
      if(key==='__proto__'||key==='constructor'||key==='prototype')
        fail('UNSAFE_JSON_KEY');
      Object.defineProperty(out,key,{value:walk(v[key],depth+1),
        writable:true,enumerable:true,configurable:true});
    }
    return out;
  }
  const json=JSON.stringify(walk(value,0));
  if(typeof json!=='string'||Buffer.byteLength(json)>MAX_CANONICAL)
    fail('INPUT_TOO_LARGE');
  return json;
}
function sha(value){return crypto.createHash('sha256')
  .update(Buffer.from(canonical(value),'utf8')).digest('hex');}
function crosscheck(input){
  // Load the exact same pure, networkless inspector shipped to the Owner UI.
  // VM prevents this bridge from turning its browser globals into Node
  // file/network access. Inputs are copied by JSON serialization.
  const source=fs.readFileSync(path.join(__dirname,
    '../../v7/ui/owner-crash-crosscheck.js'),'utf8');
  const window={};
  vm.runInNewContext(source,{window},{filename:'owner-crash-crosscheck.js',
    timeout:3000});
  const lib=window.SutradharCrashCrosscheck;
  if(typeof lib?.inspectPair!=='function')fail('INSPECTOR_UNAVAILABLE');
  let report;
  try{report=lib.inspectPair(JSON.parse(canonical(input)));}
  catch{fail('CROSSCHECK_INVALID');}
  return JSON.parse(JSON.stringify(report));
}
function createReviewManifest({local,first,second,nodeId,
  pinnedPublicKeySha256,observedAtClientMs}={}){
  if(!NODE.test(nodeId||'')||!HEX.test(pinnedPublicKeySha256||'')||
     !Number.isSafeInteger(observedAtClientMs)||observedAtClientMs<1)
    fail('INDEPENDENT_SCOPE_REQUIRED');
  const report=crosscheck({local,first,second,nodeId,
    pinnedPublicKeySha256,observedAtClientMs});
  if(report.kind!=='OWNER_PC_CRASH_DUAL_CROSSCHECK_V1'||
     report.state!=='OWNER_REVIEW_REQUIRED'||
     report.read_only!==true||
     report.agent_restart_allowed!==false||
     report.marker_removal_allowed!==false||
     report.installer_execution_allowed!==false||
     report.production_release_authorized!==false||
     report.owner_reconciliation_complete!==false||
     !Array.isArray(report.finding_codes)||report.finding_codes.length<4)
    fail('UNSAFE_INSPECTOR_RESULT');
  const manifest={
    schema:1,kind:'OWNER_CRASH_EVIDENCE_MANIFEST_V1',node_id:nodeId,
    independent_enrollment_fingerprint_sha256:pinnedPublicKeySha256,
    local_diagnostic_sha256:sha(local),
    central_first_snapshot_sha256:sha(first),
    central_second_snapshot_sha256:sha(second),
    crosscheck_findings_sha256:sha(report),
    first_central_observed_at_ms:first.observed_at_central_ms,
    second_central_observed_at_ms:second.observed_at_central_ms,
    observed_at_client_ms:observedAtClientMs,
    central_epoch_decimal:second.cluster.epoch_decimal,
    central_accepted_node_sequence_decimal:second.accepted_node_sequence_decimal,
    central_global_audit_event_high_watermark_decimal:
      second.historical_effects.global_audit_event_high_watermark_decimal,
    central_observation_unchanged:report.central_observation_unchanged,
    central_observation_window_bounded:report.central_observation_window_bounded,
    central_browser_clock_near_central:
      report.central_browser_clock_near_central,
    read_only:true,owner_reconciliation_complete:false,
    agent_restart_allowed:false,marker_removal_allowed:false,
    installer_execution_allowed:false,production_release_authorized:false
  };
  return Object.freeze({...manifest,manifest_sha256:sha(manifest)});
}
function verifySignedReview({input,envelope,pinnedOwnerReviewPublicKeyPem,
  now=Date.now()}={}){
  if(!Number.isSafeInteger(now)||now<1)fail('CLOCK_INVALID');
  const manifest=createReviewManifest(input);
  const signed=envelope?.signed;
  if(!exact(envelope,['signed','signature_base64'])||
     !exact(signed,['schema','action','node_id','review_id',
       'independent_enrollment_fingerprint_sha256','manifest_sha256',
       'review_note','issued_at_ms','expires_at_ms',
       'agent_restart_allowed','marker_removal_allowed',
       'installer_execution_allowed','production_release_authorized'])||
     signed.schema!==1||
     signed.action!=='ACKNOWLEDGE_CRASH_EVIDENCE_REVIEW_ONLY'||
     signed.node_id!==manifest.node_id||
     signed.independent_enrollment_fingerprint_sha256!==
       manifest.independent_enrollment_fingerprint_sha256||
     signed.manifest_sha256!==manifest.manifest_sha256||
     !HEX.test(signed.review_id||'')||
     typeof signed.review_note!=='string'||
     signed.review_note.trim().length<40||signed.review_note.length>800||
     signed.agent_restart_allowed!==false||
     signed.marker_removal_allowed!==false||
     signed.installer_execution_allowed!==false||
     signed.production_release_authorized!==false||
     !Number.isSafeInteger(signed.issued_at_ms)||
     !Number.isSafeInteger(signed.expires_at_ms)||
     signed.issued_at_ms>now+60000||signed.expires_at_ms<=now||
     signed.expires_at_ms<=signed.issued_at_ms||
     signed.expires_at_ms-signed.issued_at_ms>5*60000||
     now-manifest.second_central_observed_at_ms>5*60000||
     manifest.second_central_observed_at_ms>now+60000)
    fail('SIGNED_REVIEW_SCOPE_INVALID');
  if(typeof pinnedOwnerReviewPublicKeyPem!=='string'||
     pinnedOwnerReviewPublicKeyPem.length<100||
     pinnedOwnerReviewPublicKeyPem.length>4000)
    fail('INDEPENDENT_OWNER_REVIEW_KEY_REQUIRED');
  const signature=envelope.signature_base64;
  if(typeof signature!=='string'||
     !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    fail('SIGNATURE_ENCODING_INVALID');
  let verified=false;
  try{
    const key=crypto.createPublicKey(pinnedOwnerReviewPublicKeyPem);
    const bytes=Buffer.from(signature,'base64');
    if(key.asymmetricKeyType==='ed25519'&&bytes.length===64&&
       bytes.toString('base64')===signature){
      verified=crypto.verify(null,
        Buffer.from(SIGN_DOMAIN+canonical(signed),'utf8'),key,bytes);
    }
  }catch{}
  if(!verified)fail('SIGNATURE_INVALID');
  return Object.freeze({
    schema:1,kind:'OWNER_CRASH_EVIDENCE_REVIEW_VERIFICATION_V1',
    review_id:signed.review_id,node_id:signed.node_id,
    manifest_sha256:manifest.manifest_sha256,
    owner_review_signature_valid:true,
    exact_evidence_digest_match:true,
    original_pc_current_key_possession_verified:false,
    independent_physical_windows_status_verified:false,
    external_git_qa_effects_cleared:false,
    replay_prevention_enforced:false,
    owner_reconciliation_complete:false,agent_restart_allowed:false,
    marker_removal_allowed:false,installer_execution_allowed:false,
    production_release_authorized:false,
    read_only:true
  });
}
function boundedJson(file,max=MAX_FILE){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('FILE_PATH_INVALID');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>max)
    fail('FILE_UNSAFE');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function evidenceInputFromEnv(env=process.env){
  return {
    local:boundedJson(env.SUTRADHAR_CRASH_LOCAL_JSON),
    first:boundedJson(env.SUTRADHAR_CRASH_CENTRAL_FIRST_JSON),
    second:boundedJson(env.SUTRADHAR_CRASH_CENTRAL_SECOND_JSON),
    nodeId:env.SUTRADHAR_CRASH_NODE_ID,
    pinnedPublicKeySha256:env.SUTRADHAR_CRASH_ENROLLMENT_FINGERPRINT,
    observedAtClientMs:Number(env.SUTRADHAR_CRASH_OBSERVED_AT_CLIENT_MS)
  };
}
module.exports={createReviewManifest,verifySignedReview,
  evidenceInputFromEnv,boundedJson,canonical,SIGN_DOMAIN};
