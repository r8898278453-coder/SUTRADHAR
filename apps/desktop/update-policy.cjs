/**
 * Offline update offer verifier. Does NOT download, install or execute anything.
 * A release must have: pinned Ed25519 Owner signing key, exact installer SHA256,
 * matching Authenticode publisher, a supported protocol and an approved rollout.
 * Never let a GitHub tag or an HTTPS page substitute for signed metadata.
 */
'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const V=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const H=/^[0-9a-f]{64}$/;
const S=/^[0-9a-f]{40}$/;
const NODE=/^node_[0-9a-f]{32}$/;
const WAVE=/^wave_[a-z0-9][a-z0-9_-]{2,59}$/;
function parseVersion(value){
  if(typeof value!=='string'||!V.test(value)||value.length>24)
    throw Error('UPDATE_STABLE_VERSION_REQUIRED');
  const segments=value.split('.').map(Number);
  if(segments.some(x=>!Number.isSafeInteger(x)||x>999999))
    throw Error('UPDATE_STABLE_VERSION_REQUIRED');
  return segments;
}
function cmp(a,b){
  const x=parseVersion(a),y=parseVersion(b);
  for(let i=0;i<3;i++){if(x[i]!==y[i])return Math.sign(x[i]-y[i]);}
  return 0;
}
function sha256File(file){
  if(typeof file!=='string'||!path.isAbsolute(file))
    throw Error('UPDATE_INSTALLER_PATH_INVALID');
  const initial=fs.lstatSync(file,{bigint:true});
  if(!initial.isFile()||initial.isSymbolicLink())
    throw Error('UPDATE_INSTALLER_FILE_TYPE_INVALID');
  // Open the exact descriptor we hash. O_NOFOLLOW refuses link swapping on
  // supported platforms; lstat/fstat comparison also protects Windows.
  const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
  const fd=fs.openSync(file,flags);
  const buf=Buffer.allocUnsafe(1024*1024);
  const h=crypto.createHash('sha256');
  try{
    const opened=fs.fstatSync(fd,{bigint:true});
    if(!opened.isFile()||opened.dev!==initial.dev||opened.ino!==initial.ino||
       opened.size!==initial.size||opened.size>1073741824n)
      throw Error('UPDATE_INSTALLER_FILE_CHANGED');
    let total=0n;
    for(;;){
      const bytes=fs.readSync(fd,buf,0,buf.length,null);
      if(bytes===0)break;
      total+=BigInt(bytes);
      if(total>1073741824n)throw Error('UPDATE_INSTALLER_TOO_LARGE');
      h.update(buf.subarray(0,bytes));
    }
    const finished=fs.fstatSync(fd,{bigint:true});
    const current=fs.lstatSync(file,{bigint:true});
    if(total!==opened.size||finished.size!==opened.size||
       finished.mtimeNs!==opened.mtimeNs||finished.ctimeNs!==opened.ctimeNs||
       current.dev!==opened.dev||current.ino!==opened.ino||
       current.size!==opened.size||current.mtimeNs!==opened.mtimeNs||
       current.ctimeNs!==opened.ctimeNs||current.isSymbolicLink())
      throw Error('UPDATE_INSTALLER_FILE_CHANGED');
    return h.digest('hex');
  }finally{fs.closeSync(fd);}
}
function verifyOffer({envelope,pinnedPublicKeyPem,installerPath,currentVersion,
  nodeId,protocol=7,publisherSubject,now=Date.now(),rolloutApproved=false,kind='update'}){
  function deny(reason){return {accepted:false,error_code:reason};}
  try{
    if(!rolloutApproved)return deny('OWNER_ROLLOUT_APPROVAL_REQUIRED');
    if(!pinnedPublicKeyPem||typeof pinnedPublicKeyPem!=='string')
      return deny('PINNED_PUBLIC_KEY_REQUIRED');
    const key=crypto.createPublicKey(pinnedPublicKeyPem);
    if(key.asymmetricKeyType!=='ed25519')return deny('UPDATE_SIGNING_KEY_INVALID');
    const body=envelope?.signed;
    const sig=envelope?.signature_base64;
    if(!body||typeof body!=='object'||Array.isArray(body)||typeof sig!=='string'||
      sig.length>256||!crypto.verify(null,Buffer.from(JSON.stringify(body)),
        key,Buffer.from(sig,'base64')))return deny('UPDATE_SIGNATURE_INVALID');
    // v1 offers lacked recipient scoping and must never authorize a production PC.
    if(body.schema!==2||body.application!=='desktop'||body.channel!=='stable'||
      body.type!==kind||typeof body.version!=='string'||
      !V.test(body.version)||body.version.length>24||!S.test(body.source_sha)||
      !H.test(body.installer_sha256)||!Number.isSafeInteger(body.installer_bytes)||
      body.installer_bytes<1000||body.installer_bytes>1024*1024*1024||
      typeof body.filename!=='string'||body.filename.length>180||
      !/^SUTRADHAR[-_ A-Za-z0-9.()]+\.exe$/.test(body.filename)||
      body.filename.includes('..')||
      body.protocol!==protocol||body.publisher_subject!==publisherSubject||
      !/^CN=.{1,220}$/.test(body.publisher_subject)||!Number.isSafeInteger(body.issued_ms)||
      !Number.isSafeInteger(body.expires_ms)||body.issued_ms>now+120000||
      body.expires_ms<=now||body.expires_ms-body.issued_ms>31*86400000)
      return deny('UPDATE_SIGNED_FIELDS_INVALID');
    const rollout=body.rollout;
    if(!rollout||typeof rollout!=='object'||Array.isArray(rollout)||
      Object.keys(rollout).sort().join('|')!=='node_ids|owner_approved_at_ms|wave_id'||
      typeof rollout.wave_id!=='string'||!WAVE.test(rollout.wave_id)||
      !Number.isSafeInteger(rollout.owner_approved_at_ms)||
      rollout.owner_approved_at_ms>body.issued_ms||
      rollout.owner_approved_at_ms<body.issued_ms-7*86400000||
      !Array.isArray(rollout.node_ids)||
      rollout.node_ids.length<1||rollout.node_ids.length>10||
      rollout.node_ids.some(id=>typeof id!=='string'||!NODE.test(id))||
      new Set(rollout.node_ids).size!==rollout.node_ids.length)
      return deny('UPDATE_SIGNED_ROLLOUT_INVALID');
    if(typeof nodeId!=='string'||!NODE.test(nodeId))
      return deny('UPDATE_LOCAL_IDENTITY_REQUIRED');
    if(!rollout.node_ids.includes(nodeId))
      return deny('UPDATE_DEVICE_NOT_IN_OWNER_WAVE');
    if(kind==='update'&&cmp(body.version,currentVersion)<=0)return deny('UPDATE_NOT_NEWER');
    if(kind==='rollback'&&(cmp(body.version,currentVersion)>=0||
      body.owner_emergency_rollback_approved!==true))
      return deny('OWNER_ROLLBACK_EVIDENCE_REQUIRED');
    if(typeof installerPath!=='string'||path.basename(installerPath)!==body.filename)
      return deny('UPDATE_FILENAME_MISMATCH');
    const stat=fs.lstatSync(installerPath);
    if(!stat.isFile()||stat.isSymbolicLink()||
      stat.size!==body.installer_bytes)
      return deny('UPDATE_INSTALLER_SIZE_OR_TYPE_MISMATCH');
    const h=sha256File(installerPath);
    if(h!==body.installer_sha256)return deny('UPDATE_INSTALLER_SHA_MISMATCH');
    // This validates Owner metadata and bytes. Windows Authenticode validation
    // of the downloaded EXE is a separate mandatory gate before installation.
    return {accepted:true,version:body.version,source_sha:body.source_sha,
      file_sha256:h,wave_id:rollout.wave_id,device_node_id:nodeId,
      requires_windows_authenticode:true,automatic_install:false};
  }catch{return deny('UPDATE_VERIFICATION_FAILED');}
}
module.exports={verifyOffer,cmp,sha256File};
