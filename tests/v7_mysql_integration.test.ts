import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {app} from '../v7/central.ts';
// Run only against disposable MySQL database. No mocking SQL, no production credentials.
const enabled=process.env.SUTRADHAR_RUN_V7_MYSQL_TEST==='1';
test('v7 MySQL HTTP election, signed enrollment, replay, takeover and QA gates',{skip:!enabled},async()=>{
  const server=http.createServer(app);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('Bad server address');
  const base='http://127.0.0.1:'+addr.port;
  const admin=process.env.SUTRADHAR_ADMIN_KEY!;
  let count=0;
  async function post(path:string,payload:any,auth:string){
    const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth},
      body:JSON.stringify(payload)});
    return {code:res.status,body:await res.json() as any};
  }
  async function owner(command:string,payload:any){
    const r=await post('/v7/owner/command',{request_id:'req_'+(++count),command,payload},admin);
    assert.equal(r.code,200,JSON.stringify(r.body));return r.body;
  }
  const nodes=[] as any[];
  async function edge(i:number){
    const keys=crypto.generateKeyPairSync('ed25519');
    const node_id='node_test_'+i,agent_id='agent_test_'+i;
    const pub=keys.publicKey.export({format:'pem',type:'spki'}).toString();
    const proof=crypto.sign(null,Buffer.from('enroll:'+node_id),keys.privateKey).toString('base64');
    const e=await post('/v7/nodes/enroll',{node_id,public_key_pem:pub,proof,display_name:node_id},
      process.env.SUTRADHAR_ENROLLMENT_CODE!);
    assert.equal(e.code,200,JSON.stringify(e.body));
    await owner('APPROVE_NODE',{node_id});
    let sequence=0,agentSeq=0;
    async function signed(path:string,data:any,method='POST'){
      const body=method==='POST'?JSON.stringify(data):'';
      const ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
      const signed=[String(ts),nonce,method,path,crypto.createHash('sha256').update(body).digest('hex')].join('\n');
      const signature=crypto.sign(null,Buffer.from(signed),keys.privateKey).toString('base64');
      const r=await fetch(base+path,{method,headers:{'content-type':'application/json',
        'x-sutradhar-node':node_id,'x-sutradhar-timestamp':String(ts),
        'x-sutradhar-nonce':nonce,'x-sutradhar-signature':signature},
        body:method==='POST'?body:undefined});
      return {code:r.status,body:await r.json() as any};
    }
    const reg=await signed('/v7/agents/register',{agent_id,capabilities:{}});
    assert.equal(reg.code,200,JSON.stringify(reg.body));
    await owner('APPROVE_AGENT',{agent_id,master_eligible:true,qa_eligible:i>=2});
    const client={node_id,agent_id,signed,async heartbeat(epoch:number|null=0){
      sequence++;agentSeq++;
      return signed('/v7/nodes/heartbeat',{sequence,boot_id:'boot_test_'+i,expected_master_epoch:epoch,
        agents:[{agent_id,sequence:agentSeq,status:'IDLE'}]});}};
    nodes.push(client);return client;
  }
  try{
    process.env.SUTRADHAR_ALLOW_MIGRATIONS='true';
    const mig=await post('/v7/owner/migrate',{},admin);assert.equal(mig.code,200,JSON.stringify(mig.body));
    const a=await edge(1),b=await edge(2),c=await edge(3);
    let h=await a.heartbeat();
    assert.equal(h.code,200,JSON.stringify(h.body));
    h=await b.heartbeat();assert.equal(h.code,200);
    h=await c.heartbeat();assert.equal(h.code,200);
    const cluster=await fetch(base+'/v7/cluster',{headers:{authorization:'Bearer '+admin}});
    const status=(await cluster.json() as any).cluster;
    assert.equal(status.master_agent_id,a.agent_id);assert.equal(status.backup1,b.agent_id);
    assert.equal(status.backup2,c.agent_id);
    const recovered=await a.signed('/v7/recovery',undefined,'GET');
    assert.equal(recovered.code,200,JSON.stringify(recovered.body));
    const pre=await a.signed('/v7/leadership/reconcile',{agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
      request_id:'rec_'+(++count),manifest_sha256:recovered.body.manifest_sha256});
    assert.equal(pre.code,200,JSON.stringify(pre.body));
    await owner('CREATE_PROJECT',{project_id:'project_integration',display_name:'Integration Test',repository:'example/repo'});
    const plan=await a.signed('/v7/tasks/plan',{request_id:'plan_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_qa_test',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_qa_test',
      title:'Implement scoped change',description:'Change a file',risk:'LOW',
      write_scopes:['src/example.ts'],acceptance_criteria:['observable behavior']});
    assert.equal(plan.code,200,JSON.stringify(plan.body));
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_integration',agent_id:b.agent_id,can_develop:true});
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_integration',agent_id:c.agent_id,can_qa:true});
    const claim=await b.signed('/v7/tasks/claim',{request_id:'claim_'+(++count),agent_id:b.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_qa_test'});
    assert.equal(claim.code,200,JSON.stringify(claim.body));
    const attempted=await b.signed('/v7/tasks/submit',{request_id:'submit_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,
      expected_master_epoch:Number(status.epoch),
      candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40)});
    assert.equal(attempted.body.error_code,'CHECKPOINT_REQUIRED');
    const checkpoint=await b.signed('/v7/tasks/checkpoint',{request_id:'check_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch),
      summary:'completed and review pending',next_action:'independent QA'});
    assert.equal(checkpoint.code,200,JSON.stringify(checkpoint.body));
    const submitted=await b.signed('/v7/tasks/submit',{request_id:'submit2_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch),
      candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40)});
    assert.equal(submitted.code,200,JSON.stringify(submitted.body));
    const selfQA=await b.signed('/v7/tasks/qa-receipt',{request_id:'qa_self_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
      evidence_ref:'sha256:self',evidence_sha256:'d'.repeat(64),passed:true});
    assert.notEqual(selfQA.code,200);
    const qa=await c.signed('/v7/tasks/qa-receipt',{request_id:'qa_independent_'+(++count),agent_id:c.agent_id,
      ticket_id:'ticket_qa_test',candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
      evidence_ref:'sha256:independent',evidence_sha256:'d'.repeat(64),passed:true});
    assert.equal(qa.code,200,JSON.stringify(qa.body));
    const task=await fetch(base+'/v7/tasks',{headers:{authorization:'Bearer '+admin}});
    const list=await task.json() as any[];
    assert.equal(list.find(t=>t.ticket_id==='ticket_qa_test').status,'INTEGRATING');
    const wrong=await post('/v7/tasks/verify-merge',{request_id:'merge_'+(++count),ticket_id:'ticket_qa_test'},admin);
    assert.notEqual(wrong.code,200,'No fabricated GitHub merge without live verifiable evidence');
  }finally{server.close();}
});
