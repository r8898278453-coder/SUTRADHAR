'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {createVault}=require('../apps/desktop/os-vault.cjs');
const {createSignerBridge}=require('../apps/desktop/vault-bridge.cjs');
const {claimApprovedTask,resumeApprovedTask,recordProviderAttempt,previewMasterBatch,commitMasterBatch,inspectMasterBatchReceipt,listMasterProjects,createMasterBatchJournal}=require('../apps/desktop/worker-claim.cjs');
const {progressWorkerTask}=require('../apps/desktop/worker-progress.cjs');
const {submitWorkerCandidate}=require('../apps/desktop/worker-submit.cjs');
const available=cp.spawnSync('git',['--version'],{encoding:'utf8'}).status===0;
const run=(dir,...args)=>cp.execFileSync('git',['-C',dir,...args],
  {encoding:'utf8',timeout:15000,maxBuffer:100000}).trim();
function safeStorage(){
  const key=crypto.randomBytes(32);
  return {isEncryptionAvailable:()=>true,
    encryptString:s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
      return Buffer.concat([iv,c.update(s,'utf8'),c.final(),c.getAuthTag()]);},
    decryptString:x=>{const iv=x.subarray(0,12),tag=x.subarray(x.length-16),ct=x.subarray(12,-16);
      const d=crypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);
      return Buffer.concat([d.update(ct),d.final()]).toString('utf8');}};
}
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sut-osvault-claim-'));
  const repo=path.join(root,'repo'),worker=path.join(root,'worker'),vaultDir=path.join(root,'vault');
  fs.mkdirSync(repo);fs.mkdirSync(worker);fs.mkdirSync(vaultDir);
  run(repo,'init','-b','main');
  run(repo,'config','user.name','SUTRADHAR CI');
  run(repo,'config','user.email','test@example.invalid');
  run(repo,'remote','add','origin','https://github.com/example/repo.git');
  fs.mkdirSync(path.join(repo,'src'));
  fs.writeFileSync(path.join(repo,'src','feature.ts'),'export const feature=true;\n');
  run(repo,'add','.');run(repo,'commit','-m','authorized immutable baseline');
  const baseline=run(repo,'rev-parse','HEAD');
  const vault=createVault({safeStorage:safeStorage(),dir:vaultDir,platform:'win32'});
  const signer=createSignerBridge(vault),pub=signer.initialize({agent_ids:['agent_aaa']});
  return {root,repo,worker,signer,pub,baseline,
    close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function remote(f,{lostOnce=false,masterEpoch=7,invalidScope=false,
  writeScopes=['src/feature.ts']}={}){
  let claimed=false,claimCount=0,firstBody=null,all=[];
  const task=()=>({ticket_id:'ticket_abc',project_id:'project_aaa',
    repository:'example/repo',base_branch:'main',title:'Build one feature',
    description:'Review source and add test',risk:'LOW',
    branch_name:'ai/ticket_abc',baseline_sha:f.baseline,
    version:claimed?2:1,status:claimed?'CLAIMED':'READY',
    worker_agent_id:claimed?'agent_aaa':null,
    write_scopes:writeScopes,
    acceptance_criteria:['Test passes'],latest_checkpoint:null});
  function verified(init,uri){
    const h=init.headers,key=crypto.createPublicKey(f.pub.public_key_pem);
    assert.equal(h['x-sutradhar-node'],f.pub.node_id);
    const body=init.body||'';
    const canonical=[h['x-sutradhar-timestamp'],h['x-sutradhar-nonce'],
      init.method,uri,crypto.createHash('sha256').update(body).digest('hex')].join('\n');
    assert.equal(crypto.verify(null,Buffer.from(canonical),key,
      Buffer.from(h['x-sutradhar-signature'],'base64')),true);
  }
  const fetcher=async(url,init)=>{
    const uri=new URL(url).pathname;
    assert.equal(new URL(url).origin,'https://central.example.com');
    assert.equal(init.redirect,'error');
    assert.equal(init.credentials,'omit');
    verified(init,uri);
    all.push({uri,method:init.method,body:init.body});
    if(uri==='/v7/tasks/detail/ticket_abc'&&init.method==='GET'){
      assert.equal(init.headers['x-sutradhar-agent'],'agent_aaa');
      return new Response(JSON.stringify(task()),{status:200});
    }
    if(uri==='/v7/cluster/state'&&init.method==='GET')
      return new Response(JSON.stringify({epoch:masterEpoch,phase:'READY',
        paused:false,master_agent_id:'agent_master'}),{status:200});
    if(uri==='/v7/tasks/claim'&&init.method==='POST'){
      assert.equal(init.headers['x-sutradhar-agent'],'agent_aaa');
      claimCount++;
      const body=JSON.parse(init.body);
      assert.equal(body.agent_id,'agent_aaa');
      assert.equal(body.ticket_id,'ticket_abc');
      if(!firstBody)firstBody=body;
      assert.deepEqual(body,firstBody,'ambiguous network claim must reuse the ORIGINAL request');
      claimed=true;
      if(lostOnce&&claimCount===1)throw Error('SIMULATED_LOST_HTTP_RESPONSE_AFTER_CENTRAL_COMMIT');
      return new Response(JSON.stringify({accepted:true,ticket_id:'ticket_abc',
        lease_id:'11111111-1111-4111-8111-111111111111',
        epoch:masterEpoch,version:2,lease_seconds:600,
        write_scopes:invalidScope?['secrets/private.ts']:writeScopes}),{status:200});
    }
    if(uri==='/v7/tasks/resume-check'&&init.method==='POST'){
      const b=JSON.parse(init.body);
      assert.equal(b.lease_id,'11111111-1111-4111-8111-111111111111');
      return new Response(JSON.stringify({resume_allowed:true,
        automatic_execution_allowed:false,agent_id:'agent_aaa',
        ticket_id:'ticket_abc',epoch:masterEpoch,project_id:'project_aaa',
        repository:'example/repo',branch_name:'ai/ticket_abc',
        baseline_sha:f.baseline,status:'CLAIMED',
        write_scopes:writeScopes,latest_checkpoint:null}),{status:200});
    }
    throw Error('UNEXPECTED_REMOTE_ENDPOINT_'+uri);
  };
  return {fetcher,all,claims:()=>claimCount,changeEpoch:x=>{masterEpoch=x}};
}
const args=(f,fetcher)=>({origin:'https://central.example.com',agentId:'agent_aaa',
  ticketId:'ticket_abc',repoDir:f.repo,dir:f.worker,signer:f.signer,fetcher});

test('vault claim signer is main-only, exact-body, no arbitrary worker write capability',()=>{
  const f=fixture();
  try{
    const body={request_id:'claim_abc123',agent_id:'agent_aaa',
      ticket_id:'ticket_abc',expected_version:1,expected_master_epoch:7};
    const prepared=f.signer.signWorkerAction({operation:'claim',agent_id:'agent_aaa',payload:body});
    assert.equal(prepared.uri,'/v7/tasks/claim');
    assert.deepEqual(JSON.parse(prepared.body),body);
    assert.equal(JSON.stringify(prepared).includes('PRIVATE KEY'),false);
    assert.throws(()=>f.signer.sign({kind:'node_api',method:'POST',
      uri:'/v7/tasks/claim',body:prepared.body}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'qa-receipt',agent_id:'agent_aaa',payload:body}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'claim',agent_id:'agent_bad',payload:body}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'claim',agent_id:'agent_aaa',
      payload:{...body,unapproved:true}}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'claim',agent_id:'agent_aaa',
      payload:{...body,expected_master_epoch:-1}}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'claim',agent_id:'agent_aaa',
      payload:{...body,ticket_id:'../../secret'}}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'resume-check',agent_id:'agent_aaa',
      payload:{agent_id:'agent_aaa',ticket_id:'ticket_abc',lease_id:'bad',expected_master_epoch:7}}),/DENIED/);
  }finally{f.close();}
});

