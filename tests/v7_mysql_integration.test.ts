import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import http from 'node:http';
import mysql from 'mysql2/promise';
import {once} from 'node:events';
import {app,shutdownV7ForTests} from '../v7/central.ts';
import {verifyRecoverySnapshot} from '../v7/recovery_validation.ts';
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
    const node_id='node_'+i.toString(16).padStart(32,'0'),agent_id='agent_test_'+i;
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
    function signedQaPackage({ticketId,workerAgentId,baseline,head,tree,
      passed=true}:{ticketId:string;workerAgentId:string;baseline:string;
        head:string;tree:string;passed?:boolean}){
      // Cryptographic integration FIXTURE, not real Docker/Owner evidence.
      const h=(x:Buffer|string)=>crypto.createHash('sha256').update(x).digest('hex');
      const report={schema:1,status:'LOCAL_QA_TEST_ONLY',
        ticket_id:ticketId,qa_agent_id:agent_id,
        developer_agent_id:workerAgentId,
        baseline_sha:baseline,candidate_head_sha:head,candidate_tree_sha:tree,
        bundle_sha256:'a'.repeat(64),image_sha256:'b'.repeat(64),
        archive_sha256:'c'.repeat(64),recorded_at:new Date().toISOString(),
        test_passed:passed,sandbox_started:passed,exit_code:passed?0:1,
        stdout_sha256:h('fixture output'),stderr_sha256:h(''),
        stdout_tail:passed?'1 passed (fixture)':'1 failed (fixture)',
        stderr_tail:'',evidence_level:'LOCAL_UNATTESTED',
        qa_approved:false,qa_receipt_submitted:false,
        git_published:false,automatic_execution_allowed:false};
      const raw=Buffer.from(JSON.stringify(report)+'\n');
      const evidenceSha=h(raw);
      const message={schema:1,kind:'SUTRADHAR_INDEPENDENT_QA_EVIDENCE',
        node_id,agent_id,ticket_id:ticketId,
        candidate_head_sha:head,candidate_tree_sha:tree,
        evidence_sha256:evidenceSha,passed};
      const signature=crypto.sign(null,
        Buffer.from('SUTRADHAR_QA_EVIDENCE_V1\n'+JSON.stringify(message)),
        keys.privateKey).toString('base64');
      const attestation={schema:1,message,signature,
        public_key_fingerprint_sha256:h(keys.publicKey.export({format:'der',type:'spki'})),
        signed_by:'DEVICE_OS_VAULT_ED25519',
        qa_approved:false,central_qa_receipt_submitted:false};
      return {request_id:'qaevidence_fixture_'+(++count),agent_id,
        ticket_id:ticketId,evidence_base64:raw.toString('base64'),
        evidence_ref:'sha256:'+evidenceSha,attestation};
    }
    const client={node_id,agent_id,public_key_pem:pub,signed,signedQaPackage,async heartbeat(epoch:number|null=0){
      sequence++;agentSeq++;
      return signed('/v7/nodes/heartbeat',{sequence,boot_id:'boot_test_'+i,expected_master_epoch:epoch,
        agents:[{agent_id,sequence:agentSeq,status:'ONLINE'}]});}};
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
    // Explicit pilot mode records ONLY the accepted, real signed heartbeat.
    process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EVIDENCE='true';
    let h=await a.heartbeat();
    delete process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EVIDENCE;
    assert.equal(h.code,200,JSON.stringify(h.body));
    const proofPath='/v7/owner/heartbeat-evidence/'+a.node_id;
    const deniedProof=await fetch(base+proofPath);
    assert.equal(deniedProof.status,401,'heartbeat evidence is Owner-only');
    const acceptedProof=await fetch(base+proofPath,{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(acceptedProof.status,200);
    const heartbeatProof=await acceptedProof.json() as any;
    assert.equal(heartbeatProof.node_id,a.node_id);
    assert.equal(heartbeatProof.records.length,1);
    assert.equal(heartbeatProof.physical_machine_verified,false);
    assert.equal(heartbeatProof.production_release_authorized,false);
    const recorded=heartbeatProof.records[0],packet=recorded.payload;
    assert.equal(packet.node_id,a.node_id);
    assert.ok(Number.isSafeInteger(recorded.committed_at_ms));
    const rawPacket=Buffer.from(packet.body_base64,'base64');
    assert.equal(JSON.parse(rawPacket.toString()).sequence,1);
    const signedPacket=[String(packet.timestamp_ms),packet.nonce,'POST',
      '/v7/nodes/heartbeat',crypto.createHash('sha256').update(rawPacket).digest('hex')].join('\n');
    assert.equal(crypto.verify(null,Buffer.from(signedPacket),
      crypto.createPublicKey(a.public_key_pem),
      Buffer.from(packet.signature_base64,'base64')),true,
      'MySQL accepted event retains the original node-signed request');
    const usualAuditRes=await fetch(base+'/v7/audit',{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(usualAuditRes.status,200);
    const usualAudit=await usualAuditRes.json() as any[];
    assert.ok(!usualAudit.some(x=>x.event_type==='NODE_HEARTBEAT_ACCEPTED'),
      'Pilot packet evidence must not crowd normal Owner audit history');
    const originalMasterRecovery=await a.signed('/v7/recovery',undefined,'GET');
    assert.equal(originalMasterRecovery.code,200,
      JSON.stringify(originalMasterRecovery.body));
    assert.ok(!originalMasterRecovery.body.events.some(
      (x:any)=>x.event_type==='NODE_HEARTBEAT_ACCEPTED'),
      'High-volume pilot packets must never crowd Master recovery manifest');
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
    const anonymousQueue=await fetch(base+'/v7/owner/git-recovery');
    assert.equal(anonymousQueue.status,401,'Recovery queue is Owner-only');
    const emptyQueueResponse=await fetch(base+'/v7/owner/git-recovery',
      {headers:{authorization:'Bearer '+admin}});
    assert.equal(emptyQueueResponse.status,200);
    const emptyQueue=await emptyQueueResponse.json() as any;
    assert.equal(emptyQueue.phase,'RECOVERING');
    assert.equal(emptyQueue.master_live,true);
    assert.deepEqual(emptyQueue.unresolved_jobs,[]);
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
    // Exact same shared validator is bundled in the packaged Windows agent:
    // full 300 recent events are legal even with long-lived history.
    assert.equal(verifyRecoverySnapshot(recovered.body,Number(status.epoch)),
      recovered.body.manifest_sha256);
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
    const invalidBranch=await a.signed('/v7/tasks/plan',{
      request_id:'invalid_branch_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_unpublishable',
      project_id:'project_integration',baseline_sha:'a'.repeat(40),
      branch_name:'ai/not/publishable',title:'Invalid work branch',
      description:'Never create a ticket that the Git publisher cannot publish',
      risk:'LOW',write_scopes:['src/alternate.ts'],
      acceptance_criteria:['must not become claimable']});
    assert.equal(invalidBranch.code,400,JSON.stringify(invalidBranch.body));
    assert.equal(invalidBranch.body.error_code,'INVALID_BRANCH');
    const protectedPlan=await a.signed('/v7/tasks/plan',{
      request_id:'protected_plan_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_protected_work',
      project_id:'project_integration',baseline_sha:'a'.repeat(40),
      branch_name:'ai/protected_work',title:'Sensitive desktop signer review',
      description:'Requested by task creator as LOW, Owner approval must be required',
      risk:'LOW',write_scopes:['apps/desktop/main.cjs'],
      acceptance_criteria:['must require Owner authorization']});
    assert.equal(protectedPlan.code,200,JSON.stringify(protectedPlan.body));
    assert.equal(protectedPlan.body.status,'WAITING_AUTHORIZATION');
    assert.equal(protectedPlan.body.owner_approval_required,true);
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
    const claimPayload={request_id:'claim_'+(++count),agent_id:b.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_qa_test'};
    const claim=await b.signed('/v7/tasks/claim',claimPayload);
    assert.equal(claim.code,200,JSON.stringify(claim.body));
    // Replaying the identical durable claim after a lost HTTP reply MUST
    // return the original lease, never create another lease or worktree.
    const recoveredClaim=await b.signed('/v7/tasks/claim',claimPayload);
    assert.equal(recoveredClaim.code,200,JSON.stringify(recoveredClaim.body));
    assert.deepEqual(recoveredClaim.body,claim.body);
    // Packaged heartbeats report ONLINE. Central must use authoritative
    // lease/ticket state, never allow ONLINE to erase an active assignment.
    const busyPulse=await b.heartbeat(Number(status.epoch));
    assert.equal(busyPulse.code,200,JSON.stringify(busyPulse.body));
    const busyNode=await b.signed('/v7/nodes/me',undefined,'GET');
    assert.equal(busyNode.code,200,JSON.stringify(busyNode.body));
    assert.equal(busyNode.body.agents[0].status,'BUSY');
    assert.equal(busyNode.body.agents[0].active_ticket,'ticket_qa_test');
    assert.equal(Number(busyNode.body.agents[0].has_live_work_lease),1);
    // Restart preflight is read-only and cannot renew, steal or replace a lease.
    const resumeProof=await b.signed('/v7/tasks/resume-check',{
      agent_id:b.agent_id,ticket_id:'ticket_qa_test',
      lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch)});
    assert.equal(resumeProof.code,200,JSON.stringify(resumeProof.body));
    assert.equal(resumeProof.body.resume_allowed,true);
    assert.equal(resumeProof.body.automatic_execution_allowed,false);
    assert.equal(resumeProof.body.status,'CLAIMED');
    const invalidResume=await b.signed('/v7/tasks/resume-check',{
      agent_id:b.agent_id,ticket_id:'ticket_qa_test',
      lease_id:'00000000-0000-4000-8000-000000000000',expected_master_epoch:Number(status.epoch)});
    assert.equal(invalidResume.code,403,'Wrong local lease cannot restart a worker');
    const otherAgentResume=await c.signed('/v7/tasks/resume-check',{
      agent_id:c.agent_id,ticket_id:'ticket_qa_test',
      lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch)});
    assert.notEqual(otherAgentResume.code,200,'Another PC cannot inherit a worker lease');
    const workingNode=await b.signed('/v7/nodes/me',undefined,'GET');
    assert.equal(workingNode.code,200,JSON.stringify(workingNode.body));
    assert.equal(Number(workingNode.body.agents[0].has_live_work_lease),1,
      'Worker with a live ticket lease is never maintenance-idle');
    // The new explicit renewal does not trust client wall clocks, fresh claims
    // with >7 minutes remaining, unapproved agents, or expired Master epochs.
    // CI-only SQL fault injection below uses ONLY disposable MySQL.
    const renewBody={request_id:'renew_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,
      expected_master_epoch:Number(status.epoch),
      reason:'Manual progress check after approved task claim'};
    const leaseEarlyResponse=await b.signed('/v7/tasks/renew-lease',renewBody);
    assert.equal(leaseEarlyResponse.code,409,JSON.stringify(leaseEarlyResponse.body));
    assert.equal(leaseEarlyResponse.body.error_code,'WORKER_RENEWAL_NOT_DUE');
    const leaseTestDb=await mysql.createConnection({host:'127.0.0.1',
      port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try{
      await leaseTestDb.query('UPDATE v7_leases SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND) WHERE ticket_id=?',
        ['ticket_qa_test']);
      const leaseAcceptedResponse=await b.signed('/v7/tasks/renew-lease',renewBody);
      assert.equal(leaseAcceptedResponse.code,200,JSON.stringify(leaseAcceptedResponse.body));
      assert.equal(leaseAcceptedResponse.body.accepted,true);
      assert.equal(leaseAcceptedResponse.body.automatic_execution_allowed,false);
      assert.equal(leaseAcceptedResponse.body.lease_id,claim.body.lease_id);
      assert.ok(leaseAcceptedResponse.body.lease_seconds_remaining<=600);
      assert.ok(leaseAcceptedResponse.body.lease_seconds_remaining>400);
      const leaseReplayResponse=await b.signed('/v7/tasks/renew-lease',renewBody);
      assert.equal(leaseReplayResponse.code,200,JSON.stringify(leaseReplayResponse.body));
      assert.deepEqual(leaseReplayResponse.body,leaseAcceptedResponse.body,
        'Lost renewal reply reuses exact Central idempotent receipt');
      const leaseSecondResponse=await b.signed('/v7/tasks/renew-lease',{
        ...renewBody,request_id:'renew_too_early_'+(++count)});
      assert.equal(leaseSecondResponse.code,409,JSON.stringify(leaseSecondResponse.body));
      assert.equal(leaseSecondResponse.body.error_code,'WORKER_RENEWAL_NOT_DUE');
      const leaseOtherPcResponse=await c.signed('/v7/tasks/renew-lease',{
        ...renewBody,agent_id:c.agent_id,request_id:'renew_other_pc_'+(++count)});
      assert.notEqual(leaseOtherPcResponse.code,200,'QA PC may not renew somebody else\'s task');
      await leaseTestDb.query('UPDATE v7_tickets SET updated_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 4 HOUR) WHERE ticket_id=?',
        ['ticket_qa_test']);
      await leaseTestDb.query('UPDATE v7_leases SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND) WHERE ticket_id=?',
        ['ticket_qa_test']);
      const leaseBudgetResponse=await b.signed('/v7/tasks/renew-lease',{
        ...renewBody,request_id:'renew_exhausted_'+(++count)});
      assert.equal(leaseBudgetResponse.code,409,JSON.stringify(leaseBudgetResponse.body));
      assert.equal(leaseBudgetResponse.body.error_code,'WORKER_RENEWAL_BUDGET_EXHAUSTED');
      const leaseBudgetCheckpointResponse=await b.signed('/v7/tasks/checkpoint',{
        request_id:'checkpoint_exhausted_'+(++count),agent_id:b.agent_id,
        ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,
        expected_master_epoch:Number(status.epoch),
        summary:'Attempted checkpoint after expired claim work budget',
        next_action:'Stop and request Owner reconciliation'});
      assert.equal(leaseBudgetCheckpointResponse.code,409,JSON.stringify(leaseBudgetCheckpointResponse.body));
      assert.equal(leaseBudgetCheckpointResponse.body.error_code,'WORKER_RENEWAL_BUDGET_EXHAUSTED');
    }finally{
      await leaseTestDb.query('UPDATE v7_tickets SET updated_at=UTC_TIMESTAMP(3) WHERE ticket_id=?',
        ['ticket_qa_test']);
      await leaseTestDb.query('UPDATE v7_leases SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND) WHERE ticket_id=?',
        ['ticket_qa_test']);
      await leaseTestDb.end();
    }
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
    // Two different agent IDs on the SAME physical enrolled node are NOT
    // independent QA. Central must compare approved node IDs too.
    const samePcQa='agent_qa_samepc';
    const registeredSamePc=await b.signed('/v7/agents/register',{
      agent_id:samePcQa,capabilities:{qa:true}});
    assert.equal(registeredSamePc.code,200,JSON.stringify(registeredSamePc.body));
    await owner('APPROVE_AGENT',{agent_id:samePcQa,qa_eligible:true,master_eligible:false});
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_integration',
      agent_id:samePcQa,can_qa:true,can_develop:false});
    const sameDeviceDenied=await b.signed('/v7/tasks/qa-evidence',{
      request_id:'qaevidence_samepc_'+(++count),
      agent_id:samePcQa,ticket_id:'ticket_qa_test'});
    assert.equal(sameDeviceDenied.code,403,JSON.stringify(sameDeviceDenied.body));
    assert.equal(sameDeviceDenied.body.error_code,'QA_DEVICE_NOT_INDEPENDENT');
    const selfQA=await b.signed('/v7/tasks/qa-receipt',{request_id:'qa_self_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
      evidence_ref:'sha256:self',evidence_sha256:'d'.repeat(64),passed:true});
    assert.notEqual(selfQA.code,200);
    const legacyHashOnly=await c.signed('/v7/tasks/qa-receipt',{
      request_id:'qa_legacy_'+(++count),agent_id:c.agent_id,ticket_id:'ticket_qa_test',
      candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
      evidence_ref:'sha256:'+'d'.repeat(64),evidence_sha256:'d'.repeat(64),passed:true});
    assert.equal(legacyHashOnly.code,403,JSON.stringify(legacyHashOnly.body));
    assert.equal(legacyHashOnly.body.error_code,'QA_VERIFIED_REVIEW_REQUIRED');
    const proof=c.signedQaPackage({ticketId:'ticket_qa_test',
      workerAgentId:b.agent_id,baseline:'a'.repeat(40),
      head:'b'.repeat(40),tree:'c'.repeat(40)});
    const forged=structuredClone(proof);
    forged.attestation.message.passed=false;
    const deniedForgery=await c.signed('/v7/tasks/qa-evidence',{
      ...forged,request_id:'qaevidence_forged_'+(++count)});
    assert.notEqual(deniedForgery.code,200,'Wrong signed QA passed flag is rejected');
    const wrongNode=structuredClone(proof);
    wrongNode.attestation.message.node_id=b.node_id;
    const deniedNode=await c.signed('/v7/tasks/qa-evidence',{
      ...wrongNode,request_id:'qaevidence_wrong_node_'+(++count)});
    assert.notEqual(deniedNode.code,200,'Device signature must match enrolled node');
    const verified=await c.signed('/v7/tasks/qa-evidence',proof);
    assert.equal(verified.code,200,JSON.stringify(verified.body));
    assert.equal(verified.body.device_signature_verified,true);
    assert.equal(verified.body.qa_approved,false);
    assert.equal(verified.body.status,'PENDING_OWNER_REVIEW');
    const reviewedId=verified.body.review_proposal_id;
    assert.match(reviewedId,/^qaev_[0-9a-f]{64}$/);
    const anonQaQueue=await fetch(base+'/v7/owner/qa-reviews');
    assert.equal(anonQaQueue.status,401,'QA review queue is Owner-only');
    const ownerQaQueue=await fetch(base+'/v7/owner/qa-reviews',{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(ownerQaQueue.status,200);
    const queue=(await ownerQaQueue.json() as any);
    const item=queue.reviews.find((z:any)=>z.review_proposal_id===reviewedId);
    assert.ok(item,'Owner can locate exact pending signed QA evidence review');
    assert.equal(item.candidate_head_sha,'b'.repeat(40));
    assert.equal(item.qa_agent_id,c.agent_id);
    assert.equal(item.node_id,c.node_id);
    assert.equal(item.state,'PENDING');
    assert.equal(queue.qa_approved_automatically,false);
    const verifiedAgain=await c.signed('/v7/tasks/qa-evidence',proof);
    assert.deepEqual(verifiedAgain,verified,'A lost upload response replays exact receipt');
    const receiptBody={request_id:'qa_independent_'+(++count),agent_id:c.agent_id,
      ticket_id:'ticket_qa_test',candidate_head_sha:'b'.repeat(40),
      candidate_tree_sha:'c'.repeat(40),evidence_ref:proof.evidence_ref,
      evidence_sha256:proof.attestation.message.evidence_sha256,
      passed:true,review_proposal_id:reviewedId};
    const prematureQa=await c.signed('/v7/tasks/qa-receipt',receiptBody);
    assert.equal(prematureQa.code,403,JSON.stringify(prematureQa.body));
    assert.equal(prematureQa.body.error_code,'QA_VERIFIED_OWNER_REVIEW_REQUIRED');
    const genericOwner=await post('/v7/owner/command',{request_id:'qa_generic_'+(++count),
      command:'APPROVE_PROPOSAL',payload:{proposal_id:reviewedId}},admin);
    assert.equal(genericOwner.code,403,JSON.stringify(genericOwner.body));
    assert.equal(genericOwner.body.error_code,'QA_REVIEW_REQUIRES_OWNER_EVIDENCE_COMMAND');
    const unreviewedOwner=await post('/v7/owner/command',{request_id:'qa_bad_owner_'+(++count),
      command:'APPROVE_QA_EVIDENCE',payload:{review_proposal_id:reviewedId,
        review_note:'No independent Docker or QA device validation has been done'}},admin);
    assert.equal(unreviewedOwner.code,403,JSON.stringify(unreviewedOwner.body));
    assert.equal(unreviewedOwner.body.error_code,'QA_OWNER_INDEPENDENT_REVIEW_REQUIRED');
    const beforeApproval=await fetch(base+'/v7/tasks',{headers:{authorization:'Bearer '+admin}});
    assert.equal((await beforeApproval.json() as any[]).find(t=>t.ticket_id==='ticket_qa_test').status,
      'SUBMITTED_FOR_REVIEW','Signed evidence alone never moves ticket to INTEGRATING');
    // The actual product requires a real human Owner review of the external
    // runner, approved node, physical independence and exact local report.
    // These booleans simulate that authorization in disposable CI only.
    const ownerReviewed=await owner('APPROVE_QA_EVIDENCE',{
      review_proposal_id:reviewedId,
      review_note:'Integration fixture externally reviewed by test Owner only',
      device_identity_confirmed:true,runner_provenance_reviewed:true,
      test_evidence_reviewed:true,independence_verified:true});
    assert.equal(ownerReviewed.state.state,'APPROVED');
    assert.equal(ownerReviewed.state.integration_performed,false);
    const wrongEvidenceReceipt=await c.signed('/v7/tasks/qa-receipt',{
      ...receiptBody,request_id:'qa_wrong_hash_'+(++count),
      evidence_sha256:'f'.repeat(64),evidence_ref:'sha256:'+'f'.repeat(64)});
    assert.equal(wrongEvidenceReceipt.code,409,JSON.stringify(wrongEvidenceReceipt.body));
    assert.equal(wrongEvidenceReceipt.body.error_code,'QA_VERIFIED_EVIDENCE_MISMATCH');
    const qa=await c.signed('/v7/tasks/qa-receipt',receiptBody);
    assert.equal(qa.code,200,JSON.stringify(qa.body));
    const qaAgain=await c.signed('/v7/tasks/qa-receipt',receiptBody);
    assert.deepEqual(qaAgain,qa,'Only identical approved QA receipt is idempotent');
    const unauthorizedExtra=await c.signed('/v7/tasks/qa-receipt',{
      ...receiptBody,request_id:'qa_replay_new_'+(++count)});
    assert.notEqual(unauthorizedExtra.code,200,'Same report cannot cause another QA transition');
    const task=await fetch(base+'/v7/tasks',{headers:{authorization:'Bearer '+admin}});
    const list=await task.json() as any[];
    assert.equal(list.find(t=>t.ticket_id==='ticket_qa_test').status,'INTEGRATING');
    // Publication gate remains read-only until an explicit Owner-reviewed QA
    // acceptance. Single-ticket Master-version CAS and idempotent reservation
    // are verified in disposable MySQL without any live GitHub push.
    const preflight=await c.signed('/v7/git/preflight/ticket_qa_test',undefined,'GET');
    assert.equal(preflight.code,200,JSON.stringify(preflight.body));
    assert.equal(preflight.body.preflight_ready,true);
    assert.equal(preflight.body.automatic_push_allowed,false);
    assert.equal(preflight.body.git_published,false);
    assert.equal(preflight.body.branch,'ai/ticket_qa_test');
    assert.equal(preflight.body.base_branch,'main');
    assert.equal(preflight.body.candidate_head_sha,'b'.repeat(40));
    assert.equal(preflight.body.qa_evidence_sha256,proof.attestation.message.evidence_sha256);
    const developerCannotPublish=await b.signed(
      '/v7/git/preflight/ticket_qa_test',undefined,'GET');
    assert.equal(developerCannotPublish.code,409,JSON.stringify(developerCannotPublish.body));
    const badReserve={request_id:'gitreserve_wrong_'+(++count),
      agent_id:c.agent_id,ticket_id:'ticket_qa_test',
      expected_master_epoch:Number(status.epoch),
      expected_candidate_head_sha:'f'.repeat(40),
      expected_candidate_tree_sha:'c'.repeat(40),
      expected_ticket_version:preflight.body.version};
    const mismatched=await c.signed('/v7/git/reserve',badReserve);
    assert.equal(mismatched.code,409,JSON.stringify(mismatched.body));
    assert.equal(mismatched.body.error_code,'GIT_RESERVATION_CANDIDATE_CHANGED');
    const reserveBody={...badReserve,
      request_id:'gitreserve_real_'+(++count),
      expected_candidate_head_sha:'b'.repeat(40)};
    const reserved=await c.signed('/v7/git/reserve',reserveBody);
    assert.equal(reserved.code,200,JSON.stringify(reserved.body));
    assert.equal(reserved.body.one_shot,true);
    assert.equal(reserved.body.candidate_head_sha,'b'.repeat(40));
    assert.equal(reserved.body.baseline_sha,'a'.repeat(40));
    const reReserve=await c.signed('/v7/git/reserve',reserveBody);
    assert.deepEqual(reReserve,reserved,'Lost reserve reply has one durable MySQL job');
    const changedReserve=await c.signed('/v7/git/reserve',{
      ...reserveBody,request_id:'gitreserve_new_'+(++count)});
    assert.equal(changedReserve.code,409);
    assert.equal(changedReserve.body.error_code,'GIT_JOB_ALREADY_RESERVED_RECONCILE');
    const preflightAfterReserve=await c.signed(
      '/v7/git/preflight/ticket_qa_test',undefined,'GET');
    assert.equal(preflightAfterReserve.code,409,'Existing remote Git intent blocks new preflight');
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
      // The actually reserved Central one-shot job above remains unresolved.
      // Recovery cannot assume it was safe to retry after the Master changed.
      const uncertain=await b.signed('/v7/recovery',undefined,'GET');
      assert.equal(uncertain.code,200,JSON.stringify(uncertain.body));
      assert.equal(uncertain.body.unresolved_git_jobs.length,1);
      const queueResponse=await fetch(base+'/v7/owner/git-recovery',
        {headers:{authorization:'Bearer '+admin}});
      assert.equal(queueResponse.status,200);
      const ownerQueue=await queueResponse.json() as any;
      assert.equal(ownerQueue.phase,'RECOVERING');
      assert.equal(ownerQueue.epoch,Number(promoted.body.epoch));
      assert.equal(ownerQueue.master_live,true);
      assert.equal(ownerQueue.unresolved_jobs.length,1);
      assert.equal(ownerQueue.unresolved_jobs[0].ticket_id,'ticket_qa_test');
      assert.equal(ownerQueue.unresolved_jobs[0].preflight_eligible,true);
      assert.deepEqual(ownerQueue.unresolved_jobs[0].blocking_reasons,[]);
      assert.equal(ownerQueue.unresolved_jobs[0].matching_qa_receipt,true);
      // Even a still-present Central lease is not enough after revoked
      // Master enrollment. Simulate revocation only in disposable CI MySQL.
      await db.query('UPDATE v7_nodes SET state="REVOKED" WHERE node_id=?',[b.node_id]);
      try{
        const revokedQueue=await fetch(base+'/v7/owner/git-recovery',
          {headers:{authorization:'Bearer '+admin}});
        assert.equal(revokedQueue.status,200);
        const revokedPreview=await revokedQueue.json() as any;
        assert.equal(revokedPreview.master_live,false);
        assert.ok(revokedPreview.unresolved_jobs[0].blocking_reasons.includes(
          'MASTER_NOT_LIVE_OR_APPROVED'));
      }finally{
        await db.query('UPDATE v7_nodes SET state="APPROVED" WHERE node_id=?',[b.node_id]);
      }
      assert.equal(ownerQueue.unresolved_jobs[0].candidate_head_sha,'b'.repeat(40));
      assert.equal(JSON.stringify(ownerQueue).includes('ci-only-admin-secret'),false,
        'Owner queue must never include secret values');
      const rejectGit=await b.signed('/v7/leadership/reconcile',{
        agent_id:b.agent_id,expected_master_epoch:Number(promoted.body.epoch),
        request_id:'reject_uncertain_git_'+(++count),
        manifest_sha256:uncertain.body.manifest_sha256});
      assert.equal(rejectGit.code,423,JSON.stringify(rejectGit.body));
      // A new Master may never infer that a remote Git write was safe to retry.
      assert.ok(['TASK_RECONCILIATION_REQUIRED','GIT_RECONCILIATION_REQUIRED'].includes(
        rejectGit.body.error_code));
      // Prove the Git barrier independently: temporarily mark ALL unresolved
      // tickets terminal in this disposable database, then restore each one.
      // Another drained task may also require reconciliation after promotion.
      const [unresolvedRows]=await db.query(
        'SELECT ticket_id FROM v7_tickets WHERE status="RECONCILIATION_REQUIRED"');
      const unresolvedIds=(unresolvedRows as any[]).map(x=>String(x.ticket_id));
      assert.ok(unresolvedIds.includes('ticket_qa_test'));
      try {
        await db.query('UPDATE v7_tickets SET status="DONE" WHERE status="RECONCILIATION_REQUIRED"');
        const gitOnly=await b.signed('/v7/recovery',undefined,'GET');
        assert.equal(gitOnly.code,200,JSON.stringify(gitOnly.body));
        assert.equal(gitOnly.body.tickets.some((t:any)=>t.status==='RECONCILIATION_REQUIRED'),false);
        assert.equal(gitOnly.body.unresolved_git_jobs.length,1);
        const blocked=await b.signed('/v7/leadership/reconcile',{
          agent_id:b.agent_id,expected_master_epoch:Number(promoted.body.epoch),
          request_id:'only_uncertain_git_'+(++count),
          manifest_sha256:gitOnly.body.manifest_sha256});
        assert.equal(blocked.code,423,JSON.stringify(blocked.body));
        assert.equal(blocked.body.error_code,'GIT_RECONCILIATION_REQUIRED');
      }finally{
        for(const id of unresolvedIds)
          await db.query('UPDATE v7_tickets SET status="RECONCILIATION_REQUIRED" WHERE ticket_id=?',[id]);
      }
      const oldMaster=await a.signed('/v7/tasks/plan',{request_id:'oldmaster_'+(++count),
        agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
        ticket_id:'ticket_stale_master',project_id:'project_integration',
        baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_stale_master',
        title:'Stale epoch',description:'Should never be accepted',risk:'LOW',
        write_scopes:['src/stale.ts'],acceptance_criteria:['Never create ticket']});
      assert.notEqual(oldMaster.code,200,'Former master must be fenced after failover');
      const staleResume=await b.signed('/v7/tasks/resume-check',{
        agent_id:b.agent_id,ticket_id:'ticket_qa_test',
        lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch)});
      assert.notEqual(staleResume.code,200,'Failover must fence old restart attempts');
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
      // Ordinary Owner ticket reconciliation must NEVER silently requeue a
      // job with uncertain external Git effects.
      const unsafeReset=await post('/v7/owner/command',{
        request_id:'reset_published_'+(++count),command:'RECONCILE_TICKET',
        payload:{ticket_id:'ticket_qa_test',reason:'unsafe replay',remote_checked:true}},admin);
      assert.equal(unsafeReset.code,423,JSON.stringify(unsafeReset.body));
      assert.equal(unsafeReset.body.error_code,'GIT_PUBLICATION_REQUIRES_SEPARATE_RECOVERY');
      const recoveryRequest={
        request_id:'owner_remote_proof_'+(++count),
        ticket_id:'ticket_qa_test',expected_master_epoch:Number(fallback.body.epoch),
        owner_confirmed_readonly_proof:true,
        reason:'Disposable integration: remotely observed exact QA candidate'
      };
      // Even with Owner authorization, a job must be tied to the same
      // independent QA agent that signed the accepted candidate.
      await db.query('UPDATE v7_git_jobs SET agent_id=? WHERE ticket_id=?',
        [b.agent_id,'ticket_qa_test']);
      const mismatchedQA=await post('/v7/git/recover-remote-proof',{
        ...recoveryRequest,request_id:'mismatched_qa_'+(++count)},admin);
      assert.equal(mismatchedQA.code,409,JSON.stringify(mismatchedQA.body));
      assert.equal(mismatchedQA.body.error_code,'GIT_RECOVERY_QA_INDEPENDENCE_REQUIRED');
      const unsafeQueue=await fetch(base+'/v7/owner/git-recovery',
        {headers:{authorization:'Bearer '+admin}});
      assert.equal(unsafeQueue.status,200);
      const unsafePreview=await unsafeQueue.json() as any;
      assert.equal(unsafePreview.unresolved_jobs[0].preflight_eligible,false,
        'A self-QA publication may not be offered for Owner proof');
      assert.ok(unsafePreview.unresolved_jobs[0].blocking_reasons.includes(
        'QA_NOT_INDEPENDENT'));
      // A different agent cannot borrow the QA receipt signed by agent C.
      await db.query('UPDATE v7_git_jobs SET agent_id=? WHERE ticket_id=?',
        [d.agent_id,'ticket_qa_test']);
      const mismatchedReceipt=await post('/v7/git/recover-remote-proof',{
        ...recoveryRequest,request_id:'unrelated_qa_'+(++count)},admin);
      assert.equal(mismatchedReceipt.code,409,JSON.stringify(mismatchedReceipt.body));
      assert.equal(mismatchedReceipt.body.error_code,'GIT_RECOVERY_QA_PROOF_REQUIRED');
      await db.query('UPDATE v7_git_jobs SET agent_id=? WHERE ticket_id=?',
        [c.agent_id,'ticket_qa_test']);
      const unauthenticated=await post('/v7/git/recover-remote-proof',recoveryRequest,'wrong-token');
      assert.equal(unauthenticated.code,401);
      const missingOwnerConsent=await post('/v7/git/recover-remote-proof',{
        ...recoveryRequest,owner_confirmed_readonly_proof:false},admin);
      assert.equal(missingOwnerConsent.code,403);
      const originalFetch=globalThis.fetch,originalToken=process.env.SUTRADHAR_GITHUB_TOKEN;
      const expectedHead='b'.repeat(40),expectedTree='c'.repeat(40),
        expectedBase='a'.repeat(40);
      let readonlyGitRequests=0;
      try{
        process.env.SUTRADHAR_GITHUB_TOKEN='ci-only-remote-proof-token';
        // Use a deterministic read-only GitHub response fixture. All other
        // HTTP requests still go to the actual local Express/MySQL service.
        globalThis.fetch=(async(input:any,init?:any)=>{
          const url=typeof input==='string'?input:String(input?.url||input);
          const prefix='https://api.github.com/repos/example/repo/';
          if(!url.startsWith(prefix))return originalFetch(input,init);
          readonlyGitRequests++;
          assert.equal(init?.method,'GET','GitHub writes are forbidden during recovery');
          const suffix=url.slice(prefix.length);
          let result:any;
          if(suffix==='branches/ai/ticket_qa_test')
            result={commit:{sha:expectedHead}};
          else if(suffix==='branches/main')
            result={commit:{sha:expectedBase}};
          else if(suffix==='git/commits/'+expectedHead)
            result={sha:expectedHead,tree:{sha:expectedTree},parents:[{sha:expectedBase}]};
          else if(suffix==='compare/'+expectedBase+'...'+expectedHead)
            result={status:'ahead',ahead_by:1,behind_by:0,total_commits:1,
              files:[{filename:'src/example.ts',status:'modified'}]};
          else throw Error('Unexpected GitHub URL '+suffix);
          return new Response(JSON.stringify(result),{status:200});
        }) as typeof fetch;
        const resolved=await post('/v7/git/recover-remote-proof',recoveryRequest,admin);
        assert.equal(resolved.code,200,JSON.stringify(resolved.body));
        assert.equal(resolved.body.status,'PUSH_CONFIRMED_NOT_MERGED');
        assert.equal(resolved.body.merge_performed,false);
        assert.equal(resolved.body.automatic_retry_allowed,false);
        assert.equal(resolved.body.remote_head_sha,expectedHead);
        const sameReceipt=await post('/v7/git/recover-remote-proof',recoveryRequest,admin);
        assert.equal(sameReceipt.code,200,JSON.stringify(sameReceipt.body));
        assert.deepEqual(sameReceipt.body,resolved.body,
          'Retry after lost response must return the durable receipt');
        const wrongReuse=await post('/v7/git/recover-remote-proof',{
          ...recoveryRequest,reason:'different Owner intent'},admin);
        assert.equal(wrongReuse.code,409,JSON.stringify(wrongReuse.body));
        assert.equal(wrongReuse.body.error_code,'IDEMPOTENCY_KEY_REUSED');
      }finally{
        globalThis.fetch=originalFetch;
        if(originalToken===undefined)delete process.env.SUTRADHAR_GITHUB_TOKEN;
        else process.env.SUTRADHAR_GITHUB_TOKEN=originalToken;
      }
      assert.equal(readonlyGitRequests,4,'Exact base branch plus candidate branch/commit/compare proof required');
      const [recoveredRows]=await db.query(
        'SELECT state,remote_head_sha FROM v7_git_jobs WHERE ticket_id=?',['ticket_qa_test']);
      assert.equal((recoveredRows as any[])[0].state,'CONFIRMED');
      assert.equal((recoveredRows as any[])[0].remote_head_sha,expectedHead);
      const [ticketRows]=await db.query(
        'SELECT status FROM v7_tickets WHERE ticket_id=?',['ticket_qa_test']);
      assert.equal((ticketRows as any[])[0].status,'INTEGRATING',
        'Exact remote proof may restore QA-integrating work, never requeue for new development');
      const nowSafeGit=await c.signed('/v7/recovery',undefined,'GET');
      assert.equal(nowSafeGit.code,200,JSON.stringify(nowSafeGit.body));
      assert.equal(nowSafeGit.body.unresolved_git_jobs.length,0);
      const clearedQueue=await fetch(base+'/v7/owner/git-recovery',
        {headers:{authorization:'Bearer '+admin}});
      assert.equal(clearedQueue.status,200);
      assert.deepEqual((await clearedQueue.json() as any).unresolved_jobs,[],
        'Owner queue must reflect committed exact remote proof receipt');

      // Disposable-MySQL Owner PR lifecycle: a GitHub POST can succeed
      // remotely then lose its HTTP response. Never issue a second POST;
      // inspect the exact existing Draft PR read-only and finalize the SAME
      // durable Central attempt. No real GitHub POST is made by this test.
      await db.query('UPDATE v7_cluster SET phase="READY",paused=0,'+
        'lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND) WHERE singleton=1');
      const previousPrFlag=process.env.SUTRADHAR_ENABLE_PR_CREATION;
      const previousPrToken=process.env.SUTRADHAR_GITHUB_PR_TOKEN;
      const previousReadToken=process.env.SUTRADHAR_GITHUB_TOKEN;
      const previousChecks=process.env.SUTRADHAR_REQUIRED_CHECKS;
      const previousApprovals=process.env.SUTRADHAR_MIN_GITHUB_APPROVALS;
      const realFetch=globalThis.fetch;
      let prPostCalls=0,prGetCalls=0,remoteDraftExists=false;
      let prReadyForReview=false,prMerged=false,reviewedOldHead=false;
      const mergedSha='d'.repeat(40);
      try{
        process.env.SUTRADHAR_ENABLE_PR_CREATION='true';
        process.env.SUTRADHAR_GITHUB_TOKEN='disposable-ci-readonly-token';
        process.env.SUTRADHAR_REQUIRED_CHECKS='CI / tests';
        process.env.SUTRADHAR_MIN_GITHUB_APPROVALS='1';
        delete process.env.SUTRADHAR_GITHUB_PR_TOKEN;
        const missingTokenPreflight=await fetch(base+'/v7/owner/pr-preflight/ticket_qa_test',{
          headers:{authorization:'Bearer '+admin}});
        assert.equal(missingTokenPreflight.status,200);
        assert.equal((await missingTokenPreflight.json() as any).ready_for_owner_intent,false);
        const missingTokenWrite=await post('/v7/git/pr-draft',{
          request_id:'prdraft_no_token_'+(++count),ticket_id:'ticket_qa_test',
          expected_remote_head_sha:'b'.repeat(40),
          expected_candidate_tree_sha:'c'.repeat(40),
          owner_confirmed_draft_only:true,
          owner_review_note:'Owner checked candidate but PR token is missing'},admin);
        assert.equal(missingTokenWrite.code,503);
        assert.equal(missingTokenWrite.body.error_code,'DRAFT_PR_TOKEN_NOT_CONFIGURED');
        process.env.SUTRADHAR_GITHUB_PR_TOKEN='disposable-ci-pr-api-token';
        const prPreflight=await fetch(base+'/v7/owner/pr-preflight/ticket_qa_test',{
          headers:{authorization:'Bearer '+admin}});
        assert.equal(prPreflight.status,200);
        const prReady=await prPreflight.json() as any;
        assert.equal(prReady.ready_for_owner_intent,true);
        assert.equal(prReady.candidate_head_sha,'b'.repeat(40));
        assert.equal(prReady.candidate_tree_sha,'c'.repeat(40));
        assert.equal(prReady.base_branch,'main');
        const missingConsent=await post('/v7/git/pr-draft',{
          request_id:'prdraft_denied_'+(++count),ticket_id:'ticket_qa_test',
          expected_remote_head_sha:'b'.repeat(40),
          expected_candidate_tree_sha:'c'.repeat(40),
          owner_confirmed_draft_only:false,
          owner_review_note:'Owner did not authorize any GitHub write'},admin);
        assert.equal(missingConsent.code,403);
        const wrongCommit=await post('/v7/git/pr-draft',{
          request_id:'prdraft_wrong_'+(++count),ticket_id:'ticket_qa_test',
          expected_remote_head_sha:'f'.repeat(40),
          expected_candidate_tree_sha:'c'.repeat(40),
          owner_confirmed_draft_only:true,
          owner_review_note:'External QA review has authorized the exact draft'},admin);
        assert.equal(wrongCommit.code,409);
        assert.equal(wrongCommit.body.error_code,'DRAFT_PR_CANDIDATE_CHANGED');
        globalThis.fetch=(async(input:any,init?:any)=>{
          const url=typeof input==='string'?input:String(input?.url||input);
          const prefix='https://api.github.com/repos/example/repo/';
          if(!url.startsWith(prefix))return realFetch(input,init);
          const path=url.slice(prefix.length),method=init?.method||'GET';
          if(method==='POST'){
            assert.equal(path,'pulls','Draft PR creator has no other GitHub write');
            const body=JSON.parse(String(init.body));
            assert.equal(body.head,'ai/ticket_qa_test');
            assert.equal(body.base,'main');
            assert.equal(body.draft,true);
            prPostCalls++;remoteDraftExists=true;
            throw Error('GITHUB_DRAFT_PR_CREATED_BUT_RESPONSE_LOST');
          }
          assert.equal(method,'GET');prGetCalls++;
          let result:any;
          if(path==='branches/main')result={commit:{sha:'a'.repeat(40)}};
          else if(path==='branches/ai/ticket_qa_test')
            result={commit:{sha:'b'.repeat(40)}};
          else if(path==='git/commits/'+'b'.repeat(40))
            result={sha:'b'.repeat(40),tree:{sha:'c'.repeat(40)},
              parents:[{sha:'a'.repeat(40)}]};
          else if(path==='compare/'+'a'.repeat(40)+'...'+'b'.repeat(40))
            result={status:'ahead',ahead_by:1,behind_by:0,total_commits:1,
              files:[{filename:'src/example.ts',status:'modified'}]};
          else if(path==='git/commits/'+mergedSha)
            result={sha:mergedSha,tree:{sha:'c'.repeat(40)},
              parents:[{sha:'b'.repeat(40)}]};
          else if(path==='compare/'+mergedSha+'...main')
            result={status:'ahead',base_commit:{sha:mergedSha}};
          else if(path==='pulls/77/files?per_page=100')
            result=[{filename:'src/example.ts',status:'modified'}];
          else if(path==='commits/'+'b'.repeat(40)+'/check-runs?per_page=100')
            result={total_count:1,check_runs:[{name:'CI / tests',
              head_sha:'b'.repeat(40),app:{slug:'github-actions'},
              status:'completed',conclusion:'success'}]};
          else if(path==='pulls/77/reviews?per_page=100')
            result=[{id:1,user:{login:'independent_reviewer',type:'User'},
              state:'APPROVED',commit_id:reviewedOldHead?'e'.repeat(40):'b'.repeat(40),
              submitted_at:'2026-11-06T16:00:00Z'}];
          else if(path==='pulls/77'||path.startsWith('pulls?')){
            const pr={number:77,commits:1,changed_files:1,
              html_url:'https://github.com/example/repo/pull/77',
              state:prMerged?'closed':'open',
              draft:prMerged?false:!prReadyForReview,
              merged_at:prMerged?'2026-11-06T17:00:00Z':null,
              merge_commit_sha:prMerged?mergedSha:null,
              user:{login:'author'},
              head:{ref:'ai/ticket_qa_test',sha:'b'.repeat(40),
                repo:{full_name:'example/repo'}},
              base:{ref:'main',sha:'a'.repeat(40),
                repo:{full_name:'example/repo'}}};
            result=path==='pulls/77'?pr:(remoteDraftExists?[pr]:[]);
          }else throw Error('Unexpected GitHub PR query '+path);
          return new Response(JSON.stringify(result),{status:200});
        }) as typeof fetch;
        const createRequest={request_id:'prdraft_timeout_'+(++count),
          ticket_id:'ticket_qa_test',
          expected_remote_head_sha:'b'.repeat(40),
          expected_candidate_tree_sha:'c'.repeat(40),
          owner_review_note:'Owner verified the independent QA and permits draft ONLY',
          owner_confirmed_draft_only:true};
        const ambiguous=await post('/v7/git/pr-draft',createRequest,admin);
        assert.equal(ambiguous.code,409,JSON.stringify(ambiguous.body));
        assert.equal(ambiguous.body.error_code,
          'DRAFT_PR_REMOTE_UNCERTAIN_DRAFT_PR_GITHUB_API_UNAVAILABLE');
        assert.equal(prPostCalls,1);
        const [pendingRows]=await db.query(
          'SELECT pr_number,pr_url FROM v7_git_jobs WHERE ticket_id=?',
          ['ticket_qa_test']);
        assert.equal((pendingRows as any[])[0].pr_number,null);
        assert.equal((pendingRows as any[])[0].pr_url,
          'DRAFT_PR_ATTEMPT_PENDING:'+createRequest.request_id);
        const repeated=await post('/v7/git/pr-draft',createRequest,admin);
        assert.equal(repeated.code,409);
        assert.equal(repeated.body.error_code,'DRAFT_PR_RECONCILIATION_REQUIRED');
        assert.equal(prPostCalls,1,'Ambiguous GitHub PR create MUST never re-POST');
        const recoveryQueue=await fetch(base+'/v7/owner/pr-recovery',{
          headers:{authorization:'Bearer '+admin}});
        assert.equal(recoveryQueue.status,200);
        const recoveryList=await recoveryQueue.json() as any;
        assert.equal(recoveryList.automatic_recreate_allowed,false);
        const pendingPr=recoveryList.attempts.find(
          (z:any)=>z.ticket_id==='ticket_qa_test');
        assert.equal(pendingPr.original_request_id,createRequest.request_id);
        assert.equal(pendingPr.remote_head_sha,'b'.repeat(40));
        const noProof=await post('/v7/git/pr-recover-readonly',{
          request_id:'prrecover_denied_'+(++count),
          ticket_id:'ticket_qa_test',expected_remote_head_sha:'b'.repeat(40),
          reason:'Owner must inspect real GitHub evidence before recovery',
          owner_confirmed_readonly_proof:false},admin);
        assert.equal(noProof.code,403);
        const recovery={request_id:'prrecover_exact_'+(++count),
          ticket_id:'ticket_qa_test',expected_remote_head_sha:'b'.repeat(40),
          reason:'Owner independently inspected the remote existing draft',
          owner_confirmed_readonly_proof:true};
        const recovered=await post('/v7/git/pr-recover-readonly',recovery,admin);
        assert.equal(recovered.code,200,JSON.stringify(recovered.body));
        assert.equal(recovered.body.recovered_readonly,true);
        assert.equal(recovered.body.second_pr_create_attempt,false);
        assert.equal(recovered.body.merge_performed,false);
        assert.equal(recovered.body.pr_number,77);
        assert.equal(recovered.body.head_sha,'b'.repeat(40));
        assert.equal(prPostCalls,1);
        assert.ok(prGetCalls>=10);
        const replay=await post('/v7/git/pr-recover-readonly',recovery,admin);
        assert.equal(replay.code,200,JSON.stringify(replay.body));
        assert.deepEqual(replay.body,recovered.body);
        assert.equal(prPostCalls,1);
        const [registered]=await db.query(
          'SELECT pr_number,pr_url FROM v7_git_jobs WHERE ticket_id=?',
          ['ticket_qa_test']);
        assert.equal(Number((registered as any[])[0].pr_number),77);
        assert.equal((registered as any[])[0].pr_url,
          'https://github.com/example/repo/pull/77');
        const prAfter=await fetch(base+'/v7/owner/pr-preflight/ticket_qa_test',{
          headers:{authorization:'Bearer '+admin}});
        assert.equal(prAfter.status,200);
        assert.equal((await prAfter.json() as any).already_registered,true);
        const queueCleared=await fetch(base+'/v7/owner/pr-recovery',{
          headers:{authorization:'Bearer '+admin}});
        assert.equal((await queueCleared.json() as any).attempts.length,0);

        const prReviewRoute=base+'/v7/owner/pr-review/ticket_qa_test';
        const noOwnerPreview=await realFetch(prReviewRoute);
        assert.equal(noOwnerPreview.status,401,
          'Review status is authenticated Owner-only');
        async function reviewSnapshot(){
          const reply=await realFetch(prReviewRoute,{
            headers:{authorization:'Bearer '+admin}});
          assert.equal(reply.status,200);
          return reply.json() as Promise<any>;
        }
        const draftPreview=await reviewSnapshot();
        assert.equal(draftPreview.review.checked,true,JSON.stringify(draftPreview));
        assert.equal(draftPreview.review.ready_for_manual_merge,false);
        assert.ok(draftPreview.review.blocks.includes('GITHUB_DRAFT_PR_REVIEW_REQUIRED'));
        assert.equal(draftPreview.merge_performed,false);
        prReadyForReview=true;
        const readyPreview=await reviewSnapshot();
        assert.equal(readyPreview.review.ready_for_manual_merge,true,
          JSON.stringify(readyPreview));
        assert.equal(readyPreview.review.independent_approvals,1);
        assert.equal(readyPreview.pr_number,77);
        assert.equal(readyPreview.expected_head_sha,'b'.repeat(40));
        reviewedOldHead=true;
        const staleReview=await reviewSnapshot();
        assert.equal(staleReview.review.ready_for_manual_merge,false);
        assert.ok(staleReview.review.blocks.includes('GITHUB_APPROVAL_NOT_VERIFIED'));
        reviewedOldHead=false;
        prMerged=true;
        const closedPreview=await reviewSnapshot();
        assert.equal(closedPreview.review.ready_for_manual_merge,false);
        assert.ok(closedPreview.review.blocks.includes(
          'GITHUB_PR_ALREADY_CLOSED_USE_MERGE_VERIFIER'));
        const finalIntent={
          request_id:'mergeverify_exact_'+(++count),
          ticket_id:'ticket_qa_test',
          expected_remote_head_sha:'b'.repeat(40),
          expected_pr_number:77,
          owner_review_note:'Owner inspected the independent merged PR and target CI',
          owner_confirmed_readonly_verification:true
        };
        const missingVerificationConsent=await post('/v7/tasks/verify-merge',
          {...finalIntent,request_id:'merge_missing_'+(++count),
            owner_confirmed_readonly_verification:false},admin);
        assert.equal(missingVerificationConsent.code,403);
        const wrongRegisteredPr=await post('/v7/tasks/verify-merge',{
          ...finalIntent,request_id:'merge_wrong_'+(++count),expected_pr_number:78},admin);
        assert.equal(wrongRegisteredPr.code,409);
        assert.equal(wrongRegisteredPr.body.error_code,
          'MERGE_VERIFICATION_CANDIDATE_CHANGED');
        const verified=await post('/v7/tasks/verify-merge',finalIntent,admin);
        assert.equal(verified.code,200,JSON.stringify(verified.body));
        assert.equal(verified.body.status,'DONE');
        assert.equal(verified.body.read_only,true);
        assert.equal(verified.body.merge_performed,false);
        assert.equal(verified.body.github.prNumber,77);
        assert.equal(verified.body.github.headSha,'b'.repeat(40));
        assert.equal(verified.body.github.mergeSha,mergedSha);
        const getsBeforeReplay=prGetCalls;
        const lostMergeReplyReplay=await post('/v7/tasks/verify-merge',finalIntent,admin);
        assert.equal(lostMergeReplyReplay.code,200);
        assert.deepEqual(lostMergeReplyReplay.body,verified.body,
          'Lost response after DONE must return original durable receipt');
        assert.equal(prGetCalls,getsBeforeReplay,
          'Idempotent DONE replay never recontacts GitHub');
        const mismatchedRequestReuse=await post('/v7/tasks/verify-merge',{
          ...finalIntent,owner_review_note:'Different Owner decision'},admin);
        assert.equal(mismatchedRequestReuse.code,409);
        assert.equal(mismatchedRequestReuse.body.error_code,'IDEMPOTENCY_KEY_REUSED');
        const anotherVerification=await post('/v7/tasks/verify-merge',{
          ...finalIntent,request_id:'merge_second_'+(++count)},admin);
        assert.equal(anotherVerification.code,409);
        assert.equal(anotherVerification.body.error_code,
          'NOT_READY_FOR_GIT_VERIFICATION');
        const [doneRows]=await db.query('SELECT status FROM v7_tickets WHERE ticket_id=?',
          ['ticket_qa_test']);
        assert.equal((doneRows as any[])[0].status,'DONE');
        const [mergeReceipts]=await db.query(
          'SELECT ticket_id FROM v7_git_receipts WHERE ticket_id=?',['ticket_qa_test']);
        assert.equal((mergeReceipts as any[]).length,1);
        assert.equal(prPostCalls,1,
          'Only original mock Draft PR create was a GitHub write');

      }finally{
        globalThis.fetch=realFetch;
        if(previousPrFlag===undefined)delete process.env.SUTRADHAR_ENABLE_PR_CREATION;
        else process.env.SUTRADHAR_ENABLE_PR_CREATION=previousPrFlag;
        if(previousPrToken===undefined)delete process.env.SUTRADHAR_GITHUB_PR_TOKEN;
        else process.env.SUTRADHAR_GITHUB_PR_TOKEN=previousPrToken;
        if(previousReadToken===undefined)delete process.env.SUTRADHAR_GITHUB_TOKEN;
        else process.env.SUTRADHAR_GITHUB_TOKEN=previousReadToken;
        if(previousChecks===undefined)delete process.env.SUTRADHAR_REQUIRED_CHECKS;
        else process.env.SUTRADHAR_REQUIRED_CHECKS=previousChecks;
        if(previousApprovals===undefined)delete process.env.SUTRADHAR_MIN_GITHUB_APPROVALS;
        else process.env.SUTRADHAR_MIN_GITHUB_APPROVALS=previousApprovals;
      }

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
