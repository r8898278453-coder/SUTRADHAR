/**
 * Manual Owner-pilot public-key continuity proof, performed in packaged
 * Electron MAIN ONLY using the existing OS-vault private key. The key is
 * never sent through IPC or stored in receipts. A signature proves key
 * possession at a software-reported time; it does not attest Windows DPAPI,
 * physical hardware, an OS reboot, live heartbeat, or Central approval.
 */
'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const PREFIX='SUTRADHAR_PILOT_NODE_CONTINUITY_V1\n';
const NODE=/^node_[0-9a-f]{32}$/,SHA=/^[0-9a-f]{40}$/,
  SESSION=/^[0-9a-f]{32}$/,AGENT=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/,
  BOOT=/^boot_[0-9a-f]{32}$/;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===keys;
const bad=x=>{throw Error(x);};
const fail=error_code=>({accepted:false,error_code,
  key_possession_at_observation_verified:false,
  physical_machine_verified:false,physical_reboot_verified:false,
  os_vault_backend_verified:false,production_release_authorized:false});
function fingerprint(publicKeyPem){
  const key=crypto.createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519')
    bad('PILOT_NODE_ED25519_KEY_REQUIRED');
  return crypto.createHash('sha256')
    .update(key.export({type:'spki',format:'der'})).digest('hex');
}
function challengeValid(c,now){
  return exact(c,'central_origin|expected_node_ids|expires_at_ms|issued_at_ms|schema|session_id|source_sha')&&
    c.schema===1&&SESSION.test(c.session_id||'')&&SHA.test(c.source_sha||'')&&
    typeof c.central_origin==='string'&&
    /^https:\/\/[a-z0-9][a-z0-9.-]{2,250}$/.test(c.central_origin)&&
    Array.isArray(c.expected_node_ids)&&c.expected_node_ids.length>=2&&
    c.expected_node_ids.length<=10&&c.expected_node_ids.every(x=>NODE.test(x))&&
    new Set(c.expected_node_ids).size===c.expected_node_ids.length&&
    Number.isSafeInteger(c.issued_at_ms)&&Number.isSafeInteger(c.expires_at_ms)&&
    c.issued_at_ms<=now+120000&&c.issued_at_ms>=now-7*86400000&&
    c.expires_at_ms>now&&c.expires_at_ms>c.issued_at_ms&&
    c.expires_at_ms-c.issued_at_ms<=7*86400000;
}
function observedAgents(agents){
  if(!Array.isArray(agents)||agents.length<1||agents.length>4||
     agents.some(a=>!exact(a,'id|sequence')||!AGENT.test(a.id||'')||
       !Number.isSafeInteger(a.sequence)||a.sequence<0)||
     new Set(agents.map(a=>a.id)).size!==agents.length)
    bad('PILOT_NODE_AGENT_COUNTER_INVALID');
  return agents.map(a=>({id:a.id,sequence:a.sequence}));
}
const payloadKeys='agent_counters|boot_id|central_origin|challenge_sha256|node_id|node_key_sha256|node_sequence|observed_at_ms|phase|schema|session_id|source_sha';
function createProof({node,challenge,phase,centralOrigin,now=Date.now()}={}){
  if(!Number.isSafeInteger(now)||now<1||!challengeValid(challenge,now)||
     !['BEFORE','AFTER'].includes(phase)||
     !node||!NODE.test(node.node_id||'')||
     !challenge.expected_node_ids.includes(node.node_id)||
     centralOrigin!==challenge.central_origin||
     !BOOT.test(node.boot_id||'')||
     !Number.isSafeInteger(node.node_sequence)||node.node_sequence<0)
    bad('PILOT_NODE_OWNER_CHALLENGE_OR_IDENTITY_INVALID');
  const agents=observedAgents(node.agents);
  const fp=fingerprint(node.public_key_pem);
  const privateKey=crypto.createPrivateKey(node.private_key_pem);
  if(privateKey.asymmetricKeyType!=='ed25519')
    bad('PILOT_NODE_PRIVATE_KEY_UNTRUSTED');
  const payload={schema:1,session_id:challenge.session_id,
    source_sha:challenge.source_sha,central_origin:centralOrigin,
    challenge_sha256:crypto.createHash('sha256')
      .update(JSON.stringify(challenge)).digest('hex'),
    phase,node_id:node.node_id,node_key_sha256:fp,
    boot_id:node.boot_id,node_sequence:node.node_sequence,
    agent_counters:agents,observed_at_ms:now};
  const signature_base64=crypto.sign(null,
    Buffer.from(PREFIX+JSON.stringify(payload)),privateKey).toString('base64');
  const verified=crypto.verify(null,Buffer.from(PREFIX+JSON.stringify(payload)),
    crypto.createPublicKey(node.public_key_pem),
    Buffer.from(signature_base64,'base64'));
  if(!verified)bad('PILOT_NODE_KEYPAIR_MISMATCH');
  return {payload,signature_base64};
}
function inspectProof(proof,{challenge,phase,nodeId,publicKeyPem,now}){
  if(!exact(proof,'payload|signature_base64')||
     !exact(proof.payload,payloadKeys)||
     typeof proof.signature_base64!=='string'||
     !/^[A-Za-z0-9+/]{86}==$/.test(proof.signature_base64))
    bad('PILOT_NODE_PROOF_MALFORMED');
  const p=proof.payload;
  if(p.schema!==1||p.session_id!==challenge.session_id||
     p.source_sha!==challenge.source_sha||
     p.central_origin!==challenge.central_origin||
     p.challenge_sha256!==crypto.createHash('sha256')
       .update(JSON.stringify(challenge)).digest('hex')||
     p.phase!==phase||p.node_id!==nodeId||
     p.node_key_sha256!==fingerprint(publicKeyPem)||
     !BOOT.test(p.boot_id||'')||
     !Number.isSafeInteger(p.node_sequence)||p.node_sequence<0||
     !Number.isSafeInteger(p.observed_at_ms)||
     p.observed_at_ms<challenge.issued_at_ms-120000||
     p.observed_at_ms>now+120000||
     p.observed_at_ms>challenge.expires_at_ms||
     p.observed_at_ms<1)
    bad('PILOT_NODE_PROOF_SCOPE_OR_TIME_INVALID');
  observedAgents(p.agent_counters);
  if(!crypto.verify(null,Buffer.from(PREFIX+JSON.stringify(p)),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(proof.signature_base64,'base64')))
    bad('PILOT_NODE_PROOF_SIGNATURE_INVALID');
  return p;
}
function verifyContinuity({challenge,before,after,expectedNodeId,
  expectedPublicKeyPem,expectedSha,expectedSessionId,now=Date.now(),
  requireBootChange=true}={}){
  try{
    if(!Number.isSafeInteger(now)||now<1||
       !challengeValid(challenge,now)||
       !NODE.test(expectedNodeId||'')||
       expectedSha!==challenge.source_sha||
       expectedSessionId!==challenge.session_id||
       !challenge.expected_node_ids.includes(expectedNodeId)||
       typeof expectedPublicKeyPem!=='string'||expectedPublicKeyPem.length>10000||
       requireBootChange!==true)
      return fail('PILOT_NODE_PINNED_CONTEXT_INVALID');
    const a=inspectProof(before,{challenge,phase:'BEFORE',nodeId:expectedNodeId,
      publicKeyPem:expectedPublicKeyPem,now});
    const b=inspectProof(after,{challenge,phase:'AFTER',nodeId:expectedNodeId,
      publicKeyPem:expectedPublicKeyPem,now});
    if(b.observed_at_ms<=a.observed_at_ms||
       b.observed_at_ms-a.observed_at_ms>48*3600000||
       b.boot_id===a.boot_id||
       b.node_sequence<a.node_sequence||
       b.agent_counters.length!==a.agent_counters.length||
       b.agent_counters.some((x,i)=>x.id!==a.agent_counters[i].id||
         x.sequence<a.agent_counters[i].sequence))
      return fail('PILOT_NODE_BOOT_COUNTER_OR_ORDER_CHANGED');
    return {accepted:true,
      status:'PILOT_NODE_SIGNED_KEY_CONTINUITY_ONLY',
      node_id:expectedNodeId,session_id:expectedSessionId,
      source_sha_claim:expectedSha,
      node_key_sha256:fingerprint(expectedPublicKeyPem),
      same_public_key_signature_verified:true,
      software_boot_id_changed:true,nondecreasing_counters:true,
      key_possession_at_observation_verified:true,
      physical_machine_verified:false,physical_reboot_verified:false,
      os_vault_backend_verified:false,central_approval_verified:false,
      production_release_authorized:false,read_only:true,
      warning:'Same-key signatures and software boot-id change do NOT prove physical hardware, DPAPI backend, OS reboot or healthy Central heartbeats.'};
  }catch{return fail('PILOT_NODE_SIGNATURE_OR_FORMAT_INVALID');}
}
function writeExclusive(file,proof){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.length>1024)
    bad('PILOT_NODE_OUTPUT_PATH_INVALID');
  const dir=fs.lstatSync(path.dirname(file));
  if(!dir.isDirectory()||dir.isSymbolicLink()||fs.existsSync(file))
    bad('PILOT_NODE_OUTPUT_UNSAFE');
  const bytes=Buffer.from(JSON.stringify(proof,null,2)+'\n');
  if(bytes.length>16000)bad('PILOT_NODE_PROOF_TOO_LARGE');
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {saved:true,node_id:proof.payload.node_id,
    phase:proof.payload.phase,session_id:proof.payload.session_id,
    public_key_sha256:proof.payload.node_key_sha256,
    key_exported:false,production_release_authorized:false};
}
module.exports={createProof,verifyContinuity,writeExclusive,
  fingerprint,challengeValid,PREFIX};