test('local Git worktree is created before signed claim, then verified by Central resume', {skip:!available},async()=>{
  const f=fixture(),r=remote(f);
  try{
    const out=await claimApprovedTask(args(f,r.fetcher));
    assert.equal(out.resume_allowed,true);
    assert.equal(out.automatic_execution_allowed,false);
    assert.equal(out.git_push_allowed,false);
    assert.equal(out.worktree,path.join(f.worker,'worktrees','ticket_abc'));
    assert.equal(run(out.worktree,'branch','--show-current'),'ai/ticket_abc');
    assert.equal(run(out.worktree,'rev-parse','HEAD'),f.baseline);
    assert.equal(r.claims(),1);
    const journal=path.join(f.worker,'claim_ticket_abc.json');
    assert.equal(fs.existsSync(journal),false);
    const receipt=path.join(f.worker,'receipt_ticket_abc.json');
    assert.equal(fs.existsSync(receipt),true);
    assert.equal(fs.readFileSync(receipt,'utf8').includes('PRIVATE KEY'),false);
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/EXISTING_RECEIPT_REQUIRES_RESUME/);
    const verified=await resumeApprovedTask(args(f,r.fetcher));
    assert.equal(verified.status,'CLAIMED');
    assert.equal(verified.worktree,out.worktree);
    assert.equal(r.claims(),1,'resume cannot create a second claim');
  }finally{f.close();}
});

test('lost HTTP response journals EXACT original request ID and reuses existing worktree', {skip:!available},async()=>{
  const f=fixture(),r=remote(f,{lostOnce:true});
  try{
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/SIMULATED_LOST_HTTP/);
    const journal=path.join(f.worker,'claim_ticket_abc.json');
    assert.equal(fs.existsSync(journal),true);
    const before=JSON.parse(fs.readFileSync(journal,'utf8'));
    assert.equal(before.body.request_id.startsWith('claim_'),true);
    const resumed=await claimApprovedTask(args(f,r.fetcher));
    assert.equal(resumed.resume_allowed,true);
    assert.equal(r.claims(),2);
    assert.equal(fs.existsSync(journal),false);
    assert.equal(fs.existsSync(path.join(f.worker,'worktrees','ticket_abc')),true);
    assert.equal(r.all.filter(x=>x.uri==='/v7/tasks/claim').length,2);
  }finally{f.close();}
});

test('new Master epoch after ambiguous claim FAILS CLOSED without second claim', {skip:!available},async()=>{
  const f=fixture(),r=remote(f,{lostOnce:true});
  try{
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/SIMULATED_LOST_HTTP/);
    r.changeEpoch(8);
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/PENDING_CLAIM_RECONCILIATION_REQUIRED/);
    assert.equal(r.claims(),1);
    assert.equal(fs.existsSync(path.join(f.worker,'claim_ticket_abc.json')),true);
  }finally{f.close();}
});

test('wrong Git origin, corrupt pending record or conflicting receipt never starts a claim', {skip:!available},async()=>{
  const f=fixture(),r=remote(f);
  try{
    run(f.repo,'remote','set-url','origin','https://github.com/untrusted/other.git');
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/WORKER_REPOSITORY_ORIGIN_MISMATCH/);
    assert.equal(r.claims(),0);
    run(f.repo,'remote','set-url','origin','https://github.com/example/repo.git');
    const bad=path.join(f.worker,'claim_ticket_abc.json');
    fs.writeFileSync(bad,'{"schema":1,"context":{},"body":{},"sha256":"tampered"}');
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/WORKER_LOCAL_RECORD_DIGEST_INVALID/);
    assert.equal(r.claims(),0);
    assert.equal(fs.existsSync(bad),true);
  }finally{f.close();}
});

test('wrong Central scope receipt is refused and uncertain claim journal retained', {skip:!available},async()=>{
  const f=fixture(),r=remote(f,{invalidScope:true});
  try{
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/WORKER_CLAIM_RECEIPT_INVALID/);
    assert.equal(fs.existsSync(path.join(f.worker,'claim_ticket_abc.json')),true);
    assert.equal(fs.existsSync(path.join(f.worker,'receipt_ticket_abc.json')),false);
  }finally{f.close();}
});

test('active smudge filter in immutable baseline must block Git checkout before a Central claim', {skip:!available},async()=>{
  const f=fixture();
  try{
    fs.writeFileSync(path.join(f.repo,'.gitattributes'),'src/* filter=unsafe\n');
    run(f.repo,'add','.gitattributes');
    run(f.repo,'commit','-m','baseline containing active unsafe filter');
    f.baseline=run(f.repo,'rev-parse','HEAD');
    const r=remote(f);
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),
      /WORKER_ACTIVE_GIT_FILTER_REQUIRES_OWNER_REVIEW/);
    assert.equal(r.claims(),0);
    assert.equal(fs.existsSync(path.join(f.worker,'claim_ticket_abc.json')),false);
  }finally{f.close();}
});

test('packaged UI exposes only operator-confirmed claim/resume, no generic signer IPC',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  assert.ok(pkg.build.files.includes('worker-claim.cjs'));
  assert.match(main,/verifySender\(event\)/);
  assert.match(main,/ipcMain\.handle\('sutradhar:claimWorkerTask'/);
  assert.match(main,/ipcMain\.handle\('sutradhar:resumeWorkerTask'/);
  assert.match(main,/workerClaimBusy=true/);
  assert.match(main,/WORKER_OPERATION_CENTRAL_HEARTBEAT_REQUIRED/);
  assert.match(main,/showOpenDialog\(setupWindow/);
  assert.match(main,/Create isolated worktree and claim task/);
  assert.match(preload,/claimWorkerTask:\(agentId,ticketId\)/);
  assert.doesNotMatch(preload,/signWorkerAction|private_key_pem/);
  assert.match(html,/id="workerClaim"/);
  assert.match(html,/id="workerResume"/);
});


function progressHarness(f,{lostOnce=false,incorrectCheckpoint=false}={}){
  const base=remote(f);
  let latest=null,firstBody=null,progressCount=0,operation=null;
  const fetcher=async(url,init)=>{
    const uri=new URL(url).pathname;
    if(['/v7/tasks/checkpoint','/v7/tasks/renew-lease'].includes(uri)){
      const key=crypto.createPublicKey(f.pub.public_key_pem),h=init.headers;
      const canonical=[h['x-sutradhar-timestamp'],h['x-sutradhar-nonce'],'POST',
        uri,crypto.createHash('sha256').update(init.body).digest('hex')].join('\n');
      assert.equal(crypto.verify(null,Buffer.from(canonical),key,
        Buffer.from(h['x-sutradhar-signature'],'base64')),true);
      const b=JSON.parse(init.body);
      assert.equal(b.agent_id,'agent_aaa');
      assert.equal(b.ticket_id,'ticket_abc');
      assert.equal(b.lease_id,'11111111-1111-4111-8111-111111111111');
      if(!firstBody){firstBody=b;operation=uri;}
      assert.equal(uri,operation);
      assert.deepEqual(b,firstBody,'HTTP response loss must replay exact signed payload');
      progressCount++;
      let response;
      if(uri==='/v7/tasks/checkpoint'){
        const hash=crypto.createHash('sha256').update(b.summary+'\n'+b.next_action).digest('hex');
        latest={generation:1,summary:b.summary,next_action:b.next_action,
          content_sha256:incorrectCheckpoint?'0'.repeat(64):hash};
        response={accepted:true,ticket_id:'ticket_abc',generation:1,
          content_sha256:hash,version:3};
      }else{
        response={accepted:true,ticket_id:'ticket_abc',agent_id:'agent_aaa',
          lease_id:b.lease_id,epoch:7,automatic_execution_allowed:false};
      }
      Object.assign(response,{lease_expires_at:'2030-11-19T00:10:00Z',
        absolute_claim_deadline:'2030-11-19T04:00:00Z',
        lease_seconds_remaining:600});
      if(lostOnce&&progressCount===1)
        throw Error('SIMULATED_PROGRESS_REPLY_LOST_AFTER_CENTRAL_COMMIT');
      return new Response(JSON.stringify(response),{status:200});
    }
    if(uri==='/v7/tasks/resume-check'&&latest){
      return new Response(JSON.stringify({resume_allowed:true,
        automatic_execution_allowed:false,agent_id:'agent_aaa',
        ticket_id:'ticket_abc',epoch:7,project_id:'project_aaa',
        repository:'example/repo',branch_name:'ai/ticket_abc',
        baseline_sha:f.baseline,status:'CHECKPOINTED',
        write_scopes:['src/feature.ts'],latest_checkpoint:latest}),{status:200});
    }
    return base.fetcher(url,init);
  };
  return {fetcher,progressCount:()=>progressCount,
    getPending:()=>JSON.parse(fs.readFileSync(path.join(f.worker,'progress_ticket_abc.json'),'utf8')),
    changeEpoch:base.changeEpoch};
}
const progressArgs=(f,h,operation,content)=>({
  origin:'https://central.example.com',agentId:'agent_aaa',
  ticketId:'ticket_abc',dir:f.worker,signer:f.signer,
  operation,...content,fetcher:h.fetcher
});
const checkpointContent={summary:'Reviewed limited source changes and verified local test output',
  next_action:'Prepare a fresh independent QA evaluation'};

test('main-only vault signer grants exact checkpoint/renewal fields but no generic QA/write oracle',()=>{
  const f=fixture();
  try{
    const common={request_id:'checkpoint_test_123',agent_id:'agent_aaa',
      ticket_id:'ticket_abc',lease_id:'11111111-1111-4111-8111-111111111111',
      expected_master_epoch:7};
    const check=f.signer.signWorkerAction({operation:'checkpoint',agent_id:'agent_aaa',
      payload:{...common,...checkpointContent}});
    assert.equal(check.uri,'/v7/tasks/checkpoint');
    const renew=f.signer.signWorkerAction({operation:'renew-lease',agent_id:'agent_aaa',
      payload:{...common,request_id:'renew_test_123',reason:'Tested progress and need another bounded period'}});
    assert.equal(renew.uri,'/v7/tasks/renew-lease');
    assert.throws(()=>f.signer.signWorkerAction({operation:'checkpoint',agent_id:'agent_aaa',
      payload:{...common,...checkpointContent,unapproved_admin:true}}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'checkpoint',agent_id:'agent_aaa',
      payload:{...common,...checkpointContent,summary:' '}}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'checkpoint',agent_id:'agent_bad',
      payload:{...common,...checkpointContent}}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'renew-lease',agent_id:'agent_aaa',
      payload:{...common,request_id:'renew_test_123',reason:'short'}}),/DENIED/);
    assert.throws(()=>f.signer.sign({kind:'node_api',method:'POST',
      uri:'/v7/tasks/checkpoint',body:check.body}),/DENIED/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'submit',agent_id:'agent_aaa',
      payload:common}),/DENIED/);
  }finally{f.close();}
});

