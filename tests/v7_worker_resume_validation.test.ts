import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyWorkerResume} from '../v7/worker_resume_validation.ts';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const lease='11111111-1111-4111-8111-111111111111';
function fixture(){
 const local={ticket_id:'ticket123',agent_id:'agent123',epoch:4,lease_id:lease,
   project_id:'proj123',repository:'sample/project',branch_name:'ai/ticket123',
   baseline_sha:'a'.repeat(40),scope:['src/file.ts'],worktree:'/tmp/work/ticket123'};
 const remote={resume_allowed:true,automatic_execution_allowed:false,
   ticket_id:'ticket123',agent_id:'agent123',lease_id:lease,epoch:4,
   project_id:'proj123',repository:'sample/project',branch_name:'ai/ticket123',
   baseline_sha:'a'.repeat(40),write_scopes:['src/file.ts'],status:'CHECKPOINTED',
   latest_checkpoint:{generation:2,summary:'saved',next_action:'continue',
     content_sha256:digest('saved\ncontinue')}};
 return {local,remote};
}
test('fresh signed Central lease and matching checkpoint permit manual-only resume',()=>{
 const {local,remote}=fixture();
 const result=verifyWorkerResume(local,remote,'agent123','ticket123');
 assert.equal(result.latest_checkpoint_generation,2);
 assert.equal(result.resume_allowed,true);
 assert.equal(result.automatic_execution_allowed,false);
});
test('different agent, stale epoch or wrong lease record fail closed',()=>{
 const x=fixture();
 assert.throws(()=>verifyWorkerResume(x.local,x.remote,'agent999','ticket123'));
 assert.throws(()=>verifyWorkerResume({...x.local,epoch:2},x.remote,'agent123','ticket123'));
 assert.throws(()=>verifyWorkerResume({...x.local,lease_id:'unknown'},x.remote,'agent123','ticket123'));
});
test('remote status, path scope, identity or checkpoint tampering is refused',()=>{
 const x=fixture();
 for(const r of [
   {...x.remote,status:'RECONCILIATION_REQUIRED'},
   {...x.remote,write_scopes:['other/file.ts']},
   {...x.remote,baseline_sha:'b'.repeat(40)},
   {...x.remote,resume_allowed:false},
   {...x.remote,latest_checkpoint:{...x.remote.latest_checkpoint,summary:'changed'}}
 ]) assert.throws(()=>verifyWorkerResume(x.local,r,'agent123','ticket123'));
});

test('resume proof must echo the exact lease and explicitly forbid automatic execution',()=>{
 const {local,remote}=fixture();
 for(const changed of [
   {lease_id:undefined},{lease_id:'22222222-2222-4222-8222-222222222222'},
   {lease_id:null},{automatic_execution_allowed:true},
   {automatic_execution_allowed:undefined},{resume_allowed:'true'}
 ])assert.throws(()=>verifyWorkerResume(local,{...remote,...changed},'agent123','ticket123'),
   /RESUME_LEASE_OR_IDENTITY_MISMATCH/);
 assert.throws(()=>verifyWorkerResume({...local,lease_id:'-'.repeat(36)},remote,
   'agent123','ticket123'),/RESUME_LEASE_OR_IDENTITY_MISMATCH/);
});
test('checkpoint generation must be a real positive safe integer, never coerced',()=>{
 const {local,remote}=fixture();
 for(const generation of ['2','02',null,0,-1,2.5,Number.MAX_SAFE_INTEGER+1,
   true,[],{},'Infinity']){
   const r={...remote,latest_checkpoint:{...remote.latest_checkpoint,generation}};
   assert.throws(()=>verifyWorkerResume(local,r,'agent123','ticket123'),
     /RESUME_CHECKPOINT_DIGEST_MISMATCH/);
 }
 for(const cp of [[],{},'not a checkpoint',
   {...remote.latest_checkpoint,content_sha256:'A'.repeat(64)},
   {...remote.latest_checkpoint,content_sha256:'a'.repeat(40)}]){
   assert.throws(()=>verifyWorkerResume(local,{...remote,latest_checkpoint:cp},
     'agent123','ticket123'),/RESUME_CHECKPOINT_DIGEST_MISMATCH/);
 }
});
test('no checkpoint remains a valid manual-only lease preflight',()=>{
 const {local,remote}=fixture();
 const output=verifyWorkerResume(local,{...remote,status:'CLAIMED',latest_checkpoint:null},
   'agent123','ticket123');
 assert.equal(output.latest_checkpoint_generation,null);
 assert.equal(output.automatic_execution_allowed,false);
});

test('checkpointed and QA-failed tickets cannot resume with missing checkpoint proof',()=>{
 const {local,remote}=fixture();
 for(const status of ['CHECKPOINTED','TEST_FAILED']){
   for(const latest_checkpoint of [null,undefined])
     assert.throws(()=>verifyWorkerResume(local,{...remote,status,latest_checkpoint},
       'agent123','ticket123'),/RESUME_CHECKPOINT_REQUIRED/);
 }
});
