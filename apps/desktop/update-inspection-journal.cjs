/**
 * Node-signed offline release-inspection journal (NOT install authorization).
 *
 * Only call from Electron main AFTER verifying Owner Ed25519 v2 offer,
 * matching installer SHA256, and Windows Authenticode publisher. The node's
 * Ed25519 private key never crosses into the renderer or child process.
 *
 * Each offer/node pair can be recorded once; repeat inspection validates the
 * existing signed record rather than claiming another execution/approval.
 * Corrupted or interrupted records require Owner review: never overwrite.
 *
 * Files can be deleted by a compromised local user; this is auditable local
 * evidence, NOT a hardware-backed anti-replay counter or release service.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const NODE=/^node_[0-9a-f]{32}$/;
const HEX=/^[0-9a-f]{64}$/;
const PREFIX='SUTRADHAR_UPDATE_INSPECTION_V1\n';
function fail(code){throw Error(code);}
function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
function strictNode(node){
  if(!node||typeof node!=='object'||!NODE.test(node.node_id)||
     typeof node.private_key_pem!=='string'||typeof node.public_key_pem!=='string')
    fail('UPDATE_INSPECTION_OS_VAULT_REQUIRED');
  let priv,pub;
  try{
    priv=crypto.createPrivateKey(node.private_key_pem);
    pub=crypto.createPublicKey(node.public_key_pem);
  }catch{fail('UPDATE_INSPECTION_OS_VAULT_KEY_INVALID');}
  if(priv.asymmetricKeyType!=='ed25519'||pub.asymmetricKeyType!=='ed25519'||
    !crypto.createPublicKey(priv).export({type:'spki',format:'der'}).equals(
      pub.export({type:'spki',format:'der'})))
    fail('UPDATE_INSPECTION_KEYPAIR_MISMATCH');
  return {priv,pub};
}
function receiptPath(dir,receiptId){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!HEX.test(receiptId))
    fail('UPDATE_INSPECTION_PATH_INVALID');
  const journal=path.join(dir,'update-inspections');
  if(fs.existsSync(journal)){
    const st=fs.lstatSync(journal);
    if(!st.isDirectory()||st.isSymbolicLink())
      fail('UPDATE_INSPECTION_JOURNAL_DIRECTORY_INVALID');
  }else fs.mkdirSync(journal,{recursive:true,mode:0o700});
  return path.join(journal,receiptId+'.json');
}
function validateSaved(existing,{node,pub,receiptId,offerHash,centralOrigin}){
  if(!existing||typeof existing!=='object'||Array.isArray(existing)||
    Object.keys(existing).sort().join('|')!=='payload|schema|signature_base64'||
    existing.schema!==1||typeof existing.signature_base64!=='string')
    fail('UPDATE_INSPECTION_RECEIPT_CORRUPT');
  const b=existing.payload;
  if(!b||typeof b!=='object'||Array.isArray(b)||
    Object.keys(b).sort().join('|')!==
      'authenticode_verified|central_origin|current_version|expires_at_ms|inspected_at_ms|installed|installer_sha256|kind|node_id|node_public_key_sha256|offer_sha256|receipt_id|source_sha|status|target_version|wave_id'||
    b.status!=='OFFLINE_INSPECTED_ONLY'||b.installed!==false||
    b.authenticode_verified!==true||b.node_id!==node.node_id||
    b.node_public_key_sha256!==hash(pub.export({type:'spki',format:'der'}))||
    b.central_origin!==centralOrigin||b.offer_sha256!==offerHash||
    b.receipt_id!==receiptId||!Number.isSafeInteger(b.inspected_at_ms)||
    !Number.isSafeInteger(b.expires_at_ms)||
    b.inspected_at_ms>b.expires_at_ms||
    !HEX.test(b.installer_sha256)||!/^[0-9a-f]{40}$/.test(b.source_sha))
    fail('UPDATE_INSPECTION_RECEIPT_IDENTITY_OR_DATA_MISMATCH');
  let ok=false;
  try{ok=crypto.verify(null,Buffer.from(PREFIX+JSON.stringify(b)),pub,
    Buffer.from(existing.signature_base64,'base64'));}
  catch{}
  if(!ok)fail('UPDATE_INSPECTION_RECEIPT_SIGNATURE_INVALID');
  return b;
}
function recordInspection({dir,node,centralOrigin,envelope,verified,currentVersion,
  authenticodeVerified,now=Date.now()}={}){
  const {priv,pub}=strictNode(node);
  if(typeof centralOrigin!=='string'||!/^https:\/\//.test(centralOrigin)||
    centralOrigin.length>250||!Number.isSafeInteger(now)||now<0||
    authenticodeVerified!==true||!verified||verified.accepted!==true||
    verified.device_node_id!==node.node_id||verified.requires_windows_authenticode!==true||
    verified.automatic_install!==false||typeof currentVersion!=='string'||
    !/^\d+\.\d+\.\d+$/.test(currentVersion))
    fail('UPDATE_INSPECTION_TRUSTED_PREFLIGHT_REQUIRED');
  const signed=envelope?.signed;
  if(!signed||typeof signed!=='object'||signed.schema!==2||
    !envelope?.signature_base64||typeof envelope.signature_base64!=='string'||
    signed.version!==verified.version||
    signed.type!=='update'&&signed.type!=='rollback'||
    signed.installer_sha256!==verified.file_sha256||
    signed.source_sha!==verified.source_sha||
    signed.rollout?.wave_id!==verified.wave_id||
    !Array.isArray(signed.rollout?.node_ids)||
    !signed.rollout.node_ids.includes(node.node_id)||
    !Number.isSafeInteger(signed.expires_ms)||now>=signed.expires_ms)
    fail('UPDATE_INSPECTION_SIGNED_OFFER_MISMATCH');
  const offerHash=hash(JSON.stringify(envelope));
  const receiptId=hash(node.node_id+'\n'+offerHash);
  const file=receiptPath(dir,receiptId);
  if(fs.existsSync(file)){
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>8192)
      fail('UPDATE_INSPECTION_RECEIPT_CORRUPT');
    let existing;
    try{existing=JSON.parse(fs.readFileSync(file,'utf8'));}
    catch{fail('UPDATE_INSPECTION_RECEIPT_CORRUPT');}
    validateSaved(existing,{node,pub,receiptId,offerHash,centralOrigin});
    return {recorded:true,previously_inspected:true,installed:false,
      receipt_id:receiptId,owner_install_approval:false};
  }
  const payload={
    status:'OFFLINE_INSPECTED_ONLY',installed:false,authenticode_verified:true,
    receipt_id:receiptId,node_id:node.node_id,
    node_public_key_sha256:hash(pub.export({type:'spki',format:'der'})),
    central_origin:centralOrigin,offer_sha256:offerHash,
    kind:signed.type,wave_id:verified.wave_id,
    target_version:signed.version,current_version:currentVersion,
    source_sha:signed.source_sha,installer_sha256:signed.installer_sha256,
    inspected_at_ms:now,expires_at_ms:signed.expires_ms
  };
  const signature_base64=crypto.sign(null,Buffer.from(PREFIX+JSON.stringify(payload)),
    priv).toString('base64');
  const data=JSON.stringify({schema:1,payload,signature_base64},null,2)+'\n';
  if(Buffer.byteLength(data)>8192)fail('UPDATE_INSPECTION_RECEIPT_TOO_LARGE');
  // wx is intentional: never replace an existing journal entry, including an
  // incomplete file left by a crash or an accidental duplicate inspection.
  try{fs.writeFileSync(file,data,{encoding:'utf8',flag:'wx',mode:0o600});}
  catch(e){if(e.code==='EEXIST')fail('UPDATE_INSPECTION_CONCURRENT_RECEIPT_OWNER_REVIEW');
    throw e;}
  try{fs.chmodSync(file,0o600);}catch{}
  return {recorded:true,previously_inspected:false,installed:false,
    receipt_id:receiptId,owner_install_approval:false};
}
module.exports={recordInspection,receiptPath,validateSaved};