test('packaged worker signed checkpoint writes verified remote evidence without QA or Git push',
  {skip:!available},async()=>{
    const f=fixture(),h=progressHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));
      const r=await progressWorkerTask(progressArgs(f,h,'checkpoint',checkpointContent));
      assert.equal(r.accepted,true);
      assert.equal(r.checkpoint_generation,1);
      assert.equal(r.automatic_execution_allowed,false);
      assert.equal(r.git_push_allowed,false);
      assert.equal(h.progressCount(),1);
      assert.equal(fs.existsSync(path.join(f.worker,'progress_ticket_abc.json')),false);
      const receipts=fs.readdirSync(f.worker).filter(x=>x.startsWith('progress_receipt_'));
      assert.equal(receipts.length,1);
      assert.equal(fs.readFileSync(path.join(f.worker,receipts[0]),'utf8')
        .includes('PRIVATE KEY'),false);
    }finally{f.close();}
  });

test('lost checkpoint response preserves exact intent, replay never double-increments generation',
  {skip:!available},async()=>{
    const f=fixture(),h=progressHarness(f,{lostOnce:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',checkpointContent)),
        /SIMULATED_PROGRESS_REPLY_LOST/);
      const saved=h.getPending();
      assert.equal(saved.body.request_id.startsWith('checkpoint_'),true);
      const replay=await progressWorkerTask(progressArgs(f,h,'checkpoint',checkpointContent));
      assert.equal(replay.replayed,true);
      assert.equal(replay.checkpoint_generation,1);
      assert.equal(h.progressCount(),2);
      assert.equal(fs.existsSync(path.join(f.worker,'progress_ticket_abc.json')),false);
    }finally{f.close();}
  });

test('changed checkpoint content or corrupt progress journal fails closed after ambiguous network',
  {skip:!available},async()=>{
    const f=fixture(),h=progressHarness(f,{lostOnce:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',checkpointContent)),
        /SIMULATED_PROGRESS_REPLY_LOST/);
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',{
        ...checkpointContent,summary:'Changed summary'})),
        /WORKER_PROGRESS_PENDING_RECONCILIATION_REQUIRED/);
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'renew-lease',{
        reason:'Manual progress and a safe new lease requested'})),
        /WORKER_PROGRESS_PENDING_RECONCILIATION_REQUIRED/);
      const file=path.join(f.worker,'progress_ticket_abc.json');
      const rec=h.getPending();
      rec.body.summary='tampered';
      fs.writeFileSync(file,JSON.stringify(rec));
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',checkpointContent)),
        /WORKER_PROGRESS_JOURNAL_DIGEST_INVALID/);
      assert.equal(h.progressCount(),1);
    }finally{f.close();}
  });

test('mismatched Central checkpoint proof leaves pending journal and forbids completion',
  {skip:!available},async()=>{
    const f=fixture(),h=progressHarness(f,{incorrectCheckpoint:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',checkpointContent)),
        /WORKER_CHECKPOINT_NOT_CONFIRMED/);
      assert.equal(fs.existsSync(path.join(f.worker,'progress_ticket_abc.json')),true);
      assert.equal(fs.readdirSync(f.worker).some(x=>x.startsWith('progress_receipt_')),false);
    }finally{f.close();}
  });

test('bounded renewal is signed and manually acknowledged without executing task',
  {skip:!available},async()=>{
    const f=fixture(),h=progressHarness(f,{lostOnce:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));
      const content={reason:'Completed scoped review, requesting a bounded continuation'};
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'renew-lease',content)),
        /SIMULATED_PROGRESS_REPLY_LOST/);
      const done=await progressWorkerTask(progressArgs(f,h,'renew-lease',content));
      assert.equal(done.replayed,true);
      assert.equal(done.lease_seconds_remaining,600);
      assert.equal(done.automatic_execution_allowed,false);
      assert.equal(h.progressCount(),2);
      assert.equal(fs.existsSync(path.join(f.worker,'progress_ticket_abc.json')),false);
    }finally{f.close();}
  });

