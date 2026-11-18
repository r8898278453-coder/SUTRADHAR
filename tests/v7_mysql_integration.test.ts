import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import http from 'node:http';
import mysql from 'mysql2/promise';
import {once} from 'node:events';
import {app,shutdownV7ForTests} from '../v7/central.ts';
// Run only against disposable MySQL database. No mocking SQL, no production credentials.
const enabled=process.env.SUTRADHAR_RUN_V7_MYSQL_TEST==='1';
test('v7 MySQL HTTP post-bootstrap election, signed enrollment, replay, takeover and QA gates',{skip:!enabled},async()=>{
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
  async function edge(i:number,leaderEligible=true){
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
        'x-sutradhar-nonce':nonce,'x-sutradhar-signature':signature,
        'x-sutradhar-agent':agent_id},
        body:method==='POST'?body:undefined});
      return {code:r.status,body:await r.json() as any};
    }
    const reg=await signed('/v7/agents/register',{agent_id,capabilities:{}});
    assert.equal(reg.code,200,JSON.stringify(reg.body));
    await owner('APPROVE_AGENT',{agent_id,master_eligible:leaderEligible,qa_eligible:i>=2});
    const client={node_id,agent_id,signed,async heartbeat(epoch:number|null=0){
      sequence++;agentSeq++;
      return signed('/v7/nodes/heartbeat',{sequence,boot_id:'boot_test_'+i,expected_master_epoch:epoch,
        agents:[{agent_id,sequence:agentSeq,status:'IDLE'}]});}};
    nodes.push(client);return client;
  }
  try{
    process.env.SUTRADHAR_ALLOW_MIGRATIONS='true';
    // Refuse even an EMPTY DB until the exact database name and separate
    // operator acknowledgement match. This is not production authorization.
    delete process.env.SUTRADHAR_BOOTSTRAP_EMPTY_DB_APPROVED;
    delete process.env.SUTRADHAR_BOOTSTRAP_TARGET_DB;
    const notApproved=await post('/v7/owner/migrate',{},admin);
    assert.equal(notApproved.code,403,JSON.stringify(notApproved.body));
    assert.equal(notApproved.body.error_code,'SCHEMA_BOOTSTRAP_EXACT_TARGET_APPROVAL_REQUIRED');
    process.env.SUTRADHAR_BOOTSTRAP_EMPTY_DB_APPROVED='yes';
    process.env.SUTRADHAR_BOOTSTRAP_TARGET_DB='wrong_staging_database';
    const wrongTarget=await post('/v7/owner/migrate',{},admin);
    assert.equal(wrongTarget.code,403,JSON.stringify(wrongTarget.body));
    process.env.SUTRADHAR_BOOTSTRAP_TARGET_DB=process.env.DB_NAME!;
    const mig=await post('/v7/owner/migrate',{},admin);assert.equal(mig.code,200,JSON.stringify(mig.body));
    assert.equal(mig.body.bootstrap_only,true);
    assert.equal(mig.body.production_migration_approved,false);
    // A second migration request MUST fail closed on an initialized database.
    // CREATE IF NOT EXISTS is not a migration or drift-verification strategy.
    const repeated=await post('/v7/owner/migrate',{},admin);
    assert.equal(repeated.code,409,JSON.stringify(repeated.body));
    assert.equal(repeated.body.error_code,'SCHEMA_BOOTSTRAP_REQUIRES_EMPTY_DATABASE');
    // This test exercises a cluster that has *already passed* its initial 08:00 IST bootstrap.
    // Never depend on the GitHub runner's wall-clock time: if CI runs before 08:00 IST,
    // a new cluster correctly refuses the first election. The exact 08:00 boundary is
    // covered separately by deterministic tests/v7_rules.test.ts.
    // The disposable MySQL instance is dedicated to this test; never run on live data.
    const bootstrapDb=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try {
      await bootstrapDb.query('UPDATE v7_cluster SET bootstrapped_at=UTC_TIMESTAMP(3) WHERE singleton=1');
    } finally {await bootstrapDb.end();}
    const a=await edge(1),b=await edge(2),c=await edge(3),d=await edge(4,false);
    let h=await a.heartbeat();
    assert.equal(h.code,200,JSON.stringify(h.body));
    h=await b.heartbeat();assert.equal(h.code,200);
    h=await c.heartbeat();assert.equal(h.code,200);
    h=await d.heartbeat();assert.equal(h.code,200);
    // Maintenance eligibility comes from durable Central MySQL state, not
    // a self-declared Desktop status or a screenshot of cluster roles.
    const idleNode=await c.signed('/v7/nodes/me',undefined,'GET');
    assert.equal(idleNode.code,200,JSON.stringify(idleNode.body));
    assert.equal(idleNode.body.node_id,c.node_id);
    assert.equal(idleNode.body.agents.length,1);
    assert.equal(idleNode.body.agents[0].status,'IDLE');
    assert.equal(idleNode.body.agents[0].active_ticket,null);
    assert.ok(Number(idleNode.body.agents[0].heartbeat_age_seconds)<=180);
    assert.equal(Number(idleNode.body.agents[0].has_live_work_lease),0);
    assert.equal(Number(idleNode.body.agents[0].has_unreconciled_git_job),0);
    const cluster=await fetch(base+'/v7/cluster',{headers:{authorization:'Bearer '+admin}});
    const status=(await cluster.json() as any).cluster;
    assert.equal(status.master_agent_id,a.agent_id);assert.equal(status.backup1,b.agent_id);
    assert.equal(status.backup2,c.agent_id);
    // A legitimate long-running cluster has >300 historical audit events.
    // Their existence must not permanently prevent a healthy Master recovery.
    const auditDb=await mysql.createConnection({host:'127.0.0.1',
      port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try{
      const batch=Array.from({length:320},()=>['TEST_AUDIT_HISTORY','integration_test',Number(status.epoch)]);
      await auditDb.query('INSERT INTO v7_events(event_type,actor,epoch) VALUES '+
        batch.map(()=>'(?,?,?)').join(','),batch.flat());
    }finally{await auditDb.end();}
    const recovered=await a.signed('/v7/recovery',undefined,'GET');
    assert.equal(recovered.code,200,JSON.stringify(recovered.body));
    assert.equal(recovered.body.events.length,300,'Historical events are a bounded window');
    assert.ok(recovered.body.event_high_watermark>=320);
    assert.deepEqual(recovered.body.unresolved_git_jobs,[]);
    const pre=await a.signed('/v7/leadership/reconcile',{agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
      request_id:'rec_'+(++count),manifest_sha256:recovered.body.manifest_sha256});
    assert.equal(pre.code,200,JSON.stringify(pre.body));
    // Owner can save a short-lived intent for an IDLE noncritical PC,
    // but NEVER authorizes installer execution or cluster stop.
    const pilotPayload={plan_id:'plan_pilot_001',node_id:d.node_id,
      wave_id:'wave_pilot01',target_version:'7.1.0',
      offer_sha256:'e'.repeat(64),expected_epoch:Number(status.epoch)};
    const activeReject=await post('/v7/owner/command',{
      request_id:'role_reject_'+(++count),command:'PLAN_PC_UPDATE',
      payload:{...pilotPayload,plan_id:'plan_pilot_master',node_id:a.node_id}},admin);
    assert.equal(activeReject.code,409,'Current Master must never be planned for updates');
    const oldEpochReject=await post('/v7/owner/command',{
      request_id:'epoch_reject_'+(++count),command:'PLAN_PC_UPDATE',
      payload:{...pilotPayload,expected_epoch:Number(status.epoch)-1}},admin);
    assert.equal(oldEpochReject.code,409,'Stale Owner epoch cannot approve a maintenance intent');
    const planned=await owner('PLAN_PC_UPDATE',pilotPayload);
    assert.equal(planned.state.state,'INTENT_ONLY');
    assert.equal(planned.state.installer_execution_allowed,false);
    const signedPlan=await d.signed('/v7/nodes/maintenance',undefined,'GET');
    assert.equal(signedPlan.code,200,JSON.stringify(signedPlan.body));
    assert.equal(signedPlan.body.node_id,d.node_id);
    assert.equal(signedPlan.body.intent.plan_id,pilotPayload.plan_id);
    assert.equal(signedPlan.body.intent.state,'INTENT_ONLY');
    assert.equal(signedPlan.body.installer_execution_allowed,false);
    const adminPlans=await fetch(base+'/v7/owner/maintenance',{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(adminPlans.status,200);
    assert.ok((await adminPlans.json() as any[]).some(x=>x.plan_id===pilotPayload.plan_id));
    const parallelReject=await post('/v7/owner/command',{
      request_id:'plan_conflict_'+(++count),command:'PLAN_PC_UPDATE',
      payload:{...pilotPayload,plan_id:'plan_conflicting'}},admin);
    assert.equal(parallelReject.code,409,'Only one unexpired intent per PC is permitted');
    const drainStarted=await owner('START_PC_DRAIN',{plan_id:pilotPayload.plan_id});
    assert.equal(drainStarted.state.state,'DRAINING');
    assert.equal(drainStarted.state.new_claims_blocked,true);
    assert.equal(drainStarted.state.automatic_expiry,false);
    assert.equal(drainStarted.state.installer_execution_allowed,false);
    const inDrain=await d.signed('/v7/nodes/maintenance',undefined,'GET');
    assert.equal(inDrain.code,200);
    assert.equal(inDrain.body.intent.state,'DRAINING');
    assert.equal(inDrain.body.intent.fence_active,true);
    // Simulate the advisory five-minute plan deadline in disposable MySQL.
    // The durable drain fence MUST survive without automatically reopening work.
    const expiryDb=await mysql.createConnection({host:'127.0.0.1',
      port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try{
      await expiryDb.query('UPDATE v7_pc_maintenance_plans '+
        'SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE plan_id=?',
        [pilotPayload.plan_id]);
    }finally{await expiryDb.end();}
    const afterIntentExpiry=await d.signed('/v7/nodes/maintenance',undefined,'GET');
    assert.equal(afterIntentExpiry.code,200);
    assert.equal(afterIntentExpiry.body.intent.state,'DRAINING');
    assert.equal(afterIntentExpiry.body.intent.fence_active,true);
    const secondStart=await post('/v7/owner/command',{
      request_id:'drain_again_'+(++count),command:'START_PC_DRAIN',
      payload:{plan_id:pilotPayload.plan_id}},admin);
    assert.equal(secondStart.code,409);
    const finalDrain=await owner('FINALIZE_PC_DRAIN',{plan_id:pilotPayload.plan_id});
    assert.equal(finalDrain.state.state,'DRAINED');
    assert.equal(finalDrain.state.installer_execution_allowed,false);
    const signedDrained=await d.signed('/v7/nodes/maintenance',undefined,'GET');
    assert.equal(signedDrained.body.intent.state,'DRAINED');
    const recoveryPath='/v7/nodes/maintenance/recovery/'+pilotPayload.plan_id;
    const beforeCancellation=await d.signed(recoveryPath,undefined,'GET');
    assert.equal(beforeCancellation.code,200,JSON.stringify(beforeCancellation.body));
    assert.equal(beforeCancellation.body.cancellation_verified,false);
    assert.equal(beforeCancellation.body.any_active_fence,true);
    assert.equal(beforeCancellation.body.local_hold_release_allowed,false);
    const otherNodeDenied=await a.signed(recoveryPath,undefined,'GET');
    assert.equal(otherNodeDenied.code,404,'A node cannot inspect another PC historical maintenance plan');
    const deniedNewAgent=await d.signed('/v7/agents/register',
      {agent_id:'agent_fenced_registration',capabilities:{}});
    assert.equal(deniedNewAgent.code,423);
    assert.equal(deniedNewAgent.body.error_code,'PC_MAINTENANCE_FENCED');
    const deniedNewQA=await d.signed('/v7/tasks/qa-receipt',{
      request_id:'qa_fenced_'+(++count),agent_id:d.agent_id,
      ticket_id:'ticket_not_ready',
      candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
      evidence_ref:'sha256:fenced',evidence_sha256:'d'.repeat(64),passed:true});
    assert.equal(deniedNewQA.code,423);
    assert.equal(deniedNewQA.body.error_code,'PC_MAINTENANCE_FENCED');
    const deniedGitReserve=await d.signed('/v7/git/reserve',{
      request_id:'git_fenced_'+(++count),agent_id:d.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_not_ready'});
    assert.equal(deniedGitReserve.code,423);
    assert.equal(deniedGitReserve.body.error_code,'PC_MAINTENANCE_FENCED');
    await owner('CREATE_PROJECT',{project_id:'project_integration',display_name:'Integration Test',repository:'example/repo'});
    const plan=await a.signed('/v7/tasks/plan',{request_id:'plan_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_qa_test',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_qa_test',
      title:'Implement scoped change',description:'Change a file',risk:'LOW',
      write_scopes:['src/example.ts'],acceptance_criteria:['observable behavior']});
    assert.equal(plan.code,200,JSON.stringify(plan.body));
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_integration',agent_id:b.agent_id,can_develop:true});
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_integration',agent_id:c.agent_id,can_qa:true});
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_integration',agent_id:d.agent_id,can_develop:true});
    // Actual MySQL fencing: a formerly eligible idle PC cannot obtain
    // a new task lease, while normal unrelated agents keep operating.
    const blockedAvailability=await d.signed('/v7/tasks/available',undefined,'GET');
    assert.equal(blockedAvailability.code,423);
    assert.equal(blockedAvailability.body.error_code,'PC_MAINTENANCE_FENCED');
    const blockedClaim=await d.signed('/v7/tasks/claim',{
      request_id:'fenced_claim_'+(++count),agent_id:d.agent_id,
      ticket_id:'ticket_qa_test',expected_master_epoch:Number(status.epoch)});
    assert.equal(blockedClaim.code,423);
    assert.equal(blockedClaim.body.error_code,'PC_MAINTENANCE_FENCED');
    const canceled=await owner('CANCEL_PC_UPDATE',{plan_id:pilotPayload.plan_id});
    assert.equal(canceled.state.state,'CANCELLED');
    assert.equal(canceled.state.previously_fenced,true);
    const afterCancel=await d.signed('/v7/nodes/maintenance',undefined,'GET');
    assert.equal(afterCancel.code,200);
    assert.equal(afterCancel.body.intent,null);
    assert.equal(afterCancel.body.installer_execution_allowed,false);
    const cancellationProof=await d.signed(recoveryPath,undefined,'GET');
    assert.equal(cancellationProof.code,200,JSON.stringify(cancellationProof.body));
    assert.equal(cancellationProof.body.node_id,d.node_id);
    assert.equal(cancellationProof.body.plan_id,pilotPayload.plan_id);
    assert.equal(cancellationProof.body.wave_id,pilotPayload.wave_id);
    assert.equal(cancellationProof.body.offer_sha256,pilotPayload.offer_sha256);
    assert.equal(cancellationProof.body.state,'CANCELLED');
    assert.equal(cancellationProof.body.cancellation_verified,true);
    assert.equal(cancellationProof.body.any_active_fence,false);
    assert.equal(cancellationProof.body.any_active_maintenance_intent,false);
    assert.equal(cancellationProof.body.local_hold_release_allowed,false);
    assert.equal(cancellationProof.body.installer_execution_allowed,false);
    // A second, real disposable MySQL case: graceful draining preserves
    // work already claimed, blocks fresh claims, then finalizes only after
    // the old work is submitted and its lease is no longer live.
    const activePlanId='plan_active_worker_drain';
    const planForWork=await owner('PLAN_PC_UPDATE',{
      ...pilotPayload,plan_id:activePlanId});
    assert.equal(planForWork.state.state,'INTENT_ONLY');
    const dTicket=await a.signed('/v7/tasks/plan',{
      request_id:'plan_drain_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_drain_inflight',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_drain_inflight',
      title:'Graceful maintenance worker',description:'Verify existing lease can finish',
      risk:'LOW',write_scopes:['src/drain-worker.ts'],
      acceptance_criteria:['Submitted checkpoint before maintenance finalization']});
    assert.equal(dTicket.code,200,JSON.stringify(dTicket.body));
    const dLease=await d.signed('/v7/tasks/claim',{
      request_id:'drain_initial_claim_'+(++count),agent_id:d.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_drain_inflight'});
    assert.equal(dLease.code,200,JSON.stringify(dLease.body));
    const activeDrain=await owner('START_PC_DRAIN',{plan_id:activePlanId});
    assert.equal(activeDrain.state.state,'DRAINING');
    assert.equal(activeDrain.state.active_worker_leases_preserved,true);
    const premature=await post('/v7/owner/command',{
      request_id:'premature_drain_'+(++count),command:'FINALIZE_PC_DRAIN',
      payload:{plan_id:activePlanId}},admin);
    assert.equal(premature.code,409,'Live worker lease cannot be declared drained');
    const dCheckpoint=await d.signed('/v7/tasks/checkpoint',{
      request_id:'drain_checkpoint_'+(++count),agent_id:d.agent_id,
      ticket_id:'ticket_drain_inflight',lease_id:dLease.body.lease_id,
      expected_master_epoch:Number(status.epoch),
      summary:'Existing worker checkpoint saved after fencing',
      next_action:'Submit for independent QA'});
    assert.equal(dCheckpoint.code,200,JSON.stringify(dCheckpoint.body));
    const dSubmitted=await d.signed('/v7/tasks/submit',{
      request_id:'drain_submit_'+(++count),agent_id:d.agent_id,
      ticket_id:'ticket_drain_inflight',lease_id:dLease.body.lease_id,
      expected_master_epoch:Number(status.epoch),
      candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40)});
    assert.equal(dSubmitted.code,200,JSON.stringify(dSubmitted.body));
    // CI-only time injection: wait out a lingering lease without a real
    // 600-second sleep. DO NOT do this on any live Hostinger database.
    const finishDb=await mysql.createConnection({host:'127.0.0.1',
      port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try{
      await finishDb.query('UPDATE v7_leases SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE ticket_id=?',
        ['ticket_drain_inflight']);
    }finally{await finishDb.end();}
    const completedDrain=await owner('FINALIZE_PC_DRAIN',{plan_id:activePlanId});
    assert.equal(completedDrain.state.state,'DRAINED');
    assert.equal(completedDrain.state.installer_execution_allowed,false);
    const releaseAgain=await owner('CANCEL_PC_UPDATE',{plan_id:activePlanId});
    assert.equal(releaseAgain.state.previously_fenced,true);
    const claim=await b.signed('/v7/tasks/claim',{request_id:'claim_'+(++count),agent_id:b.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_qa_test'});
    assert.equal(claim.code,200,JSON.stringify(claim.body));
    const workingNode=await b.signed('/v7/nodes/me',undefined,'GET');
    assert.equal(workingNode.code,200,JSON.stringify(workingNode.body));
    assert.equal(Number(workingNode.body.agents[0].has_live_work_lease),1,
      'Worker with a live ticket lease is never maintenance-idle');
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

    // Test-only fault injection against disposable MySQL: force expired Master,
    // without waiting 180 seconds and without changing the production clock.
    const db=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try {
      await db.query('UPDATE v7_cluster SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE singleton=1');
      await db.query('UPDATE v7_agents SET last_seen=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 400 SECOND) WHERE agent_id=?',
        [a.agent_id]);
      const staleNode=await a.signed('/v7/nodes/me',undefined,'GET');
      assert.equal(staleNode.code,200,JSON.stringify(staleNode.body));
      assert.ok(Number(staleNode.body.agents[0].heartbeat_age_seconds)>=399,
        'Maintenance read endpoint must use MySQL server clock, not local uptime');
      const promoted=await b.heartbeat(Number(status.epoch));
      assert.equal(promoted.code,200,JSON.stringify(promoted.body));
      assert.equal(promoted.body.master_agent_id,b.agent_id);
      assert.equal(promoted.body.phase,'RECOVERING');
      assert.equal(Number(promoted.body.epoch),Number(status.epoch)+1);
      // Uncertain external Git publication is NOT a work lease: it must still
      // block recovery. Simulated SQL effects are confined to this disposable DB.
      await db.query('INSERT INTO v7_git_jobs(ticket_id,agent_id,epoch,request_id,state) VALUES(?,?,?,?,"RUNNING")',
        ['ticket_qa_test',b.agent_id,Number(status.epoch),'test_uncertain_git']);
      const uncertain=await b.signed('/v7/recovery',undefined,'GET');
      assert.equal(uncertain.code,200,JSON.stringify(uncertain.body));
      assert.equal(uncertain.body.unresolved_git_jobs.length,1);
      const rejectGit=await b.signed('/v7/leadership/reconcile',{
        agent_id:b.agent_id,expected_master_epoch:Number(promoted.body.epoch),
        request_id:'reject_uncertain_git_'+(++count),
        manifest_sha256:uncertain.body.manifest_sha256});
      assert.equal(rejectGit.code,423,JSON.stringify(rejectGit.body));
      // A new Master may never infer that a remote Git write was safe to retry.
      assert.ok(['TASK_RECONCILIATION_REQUIRED','GIT_RECONCILIATION_REQUIRED'].includes(
        rejectGit.body.error_code));
      const oldMaster=await a.signed('/v7/tasks/plan',{request_id:'oldmaster_'+(++count),
        agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
        ticket_id:'ticket_stale_master',project_id:'project_integration',
        baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_stale_master',
        title:'Stale epoch',description:'Should never be accepted',risk:'LOW',
        write_scopes:['src/stale.ts'],acceptance_criteria:['Never create ticket']});
      assert.notEqual(oldMaster.code,200,'Former master must be fenced after failover');
      const oldClaim=await b.signed('/v7/tasks/checkpoint',{request_id:'oldlease_'+(++count),
        agent_id:b.agent_id,ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,
        expected_master_epoch:Number(status.epoch),summary:'illegal',next_action:'illegal'});
      assert.notEqual(oldClaim.code,200,'Old epoch worker lease must be fenced');
      const s=await fetch(base+'/v7/tasks',{headers:{authorization:'Bearer '+admin}});
      const tasks=await s.json() as any[];
      assert.equal(tasks.find(t=>t.ticket_id==='ticket_qa_test').status,'RECONCILIATION_REQUIRED');

      // Backup 2 must replace a failed Backup 1 and increment epoch exactly once.
      await db.query('UPDATE v7_cluster SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE singleton=1');
      await db.query('UPDATE v7_agents SET last_seen=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 400 SECOND) WHERE agent_id=?',
        [b.agent_id]);
      const fallback=await c.heartbeat(Number(promoted.body.epoch));
      assert.equal(fallback.code,200,JSON.stringify(fallback.body));
      assert.equal(fallback.body.master_agent_id,c.agent_id);
      assert.equal(Number(fallback.body.epoch),Number(promoted.body.epoch)+1);
    }finally{await db.end();}
    // Same Owner command + request ID must be one durable effect across concurrent retries.
    const same={request_id:'concurrent_duplicate',command:'PAUSE',payload:{}};
    const [once,together]=await Promise.all([
      post('/v7/owner/command',same,admin),post('/v7/owner/command',same,admin)]);
    assert.equal(once.code,200,JSON.stringify(once.body));
    assert.equal(together.code,200,JSON.stringify(together.body));
    assert.deepEqual(once.body,together.body);

  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await shutdownV7ForTests();}
});
