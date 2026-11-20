/**
 * Offline, explicit Owner-signing of an already reviewed physical-pilot
 * evidence index. Never makes a network request or creates physical proof.
 *
 * The signer derives SHA-256 from actual immutable local files, refuses
 * inaccurate/failing policy inputs, then writes one NEW Owner-signed envelope
 * with mode 0600. A separate reviewer MUST pin the Owner public key.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate,hash,readFile,PREFIX}=require('../ops/pilot-evidence-verifier.cjs');
const SHA=/^[0-9a-f]{40}$/,SESSION=/^[0-9a-f]{32}$/;
const fail=code=>{throw Error(code);};
function exact(o,k){
  return o&&typeof o==='object'&&!Array.isArray(o)&&
    Object.keys(o).sort().join('|')===k;
}
function signBundle({draft,beforeBytes,afterBytes,witnessBytes,privateKeyPem,
  ownerAcknowledged,now=Date.now()}={}){
  if(ownerAcknowledged!=='yes'||!Number.isSafeInteger(now)||now<1||
     !exact(draft,'case_type|central_origin|expected_node_ids|owner_review_note|schema|session_id|source_sha')||
     draft.schema!==1||!SHA.test(draft.source_sha||'')||
     !SESSION.test(draft.session_id||'')||
     typeof privateKeyPem!=='string'||privateKeyPem.length>10000)
    fail('PILOT_OWNER_EXPLICIT_SIGNING_REVIEW_REQUIRED');
  const privateKey=crypto.createPrivateKey(privateKeyPem);
  if(privateKey.asymmetricKeyType!=='ed25519')
    fail('PILOT_OWNER_ED25519_KEY_REQUIRED');
  if(!Buffer.isBuffer(beforeBytes)||!Buffer.isBuffer(afterBytes)||
     !Buffer.isBuffer(witnessBytes))
    fail('PILOT_SIGNER_FILES_REQUIRED');
  const payload={...draft,
    before_sha256:hash(beforeBytes),after_sha256:hash(afterBytes),
    physical_witness_sha256:hash(witnessBytes),
    issued_at_ms:now,expires_at_ms:now+60*60*1000};
  const signature_base64=crypto.sign(null,
    Buffer.from(PREFIX+JSON.stringify(payload)),privateKey).toString('base64');
  const envelope={payload,signature_base64};
  const publicKey=crypto.createPublicKey(privateKey).export({
    type:'spki',format:'pem'}).toString('utf8');
  const inspected=evaluate({envelope,ownerPublicKeyPem:publicKey,
    expectedSha:draft.source_sha,expectedSessionId:draft.session_id,
    beforeBytes,afterBytes,witnessBytes,now});
  if(inspected.accepted!==true||
     inspected.production_release_authorized!==false)
    fail('PILOT_OWNER_SIGNED_EVIDENCE_POLICY_BLOCKED');
  return {envelope,evidence_status:inspected.status,
    physical_test_verified:false,production_release_authorized:false};
}
function main(){
  try{
    const env=process.env;
    if(env.SUTRADHAR_PILOT_OWNER_ACKNOWLEDGED_REAL_WORLD_REVIEW!=='yes')
      fail('PILOT_OWNER_EXPLICIT_SIGNING_REVIEW_REQUIRED');
    const draft=JSON.parse(readFile(env.SUTRADHAR_PILOT_DRAFT_FILE,128*1024));
    const privateFile=env.SUTRADHAR_PILOT_OWNER_PRIVATE_KEY_FILE;
    if(typeof privateFile!=='string'||!path.isAbsolute(privateFile))
      fail('PILOT_OWNER_KEY_ABSOLUTE_PATH_REQUIRED');
    const stat=fs.lstatSync(privateFile);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||
       stat.size>10000||
       (process.platform!=='win32'&&(stat.mode&0o077)!==0))
      fail('PILOT_OWNER_SIGNING_KEY_NOT_PRIVATE');
    const pem=fs.readFileSync(privateFile,'utf8');
    const before=readFile(env.SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH,128*1024);
    const after=readFile(env.SUTRADHAR_PILOT_AFTER_RECEIPT_PATH,128*1024);
    const witness=readFile(env.SUTRADHAR_PILOT_PHYSICAL_WITNESS_FILE,
      16*1024*1024);
    const signed=signBundle({draft,beforeBytes:before,afterBytes:after,
      witnessBytes:witness,privateKeyPem:pem,ownerAcknowledged:'yes'});
    const output=env.SUTRADHAR_PILOT_OWNER_SIGNED_OUTPUT_FILE;
    if(typeof output!=='string'||!path.isAbsolute(output)||
       output.length>1024||fs.existsSync(output))
      fail('PILOT_OWNER_SIGNED_OUTPUT_UNSAFE');
    const dir=fs.lstatSync(path.dirname(output));
    if(!dir.isDirectory()||dir.isSymbolicLink())
      fail('PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_UNSAFE');
    const bytes=Buffer.from(JSON.stringify(signed.envelope,null,2)+'\n');
    const fd=fs.openSync(output,'wx',0o600);
    try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    console.log(JSON.stringify({signed:true,
      evidence_index_sha256:hash(bytes),
      physical_test_verified:false,production_release_authorized:false}));
  }catch{
    console.error('PILOT_OWNER_OFFLINE_SIGNING_BLOCKED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={signBundle};
