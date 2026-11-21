/**
 * Offline second-party verifier for two OS-vault-signed node receipts.
 * An independently pinned public key (from Owner enrollment register) is
 * mandatory. Never imports a private key or accesses Central/Windows.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {verifyContinuity}=require('../../apps/desktop/pilot-node-continuity.cjs');
function readPrivate(file,limit){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     file.length>1024)throw Error('PILOT_NODE_REVIEW_ABSOLUTE_PATH_REQUIRED');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||
     stat.size<10||stat.size>limit)
    throw Error('PILOT_NODE_REVIEW_FILE_UNSAFE');
  return fs.readFileSync(file,'utf8');
}
function main(){
  try{
    const e=process.env;
    const result=verifyContinuity({
      challenge:JSON.parse(readPrivate(e.SUTRADHAR_PILOT_NODE_CHALLENGE_FILE,10000)),
      before:JSON.parse(readPrivate(e.SUTRADHAR_PILOT_NODE_BEFORE_FILE,16000)),
      after:JSON.parse(readPrivate(e.SUTRADHAR_PILOT_NODE_AFTER_FILE,16000)),
      expectedNodeId:e.SUTRADHAR_PILOT_NODE_ID,
      expectedPublicKeyPem:readPrivate(e.SUTRADHAR_PILOT_NODE_PINNED_PUBLIC_KEY_FILE,10000),
      expectedSha:e.SUTRADHAR_PILOT_SOURCE_SHA,
      expectedSessionId:e.SUTRADHAR_PILOT_SESSION_ID
    });
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{
    console.error('PILOT_NODE_CONTINUITY_OFFLINE_VERIFICATION_FAILED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={readPrivate};
