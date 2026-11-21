/**
 * Print the exact signed-offer fingerprint expected by Central maintenance.
 * JSON parsed/re-serialized the same way the Desktop inspection journal does.
 * This is a digest helper, NOT a signature/installer verification or approval.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function digestOffer(envelope){
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
     !envelope.signed||typeof envelope.signed!=='object'||
     envelope.signed.schema!==2||envelope.signed.application!=='desktop'||
     !['update','rollback'].includes(envelope.signed.type)||
     typeof envelope.signature_base64!=='string'||
     envelope.signature_base64.length<40||
     !Array.isArray(envelope.signed.rollout?.node_ids))
    throw Error('OFFER_DIGEST_SIGNED_ENVELOPE_REQUIRED');
  return crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
}
function main(file=process.argv[2]){
  if(typeof file!=='string'||!path.isAbsolute(file))
    throw Error('OFFER_DIGEST_ABSOLUTE_FILE_REQUIRED');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>32768)
    throw Error('OFFER_DIGEST_FILE_INVALID');
  const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
  const digest=digestOffer(envelope);
  console.log(JSON.stringify({maintenance_offer_sha256:digest,
    kind:envelope.signed.type,wave_id:envelope.signed.rollout?.wave_id,
    signature_verified:false,installer_verified:false,approved:false},null,2));
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={digestOffer};
