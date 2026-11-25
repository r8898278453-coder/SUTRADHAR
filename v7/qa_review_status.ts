/**
 * Validate signed Central's device-bound, read-only QA Owner review snapshot.
 * Review APPROVED is not the same as an accepted QA receipt, Git publication,
 * production code signing or installation acceptance.
 */
import {ID_RE,SHA_RE} from './rules.ts';
const proposalRe=/^qaev_[a-f0-9]{64}$/;
const hashRe=/^[a-f0-9]{64}$/;
const fail=(code:string):never=>{throw Error(code);};
export function verifyQaReviewStatus(expected:{
  review_proposal_id:string;ticket_id:string;agent_id:string
},value:unknown){
  if(!ID_RE.test(expected.ticket_id)||!ID_RE.test(expected.agent_id)||
     !proposalRe.test(expected.review_proposal_id))
    fail('QA_REVIEW_STATUS_INPUT_INVALID');
  if(!value||typeof value!=='object'||Array.isArray(value))
    fail('QA_REVIEW_STATUS_INVALID');
  const p=value as Record<string,unknown>;
  if(p.review_proposal_id!==expected.review_proposal_id||
     p.ticket_id!==expected.ticket_id||p.qa_agent_id!==expected.agent_id||
     !['PENDING','APPROVED','DENIED'].includes(String(p.owner_review_state))||
     !['SUBMITTED_FOR_REVIEW','RECONCILIATION_REQUIRED','INTEGRATING','TEST_FAILED'].includes(String(p.task_status))||
     typeof p.candidate_head_sha!=='string'||!SHA_RE.test(p.candidate_head_sha)||
     typeof p.candidate_tree_sha!=='string'||!SHA_RE.test(p.candidate_tree_sha)||
     typeof p.evidence_sha256!=='string'||!hashRe.test(p.evidence_sha256)||
     typeof p.qa_receipt_recorded!=='boolean'||
     p.owner_review_required!==true||
     p.automatic_qa_approval_allowed!==false||
     p.automatic_qa_receipt_allowed!==false||
     p.git_published!==false)
    fail('QA_REVIEW_STATUS_INVALID');
  const next=p.qa_receipt_recorded?'RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY':
    p.owner_review_state==='PENDING'?'WAIT_FOR_OWNER_REVIEW':
    p.owner_review_state==='DENIED'?'STOP_OWNER_REVIEW_DENIED':
    p.task_status==='RECONCILIATION_REQUIRED'?
      'OWNER_RESTORE_QA_CANDIDATE_BEFORE_RECEIPT':
      'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE';
  if(p.manual_next_action!==next||
     (p.qa_receipt_recorded&&(
       p.owner_review_state!=='APPROVED'||!['INTEGRATING','TEST_FAILED'].includes(String(p.task_status))))||
     (!p.qa_receipt_recorded&&
       !['SUBMITTED_FOR_REVIEW','RECONCILIATION_REQUIRED'].includes(String(p.task_status))))
    fail('QA_REVIEW_STATUS_INVALID');
  return {review_proposal_id:p.review_proposal_id,ticket_id:p.ticket_id,
    owner_review_state:p.owner_review_state,qa_receipt_recorded:p.qa_receipt_recorded,
    manual_next_action:next,automatic_execution_allowed:false,git_published:false};
}
export function validQaReviewId(v:unknown){
  return typeof v==='string'&&proposalRe.test(v);
}
