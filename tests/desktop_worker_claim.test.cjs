'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {createVault}=require('../apps/desktop/os-vault.cjs');
const {createSignerBridge}=require('../apps/desktop/vault-bridge.cjs');
const {claimApprovedTask,resumeApprovedTask}=require('../apps/desktop/worker-claim.cjs');
const {progressWorkerTask}=require('../apps/desktop/worker-progress.cjs');
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
function remote(f,{lostOnce=false,masterEpoch=7,invalidScope=false}={}){
  let claimed=false,claimCount=0,firstBody=null,all=[];
  const task=()=>({ticket_id:'ticket_abc',project_id:'project_aaa',
    repository:'example/repo',base_branch:'main',title:'Build one feature',
    description:'Review source and add test',risk:'LOW',
    branch_name:'ai/ticket_abc',baseline_sha:f.baseline,
    version:claimed?2:1,status:claimed?'CLAIMED':'READY',
    worker_agent_id:claimed?'agent_aaa':null,
    write_scopes:['src/feature.ts'],
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
        write_scopes:invalidScope?['secrets/private.ts']:['src/feature.ts']}),{status:200});
    }
    if(uri==='/v7/tasks/resume-check'&&init.method==='POST'){
      const b=JSON.parse(init.body);
      assert.equal(b.lease_id,'11111111-1111-4111-8111-111111111111');
      return new Response(JSON.stringify({resume_allowed:true,
        automatic_execution_allowed:false,agent_id:'agent_aaa',
        ticket_id:'ticket_abc',epoch:masterEpoch,project_id:'project_aaa',
        repository:'example/repo',branch_name:'ai/ticket_abc',
        baseline_sha:f.baseline,status:'CLAIMED',
        write_scopes:['src/feature.ts'],latest_checkpoint:null}),{status:200});
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