test('packaged Main and setup expose only explicit progress operations with no general signer',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const setup=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.ok(pkg.build.files.includes('worker-progress.cjs'));
  assert.match(main,/ipcMain\.handle\('sutradhar:checkpointWorkerTask'/);
  assert.match(main,/ipcMain\.handle\('sutradhar:renewWorkerLease'/);
  assert.match(main,/approvedWorkerOperator\(agentId,ticketId,true\)/);
  assert.match(preload,/checkpointWorkerTask:\(agentId,ticketId,summary,nextAction\)/);
  assert.match(preload,/renewWorkerLease:\(agentId,ticketId,reason\)/);
  assert.doesNotMatch(preload,/signWorkerAction|private_key_pem/);
  assert.match(setup,/id="workerCheckpoint"/);
  assert.match(setup,/id="workerRenew"/);
});


function candidateHarness(f,{loseReply=false,wrongRemoteSha=false,
  invalidAck=false,writeScopes}={}){
  const base=remote(f,{writeScopes});
  const cpSummary='Implemented authorized source change and reviewed result';
  const cpNext='Independent QA must fetch exact candidate head';
  const cpHash=crypto.createHash('sha256').update(cpSummary+'\n'+cpNext).digest('hex');
  const cpData={generation:1,summary:cpSummary,next_action:cpNext,content_sha256:cpHash};
  let ready=false,submitted=false,firstBody=null,submitCount=0;
  const all=[];
  async function fetcher(url,init){
    const uri=new URL(url).pathname;all.push({uri,body:init.body,method:init.method});
    if(uri==='/v7/tasks/detail/ticket_abc'){
      const baseReply=await base.fetcher(url,init);
      const t=await baseReply.json();
      if(ready){
        t.status=submitted?'SUBMITTED_FOR_REVIEW':'CHECKPOINTED';
        t.latest_checkpoint=cpData;
      }
      t.candidate_head_sha=submitted?
        (wrongRemoteSha?'f'.repeat(40):firstBody.candidate_head_sha):null;
      t.candidate_tree_sha=submitted?firstBody.candidate_tree_sha:null;
      return new Response(JSON.stringify(t),{status:200});
    }
    if(uri==='/v7/tasks/resume-check'&&ready){
      const r=await base.fetcher(url,init),data=await r.json();
      return new Response(JSON.stringify({...data,status:'CHECKPOINTED',
        latest_checkpoint:cpData}),{status:200});
    }
    if(uri==='/v7/tasks/submit'){
      assert.equal(init.method,'POST');
      const headers=init.headers;
      const proof=[headers['x-sutradhar-timestamp'],
        headers['x-sutradhar-nonce'],'POST',uri,
        crypto.createHash('sha256').update(init.body).digest('hex')].join('\n');
      assert.equal(crypto.verify(null,Buffer.from(proof),
        crypto.createPublicKey(f.pub.public_key_pem),
        Buffer.from(headers['x-sutradhar-signature'],'base64')),true);
      const body=JSON.parse(init.body);
      assert.equal(body.agent_id,'agent_aaa');
      assert.equal(body.ticket_id,'ticket_abc');
      assert.equal(body.expected_master_epoch,7);
      if(!firstBody)firstBody=body;
      assert.deepEqual(body,firstBody);
      submitCount++;submitted=true;
      if(loseReply&&submitCount===1)
        throw Error('SIMULATED_SUBMIT_ACK_LOST_AFTER_CENTRAL_COMMIT');
      return new Response(JSON.stringify({accepted:!invalidAck,
        ticket_id:'ticket_abc',status:'SUBMITTED_FOR_REVIEW'}),{status:200});
    }
    return base.fetcher(url,init);
  }
  return {fetcher,all,ready:()=>{ready=true;},count:()=>submitCount,
    current:()=>firstBody,submitted:()=>submitted};
}
const candidateArgs=(f,h)=>({origin:'https://central.example.com',
  agentId:'agent_aaa',ticketId:'ticket_abc',
  dir:f.worker,signer:f.signer,fetcher:h.fetcher});
function commitAuthorizedChange(f){
  const work=path.join(f.worker,'worktrees','ticket_abc');
  fs.writeFileSync(path.join(work,'src','feature.ts'),'export const feature=2;\n');
  run(work,'add','src/feature.ts');
  run(work,'-c','user.name=SUTRADHAR CI','-c','user.email=test@example.invalid',
    'commit','-m','scoped authorized change');
  return run(work,'rev-parse','HEAD');
}
test('OS-vault candidate signer accepts only fixed committed head/tree and cannot sign QA/push',
  ()=>{
    const f=fixture();
    try{
      const data={request_id:'submit_example123',agent_id:'agent_aaa',
        ticket_id:'ticket_abc',lease_id:'11111111-1111-4111-8111-111111111111',
        expected_master_epoch:7,
        candidate_head_sha:'a'.repeat(40),candidate_tree_sha:'b'.repeat(40)};
      const signed=f.signer.signWorkerAction({operation:'submit',
        agent_id:'agent_aaa',payload:data});
      assert.equal(signed.uri,'/v7/tasks/submit');
      assert.deepEqual(JSON.parse(signed.body),data);
      assert.doesNotMatch(JSON.stringify(signed),/PRIVATE KEY/);
      assert.throws(()=>f.signer.sign({kind:'node_api',method:'POST',
        uri:'/v7/tasks/submit',body:signed.body}),/DENIED/);
      for(const p of [{...data,candidate_head_sha:'invalid'},
        {...data,expected_master_epoch:0},{...data,extra_owner:true}]){
        assert.throws(()=>f.signer.signWorkerAction({operation:'submit',
          agent_id:'agent_aaa',payload:p}),/DENIED/);
      }
      assert.throws(()=>f.signer.signWorkerAction({operation:'qa-receipt',
        agent_id:'agent_aaa',payload:data}),/DENIED/);
    }finally{f.close();}
  });
test('verified local scoped commit is recorded in Central without Git push or QA approval',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      const head=commitAuthorizedChange(f);
      const result=await submitWorkerCandidate(candidateArgs(f,h));
      assert.equal(result.accepted,true);
      assert.equal(result.status,'SUBMITTED_FOR_REVIEW');
      assert.equal(result.candidate_head_sha,head);
      assert.deepEqual(result.changed_paths,['src/feature.ts']);
      assert.equal(result.git_push_allowed,false);
      assert.equal(result.qa_passed,false);
      assert.equal(h.count(),1);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_pending_ticket_abc.json')),false);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_receipt_ticket_abc.json')),true);
      assert.ok(!h.all.some(x=>/push|merge|qa-receipt/.test(x.uri)));
      const again=await submitWorkerCandidate(candidateArgs(f,h));
      assert.equal(again.already_submitted,true);
      assert.equal(h.count(),1);
    }finally{f.close();}
  });
test('lost response after Central commit is reconciled with signed read-only SHA proof',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f,{loseReply:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();commitAuthorizedChange(f);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SIMULATED_SUBMIT_ACK_LOST/);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_pending_ticket_abc.json')),true);
      const replay=await submitWorkerCandidate(candidateArgs(f,h));
      assert.equal(replay.already_submitted,true);
      assert.equal(h.count(),1,'No second POST when remote already records exact hashes');
      assert.equal(fs.existsSync(path.join(f.worker,'submission_receipt_ticket_abc.json')),true);
    }finally{f.close();}
  });
test('uncommitted, untracked or unapproved files never reach Central submit API',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      const work=path.join(f.worker,'worktrees','ticket_abc');
      fs.writeFileSync(path.join(work,'untracked.tmp'),'unfinished');
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_UNCOMMITTED_OR_UNTRACKED_CHANGES/);
      fs.unlinkSync(path.join(work,'untracked.tmp'));
      fs.mkdirSync(path.join(work,'private'));
      fs.writeFileSync(path.join(work,'private','unapproved.txt'),'not allowed');
      run(work,'add','private/unapproved.txt');
      run(work,'-c','user.name=SUTRADHAR CI','-c','user.email=test@example.invalid',
        'commit','-m','unauthorized path');
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_CHANGED_PATH_OR_MODE_NOT_AUTHORIZED/);
      assert.equal(h.count(),0);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_pending_ticket_abc.json')),false);
    }finally{f.close();}
  });
test('Central checkpoint must be verified before a signed candidate submit',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));commitAuthorizedChange(f);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_CHECKPOINT_REQUIRED/);
      assert.equal(h.count(),0);
    }finally{f.close();}
  });
test('changed Git head after lost submission response requires Owner reconciliation',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f,{loseReply:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      commitAuthorizedChange(f);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SIMULATED_SUBMIT_ACK_LOST/);
      const work=path.join(f.worker,'worktrees','ticket_abc');
      fs.writeFileSync(path.join(work,'src','feature.ts'),'export const feature=3;\n');
      run(work,'add','src/feature.ts');
      run(work,'-c','user.name=SUTRADHAR CI','-c','user.email=test@example.invalid',
        'commit','-m','unexpected new commit');
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_REMOTE_PROOF_NOT_CONFIRMED/);
      assert.equal(h.count(),1);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_pending_ticket_abc.json')),true);
    }finally{f.close();}
  });
test('mismatched remote SHA after accepted POST does not mark submission verified',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f,{wrongRemoteSha:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();commitAuthorizedChange(f);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_REMOTE_PROOF_NOT_CONFIRMED/);
      assert.equal(h.count(),1);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_pending_ticket_abc.json')),true);
      assert.equal(fs.existsSync(path.join(f.worker,'submission_receipt_ticket_abc.json')),false);
    }finally{f.close();}
  });
test('hidden out-of-scope intermediate Git commit is rejected despite clean final diff',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      const work=path.join(f.worker,'worktrees','ticket_abc');
      fs.mkdirSync(path.join(work,'private'));
      fs.writeFileSync(path.join(work,'private','temporary.txt'),'secret history\n');
      run(work,'add','private/temporary.txt');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','-m','hidden unauthorized addition');
      run(work,'rm','private/temporary.txt');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','-m','hide previous change');
      commitAuthorizedChange(f);
      // Final baseline-to-head diff is only src/feature.ts, but Git history
      // still carries the prohibited private/temporary.txt addition.
      assert.equal(run(work,'diff','--name-only',f.baseline,'HEAD'),'src/feature.ts');
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_HISTORY_PATH_OR_MODE_NOT_AUTHORIZED/);
      assert.equal(h.count(),0,'No Central submission on historical scope violation');
    }finally{f.close();}
  });

test('non-linear merge history is denied despite an authorized final tree',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      const work=path.join(f.worker,'worktrees','ticket_abc');
      run(work,'checkout','-b','side_review');
      fs.writeFileSync(path.join(work,'src','feature.ts'),'export const feature=4;\n');
      run(work,'add','src/feature.ts');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','-m','side change');
      run(work,'checkout','ai/ticket_abc');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','--allow-empty','-m','candidate anchor');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','merge','--no-ff','--no-edit','side_review');
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_HISTORY_NON_LINEAR_OR_SHALLOW/);
      assert.equal(h.count(),0);
    }finally{f.close();}
  });

