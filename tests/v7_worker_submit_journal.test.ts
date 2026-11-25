import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {getOrCreateSubmitIntent,hasPendingSubmit,submitIntentPath,
  verifySubmitReceipt,verifySubmitObservation,closeSubmitIntent}
  from '../v7/worker_submit_journal.ts';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sut-submit-'));
const data=(dir:string,extra:Record<string,unknown>={})=>({
  dir,agent_id:'agent_worker',ticket_id:'ticket_code',
  lease_id:'11111111-1111-4111-8111-111111111111',epoch:7,
  project_id:'project_code',repository:'acme/target',
  branch_name:'ai/ticket_code',baseline_sha:'a'.repeat(40),
  scope:['src/work.ts'],candidate_head_sha:'b'.repeat(40),
  candidate_tree_sha:'c'.repeat(40),...extra
});
function receipt(b:any){return {accepted:true,automatic_execution_allowed:false,
  status:'SUBMITTED_FOR_REVIEW',ticket_id:b.ticket_id,agent_id:b.agent_id,
  lease_id:b.lease_id,epoch:b.expected_master_epoch,version:12,
  candidate_head_sha:b.candidate_head_sha,candidate_tree_sha:b.candidate_tree_sha};}
function detail(b:any){return {ticket_id:b.ticket_id,worker_agent_id:b.agent_id,
  status:'SUBMITTED_FOR_REVIEW',version:12,project_id:'project_code',
  repository:'acme/target',branch_name:'ai/ticket_code',
  baseline_sha:'a'.repeat(40),candidate_head_sha:b.candidate_head_sha,
  candidate_tree_sha:b.candidate_tree_sha,
  latest_checkpoint:{generation:1,content_sha256:'f'.repeat(64)}};}
function observe(b:any,remote:any=detail(b),version=12){
  return verifySubmitObservation({body:b,remote,version,project_id:'project_code',
    repository:'acme/target',branch_name:'ai/ticket_code',baseline_sha:'a'.repeat(40)});
}
test('lost-response retries exact local candidate and request ID, then confirms Central',()=>{
  const dir=tmp();
  try{
    const first=getOrCreateSubmitIntent(data(dir));
    assert.equal(first.replayed,false);
    assert.equal(hasPendingSubmit(dir,'ticket_code'),true);
    assert.equal(fs.statSync(first.file).mode&0o077,0);
    const second=getOrCreateSubmitIntent(data(dir));
    assert.equal(second.replayed,true);
    assert.deepEqual(second.body,first.body);
    const verifiedVersion=verifySubmitReceipt(second.body,receipt(second.body));
    assert.equal(observe(second.body,detail(second.body),verifiedVersion),true);
    closeSubmitIntent(second.file,second.body);
    assert.equal(hasPendingSubmit(dir,'ticket_code'),false);
    const next=getOrCreateSubmitIntent(data(dir));
    assert.notEqual(next.body.request_id,first.body.request_id);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('changed Git commit/tree, context, agent, lease and epoch cannot reuse pending intent',()=>{
  const dir=tmp();
  try{
    getOrCreateSubmitIntent(data(dir));
    for(const mutation of [
      {candidate_head_sha:'d'.repeat(40)},{candidate_tree_sha:'e'.repeat(40)},
      {branch_name:'ai/different'},{baseline_sha:'f'.repeat(40)},
      {project_id:'project_other'},{repository:'acme/other'},
      {scope:['src/other.ts']},{agent_id:'agent_other'},
      {lease_id:'22222222-2222-4222-8222-222222222222'},{epoch:8}
    ])assert.throws(()=>getOrCreateSubmitIntent(data(dir,mutation)),
      /SUBMIT_INTENT_PENDING_RECONCILIATION/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('tampered, missing or symlinked intent cannot pass as a known retry',()=>{
  const dir=tmp();
  try{
    const first=getOrCreateSubmitIntent(data(dir));
    const altered=JSON.parse(fs.readFileSync(first.file,'utf8'));
    altered.body.candidate_head_sha='d'.repeat(40);
    fs.writeFileSync(first.file,JSON.stringify(altered));
    assert.throws(()=>getOrCreateSubmitIntent(data(dir)),
      /SUBMIT_INTENT_DIGEST_OR_FIELDS_INVALID/);
    assert.throws(()=>closeSubmitIntent(first.file,first.body),
      /SUBMIT_INTENT_DIGEST_OR_FIELDS_INVALID/);
    fs.rmSync(first.file);
    const external=path.join(dir,'outside.json');
    fs.writeFileSync(external,'{}');
    fs.symlinkSync(external,submitIntentPath(dir,'ticket_code'));
    assert.throws(()=>hasPendingSubmit(dir,'ticket_code'),/SUBMIT_INTENT_FILE_UNTRUSTED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('receipt mismatch never proves accepted submission',()=>{
  const dir=tmp();
  try{
    const p=getOrCreateSubmitIntent(data(dir));
    for(const change of [
      {accepted:false},{automatic_execution_allowed:true},{status:'DONE'},
      {agent_id:'agent_else'},{lease_id:'other'},{epoch:8},
      {candidate_head_sha:'e'.repeat(40)},{candidate_tree_sha:'e'.repeat(40)},
      {version:'12'}
    ])assert.throws(()=>verifySubmitReceipt(p.body,{...receipt(p.body),...change}),
      /SUBMIT_RECEIPT_MISMATCH/);
    assert.equal(fs.existsSync(p.file),true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('read-only Central detail must match status, immutable origin and exact candidate',()=>{
  const dir=tmp();
  try{
    const p=getOrCreateSubmitIntent(data(dir));
    for(const change of [
      {status:'INTEGRATING'},{version:13},{worker_agent_id:'agent_else'},
      {repository:'acme/wrong'},{baseline_sha:'e'.repeat(40)},
      {branch_name:'ai/changed'},{candidate_head_sha:'d'.repeat(40)},
      {candidate_tree_sha:'e'.repeat(40)},{latest_checkpoint:null}
    ])assert.throws(()=>observe(p.body,{...detail(p.body),...change}),
      /SUBMIT_REMOTE_PROOF_MISMATCH/);
    assert.equal(fs.existsSync(p.file),true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('malformed IDs, Git SHAs and scope fail before any submission journal',()=>{
  const dir=tmp();
  try{
    for(const change of [{ticket_id:'../invalid'},{candidate_head_sha:'0'.repeat(39)},
      {candidate_tree_sha:'0'},{lease_id:'--'.repeat(18)},
      {epoch:0},{scope:['.env']},{scope:['src/work.ts','src/work.ts']}])
      assert.throws(()=>getOrCreateSubmitIntent(data(dir,change)),
        /SUBMIT_INTENT_INPUT_INVALID|SUBMIT_INTENT_PATH_INVALID/);
    assert.equal(fs.readdirSync(dir).length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
