/**
 * Separate Owner-signed one-time manual agent restart GRANT.
 * Reusing a release-hold grant is forbidden. No installer authority.
 */
'use strict';
const crypto=require('node:crypto');
const HEX=/^[0-9a-f]{64}$/,NODE=/^node_[0-9a-f]{32}$/;
const PLAN=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
function fail(code){throw Error(code);}
function verifyRestartGrant({envelope,pinnedPublicKeyPem,release,now=Date.now()}={}){
  if(!release||!NODE.test(release.node_id||'')||!PLAN.test(release.plan_id||'')||
     !WAVE.test(release.wave_id||'')||!HEX.test(release.offer_sha256||'')||
     !HEX.test(release.grant_id||''))
    fail('MAINTENANCE_RESTART_RELEASE_EVIDENCE_INVALID');
  if(typeof pinnedPublicKeyPem!=='string'||!pinnedPublicKeyPem.trim())
    fail('MAINTENANCE_RESTART_OWNER_TRUST_UNCONFIGURED');
  if(!Number.isSafeInteger(now)||now<0)
    fail('MAINTENANCE_RESTART_CLOCK_INVALID');
  const body=envelope?.signed,signature=envelope?.signature_base64;
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join('|')!==
      'action|expires_ms|grant_id|issued_ms|node_id|offer_sha256|plan_id|release_grant_id|schema|wave_id'||
     body.schema!==1||body.action!=='restart_after_maintenance'||
     !HEX.test(body.grant_id||'')||!HEX.test(body.release_grant_id||'')||
     body.grant_id===body.release_grant_id||
     !NODE.test(body.node_id||'')||!PLAN.test(body.plan_id||'')||
     !WAVE.test(body.wave_id||'')||!HEX.test(body.offer_sha256||'')||
     !Number.isSafeInteger(body.issued_ms)||!Number.isSafeInteger(body.expires_ms)||
     body.issued_ms>now+60000||body.expires_ms<=now||
     body.expires_ms<=body.issued_ms||
     body.expires_ms-body.issued_ms>5*60000)
    fail('MAINTENANCE_RESTART_SIGNED_FIELDS_INVALID');
  if(body.node_id!==release.node_id||body.plan_id!==release.plan_id||
     body.wave_id!==release.wave_id||body.offer_sha256!==release.offer_sha256||
     body.release_grant_id!==release.grant_id)
    fail('MAINTENANCE_RESTART_RELEASE_IDENTITY_MISMATCH');
  if(typeof signature!=='string'||signature.length>256||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(signature))
    fail('MAINTENANCE_RESTART_SIGNATURE_INVALID');
  let valid=false;
  try{
    const key=crypto.createPublicKey(pinnedPublicKeyPem);
    if(key.asymmetricKeyType==='ed25519')
      valid=crypto.verify(null,Buffer.from(JSON.stringify(body)),key,
        Buffer.from(signature,'base64'));
  }catch{}
  if(!valid)fail('MAINTENANCE_RESTART_SIGNATURE_INVALID');
  return Object.freeze({accepted:true,grant_id:body.grant_id,
    release_grant_id:body.release_grant_id,node_id:body.node_id,
    plan_id:body.plan_id,wave_id:body.wave_id,offer_sha256:body.offer_sha256,
    expires_ms:body.expires_ms,installer_execution_allowed:false,
    automatic_restart_allowed:false});
}
module.exports={verifyRestartGrant};
