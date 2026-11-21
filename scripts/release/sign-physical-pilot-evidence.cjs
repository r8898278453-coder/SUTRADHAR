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
/**
 * Create a single Owner-signed envelope in a PRIVATE directory. A write or
 * directory-sync failure leaves the path in place as uncertain evidence:
 * never unlink, overwrite, or retry under the same path automatically.
 *
 * POSIX: fsync file AND verified parent inode/name. Windows: do not claim
 * POSIX directory-sync durability or Windows power-loss acceptance.
 */
function writeOwnerEnvelope({output,envelope}={}){
  if(typeof output!=='string'||!path.isAbsolute(output)||
     output.length>1024)
    fail('PILOT_OWNER_SIGNED_OUTPUT_UNSAFE');
  const parent=path.dirname(output);
  let stat;
  try{stat=fs.lstatSync(parent);}
  catch{fail('PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_UNAVAILABLE');}
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (process.platform!=='win32'&&((stat.mode&0o077)!==0||
       (typeof process.getuid==='function'&&stat.uid!==process.getuid()))))
    fail('PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_UNSAFE');
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
     !Object.hasOwn(envelope,'payload')||
     typeof envelope.signature_base64!=='string')
    fail('PILOT_OWNER_SIGNED_ENVELOPE_INVALID');
  const bytes=Buffer.from(JSON.stringify(envelope,null,2)+'\n','utf8');
  if(bytes.length>128*1024)fail('PILOT_OWNER_SIGNED_ENVELOPE_TOO_LARGE');
  let fd;
  try{
    // O_EXCL is the authority; existsSync would be subject to a race.
    fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
  }catch(e){
    fail(e&&e.code==='EEXIST'?'PILOT_OWNER_SIGNED_OUTPUT_ALREADY_EXISTS':
      'PILOT_OWNER_SIGNED_OUTPUT_CREATE_FAILED');
  }
  try{
    let offset=0;
    while(offset<bytes.length){
      const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
      if(written<=0)throw Error('PILOT_OWNER_SIGNED_OUTPUT_SHORT_WRITE');
      offset+=written;
    }
    fs.fsyncSync(fd);
  }catch{
    // Intentionally leave any partly created file: prevents replay or
    // overwrite after an ambiguous crash/storage failure.
    fail('PILOT_OWNER_SIGNED_OUTPUT_WRITE_UNCERTAIN');
  }finally{fs.closeSync(fd);}
  if(process.platform!=='win32'){
    let dirfd;
    try{
      dirfd=fs.openSync(parent,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      const live=fs.fstatSync(dirfd);
      if(!live.isDirectory()||live.dev!==stat.dev||live.ino!==stat.ino||
         (live.mode&0o077)!==0||
         (typeof process.getuid==='function'&&live.uid!==process.getuid()))
        throw Error('PILOT_OWNER_SIGNED_DIRECTORY_CHANGED');
      fs.fsyncSync(dirfd);
    }catch{
      fail('PILOT_OWNER_SIGNED_OUTPUT_DIRECTORY_SYNC_UNCERTAIN');
    }finally{if(dirfd!==undefined)fs.closeSync(dirfd);}
  }
  return {evidence_file_written:true,evidence_index_sha256:crypto.createHash('sha256')
    .update(bytes).digest('hex'),
    directory_durability:process.platform==='win32'?
      'WINDOWS_POWER_LOSS_DURABILITY_UNVERIFIED':'POSIX_FILE_AND_DIRECTORY_FSYNC',
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
    const saved=writeOwnerEnvelope({output,envelope:signed.envelope});
    console.log(JSON.stringify({...saved,signed:true}));
  }catch{
    console.error('PILOT_OWNER_OFFLINE_SIGNING_BLOCKED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={signBundle,writeOwnerEnvelope};