test('two linear scoped commits remain eligible for candidate review',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      commitAuthorizedChange(f);
      const work=path.join(f.worker,'worktrees','ticket_abc');
      fs.writeFileSync(path.join(work,'src','feature.ts'),'export const feature=5;\n');
      run(work,'add','src/feature.ts');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','-m','second authorized edit');
      const response=await submitWorkerCandidate(candidateArgs(f,h));
      assert.equal(response.accepted,true);
      assert.equal(response.status,'SUBMITTED_FOR_REVIEW');
      assert.deepEqual(response.changed_paths,['src/feature.ts']);
      assert.equal(h.count(),1);
    }finally{f.close();}
  });

test('new scoped candidate file matching a dormant baseline Git filter is rejected',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      // Baseline has no matching tracked file; claim-time checks cannot see
      // this dormant wildcard. The candidate introduces the first match.
      fs.writeFileSync(path.join(f.repo,'.gitattributes'),
        'src/*.special filter=untrusted\n');
      run(f.repo,'add','.gitattributes');
      run(f.repo,'commit','-m','baseline with dormant wildcard filter');
      f.baseline=run(f.repo,'rev-parse','HEAD');
      const h=candidateHarness(f,{writeScopes:['src/new.special']});
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      const work=path.join(f.worker,'worktrees','ticket_abc');
      fs.writeFileSync(path.join(work,'src','new.special'),
        'new authorized file\n');
      run(work,'add','src/new.special');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','-m','new scoped file');
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_CANDIDATE_ACTIVE_GIT_FILTER_REQUIRES_OWNER_REVIEW/);
      assert.equal(h.count(),0,'No Central submit POST for unsafe Git attributes');
      assert.equal(fs.existsSync(path.join(f.worker,
        'submission_pending_ticket_abc.json')),false);
    }finally{f.close();}
  });

test('new scoped candidate file with no active Git attributes can be submitted',
  {skip:!available},async()=>{
    const f=fixture(),h=candidateHarness(f,{writeScopes:['src/new.special']});
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();
      const work=path.join(f.worker,'worktrees','ticket_abc');
      fs.writeFileSync(path.join(work,'src','new.special'),'clean new file\n');
      run(work,'add','src/new.special');
      run(work,'-c','user.name=SUTRADHAR CI',
        '-c','user.email=test@example.invalid','commit','-m','new safe file');
      const result=await submitWorkerCandidate(candidateArgs(f,h));
      assert.equal(result.status,'SUBMITTED_FOR_REVIEW');
      assert.deepEqual(result.changed_paths,['src/new.special']);
      assert.equal(h.count(),1);
    }finally{f.close();}
  });

test('packaged candidate UI and bundle retain Owner-confirmed bounded submission boundary',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const setup=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.ok(pkg.build.files.includes('worker-submit.cjs'));
  assert.match(main,/ipcMain\.handle\('sutradhar:submitWorkerCandidate'/);
  assert.match(main,/approvedWorkerOperator\(agentId,ticketId,true\)/);
  assert.match(main,/Submit exact committed candidate for independent review/);
  assert.match(preload,/submitWorkerCandidate:\(agentId,ticketId\)/);
  assert.doesNotMatch(preload,/signWorkerAction|private_key_pem/);
  assert.match(setup,/id="workerSubmit"/);
});


test('dangling one-shot progress journal is never treated as a new checkpoint intent',
  {skip:!available||process.platform==='win32'},async()=>{
    const f=fixture(),h=progressHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));
      const marker=path.join(f.worker,'progress_ticket_abc.json');
      fs.symlinkSync(path.join(f.worker,'missing-pending'),marker);
      assert.equal(fs.existsSync(marker),false);
      await assert.rejects(progressWorkerTask(progressArgs(f,h,
        'checkpoint',checkpointContent)),/WORKER_PROGRESS_JOURNAL_UNTRUSTED/);
      assert.equal(h.progressCount(),0,'No new checkpoint POST after ambiguous journal');
      assert.equal(fs.lstatSync(marker).isSymbolicLink(),true);
    }finally{f.close();}
  });
test('dangling previous checkpoint receipt cannot be overwritten on exact-ID retry',
  {skip:!available||process.platform==='win32'},async()=>{
    const f=fixture(),h=progressHarness(f,{lostOnce:true});
    try{
      await claimApprovedTask(args(f,h.fetcher));
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',
        checkpointContent)),/SIMULATED_PROGRESS_REPLY_LOST/);
      const pending=h.getPending();
      const witness=path.join(f.worker,'progress_receipt_'+pending.body.request_id+'.json');
      fs.symlinkSync(path.join(f.worker,'missing-prior-receipt'),witness);
      await assert.rejects(progressWorkerTask(progressArgs(f,h,'checkpoint',
        checkpointContent)),/WORKER_PROGRESS_RECEIPT_UNTRUSTED/);
      assert.equal(h.progressCount(),2,'Existing exact request ID only');
      assert.equal(fs.lstatSync(witness).isSymbolicLink(),true);
    }finally{f.close();}
  });

test('dangling candidate submit journal blocks a second Central submit POST',
  {skip:!available||process.platform==='win32'},async()=>{
    const f=fixture(),h=candidateHarness(f);
    try{
      await claimApprovedTask(args(f,h.fetcher));h.ready();commitAuthorizedChange(f);
      const pending=path.join(f.worker,'submission_pending_ticket_abc.json');
      fs.symlinkSync(path.join(f.worker,'missing-submission'),pending);
      assert.equal(fs.existsSync(pending),false);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_JOURNAL_UNTRUSTED/);
      assert.equal(h.count(),0);
      fs.unlinkSync(pending);
      const receipt=path.join(f.worker,'submission_receipt_ticket_abc.json');
      fs.symlinkSync(path.join(f.worker,'missing-receipt'),receipt);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_RECEIPT_CONFLICT_REQUIRES_OWNER_REVIEW/);
      assert.equal(h.count(),0);
      fs.unlinkSync(receipt);
      const checkpoint=path.join(f.worker,'progress_ticket_abc.json');
      fs.symlinkSync(path.join(f.worker,'missing-checkpoint'),checkpoint);
      await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
        /SUBMIT_PENDING_PROGRESS_REQUIRES_RECONCILIATION/);
      assert.equal(h.count(),0);
    }finally{f.close();}
  });


test('dangling one-shot claim and receipt evidence block a second claim before Central write',
  {skip:!available||process.platform==='win32'},async()=>{
    const f=fixture(),r=remote(f);
    try{
      const pending=path.join(f.worker,'claim_ticket_abc.json');
      fs.symlinkSync(path.join(f.worker,'absent-claim'),pending);
      assert.equal(fs.existsSync(pending),false);
      await assert.rejects(claimApprovedTask(args(f,r.fetcher)),
        /WORKER_LOCAL_RECORD_UNTRUSTED/);
      assert.equal(r.claims(),0);
      fs.unlinkSync(pending);
      const receipt=path.join(f.worker,'receipt_ticket_abc.json');
      fs.symlinkSync(path.join(f.worker,'absent-receipt'),receipt);
      await assert.rejects(claimApprovedTask(args(f,r.fetcher)),
        /WORKER_EXISTING_RECEIPT_REQUIRES_RESUME/);
      assert.equal(r.claims(),0);
      assert.equal(fs.lstatSync(receipt).isSymbolicLink(),true);
    }finally{f.close();}
  });
test('claim receipt write cannot replace a racing prior on-disk receipt', {skip:!available},async()=>{
  const f=fixture(),r=remote(f),original=fs.openSync;
  const receipt=path.join(f.worker,'receipt_ticket_abc.json');
  const prior=Buffer.from('interrupted earlier receipt: requires Owner review');
  let injected=false;
  try{
    fs.openSync=function(p,flags,...rest){
      if(p===receipt&&flags==='wx'&&!injected){
        injected=true;
        fs.writeFileSync(receipt,prior,{mode:0o600});
      }
      return original.call(this,p,flags,...rest);
    };
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/EEXIST/);
    assert.equal(injected,true);
    assert.equal(r.claims(),1,'exactly one Central claim, no second attempt');
    assert.deepEqual(fs.readFileSync(receipt),prior);
    assert.equal(fs.existsSync(path.join(f.worker,'claim_ticket_abc.json')),true);
  }finally{fs.openSync=original;f.close();}
});


test('dangling worktree target is Owner-held before local Git branch creation',
  {skip:!available||process.platform==='win32'},async()=>{
    const f=fixture(),r=remote(f);
    try{
      const root=path.join(f.worker,'worktrees');
      fs.mkdirSync(root);
      const target=path.join(root,'ticket_abc');
      fs.symlinkSync(path.join(root,'missing-previous-worktree'),target);
      assert.equal(fs.existsSync(target),false);
      await assert.rejects(claimApprovedTask(args(f,r.fetcher)),
        /WORKER_LOCAL_PATH_UNTRUSTED/);
      assert.equal(r.claims(),0);
      const ref=cp.spawnSync('git',['-C',f.repo,'show-ref','--verify','--quiet',
        'refs/heads/ai/ticket_abc']);
      assert.equal(ref.status,1,'No Git branch was created before Owner recovery');
      assert.equal(fs.lstatSync(target).isSymbolicLink(),true);
    }finally{f.close();}
  });
