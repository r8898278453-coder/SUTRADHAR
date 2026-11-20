/**
 * Pure Central-side cryptographic verifier for independent QA evidence.
 * Does not trust arbitrary keys or status flags from the transferred file.
 * Only nodeAuth's currently APPROVED DB-enrolled Ed25519 public key is trusted.
 *
 * A valid device signature alone does NOT establish test authenticity or
 * authorize integration. A separate Owner-reviewed proposal is mandatory.
 */
import * as crypto from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const SHA=/^[0-9a-f]{40}$/,HASH=/^[0-9a-f]{64}$/;
const NODE=/^node_[0-9a-f]{32}$/;
const DOMAIN='SUTRADHAR_QA_EVIDENCE_V1\n';
const REPORT_KEYS=['schema','status','ticket_id','qa_agent_id','developer_agent_id',
  'baseline_sha','candidate_head_sha','candidate_tree_sha','bundle_sha256',
  'image_sha256','archive_sha256','recorded_at','test_passed',
  'sandbox_started','exit_code','stdout_sha256','stderr_sha256',
  'stdout_tail','stderr_tail','evidence_level','qa_approved',
  'qa_receipt_submitted','git_published','automatic_execution_allowed'];
const MESSAGE_KEYS=['schema','kind','node_id','agent_id','ticket_id',
  'candidate_head_sha','candidate_tree_sha','evidence_sha256','passed'];
const ATTEST_KEYS=['schema','message','signature','public_key_fingerprint_sha256',
  'signed_by','qa_approved','central_qa_receipt_submitted'];
