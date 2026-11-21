import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {getOrCreateClaimIntent,hasPendingClaim,claimIntentPath,
  verifyClaimReceipt,closeClaimIntent} from '../v7/worker_claim_journal.ts';

const task={ticket_id:'ticket_crash',project_id:'project_example',
  repository:'example/project',branch_name:'ai/ticket_crash',
  baseline_sha:'a'.repeat(40),version:5,status:'READY',worker_agent_id:null};
const input=(dir:string,extra:Record<string,unknown>={})=>({
  dir,task:{...task,...extra},agentId:'agent_alpha',
  scope:['src/code.ts'],epoch:11
});
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sut-claim-test-'));

test('claim attempt survives lost response, preserves exact request ID and receipt',()=>{
  const dir=temp();
  try{
    const first=getOrCreateClaimIntent(input(dir));
    assert.equal(first.replayed,false);
    assert.equal(hasPendingClaim(dir,task.ticket_id),true);
    assert.equal(first.body.expected_version,5);
    assert.equal(first.body.expected_master_epoch,11);
    const second=getOrCreateClaimIntent(input(dir,{status:'CLAIMED',
      worker_agent_id:'agent_alpha',version:6}));
    assert.equal(second.replayed,true);
    assert.deepEqual(second.body,first.body);
    assert.equal(second.file,claimIntentPath(dir,task.ticket_id));
    const proof={accepted:true,ticket_id:task.ticket_id,epoch:11,
      lease_id:'11111111-1111-4111-8111-111111111111',lease_seconds:600};
    assert.equal(verifyClaimReceipt(second.body,proof),proof.lease_id);
    closeClaimIntent(second.file,second.body);
    assert.equal(hasPendingClaim(dir,task.ticket_id),false);
    assert.throws(()=>getOrCreateClaimIntent(input(dir,{status:'CLAIMED',
      worker_agent_id:'agent_alpha',version:6})),/CLAIM_NEW_REQUEST_NOT_ALLOWED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('never replays stale epoch, new identity, changed branch or stolen claim',()=>{
  const dir=temp();
  try{
    const first=getOrCreateClaimIntent(input(dir));
    assert.throws(()=>getOrCreateClaimIntent({...input(dir),epoch:12}),
      /CLAIM_PENDING_RECONCILIATION_REQUIRED/);
    assert.throws(()=>getOrCreateClaimIntent({...input(dir),agentId:'agent_other'}),
      /CLAIM_PENDING_RECONCILIATION_REQUIRED/);
    assert.throws(()=>getOrCreateClaimIntent(input(dir,{branch_name:'ai/different'})),
      /CLAIM_PENDING_RECONCILIATION_REQUIRED/);
    assert.throws(()=>getOrCreateClaimIntent(input(dir,{status:'CLAIMED',
      worker_agent_id:'agent_other'})),/CLAIM_REMOTE_STATE_CHANGED/);
    assert.throws(()=>getOrCreateClaimIntent(input(dir,{status:'DONE'})),
      /CLAIM_REMOTE_STATE_CHANGED/);
    assert.throws(()=>verifyClaimReceipt(first.body,{accepted:true,
      ticket_id:task.ticket_id,epoch:12,lease_id:'not-a-lease',lease_seconds:600}),
      /CLAIM_RECEIPT_MISMATCH/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('partial or corrupted journal fails closed instead of generating a new claim',()=>{
  const dir=temp();
  try{
    const first=getOrCreateClaimIntent(input(dir));
    const orig=JSON.parse(fs.readFileSync(first.file,'utf8'));
    orig.body.request_id='claim_rewritten';
    fs.writeFileSync(first.file,JSON.stringify(orig));
    assert.throws(()=>getOrCreateClaimIntent(input(dir)),/CLAIM_JOURNAL_DIGEST_INVALID/);
    assert.throws(()=>closeClaimIntent(first.file,first.body),/CLAIM_JOURNAL_DIGEST_INVALID/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('exclusive journal create prevents concurrent claim IDs for a ticket',()=>{
  const dir=temp();
  try{
    const a=getOrCreateClaimIntent(input(dir));
    const b=getOrCreateClaimIntent(input(dir));
    assert.equal(a.body.request_id,b.body.request_id);
    assert.equal(b.replayed,true);
    assert.ok(fs.statSync(a.file).size>0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
