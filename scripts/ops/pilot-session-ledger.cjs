/**
 * One-time LOCAL Owner pilot-evidence session registry. This is not a
 * production release gate and cannot prove that any physical PC was tested.
 *
 * The signed evidence is independently verified BEFORE a session is consumed.
 * Each session uses O_EXCL creation: reuse, crash-left partial files and
 * parallel reviewers all fail closed instead of overwriting prior evidence.
 * The directory is supplied/secured separately by the Owner.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate,readFile,hash}=require('./pilot-evidence-verifier.cjs');
const SESSION=/^[a-f0-9]{32}$/;
function deny(code){return {accepted:false,error_code:code,
  session_recorded:false,physical_test_verified:false,
  production_release_authorized:false,read_only:false};}
function registerBundle({ledgerDir,envelope,ownerPublicKeyPem,expectedSha,
  expectedSessionId,beforeBytes,afterBytes,witnessBytes,now=Date.now()}={}){
  const verification=evaluate({envelope,ownerPublicKeyPem,expectedSha,
    expectedSessionId,beforeBytes,afterBytes,witnessBytes,now});
  if(verification.accepted!==true ||
     verification.production_release_authorized!==false)
    return deny('PILOT_SESSION_SIGNED_EVIDENCE_NOT_VERIFIED');
  if(!SESSION.test(expectedSessionId||'')||
     typeof ledgerDir!=='string'||ledgerDir.length>1024||
     !path.isAbsolute(ledgerDir))
    return deny('PILOT_SESSION_LEDGER_PATH_UNSAFE');
  let dirStat;
  try{dirStat=fs.lstatSync(ledgerDir);}
  catch{return deny('PILOT_SESSION_LEDGER_DIRECTORY_UNAVAILABLE');}
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||
     (process.platform!=='win32'&&(dirStat.mode&0o077)!==0))
    return deny('PILOT_SESSION_LEDGER_DIRECTORY_NOT_PRIVATE');
  const target=path.join(ledgerDir,expectedSessionId+'.json');
  const record={
    schema:1,session_id:expectedSessionId,source_sha:expectedSha,
    owner_public_key_sha256:hash(crypto.createPublicKey(ownerPublicKeyPem)
      .export({type:'spki',format:'der'})),
    signed_envelope_sha256:hash(Buffer.from(JSON.stringify(envelope))),
    before_sha256:hash(beforeBytes),after_sha256:hash(afterBytes),
    witness_sha256:hash(witnessBytes),
    registered_at_ms:now,status:'OWNER_OFFLINE_PILOT_SESSION_RECORDED_ONLY',
    physical_test_verified:false,production_release_authorized:false
  };
  const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');
  let fd;
  try{
    // Never change an existing record, even if it is partial or corrupt.
    fd=fs.openSync(target,
      fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
      (fs.constants.O_NOFOLLOW||0),0o600);
  }catch(e){
    return deny(e?.code==='EEXIST'?
      'PILOT_SESSION_ALREADY_RECORDED':'PILOT_SESSION_LEDGER_CREATE_FAILED');
  }
  let written=false;
  try{
    let offset=0;
    while(offset<bytes.length){
      const n=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
      if(n<=0)throw Error('PILOT_SESSION_SHORT_WRITE');
      offset+=n;
    }
    fs.fsyncSync(fd);
    written=true;
  }catch{
    // A partial journal MUST remain and block any subsequent replay.
  }finally{fs.closeSync(fd);}
  if(!written)return deny('PILOT_SESSION_LEDGER_WRITE_UNCERTAIN');
  // POSIX directory sync makes the newly created name durable at the
  // filesystem level where supported. Windows ACL/flush proof is external.
  if(process.platform!=='win32'){
    let dfd;
    try{
      dfd=fs.openSync(ledgerDir,fs.constants.O_RDONLY|
        (fs.constants.O_DIRECTORY||0)|(fs.constants.O_NOFOLLOW||0));
      const again=fs.fstatSync(dfd);
      if(again.dev!==dirStat.dev||again.ino!==dirStat.ino)
        throw Error('PILOT_LEDGER_DIRECTORY_CHANGED');
      fs.fsyncSync(dfd);
    }catch{return deny('PILOT_SESSION_LEDGER_DIRECTORY_SYNC_UNCERTAIN');}
    finally{if(dfd!==undefined)fs.closeSync(dfd);}
  }
  return {accepted:true,status:'OWNER_LOCAL_PILOT_SESSION_REGISTERED_ONLY',
    session_id:expectedSessionId,source_sha:expectedSha,
    owner_signature_verified:true,session_recorded:true,
    signed_evidence_index_verified:true,physical_test_verified:false,
    node_key_possession_verified:false,installer_success_verified:false,
    production_release_authorized:false,read_only:false,
    warning:'A private local register detects replay only while preserved and independently protected; it does not attest real PCs, Hostinger, Windows installation, or authorize release.'};
}
function main(){
  try{
    const e=process.env;
    const result=registerBundle({
      ledgerDir:e.SUTRADHAR_PILOT_SESSION_LEDGER_DIR,
      envelope:JSON.parse(readFile(e.SUTRADHAR_PILOT_OWNER_ENVELOPE_FILE,128*1024)),
      ownerPublicKeyPem:readFile(e.SUTRADHAR_PILOT_OWNER_PUBLIC_KEY_FILE,10000).toString('utf8'),
      expectedSha:e.SUTRADHAR_PILOT_SOURCE_SHA,
      expectedSessionId:e.SUTRADHAR_PILOT_SESSION_ID,
      beforeBytes:readFile(e.SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH,128*1024),
      afterBytes:readFile(e.SUTRADHAR_PILOT_AFTER_RECEIPT_PATH,128*1024),
      witnessBytes:readFile(e.SUTRADHAR_PILOT_PHYSICAL_WITNESS_FILE,16*1024*1024)
    });
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{
    console.error('PILOT_OWNER_SESSION_REGISTRATION_BLOCKED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={registerBundle};
