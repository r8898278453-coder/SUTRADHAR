import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {journalEntryPresent,readStableJournal} from '../v7/journal_file.ts';
import {claimIntentPath,getOrCreateClaimIntent,hasPendingClaim} from '../v7/worker_claim_journal.ts';
import {checkpointIntentPath,getOrCreateCheckpointIntent} from '../v7/worker_checkpoint_journal.ts';
import {renewIntentPath,getOrCreateRenewIntent} from '../v7/worker_lease_journal.ts';
import {submitIntentPath,getOrCreateSubmitIntent,hasPendingSubmit} from '../v7/worker_submit_journal.ts';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sut-v7-journals-'));
const lease='11111111-1111-4111-8111-111111111111';
const cases=[
  {label:'claim',name:'claim',file:claimIntentPath,
   create:(dir:string)=>getOrCreateClaimIntent({dir,
     task:{ticket_id:'ticket_safe',project_id:'project_safe',
       repository:'example/repo',branch_name:'ai/ticket_safe',
       baseline_sha:'a'.repeat(40),version:1,status:'READY'},
     agentId:'agent_safe',scope:['src/change.ts'],epoch:7}),
   error:/CLAIM_JOURNAL_UNTRUSTED_FILE/},
  {label:'checkpoint',name:'checkpoint',file:checkpointIntentPath,
   create:(dir:string)=>getOrCreateCheckpointIntent({dir,
     agent_id:'agent_safe',ticket_id:'ticket_safe',lease_id:lease,
     epoch:7,summary:'Stored bounded progress',next_action:'Await independent QA'}),
   error:/CHECKPOINT_INTENT_FILE_UNTRUSTED/},
  {label:'renew',name:'renew',file:renewIntentPath,
   create:(dir:string)=>getOrCreateRenewIntent({dir,
     agent_id:'agent_safe',ticket_id:'ticket_safe',lease_id:lease,epoch:7,
     reason:'Operator checked current lease and needs continuation'}),
   error:/RENEW_INTENT_FILE_UNTRUSTED/},
  {label:'submit',name:'submit',file:submitIntentPath,
   create:(dir:string)=>getOrCreateSubmitIntent({dir,
     agent_id:'agent_safe',ticket_id:'ticket_safe',lease_id:lease,epoch:7,
     project_id:'project_safe',repository:'example/repo',
     branch_name:'ai/ticket_safe',baseline_sha:'a'.repeat(40),
     scope:['src/change.ts'],candidate_head_sha:'b'.repeat(40),
     candidate_tree_sha:'c'.repeat(40)}),
   error:/SUBMIT_INTENT_FILE_UNTRUSTED/}
] as const;
test('all four CLI journals reject dangling prior intent before generating a new ID',
  {skip:process.platform==='win32'},()=>{
    for(const x of cases){
      const dir=tmp();
      try{
        const file=x.file(dir,'ticket_safe');
        fs.symlinkSync(path.join(dir,'missing-original-intent'),file);
        assert.equal(fs.existsSync(file),false);
        assert.equal(journalEntryPresent(file),true);
        assert.throws(()=>x.create(dir),x.error,x.label);
        assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
      }finally{fs.rmSync(dir,{recursive:true,force:true});}
    }
  });
test('stable CLI reader rejects same-byte pathname replacement mid-read',()=>{
  const dir=tmp(),file=path.join(dir,'pending.json');
  try{
    const raw=Buffer.from('{"accepted":false,"intent":"keep"}\n');
    fs.writeFileSync(file,raw,{mode:0o600});
    let injected=false;
    const io={...fs,readSync:(...args:Parameters<typeof fs.readSync>)=>{
      const n=fs.readSync(...args);
      if(!injected){
        injected=true;
        fs.renameSync(file,path.join(dir,'original.json'));
        fs.writeFileSync(file,raw,{mode:0o600});
      }
      return n;
    }} as typeof fs;
    assert.throws(()=>readStableJournal(file,{maxBytes:128,io}),
      /JOURNAL_SNAPSHOT_CHANGED/);
    assert.equal(injected,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('stable CLI reader rejects in-place timestamp mutation, including equal-size payload',()=>{
  const dir=tmp(),file=path.join(dir,'pending.json');
  try{
    fs.writeFileSync(file,'{"intent":"pending"}\n',{mode:0o600});
    let injected=false;
    const io={...fs,readSync:(...args:Parameters<typeof fs.readSync>)=>{
      const n=fs.readSync(...args);
      if(!injected){
        injected=true;
        const st=fs.statSync(file);
        fs.utimesSync(file,new Date(st.atimeMs-3000),
          new Date(st.mtimeMs-3000));
      }
      return n;
    }} as typeof fs;
    assert.throws(()=>readStableJournal(file,{maxBytes:128,io}),
      /JOURNAL_SNAPSHOT_CHANGED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bounded private journal reader rejects oversized, public-mode, non-file and link',()=>{
  const dir=tmp(),file=path.join(dir,'pending.json');
  try{
    fs.writeFileSync(file,Buffer.alloc(130),{mode:0o600});
    assert.throws(()=>readStableJournal(file,{maxBytes:128}),/JOURNAL_SNAPSHOT_UNTRUSTED/);
    fs.writeFileSync(file,'{"ok":true}',{mode:0o666});
    if(process.platform!=='win32'){
      fs.chmodSync(file,0o644);
      assert.throws(()=>readStableJournal(file,{maxBytes:128,requirePrivate:true}),
        /JOURNAL_SNAPSHOT_UNTRUSTED/);
      fs.chmodSync(file,0o600);
      fs.renameSync(file,path.join(dir,'actual'));
      fs.symlinkSync(path.join(dir,'actual'),file);
      assert.throws(()=>readStableJournal(file,{maxBytes:128}),/JOURNAL_SNAPSHOT_UNTRUSTED/);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('original claim and submit one-shot intent APIs remain replay-compatible',()=>{
  const dir=tmp();
  try{
    const claim=cases[0].create(dir);
    const again=cases[0].create(dir);
    assert.equal(again.replayed,true);
    assert.deepEqual(again.body,claim.body);
    assert.equal(hasPendingClaim(dir,'ticket_safe'),true);
    const submit=cases[3].create(dir);
    assert.equal(cases[3].create(dir).replayed,true);
    assert.equal(hasPendingSubmit(dir,'ticket_safe'),true);
    assert.ok(fs.readFileSync(submit.file,'utf8').includes(submit.body.request_id));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
