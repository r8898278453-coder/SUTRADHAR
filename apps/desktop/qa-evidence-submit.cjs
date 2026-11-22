/**
 * Electron MAIN-only: manually upload device-signed QA report for Owner review,
 * then (only after separate explicit Owner approval) submit a QA receipt.
 *
 * No automatic QA pass, Git push, merge, remote execution or deployment.
 * Both POSTs have durable, exact-body recovery journals. Ambiguous responses
 * replay ONLY the original request ID, never create new side effects.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectWorkerTasks}=require('./worker-inspection.cjs');
const {checkEvidence,checkIntent,verifyQaEvidence}=require('./qa-evidence.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[0-9a-f]{40}$/,HASH=/^[0-9a-f]{64}$/;
const ORIGIN=/^https:\/\/[a-z0-9.-]+(?::443)?$/i;
const fail=c=>{throw Error(c);};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function evidenceDir(p){
  if(typeof p!=='string'||!path.isAbsolute(p))
    fail('QA_UPLOAD_DIRECTORY_INVALID');
  const st=fs.lstatSync(p);
  if(!st.isDirectory()||st.isSymbolicLink())
    fail('QA_UPLOAD_DIRECTORY_UNTRUSTED');
  return fs.realpathSync.native(p);
}
function readFile(p,max){
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.size===0||st.size>max)
    fail('QA_UPLOAD_FILE_UNTRUSTED');
  return fs.readFileSync(p);
}
function readRecord(p){
  const raw=readFile(p,8192);
  let obj;
  try{obj=JSON.parse(raw.toString('utf8'));}
  catch{fail('QA_UPLOAD_JOURNAL_CORRUPT');}
  if(!obj||obj.schema!==1||!obj.context||!obj.body||
     !HASH.test(obj.sha256||'')||
     sha(JSON.stringify({schema:1,context:obj.context,body:obj.body}))!==obj.sha256)
    fail('QA_UPLOAD_JOURNAL_TAMPERED');
  return obj;
}
function writeRecord(p,context,body){
  const core={schema:1,context,body};
  const record={...core,sha256:sha(JSON.stringify(core))};
  const fd=fs.openSync(p,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
async function boundedJson(response){
  const claimed=Number(response.headers?.get('content-length'));
  if(Number.isFinite(claimed)&&claimed>16*1024)
    fail('QA_UPLOAD_RESPONSE_TOO_LARGE');
  if(!response.body||typeof response.body.getReader!=='function')
    fail('QA_UPLOAD_RESPONSE_INVALID');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>16*1024)fail('QA_UPLOAD_RESPONSE_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch{fail('QA_UPLOAD_RESPONSE_INVALID');}
}
async function signedPost({origin,agentId,operation,body,signer,fetcher}){
  const signed=signer.signWorkerAction({operation,agent_id:agentId,payload:body});
  const response=await fetcher(origin+signed.uri,{
    method:'POST',headers:{...signed.headers,Accept:'application/json',
      'content-type':'application/json'},body:signed.body,
    redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(15000)
  });
  const result=await boundedJson(response);
  if(!response.ok){
    const code=typeof result?.error_code==='string'&&
      /^[A-Z][A-Z0-9_]{1,79}$/.test(result.error_code)
      ?result.error_code:'CENTRAL_REQUEST_FAILED';
    fail('QA_UPLOAD_'+code);
  }
  return result;
}
// Signed, bounded, read-only Owner QA decision and exact Central receipt
// observation. A local journal and/or successful POST is NOT sufficient proof.
async function readOwnerReview({origin,agentId,ticketId,signer,fetcher,context}){
  const uri='/v7/tasks/qa-review/'+context.review_proposal_id;
  if(!/^\/v7\/tasks\/qa-review\/qaev_[a-f0-9]{64}$/.test(uri)||
     typeof signer.signWorkerReadOnly!=='function')
    fail('QA_RECEIPT_READONLY_SIGNER_UNAVAILABLE');
  const headers=signer.signWorkerReadOnly({method:'GET',uri,agent_id:agentId});
  const response=await fetcher(origin+uri,{
    method:'GET',headers:{...headers,Accept:'application/json'},
    redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(12000)});
  const p=await boundedJson(response);
  if(!response.ok)fail('QA_RECEIPT_REVIEW_UNAVAILABLE');
  if(!p||p.review_proposal_id!==context.review_proposal_id||
     p.ticket_id!==ticketId||p.qa_agent_id!==agentId||
     p.candidate_head_sha!==context.candidate_head_sha||
     p.candidate_tree_sha!==context.candidate_tree_sha||
     p.evidence_sha256!==context.evidence_sha256||
     !['PENDING','APPROVED','DENIED'].includes(p.owner_review_state)||
     typeof p.qa_receipt_recorded!=='boolean'||
     p.owner_review_required!==true||
     p.automatic_qa_approval_allowed!==false||
     p.automatic_qa_receipt_allowed!==false||p.git_published!==false)
    fail('QA_RECEIPT_REVIEW_PROOF_MISMATCH');
  if(p.qa_receipt_recorded){
    if(p.owner_review_state!=='APPROVED'||
       !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(p.qa_receipt_id||'')||
       p.task_status!==(context.passed?'INTEGRATING':'TEST_FAILED')||
       p.manual_next_action!=='RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY')
      fail('QA_RECEIPT_REVIEW_PROOF_MISMATCH');
  }else if(p.qa_receipt_id!==null||
    p.task_status!=='SUBMITTED_FOR_REVIEW'||
    p.manual_next_action!==(p.owner_review_state==='PENDING'?
      'WAIT_FOR_OWNER_REVIEW':p.owner_review_state==='DENIED'?
      'STOP_OWNER_REVIEW_DENIED':'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE'))
    fail('QA_RECEIPT_REVIEW_PROOF_MISMATCH');
  return p;
}
async function verifiedLocal({origin,agentId,ticketId,signer,dir,fetcher,
  allowReceiptReplay=false}){
  const raw=readFile(path.join(dir,'qa_result_'+ticketId+'.json'),16*1024);
  let report,attestation,intent;
  try{
    report=checkEvidence(JSON.parse(raw.toString('utf8')));
    attestation=JSON.parse(readFile(path.join(dir,'qa_attested_'+ticketId+'.json'),8192).toString('utf8'));
    intent=JSON.parse(readFile(path.join(dir,'qa_started_'+ticketId+'.json'),4096).toString('utf8'));
  }catch{fail('QA_UPLOAD_LOCAL_EVIDENCE_UNTRUSTED');}
  checkIntent(intent,report);
  const snap=signer.snapshot();
  if(!snap||typeof snap.node_id!=='string'||typeof snap.public_key_pem!=='string'||
     !Array.isArray(snap.agents)||!snap.agents.some(x=>x.id===agentId))
    fail('QA_UPLOAD_VAULT_IDENTITY_INVALID');
  verifyQaEvidence({attestation,evidenceRaw:raw,
    expectedPublicKeyPem:snap.public_key_pem,
    expectedNodeId:snap.node_id,expectedAgentId:agentId,
    expectedTicketId:ticketId,expectedHead:report.candidate_head_sha,
    expectedTree:report.candidate_tree_sha});
  const remote=(await inspectWorkerTasks({origin,agentId,ticketId,signer,fetcher})).task;
  if(!['SUBMITTED_FOR_REVIEW',...(allowReceiptReplay?['INTEGRATING','TEST_FAILED']:[])].includes(remote.status)||
     remote.worker_agent_id!==report.developer_agent_id||
     remote.worker_agent_id===agentId||
     remote.baseline_sha!==report.baseline_sha||
     remote.candidate_head_sha!==report.candidate_head_sha||
     remote.candidate_tree_sha!==report.candidate_tree_sha)
    fail('QA_UPLOAD_CENTRAL_CANDIDATE_CHANGED');
  const evidenceSha=sha(raw),signatureSha=sha(Buffer.from(attestation.signature,'base64'));
  const proposalId='qaev_'+sha([ticketId,agentId,snap.node_id,
    report.candidate_head_sha,report.candidate_tree_sha,evidenceSha,
    signatureSha,report.test_passed?'PASS':'FAIL'].join('\n'));
  return {raw,report,attestation,remote,evidenceSha,proposalId,
    context:{ticket_id:ticketId,agent_id:agentId,node_id:snap.node_id,
      candidate_head_sha:report.candidate_head_sha,
      candidate_tree_sha:report.candidate_tree_sha,
      evidence_sha256:evidenceSha,signature_sha256:signatureSha,
      passed:report.test_passed,review_proposal_id:proposalId}};
}
function journal(dir,ticketId,kind,context,body){
  if(!['evidence','receipt'].includes(kind))fail('QA_UPLOAD_OPERATION_INVALID');
  const prefix='qa_central_'+kind+'_'+ticketId;
  const pending=path.join(dir,prefix+'_pending.json');
  const receipt=path.join(dir,prefix+'_receipt.json');
  if(fs.existsSync(receipt)){
    const old=readRecord(receipt);
    if(JSON.stringify(old.context)!==JSON.stringify(context)||
       JSON.stringify(old.body)!==JSON.stringify(body))
      fail('QA_UPLOAD_EXISTING_RECEIPT_CHANGED');
    return {already:true,pending,receipt};
  }
  if(fs.existsSync(pending)){
    const old=readRecord(pending);
    if(JSON.stringify(old.context)!==JSON.stringify(context)||
       JSON.stringify(old.body)!==JSON.stringify(body))
      fail('QA_UPLOAD_PENDING_RECONCILIATION_REQUIRED');
    return {already:false,pending,receipt};
  }
  writeRecord(pending,context,body);
  return {already:false,pending,receipt};
}
function complete(j,context,body){
  if(!fs.existsSync(j.receipt))writeRecord(j.receipt,context,body);
  fs.unlinkSync(j.pending);
}
function checkInputs({origin,agentId,ticketId,signer,dir}){
  if(typeof origin!=='string'||!ORIGIN.test(origin)||origin.length>250||
     !ID.test(agentId||'')||!ID.test(ticketId||'')||
     !signer||typeof signer.snapshot!=='function'||
     typeof signer.signWorkerAction!=='function')
    fail('QA_UPLOAD_INPUT_DENIED');
  return evidenceDir(dir);
}
async function submitQaEvidenceForOwner({origin,agentId,ticketId,signer,
  evidenceDir:dir,fetcher=fetch}){
  dir=checkInputs({origin,agentId,ticketId,signer,dir});
  const v=await verifiedLocal({origin,agentId,ticketId,signer,dir,fetcher});
  const pendingPath=path.join(dir,'qa_central_evidence_'+ticketId+'_pending.json');
  const receiptPath=path.join(dir,'qa_central_evidence_'+ticketId+'_receipt.json');
  const knownPath=fs.existsSync(pendingPath)?pendingPath:
    fs.existsSync(receiptPath)?receiptPath:null;
  const previous=knownPath?readRecord(knownPath):null;
  const requestId=previous?.body?.request_id||
    'qaevidence_'+crypto.randomUUID().replace(/-/g,'');
  const context=v.context;
  const body={request_id:requestId,agent_id:agentId,ticket_id:ticketId,
    evidence_base64:v.raw.toString('base64'),attestation:v.attestation,
    evidence_ref:'sha256:'+v.evidenceSha};
  // Keep signed report bytes out of private journal: immutable SHA binding,
  // plus stable original request ID, are sufficient for exact replay.
  const journalBody={request_id:requestId};
  if(previous){
    if(JSON.stringify(previous.context)!==JSON.stringify(context)||
       !ID.test(previous.body.request_id||'')||
       !previous.body.request_id.startsWith('qaevidence_'))
      fail('QA_UPLOAD_PENDING_RECONCILIATION_REQUIRED');
    body.request_id=previous.body.request_id;
    journalBody.request_id=previous.body.request_id;
  }
  const j=journal(dir,ticketId,'evidence',context,journalBody);
  if(j.already)return {accepted:true,already_submitted:true,
    status:'OWNER_REVIEW_PREVIOUSLY_REQUESTED',review_proposal_id:v.proposalId,
    evidence_sha256:v.evidenceSha,qa_approved:false,qa_receipt_submitted:false};
  const result=await signedPost({origin,agentId,operation:'qa-evidence',body,
    signer,fetcher});
  if(result.accepted!==true||result.review_proposal_id!==v.proposalId||
     result.evidence_sha256!==v.evidenceSha||
     result.device_signature_verified!==true||result.qa_approved!==false||
     result.qa_receipt_submitted!==false||result.integration_performed!==false||
     result.git_published!==false||
     !['PENDING_OWNER_REVIEW','APPROVED_OWNER_REVIEW'].includes(result.status))
    fail('QA_UPLOAD_CENTRAL_EVIDENCE_RECEIPT_INVALID');
  complete(j,context,journalBody);
  return {...result,central_qa_receipt_submitted:false,
    automatic_git_publish:false};
}
async function submitOwnerReviewedQaReceipt({origin,agentId,ticketId,signer,
  evidenceDir:dir,fetcher=fetch}){
  dir=checkInputs({origin,agentId,ticketId,signer,dir});
  const v=await verifiedLocal({origin,agentId,ticketId,signer,dir,fetcher,
    allowReceiptReplay:true});
  const uploadFile=path.join(dir,'qa_central_evidence_'+ticketId+'_receipt.json');
  const uploaded=readRecord(uploadFile);
  if(JSON.stringify(uploaded.context)!==JSON.stringify(v.context)||
     !ID.test(uploaded.body.request_id||'')||
     !uploaded.body.request_id.startsWith('qaevidence_'))
    fail('QA_RECEIPT_PREVIOUS_UPLOAD_REQUIRED');
  // A human Owner's decision is independent of a durable QA receipt.
  // Reject pending or denied review BEFORE inventing a receipt request ID.
  const review=await readOwnerReview({origin,agentId,ticketId,signer,
    fetcher,context:v.context});
  if(review.owner_review_state==='PENDING')
    fail('QA_RECEIPT_OWNER_REVIEW_PENDING');
  if(review.owner_review_state==='DENIED')
    fail('QA_RECEIPT_OWNER_REVIEW_DENIED');
  const prefix='qa_central_receipt_'+ticketId;
  const pending=path.join(dir,prefix+'_pending.json');
  const completed=path.join(dir,prefix+'_receipt.json');
  const known=fs.existsSync(pending)?pending:
    fs.existsSync(completed)?completed:null;
  const old=known?readRecord(known):null;
  if(old&&JSON.stringify(old.context)!==JSON.stringify(v.context))
    fail('QA_RECEIPT_PENDING_RECONCILIATION_REQUIRED');
  const requestId=old?old.body.request_id:
    'qareceipt_'+crypto.randomUUID().replace(/-/g,'');
  if(!ID.test(requestId||'')||!requestId.startsWith('qareceipt_'))
    fail('QA_RECEIPT_REQUEST_ID_INVALID');
  const body={request_id:requestId,agent_id:agentId,ticket_id:ticketId,
    candidate_head_sha:v.report.candidate_head_sha,
    candidate_tree_sha:v.report.candidate_tree_sha,
    evidence_sha256:v.evidenceSha,
    evidence_ref:'sha256:'+v.evidenceSha,
    passed:v.report.test_passed,review_proposal_id:v.proposalId};
  const journalBody={request_id:requestId};
  if(review.qa_receipt_recorded){
    // A lost ACK after Central commit is UNKNOWN locally. Require an existing
    // durable local intent and reconcile via GET, with ZERO repeated POSTs.
    if(!known)fail('QA_RECEIPT_CENTRAL_RECORDED_WITHOUT_LOCAL_INTENT');
    const j=journal(dir,ticketId,'receipt',v.context,journalBody);
    if(!j.already)complete(j,v.context,journalBody);
    return {accepted:true,already_submitted:true,reconciled_from_central:true,
      receipt_id:review.qa_receipt_id,ticket_id:ticketId,
      status:review.task_status,qa_receipt_submitted:true,
      qa_approved_by_owner_required:true,git_published:false};
  }
  if(v.remote.status!=='SUBMITTED_FOR_REVIEW')
    fail('QA_RECEIPT_CENTRAL_ALREADY_CHANGED');
  const j=journal(dir,ticketId,'receipt',v.context,journalBody);
  if(j.already)fail('QA_RECEIPT_LOCAL_RECEIPT_REMOTE_UNCONFIRMED');
  const result=await signedPost({origin,agentId,operation:'qa-receipt',body,
    signer,fetcher});
  if(result.accepted!==true||result.ticket_id!==ticketId||
     result.status!==(v.report.test_passed?'INTEGRATING':'TEST_FAILED')||
     typeof result.receipt_id!=='string'||
     !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(result.receipt_id)||
     result.evidence_level!=='AGENT_ATTESTED')
    fail('QA_RECEIPT_CENTRAL_RESPONSE_INVALID');
  // A prior idempotent ACK is not by itself a live Central proof. The exact
  // persisted receipt ID and state must be observed independently.
  const after=await readOwnerReview({origin,agentId,ticketId,signer,
    fetcher,context:v.context});
  if(!after.qa_receipt_recorded||after.qa_receipt_id!==result.receipt_id||
     after.task_status!==result.status)
    fail('QA_RECEIPT_CENTRAL_RECONCILIATION_REQUIRED');
  complete(j,v.context,journalBody);
  return {...result,qa_receipt_submitted:true,
    owner_review_proposal_id:v.proposalId,
    git_published:false,merge_performed:false,
    read_only_central_reconciled:true};
}
module.exports={submitQaEvidenceForOwner,submitOwnerReviewedQaReceipt,
  verifiedLocal,readRecord};
