import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {checkpointIntentPath,getOrCreateCheckpointIntent,
  verifyCheckpointReceipt,closeCheckpointIntent} from '../v7/worker_checkpoint_journal.ts';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sut-checkpoint-'));
const seed=(dir:string,extra:Record<string,unknown>={})=>({
  dir,agent_id:'agent_alpha',ticket_id:'ticket_checkpoint',
  lease_id:'11111111-1111-4111-8111-111111111111',epoch:11,
  summary:'Implementation saved at tested SHA',
  next_action:'Request independent review',...extra
});
const receipt=(b:any)=>({accepted:true,ticket_id:b.ticket_id,
  agent_id:b.agent_id,lease_id:b.lease_id,epoch:b.expected_master_epoch,
  automatic_execution_allowed:false,generation:3,version:8,
  content_sha256:crypto.createHash('sha256')
    .update(b.summary+'\n'+b.next_action).digest('hex'),
  lease_expires_at:'2026-11-22T13:00:00.000Z',
  absolute_claim_deadline:'2026-11-22T17:00:00.000Z',
  lease_seconds_remaining:600});
test('lost acknowledgement retries one durable request ID without creating another checkpoint',()=>{
  const dir=tmp();
  try{
    const first=getOrCreateCheckpointIntent(seed(dir));
    assert.equal(first.replayed,false);
    assert.match(first.body.request_id,/^checkpoint_[0-9a-f]{32}$/);
    const second=getOrCreateCheckpointIntent(seed(dir));
    assert.equal(second.replayed,true);
    assert.deepEqual(second.body,first.body);
    assert.equal(second.file,checkpointIntentPath(dir,'ticket_checkpoint'));
    assert.equal(fs.statSync(second.file).mode&0o077,0);
    const verified=verifyCheckpointReceipt(second.body,receipt(second.body));
    assert.equal(verified.generation,3);
    closeCheckpointIntent(second.file,second.body);
    assert.equal(fs.existsSync(second.file),false);
    const later=getOrCreateCheckpointIntent(seed(dir));
    assert.notEqual(later.body.request_id,first.body.request_id);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('pending checkpoint refuses changed summary, next action, epoch, identity and lease',()=>{
  const dir=tmp();
  try{
    getOrCreateCheckpointIntent(seed(dir));
    for(const update of [{summary:'Different code'}, {next_action:'Skip reviewer'},
      {epoch:12}, {agent_id:'agent_other'},
      {lease_id:'22222222-2222-4222-8222-222222222222'}]){
      assert.throws(()=>getOrCreateCheckpointIntent(seed(dir,update)),
        /CHECKPOINT_INTENT_PENDING_RECONCILIATION/);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('tampered and malformed local intents stay blocked',()=>{
  const dir=tmp();
  try{
    const first=getOrCreateCheckpointIntent(seed(dir));
    const altered=JSON.parse(fs.readFileSync(first.file,'utf8'));
    altered.body.summary='secretly changed';
    fs.writeFileSync(first.file,JSON.stringify(altered),{mode:0o600});
    assert.throws(()=>getOrCreateCheckpointIntent(seed(dir)),
      /CHECKPOINT_INTENT_DIGEST_INVALID/);
    assert.throws(()=>closeCheckpointIntent(first.file,first.body),
      /CHECKPOINT_INTENT_DIGEST_INVALID/);
    fs.writeFileSync(first.file,'{', {mode:0o600});
    assert.throws(()=>getOrCreateCheckpointIntent(seed(dir)),
      /CHECKPOINT_INTENT_CORRUPT/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid receipt and invalid checkpoint request cannot retire intent',()=>{
  const dir=tmp();
  try{
    for(const update of [{summary:'   '},{next_action:''},
      {next_action:'X'.repeat(501)},{epoch:0},{lease_id:'junk'}])
      assert.throws(()=>getOrCreateCheckpointIntent(seed(dir,update)),
        /CHECKPOINT_INTENT_INPUT_INVALID/);
    const first=getOrCreateCheckpointIntent(seed(dir));
    const valid=receipt(first.body);
    for(const mutated of [{automatic_execution_allowed:true},
      {agent_id:'agent_other'},{lease_id:'wrong'},{epoch:12},
      {generation:'3'}, {version:null}, {content_sha256:'f'.repeat(64)},
      {lease_seconds_remaining:0}]){
      assert.throws(()=>verifyCheckpointReceipt(first.body,{...valid,...mutated}),
        /CHECKPOINT_RECEIPT_MISMATCH/);
      assert.equal(fs.existsSync(first.file),true);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('symlinked checkpoint record is not trusted',()=>{
  const dir=tmp();
  try{
    const target=path.join(dir,'external.json');
    fs.writeFileSync(target,'{}',{mode:0o600});
    fs.symlinkSync(target,checkpointIntentPath(dir,'ticket_checkpoint'));
    assert.throws(()=>getOrCreateCheckpointIntent(seed(dir)),
      /CHECKPOINT_INTENT_FILE_UNTRUSTED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