test('dangling worker Git hook/worktree root cannot be treated as absent',
  {skip:!available||process.platform==='win32'},async()=>{
    for(const name of ['disabled-git-hooks','worktrees']){
      const f=fixture(),r=remote(f);
      try{
        const dir=path.join(f.worker,name);
        fs.symlinkSync(path.join(f.worker,'missing-dir'),dir);
        await assert.rejects(claimApprovedTask(args(f,r.fetcher)),
          /WORKER_LOCAL_PATH_UNTRUSTED/);
        assert.equal(r.claims(),0);
        assert.equal(fs.lstatSync(dir).isSymbolicLink(),true);
      }finally{f.close();}
    }
  });


test('broad Central scope cannot submit nested secret or build-execution files',
  {skip:!available},async()=>{
    for(const unsafe of ['package.json','.env.production','.npmrc','.gitignore']){
      const f=fixture(),h=candidateHarness(f,{writeScopes:['src']});
      try{
        await claimApprovedTask(args(f,h.fetcher));h.ready();
        const work=path.join(f.worker,'worktrees','ticket_abc');
        const file=path.join(work,'src',unsafe);
        fs.writeFileSync(file,'worker-controlled Git config or secret\n');
        run(work,'add','--','src/'+unsafe);
        run(work,'-c','user.name=SUTRADHAR CI',
          '-c','user.email=test@example.invalid','commit','-m','nested unsafe file');
        await assert.rejects(submitWorkerCandidate(candidateArgs(f,h)),
          /SUBMIT_CHANGED_PATH_OR_MODE_NOT_AUTHORIZED/);
        assert.equal(h.count(),0,'Unsafe '+unsafe+' must never POST Central submit');
        assert.equal(fs.existsSync(path.join(f.worker,
          'submission_pending_ticket_abc.json')),false);
      }finally{f.close();}
    }
  });

test('nonempty disabled hooks directory holds worker claim before branch creation or Central mutation', {skip:!available},async()=>{
  const f=fixture(),r=remote(f);
  try{
    const hooks=path.join(f.worker,'disabled-git-hooks');fs.mkdirSync(hooks);
    const hook=path.join(hooks,'post-checkout');
    // A benign sentinel is sufficient; the test must not execute a hook.
    const bytes='# fixture: this file must never be used as a Git hook\\n';
    fs.writeFileSync(hook,bytes,{mode:0o700});
    await assert.rejects(claimApprovedTask(args(f,r.fetcher)),/WORKER_DISABLED_GIT_HOOKS_NOT_EMPTY/);
    assert.equal(r.claims(),0);
    assert.equal(run(f.repo,'branch','--list','ai/ticket_abc'),'');
    assert.equal(fs.existsSync(path.join(f.worker,'claim_ticket_abc.json')),false);
    assert.equal(fs.readFileSync(hook,'utf8'),bytes);
  }finally{f.close();}
});
test('nonempty disabled hooks directory holds resume without changing prior lease receipt', {skip:!available},async()=>{
  const f=fixture(),r=remote(f);
  try{
    await claimApprovedTask(args(f,r.fetcher));
    const receipt=path.join(f.worker,'receipt_ticket_abc.json');
    const before=fs.readFileSync(receipt);
    fs.writeFileSync(path.join(f.worker,'disabled-git-hooks','post-checkout'),'sentinel');
    await assert.rejects(resumeApprovedTask(args(f,r.fetcher)),/WORKER_DISABLED_GIT_HOOKS_NOT_EMPTY/);
    assert.deepEqual(fs.readFileSync(receipt),before);
    assert.equal(r.claims(),1);
  }finally{f.close();}
});


test('provider-attempt signer only permits exact metadata and never generic heartbeat-child signing',()=>{
  const f=fixture();
  try{
    const body={request_id:'provider_abc123',agent_id:'agent_aaa',ticket_id:'ticket_abc',
      lease_id:'11111111-1111-4111-8111-111111111111',expected_master_epoch:7,action:'BEGIN',
      provider:'CHATGPT_WEB',registry_version:1,expected_task_version:3,binding_sha256:'b'.repeat(64),
      checkpoint_generation:1,checkpoint_sha256:'c'.repeat(64),context_sha256:'d'.repeat(64)};
    const sign=payload=>f.signer.signWorkerAction({operation:'provider-attempt',agent_id:'agent_aaa',payload});
    const signed=sign(body);
    assert.equal(signed.uri,'/v7/tasks/provider-attempt');
    assert.deepEqual(JSON.parse(signed.body),body);
    for(const forged of [{...body,prompt:'not accepted'},{...body,registry_version:0},
      {...body,context_sha256:'bad'},{...body,provider:'UNKNOWN'},{...body,agent_id:'agent_foreign'}])
      assert.throws(()=>sign(forged),/DENIED/);
    assert.throws(()=>f.signer.sign({kind:'node_api',method:'POST',uri:signed.uri,body:signed.body}),/DENIED/);
    const {provider,registry_version,expected_task_version,binding_sha256,checkpoint_generation,checkpoint_sha256,context_sha256,...common}=body;
    const close={...common,action:'CLOSE',attempt_id:'attempt_'+'a'.repeat(32),
      external_session_reviewed:true,worktree_reviewed:true};
    assert.equal(sign(close).uri,signed.uri);
    assert.throws(()=>sign({...close,worktree_reviewed:false}),/DENIED/);
    assert.throws(()=>sign({...close,chat_id:'unexpected'}),/DENIED/);
  }finally{f.close();}
});

