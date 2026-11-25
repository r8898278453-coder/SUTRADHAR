/**
 * Offline verification of an Owner-signed physical-PC pilot EVIDENCE INDEX.
 *
 * It authenticates the Owner's exact session/commit/PC-set intent and hashes
 * of two read-only Central snapshots + a separate physical-witness file.
 * It CANNOT prove real PC existence, power state, OS key possession, Central
 * truth, real source deployment SHA, or actual manual observation.
 *
 * No network, no database writes, no installer, no release authorization.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {compareFailover}=require('./pilot-policy.cjs');
const PREFIX='SUTRADHAR_OWNER_PILOT_EVIDENCE_V1\n';
const SHA=/^[a-f0-9]{40}$/,HEX=/^[a-f0-9]{64}$/,
  SESSION=/^[a-f0-9]{32}$/,NODE=/^node_[a-f0-9]{32}$/;
const KEYS='after_sha256|before_sha256|case_type|central_origin|expected_node_ids|expires_at_ms|issued_at_ms|owner_review_note|physical_witness_sha256|schema|session_id|source_sha';
const SNAPSHOT_KEYS=[
  'accepted','failures','measured_at_utc','checked_physical_node_ids',
  'deliberately_offline_node_ids','active_approved_nodes',
  'master_agent_id','master_node_id','backup1','backup1_node_id',
  'backup2','backup2_node_id','epoch','phase',
  'capture_schema','capture_mode','central_origin','source_sha_claim',
  'source_sha_verified','public_dns_prechecked','owner_hostname_pinned',
  'physical_machine_verified','node_key_possession_verified',
  'production_release_authorized','read_only'
].sort().join('|');
function deny(code){return {accepted:false,error_code:code,
  evidence_index_verified:false,physical_test_verified:false,
  production_release_authorized:false,read_only:true};}
function exactKeys(o,keys){
  return o&&typeof o==='object'&&!Array.isArray(o)&&
    Object.keys(o).sort().join('|')===keys;
}
function validatePayload(p,now=Date.now()){
  if(!exactKeys(p,KEYS)||p.schema!==1||
     !SESSION.test(p.session_id||'')||!SHA.test(p.source_sha||'')||
     !['failover','sticky'].includes(p.case_type)||
     !HEX.test(p.before_sha256||'')||!HEX.test(p.after_sha256||'')||
     !HEX.test(p.physical_witness_sha256||'')||
     typeof p.central_origin!=='string'||
     !/^https:\/\/[a-z0-9][a-z0-9.-]{2,250}$/.test(p.central_origin)||
     !Number.isSafeInteger(now)||now<1||
     !Number.isSafeInteger(p.issued_at_ms)||
     !Number.isSafeInteger(p.expires_at_ms)||
     p.issued_at_ms>now+120000||p.expires_at_ms<=now||
     p.expires_at_ms<=p.issued_at_ms||
     p.expires_at_ms-p.issued_at_ms>24*3600000||
     typeof p.owner_review_note!=='string'||
     p.owner_review_note.trim().length<40||
     p.owner_review_note.length>500||
     !Array.isArray(p.expected_node_ids)||
     ![2,3,8,9,10].includes(p.expected_node_ids.length)||
     p.expected_node_ids.some(n=>!NODE.test(n))||
     new Set(p.expected_node_ids).size!==p.expected_node_ids.length||
     (p.case_type==='failover'&&!([2,3].includes(p.expected_node_ids.length)))||
     (p.case_type==='sticky'&&p.expected_node_ids.length===2))
    return 'PILOT_SIGNED_CONTEXT_INVALID';
  return null;
}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function decode(bytes,max){
  if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.length>max)
    throw Error('PILOT_EVIDENCE_FILE_INVALID');
  return JSON.parse(bytes.toString('utf8'));
}
function validateSnapshot(v,p,which){
  if(!exactKeys(v,SNAPSHOT_KEYS)||
     v.capture_schema!==1||
     v.capture_mode!=='OWNER_READONLY_CENTRAL_PILOT'||
     v.source_sha_claim!==p.source_sha||
     v.source_sha_verified!==false||
     v.physical_machine_verified!==false||
     v.node_key_possession_verified!==false||
     v.production_release_authorized!==false||
     v.central_origin!==p.central_origin||
     v.owner_hostname_pinned!==true||
     v.public_dns_prechecked!==true||
     v.read_only!==true||v.accepted!==true||
     !Array.isArray(v.failures)||v.failures.length>0||
     !Array.isArray(v.checked_physical_node_ids)||
     JSON.stringify(v.checked_physical_node_ids)!==
       JSON.stringify(p.expected_node_ids)||
     !Array.isArray(v.active_approved_nodes)||
     new Set(v.active_approved_nodes).size!==v.active_approved_nodes.length||
     v.active_approved_nodes.some(x=>!p.expected_node_ids.includes(x))||
     !Array.isArray(v.deliberately_offline_node_ids)||
     new Set(v.deliberately_offline_node_ids).size!==v.deliberately_offline_node_ids.length||
     v.deliberately_offline_node_ids.some(x=>!p.expected_node_ids.includes(x))||
     (which==='before'&&v.deliberately_offline_node_ids.length!==0)||
     (which==='after'&&v.deliberately_offline_node_ids.length!==
       (p.case_type==='failover'?1:0))||
     !NODE.test(v.master_node_id||'')||
     !p.expected_node_ids.includes(v.master_node_id)||
     typeof v.master_agent_id!=='string'||v.master_agent_id.length<3||
     !Number.isSafeInteger(v.epoch)||v.epoch<1||
     !['READY','RECOVERING'].includes(v.phase)||
     !Number.isFinite(Date.parse(v.measured_at_utc||'')))
    throw Error('PILOT_EVIDENCE_SNAPSHOT_SCOPE_INVALID');
  const online=new Set(v.active_approved_nodes),off=new Set(v.deliberately_offline_node_ids);
  if(v.active_approved_nodes.length!==p.expected_node_ids.length-off.size||
     p.expected_node_ids.some(n=>online.has(n)===off.has(n))||
     !online.has(v.master_node_id))
    throw Error('PILOT_EVIDENCE_NODE_SET_NOT_VERIFIED');
  const twoPcPromoted=p.case_type==='failover'&&which==='after'&&
    p.expected_node_ids.length===2;
  if((!twoPcPromoted&&(
       typeof v.backup1!=='string'||v.backup1.length<3||
       !NODE.test(v.backup1_node_id||'')||
       !online.has(v.backup1_node_id)||
       v.backup1_node_id===v.master_node_id||
       v.backup1===v.master_agent_id))||
     (twoPcPromoted&&(v.backup1!==null||v.backup1_node_id!==null)))
    throw Error('PILOT_EVIDENCE_BACKUP1_INVALID');
  const threePcFailover=p.case_type==='failover'&&
    which==='after'&&p.expected_node_ids.length===3;
  if(p.expected_node_ids.length>=3&&!threePcFailover&&(
      !NODE.test(v.backup2_node_id||'')||
      !online.has(v.backup2_node_id)||
      v.backup2_node_id===v.master_node_id||
      v.backup2_node_id===v.backup1_node_id||
      v.backup2===v.master_agent_id||v.backup2===v.backup1))
    throw Error('PILOT_EVIDENCE_BACKUP2_INVALID');
  if(threePcFailover&&(v.backup2!==null||
      v.backup2_node_id!==null))
    throw Error('PILOT_EVIDENCE_THREE_PC_BACKUP2_MUST_BE_VACANT');
  if(p.expected_node_ids.length===2&&
     (v.backup2!==null&&v.backup2!==undefined||
      v.backup2_node_id!==null&&v.backup2_node_id!==undefined))
    throw Error('PILOT_EVIDENCE_UNEXPECTED_BACKUP2');
}
function evaluate({envelope,ownerPublicKeyPem,expectedSha,expectedSessionId,
  beforeBytes,afterBytes,witnessBytes,now=Date.now()}={}){
  try{
    if(!SHA.test(expectedSha||'')||!SESSION.test(expectedSessionId||'')||
       typeof ownerPublicKeyPem!=='string'||ownerPublicKeyPem.length>10000||
       !exactKeys(envelope,'payload|signature_base64')||
       typeof envelope.signature_base64!=='string'||
       !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature_base64))
      return deny('PILOT_EVIDENCE_SIGNATURE_INPUT_INVALID');
    const p=envelope.payload;
    const invalid=validatePayload(p,now);
    if(invalid)return deny(invalid);
    if(p.source_sha!==expectedSha||p.session_id!==expectedSessionId)
      return deny('PILOT_EVIDENCE_SESSION_OR_COMMIT_MISMATCH');
    const key=crypto.createPublicKey(ownerPublicKeyPem);
    if(key.asymmetricKeyType!=='ed25519'||
       !crypto.verify(null,Buffer.from(PREFIX+JSON.stringify(p)),key,
         Buffer.from(envelope.signature_base64,'base64')))
      return deny('PILOT_EVIDENCE_OWNER_SIGNATURE_INVALID');
    if(!Buffer.isBuffer(witnessBytes)||witnessBytes.length<30||
       witnessBytes.length>16*1024*1024)
      return deny('PILOT_PHYSICAL_WITNESS_FILE_INVALID');
    if(!Buffer.isBuffer(beforeBytes)||beforeBytes.length>128*1024||
       !Buffer.isBuffer(afterBytes)||afterBytes.length>128*1024)
      return deny('PILOT_SNAPSHOT_FILE_INVALID');
    if(hash(beforeBytes)!==p.before_sha256||
       hash(afterBytes)!==p.after_sha256||
       hash(witnessBytes)!==p.physical_witness_sha256)
      return deny('PILOT_SIGNED_EVIDENCE_HASH_MISMATCH');
    const before=decode(beforeBytes,128*1024),
      after=decode(afterBytes,128*1024);
    validateSnapshot(before,p,'before');
    validateSnapshot(after,p,'after');
    const t0=Date.parse(before.measured_at_utc),
      t1=Date.parse(after.measured_at_utc);
    if(t1<=t0||t1-t0>6*3600000||
       t0<p.issued_at_ms-24*3600000||t1>p.issued_at_ms+120000||
       t1>now+120000)
      return deny('PILOT_SIGNED_OBSERVATION_TIMELINE_INVALID');
    if(p.case_type==='failover'){
      const result=compareFailover(before,after);
      if(!result.accepted)return deny('PILOT_FAILOVER_NOT_VERIFIED_'+
        (result.failures[0]||'UNKNOWN'));
    }else if(after.master_agent_id!==before.master_agent_id||
       after.master_node_id!==before.master_node_id||
       after.backup1!==before.backup1||
       after.backup1_node_id!==before.backup1_node_id||
       after.backup2!==before.backup2||
       after.backup2_node_id!==before.backup2_node_id||
       after.epoch!==before.epoch||
       before.phase!=='READY'||after.phase!=='READY')
      return deny('PILOT_STICKY_MASTER_OR_EPOCH_CHANGED');
    return {accepted:true,status:'OWNER_SIGNED_PILOT_FILE_HASHES_AND_POLICY_VALID_ONLY',
      source_sha:expectedSha,session_id:expectedSessionId,
      case_type:p.case_type,node_count:p.expected_node_ids.length,
      verified_files:3,owner_signature_verified:true,
      snapshot_hashes_verified:true,physical_witness_hash_verified:true,
      evidence_index_verified:true,
      physical_test_verified:false,node_key_possession_verified:false,
      installer_success_verified:false,production_release_authorized:false,
      read_only:true,requires_independent_physical_witness_review:true,
      warning:'Signatures and hashes bind supplied files, not real-world physical PC actions or independent Central/database facts.'};
  }catch{return deny('PILOT_EVIDENCE_FORMAT_OR_VERIFICATION_FAILED');}
}
function readFile(file,limit){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('PILOT_EVIDENCE_FILE_ABSOLUTE_PATH_REQUIRED');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>limit)
    throw Error('PILOT_EVIDENCE_FILE_UNSAFE');
  return fs.readFileSync(file);
}
function main(){
  try{
    const env=process.env;
    const envelope=JSON.parse(readFile(env.SUTRADHAR_PILOT_OWNER_ENVELOPE_FILE,128*1024));
    const pub=readFile(env.SUTRADHAR_PILOT_OWNER_PUBLIC_KEY_FILE,10000).toString('utf8');
    const result=evaluate({envelope,ownerPublicKeyPem:pub,
      expectedSha:env.SUTRADHAR_PILOT_SOURCE_SHA,
      expectedSessionId:env.SUTRADHAR_PILOT_SESSION_ID,
      beforeBytes:readFile(env.SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH,128*1024),
      afterBytes:readFile(env.SUTRADHAR_PILOT_AFTER_RECEIPT_PATH,128*1024),
      witnessBytes:readFile(env.SUTRADHAR_PILOT_PHYSICAL_WITNESS_FILE,16*1024*1024)});
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }catch{
    console.error('PILOT_OWNER_EVIDENCE_OFFLINE_VERIFICATION_FAILED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={evaluate,validatePayload,readFile,hash,PREFIX};
