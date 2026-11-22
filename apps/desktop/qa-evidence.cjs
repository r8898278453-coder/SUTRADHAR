/**
 * Independent QA device-signed evidence: LOCAL OWNER REVIEW ONLY.
 *
 * This module does not post a QA receipt, approve a ticket, execute Docker,
 * import Git, or publish code. A signature proves only that an enrolled
 * device KEY signed the exact local report; the sandbox's truth still needs
 * independent human/infrastructure verification.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectWorkerTasks}=require('./worker-inspection.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const DOMAIN='SUTRADHAR_QA_EVIDENCE_V1\n';
const fail=c=>{throw Error(c);};
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const fields=['schema','status','ticket_id','qa_agent_id','developer_agent_id',
  'baseline_sha','candidate_head_sha','candidate_tree_sha','bundle_sha256',
  'image_sha256','archive_sha256','recorded_at','test_passed',
  'sandbox_started','exit_code','stdout_sha256','stderr_sha256',
  'stdout_tail','stderr_tail','evidence_level','qa_approved',
  'qa_receipt_submitted','git_published','automatic_execution_allowed'];
const sorted=x=>[...x].sort().join('|');
function readJson(file,maxBytes=16*1024){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('QA_EVIDENCE_PATH_INVALID');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<=0||st.size>maxBytes)
    fail('QA_EVIDENCE_FILE_UNTRUSTED');
  const raw=fs.readFileSync(file);
  if(raw.length!==st.size)fail('QA_EVIDENCE_FILE_CHANGED');
  let value;
  try{value=JSON.parse(raw.toString('utf8'));}
  catch{fail('QA_EVIDENCE_CORRUPT');}
  if(!value||typeof value!=='object'||Array.isArray(value))
    fail('QA_EVIDENCE_CORRUPT');
  return {raw,value};
}
function checkEvidence(e){
  if(!e||sorted(Object.keys(e))!==sorted(fields)||
     e.schema!==1||e.status!=='LOCAL_QA_TEST_ONLY'||
     e.evidence_level!=='LOCAL_UNATTESTED'||
     !ID.test(e.ticket_id||'')||!ID.test(e.qa_agent_id||'')||
     !ID.test(e.developer_agent_id||'')||
     e.qa_agent_id===e.developer_agent_id||
     !SHA.test(e.baseline_sha||'')||!SHA.test(e.candidate_head_sha||'')||
     !SHA.test(e.candidate_tree_sha||'')||
     !HASH.test(e.bundle_sha256||'')||!HASH.test(e.image_sha256||'')||
     !HASH.test(e.archive_sha256||'')||
     !HASH.test(e.stdout_sha256||'')||!HASH.test(e.stderr_sha256||'')||
     typeof e.recorded_at!=='string'||!Number.isFinite(Date.parse(e.recorded_at))||
     typeof e.test_passed!=='boolean'||typeof e.sandbox_started!=='boolean'||
     !(Number.isSafeInteger(e.exit_code)||e.exit_code===null)||
     typeof e.stdout_tail!=='string'||e.stdout_tail.length>3000||
     typeof e.stderr_tail!=='string'||e.stderr_tail.length>3000||
     e.qa_approved!==false||e.qa_receipt_submitted!==false||
     e.git_published!==false||e.automatic_execution_allowed!==false||
     (e.test_passed&&(!e.sandbox_started||e.exit_code!==0)))
    fail('QA_EVIDENCE_REPORT_INVALID');
  return e;
}
function checkIntent(i,e){
  const allowed=['schema','state','ticket_id','qa_agent_id','candidate_head_sha',
    'candidate_tree_sha','bundle_sha256','image_sha256','requested_at',
    'retry_allowed','qa_approved'];
  if(!i||sorted(Object.keys(i))!==sorted(allowed)||i.schema!==1||
     i.state!=='EXECUTION_REQUESTED'||i.retry_allowed!==false||
     i.qa_approved!==false||!Number.isFinite(Date.parse(i.requested_at))||
     i.ticket_id!==e.ticket_id||i.qa_agent_id!==e.qa_agent_id||
     i.candidate_head_sha!==e.candidate_head_sha||
     i.candidate_tree_sha!==e.candidate_tree_sha||
     i.bundle_sha256!==e.bundle_sha256||
     i.image_sha256!==e.image_sha256||
     Date.parse(i.requested_at)>Date.parse(e.recorded_at))
    fail('QA_EVIDENCE_INTENT_MISMATCH');
}
function envelopeMessage({node_id,agent_id,ticket_id,candidate_head_sha,
  candidate_tree_sha,evidence_sha256,passed}){
  if(!/^node_[a-f0-9]{32}$/.test(node_id||'')||
     !ID.test(agent_id||'')||!ID.test(ticket_id||'')||
     !SHA.test(candidate_head_sha||'')||!SHA.test(candidate_tree_sha||'')||
     !HASH.test(evidence_sha256||'')||typeof passed!=='boolean')
    fail('QA_EVIDENCE_SIGNATURE_INPUT_INVALID');
  return {schema:1,kind:'SUTRADHAR_INDEPENDENT_QA_EVIDENCE',
    node_id,agent_id,ticket_id,candidate_head_sha,candidate_tree_sha,
    evidence_sha256,passed};
}
function publicFingerprint(publicKeyPem){
  const key=crypto.createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519')fail('QA_EVIDENCE_KEY_UNTRUSTED');
  return digest(key.export({format:'der',type:'spki'}));
}
function verifyQaEvidence({attestation,evidenceRaw,expectedPublicKeyPem,
  expectedNodeId,expectedAgentId,expectedTicketId,
  expectedHead,expectedTree}){
  if(!attestation||attestation.schema!==1||
     sorted(Object.keys(attestation))!==sorted(['schema','message','signature',
       'public_key_fingerprint_sha256','signed_by','qa_approved',
       'central_qa_receipt_submitted'])||
     attestation.qa_approved!==false||
     attestation.central_qa_receipt_submitted!==false||
     attestation.signed_by!=='DEVICE_OS_VAULT_ED25519'||
     !HASH.test(attestation.public_key_fingerprint_sha256||'')||
     typeof attestation.signature!=='string'||
     !/^[A-Za-z0-9+/]{86}==$/.test(attestation.signature))
    fail('QA_EVIDENCE_ATTESTATION_INVALID');
  const raw=Buffer.isBuffer(evidenceRaw)?evidenceRaw:Buffer.from(evidenceRaw||'');
  if(!raw.length||raw.length>16*1024)fail('QA_EVIDENCE_FILE_UNTRUSTED');
  let evidence;
  try{evidence=checkEvidence(JSON.parse(raw.toString('utf8')));}
  catch{fail('QA_EVIDENCE_REPORT_INVALID');}
  const m=envelopeMessage(attestation.message||{});
  if(sorted(Object.keys(attestation.message))!==sorted(Object.keys(m))||
     typeof expectedPublicKeyPem!=='string'||
     publicFingerprint(expectedPublicKeyPem)!==attestation.public_key_fingerprint_sha256||
     m.node_id!==expectedNodeId||m.agent_id!==expectedAgentId||
     m.ticket_id!==expectedTicketId||m.candidate_head_sha!==expectedHead||
     m.candidate_tree_sha!==expectedTree||
     m.agent_id!==evidence.qa_agent_id||
     m.ticket_id!==evidence.ticket_id||
     m.candidate_head_sha!==evidence.candidate_head_sha||
     m.candidate_tree_sha!==evidence.candidate_tree_sha||
     m.evidence_sha256!==digest(raw)||
     m.passed!==evidence.test_passed)
    fail('QA_EVIDENCE_ATTESTATION_MISMATCH');
  const signed=Buffer.from(DOMAIN+JSON.stringify(m));
  const sig=Buffer.from(attestation.signature,'base64');
  if(sig.length!==64||!crypto.verify(null,signed,
    crypto.createPublicKey(expectedPublicKeyPem),sig))
    fail('QA_EVIDENCE_SIGNATURE_INVALID');
  return {signature_verified:true,evidence_sha256:digest(raw),
    ticket_id:m.ticket_id,node_id:m.node_id,
    qa_agent_id:m.agent_id,candidate_head_sha:m.candidate_head_sha,
    candidate_tree_sha:m.candidate_tree_sha,test_passed:m.passed,
    qa_approved:false,central_qa_receipt_submitted:false,
    evidence_level:'DEVICE_SIGNED_LOCAL_ONLY'};
}
function exclusiveWrite(file,data){
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
async function attestIndependentQa({origin,agentId,ticketId,signer,
  evidenceDir,fetcher=fetch,recoveryReviewOnly=false}){
  if(!ID.test(agentId||'')||!ID.test(ticketId||'')||
     typeof recoveryReviewOnly!=='boolean'||
     !signer||typeof signer.signQaEvidence!=='function'||
     typeof evidenceDir!=='string'||!path.isAbsolute(evidenceDir))
    fail('QA_EVIDENCE_INPUT_INVALID');
  const dir=fs.realpathSync.native(evidenceDir),st=fs.lstatSync(evidenceDir);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('QA_EVIDENCE_DIRECTORY_UNTRUSTED');
  const resultFile=path.join(dir,'qa_result_'+ticketId+'.json');
  const intentFile=path.join(dir,'qa_started_'+ticketId+'.json');
  const signedFile=path.join(dir,'qa_attested_'+ticketId+'.json');
  if(fs.existsSync(signedFile))fail('QA_EVIDENCE_ALREADY_SIGNED_OWNER_REVIEW');
  const record=readJson(resultFile),e=checkEvidence(record.value);
  const intent=readJson(intentFile,4096);
  checkIntent(intent.value,e);
  if(e.ticket_id!==ticketId||e.qa_agent_id!==agentId)
    fail('QA_EVIDENCE_WRONG_AGENT_OR_TICKET');
  const t=(await inspectWorkerTasks({origin,agentId,ticketId,
    signer,fetcher})).task;
  if(t.status!==(recoveryReviewOnly?'RECONCILIATION_REQUIRED':'SUBMITTED_FOR_REVIEW')||
     t.ticket_id!==e.ticket_id||
     t.worker_agent_id!==e.developer_agent_id||
     t.candidate_head_sha!==e.candidate_head_sha||
     t.candidate_tree_sha!==e.candidate_tree_sha||
     t.baseline_sha!==e.baseline_sha||
     t.worker_agent_id===agentId)
    fail('QA_EVIDENCE_CENTRAL_CHANGED_OWNER_REVIEW');
  const prepared={
    agent_id:agentId,ticket_id:ticketId,
    candidate_head_sha:e.candidate_head_sha,
    candidate_tree_sha:e.candidate_tree_sha,
    evidence_sha256:digest(record.raw),passed:e.test_passed
  };
  const signed=signer.signQaEvidence(prepared);
  if(!signed||!signed.message||!signed.public_key_pem)
    fail('QA_EVIDENCE_VAULT_SIGNER_INVALID');
  const attestation={schema:1,message:signed.message,
    signature:signed.signature,
    public_key_fingerprint_sha256:publicFingerprint(signed.public_key_pem),
    signed_by:'DEVICE_OS_VAULT_ED25519',qa_approved:false,
    central_qa_receipt_submitted:false};
  // Verify locally, but Owner MUST supply an independently authenticated
  // approved node public key to the external offline verifier.
  verifyQaEvidence({attestation,evidenceRaw:record.raw,
    expectedPublicKeyPem:signed.public_key_pem,
    expectedNodeId:signed.message.node_id,
    expectedAgentId:agentId,expectedTicketId:ticketId,
    expectedHead:e.candidate_head_sha,expectedTree:e.candidate_tree_sha});
  exclusiveWrite(signedFile,attestation);
  return {signed:true,ticket_id:ticketId,qa_agent_id:agentId,
    candidate_head_sha:e.candidate_head_sha,
    candidate_tree_sha:e.candidate_tree_sha,
    evidence_sha256:digest(record.raw),test_passed:e.test_passed,
    local_attestation_path:signedFile,
    public_key_fingerprint_sha256:attestation.public_key_fingerprint_sha256,
    qa_approved:false,central_qa_receipt_submitted:false,
    evidence_level:'DEVICE_SIGNED_LOCAL_ONLY'};
}
module.exports={attestIndependentQa,verifyQaEvidence,
  checkEvidence,checkIntent,envelopeMessage,publicFingerprint,DOMAIN};