test('signed Desktop manual provider lifecycle recomputes reviewed context and verifies readback', {skip:!available},async()=>{
  const f=fixture(),r=remote(f);
  try{
    await claimApprovedTask(args(f,r.fetcher));
    const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
    const lease_id='11111111-1111-4111-8111-111111111111',agent_id='agent_aaa',ticket_id='ticket_abc';
    const binding={project_id:'project_aaa',agent_id,provider:'CHATGPT_WEB',
      account_ref:'account_example',workspace_ref:'workspace_example'};
    const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
    const checkpoint=g=>({generation:g,summary:'Reviewed work generation '+g,next_action:'Review next step',
      content_sha256:sha('Reviewed work generation '+g+'\nReview next step')});
    const task={ticket_id,project_id:binding.project_id,repository:'example/repo',branch_name:'ai/ticket_abc',
      baseline_sha:f.baseline,title:'Build one feature',description:'Review source and add test',risk:'LOW',
      version:3,status:'CHECKPOINTED',worker_agent_id:agent_id,write_scopes:['src/feature.ts'],
      acceptance_criteria:['Test passes'],latest_checkpoint:checkpoint(1),
      provider_mapping_state:'OWNER_DECLARED_UNVERIFIED',provider_mapping_source:'MYSQL_OWNER_REGISTRY',
      provider_registry_version:1,provider_mappings:[{provider:binding.provider,account_ref:binding.account_ref,
        workspace_ref:binding.workspace_ref,binding_sha256:sha(JSON.stringify(binding)),
        state:'OWNER_DECLARED_UNVERIFIED',provider_mapping_verified:false,automatic_execution_allowed:false}],
      provider_attempt:null};
    let ledger=null,posts=0,lost=false,wrongLease=false;
    const metadata=()=>ledger?{attempt_id:ledger.attempt_id,state:ledger.state,registry_version:ledger.registry_version,
      checkpoint_generation:ledger.checkpoint_generation,context_sha256:ledger.context_sha256,
      provider:ledger.provider,resolution:ledger.resolution}:null;
    const fetcher=async(url,init)=>{
      const uri=new URL(url).pathname;
      assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
      const h=init.headers,raw=init.body||'';
      const canonical=[h['x-sutradhar-timestamp'],h['x-sutradhar-nonce'],init.method,uri,sha(raw)].join('\n');
      assert.equal(crypto.verify(null,Buffer.from(canonical),crypto.createPublicKey(f.pub.public_key_pem),
        Buffer.from(h['x-sutradhar-signature'],'base64')),true);
      let value;
      if(uri==='/v7/tasks/resume-check')value={resume_allowed:true,automatic_execution_allowed:false,
        agent_id,ticket_id,lease_id:wrongLease?'22222222-2222-4222-8222-222222222222':lease_id,epoch:7,
        project_id:task.project_id,repository:task.repository,branch_name:task.branch_name,
        baseline_sha:task.baseline_sha,write_scopes:task.write_scopes,status:task.status,latest_checkpoint:task.latest_checkpoint};
      else if(uri==='/v7/tasks/detail/'+ticket_id)value={...task,provider_attempt:metadata()};
      else if(uri==='/v7/tasks/provider-attempt'){
        posts++;const b=JSON.parse(raw);
        if(b.action==='BEGIN')assert.equal(b.expected_task_version,task.version);
        if(b.action==='BEGIN')ledger={attempt_id:'attempt_'+'a'.repeat(32),ticket_id,agent_id,lease_id,
          epoch:7,registry_version:b.registry_version,provider:b.provider,binding_sha256:b.binding_sha256,
          checkpoint_generation:b.checkpoint_generation,checkpoint_sha256:b.checkpoint_sha256,
          context_sha256:b.context_sha256,state:'OPEN',resolution:null};
        else if(b.action==='INTERRUPT')ledger={...ledger,state:'INTERRUPTED'};
        else ledger={...ledger,state:'CLOSED',resolution:'WORKER_CHECKPOINT'};
        if(lost)throw Error('FIXTURE_LOST_ACK');
        value={accepted:true,attempt:ledger,provider_sent:false,provider_mapping_verified:false,automatic_execution_allowed:false};
      }else throw Error('UNEXPECTED_ENDPOINT');
      return new Response(JSON.stringify(value),{status:200});
    };
    const call=patch=>recordProviderAttempt({...args(f,fetcher),action:'BEGIN',provider:'CHATGPT_WEB',
      reviewedDigest:compactWorkerContext({...task,provider_attempt:null},agent_id).context_sha256,
      reviewedRegistryVersion:1,reviewedBindingDigest:task.provider_mappings[0].binding_sha256,...patch});
    await assert.rejects(call({reviewedDigest:'0'.repeat(64)}),/REVIEWED_CONTEXT_CHANGED/);
    await assert.rejects(call({reviewedRegistryVersion:2}),/REVIEWED_MAPPING_CHANGED/);
    await assert.rejects(call({reviewedBindingDigest:'0'.repeat(64)}),/REVIEWED_MAPPING_CHANGED/);
    assert.equal(posts,0);
    wrongLease=true;await assert.rejects(call({}),/LEASE_MISMATCH/);wrongLease=false;
    await assert.rejects(call({beforeMutation:()=>{throw Error('LOCAL_FENCE');}}),/LOCAL_FENCE/);
    assert.equal(posts,0);
    const opened=await call({});assert.equal(opened.attempt.state,'OPEN');assert.equal(posts,1);
    assert.equal(opened.provider_sent,false);
    await assert.rejects(call({}),/RECONCILIATION_REQUIRED/);
    const attemptId=opened.attempt.attempt_id;
    const interrupted=await call({action:'INTERRUPT',attemptId});
    assert.equal(interrupted.attempt.state,'INTERRUPTED');
    await assert.rejects(call({action:'CLOSE',attemptId}),/FRESH_CHECKPOINT_REQUIRED/);
    assert.equal(posts,2);
    task.latest_checkpoint=checkpoint(2);task.version++;
    const closed=await call({action:'CLOSE',attemptId});
    assert.equal(closed.attempt.resolution,'WORKER_CHECKPOINT');assert.equal(posts,3);
    lost=true;
    await assert.rejects(call({}),/OUTCOME_UNCERTAIN/);
    assert.equal(posts,4);
    await assert.rejects(call({}),/RECONCILIATION_REQUIRED/);
    assert.equal(posts,4,'uncertain committed BEGIN is not retried');
  }finally{f.close();}
});

