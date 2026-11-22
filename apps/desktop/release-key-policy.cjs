/**
 * Owner public trust roots for the protected Windows release signing job.
 * Pure validation: no key generation, no private material, no publication.
 * Distinctness is checked on DER/SPKI identity, not PEM whitespace.
 */
'use strict';
const crypto=require('node:crypto');
const NAMES=Object.freeze([
  'SUTRADHAR_RELEASE_UPDATE_PUBLIC_KEY_PEM_B64',
  'SUTRADHAR_INSTALL_EXECUTION_PUBLIC_KEY_PEM_B64',
  'SUTRADHAR_MAINTENANCE_RELEASE_PUBLIC_KEY_PEM_B64',
  'SUTRADHAR_FAILURE_REVIEW_PUBLIC_KEY_PEM_B64'
]);
function fail(reason){throw Error('RELEASE_TRUST_BLOCKED: '+reason);}
function validateOwnerPublicRoots(values){
  if(!values||typeof values!=='object'||Array.isArray(values)||
     Object.keys(values).length!==NAMES.length||
     Object.keys(values).some(k=>!NAMES.includes(k)))
    fail('EXACT_FOUR_PUBLIC_KEYS_REQUIRED');
  const seen=new Set(),result={};
  for(const name of NAMES){
    const raw=values[name];
    if(typeof raw!=='string'||raw.length<80||raw.length>16000||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length%4!==0)
      fail('PUBLIC_KEY_BASE64_INVALID_'+name);
    const bytes=Buffer.from(raw,'base64');
    if(bytes.toString('base64')!==raw)
      fail('PUBLIC_KEY_BASE64_NONCANONICAL_'+name);
    const pem=bytes.toString('utf8');
    // Input must be a PUBLIC key only, never accidentally install a private
    // PKCS#8/SSH or certificate file into a published update package.
    if(!/^-----BEGIN PUBLIC KEY-----\r?\n/.test(pem)||
       !/\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(pem)||
       pem.includes('PRIVATE KEY'))
      fail('PUBLIC_KEY_PEM_INVALID_'+name);
    let key;
    try{key=crypto.createPublicKey(pem);}catch{
      fail('PUBLIC_KEY_UNPARSEABLE_'+name);
    }
    if(key.asymmetricKeyType!=='ed25519')
      fail('PUBLIC_KEY_NOT_ED25519_'+name);
    const der=key.export({format:'der',type:'spki'});
    const fingerprint=crypto.createHash('sha256').update(der).digest('hex');
    if(seen.has(fingerprint))
      fail('DUPLICATE_PUBLIC_TRUST_ROOT_'+name);
    seen.add(fingerprint);
    result[name]=Object.freeze({pem,fingerprint_sha256:fingerprint});
  }
  return Object.freeze(result);
}
module.exports={NAMES,validateOwnerPublicRoots};
