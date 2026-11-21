/** Offline verification of before/after OS-vault node-signed maintenance receipts.
 * This DOES NOT perform an install, reboot, update, rollback or remote query.
 * Node signatures prove key possession, not that the machine or system clock is honest.
 */
'use strict';
const crypto=require('node:crypto');
const SHA=/^[a-f0-9]{64}$/;
const NODE=/^node_[a-f0-9]{32}$/;
const V=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function bad(error_code){return {accepted:false,error_code,installation_verified:false};}
function verify({before,after,expectedNodeId,expectedWaveId,expectedOfferSha256,
  expectedVersion,expectedPublicKeyPem,now=Date.now()}={}){
  try{
    if(!NODE.test(expectedNodeId||'')||!/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(expectedWaveId||'')||
       !SHA.test(expectedOfferSha256||'')||!V.test(expectedVersion||'')||
       typeof expectedPublicKeyPem!=='string'||!Number.isSafeInteger(now))
      return bad('POST_UPDATE_EXPECTED_CONTEXT_INVALID');
    const key=crypto.createPublicKey(expectedPublicKeyPem);
    if(key.asymmetricKeyType!=='ed25519')return bad('POST_UPDATE_KEY_INVALID');
    const fp=crypto.createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
    for(const [env,phase] of [[before,'BEFORE'],[after,'AFTER']]){
      if(!env||typeof env!=='object'||Array.isArray(env)||
         Object.keys(env).sort().join('|')!=='payload|signature_base64'||
         typeof env.signature_base64!=='string'||!/^([A-Za-z0-9+/]{86}==)$/.test(env.signature_base64))
        return bad('POST_UPDATE_RECEIPT_MALFORMED');
      const p=env.payload;
      if(!p||typeof p!=='object'||Array.isArray(p)||
         Object.keys(p).sort().join('|')!==
           'agent_count|central_approved|checked_at_ms|heartbeat_age_seconds|node_id|node_key_sha256|offer_sha256|phase|schema|target_version|wave_id'||
         p.schema!==1||p.phase!==phase||p.node_id!==expectedNodeId||
         p.node_key_sha256!==fp||p.wave_id!==expectedWaveId||
         p.offer_sha256!==expectedOfferSha256||!V.test(p.target_version||'')||
         !Number.isSafeInteger(p.checked_at_ms)||p.checked_at_ms<0||
         !Number.isSafeInteger(p.heartbeat_age_seconds)||p.heartbeat_age_seconds<0||
         p.heartbeat_age_seconds>180||!Number.isSafeInteger(p.agent_count)||
         p.agent_count<1||p.agent_count>4||p.central_approved!==true)
        return bad('POST_UPDATE_RECEIPT_FIELDS_INVALID');
      const bytes=Buffer.from('SUTRADHAR_UPDATE_HEALTH_V1\n'+JSON.stringify(p));
      if(!crypto.verify(null,bytes,key,Buffer.from(env.signature_base64,'base64')))
        return bad('POST_UPDATE_RECEIPT_SIGNATURE_INVALID');
    }
    const a=before.payload,z=after.payload;
    if(a.target_version!==expectedVersion||z.target_version!==expectedVersion||
       z.agent_count!==a.agent_count)return bad('POST_UPDATE_VERSION_OR_AGENT_MISMATCH');
    if(z.checked_at_ms<=a.checked_at_ms||z.checked_at_ms-a.checked_at_ms>86400000||
       z.checked_at_ms>now+120000||now-z.checked_at_ms>300000)
      return bad('POST_UPDATE_OBSERVATION_STALE_OR_OUT_OF_ORDER');
    return {accepted:true,installation_verified:false,
      status:'SIGNED_NODE_HEALTH_RECEIPTS_MATCH',node_id:expectedNodeId,
      warning:'Still requires independent Central/database attestation, real installer evidence and Owner approval.'};
  }catch{return bad('POST_UPDATE_VERIFICATION_FAILED');}
}
module.exports={verify};
