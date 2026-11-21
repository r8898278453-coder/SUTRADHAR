/**
 * Offline Owner-signed, one-PC maintenance release GRANT VERIFIER.
 * No disk mutation; no restart; no installer authority.
 * Owner release trust is intentionally unconfigured in alpha.
 */
'use strict';
const crypto=require('node:crypto');
const HEX=/^[0-9a-f]{64}$/;
const NODE=/^node_[0-9a-f]{32}$/;
const PLAN=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
function fail(code){throw Error(code);}
function verifyRecoveryGrant({envelope,pinnedPublicKeyPem,held,now=Date.now()}={}){
  if(!held?.active||!NODE.test(held.node_id||'')||
     !PLAN.test(held.plan_id||'')||!WAVE.test(held.wave_id||'')||
     !HEX.test(held.offer_sha256||''))
    fail('RECOVERY_GRANT_VALID_LOCAL_HOLD_REQUIRED');
  if(typeof pinnedPublicKeyPem!=='string'||!pinnedPublicKeyPem.trim())
    fail('RECOVERY_GRANT_OWNER_TRUST_UNCONFIGURED');
  if(!Number.isSafeInteger(now)||now<0)fail('RECOVERY_GRANT_CLOCK_INVALID');
  const body=envelope?.signed,sig=envelope?.signature_base64;
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join('|')!==
       'action|expires_ms|grant_id|issued_ms|node_id|offer_sha256|plan_id|schema|wave_id'||
     body.schema!==1||body.action!=='release_maintenance_hold'||
     !HEX.test(body.grant_id||'')||!NODE.test(body.node_id||'')||
     !PLAN.test(body.plan_id||'')||!WAVE.test(body.wave_id||'')||
     !HEX.test(body.offer_sha256||'')||
     !Number.isSafeInteger(body.issued_ms)||!Number.isSafeInteger(body.expires_ms)||
     body.issued_ms>now+60000||body.expires_ms<=now||
     body.expires_ms<=body.issued_ms||
     body.expires_ms-body.issued_ms>10*60000)
    fail('RECOVERY_GRANT_SIGNED_FIELDS_INVALID');
  if(body.node_id!==held.node_id||body.plan_id!==held.plan_id||
     body.wave_id!==held.wave_id||body.offer_sha256!==held.offer_sha256)
    fail('RECOVERY_GRANT_HELD_IDENTITY_MISMATCH');
  if(typeof sig!=='string'||sig.length>256||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(sig))
    fail('RECOVERY_GRANT_SIGNATURE_INVALID');
  let key,verified=false;
  try{
    key=crypto.createPublicKey(pinnedPublicKeyPem);
    if(key.asymmetricKeyType==='ed25519')
      verified=crypto.verify(null,Buffer.from(JSON.stringify(body)),key,
        Buffer.from(sig,'base64'));
  }catch{}
  if(!verified)fail('RECOVERY_GRANT_SIGNATURE_INVALID');
  return Object.freeze({accepted:true,grant_id:body.grant_id,
    node_id:body.node_id,plan_id:body.plan_id,wave_id:body.wave_id,
    offer_sha256:body.offer_sha256,expires_ms:body.expires_ms,
    installer_execution_allowed:false,automatic_restart:false});
}
module.exports={verifyRecoveryGrant};
