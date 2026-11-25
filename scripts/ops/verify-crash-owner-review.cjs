/**
 * Read-only offline verification of a specific Owner-signed crash REVIEW.
 * Signature is evidence acknowledgement only; no restart or release.
 */
'use strict';
const fs=require('node:fs');
const {verifySignedReview,evidenceInputFromEnv,boundedJson}=
  require('./crash-owner-review.cjs');
function main(){
  const envelope=boundedJson(process.env.SUTRADHAR_CRASH_OWNER_REVIEW_FILE,16384);
  const keyPath=process.env.SUTRADHAR_CRASH_OWNER_PUBLIC_KEY_FILE;
  if(typeof keyPath!=='string'||!require('node:path').isAbsolute(keyPath))
    throw Error('CRASH_REVIEW_PUBLIC_KEY_FILE_REQUIRED');
  const st=fs.lstatSync(keyPath);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>4000)
    throw Error('CRASH_REVIEW_PUBLIC_KEY_FILE_UNSAFE');
  const out=verifySignedReview({
    input:evidenceInputFromEnv(),envelope,
    pinnedOwnerReviewPublicKeyPem:fs.readFileSync(keyPath,'utf8')
  });
  console.log(JSON.stringify(out,null,2));
}
if(require.main===module)try{main();}catch(e){
  console.error(String(e.message||e));process.exitCode=1;
}
module.exports={main};
