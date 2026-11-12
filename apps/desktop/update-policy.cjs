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
function cmp(a,b){
  if(!V.test(a)||!V.test(b))throw Error('UPDATE_STABLE_VERSION_REQUIRED');
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<3;i++){if(x[i]!==y[i])return Math.sign(x[i]-y[i]);}
  return 0;
}
function verifyOffer({envelope,pinnedPublicKeyPem,installerPath,currentVersion,
  protocol=7,publisherSubject,now=Date.now(),rolloutApproved=false,kind='update'}){
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
    if(body.schema!==1||body.application!=='desktop'||body.channel!=='stable'||
      body.type!==kind||!V.test(body.version)||!S.test(body.source_sha)||
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
    if(kind==='update'&&cmp(body.version,currentVersion)<=0)return deny('UPDATE_NOT_NEWER');
    if(kind==='rollback'&&(cmp(body.version,currentVersion)>=0||
      body.owner_emergency_rollback_approved!==true))
      return deny('OWNER_ROLLBACK_EVIDENCE_REQUIRED');
    if(typeof installerPath!=='string'||path.basename(installerPath)!==body.filename)
      return deny('UPDATE_FILENAME_MISMATCH');
    const stat=fs.statSync(installerPath);
    if(!stat.isFile()||stat.size!==body.installer_bytes)
      return deny('UPDATE_INSTALLER_SIZE_MISMATCH');
    const h=crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
    if(h!==body.installer_sha256)return deny('UPDATE_INSTALLER_SHA_MISMATCH');
    // This validates Owner metadata and bytes. Windows Authenticode validation
    // of the downloaded EXE is a separate mandatory gate before installation.
    return {accepted:true,version:body.version,source_sha:body.source_sha,
      file_sha256:h,requires_windows_authenticode:true,automatic_install:false};
  }catch{return deny('UPDATE_VERIFICATION_FAILED');}
}
module.exports={verifyOffer,cmp};
