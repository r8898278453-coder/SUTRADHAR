/**
 * A distinct, short-lived Owner grant to REVIEW a failed installer incident.
 * This does not release local hold, run rollback, allow retry or start agents.
 */
'use strict';
const crypto=require('node:crypto');
const HEX=/^[0-9a-f]{64}$/;
const NODE=/^node_[0-9a-f]{32}$/;
const PLAN=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
const VERSION=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function fail(code){throw Error(code);}
function verifyOwnerFailureReviewGrant({envelope,pinnedPublicKeyPem,
  evidence,now=Date.now()}={}){
  if(!evidence||!NODE.test(evidence.node_id||'')||
     !PLAN.test(evidence.plan_id||'')||!WAVE.test(evidence.wave_id||'')||
     !HEX.test(evidence.offer_sha256||'')||
     !HEX.test(evidence.installer_sha256||'')||
     !HEX.test(evidence.review_sha256||'')||
     !HEX.test(evidence.execution_grant_id||'')||
     !VERSION.test(evidence.previous_version||'')||
     !VERSION.test(evidence.target_version||'')||
     !['update','rollback'].includes(evidence.kind)||
     !Number.isSafeInteger(evidence.expected_epoch)||evidence.expected_epoch<1||
     evidence.old_version_preserved!==true||
     evidence.hold_release_allowed!==false||
     evidence.rollback_authorized!==false)
    fail('FAILURE_OWNER_GRANT_LOCAL_EVIDENCE_INVALID');
  if(typeof pinnedPublicKeyPem!=='string'||!pinnedPublicKeyPem.trim())
    fail('FAILURE_OWNER_GRANT_TRUST_UNCONFIGURED');
  if(!Number.isSafeInteger(now)||now<0)fail('FAILURE_OWNER_GRANT_CLOCK_INVALID');
  const body=envelope?.signed,sig=envelope?.signature_base64;
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join('|')!==
     'action|execution_grant_id|expected_epoch|expires_ms|grant_id|installer_sha256|issued_ms|kind|node_id|offer_sha256|plan_id|previous_version|review_sha256|schema|target_version|wave_id'||
     body.schema!==1||body.action!=='review_failed_install_recovery'||
     !NODE.test(body.node_id||'')||!PLAN.test(body.plan_id||'')||
     !WAVE.test(body.wave_id||'')||!HEX.test(body.grant_id||'')||
     !HEX.test(body.offer_sha256||'')||!HEX.test(body.installer_sha256||'')||
     !HEX.test(body.review_sha256||'')||!HEX.test(body.execution_grant_id||'')||
     !VERSION.test(body.previous_version||'')||
     !VERSION.test(body.target_version||'')||
     !['update','rollback'].includes(body.kind)||
     !Number.isSafeInteger(body.expected_epoch)||body.expected_epoch<1||
     !Number.isSafeInteger(body.issued_ms)||
     !Number.isSafeInteger(body.expires_ms)||
     body.issued_ms>now+60000||body.expires_ms<=now||
     body.expires_ms<=body.issued_ms||
     body.expires_ms-body.issued_ms>5*60000)
    fail('FAILURE_OWNER_GRANT_SIGNED_FIELDS_INVALID');
  for(const name of ['node_id','plan_id','wave_id','offer_sha256',
    'installer_sha256','review_sha256','execution_grant_id',
    'previous_version','target_version','kind','expected_epoch']){
    if(body[name]!==evidence[name])
      fail('FAILURE_OWNER_GRANT_SCOPE_MISMATCH');
  }
  if(typeof sig!=='string'||sig.length<80||sig.length>256||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(sig))
    fail('FAILURE_OWNER_GRANT_SIGNATURE_INVALID');
  let ok=false;
  try{
    const key=crypto.createPublicKey(pinnedPublicKeyPem);
    if(key.asymmetricKeyType==='ed25519')
      ok=crypto.verify(null,Buffer.from(JSON.stringify(body)),key,
        Buffer.from(sig,'base64'));
  }catch{}
  if(!ok)fail('FAILURE_OWNER_GRANT_SIGNATURE_INVALID');
  return Object.freeze({accepted:true,grant_id:body.grant_id,
    expires_ms:body.expires_ms,node_id:body.node_id,
    review_sha256:body.review_sha256,
    recovery_review_only:true,hold_release_allowed:false,
    installer_execution_allowed:false,automatic_retry_allowed:false,
    rollback_authorized:false,agent_start_allowed:false});
}
module.exports={verifyOwnerFailureReviewGrant};