test('Desktop renderer exposes only explicit attempt commands and a separate context field',()=>{
  const root=path.join(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const renderer=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.match(main,/ipcMain\.handle\('sutradhar:recordProviderAttempt'/);
  assert.match(preload,/recordProviderAttempt:\(agentId,ticketId,action,provider,reviewedDigest,attemptId\)/);
  assert.doesNotMatch(preload,/signWorkerAction|private_key_pem/);
  assert.match(html,/id="workerProviderPreview"[^>]*readonly/);
  assert.match(renderer,/get\('workerProviderPreview'\)\.value=r\.preview/);
  assert.doesNotMatch(renderer,/\+r\.preview;/);
});


test('Master planning Desktop preview, admission and historical receipt are narrowly signed and independently checked',{skip:!available},async()=>{
  const f=fixture();
  try{
    const task=i=>({ticket_id:'ticket_plan_'+i,baseline_sha:f.baseline,branch_name:'ai/plan_'+i,
      title:'Implement task '+i,description:'Review local scope',risk:'LOW',write_scopes:['src/file'+i+'.ts'],
      acceptance_criteria:['Test passes'],dependencies:i===2?['ticket_plan_1']:[],contract_keys:[]});
    const args={origin:'https://central.example.com',agentId:'agent_aaa',projectId:'project_aaa',
      requestId:'batch_review_001',tasks:[task(2),task(1)],signer:f.signer};
    let master='agent_aaa',posted=0,receipt=null,lost=false,badPreview=false,wrongReceipt=false;
    const digest='a'.repeat(64);
    const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
    const fetcher=async(url,init)=>{
      const uri=new URL(url).pathname,h=init.headers,raw=init.body||'';
      assert.equal(new URL(url).origin,args.origin);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
      const canonical=[h['x-sutradhar-timestamp'],h['x-sutradhar-nonce'],init.method,uri,sha(raw)].join('\n');
      assert.equal(crypto.verify(null,Buffer.from(canonical),crypto.createPublicKey(f.pub.public_key_pem),Buffer.from(h['x-sutradhar-signature'],'base64')),true);
      let result;
      if(uri==='/v7/cluster/state')result={phase:'READY',paused:false,epoch:7,master_agent_id:master};
      else if(uri==='/v7/tasks/plan-batch/preview'){
        const b=JSON.parse(raw);
        const ordered=[...b.tasks].sort((a,b)=>a.ticket_id.localeCompare(b.ticket_id));
        const tickets=ordered.map(t=>({ticket_id:t.ticket_id,status:'READY',version:1,owner_approval_required:false}));
        receipt={accepted:true,project_id:b.project_id,request_id:b.request_id,epoch:b.expected_master_epoch,
          preview_sha256:digest,plan_order:ordered.map(t=>t.ticket_id),tickets,
          automatic_execution_allowed:false,semantic_discovery_verified:false,baseline_verified:false};
        result={...receipt,read_only:true,tickets:tickets.map((t,i)=>({...t,dependencies:ordered[i].dependencies,
          write_scopes:badPreview?['wrong.ts']:ordered[i].write_scopes,contract_keys:ordered[i].contract_keys}))};
      }else if(uri==='/v7/tasks/plan-batch'){
        posted++;
        const b=JSON.parse(raw);assert.equal(b.preview_sha256,digest);assert.equal(b.tasks[0].title,'Implement task 2');
        if(lost)throw Error('LOST_COMMIT_REPLY');
        result=wrongReceipt?{...receipt,preview_sha256:'b'.repeat(64)}:receipt;
      }else if(uri==='/v7/tasks/plan-batch/receipt'){
        const b=JSON.parse(raw);assert.deepEqual(Object.keys(b).sort(),['agent_id','preview_sha256','project_id','request_id']);
        result={read_only:true,historical_receipt:true,automatic_execution_allowed:false,receipt};
      }else throw Error('UNEXPECTED_ENDPOINT');
      return new Response(JSON.stringify(result));
    };
    master='agent_other';await assert.rejects(previewMasterBatch({...args,fetcher}),/MASTER_NOT_READY/);
    master='agent_aaa';badPreview=true;
    await assert.rejects(previewMasterBatch({...args,fetcher}),/DECLARATION_MISMATCH/);
    badPreview=false;
    const prepared=await previewMasterBatch({...args,fetcher});
    assert.equal(prepared.review.preview_sha256,digest);assert.deepEqual(prepared.review.plan_order,['ticket_plan_1','ticket_plan_2']);
    assert.equal(posted,0);
    args.tasks[0].title='changed outside reviewed snapshot';
    await assert.rejects(commitMasterBatch({...args,prepared,fetcher,beforeMutation:()=>{throw Error('FENCED');}}),/FENCED/);
    assert.equal(posted,0);
    wrongReceipt=true;
    await assert.rejects(commitMasterBatch({...args,prepared,fetcher}),/OUTCOME_UNCERTAIN/);
    wrongReceipt=false;lost=true;
    await assert.rejects(commitMasterBatch({...args,prepared,fetcher}),/OUTCOME_UNCERTAIN/);
    assert.equal(posted,2,'each explicit invocation makes exactly one POST');
    const readback=await inspectMasterBatchReceipt({...args,reviewedDigest:digest,fetcher});
    assert.equal(readback.historical_receipt,true);assert.equal(readback.automatic_execution_allowed,false);
    assert.equal(posted,2);
    const sign=payload=>f.signer.signWorkerAction({operation:'plan-batch-preview',agent_id:args.agentId,payload});
    assert.equal(sign(prepared.body).uri,'/v7/tasks/plan-batch/preview');
    for(const patch of [{tasks:[task(1)]},{tasks:[{...task(1),credential:'not allowed'},task(2)]},{expected_master_epoch:0},{arbitrary_url:'https://example.invalid'}])
      assert.throws(()=>sign({...prepared.body,...patch}),/DENIED/);
    assert.throws(()=>f.signer.sign({kind:'node_api',method:'POST',uri:'/v7/tasks/plan-batch',body:'{}'}),/DENIED/);
  }finally{f.close();}
});

test('Master planning renderer exposes narrow reviewed admission only',()=>{
  const root=path.join(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const renderer=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.match(main,/masterBatchReview=\{origin,prepared\}/);
  assert.match(main,/masterBatchReview!==saved/);
  assert.match(preload,/commitMasterBatch:\(agentId,projectId,requestId,digest\)/);
  assert.doesNotMatch(preload,/signWorkerAction|private_key_pem/);
  assert.match(html,/id="masterDraft"[^>]*readonly/);
  assert.match(renderer,/get\('masterReviewed'\)\.checked!==true/);
  assert.match(renderer,/invalidateMasterReview\(\{clearDigest:false\}\)/);
});


test('encrypted Master admission journal survives restart, prevents a second unresolved intent, and closes only on exact receipt',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-master-journal-'));
  try{
    const storage=safeStorage(),nodeId='node_'+'a'.repeat(32);
    const origin='https://central.example.com';
    const create=()=>createMasterBatchJournal({dir,safeStorage:storage,nodeId});
    const tasks=['1','2'].map(i=>({ticket_id:'ticket_plan_'+i,baseline_sha:'b'.repeat(40),
      branch_name:'ai/plan_'+i,title:'Private reviewed task '+i,description:'Private scope explanation',
      risk:'LOW',write_scopes:['src/file'+i+'.ts'],acceptance_criteria:['Test passes'],dependencies:[],contract_keys:[]}));
    const body={agent_id:'agent_aaa',project_id:'project_aaa',request_id:'batch_review_001',expected_master_epoch:7,tasks};
    const review={project_id:body.project_id,request_id:body.request_id,epoch:7,preview_sha256:'a'.repeat(64),
      plan_order:tasks.map(t=>t.ticket_id),tickets:tasks.map(t=>({ticket_id:t.ticket_id,status:'READY',version:1,owner_approval_required:false})),
      automatic_execution_allowed:false,semantic_discovery_verified:false,baseline_verified:false};
    const prepared={body,review},receipt={...review,historical_receipt:true};
    assert.equal(create().pending(),null);
    const saved=create().begin(origin,prepared);
    const files=fs.readdirSync(dir);assert.equal(files.length,1);
    assert.equal(fs.readFileSync(path.join(dir,files[0])).includes(Buffer.from(tasks[0].title)),false);
    assert.deepEqual(create().pending(),saved);
    assert.deepEqual(create().pending().intent.body.tasks,tasks);
    assert.throws(()=>create().begin(origin,{body:{...body,request_id:'batch_other_001'},review:{...review,request_id:'batch_other_001'}}),/PENDING_INSPECT_RECEIPT/);
    assert.throws(()=>create().close(saved.key,{...receipt,preview_sha256:'c'.repeat(64)}),/RECEIPT/);
    assert.deepEqual(create().pending(),saved);
    assert.throws(()=>createMasterBatchJournal({dir,safeStorage:storage,nodeId:'node_'+'c'.repeat(32)}).pending(),/INTENT_INVALID/);
    assert.deepEqual(create().close(saved.key,receipt),receipt);
    assert.equal(create().pending(),null);
    assert.equal(fs.readdirSync(dir).length,2);
    assert.throws(()=>create().begin(origin,prepared),/EEXIST/);
    const body2={...body,request_id:'batch_cancel_example'};
    const review2={...review,request_id:body2.request_id};
    const saved2=create().begin(origin,{body:body2,review:review2});
    const cancellation={resolution:{agent_id:body2.agent_id,project_id:body2.project_id,request_id:body2.request_id,
      preview_sha256:review2.preview_sha256,plan_order:review2.plan_order,state:'ADMISSION_CANCELLED',epoch:9,
      resolution_id:'batch_cancel_'+'d'.repeat(32),owner_review_recorded:true,automatic_execution_allowed:false},
      historical_receipt:true,automatic_execution_allowed:false};
    assert.throws(()=>create().close(saved2.key,{...cancellation,resolution:{...cancellation.resolution,
      plan_order:[...review2.plan_order].reverse()}}),/CANCELLATION_INVALID/);
    assert.deepEqual(create().pending(),saved2);
    assert.deepEqual(create().close(saved2.key,cancellation),cancellation);
    assert.equal(create().pending(),null);
    assert.throws(()=>create().begin(origin,{body:body2,review:review2}),/EEXIST/);
    // Historical evidence is never deleted or silently ignored after corruption.
    fs.writeFileSync(path.join(dir,files[0]),Buffer.from('invalid ciphertext'));
    assert.throws(()=>create().pending(),/CORRUPT_OWNER_REVIEW/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Master project catalog is signed, bounded, exact and unavailable to a non-Master',{skip:!available},async()=>{
  const f=fixture();
  try{
    let agent='agent_aaa',calls=0,extra=false;
    const project={project_id:'project_aaa',display_name:'Same name',repository:'example/repo',base_branch:'main'};
    const fetcher=async(url,init)=>{
      calls++;const uri=new URL(url).pathname;
      assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
      const h=init.headers,raw=init.body||'';
      const canonical=[h['x-sutradhar-timestamp'],h['x-sutradhar-nonce'],init.method,uri,crypto.createHash('sha256').update(raw).digest('hex')].join('\n');
      assert.equal(crypto.verify(null,Buffer.from(canonical),crypto.createPublicKey(f.pub.public_key_pem),Buffer.from(h['x-sutradhar-signature'],'base64')),true);
      if(uri==='/v7/cluster/state')return new Response(JSON.stringify({phase:'READY',paused:false,epoch:7,master_agent_id:agent}));
      assert.equal(uri,'/v7/tasks/plan-batch/projects');assert.deepEqual(JSON.parse(raw),{agent_id:'agent_aaa',expected_master_epoch:7});
      return new Response(JSON.stringify({read_only:true,agent_id:'agent_aaa',epoch:7,truncated:false,
        automatic_execution_allowed:false,baseline_verified:false,
        projects:[extra?{...project,credential:'forbidden'}:project,{...project,project_id:'project_bbb',base_branch:'develop'}]}));
    };
    const args={origin:'https://central.example.com',agentId:'agent_aaa',signer:f.signer,fetcher};
    agent='agent_bbb';await assert.rejects(listMasterProjects(args),/MASTER_NOT_READY/);assert.equal(calls,1);
    agent='agent_aaa';
    const r=await listMasterProjects(args);assert.equal(r.projects.length,2);assert.equal(r.projects[1].base_branch,'develop');
    extra=true;await assert.rejects(listMasterProjects(args),/CATALOG_INVALID/);
    assert.throws(()=>f.signer.signWorkerAction({operation:'plan-batch-projects',agent_id:args.agentId,payload:{agent_id:args.agentId,expected_master_epoch:7,project_id:'project_aaa'}}),/DENIED/);
  }finally{f.close();}
});
test('Master pending intent is journaled before the mutation and recovery IPC cannot sign arbitrary requests',()=>{
  const root=path.join(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  assert.match(main,/const pending=journal\.begin\(origin,saved\.prepared\);[\s\S]*?const result=await commitMasterBatch/);
  assert.match(main,/return journal\.close\(pending\.key,result\)/);
  assert.match(preload,/recoverMasterBatchDraft:agentId=>ipcRenderer.invoke/);
  assert.match(html,/id="masterRecover"/);
  assert.match(html,/id="masterProjectChoice"/);
});