export class QaEvidenceError extends Error{
  constructor(public code:string){super(code);}
}
function fail(code:string):never{throw new QaEvidenceError(code);}
const hash=(v:Buffer|string)=>crypto.createHash('sha256').update(v).digest('hex');
const exactKeys=(x:any,keys:string[])=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===[...keys].sort().join('|');
export type QaEvidenceProof={
  evidence_sha256:string; evidence_ref:string;
  qa_agent_id:string; developer_agent_id:string; node_id:string;
  ticket_id:string; baseline_sha:string; candidate_head_sha:string;
  candidate_tree_sha:string; passed:boolean; image_sha256:string;
  bundle_sha256:string; archive_sha256:string;
  public_key_fingerprint_sha256:string; signature_sha256:string;
};
export function verifyQaEvidencePackage(input:{
  evidence_base64:unknown; attestation:unknown;
  enrolled_public_key_pem:string; node_id:string;
  agent_id:string; ticket_id:string;
  candidate_head_sha:string; candidate_tree_sha:string;
  baseline_sha:string; worker_agent_id:string;
}):QaEvidenceProof{
  const b64=input.evidence_base64;
  if(typeof b64!=='string'||b64.length<100||b64.length>22000||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(b64))
    fail('QA_EVIDENCE_BASE64_INVALID');
  const raw=Buffer.from(b64,'base64');
  if(raw.length===0||raw.length>16*1024||raw.toString('base64')!==b64)
    fail('QA_EVIDENCE_BASE64_INVALID');
  let report:any;
  try{report=JSON.parse(raw.toString('utf8'));}
  catch{fail('QA_EVIDENCE_REPORT_INVALID');}
  if(!exactKeys(report,REPORT_KEYS)||report.schema!==1||
     report.status!=='LOCAL_QA_TEST_ONLY'||
     report.evidence_level!=='LOCAL_UNATTESTED'||
     !ID.test(report.ticket_id||'')||!ID.test(report.qa_agent_id||'')||
     !ID.test(report.developer_agent_id||'')||
     report.developer_agent_id===report.qa_agent_id||
     !SHA.test(report.baseline_sha||'')||
     !SHA.test(report.candidate_head_sha||'')||
     !SHA.test(report.candidate_tree_sha||'')||
     !HASH.test(report.bundle_sha256||'')||
     !HASH.test(report.image_sha256||'')||
     !HASH.test(report.archive_sha256||'')||
     !HASH.test(report.stdout_sha256||'')||
     !HASH.test(report.stderr_sha256||'')||
     typeof report.recorded_at!=='string'||report.recorded_at.length>64||
     !Number.isFinite(Date.parse(report.recorded_at))||
     typeof report.test_passed!=='boolean'||
     typeof report.sandbox_started!=='boolean'||
     !(Number.isSafeInteger(report.exit_code)||report.exit_code===null)||
     typeof report.stdout_tail!=='string'||report.stdout_tail.length>3000||
     typeof report.stderr_tail!=='string'||report.stderr_tail.length>3000||
     report.qa_approved!==false||report.qa_receipt_submitted!==false||
     report.git_published!==false||report.automatic_execution_allowed!==false||
     (report.test_passed&&(!report.sandbox_started||report.exit_code!==0)))
    fail('QA_EVIDENCE_REPORT_INVALID');
  if(report.ticket_id!==input.ticket_id||report.qa_agent_id!==input.agent_id||
     report.developer_agent_id!==input.worker_agent_id||
     report.baseline_sha!==input.baseline_sha||
     report.candidate_head_sha!==input.candidate_head_sha||
     report.candidate_tree_sha!==input.candidate_tree_sha)
    fail('QA_EVIDENCE_CANDIDATE_MISMATCH');
  const a=input.attestation as any;
  if(!exactKeys(a,ATTEST_KEYS)||a.schema!==1||
     a.signed_by!=='DEVICE_OS_VAULT_ED25519'||
     a.qa_approved!==false||a.central_qa_receipt_submitted!==false||
     !HASH.test(a.public_key_fingerprint_sha256||'')||
     typeof a.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(a.signature)||
     !exactKeys(a.message,MESSAGE_KEYS))
    fail('QA_EVIDENCE_ATTESTATION_INVALID');
  const m=a.message;
  if(m.schema!==1||m.kind!=='SUTRADHAR_INDEPENDENT_QA_EVIDENCE'||
     !NODE.test(m.node_id||'')||!ID.test(m.agent_id||'')||
     !ID.test(m.ticket_id||'')||
     !SHA.test(m.candidate_head_sha||'')||!SHA.test(m.candidate_tree_sha||'')||
     !HASH.test(m.evidence_sha256||'')||typeof m.passed!=='boolean'||
     m.node_id!==input.node_id||m.agent_id!==input.agent_id||
     m.ticket_id!==input.ticket_id||m.candidate_head_sha!==input.candidate_head_sha||
     m.candidate_tree_sha!==input.candidate_tree_sha||
     m.evidence_sha256!==hash(raw)||m.passed!==report.test_passed)
    fail('QA_EVIDENCE_ATTESTATION_MISMATCH');
  let key:crypto.KeyObject;
  try{key=crypto.createPublicKey(input.enrolled_public_key_pem);}
  catch{fail('QA_EVIDENCE_TRUSTED_KEY_INVALID');}
  if(key.asymmetricKeyType!=='ed25519'||
     hash(key.export({format:'der',type:'spki'}) as Buffer)!==
       a.public_key_fingerprint_sha256)
    fail('QA_EVIDENCE_TRUSTED_KEY_MISMATCH');
  const sig=Buffer.from(a.signature,'base64');
  if(sig.length!==64||sig.toString('base64')!==a.signature||
     !crypto.verify(null,Buffer.from(DOMAIN+JSON.stringify(m)),key,sig))
    fail('QA_EVIDENCE_SIGNATURE_INVALID');
  const sha=hash(raw);
  return {evidence_sha256:sha,evidence_ref:'sha256:'+sha,
    qa_agent_id:m.agent_id,developer_agent_id:report.developer_agent_id,
    node_id:m.node_id,ticket_id:m.ticket_id,
    baseline_sha:report.baseline_sha,candidate_head_sha:m.candidate_head_sha,
    candidate_tree_sha:m.candidate_tree_sha,passed:m.passed,
    image_sha256:report.image_sha256,bundle_sha256:report.bundle_sha256,
    archive_sha256:report.archive_sha256,
    public_key_fingerprint_sha256:a.public_key_fingerprint_sha256,
    signature_sha256:hash(sig)};
}
export function qaEvidenceProposalId(proof:QaEvidenceProof){
  const stable=[proof.ticket_id,proof.qa_agent_id,proof.node_id,
    proof.candidate_head_sha,proof.candidate_tree_sha,
    proof.evidence_sha256,proof.signature_sha256,proof.passed?'PASS':'FAIL'];
  return 'qaev_'+hash(stable.join('\n'));
}
export function validatedStoredQaEvidence(value:any):QaEvidenceProof{
  const required=['evidence_sha256','evidence_ref','qa_agent_id','developer_agent_id',
    'node_id','ticket_id','baseline_sha','candidate_head_sha','candidate_tree_sha',
    'passed','image_sha256','bundle_sha256','archive_sha256',
    'public_key_fingerprint_sha256','signature_sha256'];
  if(!exactKeys(value,required)||!ID.test(value.qa_agent_id||'')||
     !ID.test(value.developer_agent_id||'')||!NODE.test(value.node_id||'')||
     !ID.test(value.ticket_id||'')||!SHA.test(value.baseline_sha||'')||
     !SHA.test(value.candidate_head_sha||'')||
     !SHA.test(value.candidate_tree_sha||'')||
     !HASH.test(value.evidence_sha256||'')||
     value.evidence_ref!=='sha256:'+value.evidence_sha256||
     !HASH.test(value.image_sha256||'')||
     !HASH.test(value.bundle_sha256||'')||
     !HASH.test(value.archive_sha256||'')||
     !HASH.test(value.public_key_fingerprint_sha256||'')||
     !HASH.test(value.signature_sha256||'')||
     typeof value.passed!=='boolean'||
     value.qa_agent_id===value.developer_agent_id)
    fail('QA_EVIDENCE_STORED_PROOF_INVALID');
  return value as QaEvidenceProof;
}
