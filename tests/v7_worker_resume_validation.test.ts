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
 const remote={resume_allowed:true,ticket_id:'ticket123',agent_id:'agent123',epoch:4,
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
