import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {planWorkerLeaseExtension,WORKER_LEASE_SECONDS,WORKER_MAX_ACTIVE_SECONDS}
  from '../v7/worker_lease_policy.ts';
import {getOrCreateRenewIntent,verifyRenewReceipt,closeRenewIntent}
  from '../v7/worker_lease_journal.ts';

const T=Date.parse('2026-11-19T00:00:00Z'),m=60*1000;
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sut-renew-'));
const payload=(dir:string,opts:Record<string,any>={})=>({
  dir,agent_id:'agent_renew',ticket_id:'ticket_renew',
  lease_id:'11111111-1111-4111-8111-111111111111',epoch:10,
  reason:'Reviewed checkpoint and continuing scoped implementation',...opts
});

test('bounded renewal accepts only a live, due worker lease and caps at four hours',()=>{
  const p=planWorkerLeaseExtension(T,T+10*m,T+4*m,'renew');
  assert.equal(p.expires_at_ms,T+14*m);
  assert.equal(p.seconds_remaining,WORKER_LEASE_SECONDS);
  assert.equal(p.absolute_deadline_ms,T+WORKER_MAX_ACTIVE_SECONDS*1000);
  assert.throws(()=>planWorkerLeaseExtension(T,T+10*m,T+m,'renew'),/WORKER_RENEWAL_NOT_DUE/);
  assert.throws(()=>planWorkerLeaseExtension(T,T+10*m,T+11*m,'renew'),/WORKER_LEASE_EXPIRED/);
  assert.throws(()=>planWorkerLeaseExtension(T,T+10*m,T-10,'renew'),/WORKER_LEASE_CLOCK_INVALID/);
});
test('checkpoint may extend early but neither checkpoint nor renew passes deadline',()=>{
  assert.equal(planWorkerLeaseExtension(T,T+10*m,T+m,'checkpoint').expires_at_ms,T+11*m);
  const late=planWorkerLeaseExtension(T,T+4*60*m-3*m,T+4*60*m-5*m,'renew');
  assert.equal(late.expires_at_ms,T+WORKER_MAX_ACTIVE_SECONDS*1000);
  assert.throws(()=>planWorkerLeaseExtension(T,T+4*60*m,T+4*60*m-20_000,'checkpoint'),
    /WORKER_RENEWAL_BUDGET_EXHAUSTED/);
  assert.throws(()=>planWorkerLeaseExtension(T,T+4*60*m,T+4*60*m,'renew'),
    /WORKER_LEASE_EXPIRED/);
});
test('ambiguous renewal uses original exact request ID, and does not trust stale response',()=>{
  const dir=tmp();
  try{
    const first=getOrCreateRenewIntent(payload(dir));
    assert.equal(first.replayed,false);
    const again=getOrCreateRenewIntent(payload(dir));
    assert.equal(again.replayed,true);
    assert.deepEqual(again.body,first.body);
    const receipt={accepted:true,agent_id:'agent_renew',ticket_id:'ticket_renew',
      lease_id:payload(dir).lease_id,epoch:10,
      automatic_execution_allowed:false,
      lease_expires_at:'2026-11-19T00:10:00.000Z',
      absolute_claim_deadline:'2026-11-19T04:00:00.000Z',
      lease_seconds_remaining:600};
    assert.doesNotThrow(()=>verifyRenewReceipt(again.body,receipt));
    assert.throws(()=>verifyRenewReceipt(again.body,{...receipt,epoch:11}),
      /RENEW_RECEIPT_MISMATCH/);
    assert.throws(()=>verifyRenewReceipt(again.body,{...receipt,automatic_execution_allowed:true}),
      /RENEW_RECEIPT_MISMATCH/);
    assert.throws(()=>getOrCreateRenewIntent(payload(dir,{epoch:11})),
      /RENEW_INTENT_PENDING_RECONCILIATION/);
    assert.throws(()=>getOrCreateRenewIntent(payload(dir,{reason:'Different reason requires operator review'})),
      /RENEW_INTENT_PENDING_RECONCILIATION/);
    closeRenewIntent(first.file,first.body);
    assert.equal(fs.existsSync(first.file),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('tampered durable renewal intent fails closed',()=>{
  const dir=tmp();
  try{
    const claim=getOrCreateRenewIntent(payload(dir));
    const bad=JSON.parse(fs.readFileSync(claim.file,'utf8'));
    bad.body.epoch=11;
    fs.writeFileSync(claim.file,JSON.stringify(bad));
    assert.throws(()=>getOrCreateRenewIntent(payload(dir)),
      /RENEW_INTENT_DIGEST_OR_FIELDS_INVALID/);
    assert.throws(()=>closeRenewIntent(claim.file,claim.body),
      /RENEW_INTENT_DIGEST_OR_FIELDS_INVALID/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
