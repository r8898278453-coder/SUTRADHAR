import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {verifyQaReviewStatus,validQaReviewId} from '../v7/qa_review_status.ts';
const expected={ticket_id:'ticket_qa',agent_id:'agent_qa',
  review_proposal_id:'qaev_'+'a'.repeat(64)};
const proof=()=>({ticket_id:expected.ticket_id,qa_agent_id:expected.agent_id,
  review_proposal_id:expected.review_proposal_id,
  owner_review_state:'PENDING',task_status:'SUBMITTED_FOR_REVIEW',
  candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
  evidence_sha256:'d'.repeat(64),qa_receipt_recorded:false,
  manual_next_action:'WAIT_FOR_OWNER_REVIEW',owner_review_required:true,
  automatic_qa_approval_allowed:false,automatic_qa_receipt_allowed:false,
  git_published:false});
test('PENDING, APPROVED, DENIED and RECEIPT_RECORDED are distinct manual-only statuses',()=>{
  assert.equal(verifyQaReviewStatus(expected,proof()).manual_next_action,
    'WAIT_FOR_OWNER_REVIEW');
  assert.equal(verifyQaReviewStatus(expected,{...proof(),
    owner_review_state:'APPROVED',
    manual_next_action:'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE'}).qa_receipt_recorded,false);
  assert.equal(verifyQaReviewStatus(expected,{...proof(),owner_review_state:'DENIED',
    manual_next_action:'STOP_OWNER_REVIEW_DENIED'}).owner_review_state,'DENIED');
  assert.equal(verifyQaReviewStatus(expected,{...proof(),owner_review_state:'APPROVED',
    task_status:'INTEGRATING',qa_receipt_recorded:true,
    manual_next_action:'RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY'}).qa_receipt_recorded,true);
  assert.equal(validQaReviewId(expected.review_proposal_id),true);
  assert.equal(validQaReviewId('qaev_invalid'),false);
});
test('QA review cannot elevate permissions or mistake advanced task for unrecorded receipt',()=>{
  for(const change of [{qa_agent_id:'agent_other'},{ticket_id:'ticket_other'},
    {owner_review_state:'GRANTED'},{review_proposal_id:'qaev_'+'f'.repeat(64)},
    {candidate_head_sha:'e'},{candidate_tree_sha:'e'.repeat(39)},
    {evidence_sha256:'unknown'},{qa_receipt_recorded:'yes'},
    {automatic_qa_receipt_allowed:true},{automatic_qa_approval_allowed:true},
    {owner_review_required:false},{git_published:true},
    {task_status:'INTEGRATING'},{manual_next_action:'AUTO_ACCEPT'},
    {qa_receipt_recorded:true}])
    assert.throws(()=>verifyQaReviewStatus(expected,{...proof(),...change}),
      /QA_REVIEW_STATUS_INVALID/);
  assert.throws(()=>verifyQaReviewStatus(expected,null),/QA_REVIEW_STATUS_INVALID/);
  assert.throws(()=>verifyQaReviewStatus({...expected,review_proposal_id:'other'},proof()),
    /QA_REVIEW_STATUS_INPUT_INVALID/);
});
test('developer legacy QA CLI cannot issue hash-only QA receipt or invoke Docker',()=>{
  const code=fs.readFileSync(new URL('../v7/worker.ts',import.meta.url),'utf8');
  const section=code.split('async function qa(_id:string){')[1]?.split('async function qaReviewStatus')[0];
  assert.ok(section,'legacy QA command is an explicit fail-closed stub');
  assert.match(section,/QA_LEGACY_CLI_DISABLED_USE_PACKAGED_OWNER_REVIEW/);
  assert.doesNotMatch(section,/spawnSync|request\(|git\(/);
  assert.doesNotMatch(code,/request\('\/v7\/tasks\/qa-receipt'/);
});
