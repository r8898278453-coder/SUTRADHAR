import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import http from 'node:http';
import mysql from 'mysql2/promise';
import {once} from 'node:events';
import {app,shutdownV7ForTests} from '../v7/central.ts';
import {verifyRecoverySnapshot} from '../v7/recovery_validation.ts';
import {verifyExistingAgentOnOwnNode} from '../v7/agent_restart_authority.ts';
import {REVIEWED_V8_MIGRATION_SHA256} from '../v7/schema_compatibility.ts';
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
    // Real HTTP + disposable MySQL parity, with synthetic Telegram updates.
    // No bot token, Telegram network request, or actual webhook registration.
    {
      const names=['TELEGRAM_WEBHOOK_SECRET','TELEGRAM_ADMIN_USER_ID','TELEGRAM_ALLOWED_CHAT_ID','TELEGRAM_BOT_USERNAME','TELEGRAM_BOT_TOKEN'];
      const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
      const secret='fixture_telegram_webhook_secret_1234567890';
      process.env.TELEGRAM_WEBHOOK_SECRET=secret;
      process.env.TELEGRAM_ADMIN_USER_ID='12345';
      process.env.TELEGRAM_ALLOWED_CHAT_ID='12345';
      process.env.TELEGRAM_BOT_USERNAME='SutradharFixtureBot';
      delete process.env.TELEGRAM_BOT_TOKEN;
      const db=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
        user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
      const update=(update_id:number,text:string)=>({update_id,message:{
        from:{id:12345,is_bot:false},chat:{id:12345,type:'private'},
        date:Math.floor(Date.now()/1000),text}});
      async function tg(body:any,token=secret){
        const res=await fetch(base+'/v7/telegram/webhook',{method:'POST',
          headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':token},
          body:JSON.stringify(body)});
        return {code:res.status,body:await res.json() as any};
      }
      const cluster=async()=>{const [rows]:any=await db.query('SELECT paused,version,epoch,master_agent_id FROM v7_cluster WHERE singleton=1');return rows[0];};
      try{
        const before=await cluster();
        const denied=update(90001,'/pause');denied.message.from.id=99999;
        assert.equal((await tg(denied)).code,401);
        assert.equal((await tg(update(90002,'/pause'),'wrong')).code,401);
        assert.equal((await tg(update(90003,'/approve'))).body.ignored,true);
        assert.deepEqual(await cluster(),before);
        const message=update(90004,'/pause');
        const [one,two,web]=await Promise.all([
          tg(message),tg(message),post('/v7/owner/command',{request_id:'tg_parity_web_pause',command:'PAUSE',payload:{}},admin)]);
        assert.equal(one.code,200,JSON.stringify(one.body));
        assert.equal(two.code,200,JSON.stringify(two.body));
        assert.equal(web.code,200,JSON.stringify(web.body));
        assert.deepEqual([one.body.replayed,two.body.replayed].sort(),[false,true]);
        assert.equal(one.body.receipt_id,'tg_90004');
        const paused=await cluster();
        assert.equal(Boolean(paused.paused),true);
        assert.equal(Number(paused.version),Number(before.version)+1);
        assert.equal(Number(paused.epoch),Number(before.epoch));
        const [receipts]:any=await db.query('SELECT COUNT(*) n FROM v7_commands WHERE actor=? AND request_id=?',['owner:telegram','tg_90004']);
        assert.equal(Number(receipts[0].n),1);
        const conflict=await tg(update(90004,'/resume'));
        assert.equal(conflict.code,409);
        assert.equal(conflict.body.error_code,'IDEMPOTENCY_KEY_REUSED');
        const status=await tg(update(90005,'/status@SutradharFixtureBot'));
        assert.equal(status.code,200);
        assert.deepEqual(await cluster(),paused);
        assert.equal((await tg(update(90006,'/resume'))).code,200);
        const resumed=await cluster();
        assert.equal(Boolean(resumed.paused),false);
        assert.equal(Number(resumed.version),Number(paused.version)+1);
        assert.equal(Number(resumed.epoch),Number(before.epoch));
        assert.equal(resumed.master_agent_id,before.master_agent_id);
      }finally{
        await db.end();
        for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
      }
    }
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
    // This CI bootstrap deliberately sets bootstrapped_at before 08:00 IST.
    // A bootstrapped NO_MASTER cluster is a post-failure state and must have
    // durable previous-Master identity evidence to permit a different-PC
    // successor. Seed that test-only audit history using an enrolled node
    // that is not currently eligible, instead of bypassing the safety gate.
    const historyDb=await mysql.createConnection({
      host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME});
    try{
      await historyDb.query(
        'INSERT INTO v7_events(event_type,actor,epoch,resource_id,payload_json) '+
        'VALUES("MASTER_MISSING","central",0,NULL,?)',
        [JSON.stringify({previous:d.agent_id,reason:'disposable_ci_bootstrap_fixture'})]);
    }finally{await historyDb.end();}
    // Duplicate agent IDs are GLOBAL, not evidence that another computer
    // owns the agent. A restarted node may only reconcile its own approved ID.
    const duplicatedA=await a.signed('/v7/agents/register',
      {agent_id:a.agent_id,capabilities:{}});
    assert.equal(duplicatedA.code,409);
    assert.equal(duplicatedA.body.error_code,'AGENT_ID_ALREADY_EXISTS');
    const ownA=await a.signed('/v7/nodes/me',undefined,'GET');
    assert.equal(ownA.code,200);
    assert.equal(verifyExistingAgentOnOwnNode(
      ownA.body,a.node_id,a.agent_id),true);
    const crossNode=await b.signed('/v7/agents/register',
      {agent_id:a.agent_id,capabilities:{}});
    assert.equal(crossNode.code,409);
    assert.equal(crossNode.body.error_code,'AGENT_ID_ALREADY_EXISTS');
    const ownB=await b.signed('/v7/nodes/me',undefined,'GET');
    assert.equal(ownB.code,200);
    assert.throws(()=>verifyExistingAgentOnOwnNode(
      ownB.body,b.node_id,a.agent_id),
      /AGENT_EXISTS_ON_DIFFERENT_NODE_OR_NOT_OWNED/,
      'A restart on PC B cannot adopt PC A global agent ID');
    assert.equal(verifyExistingAgentOnOwnNode(
      ownB.body,b.node_id,b.agent_id),true);
    // Explicit pilot mode records ONLY the accepted, real signed heartbeat.
    process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EVIDENCE='true';
    process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_START_UTC=
      new Date(Date.now()-60_000).toISOString();
    process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_END_UTC=
      new Date(Date.now()+15*60_000).toISOString();
    let h=await a.heartbeat();
    delete process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EVIDENCE;
    delete process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_START_UTC;
    delete process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_END_UTC;
    assert.equal(h.code,200,JSON.stringify(h.body));
    // A crashed Desktop cannot sign a recovery GET. The Owner can still
    // inspect Central's exact counters without mutating election/leases.
    const snapshotPath='/v7/owner/node-recovery/'+a.node_id;
    const anonymousSnapshot=await fetch(base+snapshotPath);
    assert.equal(anonymousSnapshot.status,401);
    const malformedSnapshot=await fetch(base+'/v7/owner/node-recovery/foreign', {
      headers:{authorization:'Bearer '+admin}});
    assert.equal(malformedSnapshot.status,400);
    const absentSnapshot=await fetch(base+'/v7/owner/node-recovery/'+
      'node_'+'f'.repeat(32),{headers:{authorization:'Bearer '+admin}});
    assert.equal(absentSnapshot.status,404);
    const readSnapshot=async()=>{
      const r=await fetch(base+snapshotPath,{headers:{authorization:'Bearer '+admin}});
      assert.equal(r.status,200);
      return await r.json() as any;
    };
    const recoveryBefore=await readSnapshot();
    assert.equal(recoveryBefore.mode,'OWNER_CENTRAL_NODE_CRASH_RECOVERY_OBSERVATION');
    assert.equal(recoveryBefore.accepted_node_sequence_decimal,'1');
    assert.equal(recoveryBefore.agents.length,1);
    assert.equal(recoveryBefore.agents[0].accepted_sequence_decimal,'1');
    const expectedFingerprint=crypto.createHash('sha256').update(
      crypto.createPublicKey(a.public_key_pem).export({type:'spki',format:'der'})).digest('hex');
    assert.equal(recoveryBefore.node_public_key_fingerprint_sha256,expectedFingerprint);
    assert.equal(recoveryBefore.local_os_vault_verified,false);
    assert.equal(recoveryBefore.agent_restart_allowed,false);
    assert.equal(recoveryBefore.marker_removal_allowed,false);
    assert.equal(recoveryBefore.owner_reconciliation_complete,false);
    assert.equal(recoveryBefore.historical_effects.retained_pilot_signed_heartbeat_packet_count,1);
    const retained= recoveryBefore.historical_effects.last_retained_pilot_heartbeat;
    assert.equal(retained.record_present,true);
    assert.equal(retained.last_retained_packet_signature_verified,true);
    assert.equal(retained.retained_sequence_equals_current_accepted_node_counter,true);
    assert.equal(retained.retained_agent_sequences_not_ahead_of_central,true);
    assert.equal(retained.retained_boot_id_matches_current,true);
    assert.equal(retained.last_retained_node_sequence_decimal,'1');
    assert.equal(retained.complete_signed_heartbeat_history,false);
    assert.equal(retained.agent_restart_allowed,false);
    assert.equal(JSON.stringify(retained).includes('signature_base64'),false);
    assert.equal(recoveryBefore.historical_effects.signed_heartbeat_history_complete,false);
    assert.ok(BigInt(recoveryBefore.historical_effects.global_audit_event_high_watermark_decimal)>0n);
    assert.equal(recoveryBefore.historical_effects.qa_receipts_created_by_this_pc_count,0);
    assert.equal(recoveryBefore.historical_effects.centrally_confirmed_git_jobs_involving_this_pc_count,0);
    assert.equal(recoveryBefore.historical_effects.qa_effects_independently_reconciled,false);
    const recoveryObservations=await Promise.all(Array.from({length:3},readSnapshot));
    for(const result of recoveryObservations){
      assert.equal(result.accepted_node_sequence_decimal,
        recoveryBefore.accepted_node_sequence_decimal);
      assert.equal(result.cluster.epoch_decimal,recoveryBefore.cluster.epoch_decimal);
      assert.equal(result.unresolved_git_job_count,0);
      assert.equal(result.maintenance.active_fence,false);
      assert.equal(result.central_state_modified,false);
      assert.equal(result.production_release_authorized,false);
    }
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
    const watermarkDb=await mysql.createConnection({
      host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME});
    try{
      const [observedRows]:any=await watermarkDb.query(
        'SELECT COALESCE(MAX(event_id),0) AS newest FROM v7_events '+
        'WHERE event_type!="NODE_HEARTBEAT_ACCEPTED"');
      assert.equal(originalMasterRecovery.body.event_high_watermark,
        Number(observedRows[0].newest),
        'Pilot packet rows cannot advance the core Master recovery cursor');
    }finally{await watermarkDb.end();}
    h=await b.heartbeat();assert.equal(h.code,200);
    const noPilotForOtherNode=await fetch(base+'/v7/owner/heartbeat-evidence/'+b.node_id,{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(noPilotForOtherNode.status,200);
    assert.equal(((await noPilotForOtherNode.json()) as any).records.length,0,
      'Absent pilot start/end opt-in must not log even accepted heartbeats');
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
    // Two separately signed simultaneous retries with the SAME recovery
    // request ID must share the ONE durable READY receipt and event.
    const recoveryIntent={agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      request_id:'rec_'+(++count),manifest_sha256:recovered.body.manifest_sha256};
    const [pre,concurrentPre]=await Promise.all([
      a.signed('/v7/leadership/reconcile',recoveryIntent),
      a.signed('/v7/leadership/reconcile',recoveryIntent)]);
    assert.equal(pre.code,200,JSON.stringify(pre.body));
    assert.equal(concurrentPre.code,200,JSON.stringify(concurrentPre.body));
    assert.deepEqual(concurrentPre.body,pre.body,
      'Concurrent identical recovery requests must return one durable READY receipt');
    assert.equal(pre.body.phase,'READY');
    const lostRecoveryResponse=await a.signed('/v7/leadership/reconcile',recoveryIntent);
    assert.equal(lostRecoveryResponse.code,200,JSON.stringify(lostRecoveryResponse.body));
    assert.deepEqual(lostRecoveryResponse.body,pre.body,
      'Lost successful READY HTTP response must be recoverable with same request ID');
    const changedRecoveryIntent=await a.signed('/v7/leadership/reconcile',{
      ...recoveryIntent,manifest_sha256:'0'.repeat(64)});
    assert.equal(changedRecoveryIntent.code,409);
    assert.equal(changedRecoveryIntent.body.error_code,'IDEMPOTENCY_KEY_REUSED');
    const newRecoveryIntentAfterReady=await a.signed('/v7/leadership/reconcile',{
      ...recoveryIntent,request_id:'new_recovery_after_ready_'+(++count)});
    assert.equal(newRecoveryIntentAfterReady.code,409);
    assert.equal(newRecoveryIntentAfterReady.body.error_code,'INVALID_PHASE');
    const recoveryAuditDb=await mysql.createConnection({
      host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME});
    try{
      const [ackRows]:any=await recoveryAuditDb.query(
        'SELECT COUNT(*) AS n FROM v7_events '+
        'WHERE event_type="MASTER_RECOVERY_ACK" AND actor=? AND epoch=?',
        [a.agent_id,Number(status.epoch)]);
      assert.equal(Number(ackRows[0].n),1,
        'Two concurrent recovery retries must commit exactly one Master ACK event');
      const [receipts]:any=await recoveryAuditDb.query(
        'SELECT response_json FROM v7_commands WHERE actor=? AND request_id=?',
        [a.agent_id,recoveryIntent.request_id]);
      assert.equal(receipts.length,1);
      assert.deepEqual(typeof receipts[0].response_json==='string'?
        JSON.parse(receipts[0].response_json):receipts[0].response_json,pre.body);
    }finally{await recoveryAuditDb.end();}
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
    const overlappingPlan=await a.signed('/v7/tasks/plan',{
      request_id:'plan_overlapping_scopes_'+(++count),
      agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_nested_scope_denied',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_nested_scope_denied',
      title:'Reject nested scope authority',description:'Duplicate nested write authority',
      risk:'LOW',write_scopes:['src','src/nested.ts'],
      acceptance_criteria:['scope must be unambiguous']});
    assert.equal(overlappingPlan.code,400,JSON.stringify(overlappingPlan.body));
    assert.equal(overlappingPlan.body.error_code,
      'TASK_PLANNING_AMBIGUOUS_SCOPE_OR_DEPENDENCIES');
    const duplicateDependencyPlan=await a.signed('/v7/tasks/plan',{
      request_id:'plan_duplicate_deps_'+(++count),
      agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_duplicate_dep_denied',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_duplicate_dep_denied',
      title:'Reject duplicate task dependency',description:'An existing dependency occurs twice',
      risk:'LOW',write_scopes:['src/unambiguous.ts'],
      dependencies:['ticket_qa_test','ticket_qa_test'],
      acceptance_criteria:['DAG edges must not duplicate']});
    assert.equal(duplicateDependencyPlan.code,400,JSON.stringify(duplicateDependencyPlan.body));
    assert.equal(duplicateDependencyPlan.body.error_code,
      'TASK_PLANNING_AMBIGUOUS_SCOPE_OR_DEPENDENCIES');
    // A plan must have usable criteria and cannot borrow an unrelated approval.
    const validationPlan={agent_id:a.agent_id,expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_plan_validation',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/plan_validation',
      title:'Validate task input',description:'Reject malformed planning data without inserting tickets',
      risk:'HIGH',write_scopes:['src/validation.ts'],acceptance_criteria:['Test passes']};
    for(const [patch,error] of [
      [{acceptance_criteria:['   ']},'MISSING_ACCEPTANCE_CRITERIA'],
      [{acceptance_criteria:['Test passes',' Test passes ']},'TASK_DUPLICATE_ACCEPTANCE_CRITERIA'],
      [{acceptance_criteria:['broken\uD800']},'MISSING_ACCEPTANCE_CRITERIA'],
      [{dependencies:false},'INVALID_TASK_SCOPE'],
      [{dependencies:['ticket_plan_VALIDATION']},'INVALID_TASK_SCOPE'],
      [{dependencies:['ticket_qa_test','TICKET_QA_TEST']},'TASK_PLANNING_AMBIGUOUS_SCOPE_OR_DEPENDENCIES'],
      [{proposal_id:'proposal_nonexistent'},'TASK_INITIAL_APPROVAL_MUST_BE_SERVER_CREATED']
    ] as const){
      const invalid=await a.signed('/v7/tasks/plan',{...validationPlan,...patch,
        request_id:'plan_validation_'+(++count)});
      assert.equal(invalid.code,400,JSON.stringify(invalid.body));
      assert.equal(invalid.body.error_code,error);
    }
    // Reuse the rejected ticket identity: no invalid input may reserve it.
    const validPlan=await a.signed('/v7/tasks/plan',{...validationPlan,
      request_id:'plan_validation_'+(++count)});
    assert.equal(validPlan.code,200,JSON.stringify(validPlan.body));
    assert.equal(validPlan.body.status,'WAITING_AUTHORIZATION');
    assert.equal(validPlan.body.owner_approval_required,true);
    // One Git repository can have separate projects with different base
    // branches, but its ai/* branch namespace must NEVER be duplicated.
    const collisionInProject=await a.signed('/v7/tasks/plan',{
      request_id:'plan_same_repo_branch_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_branch_conflict_local',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_qa_test',
      title:'Different work cannot steal an existing Git branch',
      description:'Independent task with a conflicting branch and separate scope',
      risk:'LOW',write_scopes:['src/separate.ts'],acceptance_criteria:['must not reserve branch']});
    assert.equal(collisionInProject.code,409,JSON.stringify(collisionInProject.body));
    assert.equal(collisionInProject.body.error_code,'TASK_REPOSITORY_BRANCH_ALREADY_RESERVED');
    const duplicateIntent=await a.signed('/v7/tasks/plan',{
      request_id:'plan_same_fingerprint_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_intent_duplicate',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/unique_but_duplicate_intent',
      title:'Implement scoped change',description:'Change a file',risk:'LOW',
      write_scopes:['src/example.ts'],acceptance_criteria:['observable behavior']});
    assert.equal(duplicateIntent.code,409,JSON.stringify(duplicateIntent.body));
    assert.equal(duplicateIntent.body.error_code,'TASK_INTENT_DUPLICATE');
    await owner('CREATE_PROJECT',{project_id:'project_other_base',
      display_name:'Same Repo, Different Base',repository:'example/repo',
      base_branch:'develop'});
    const crossProjectBranch=await a.signed('/v7/tasks/plan',{
      request_id:'plan_same_repo_otherbase_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_branch_conflict_crossbase',project_id:'project_other_base',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_qa_test',
      title:'Cross-base publication collision',description:'Must not reuse remote branch',
      risk:'LOW',write_scopes:['src/another.ts'],acceptance_criteria:['deny conflicting branch']});
    assert.equal(crossProjectBranch.code,409,JSON.stringify(crossProjectBranch.body));
    assert.equal(crossProjectBranch.body.error_code,'TASK_REPOSITORY_BRANCH_ALREADY_RESERVED');
    const crossBaseOverlap=await a.signed('/v7/tasks/plan',{
      request_id:'plan_crossbase_scope_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_crossbase_scope',project_id:'project_other_base',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_crossbase_scope',
      title:'Second base overlapping source',description:'Must not claim source on same repo concurrently',
      risk:'LOW',write_scopes:['src'],
      acceptance_criteria:['Cannot claim while original repository holds overlapping reservation']});
    assert.equal(crossBaseOverlap.code,200,JSON.stringify(crossBaseOverlap.body));
    assert.equal(crossBaseOverlap.body.status,'READY');
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
    await owner('GRANT_PROJECT_AGENT',{project_id:'project_other_base',agent_id:d.agent_id,can_develop:true});
    // Master batch: read-only review, deterministic DAG, exact versioned digest,
    // no partial writes on late collision, one durable receipt on concurrent replay.
    {
      const project_id='project_batch_ci',expected_master_epoch=Number(status.epoch);
      await owner('CREATE_PROJECT',{project_id,display_name:'Batch planning fixture',repository:'example/batch-ci'});
      const catalogBody={agent_id:a.agent_id,expected_master_epoch};
      const catalog=await a.signed('/v7/tasks/plan-batch/projects',catalogBody);
      assert.equal(catalog.code,200,JSON.stringify(catalog.body));
      assert.equal(catalog.body.read_only,true);
      assert.equal(catalog.body.baseline_verified,false);
      assert.equal(catalog.body.automatic_execution_allowed,false);
      assert.deepEqual(catalog.body.projects.find((p:any)=>p.project_id===project_id),
        {project_id,display_name:'Batch planning fixture',repository:'example/batch-ci',base_branch:'main'});
      assert.ok(catalog.body.projects.every((p:any)=>Object.keys(p).sort().join('|')==='base_branch|display_name|project_id|repository'));
      const catalogForeign=await b.signed('/v7/tasks/plan-batch/projects',{...catalogBody,agent_id:b.agent_id});
      assert.equal(catalogForeign.code,409,JSON.stringify(catalogForeign.body));
      const catalogStale=await a.signed('/v7/tasks/plan-batch/projects',{...catalogBody,expected_master_epoch:expected_master_epoch+1});
      assert.equal(catalogStale.code,409);
      const catalogExtra=await a.signed('/v7/tasks/plan-batch/projects',{...catalogBody,project_id});
      assert.equal(catalogExtra.code,400);
      await owner('GRANT_PROJECT_AGENT',{project_id,agent_id:b.agent_id,can_develop:true});
      const task=(suffix:string,scope:string,deps:string[]=[],contract_keys:string[]=[])=>({
        ticket_id:'ticket_batch_'+suffix,baseline_sha:'a'.repeat(40),branch_name:'ai/batch_'+suffix,
        title:'Batch fixture '+suffix,description:'Review scoped implementation '+suffix,
        risk:'LOW',write_scopes:[scope],acceptance_criteria:['Test passes '+suffix],dependencies:deps,contract_keys});
      const first=task('a','src/a.ts'),second=task('b','src/a.ts',[first.ticket_id]),
        third=task('c','src/c.ts',[],['db:inventory']);
      const envelope={agent_id:a.agent_id,project_id,expected_master_epoch,request_id:'batch_'+(++count),
        tasks:[third,second,first]};
      const preview=(data:any)=>a.signed('/v7/tasks/plan-batch/preview',data);
      const db=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
        user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
      const countTickets=async()=>{
        const [r]:any=await db.query('SELECT COUNT(*) n FROM v7_tickets WHERE project_id=?',[project_id]);return Number(r[0].n);
      };
      try{
        const aliasProject=await preview({...envelope,project_id:project_id.toUpperCase()});
        assert.equal(aliasProject.code,404,JSON.stringify(aliasProject.body));
        const staleMaster=await b.signed('/v7/tasks/plan-batch/preview',{...envelope,agent_id:b.agent_id});
        assert.equal(staleMaster.code,409,JSON.stringify(staleMaster.body));
        for(const [tasks,error] of [
          [[first,{...second,dependencies:[]}],'TASK_BATCH_CONFLICT_REQUIRES_DEPENDENCY'],
          [[{...first,dependencies:[second.ticket_id]},second],'TASK_BATCH_DEPENDENCY_CYCLE'],
          [[first,{...second,dependencies:[first.ticket_id.toUpperCase()]}],'TASK_BATCH_DEPENDENCY_ALIAS'],
          [[first,{...second,branch_name:first.branch_name.toUpperCase().replace('AI/','ai/')}],'TASK_BATCH_DUPLICATE_ID_BRANCH_OR_INTENT'],
          [[first,{...second,contract_keys:null}],'TASK_BATCH_TASK_SHAPE_INVALID'],
          [[first,{...third,dependencies:['ticket_missing_batch']}],'INVALID_DEPENDENCY']
        ] as const){
          const invalid=await preview({...envelope,tasks});
          assert.equal(invalid.body.error_code,error,JSON.stringify(invalid.body));
          assert.ok([400,409].includes(invalid.code));
        }
        assert.equal(await countTickets(),0);
        const reviewed=await preview(envelope);
        assert.equal(reviewed.code,200,JSON.stringify(reviewed.body));
        assert.equal(reviewed.body.read_only,true);
        assert.equal(reviewed.body.semantic_discovery_verified,false);
        assert.equal(reviewed.body.baseline_verified,false);
        assert.deepEqual(reviewed.body.plan_order,[first.ticket_id,second.ticket_id,third.ticket_id]);
        assert.equal(reviewed.body.tickets[2].owner_approval_required,true);
        assert.equal((await preview({...envelope,tasks:[first,second,third]})).body.preview_sha256,reviewed.body.preview_sha256);
        assert.equal(await countTickets(),0);
        const commit={...envelope,preview_sha256:reviewed.body.preview_sha256};
        const modified=await a.signed('/v7/tasks/plan-batch',{...commit,tasks:[first,{...second,title:'Modified after review'},third]});
        assert.equal(modified.code,409,JSON.stringify(modified.body));
        assert.equal(modified.body.error_code,'TASK_BATCH_PREVIEW_MISMATCH');
        const accepted=await Promise.all([a.signed('/v7/tasks/plan-batch',commit),a.signed('/v7/tasks/plan-batch',commit)]);
        assert.ok(accepted.every(x=>x.code===200),JSON.stringify(accepted));
        assert.deepEqual(accepted[0].body,accepted[1].body);
        assert.equal(await countTickets(),3);
        const receiptQuery={agent_id:a.agent_id,project_id,request_id:envelope.request_id,
          preview_sha256:reviewed.body.preview_sha256};
        const historical=await a.signed('/v7/tasks/plan-batch/receipt',receiptQuery);
        assert.equal(historical.code,200,JSON.stringify(historical.body));
        assert.equal(historical.body.read_only,true);
        assert.equal(historical.body.historical_receipt,true);
        assert.equal(historical.body.automatic_execution_allowed,false);
        assert.deepEqual(historical.body.receipt,accepted[0].body);
        const wrongDigest=await a.signed('/v7/tasks/plan-batch/receipt',{...receiptQuery,preview_sha256:'0'.repeat(64)});
        assert.equal(wrongDigest.code,409);
        const missing=await a.signed('/v7/tasks/plan-batch/receipt',{...receiptQuery,request_id:'batch_missing_001'});
        assert.equal(missing.code,404);
        const foreign=await b.signed('/v7/tasks/plan-batch/receipt',receiptQuery);
        assert.equal(foreign.code,403);
        const unrelated=await b.signed('/v7/tasks/plan-batch/receipt',{...receiptQuery,agent_id:b.agent_id});
        assert.equal(unrelated.code,404);
        assert.equal(await countTickets(),3);
        const [edges]:any=await db.query('SELECT dependency_id FROM v7_dependencies WHERE ticket_id=?',[second.ticket_id]);
        assert.deepEqual(edges.map((x:any)=>x.dependency_id),[first.ticket_id]);
        const [approvals]:any=await db.query('SELECT kind,state FROM v7_approvals WHERE ticket_id=?',[third.ticket_id]);
        assert.equal(approvals.length,1);assert.equal(approvals[0].kind,'SHARED_CONTRACT');
        const [batchEvents]:any=await db.query('SELECT event_id FROM v7_events WHERE event_type="TASK_BATCH_PLANNED" AND resource_id=?',[project_id]);
        assert.equal(batchEvents.length,1);
        const notReady=await b.signed('/v7/tasks/claim',{agent_id:b.agent_id,ticket_id:second.ticket_id,
          expected_master_epoch,request_id:'batch_dep_claim_'+(++count)});
        assert.equal(notReady.code,409,JSON.stringify(notReady.body));
        assert.equal(notReady.body.error_code,'DEPENDENCY_UNVERIFIED');
        const alias=await a.signed('/v7/tasks/plan',{agent_id:a.agent_id,project_id,expected_master_epoch,
          request_id:'batch_alias_'+(++count),...task('alias','src/alias.ts',[first.ticket_id.toUpperCase()])});
        assert.equal(alias.code,409,JSON.stringify(alias.body));
        assert.equal(alias.body.error_code,'INVALID_DEPENDENCY');
        const nextA=task('d','src/d.ts',[],['event:batch.review']),nextB=task('e','src/e.ts');
        const nextEnvelope={...envelope,request_id:'batch_rollback_'+(++count),tasks:[nextB,nextA]};
        const nextPreview=await preview(nextEnvelope);assert.equal(nextPreview.code,200,JSON.stringify(nextPreview.body));
        // A separate task reserves the later branch between preview and commit.
        const collision=await a.signed('/v7/tasks/plan',{agent_id:a.agent_id,project_id,expected_master_epoch,
          request_id:'batch_collision_'+(++count),...task('collision','src/collision.ts'),branch_name:nextB.branch_name});
        assert.equal(collision.code,200,JSON.stringify(collision.body));
        const rollback=await a.signed('/v7/tasks/plan-batch',{...nextEnvelope,preview_sha256:nextPreview.body.preview_sha256});
        assert.equal(rollback.code,409,JSON.stringify(rollback.body));
        assert.equal(rollback.body.error_code,'TASK_REPOSITORY_BRANCH_ALREADY_RESERVED');
        assert.equal(await countTickets(),4);
        const [partial]:any=await db.query('SELECT ticket_id FROM v7_tickets WHERE ticket_id IN (?,?)',[nextA.ticket_id,nextB.ticket_id]);
        const [partialApprovals]:any=await db.query('SELECT proposal_id FROM v7_approvals WHERE ticket_id=?',[nextA.ticket_id]);
        const [partialEvents]:any=await db.query('SELECT event_id FROM v7_events WHERE event_type="TASK_PLANNED" AND resource_id=?',[nextA.ticket_id]);
        const [partialReceipt]:any=await db.query('SELECT request_id FROM v7_commands WHERE actor=? AND request_id=?',[a.agent_id,nextEnvelope.request_id]);
        assert.equal(partial.length+partialApprovals.length+partialEvents.length+partialReceipt.length,0,'all partial admission and receipt writes roll back');
        // Missing receipt alone is never a grant. Owner can reserve the
        // original key under the same cluster lock, without creating tasks.
        const cancelledKey={agent_id:a.agent_id,project_id,request_id:nextEnvelope.request_id,
          preview_sha256:nextPreview.body.preview_sha256,plan_order:nextPreview.body.plan_order};
        const inspectBatch=(k:any)=>post('/v7/owner/master-batch/inspect',k,admin);
        const cancel=(k:any,request_id='batch_cancel_review_'+(++count))=>post('/v7/owner/command',{
          request_id,command:'CANCEL_MASTER_BATCH_ADMISSION',
          payload:{...k,evidence_reviewed:true,no_retry_confirmed:true}},admin);
        const admittedKey={...receiptQuery,plan_order:reviewed.body.plan_order};
        const admitted=await inspectBatch(admittedKey);
        assert.equal(admitted.code,200,JSON.stringify(admitted.body));
        assert.equal(admitted.body.state,'ADMITTED');assert.equal(admitted.body.owner_cancellation_eligible,false);
        assert.equal((await cancel(admittedKey)).code,409);
        const aliasKey={...cancelledKey,agent_id:a.agent_id.toUpperCase()};
        assert.equal((await inspectBatch(aliasKey)).code,404);
        const conflictKey={...cancelledKey,plan_order:[first.ticket_id,nextA.ticket_id]};
        const conflict=await inspectBatch(conflictKey);
        assert.equal(conflict.code,200);assert.equal(conflict.body.state,'HOLD_TICKET_CONFLICT');
        assert.equal((await cancel(conflictKey)).code,409);
        const missingBefore=await inspectBatch(cancelledKey);
        assert.equal(missingBefore.code,200);assert.equal(missingBefore.body.state,'NO_RECEIPT');
        assert.equal(missingBefore.body.owner_cancellation_eligible,true);
        const noReview=await post('/v7/owner/command',{request_id:'batch_review_denied_'+(++count),
          command:'CANCEL_MASTER_BATCH_ADMISSION',payload:{...cancelledKey,evidence_reviewed:false,no_retry_confirmed:true}},admin);
        assert.equal(noReview.code,400);
        const unauthorized=await post('/v7/owner/master-batch/inspect',cancelledKey,'invalid');
        assert.equal(unauthorized.code,401);
        const ownerRequest='batch_cancel_once_'+(++count);
        const cancellations=await Promise.all([cancel(cancelledKey,ownerRequest),cancel(cancelledKey,ownerRequest)]);
        assert.ok(cancellations.every(x=>x.code===200),JSON.stringify(cancellations));
        assert.deepEqual(cancellations[0].body,cancellations[1].body);
        const resolution=cancellations[0].body.state;
        assert.equal(resolution.state,'ADMISSION_CANCELLED');assert.equal(resolution.automatic_execution_allowed,false);
        assert.equal((await cancel(cancelledKey)).code,409);
        const observed=await inspectBatch(cancelledKey);
        assert.equal(observed.body.state,'ADMISSION_CANCELLED');
        assert.deepEqual(observed.body.resolution,resolution);
        assert.equal(observed.body.owner_cancellation_eligible,false);
        const {plan_order,...originalKey}=cancelledKey;
        const sealed=await a.signed('/v7/tasks/plan-batch/receipt',originalKey);
        assert.equal(sealed.code,200,JSON.stringify(sealed.body));
        assert.deepEqual(sealed.body.resolution,resolution);assert.equal(sealed.body.receipt,undefined);
        assert.equal((await b.signed('/v7/tasks/plan-batch/receipt',originalKey)).code,403);
        assert.equal((await a.signed('/v7/tasks/plan-batch/receipt',{...originalKey,preview_sha256:'0'.repeat(64)})).code,409);
        const delayed=await a.signed('/v7/tasks/plan-batch',{...nextEnvelope,preview_sha256:nextPreview.body.preview_sha256});
        assert.equal(delayed.code,409,JSON.stringify(delayed.body));
        assert.equal(delayed.body.error_code,'IDEMPOTENCY_KEY_REUSED');
        const [cancelEvents]:any=await db.query('SELECT event_id FROM v7_events WHERE event_type="TASK_BATCH_ADMISSION_CANCELLED" AND resource_id=?',[project_id]);
        assert.equal(cancelEvents.length,1);
        assert.equal(await countTickets(),4);

      }finally{await db.end();}
    }
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
    // Expired WORKER lease while Master remains healthy: report through
    // Owner read-only GET, then quarantine explicitly without reassigning.
    const expirePlan=await a.signed('/v7/tasks/plan',{
      request_id:'exp_worker_plan_'+(++count),agent_id:a.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_owner_worker_expiry',project_id:'project_integration',
      baseline_sha:'a'.repeat(40),branch_name:'ai/ticket_owner_worker_expiry',
      title:'Bounded expired worker recovery',description:'Owner review after worker lease expires',
      risk:'LOW',write_scopes:['src/worker-expiry.ts'],
      acceptance_criteria:['Task cannot be reassigned before manual reconciliation']});
    assert.equal(expirePlan.code,200,JSON.stringify(expirePlan.body));
    const expLease=await d.signed('/v7/tasks/claim',{
      request_id:'exp_worker_claim_'+(++count),agent_id:d.agent_id,
      ticket_id:'ticket_owner_worker_expiry',expected_master_epoch:Number(status.epoch)});
    assert.equal(expLease.code,200,JSON.stringify(expLease.body));
    const expCheckpointBody={
      request_id:'exp_worker_checkpoint_'+(++count),agent_id:d.agent_id,
      ticket_id:'ticket_owner_worker_expiry',lease_id:expLease.body.lease_id,
      expected_master_epoch:Number(status.epoch),
      summary:'Evidence retained for Owner after lease expiry',
      next_action:'Do not reassign until externally reviewed'};
    const expCheckpoint=await d.signed('/v7/tasks/checkpoint',expCheckpointBody);
    assert.equal(expCheckpoint.code,200,JSON.stringify(expCheckpoint.body));
    const unauthorizedExpired=await fetch(base+'/v7/owner/worker-expiry');
    assert.equal(unauthorizedExpired.status,401);
    const currentExpired=await fetch(base+'/v7/owner/worker-expiry',{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(currentExpired.status,200);
    const currentView=await currentExpired.json() as any;
    assert.equal(currentView.read_only,true);
    assert.equal(currentView.automatic_reassignment_allowed,false);
    assert.equal(currentView.tickets.some((t:any)=>
      t.ticket_id==='ticket_owner_worker_expiry'),false);
    const prematureQuarantine=await post('/v7/owner/command',{
      request_id:'exp_worker_premature_'+(++count),
      command:'QUARANTINE_EXPIRED_WORKER',payload:{
        ticket_id:'ticket_owner_worker_expiry',
        expected_master_epoch:Number(status.epoch),
        reason:'Owner attempted quarantine before worker lease expired'}},admin);
    assert.equal(prematureQuarantine.code,409,JSON.stringify(prematureQuarantine.body));
    assert.equal(prematureQuarantine.body.error_code,'WORKER_LEASE_NOT_EXPIRED');
    const ownerExpiryDb=await mysql.createConnection({host:'127.0.0.1',
      port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try{
      await ownerExpiryDb.query('UPDATE v7_leases '+
        'SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 SECOND) '+
        'WHERE ticket_id=?',['ticket_owner_worker_expiry']);
      const observed=await fetch(base+'/v7/owner/worker-expiry',{
        headers:{authorization:'Bearer '+admin}});
      assert.equal(observed.status,200);
      const snapshot=await observed.json() as any;
      assert.equal(snapshot.master_live,true);
      const candidate=snapshot.tickets.find((t:any)=>
        t.ticket_id==='ticket_owner_worker_expiry');
      assert.ok(candidate,'Expired worker must be visible to Owner');
      assert.equal(candidate.manual_quarantine_eligible,true);
      assert.equal(candidate.status,'CHECKPOINTED');
      const [unchanged]:any=await ownerExpiryDb.query(
        'SELECT status,version FROM v7_tickets WHERE ticket_id=?',
        ['ticket_owner_worker_expiry']);
      assert.equal(unchanged[0].status,'CHECKPOINTED');
      assert.equal(Number(unchanged[0].version),Number(expCheckpoint.body.version),
        'Read-only Owner GET cannot change task status or version');
      const oldWorkerDenied=await d.signed('/v7/tasks/checkpoint',expCheckpointBody);
      assert.equal(oldWorkerDenied.code,409);
      assert.equal(oldWorkerDenied.body.error_code,'WORKER_LEASE_EXPIRED');
      const incorrectEpoch=await post('/v7/owner/command',{
        request_id:'exp_worker_wrong_epoch_'+(++count),
        command:'QUARANTINE_EXPIRED_WORKER',payload:{
          ticket_id:'ticket_owner_worker_expiry',
          expected_master_epoch:Number(status.epoch)+1,
          reason:'Owner must refuse a stale or invented Master epoch'}},admin);
      assert.equal(incorrectEpoch.code,409);
      assert.equal(incorrectEpoch.body.error_code,'WORKER_QUARANTINE_STALE_EPOCH');
      const quarantinePayload={
        ticket_id:'ticket_owner_worker_expiry',
        expected_master_epoch:Number(status.epoch),
        reason:'Owner reviewed expiry, retained checkpoint and queued external Git proof'};
      const quarantineRequest={
        request_id:'exp_worker_quarantine_'+(++count),
        command:'QUARANTINE_EXPIRED_WORKER',payload:quarantinePayload};
      const quarantined=await post('/v7/owner/command',quarantineRequest,admin);
      assert.equal(quarantined.code,200,JSON.stringify(quarantined.body));
      assert.equal(quarantined.body.state.status,'RECONCILIATION_REQUIRED');
      assert.equal(quarantined.body.state.old_lease_revoked,true);
      assert.equal(quarantined.body.state.checkpoint_preserved,true);
      assert.equal(quarantined.body.state.automatic_reassignment_allowed,false);
      const repeatedQuarantine=await post('/v7/owner/command',quarantineRequest,admin);
      assert.deepEqual(repeatedQuarantine,quarantined,
        'Lost Owner response returns exact original idempotent quarantine receipt');
      const [quarantineRows]:any=await ownerExpiryDb.query(
        'SELECT t.status,t.version,l.revoked FROM v7_tickets t '+
        'JOIN v7_leases l ON l.ticket_id=t.ticket_id WHERE t.ticket_id=?',
        ['ticket_owner_worker_expiry']);
      assert.equal(quarantineRows[0].status,'RECONCILIATION_REQUIRED');
      assert.equal(Number(quarantineRows[0].revoked),1);
      assert.equal(Number(quarantineRows[0].version),
        Number(expCheckpoint.body.version)+1);
      const [checkpointRows]:any=await ownerExpiryDb.query(
        'SELECT COUNT(*) n FROM v7_checkpoints WHERE ticket_id=?',
        ['ticket_owner_worker_expiry']);
      assert.equal(Number(checkpointRows[0].n),1,'Checkpoint evidence retained');
      const refusedRequeue=await post('/v7/owner/command',{
        request_id:'exp_worker_no_remote_proof_'+(++count),
        command:'RECONCILE_TICKET',payload:{ticket_id:'ticket_owner_worker_expiry',
          reason:'Owner must verify remote Git side effects before reopening',
          remote_checked:false}},admin);
      assert.equal(refusedRequeue.code,409,JSON.stringify(refusedRequeue.body));
      assert.equal(refusedRequeue.body.error_code,'REMOTE_RECONCILIATION_REQUIRED');
      const replayAfterQuarantine=await d.signed('/v7/tasks/checkpoint',expCheckpointBody);
      assert.notEqual(replayAfterQuarantine.code,200,
        'Old worker cannot reuse a saved checkpoint ACK after Owner quarantine');
      const reviewedRequeue=await owner('RECONCILE_TICKET',{
        ticket_id:'ticket_owner_worker_expiry',
        reason:'Disposable CI: manually reviewed original lease and external Git side effects',
        remote_checked:true});
      assert.equal(reviewedRequeue.state.status,'READY');
      const expAfter=await fetch(base+'/v7/owner/worker-expiry',{
        headers:{authorization:'Bearer '+admin}});
      const afterView=await expAfter.json() as any;
      assert.equal(afterView.tickets.some((t:any)=>
        t.ticket_id==='ticket_owner_worker_expiry'),false);
    }finally{await ownerExpiryDb.end();}
    // Revoking project access must fence active work even with a healthy Master.
    // Use a separate repository so the fixture cannot interfere with QA tasks.
    {
      const project_id='project_revocation_fixture',ticket_id='ticket_revocation_fixture';
      const agent_id=d.agent_id,expected_master_epoch=Number(status.epoch);
      await owner('CREATE_PROJECT',{project_id,display_name:'Revocation fixture',repository:'example/revocation-fixture'});
      await owner('GRANT_PROJECT_AGENT',{project_id,agent_id,can_develop:true});
      const plan=await a.signed('/v7/tasks/plan',{request_id:'revocation_plan_'+(++count),
        agent_id:a.agent_id,expected_master_epoch,project_id,ticket_id,
        baseline_sha:'a'.repeat(40),branch_name:'ai/revocation_fixture',risk:'LOW',
        title:'Project permission revocation',description:'Check old lease and checkpoint preservation',
        write_scopes:['src/revocation.ts'],acceptance_criteria:['Old worker must lose authority']});
      assert.equal(plan.code,200,JSON.stringify(plan.body));
      const claimBody={request_id:'revocation_claim_'+(++count),agent_id,ticket_id,expected_master_epoch};
      const claimed=await d.signed('/v7/tasks/claim',claimBody);
      assert.equal(claimed.code,200,JSON.stringify(claimed.body));
      const lease_id=claimed.body.lease_id;
      const checkpointBody={request_id:'revocation_cp_'+(++count),agent_id,ticket_id,lease_id,expected_master_epoch,
        summary:'Preserved verified checkpoint',next_action:'Wait for Owner review'};
      const checkpoint=await d.signed('/v7/tasks/checkpoint',checkpointBody);
      assert.equal(checkpoint.code,200,JSON.stringify(checkpoint.body));
      const revoked=await owner('REVOKE_PROJECT_AGENT',{project_id,agent_id});
      assert.equal(revoked.state.quarantined_tasks,1);
      assert.equal(revoked.state.automatic_reassignment_allowed,false);
      const inspect=await mysql.createConnection({host:'127.0.0.1',
        port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
        password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
      try{
        const [state]:any=await inspect.query('SELECT t.status,t.version,l.revoked FROM v7_tickets t JOIN v7_leases l ON l.ticket_id=t.ticket_id WHERE t.ticket_id=?',[ticket_id]);
        assert.equal(state[0].status,'RECONCILIATION_REQUIRED');
        assert.equal(Number(state[0].revoked),1);
        assert.equal(Number(state[0].version),Number(checkpoint.body.version)+1);
        const [cp]:any=await inspect.query('SELECT content_sha256 FROM v7_checkpoints WHERE ticket_id=?',[ticket_id]);
        assert.equal(cp.length,1);
        assert.equal(cp[0].content_sha256,checkpoint.body.content_sha256);
        const [reservation]:any=await inspect.query('SELECT scope FROM v7_reservations WHERE ticket_id=?',[ticket_id]);
        assert.equal(reservation.length,1);
      }finally{await inspect.end();}
      // Regranting access is not permission to reuse a revoked lease.
      await owner('GRANT_PROJECT_AGENT',{project_id,agent_id,can_develop:true});
      for(const [route,body] of [
        ['/v7/tasks/claim',claimBody],
        ['/v7/tasks/checkpoint',checkpointBody],
        ['/v7/tasks/resume-check',{agent_id,ticket_id,lease_id,expected_master_epoch}]
      ] as const){
        const denied=await d.signed(route,body);
        assert.equal(denied.code,403,JSON.stringify(denied.body));
        assert.equal(denied.body.error_code,'WORKER_LEASE_INVALID');
      }
      const reviewed=await owner('RECONCILE_TICKET',{ticket_id,
        reason:'Disposable CI: Owner reviewed external effects after access revocation',remote_checked:true});
      assert.equal(reviewed.state.status,'READY');
      const staleReplay=await d.signed('/v7/tasks/claim',claimBody);
      assert.equal(staleReplay.code,403,JSON.stringify(staleReplay.body));
      // A new claim may inspect the preserved handoff, but may not submit
      // a new candidate using only the previous revoked lease's checkpoint.
      const fresh=await d.signed('/v7/tasks/claim',{...claimBody,request_id:'fresh_claim_'+(++count)});
      assert.equal(fresh.code,200,JSON.stringify(fresh.body));
      assert.notEqual(fresh.body.lease_id,lease_id);
      const handoff=await d.signed('/v7/tasks/resume-check',{agent_id,ticket_id,
        lease_id:fresh.body.lease_id,expected_master_epoch});
      assert.equal(handoff.code,200,JSON.stringify(handoff.body));
      assert.equal(handoff.body.latest_checkpoint.content_sha256,checkpoint.body.content_sha256);
      const staleSubmit=await d.signed('/v7/tasks/submit',{agent_id,ticket_id,
        lease_id:fresh.body.lease_id,expected_master_epoch,request_id:'stale_cp_submit_'+(++count),
        candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40)});
      assert.equal(staleSubmit.code,409,JSON.stringify(staleSubmit.body));
      assert.equal(staleSubmit.body.error_code,'CHECKPOINT_REQUIRED');
      const malformed=await d.signed('/v7/tasks/checkpoint',{...checkpointBody,
        lease_id:fresh.body.lease_id,request_id:'malformed_cp_'+(++count),summary:'\uD800'});
      assert.equal(malformed.code,400,JSON.stringify(malformed.body));
      assert.equal(malformed.body.error_code,'CHECKPOINT_TEXT_INVALID');
      const nextCheckpoint=await d.signed('/v7/tasks/checkpoint',{...checkpointBody,
        lease_id:fresh.body.lease_id,request_id:'fresh_cp_'+(++count),
        summary:'New worker reviewed preserved handoff and current source'});
      assert.equal(nextCheckpoint.code,200,JSON.stringify(nextCheckpoint.body));
      assert.equal(nextCheckpoint.body.generation,checkpoint.body.generation+1);
      await owner('REVOKE_PROJECT_AGENT',{project_id,agent_id});
      await owner('RECONCILE_TICKET',{ticket_id,
        reason:'Disposable CI: close recovered claim after testing checkpoint freshness',remote_checked:true});
    }
    // Distinct paths and base branches still conflict on declared shared
    // API/schema/interface/event resources. Approval does not override a hold.
    {
      const p1='project_contract_primary',p2='project_contract_secondary';
      const expected_master_epoch=Number(status.epoch);
      for(const [project_id,base_branch] of [[p1,'main'],[p2,'develop']]){
        await owner('CREATE_PROJECT',{project_id,display_name:project_id,repository:'example/shared-contract-fixture',base_branch});
      }
      await owner('GRANT_PROJECT_AGENT',{project_id:p1,agent_id:b.agent_id,can_develop:true});
      await owner('GRANT_PROJECT_AGENT',{project_id:p2,agent_id:d.agent_id,can_develop:true});
      const db=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
        user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
      const plan=async(ticket_id:string,project_id:string,contract_keys?:string[])=>a.signed('/v7/tasks/plan',{
        request_id:'contract_plan_'+(++count),agent_id:a.agent_id,expected_master_epoch,
        project_id,ticket_id,branch_name:'ai/'+ticket_id,baseline_sha:'a'.repeat(40),
        risk:'LOW',title:'Contract fixture '+ticket_id,description:'Independent file and shared contract review',
        write_scopes:['src/'+ticket_id+'.ts'],acceptance_criteria:['Preserve declared contract'],
        ...(contract_keys===undefined?{}:{contract_keys})});
      const claim=async(client:any,ticket_id:string)=>client.signed('/v7/tasks/claim',{
        request_id:'contract_claim_'+(++count),agent_id:client.agent_id,ticket_id,expected_master_epoch});
      const approve=async(ticket_id:string)=>{
        const [rows]:any=await db.query('SELECT proposal_id,kind,justification FROM v7_approvals WHERE ticket_id=?',[ticket_id]);
        assert.equal(rows.length,1);
        assert.equal(rows[0].kind,'SHARED_CONTRACT');
        assert.match(rows[0].justification,/Declared shared contracts:/);
        await owner('APPROVE_PROPOSAL',{proposal_id:rows[0].proposal_id});
      };
      const first='ticket_contract_parent',second='ticket_contract_child',third='ticket_contract_disjoint',
        legacy='ticket_contract_unclassified';
      try{
        const malformed=await plan(first,p1,['api:Orders']);
        assert.equal(malformed.code,400);
        assert.equal(malformed.body.error_code,'INVALID_TASK_CONTRACT_KEYS');
        for(const [ticket_id,project_id,keys] of [
          [first,p1,['api:orders']],[second,p2,['api:orders.create']],[third,p2,['api:inventory']]
        ] as const){
          const r=await plan(ticket_id,project_id,[...keys]);
          assert.equal(r.code,200,JSON.stringify(r.body));
          assert.equal(r.body.status,'WAITING_AUTHORIZATION');
        }
        assert.equal((await claim(b,first)).code,409);
        for(const id of [first,second,third])await approve(id);
        assert.equal((await plan(legacy,p2)).code,200);
        const live=await claim(b,first);
        assert.equal(live.code,200,JSON.stringify(live.body));
        const detail=await b.signed('/v7/tasks/detail/'+first,undefined,'GET');
        assert.equal(detail.code,200,JSON.stringify(detail.body));
        assert.deepEqual(detail.body.contract_keys,['api:orders']);
        for(const id of [second,legacy]){
          const refused=await claim(d,id);
          assert.equal(refused.code,409,JSON.stringify(refused.body));
          assert.equal(refused.body.error_code,'SHARED_CONTRACT_CONFLICT');
          const [rows]:any=await db.query('SELECT ticket_id FROM v7_reservations WHERE ticket_id=?',[id]);
          assert.equal(rows.length,0);
        }
        const independent=await claim(d,third);
        assert.equal(independent.code,200,JSON.stringify(independent.body));
        // Revocation preserves the same reservation until explicit reconciliation.
        await owner('REVOKE_PROJECT_AGENT',{project_id:p1,agent_id:b.agent_id});
        await owner('REVOKE_PROJECT_AGENT',{project_id:p2,agent_id:d.agent_id});
        await owner('GRANT_PROJECT_AGENT',{project_id:p2,agent_id:d.agent_id,can_develop:true});
        const held=await claim(d,second);
        assert.equal(held.body.error_code,'SHARED_CONTRACT_CONFLICT');
        for(const id of [first,third])await owner('RECONCILE_TICKET',{ticket_id:id,
          reason:'Disposable CI: independently review declared contract fixture',remote_checked:true});
        const released=await claim(d,second);
        assert.equal(released.code,200,JSON.stringify(released.body));
        await owner('REVOKE_PROJECT_AGENT',{project_id:p2,agent_id:d.agent_id});
        await owner('RECONCILE_TICKET',{ticket_id:second,
          reason:'Disposable CI: clean up contract fixture after release',remote_checked:true});
      }finally{await db.end();}
    }
    const claimPayload={request_id:'claim_'+(++count),agent_id:b.agent_id,
      expected_master_epoch:Number(status.epoch),ticket_id:'ticket_qa_test'};
    const claim=await b.signed('/v7/tasks/claim',claimPayload);
    assert.equal(claim.code,200,JSON.stringify(claim.body));
    const crossBaseDenied=await d.signed('/v7/tasks/claim',{
      request_id:'crossbase_claim_denied_'+(++count),agent_id:d.agent_id,
      expected_master_epoch:Number(status.epoch),
      ticket_id:'ticket_crossbase_scope'});
    assert.equal(crossBaseDenied.code,409,JSON.stringify(crossBaseDenied.body));
    assert.equal(crossBaseDenied.body.error_code,'SCOPE_CONFLICT',
      'Different base branches in the same repo cannot claim nested/overlapping source');
    const originalStillLive=await b.signed('/v7/tasks/detail/ticket_qa_test',undefined,'GET');
    assert.equal(originalStillLive.code,200);
    assert.equal(originalStillLive.body.status,'CLAIMED',
      'Rejected cross-base claim does not mutate the first worker ticket');
    // Provider registry uses non-secret Owner declarations, never provider login proof.
    {
      const key='SUTRADHAR_PROVIDER_MAPPINGS_JSON',prior=process.env[key];
      const binding={project_id:'project_integration',agent_id:b.agent_id,
        provider:'CHATGPT_WEB',account_ref:'account_fixture',workspace_ref:'workspace_fixture'};
      try{
        process.env[key]=JSON.stringify([binding]);
        const path='/v7/tasks/detail/ticket_qa_test';
        const own=await b.signed(path,undefined,'GET');
        assert.equal(own.code,200,JSON.stringify(own.body));
        assert.equal(own.body.provider_mapping_state,'OWNER_DECLARED_UNVERIFIED');
        assert.equal(own.body.provider_mappings.length,1);
        assert.equal(own.body.provider_mappings[0].workspace_ref,binding.workspace_ref);
        assert.equal(own.body.provider_mappings[0].provider_mapping_verified,false);
        assert.equal(own.body.provider_mappings[0].automatic_execution_allowed,false);
        const other=await c.signed(path,undefined,'GET');
        assert.equal(other.code,200,JSON.stringify(other.body));
        assert.equal(other.body.provider_mapping_state,'NOT_APPLICABLE');
        assert.deepEqual(other.body.provider_mappings,[]);
        process.env[key]=JSON.stringify([binding,{...binding,project_id:'project_other_base'}]);
        const invalid=await b.signed(path,undefined,'GET');
        assert.equal(invalid.code,200);
        assert.equal(invalid.body.provider_mapping_state,'INVALID_OWNER_CONFIGURATION');
        assert.deepEqual(invalid.body.provider_mappings,[]);
        delete process.env[key];
        const missing=await b.signed(path,undefined,'GET');
        assert.equal(missing.code,200);
        assert.equal(missing.body.provider_mapping_state,'UNCONFIGURED');
        const registryPath='/v7/owner/provider-registry';
        const readRegistry=async()=>{
          const response=await fetch(base+registryPath,{headers:{authorization:'Bearer '+admin}});
          assert.equal(response.status,200);
          return await response.json() as any;
        };
        assert.equal((await fetch(base+registryPath)).status,401);
        const initial=await readRegistry();
        assert.equal(initial.version,0);
        assert.equal(initial.legacy_fallback_active,true);
        const replace=(expected_version:number,bindings:any[],request_id='provider_registry_'+(++count))=>
          post('/v7/owner/command',{request_id,command:'REPLACE_PROVIDER_REGISTRY',payload:{expected_version,bindings}},admin);
        const invalidGrant=await replace(0,[{...binding,agent_id:c.agent_id}]);
        assert.equal(invalidGrant.code,409,JSON.stringify(invalidGrant.body));
        assert.equal(invalidGrant.body.error_code,'PROVIDER_REGISTRY_GRANT_REQUIRED');
        const alias=await replace(0,[{...binding,project_id:'PROJECT_INTEGRATION'}]);
        assert.equal(alias.code,409,JSON.stringify(alias.body));
        assert.equal((await readRegistry()).version,0);
        const request='provider_replace_fixture_'+(++count);
        const [first,retry]=await Promise.all([replace(0,[binding],request),replace(0,[binding],request)]);
        assert.equal(first.code,200,JSON.stringify(first.body));
        assert.deepEqual(retry,first,'Identical request returns one durable receipt');
        assert.equal(first.body.state.registry_version,1);
        assert.equal(first.body.state.provider_mapping_verified,false);
        assert.equal(first.body.state.automatic_execution_allowed,false);
        const stored=await readRegistry();
        assert.equal(stored.version,1);
        assert.equal(stored.source,'MYSQL_OWNER_REGISTRY');
        assert.deepEqual(stored.bindings,[binding]);
        assert.equal(stored.registry_sha256,first.body.state.registry_sha256);
        const stale=await replace(0,[]);
        assert.equal(stale.code,409);
        assert.equal(stale.body.error_code,'PROVIDER_REGISTRY_VERSION_CONFLICT');
        process.env[key]=JSON.stringify([{...binding,workspace_ref:'workspace_other'}]);
        const durable=await b.signed(path,undefined,'GET');
        assert.equal(durable.code,200,JSON.stringify(durable.body));
        assert.equal(durable.body.provider_mapping_source,'MYSQL_OWNER_REGISTRY');
        assert.equal(durable.body.provider_registry_version,1);
        assert.equal(durable.body.provider_mappings[0].workspace_ref,binding.workspace_ref);
        const hidden=await c.signed(path,undefined,'GET');
        assert.equal(hidden.body.provider_mapping_source,'NOT_APPLICABLE');
        assert.equal(hidden.body.provider_registry_version,null);
        assert.deepEqual(hidden.body.provider_mappings,[]);
        // Competing replacements of the SAME version: one wins, one is stale.
        const outcomes=await Promise.all([replace(1,[]),replace(1,[])]);
        assert.deepEqual(outcomes.map(x=>x.code).sort(),[200,409]);
        const cleared=await readRegistry();
        assert.equal(cleared.version,2);
        assert.equal(cleared.legacy_fallback_active,false);
        assert.deepEqual(cleared.bindings,[]);
        const deniedFallback=await b.signed(path,undefined,'GET');
        assert.equal(deniedFallback.code,200,JSON.stringify(deniedFallback.body));
        assert.equal(deniedFallback.body.provider_mapping_source,'MYSQL_OWNER_REGISTRY');
        assert.equal(deniedFallback.body.provider_registry_version,2);
        assert.equal(deniedFallback.body.provider_mapping_state,'UNCONFIGURED');
        assert.deepEqual(deniedFallback.body.provider_mappings,[]);
        // An old successful replacement receipt must not resurrect mappings.
        assert.deepEqual(await replace(0,[binding],request),first);
        assert.equal((await readRegistry()).version,2);
        const registryDb=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
          user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
        try{
          const [ledger]:any=await registryDb.query('SELECT payload_json FROM v7_events WHERE event_type="PROVIDER_REGISTRY_REPLACED" ORDER BY event_id');
          assert.equal(ledger.length,2,'Replays and rejected replacements cannot append extra snapshots');
        }finally{await registryDb.end();}

      }finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
    }
    // Manual provider recovery fixture reuses a reconciled independent ticket.
    // Never connects to a real provider or records credentials/prompt contents.
    {
      const project_id='project_revocation_fixture',ticket_id='ticket_revocation_fixture',
        agent_id=d.agent_id,expected_master_epoch=Number(status.epoch);
      await owner('GRANT_PROJECT_AGENT',{project_id,agent_id,can_develop:true});
      const binding={project_id,agent_id,provider:'CHATGPT_WEB',account_ref:'account_attempt',workspace_ref:'workspace_attempt'};
      const registry=await owner('REPLACE_PROVIDER_REGISTRY',{expected_version:2,bindings:[binding]});
      assert.equal(registry.state.registry_version,3);
      const claim=await d.signed('/v7/tasks/claim',{request_id:'provider_claim_'+(++count),agent_id,ticket_id,expected_master_epoch});
      assert.equal(claim.code,200,JSON.stringify(claim.body));
      const common={agent_id,ticket_id,lease_id:claim.body.lease_id,expected_master_epoch};
      const cp=async()=>d.signed('/v7/tasks/checkpoint',{...common,request_id:'provider_cp_'+(++count),
        summary:'Manual provider checkpoint fixture',next_action:'Review external session independently'});
      const first=await cp();assert.equal(first.code,200,JSON.stringify(first.body));
      const path='/v7/tasks/detail/'+ticket_id;
      const detail=await d.signed(path,undefined,'GET');
      assert.equal(detail.code,200);
      const begin={...common,action:'BEGIN',request_id:'provider_begin_'+(++count),registry_version:3,expected_task_version:Number(detail.body.version),
        provider:binding.provider,binding_sha256:detail.body.provider_mappings[0].binding_sha256,
        checkpoint_generation:first.body.generation,checkpoint_sha256:first.body.content_sha256,context_sha256:'d'.repeat(64)};
      const staleVersion=await d.signed('/v7/tasks/provider-attempt',{...begin,expected_task_version:begin.expected_task_version-1});
      assert.equal(staleVersion.code,409,JSON.stringify(staleVersion.body));
      assert.equal(staleVersion.body.error_code,'PROVIDER_ATTEMPT_TASK_VERSION_CONFLICT');
      const wrong=await d.signed('/v7/tasks/provider-attempt',{...begin,registry_version:2});
      assert.equal(wrong.code,409,JSON.stringify(wrong.body));
      const opened=await d.signed('/v7/tasks/provider-attempt',begin);
      assert.equal(opened.code,200,JSON.stringify(opened.body));
      assert.equal(opened.body.attempt.state,'OPEN');
      assert.equal(opened.body.provider_sent,false);
      assert.deepEqual((await d.signed('/v7/tasks/provider-attempt',begin)).body,opened.body);
      const duplicate=await d.signed('/v7/tasks/provider-attempt',{...begin,request_id:'provider_duplicate_'+(++count)});
      assert.equal(duplicate.code,423);
      const attempt_id=opened.body.attempt.attempt_id;
      const observe=async()=>{
        const response=await fetch(base+'/v7/owner/provider-attempt/'+ticket_id,{headers:{authorization:'Bearer '+admin}});
        assert.equal(response.status,200);
        const data=await response.json() as any;
        assert.equal(data.automatic_reassignment_allowed,false);
        return data;
      };
      assert.equal((await observe()).owner_resolution_eligible,false,'Live lease cannot be closed by Owner recovery');
      const interrupted=await d.signed('/v7/tasks/provider-attempt',{...common,action:'INTERRUPT',attempt_id,request_id:'provider_interrupt_'+(++count)});
      assert.equal(interrupted.code,200,JSON.stringify(interrupted.body));
      assert.equal(interrupted.body.attempt.state,'INTERRUPTED');
      const blocked=await d.signed('/v7/tasks/submit',{...common,request_id:'provider_blocked_submit_'+(++count),candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40)});
      assert.equal(blocked.code,423);
      assert.equal(blocked.body.error_code,'PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED');
      const close={...common,action:'CLOSE',attempt_id,request_id:'provider_close_'+(++count),external_session_reviewed:true,worktree_reviewed:true};
      const premature=await d.signed('/v7/tasks/provider-attempt',close);
      assert.equal(premature.code,409);
      assert.equal(premature.body.error_code,'PROVIDER_ATTEMPT_FRESH_CHECKPOINT_REQUIRED');
      const fresh=await cp();assert.equal(fresh.code,200);
      const closed=await d.signed('/v7/tasks/provider-attempt',close);
      assert.equal(closed.code,200,JSON.stringify(closed.body));
      assert.equal(closed.body.attempt.resolution,'WORKER_CHECKPOINT');
      const again=await d.signed('/v7/tasks/provider-attempt',{...begin,request_id:'provider_second_'+(++count),
        expected_task_version:Number(fresh.body.version),checkpoint_generation:fresh.body.generation,checkpoint_sha256:fresh.body.content_sha256});
      assert.equal(again.code,200,JSON.stringify(again.body));
      await owner('REVOKE_PROJECT_AGENT',{project_id,agent_id});
      const reconcile={ticket_id,reason:'Disposable CI: reconcile interrupted provider record',remote_checked:true};
      const held=await post('/v7/owner/command',{request_id:'provider_held_'+(++count),command:'RECONCILE_TICKET',payload:reconcile},admin);
      assert.equal(held.code,423,JSON.stringify(held.body));
      const ownerView=await fetch(base+'/v7/owner/provider-attempt/'+ticket_id,{headers:{authorization:'Bearer '+admin}});
      assert.equal(ownerView.status,200);
      const ownerObservation=await ownerView.json() as any;
      assert.equal(ownerObservation.attempt.attempt_id,again.body.attempt.attempt_id);
      assert.equal(ownerObservation.owner_resolution_eligible,true);
      const resolved=await owner('RESOLVE_PROVIDER_ATTEMPT',{ticket_id,attempt_id:again.body.attempt.attempt_id,
        external_session_reviewed:true,worktree_reviewed:true,no_automatic_retry_confirmed:true});
      assert.equal(resolved.state.automatic_reassignment_allowed,false);
      const closedObservation=await observe();
      assert.equal(closedObservation.owner_resolution_eligible,false);
      assert.equal(closedObservation.attempt.resolution,'OWNER_REVIEW');
      assert.equal((await owner('RECONCILE_TICKET',reconcile)).state.status,'READY');
      await owner('REPLACE_PROVIDER_REGISTRY',{expected_version:3,bindings:[]});
    }
    // Replaying the identical durable claim after a lost HTTP reply MUST
    // return the original lease, never create another lease or worktree.
    const recoveredClaim=await b.signed('/v7/tasks/claim',claimPayload);
    assert.equal(recoveredClaim.code,200,JSON.stringify(recoveredClaim.body));
    assert.deepEqual(recoveredClaim.body,claim.body);
    // Packaged heartbeats report ONLINE. Central must use authoritative
    // lease/ticket state, never allow ONLINE to erase an active assignment.
    // Disposable MySQL proof: GETs preserve stale nonces; a healthy accepted
    // heartbeat prunes ONLY after reviewed v8 version and physical index exist.
    const nonceDb=await mysql.createConnection({host:'127.0.0.1',
      port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try{
      const oldNonce='nonce_ci_two_hours_old';
      await nonceDb.query('INSERT INTO v7_nonces(node_id,nonce,received_at) '+
        'VALUES(?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR))',
        [b.node_id,oldNonce]);
      const readOnly=await b.signed('/v7/cluster/state',undefined,'GET');
      assert.equal(readOnly.code,200,JSON.stringify(readOnly.body));
      const [before]:any=await nonceDb.query(
        'SELECT COUNT(*) n FROM v7_nonces WHERE node_id=? AND nonce=?',
        [b.node_id,oldNonce]);
      assert.equal(Number(before[0].n),1,'Signed GET must not prune any nonce');
      for(let n=0;n<5;n++){
        const observed=await b.heartbeat(Number(status.epoch));
        assert.equal(observed.code,200,JSON.stringify(observed.body));
      }
      const [beforeMigration]:any=await nonceDb.query(
        'SELECT COUNT(*) n FROM v7_nonces WHERE node_id=? AND nonce=?',
        [b.node_id,oldNonce]);
      assert.equal(Number(beforeMigration[0].n),1,
        'Unindexed v7 baseline refuses full-table nonce pruning');
      // Disposable MySQL ONLY: simulate the reviewed v8 nonce-age index.
      // Neither a fake version nor an index alone suffices for cleanup.
      await nonceDb.query('INSERT INTO v7_schema_versions(version) VALUES(8)');
      try{
        const missingIndex=await b.heartbeat(Number(status.epoch));
        assert.equal(missingIndex.code,503,
          'Central refuses incomplete v8 schema before mutation');
        assert.equal(missingIndex.body.error_code,'SCHEMA_V8_MIGRATION_INCOMPLETE');
        await nonceDb.query('CREATE INDEX idx_nonce_received_at ON v7_nonces (received_at)');
        try{
          const missingAudit=await b.heartbeat(Number(status.epoch));
          assert.equal(missingAudit.code,503,
            'Physical index alone is not migration review evidence');
          await nonceDb.query(
            'INSERT INTO v7_migration_audit(migration_id,source_sha256,record_counts,destination_counts) '+
            'VALUES(?,?,?,?)',['schema_version_8',REVIEWED_V8_MIGRATION_SHA256,
              JSON.stringify({status:'STARTED',backup_receipt_sha256:'b'.repeat(64)}),
              JSON.stringify({status:'DDL_COMPLETE_UNVERIFIED',statements:1})]);
          try{
            for(let n=0;n<5;n++){
              const observed=await b.heartbeat(Number(status.epoch));
              assert.equal(observed.code,200,JSON.stringify(observed.body));
            }
            const [after]:any=await nonceDb.query(
              'SELECT COUNT(*) n FROM v7_nonces WHERE node_id=? AND nonce=?',
              [b.node_id,oldNonce]);
            assert.equal(Number(after[0].n),0,
              'Reviewed-shape indexed v8 heartbeat reclaims stale nonce');
            const [fresh]:any=await nonceDb.query(
              'SELECT COUNT(*) n FROM v7_nonces WHERE node_id=? AND '+
              'received_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE)',[b.node_id]);
            assert.ok(Number(fresh[0].n)>=1,'Recent replay-protection records survive');
          }finally{
            await nonceDb.query('DELETE FROM v7_migration_audit WHERE migration_id=?',
              ['schema_version_8']);
          }
        }finally{
          await nonceDb.query('DROP INDEX idx_nonce_received_at ON v7_nonces');
        }
      }finally{
        await nonceDb.query('DELETE FROM v7_schema_versions WHERE version=8');
      }
    }finally{await nonceDb.end();}
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
    assert.equal(resumeProof.body.lease_id,claim.body.lease_id,
      'Central must echo the same live lease verified under MySQL lock');
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
    const checkpointBody={request_id:'check_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch),
      summary:'completed and review pending',next_action:'independent QA'};
    const checkpoint=await b.signed('/v7/tasks/checkpoint',checkpointBody);
    assert.equal(checkpoint.code,200,JSON.stringify(checkpoint.body));
    assert.equal(checkpoint.body.lease_id,claim.body.lease_id);
    assert.equal(checkpoint.body.automatic_execution_allowed,false);
    const checkpointReplay=await b.signed('/v7/tasks/checkpoint',checkpointBody);
    assert.equal(checkpointReplay.code,200,JSON.stringify(checkpointReplay.body));
    assert.deepEqual(checkpointReplay.body,checkpoint.body,
      'same live lease and request ID must replay one checkpoint receipt');
    const submittedBody={request_id:'submit2_'+(++count),agent_id:b.agent_id,
      ticket_id:'ticket_qa_test',lease_id:claim.body.lease_id,expected_master_epoch:Number(status.epoch),
      candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40)};
    const submitted=await b.signed('/v7/tasks/submit',submittedBody);
    assert.equal(submitted.code,200,JSON.stringify(submitted.body));
    assert.equal(submitted.body.agent_id,b.agent_id);
    assert.equal(submitted.body.lease_id,claim.body.lease_id);
    assert.equal(submitted.body.epoch,Number(status.epoch));
    assert.equal(submitted.body.candidate_head_sha,'b'.repeat(40));
    assert.equal(submitted.body.candidate_tree_sha,'c'.repeat(40));
    assert.equal(submitted.body.automatic_execution_allowed,false);
    assert.equal(submitted.body.status,'SUBMITTED_FOR_REVIEW');
    assert.ok(Number.isSafeInteger(submitted.body.version));
    const submittedDetail=await b.signed('/v7/tasks/detail/ticket_qa_test',undefined,'GET');
    assert.equal(submittedDetail.code,200,JSON.stringify(submittedDetail.body));
    assert.equal(submittedDetail.body.version,submitted.body.version);
    assert.equal(submittedDetail.body.candidate_head_sha,submitted.body.candidate_head_sha);
    assert.equal(submittedDetail.body.candidate_tree_sha,submitted.body.candidate_tree_sha);
    const submittedReplay=await b.signed('/v7/tasks/submit',submittedBody);
    assert.equal(submittedReplay.code,200,JSON.stringify(submittedReplay.body));
    assert.deepEqual(submittedReplay.body,submitted.body,
      'same live lease and request ID must replay one submit receipt');
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
    const pendingReview=await c.signed('/v7/tasks/qa-review/'+reviewedId,
      undefined,'GET');
    assert.equal(pendingReview.code,200,JSON.stringify(pendingReview.body));
    assert.equal(pendingReview.body.owner_review_state,'PENDING');
    assert.equal(pendingReview.body.qa_receipt_recorded,false);
    assert.equal(pendingReview.body.qa_receipt_id,null);
    assert.equal(pendingReview.body.manual_next_action,'WAIT_FOR_OWNER_REVIEW');
    assert.equal(pendingReview.body.automatic_qa_receipt_allowed,false);
    const otherNodeReview=await b.signed('/v7/tasks/qa-review/'+reviewedId,
      undefined,'GET');
    assert.notEqual(otherNodeReview.code,200,'Other device cannot inspect QA review');
    const unsignedReview=await fetch(base+'/v7/tasks/qa-review/'+reviewedId);
    // Missing x-sutradhar-node is rejected by requireId() before signature
    // verification; the API uses HTTP 400 for this malformed request.
    assert.equal(unsignedReview.status,400);
    const unsignedResult=await unsignedReview.json() as any;
    assert.notEqual(unsignedResult.review_proposal_id,reviewedId,
      'Unauthenticated response must not expose QA review evidence');
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
    // Read-only crash evidence on the developer PC sees Owner QA-review
    // backlog even while the QA device is independent of that worker.
    const workerEffectsPending=await fetch(base+'/v7/owner/node-recovery/'+b.node_id,{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(workerEffectsPending.status,200);
    const pendingWorker=(await workerEffectsPending.json() as any).historical_effects;
    assert.equal(pendingWorker.pending_qa_owner_reviews_for_worker_tickets_count,1);
    assert.ok(pendingWorker.pending_qa_owner_reviews_global_count>=1);
    assert.equal(pendingWorker.qa_effects_independently_reconciled,false);
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
    const approvedReview=await c.signed('/v7/tasks/qa-review/'+reviewedId,
      undefined,'GET');
    assert.equal(approvedReview.code,200,JSON.stringify(approvedReview.body));
    assert.equal(approvedReview.body.owner_review_state,'APPROVED');
    assert.equal(approvedReview.body.qa_receipt_recorded,false);
    assert.equal(approvedReview.body.qa_receipt_id,null);
    assert.equal(approvedReview.body.manual_next_action,
      'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE');
    const wrongEvidenceReceipt=await c.signed('/v7/tasks/qa-receipt',{
      ...receiptBody,request_id:'qa_wrong_hash_'+(++count),
      evidence_sha256:'f'.repeat(64),evidence_ref:'sha256:'+'f'.repeat(64)});
    assert.equal(wrongEvidenceReceipt.code,409,JSON.stringify(wrongEvidenceReceipt.body));
    assert.equal(wrongEvidenceReceipt.body.error_code,'QA_VERIFIED_EVIDENCE_MISMATCH');
    const qa=await c.signed('/v7/tasks/qa-receipt',receiptBody);
    assert.equal(qa.code,200,JSON.stringify(qa.body));
    const qaAgain=await c.signed('/v7/tasks/qa-receipt',receiptBody);
    assert.deepEqual(qaAgain,qa,'Only identical approved QA receipt is idempotent');
    const recordedReview=await c.signed('/v7/tasks/qa-review/'+reviewedId,
      undefined,'GET');
    assert.equal(recordedReview.code,200,JSON.stringify(recordedReview.body));
    assert.equal(recordedReview.body.qa_receipt_recorded,true);
    assert.equal(recordedReview.body.qa_receipt_id,qa.body.receipt_id);
    assert.equal(recordedReview.body.task_status,'INTEGRATING');
    assert.equal(recordedReview.body.manual_next_action,
      'RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY');
    assert.equal(recordedReview.body.git_published,false);
    const qaEvidenceSnapshot=await fetch(base+'/v7/owner/node-recovery/'+c.node_id,{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(qaEvidenceSnapshot.status,200);
    const qaEffect=(await qaEvidenceSnapshot.json() as any).historical_effects;
    assert.equal(qaEffect.qa_receipts_created_by_this_pc_count,1);
    assert.equal(qaEffect.qa_effects_independently_reconciled,false);
    const workerQaAfter=await fetch(base+'/v7/owner/node-recovery/'+b.node_id,{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(workerQaAfter.status,200);
    assert.equal((await workerQaAfter.json() as any)
      .historical_effects.qa_receipts_on_worker_tickets_for_this_pc_count,1);
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
    // A real one-shot reserved Git job must remain visible to a crashed
    // developer even though the QA actor belongs to a different node.
    const workerGitEffect=await fetch(base+'/v7/owner/node-recovery/'+b.node_id,{
      headers:{authorization:'Bearer '+admin}});
    assert.equal(workerGitEffect.status,200);
    const workerGitSnapshot=await workerGitEffect.json() as any;
    assert.equal(workerGitSnapshot.unresolved_git_job_count,1);
    assert.equal(workerGitSnapshot.historical_effects
      .centrally_confirmed_git_jobs_involving_this_pc_count,0);
    assert.equal(workerGitSnapshot.historical_effects
      .external_git_effects_independently_reconciled,false);
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
      // Inject fault conditions into disposable MySQL: a completed/failed
      // ticket can retain an old lease after worker submission. A Master
      // promotion must never corrupt terminal state or bump its version.
      const synthetic=[
        {ticket:'ticket_done_failover_hold',state:'DONE'},
        {ticket:'ticket_failed_failover_hold',state:'TEST_FAILED'},
        {ticket:'ticket_reconciling_failover_hold',state:'RECONCILIATION_REQUIRED'},
        {ticket:'ticket_submitted_failover_hold',state:'SUBMITTED_FOR_REVIEW',candidate:true},
        {ticket:'ticket_checkpoint_failover_hold',state:'CHECKPOINTED'}
      ];
      for(let idx=0;idx<synthetic.length;idx++){
        const row=synthetic[idx];
        const fingerprint=crypto.createHash('sha256').update(row.ticket).digest('hex');
        await db.query('INSERT INTO v7_tickets '+
          '(ticket_id,project_id,creator_agent_id,fingerprint,created_epoch,title,'+
          'description,baseline_sha,branch_name,risk,scopes_json,criteria_json,'+
          'status,worker_agent_id,candidate_head_sha,candidate_tree_sha) '+
          'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [row.ticket,'project_integration',a.agent_id,fingerprint,Number(status.epoch),
            'Failover state regression '+idx,'Disposable terminal/active lease fixture',
            'a'.repeat(40),'ai/'+row.ticket,'LOW',
            JSON.stringify(['src/failover-fixture-'+idx+'.ts']),
            JSON.stringify(['must preserve correct recovery state']),row.state,
            d.agent_id,row.candidate?'b'.repeat(40):null,
            row.candidate?'c'.repeat(40):null]);
        await db.query('INSERT INTO v7_leases '+
          '(ticket_id,agent_id,epoch,lease_id,expires_at,revoked) '+
          'VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 600 SECOND),0)',
          [row.ticket,d.agent_id,Number(status.epoch),
            'deadbeef-0000-4000-8000-'+String(idx).padStart(12,'0')]);
      }
      await db.query('UPDATE v7_cluster SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE singleton=1');
      await db.query('UPDATE v7_agents SET last_seen=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 400 SECOND) WHERE agent_id=?',
        [a.agent_id]);
      // An Owner's GET-only physical pilot must NEVER elect the next Master
      // or fence worker leases. Before this regression, /v7/cluster called
      // evaluate() even on a read-only snapshot and could cause promotion.
      const [beforeSnapshotRows]:any=await db.query(
        'SELECT epoch,master_agent_id,phase,version,lease_until FROM v7_cluster WHERE singleton=1');
      const [beforeEventRows]:any=await db.query(
        'SELECT COUNT(*) AS n FROM v7_events WHERE event_type="MASTER_PROMOTED"');
      const [beforeLeaseRows]:any=await db.query(
        'SELECT COUNT(*) AS n FROM v7_leases WHERE revoked=1');
      const unauthenticatedSafety=await fetch(base+'/v7/owner/leadership-safety');
      assert.equal(unauthenticatedSafety.status,401,
        'Leader safety diagnostics expose enrolled machine state only to Owner');
      const safetyViews=await Promise.all(Array.from({length:4},()=>
        fetch(base+'/v7/owner/leadership-safety',{
          headers:{authorization:'Bearer '+admin}})));
      for(const response of safetyViews){
        assert.equal(response.status,200);
        const observed=await response.json() as any;
        assert.equal(observed.mode,'OWNER_READ_ONLY_LEADERSHIP_SAFETY');
        assert.equal(observed.master_agent_id,a.agent_id);
        assert.equal(observed.epoch,Number(status.epoch));
        assert.equal(observed.lease_expired,true);
        assert.ok(observed.reason_codes.includes(
          'MASTER_LEASE_EXPIRED_AWAITING_SIGNED_HEARTBEAT'));
        for(const f of ['read_only','physical_machine_verified',
          'automatic_promotion_allowed','restart_authorized',
          'production_release_authorized','central_state_modified']){
          assert.equal(observed[f],f==='read_only',f);
        }
        assert.equal(JSON.stringify(observed).includes(admin),false);
      }
      const observation=await Promise.all(Array.from({length:4},()=>fetch(base+'/v7/cluster',{
        headers:{authorization:'Bearer '+admin}})));
      for(const response of observation){
        assert.equal(response.status,200);
        const visible=(await response.json() as any).cluster;
        assert.equal(visible.master_agent_id,a.agent_id,
          'Read-only snapshot must report expired Master as recorded, not elect');
        assert.equal(Number(visible.epoch),Number(status.epoch));
      }
      // A signed node's read-only cluster-state GET and an Owner/Telegram
      // STATUS command must be unable to force a takeover either.
      const signedView=await b.signed('/v7/cluster/state',undefined,'GET');
      assert.equal(signedView.code,200,JSON.stringify(signedView.body));
      assert.equal(signedView.body.master_agent_id,a.agent_id);
      assert.equal(Number(signedView.body.epoch),Number(status.epoch));
      const ownerView=await owner('STATUS',{});
      assert.equal(ownerView.state.cluster.master_agent_id,a.agent_id);
      assert.equal(Number(ownerView.state.cluster.epoch),Number(status.epoch));
      const [afterSnapshotRows]:any=await db.query(
        'SELECT epoch,master_agent_id,phase,version,lease_until FROM v7_cluster WHERE singleton=1');
      const [afterEventRows]:any=await db.query(
        'SELECT COUNT(*) AS n FROM v7_events WHERE event_type="MASTER_PROMOTED"');
      const [afterLeaseRows]:any=await db.query(
        'SELECT COUNT(*) AS n FROM v7_leases WHERE revoked=1');
      assert.deepEqual(afterSnapshotRows,beforeSnapshotRows,
        'Owner cluster GET cannot write epoch, phase, lease or version');
      assert.equal(Number(afterEventRows[0].n),Number(beforeEventRows[0].n),
        'Read-only physical capture cannot create promotion audit events');
      assert.equal(Number(afterLeaseRows[0].n),Number(beforeLeaseRows[0].n),
        'Read-only Owner inspection cannot revoke existing worker leases');
      const staleNode=await a.signed('/v7/nodes/me',undefined,'GET');
      assert.equal(staleNode.code,200,JSON.stringify(staleNode.body));
      assert.ok(Number(staleNode.body.agents[0].heartbeat_age_seconds)>=399,
        'Maintenance read endpoint must use MySQL server clock, not local uptime');
      // Backup-1 and Backup-2 have separate node keys and may heartbeat at
      // the SAME moment after Master-1 expires. The MySQL leader row must
      // serialize a SINGLE promotion, preserving the intended backup order.
      const [promoted,simultaneousBackup2]=await Promise.all([
        b.heartbeat(Number(status.epoch)),
        c.heartbeat(Number(status.epoch))]);
      assert.equal(promoted.code,200,JSON.stringify(promoted.body));
      assert.equal(simultaneousBackup2.code,200,JSON.stringify(simultaneousBackup2.body));
      for(const received of [promoted,simultaneousBackup2]){
        assert.equal(received.body.master_agent_id,b.agent_id,
          'Concurrent backup heartbeats must both observe first-eligible Backup-1');
        assert.equal(received.body.phase,'RECOVERING');
        assert.equal(Number(received.body.epoch),Number(status.epoch)+1);
      }
      const [failoverTicketRows]:any=await db.query(
        'SELECT ticket_id,status,version FROM v7_tickets '+
        'WHERE ticket_id LIKE "ticket_%_failover_hold" ORDER BY ticket_id');
      assert.equal(failoverTicketRows.length,5);
      const states=Object.fromEntries(failoverTicketRows.map((item:any)=>
        [item.ticket_id,{status:item.status,version:Number(item.version)}]));
      for(const [ticket,state] of [
        ['ticket_done_failover_hold','DONE'],
        ['ticket_failed_failover_hold','TEST_FAILED'],
        ['ticket_reconciling_failover_hold','RECONCILIATION_REQUIRED']
      ] as const){
        assert.equal(states[ticket]?.status,state,
          'Promotion cannot revive or rewrite terminal/previous recovery state: '+ticket);
        assert.equal(states[ticket]?.version,1,'Terminal/recovery version immutable: '+ticket);
      }
      for(const ticket of [
        'ticket_submitted_failover_hold','ticket_checkpoint_failover_hold']){
        assert.equal(states[ticket]?.status,'RECONCILIATION_REQUIRED');
        assert.equal(states[ticket]?.version,2);
      }
      const [fencedLeases]:any=await db.query('SELECT COUNT(*) n FROM v7_leases '+
        'WHERE ticket_id LIKE "ticket_%_failover_hold" AND revoked=1');
      assert.equal(Number(fencedLeases[0].n),5,
        'Every old-epoch worker lease is fenced, even if its task is terminal');
      const [promotionRows]:any=await db.query(
        'SELECT COUNT(*) AS n FROM v7_events '+
        'WHERE event_type="MASTER_PROMOTED" AND epoch=? AND resource_id=?',
        [Number(promoted.body.epoch),b.agent_id]);
      assert.equal(Number(promotionRows[0].n),1,
        'No duplicate Master promotion event under simultaneous backup heartbeats');
      const fencedOldReceipt=await a.signed('/v7/leadership/reconcile',recoveryIntent);
      assert.equal(fencedOldReceipt.code,409,
        'Old Master may not replay its old successful receipt in a promoted epoch');
      assert.equal(fencedOldReceipt.body.error_code,'STALE_MASTER_EPOCH');
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
      for(const [endpoint,payload] of [
        ['/v7/tasks/renew-lease',renewBody],
        ['/v7/tasks/checkpoint',checkpointBody],
        ['/v7/tasks/submit',submittedBody]
      ] as const){
        const staleReceipt=await b.signed(endpoint,payload);
        assert.notEqual(staleReceipt.code,200,
          'Old committed idempotency receipt must NOT bypass current lease/epoch on '+endpoint);
      }
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
      // A submitted candidate without a Git job is still not fresh work.
      // Human "remote_checked" cannot erase its SHA/QA evidence and requeue.
      const candidateReset=await post('/v7/owner/command',{
        request_id:'owner_candidate_requeue_'+(++count),command:'RECONCILE_TICKET',
        payload:{ticket_id:'ticket_submitted_failover_hold',
          reason:'must preserve immutable candidate',remote_checked:true}},admin);
      assert.equal(candidateReset.code,423,JSON.stringify(candidateReset.body));
      assert.equal(candidateReset.body.error_code,
        'CANDIDATE_REQUIRES_INDEPENDENT_QA_RECONCILIATION');
      const [candidateRows]:any=await db.query('SELECT status,candidate_head_sha,'+
        'candidate_tree_sha FROM v7_tickets WHERE ticket_id=?',
        ['ticket_submitted_failover_hold']);
      assert.equal(candidateRows[0].status,'RECONCILIATION_REQUIRED');
      assert.equal(candidateRows[0].candidate_head_sha,'b'.repeat(40));
      assert.equal(candidateRows[0].candidate_tree_sha,'c'.repeat(40));
      // After failover, a frozen candidate cannot be requeued as fresh work.
      // Independent QA can upload device-signed proof, but a SECOND Owner
      // recovery review is required after ordinary QA evidence approval.
      const unsafeQaProof=c.signedQaPackage({
        ticketId:'ticket_qa_test',workerAgentId:b.agent_id,
        baseline:'a'.repeat(40),head:'b'.repeat(40),tree:'c'.repeat(40)});
      const gitUnsafeQa=await c.signed('/v7/tasks/qa-evidence',unsafeQaProof);
      assert.equal(gitUnsafeQa.code,423);
      assert.equal(gitUnsafeQa.body.error_code,
        'GIT_PUBLICATION_REQUIRES_SEPARATE_RECOVERY');
      const recoveryQaProof=c.signedQaPackage({
        ticketId:'ticket_drain_inflight',workerAgentId:d.agent_id,
        baseline:'a'.repeat(40),head:'b'.repeat(40),tree:'c'.repeat(40)});
      const uploaded=await c.signed('/v7/tasks/qa-evidence',recoveryQaProof);
      assert.equal(uploaded.code,200,JSON.stringify(uploaded.body));
      assert.equal(uploaded.body.qa_approved,false);
      assert.equal(uploaded.body.qa_receipt_submitted,false);
      const qaReviewId=uploaded.body.review_proposal_id;
      const unsignedRecovery=await post('/v7/owner/command',{
        request_id:'restqa_missing_approval_'+(++count),
        command:'RESTORE_QA_CANDIDATE',payload:{
          ticket_id:'ticket_drain_inflight',review_proposal_id:qaReviewId,
          expected_master_epoch:Number(fallback.body.epoch),
          candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
          owner_confirmed_recovery_review:true,
          reason:'Do not restore until independent Owner review has approved QA'}},admin);
      assert.equal(unsignedRecovery.code,403,JSON.stringify(unsignedRecovery.body));
      assert.equal(unsignedRecovery.body.error_code,'QA_RECOVERY_REVIEW_NOT_APPROVED');
      const qaOwnerReview=await owner('APPROVE_QA_EVIDENCE',{
        review_proposal_id:qaReviewId,
        review_note:'Independently checked signed QA candidate after failover',
        device_identity_confirmed:true,runner_provenance_reviewed:true,
        test_evidence_reviewed:true,independence_verified:true});
      assert.equal(qaOwnerReview.state.state,'APPROVED');
      const anonFrozenQueue=await fetch(base+'/v7/owner/qa-reviews');
      assert.equal(anonFrozenQueue.status,401,
        'Frozen device evidence is not exposed without Owner authorization');
      const pendingRestoreSnapshot=await fetch(base+'/v7/owner/qa-reviews',{
        headers:{authorization:'Bearer '+admin}});
      assert.equal(pendingRestoreSnapshot.status,200);
      const frozenQueue=await pendingRestoreSnapshot.json() as any;
      assert.equal(frozenQueue.read_only,true);
      assert.equal(frozenQueue.automatic_restoration_allowed,false);
      assert.equal(frozenQueue.recovering_master_live,true);
      assert.equal(frozenQueue.epoch,Number(fallback.body.epoch));
      const exactFrozen=frozenQueue.frozen_recovery_reviews.find((x:any)=>
        x.review_proposal_id===qaReviewId);
      assert.ok(exactFrozen,'Owner queue retains separately approved frozen evidence');
      assert.equal(exactFrozen.ticket_id,'ticket_drain_inflight');
      assert.equal(exactFrozen.candidate_head_sha,'b'.repeat(40));
      assert.equal(exactFrozen.candidate_tree_sha,'c'.repeat(40));
      assert.equal(exactFrozen.restore_preflight_verified,false,
        'Dashboard metadata is not restoration approval');
      assert.equal(exactFrozen.automatic_qa_receipt_allowed,false);
      const qaRecoveryObservation=await c.signed(
        '/v7/tasks/qa-review/'+qaReviewId,undefined,'GET');
      assert.equal(qaRecoveryObservation.code,200,
        JSON.stringify(qaRecoveryObservation.body));
      assert.equal(qaRecoveryObservation.body.task_status,'RECONCILIATION_REQUIRED');
      assert.equal(qaRecoveryObservation.body.manual_next_action,
        'OWNER_RESTORE_QA_CANDIDATE_BEFORE_RECEIPT');
      const beforeRestoreReceipt=await c.signed('/v7/tasks/qa-receipt',{
        request_id:'qa_receipt_blocked_restore_'+(++count),
        agent_id:c.agent_id,ticket_id:'ticket_drain_inflight',
        candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
        review_proposal_id:qaReviewId,
        evidence_sha256:uploaded.body.evidence_sha256,
        evidence_ref:'sha256:'+uploaded.body.evidence_sha256,passed:true});
      assert.equal(beforeRestoreReceipt.code,409);
      const recoveryPayload={ticket_id:'ticket_drain_inflight',
        review_proposal_id:qaReviewId,
        expected_master_epoch:Number(fallback.body.epoch),
        candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
        owner_confirmed_recovery_review:true,
        reason:'Owner independently reviewed exact immutable QA proof and Master recovery'};
      const wrongCandidate=await post('/v7/owner/command',{
        request_id:'restqa_wrong_candidate_'+(++count),
        command:'RESTORE_QA_CANDIDATE',
        payload:{...recoveryPayload,candidate_head_sha:'f'.repeat(40)}},admin);
      assert.equal(wrongCandidate.code,409);
      assert.equal(wrongCandidate.body.error_code,'QA_RECOVERY_CANDIDATE_CHANGED');
      const recoveryCommand={request_id:'restqa_original_intent_'+(++count),
        command:'RESTORE_QA_CANDIDATE',payload:recoveryPayload};
      const restored=await post('/v7/owner/command',recoveryCommand,admin);
      assert.equal(restored.code,200,JSON.stringify(restored.body));
      assert.equal(restored.body.state.status,'SUBMITTED_FOR_REVIEW');
      assert.equal(restored.body.state.old_worker_lease_restored,false);
      assert.equal(restored.body.state.qa_receipt_submitted,false);
      assert.equal(restored.body.state.git_published,false);
      assert.equal(restored.body.state.owner_recovery_ack_sent,false);
      const afterOwnerRestoreQueue=await fetch(base+'/v7/owner/qa-reviews',{
        headers:{authorization:'Bearer '+admin}});
      assert.equal(afterOwnerRestoreQueue.status,200);
      const approvedQueueAfter=await afterOwnerRestoreQueue.json() as any;
      assert.equal(approvedQueueAfter.frozen_recovery_reviews.some((x:any)=>
        x.review_proposal_id===qaReviewId),false,
        'An Owner-restored candidate must leave the frozen queue');
      const replayRestored=await post('/v7/owner/command',recoveryCommand,admin);
      assert.deepEqual(replayRestored,restored,
        'Lost Owner reply must return original receipt, no duplicate restoration');
      const recoveredQaReceipt=await c.signed('/v7/tasks/qa-receipt',{
        request_id:'qa_receipt_after_restore_'+(++count),
        agent_id:c.agent_id,ticket_id:'ticket_drain_inflight',
        candidate_head_sha:'b'.repeat(40),candidate_tree_sha:'c'.repeat(40),
        review_proposal_id:qaReviewId,
        evidence_sha256:uploaded.body.evidence_sha256,
        evidence_ref:'sha256:'+uploaded.body.evidence_sha256,passed:true});
      assert.equal(recoveredQaReceipt.code,200,JSON.stringify(recoveredQaReceipt.body));
      assert.equal(recoveredQaReceipt.body.status,'INTEGRATING');
      const restoredDetail=await c.signed('/v7/tasks/detail/ticket_drain_inflight',
        undefined,'GET');
      assert.equal(restoredDetail.code,200);
      assert.equal(restoredDetail.body.status,'INTEGRATING');
      assert.equal(restoredDetail.body.candidate_head_sha,'b'.repeat(40));
      assert.equal(restoredDetail.body.candidate_tree_sha,'c'.repeat(40));
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
          if(path==='branches/main')result={protected:true,commit:{sha:'a'.repeat(40)}};
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
              started_at:'2026-11-06T15:00:00Z',completed_at:'2026-11-06T16:00:00Z',status:'completed',conclusion:'success'}]};
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

    // Real MySQL concurrency acceptance: two separately signed HTTP requests
    // carrying the SAME next node+agent sequence must never both commit.
    // This is a disposable node with no project/work; not production evidence.
    const raceNode=await edge(99,false);
    const pulse={boot_id:'boot_race_99',sequence:1,
      expected_master_epoch:null,
      agents:[{agent_id:raceNode.agent_id,sequence:1,status:'ONLINE'}]};
    // Malformed but correctly node-signed JSON must not mutate Central's
    // authoritative counters or accidentally renew an existing Master lease.
    for(const malformed of [
      {...pulse,sequence:'1'},
      {...pulse,sequence:true},
      {...pulse,expected_master_epoch:'0'},
      {...pulse,agents:[{...pulse.agents[0],sequence:'1'}]},
      {...pulse,agents:[{...pulse.agents[0],status:'OFFLINE'}]},
      {...pulse,agents:[]},
      {...pulse,agents:[...pulse.agents,pulse.agents[0]]},
      {...pulse,unknown:'side_effect'},
      {...pulse,agents:[{...pulse.agents[0],extra:'not_allowed'}]}
    ]){
      const denied=await raceNode.signed('/v7/nodes/heartbeat',malformed);
      assert.equal(denied.code,400,JSON.stringify(denied.body));
      assert.equal(denied.body.error_code,'INVALID_HEARTBEAT');
    }
    const [r1,r2]=await Promise.all([
      raceNode.signed('/v7/nodes/heartbeat',pulse),
      raceNode.signed('/v7/nodes/heartbeat',pulse)
    ]);
    const sorted=[r1.code,r2.code].sort((x,y)=>x-y);
    assert.deepEqual(sorted,[200,409],JSON.stringify([r1,r2]));
    const rejected=r1.code===409?r1:r2;
    assert.equal(rejected.body.error_code,'REPLAY_SEQUENCE');
    const actualDb=await mysql.createConnection({
      host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME});
    try{
      const [nodeRows]:any=await actualDb.query(
        'SELECT last_sequence,boot_id FROM v7_nodes WHERE node_id=?',[raceNode.node_id]);
      const [agentRows]:any=await actualDb.query(
        'SELECT last_sequence FROM v7_agents WHERE agent_id=?',[raceNode.agent_id]);
      assert.equal(Number(nodeRows[0].last_sequence),1);
      assert.equal(nodeRows[0].boot_id,pulse.boot_id);
      assert.equal(Number(agentRows[0].last_sequence),1);
    }finally{await actualDb.end();}
    const replayAfterRace=await raceNode.signed('/v7/nodes/heartbeat',pulse);
    assert.equal(replayAfterRace.code,409,
      'Later retries at the same sequence cannot repeat a committed heartbeat');
    assert.equal(replayAfterRace.body.error_code,'REPLAY_SEQUENCE');

    // Multi-agent same-PC resilience regression: two approved, healthy agent
    // identities on ONE physical node are NOT Backup-1 and Backup-2. An
    // expired Master cannot hand control to its sibling on the same PC,
    // including via a later NO_MASTER rebootstrap. Only a separately
    // enrolled and heartbeating node may become the next Master.
    const sharedPc=await edge(100,true);
    const siblingId='agent_same_pc_100';
    const siblingRegistration=await sharedPc.signed('/v7/agents/register',{
      agent_id:siblingId,capabilities:{}});
    assert.equal(siblingRegistration.code,200,JSON.stringify(siblingRegistration.body));
    await owner('APPROVE_AGENT',{
      agent_id:siblingId,master_eligible:true,qa_eligible:false});
    function sharedPulse(sequence:number){
      return {boot_id:'boot_shared_100',sequence,expected_master_epoch:197,
        agents:[
          {agent_id:sharedPc.agent_id,sequence,status:'ONLINE'},
          {agent_id:siblingId,sequence,status:'ONLINE'}]};
    }
    const firstShared=await sharedPc.signed('/v7/nodes/heartbeat',sharedPulse(1));
    assert.equal(firstShared.code,200,JSON.stringify(firstShared.body));
    const multiPcDb=await mysql.createConnection({
      host:'127.0.0.1',port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      database:process.env.DB_NAME});
    try{
      await multiPcDb.query(
        'UPDATE v7_agents SET last_seen=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 400 SECOND) '+
        'WHERE agent_id NOT IN (?,?)',[sharedPc.agent_id,siblingId]);
      // Test-only injection: Master and Backup-1 deliberately share one
      // node. This represents a legacy unsafe election layout.
      await multiPcDb.query(
        'UPDATE v7_cluster SET epoch=197,master_agent_id=?,backup1=?,'+
        'backup2=NULL,phase="READY",paused=0,'+
        'lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),'+
        'bootstrapped_at=COALESCE(bootstrapped_at,UTC_TIMESTAMP(3)) '+
        'WHERE singleton=1',[sharedPc.agent_id,siblingId]);
      const samePcFirst=await sharedPc.signed(
        '/v7/nodes/heartbeat',sharedPulse(2));
      assert.equal(samePcFirst.code,200,JSON.stringify(samePcFirst.body));
      assert.equal(samePcFirst.body.master_agent_id,null,
        'The old Master and its same-PC backup cannot be independently promoted');
      assert.equal(samePcFirst.body.phase,'NO_MASTER');
      assert.equal(Number(samePcFirst.body.epoch),197);
      assert.deepEqual(samePcFirst.body.backups,[null,null]);
      const [missingRows]:any=await multiPcDb.query(
        'SELECT COUNT(*) AS n FROM v7_events '+
        'WHERE event_type="MASTER_MISSING" AND epoch=?',[197]);
      assert.equal(Number(missingRows[0].n),1,
        'Central must retain previous Master identity as a durable audit fence');
      const samePcAgain=await sharedPc.signed(
        '/v7/nodes/heartbeat',sharedPulse(3));
      assert.equal(samePcAgain.code,200,JSON.stringify(samePcAgain.body));
      assert.equal(samePcAgain.body.master_agent_id,null,
        'NO_MASTER must not rebootstrap the old PC on another heartbeat');
      assert.equal(samePcAgain.body.phase,'NO_MASTER');
      assert.equal(Number(samePcAgain.body.epoch),197);
      const noMasterSafetyResponse=await fetch(base+'/v7/owner/leadership-safety',{
        headers:{authorization:'Bearer '+admin}});
      assert.equal(noMasterSafetyResponse.status,200);
      const noMasterSafety=await noMasterSafetyResponse.json() as any;
      assert.equal(noMasterSafety.phase,'NO_MASTER');
      assert.equal(noMasterSafety.master_agent_id,null);
      assert.equal(noMasterSafety.previous_master_missing_event_present,true);
      assert.equal(noMasterSafety.previous_master_agent_id,sharedPc.agent_id);
      assert.equal(noMasterSafety.previous_master_node_id,sharedPc.node_id);
      assert.equal(noMasterSafety.approved_fresh_independent_node_count,0);
      assert.ok(noMasterSafety.reason_codes.includes(
        'WAITING_FOR_DISTINCT_APPROVED_NODE_HEARTBEAT'));
      assert.equal(noMasterSafety.automatic_promotion_allowed,false);
      // A truly distinct approved PC may re-elect normally. No task or
      // external Git effects are synthesized by this fixture.
      const independent=await edge(101,true);
      const otherPulse=await independent.heartbeat(197);
      assert.equal(otherPulse.code,200,JSON.stringify(otherPulse.body));
      assert.equal(otherPulse.body.master_agent_id,independent.agent_id,
        'Independent physical node identity is required for takeover');
      assert.equal(Number(otherPulse.body.epoch),198);
      assert.equal(otherPulse.body.phase,'RECOVERING');
      const recoveringResponse=await fetch(base+'/v7/owner/leadership-safety',{
        headers:{authorization:'Bearer '+admin}});
      assert.equal(recoveringResponse.status,200);
      const recoveringSafety=await recoveringResponse.json() as any;
      assert.equal(recoveringSafety.epoch,198);
      assert.equal(recoveringSafety.master_agent_id,independent.agent_id);
      assert.ok(recoveringSafety.reason_codes.includes(
        'MASTER_RECOVERY_RECONCILIATION_REQUIRED'));
      assert.equal(recoveringSafety.automatic_promotion_allowed,false);
      const [promotionRows]:any=await multiPcDb.query(
        'SELECT COUNT(*) AS n FROM v7_events WHERE event_type="MASTER_PROMOTED" '+
        'AND epoch=? AND resource_id=?',[198,independent.agent_id]);
      assert.equal(Number(promotionRows[0].n),1);
    }finally{await multiPcDb.end();}

  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await shutdownV7ForTests();}
});
