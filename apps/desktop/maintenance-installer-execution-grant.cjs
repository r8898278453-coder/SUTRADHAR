/**
 * Independent, short-lived Owner Ed25519 grant to launch one staged installer.
 * This is distinct from signed update offers and recovery/restart grants.
 */
'use strict';
const crypto=require('node:crypto');
const HEX=/^[0-9a-f]{64}$/;
const NODE=/^node_[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
const VERSION=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function fail(code){throw Error(code);}
function verifyExecutionGrant({envelope,pinnedPublicKeyPem,prepared,now=Date.now()}={}){
  if(!prepared||prepared.status!=='OFFLINE_STAGED_NOT_INSTALLED'||
     !NODE.test(prepared.node_id||'')||!ID.test(prepared.plan_id||'')||
     !WAVE.test(prepared.wave_id||'')||
     !HEX.test(prepared.offer_sha256||'')||
     !HEX.test(prepared.installer_sha256||'')||
     !VERSION.test(prepared.target_version||'')||
     !['update','rollback'].includes(prepared.kind)||
     !Number.isSafeInteger(prepared.expected_epoch)||prepared.expected_epoch<1)
    fail('UPDATE_EXECUTION_PREPARED_RECEIPT_REQUIRED');
  if(typeof pinnedPublicKeyPem!=='string'||!pinnedPublicKeyPem.trim())
    fail('UPDATE_EXECUTION_OWNER_TRUST_UNCONFIGURED');
  if(!Number.isSafeInteger(now)||now<0)
    fail('UPDATE_EXECUTION_CLOCK_INVALID');
  const signed=envelope?.signed,sig=envelope?.signature_base64;
  if(!signed||typeof signed!=='object'||Array.isArray(signed)||
     Object.keys(signed).sort().join('|')!==
     'action|epoch|expires_ms|grant_id|installer_sha256|issued_ms|kind|node_id|offer_sha256|plan_id|schema|target_version|wave_id'||
     signed.schema!==1||signed.action!=='launch_staged_windows_installer'||
     !HEX.test(signed.grant_id||'')||!NODE.test(signed.node_id||'')||
     !ID.test(signed.plan_id||'')||!WAVE.test(signed.wave_id||'')||
     !HEX.test(signed.offer_sha256||'')||
     !HEX.test(signed.installer_sha256||'')||
     !VERSION.test(signed.target_version||'')||
     !['update','rollback'].includes(signed.kind)||
     !Number.isSafeInteger(signed.epoch)||signed.epoch<1||
     !Number.isSafeInteger(signed.issued_ms)||
     !Number.isSafeInteger(signed.expires_ms)||
     signed.issued_ms>now+60000||signed.expires_ms<=now||
     signed.expires_ms<=signed.issued_ms||
     signed.expires_ms-signed.issued_ms>5*60000)
    fail('UPDATE_EXECUTION_SIGNED_FIELDS_INVALID');
  for(const [from,to] of [
    ['node_id','node_id'],['plan_id','plan_id'],['wave_id','wave_id'],
    ['offer_sha256','offer_sha256'],['installer_sha256','installer_sha256'],
    ['target_version','target_version'],['kind','kind'],
    ['epoch','expected_epoch']
  ]){
    if(signed[from]!==prepared[to])
      fail('UPDATE_EXECUTION_GRANT_SCOPE_MISMATCH');
  }
  if(typeof sig!=='string'||sig.length<80||sig.length>256||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(sig))
    fail('UPDATE_EXECUTION_GRANT_SIGNATURE_INVALID');
  let accepted=false;
  try{
    const key=crypto.createPublicKey(pinnedPublicKeyPem);
    if(key.asymmetricKeyType==='ed25519')
      accepted=crypto.verify(null,Buffer.from(JSON.stringify(signed)),key,
        Buffer.from(sig,'base64'));
  }catch{}
  if(!accepted)fail('UPDATE_EXECUTION_GRANT_SIGNATURE_INVALID');
  return Object.freeze({accepted:true,grant_id:signed.grant_id,
    expires_ms:signed.expires_ms,node_id:signed.node_id,
    epoch:signed.epoch,installer_sha256:signed.installer_sha256,
    installer_execution_approved_once:true,automatic_install:false,
    unattended_install:false,rollback_automatic:false});
}
module.exports={verifyExecutionGrant};
