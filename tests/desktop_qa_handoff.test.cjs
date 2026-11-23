'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {exportCandidateHandoff,inspectQAHandoff}=require('../apps/desktop/qa-handoff.cjs');
const available=cp.spawnSync('git',['--version']).status===0;
const cmd=(dir,...args)=>cp.execFileSync('git',['-C',dir,...args],
  {encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}).trim();
const hex=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-handoff-'));
  const repo=path.join(temp,'repo'),worker=path.join(temp,'worker');
  const qaRepo=path.join(temp,'qa-repo'),offer=path.join(temp,'candidate.bundle');
  fs.mkdirSync(repo);fs.mkdirSync(worker);
  cmd(repo,'init','-b','main');
  cmd(repo,'config','user.name','SUTRADHAR tests');
  cmd(repo,'config','user.email','noreply@example.invalid');
  cmd(repo,'remote','add','origin','https://github.com/example/repo.git');
  fs.mkdirSync(path.join(repo,'src'));
  fs.writeFileSync(path.join(repo,'src','feature.ts'),'export const n=1;\n');
  cmd(repo,'add','.');cmd(repo,'commit','-m','baseline');
  const baseline=cmd(repo,'rev-parse','HEAD');
  const workRoot=path.join(worker,'worktrees');fs.mkdirSync(workRoot);
  const work=path.join(workRoot,'ticket_abc');
  cmd(repo,'worktree','add','-b','ai/ticket_abc',work,baseline);
  fs.writeFileSync(path.join(work,'src','feature.ts'),'export const n=2;\n');
  cmd(work,'add','src/feature.ts');
  cmd(work,'-c','user.name=SUTRADHAR tests','-c','user.email=noreply@example.invalid',
    'commit','-m','candidate scoped');
  const head=cmd(work,'rev-parse','HEAD'),tree=cmd(work,'rev-parse','HEAD^{tree}');
  cp.execFileSync('git',['clone','--no-local','--branch','main',repo,qaRepo],
    {encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  cmd(qaRepo,'remote','set-url','origin','https://github.com/example/repo.git');
  const ctx={agent_id:'agent_dev',ticket_id:'ticket_abc',
    project_id:'project_aaa',repository:'example/repo',
    branch_name:'ai/ticket_abc',baseline_sha:baseline,
    scopes:['src/feature.ts'],repository_dir:fs.realpathSync(repo),
    worktree:work,epoch:7};
  const body={...ctx,lease_id:'11111111-1111-4111-8111-111111111111',
    claim_request_id:'claim_example123'};
  const core={schema:1,context:ctx,body};
  fs.writeFileSync(path.join(worker,'receipt_ticket_abc.json'),
    JSON.stringify({...core,sha256:hex(JSON.stringify(core))})+'\n');
  const task=()=>({ticket_id:'ticket_abc',project_id:'project_aaa',
    title:'QA inspect candidate',description:'offline QA transport',
    repository:'example/repo',branch_name:'ai/ticket_abc',
    baseline_sha:baseline,status:'SUBMITTED_FOR_REVIEW',version:3,risk:'LOW',
    worker_agent_id:'agent_dev',write_scopes:['src/feature.ts'],
    acceptance_criteria:['Review hashes'],candidate_head_sha:head,
    candidate_tree_sha:tree,latest_checkpoint:{generation:1,
      summary:'Finished scoped work',next_action:'Independent QA',
      content_sha256:hex('Finished scoped work\nIndependent QA')}});
  let data=task(),reads=0;
  const fetcher=async(url,init)=>{
    assert.equal(new URL(url).pathname,'/v7/tasks/detail/ticket_abc');
    assert.equal(init.method,'GET');reads++;
    return new Response(JSON.stringify(data),{status:200});
  };
  const signer={signWorkerReadOnly:()=>({})};
  const opts={origin:'https://central.example.com',ticketId:'ticket_abc',
    signer,fetcher,bundlePath:offer};
  return {temp,repo,worker,work,qaRepo,offer,head,tree,baseline,
    task,signer,fetcher,opts,reads:()=>reads,
    updateTask:t=>{data=t;},
    close:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
test('offline developer export and different QA agent inspect same committed tree in disposable bare quarantine',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      const out=await exportCandidateHandoff({...f.opts,
        agentId:'agent_dev',dir:f.worker});
      assert.equal(out.qa_approved,false);
      assert.equal(out.git_published,false);
      assert.equal(out.candidate_head_sha,f.head);
      const before=cmd(f.qaRepo,'rev-parse','HEAD');
      const status=await inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo});
      assert.equal(status.verified,true);
      assert.equal(status.kind,'QA_OFFLINE_OBJECTS_INSPECTED_ONLY');
      assert.equal(status.imported_into_trusted_repo,false);
      assert.equal(status.automatic_execution_allowed,false);
      assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),before);
      assert.equal(cmd(f.qaRepo,'status','--porcelain'),'');
      assert.equal(f.reads(),3);
      assert.ok(!fs.readdirSync(f.temp).some(n=>n.startsWith('sutradhar-qa-quarantine-')));
    }finally{f.close();}
  });
test('tampered bundle, malformed manifest and self-QA are denied before any trusted checkout changes',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_dev',repoDir:f.qaRepo}),/HANDOFF_CENTRAL_TASK_NOT_AUTHORIZED/);
      fs.appendFileSync(f.offer,'bundle altered');
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_BUNDLE_DIGEST_MISMATCH/);
      const j=JSON.parse(fs.readFileSync(f.offer+'.json','utf8'));
      j.qa_approved=true;
      fs.writeFileSync(f.offer+'.json',JSON.stringify(j));
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_MANIFEST_INVALID/);
      assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),f.baseline);
    }finally{f.close();}
  });
test('Central mismatch and untrusted QA origin deny transfer; local untracked files are never used',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      f.updateTask({...f.task(),candidate_head_sha:'f'.repeat(40)});
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_MANIFEST_CENTRAL_MISMATCH/);
      f.updateTask(f.task());
      fs.writeFileSync(path.join(f.qaRepo,'untracked.txt'),'not used by bare inspection');
      const proven=await inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo});
      assert.equal(proven.verified,true);
      assert.equal(fs.readFileSync(path.join(f.qaRepo,'untracked.txt'),'utf8'),
        'not used by bare inspection');
      fs.rmSync(path.join(f.qaRepo,'untracked.txt'));
      cmd(f.qaRepo,'remote','set-url','origin','https://github.com/attacker/repo.git');
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_QA_REPO_ORIGIN_MISMATCH/);
    }finally{f.close();}
  });
test('QA rejects hidden unauthorized intermediate history even if final tree matches signed Central',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      // Append out-of-scope commit, revert it, then a valid in-scope commit.
      fs.mkdirSync(path.join(f.work,'private'));
      fs.writeFileSync(path.join(f.work,'private','hidden.txt'),'history object\n');
      cmd(f.work,'add','private/hidden.txt');
      cmd(f.work,'-c','user.name=SUTRADHAR tests','-c','user.email=noreply@example.invalid',
        'commit','-m','unauthorized');
      cmd(f.work,'rm','private/hidden.txt');
      cmd(f.work,'-c','user.name=SUTRADHAR tests','-c','user.email=noreply@example.invalid',
        'commit','-m','revert unauthorized');
      fs.writeFileSync(path.join(f.work,'src','feature.ts'),'export const n=3;\n');
      cmd(f.work,'add','src/feature.ts');
      cmd(f.work,'-c','user.name=SUTRADHAR tests','-c','user.email=noreply@example.invalid',
        'commit','-m','last allowed');
      const head=cmd(f.work,'rev-parse','HEAD'),tree=cmd(f.work,'rev-parse','HEAD^{tree}');
      const manifest={schema:1,kind:'CENTRAL_CONFIRMED_CANDIDATE_BUNDLE',
        ticket_id:'ticket_abc',project_id:'project_aaa',repository:'example/repo',
        branch_name:'ai/ticket_abc',baseline_sha:f.baseline,
        candidate_head_sha:head,candidate_tree_sha:tree,
        worker_agent_id:'agent_dev',write_scopes:['src/feature.ts'],
        bundle_size_bytes:0,bundle_sha256:'',qa_approved:false,git_published:false};
      cmd(f.work,'bundle','create',f.offer,'HEAD','^'+f.baseline);
      const bytes=fs.readFileSync(f.offer);manifest.bundle_size_bytes=bytes.length;
      manifest.bundle_sha256=hex(bytes);
      fs.writeFileSync(f.offer+'.json',JSON.stringify(manifest));
      f.updateTask({...f.task(),candidate_head_sha:head,candidate_tree_sha:tree});
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_QA_OUT_OF_SCOPE_HISTORY/);
      assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),f.baseline);
    }finally{f.close();}
  });
test('duplicate export output is never overwritten', {skip:!available},async()=>{
  const f=fixture();
  try{
    await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
    const prior=fs.readFileSync(f.offer+'.json','utf8');
    await assert.rejects(exportCandidateHandoff({...f.opts,
      agentId:'agent_dev',dir:f.worker}),/HANDOFF_OUTPUT_EXISTS/);
    assert.equal(fs.readFileSync(f.offer+'.json','utf8'),prior);
  }finally{f.close();}
});
test('packaged handoff UI is main-only, with no renderer signing, Git publish or QA approval',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const js=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.ok(pkg.build.files.includes('qa-handoff.cjs'));
  assert.match(main,/ipcMain\.handle\('sutradhar:exportCandidateHandoff'/);
  assert.match(main,/ipcMain\.handle\('sutradhar:inspectQAHandoff'/);
  assert.match(main,/approvedWorkerOperator\(agentId,ticketId,true\)/);
  assert.match(preload,/exportCandidateHandoff:\(agentId,ticketId\)/);
  assert.match(preload,/inspectQAHandoff:\(agentId,ticketId\)/);
  assert.doesNotMatch(preload,/signWorkerReadOnly|private_key_pem|git_push/);
  assert.match(js,/get\('workerQAInspect'\)\.addEventListener/);
  assert.match(html,/id="workerExport"/);
  assert.match(html,/id="workerQAInspect"/);
});

const {runIndependentQa,candidateArchive,validPolicy}
  =require('../apps/desktop/qa-execution.cjs');
function fakeDocker(f,{pass=true,changeCentral=false,cleanupFails=false}={}){
  const exe=path.join(f.temp,'docker.exe');
  fs.writeFileSync(exe,'mock executable never run');
  const image='a'.repeat(64),seen=[];
  const runner=(binary,args,options)=>{
    assert.equal(binary,exe);
    assert.equal(options.windowsHide,true);
    seen.push({args,input:options.input});
    let text='',status=0;
    if(args[0]==='image'&&args[1]==='inspect')text='sha256:'+image+'\n';
    else if(args[0]==='info')text='27.0.0\n';
    else if(args[0]==='create'){
      assert.ok(args.includes('--network'));
      assert.equal(args[args.indexOf('--network')+1],'none');
      assert.ok(args.includes('--read-only'));
      assert.ok(args.includes('--cap-drop'));
      assert.equal(args[args.indexOf('--cap-drop')+1],'ALL');
      assert.equal(args[args.indexOf('--entrypoint')+1],'/bin/sh');
      assert.equal(args[args.indexOf('--user')+1],'10001:10001');
      assert.ok(!args.includes('--privileged'));
      assert.ok(!args.includes('--volume'));
      assert.ok(!args.includes('--mount'));
      assert.ok(!args.includes('--publish'));
      text='b'.repeat(64)+'\n';
    }else if(args[0]==='start'){
      assert.ok(Buffer.isBuffer(options.input));
      assert.ok(options.input.length>0);
      if(changeCentral)f.updateTask({...f.task(),candidate_head_sha:'f'.repeat(40)});
      text=pass?'__SUTRADHAR_QA_TEST_STARTED__\n1 passed\n':'1 failed\n';
      status=pass?0:1;
    }else if(args[0]==='rm')status=cleanupFails?1:0;
    else throw Error('Unexpected Docker invocation '+args.join(' '));
    return {status,stdout:Buffer.from(text),stderr:Buffer.alloc(0)};
  };
  return {exe,image,seen,runner,
    policy:{schema:1,enabled:true,image_sha256:image,docker_exe:exe,
      test_profile:'PYTEST_TESTS_DIRECTORY'}};
}
test('Owner-pinned Docker and one-time QA test produce LOCAL_UNATTESTED evidence, not QA approval',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f);
      const evidenceDir=path.join(f.temp,'qa-evidence');
      const result=await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      assert.equal(result.test_passed,true);
      assert.equal(result.qa_approved,false);
      assert.equal(result.qa_receipt_submitted,false);
      assert.equal(result.evidence_level,'LOCAL_UNATTESTED');
      assert.equal(result.candidate_head_sha,f.head);
      assert.equal(result.git_published,false);
      assert.equal(fs.existsSync(result.evidence_path),true);
      const commands=d.seen.map(z=>z.args[0]);
      assert.deepEqual(commands,['image','info','create','start','rm']);
      assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),f.baseline);
      assert.equal(cmd(f.qaRepo,'status','--porcelain'),'');
      assert.equal(fs.existsSync(path.join(evidenceDir,'qa_started_ticket_abc.json')),true);
      await assert.rejects(runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner}),
        /QA_EXECUTION_PREVIOUS_ATTEMPT_OWNER_REVIEW/);
    }finally{f.close();}
  });
test('default owner gate and invalid Docker policy prevent any candidate execution',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      await assert.rejects(runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir:path.join(f.temp,'qa-evidence')}),
        /QA_EXECUTION_OWNER_IMAGE_NOT_CONFIGURED/);
      assert.throws(()=>validPolicy({schema:1,enabled:true,
        docker_exe:'docker',image_sha256:'a'.repeat(64),
        test_profile:'PYTEST_TESTS_DIRECTORY'}),/QA_EXECUTION_OWNER_IMAGE_NOT_CONFIGURED/);
      assert.equal(fs.existsSync(path.join(f.temp,'qa-evidence')),false);
    }finally{f.close();}
  });
test('Docker test failure records failed evidence without approving QA or repeating execution',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f,{pass:false});
      const evidenceDir=path.join(f.temp,'evidence');
      const result=await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      assert.equal(result.test_passed,false);
      assert.equal(result.sandbox_started,false);
      assert.equal(result.qa_receipt_submitted,false);
      assert.equal(result.exit_code,1);
      assert.ok(fs.existsSync(result.evidence_path));
      assert.equal(d.seen.filter(x=>x.args[0]==='start').length,1);
    }finally{f.close();}
  });
test('Central changes after sandbox execution preserve pending audit and require Owner review',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f,{changeCentral:true});
      const evidenceDir=path.join(f.temp,'evidence');
      await assert.rejects(runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner}),
        /QA_EXECUTION_CENTRAL_CHANGED_OWNER_REVIEW/);
      assert.equal(fs.existsSync(path.join(evidenceDir,'qa_started_ticket_abc.json')),true);
      assert.equal(fs.existsSync(path.join(evidenceDir,'qa_result_ticket_abc.json')),false);
      assert.ok(d.seen.some(x=>x.args[0]==='rm'));
    }finally{f.close();}
  });
test('Docker cleanup uncertainty is fail closed and never produces QA success',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f,{cleanupFails:true});
      const evidenceDir=path.join(f.temp,'evidence');
      await assert.rejects(runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner}),
        /QA_EXECUTION_DOCKER_CLEANUP_UNCERTAIN/);
      assert.equal(fs.existsSync(path.join(evidenceDir,'qa_started_ticket_abc.json')),true);
      assert.equal(fs.existsSync(path.join(evidenceDir,'qa_result_ticket_abc.json')),false);
    }finally{f.close();}
  });
test('QA archive refuses untracked secrets, unsafe symlinks and Git metadata',
  {skip:!available},()=>{
    const f=fixture();
    try{
      const safe=candidateArchive(f.work,f.head);
      assert.ok(Buffer.isBuffer(safe));
      // A scoped source tree containing an unsafe hidden file may be valid Git,
      // but it is not acceptable for local Docker QA archive execution.
      fs.writeFileSync(path.join(f.work,'.env'),'TOP_SECRET');
      cmd(f.work,'add','.env');
      cmd(f.work,'-c','user.name=SUTRADHAR tests',
        '-c','user.email=noreply@example.invalid','commit','-m','secret');
      const unsafe=cmd(f.work,'rev-parse','HEAD');
      assert.throws(()=>candidateArchive(f.work,unsafe),
        /QA_EXECUTION_TREE_UNSAFE_PATH_OR_MODE/);
    }finally{f.close();}
  });
test('QA Windows GUI wiring never exposes arbitrary docker command or QA approval to renderer',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.ok(pkg.build.files.includes('qa-execution.cjs'));
  assert.ok(pkg.build.files.includes('qa-runner-policy.json'));
  assert.match(main,/ipcMain\.handle\('sutradhar:runIndependentQa'/);
  assert.match(preload,/runIndependentQa:\(agentId,ticketId\)/);
  assert.match(html,/id="workerQARun"/);
  assert.match(js,/get\('workerQARun'\)\.addEventListener/);
  assert.doesNotMatch(preload,/dockerRunner|test_profile|signWorkerQaReceipt|private_key_pem/);
});

const {createVault}=require('../apps/desktop/os-vault.cjs');
const {createSignerBridge}=require('../apps/desktop/vault-bridge.cjs');
const {attestIndependentQa,verifyQaEvidence}=require('../apps/desktop/qa-evidence.cjs');
function qaSigningFixture(f){
  const dir=path.join(f.temp,'qa-vault');fs.mkdirSync(dir);
  // Fake OS encryption for tests only; production requires Electron safeStorage.
  const key=crypto.randomBytes(32);
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:s=>{
      const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
      return Buffer.concat([iv,c.update(s,'utf8'),c.final(),c.getAuthTag()]);
    },
    decryptString:b=>{
      const iv=b.subarray(0,12),tag=b.subarray(b.length-16),
        body=b.subarray(12,-16),d=crypto.createDecipheriv('aes-256-gcm',key,iv);
      d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]).toString('utf8');
    }};
  const signer=createSignerBridge(createVault({safeStorage,dir,platform:'win32'}));
  const pub=signer.initialize({agent_ids:['agent_qa']});
  return {signer,pub};
}
test('actual OS-vault Ed25519 QA statement binds exact Docker report without Central QA POST',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-records');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer,pub}=qaSigningFixture(f);
      const out=await attestIndependentQa({...f.opts,agentId:'agent_qa',
        signer,evidenceDir});
      assert.equal(out.signed,true);
      assert.equal(out.qa_approved,false);
      assert.equal(out.central_qa_receipt_submitted,false);
      assert.equal(out.evidence_level,'DEVICE_SIGNED_LOCAL_ONLY');
      const evidenceRaw=fs.readFileSync(path.join(evidenceDir,'qa_result_ticket_abc.json'));
      const attestation=JSON.parse(fs.readFileSync(out.local_attestation_path,'utf8'));
      const verified=verifyQaEvidence({attestation,evidenceRaw,
        expectedPublicKeyPem:pub.public_key_pem,
        expectedNodeId:pub.node_id,expectedAgentId:'agent_qa',
        expectedTicketId:'ticket_abc',expectedHead:f.head,expectedTree:f.tree});
      assert.equal(verified.signature_verified,true);
      assert.equal(verified.test_passed,true);
      assert.equal(verified.qa_approved,false);
      assert.equal(verified.central_qa_receipt_submitted,false);
      assert.equal(f.reads(),5);
      await assert.rejects(attestIndependentQa({...f.opts,
        agentId:'agent_qa',signer,evidenceDir}),
        /QA_EVIDENCE_ALREADY_SIGNED_OWNER_REVIEW/);
      assert.throws(()=>signer.sign({kind:'node_api',method:'POST',
        uri:'/v7/tasks/qa-receipt',body:'{}'}),/DENIED/);
      assert.throws(()=>signer.signQaEvidence({
        agent_id:'agent_qa',ticket_id:'ticket_abc',
        candidate_head_sha:f.head,candidate_tree_sha:f.tree,
        evidence_sha256:'0'.repeat(64),passed:true,extra:'oracle'}),
        /VAULT_QA_EVIDENCE_SIGN_DENIED/);
    }finally{f.close();}
  });
test('independent verifier rejects tampered report, wrong approved key and expected SHA',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-evidence');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer,pub}=qaSigningFixture(f);
      const out=await attestIndependentQa({...f.opts,agentId:'agent_qa',
        signer,evidenceDir});
      const attestation=JSON.parse(fs.readFileSync(out.local_attestation_path,'utf8'));
      const raw=fs.readFileSync(path.join(evidenceDir,'qa_result_ticket_abc.json'));
      const opts={attestation,evidenceRaw:raw,
        expectedPublicKeyPem:pub.public_key_pem,
        expectedNodeId:pub.node_id,expectedAgentId:'agent_qa',
        expectedTicketId:'ticket_abc',expectedHead:f.head,expectedTree:f.tree};
      const other=crypto.generateKeyPairSync('ed25519');
      assert.throws(()=>verifyQaEvidence({...opts,
        expectedPublicKeyPem:other.publicKey.export({format:'pem',type:'spki'}).toString()}),
        /QA_EVIDENCE_ATTESTATION_MISMATCH/);
      assert.throws(()=>verifyQaEvidence({...opts,expectedHead:'f'.repeat(40)}),
        /QA_EVIDENCE_ATTESTATION_MISMATCH/);
      assert.throws(()=>verifyQaEvidence({...opts,
        evidenceRaw:Buffer.from(raw.toString('utf8')+' ')}),
        /QA_EVIDENCE_ATTESTATION_MISMATCH/);
      const forged=structuredClone(attestation);
      forged.message.passed=false;
      assert.throws(()=>verifyQaEvidence({...opts,attestation:forged}),
        /QA_EVIDENCE_ATTESTATION_MISMATCH/);
      const tampered=structuredClone(attestation);
      tampered.signature=Buffer.alloc(64,0).toString('base64');
      assert.throws(()=>verifyQaEvidence({...opts,attestation:tampered}),
        /QA_EVIDENCE_SIGNATURE_INVALID/);
    }finally{f.close();}
  });
test('QA signing refuses edited attempt journal, false pass and changed Central candidate',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f,{pass:false}),evidenceDir=path.join(f.temp,'qa-evidence');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer}=qaSigningFixture(f);
      const rfile=path.join(evidenceDir,'qa_result_ticket_abc.json');
      const intent=path.join(evidenceDir,'qa_started_ticket_abc.json');
      const original=fs.readFileSync(rfile,'utf8');
      const fake={...JSON.parse(original),test_passed:true};
      fs.writeFileSync(rfile,JSON.stringify(fake));
      await assert.rejects(attestIndependentQa({...f.opts,
        agentId:'agent_qa',signer,evidenceDir}),/QA_EVIDENCE_REPORT_INVALID/);
      fs.writeFileSync(rfile,original);
      const originalIntent=fs.readFileSync(intent,'utf8');
      fs.writeFileSync(intent,JSON.stringify({...JSON.parse(originalIntent),
        image_sha256:'f'.repeat(64)}));
      await assert.rejects(attestIndependentQa({...f.opts,
        agentId:'agent_qa',signer,evidenceDir}),/QA_EVIDENCE_INTENT_MISMATCH/);
      fs.writeFileSync(intent,originalIntent);
      f.updateTask({...f.task(),candidate_tree_sha:'f'.repeat(40)});
      await assert.rejects(attestIndependentQa({...f.opts,
        agentId:'agent_qa',signer,evidenceDir}),/QA_EVIDENCE_CENTRAL_CHANGED_OWNER_REVIEW/);
      f.updateTask(f.task());
      const result=await attestIndependentQa({...f.opts,
        agentId:'agent_qa',signer,evidenceDir});
      assert.equal(result.test_passed,false);
      assert.equal(result.qa_approved,false);
    }finally{f.close();}
  });
test('trusted Owner CLI verifies approved device key offline but never authorizes QA',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-evidence');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer,pub}=qaSigningFixture(f);
      const out=await attestIndependentQa({...f.opts,agentId:'agent_qa',signer,evidenceDir});
      const trustedKey=path.join(f.temp,'trusted-node-key.pem');
      fs.writeFileSync(trustedKey,pub.public_key_pem);
      const cli=path.resolve(__dirname,'../scripts/qa/verify-device-evidence.cjs');
      const args=[cli,path.join(evidenceDir,'qa_result_ticket_abc.json'),
        out.local_attestation_path,trustedKey,pub.node_id,'agent_qa',
        'ticket_abc',f.head,f.tree];
      const verified=cp.spawnSync(process.execPath,args,{encoding:'utf8'});
      assert.equal(verified.status,0,verified.stderr);
      const report=JSON.parse(verified.stdout);
      assert.equal(report.signature_verified,true);
      assert.equal(report.owner_central_approval_required,true);
      assert.equal(report.qa_approved,false);
      assert.equal(report.production_approved,false);
      const denied=cp.spawnSync(process.execPath,[...args.slice(0,-2),
        'f'.repeat(40),f.tree],{encoding:'utf8'});
      assert.equal(denied.status,1);
      assert.match(denied.stderr,/QA verification blocked:/);
    }finally{f.close();}
  });
test('Desktop QA attestation only in Electron MAIN, no generic signer in renderer',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const setup=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  assert.ok(cfg.build.files.includes('qa-evidence.cjs'));
  assert.match(main,/ipcMain\.handle\('sutradhar:attestQaEvidence'/);
  assert.match(preload,/attestQaEvidence:\(agentId,ticketId\)/);
  assert.match(setup,/id="workerQAAttest"/);
  assert.doesNotMatch(preload,/signQaEvidence|signWorkerAction|private_key_pem/);
});

const {submitQaEvidenceForOwner,submitOwnerReviewedQaReceipt}
  =require('../apps/desktop/qa-evidence-submit.cjs');
test('device-signed QA upload makes pending Owner review before receipt and preserves replay IDs',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-evidence');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer}=qaSigningFixture(f);
      await attestIndependentQa({...f.opts,agentId:'agent_qa',signer,evidenceDir});
      const requests=[],receipts=new Map(),processed=new Map();
      let approved=false,recorded=false,proposalId=null,evidenceHash=null;
      const qaReceiptId='12345678-1234-4234-8234-123456789abc';
      const fetcher=async(url,opts)=>{
        const uri=new URL(url).pathname;
        if(uri.startsWith('/v7/tasks/detail/'))return f.fetcher(url,opts);
        if(uri.startsWith('/v7/tasks/qa-review/')){
          assert.equal(opts.method,'GET');
          assert.equal(uri,'/v7/tasks/qa-review/'+proposalId);
          assert.equal(opts.headers['x-sutradhar-agent'],'agent_qa');
          const data={review_proposal_id:proposalId,ticket_id:'ticket_abc',
            qa_agent_id:'agent_qa',owner_review_state:approved?'APPROVED':'PENDING',
            task_status:recorded?'INTEGRATING':'SUBMITTED_FOR_REVIEW',
            candidate_head_sha:f.head,candidate_tree_sha:f.tree,
            evidence_sha256:evidenceHash,qa_receipt_recorded:recorded,
            qa_receipt_id:recorded?qaReceiptId:null,
            owner_review_required:true,automatic_qa_approval_allowed:false,
            automatic_qa_receipt_allowed:false,git_published:false,
            manual_next_action:recorded?'RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY':
              approved?'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE':'WAIT_FOR_OWNER_REVIEW'};
          return new Response(JSON.stringify(data),{status:200});
        }
        assert.equal(opts.method,'POST');
        assert.equal(opts.headers['x-sutradhar-agent'],'agent_qa');
        const body=JSON.parse(opts.body);
        requests.push({uri,body,headers:opts.headers});
        if(uri==='/v7/tasks/qa-evidence'){
          assert.match(body.evidence_ref,/^sha256:[a-f0-9]{64}$/);
          assert.equal(body.evidence_base64,
            fs.readFileSync(path.join(evidenceDir,'qa_result_ticket_abc.json')).toString('base64'));
          const hash=crypto.createHash('sha256').update(Buffer.from(body.attestation.signature,'base64')).digest('hex');
          const proposal='qaev_'+crypto.createHash('sha256').update([
            'ticket_abc','agent_qa',signer.snapshot().node_id,f.head,f.tree,
            body.attestation.message.evidence_sha256,hash,'PASS'
          ].join('\n')).digest('hex');
          proposalId=proposal;
          evidenceHash=body.attestation.message.evidence_sha256;
          const result={accepted:true,review_proposal_id:proposal,
            status:'PENDING_OWNER_REVIEW',
            evidence_sha256:body.attestation.message.evidence_sha256,
            device_signature_verified:true,qa_approved:false,
            qa_receipt_submitted:false,integration_performed:false,
            git_published:false};
          if(processed.has(body.request_id))assert.deepEqual(processed.get(body.request_id),body);
          processed.set(body.request_id,body);
          return new Response(JSON.stringify(result),{status:200});
        }
        if(uri==='/v7/tasks/qa-receipt'){
          assert.equal(approved,true,'Owner must approve before POST');
          assert.equal(recorded,false,'Receipt must not be submitted twice');
          recorded=true;
          f.updateTask({...f.task(),status:'INTEGRATING',version:4});
          const result={accepted:true,ticket_id:'ticket_abc',
            receipt_id:qaReceiptId,status:'INTEGRATING',
            evidence_level:'AGENT_ATTESTED'};
          if(processed.has(body.request_id))assert.deepEqual(processed.get(body.request_id),body);
          processed.set(body.request_id,body);
          return new Response(JSON.stringify(result),{status:200});
        }
        throw Error('Unexpected Central QA request '+uri);
      };
      const opts={...f.opts,agentId:'agent_qa',evidenceDir,signer,fetcher};
      const upload=await submitQaEvidenceForOwner(opts);
      assert.equal(upload.device_signature_verified,true);
      assert.equal(upload.qa_approved,false);
      assert.equal(upload.integration_performed,false);
      const upload2=await submitQaEvidenceForOwner(opts);
      assert.equal(upload2.already_submitted,true);
      assert.equal(requests.filter(z=>z.uri==='/v7/tasks/qa-evidence').length,1);
      await assert.rejects(submitOwnerReviewedQaReceipt(opts),
        /QA_RECEIPT_OWNER_REVIEW_PENDING/);
      assert.equal(fs.existsSync(path.join(evidenceDir,
        'qa_central_receipt_ticket_abc_pending.json')),false);
      approved=true;
      const accepted=await submitOwnerReviewedQaReceipt(opts);
      assert.equal(accepted.status,'INTEGRATING');
      assert.equal(accepted.git_published,false);
      assert.equal(accepted.qa_receipt_submitted,true);
      assert.equal(accepted.read_only_central_reconciled,true);
      const again=await submitOwnerReviewedQaReceipt(opts);
      assert.equal(again.already_submitted,true);
      assert.equal(again.reconciled_from_central,true);
      assert.equal(again.receipt_id,qaReceiptId);
      assert.equal(requests.filter(z=>z.uri==='/v7/tasks/qa-receipt').length,1);
      assert.ok(fs.existsSync(path.join(evidenceDir,
        'qa_central_receipt_ticket_abc_receipt.json')));
      assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),f.baseline);
    }finally{f.close();}
  });
test('lost QA receipt HTTP reply reconciles from signed Central GET without duplicate POST',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-lost-ack');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer}=qaSigningFixture(f);
      await attestIndependentQa({...f.opts,agentId:'agent_qa',signer,evidenceDir});
      let proposalId=null,evidenceHash=null,recorded=false,qaPosts=0;
      const receiptId='11111111-2222-4333-8444-555555555555';
      const fetcher=async(url,opts)=>{
        const uri=new URL(url).pathname;
        if(uri.startsWith('/v7/tasks/detail/'))return f.fetcher(url,opts);
        if(uri.startsWith('/v7/tasks/qa-review/')){
          const state={review_proposal_id:proposalId,ticket_id:'ticket_abc',
            qa_agent_id:'agent_qa',owner_review_state:'APPROVED',
            task_status:recorded?'INTEGRATING':'SUBMITTED_FOR_REVIEW',
            candidate_head_sha:f.head,candidate_tree_sha:f.tree,
            evidence_sha256:evidenceHash,qa_receipt_recorded:recorded,
            qa_receipt_id:recorded?receiptId:null,
            owner_review_required:true,automatic_qa_approval_allowed:false,
            automatic_qa_receipt_allowed:false,git_published:false,
            manual_next_action:recorded?'RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY':
              'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE'};
          return new Response(JSON.stringify(state),{status:200});
        }
        const body=JSON.parse(opts.body);
        if(uri==='/v7/tasks/qa-evidence'){
          evidenceHash=body.attestation.message.evidence_sha256;
          proposalId='qaev_'+crypto.createHash('sha256').update([
            'ticket_abc','agent_qa',signer.snapshot().node_id,f.head,f.tree,
            evidenceHash,hex(Buffer.from(body.attestation.signature,'base64')),'PASS'
          ].join('\n')).digest('hex');
          return new Response(JSON.stringify({accepted:true,
            review_proposal_id:proposalId,status:'PENDING_OWNER_REVIEW',
            evidence_sha256:evidenceHash,device_signature_verified:true,
            qa_approved:false,qa_receipt_submitted:false,
            integration_performed:false,git_published:false}),{status:200});
        }
        if(uri==='/v7/tasks/qa-receipt'){
          qaPosts++;
          assert.equal(qaPosts,1,'ambiguous ack MUST NOT lead to second QA POST');
          assert.equal(recorded,false);
          recorded=true;
          f.updateTask({...f.task(),status:'INTEGRATING',version:4});
          throw Error('simulated reply lost AFTER Central commit');
        }
        throw Error('Unexpected URL '+uri);
      };
      const opts={...f.opts,agentId:'agent_qa',evidenceDir,signer,fetcher};
      await submitQaEvidenceForOwner(opts);
      await assert.rejects(submitOwnerReviewedQaReceipt(opts),
        /simulated reply lost AFTER Central commit/);
      const pending=path.join(evidenceDir,'qa_central_receipt_ticket_abc_pending.json');
      assert.ok(fs.existsSync(pending));
      const exact=JSON.parse(fs.readFileSync(pending,'utf8'));
      assert.match(exact.body.request_id,/^qareceipt_/);
      const reconciled=await submitOwnerReviewedQaReceipt(opts);
      assert.equal(reconciled.reconciled_from_central,true);
      assert.equal(reconciled.receipt_id,receiptId);
      assert.equal(reconciled.git_published,false);
      assert.equal(qaPosts,1,'GET-only reconciliation after crash');
      assert.equal(fs.existsSync(pending),false);
      assert.equal(fs.existsSync(path.join(evidenceDir,
        'qa_central_receipt_ticket_abc_receipt.json')),true);
      // Even if both local journal artifacts disappear, a remote receipt is
      // not authority to fabricate a new local action or duplicate it.
      fs.unlinkSync(path.join(evidenceDir,'qa_central_receipt_ticket_abc_receipt.json'));
      await assert.rejects(submitOwnerReviewedQaReceipt(opts),
        /QA_RECEIPT_CENTRAL_RECORDED_WITHOUT_LOCAL_INTENT/);
      assert.equal(qaPosts,1);
    }finally{f.close();}
  });
test('Central QA post blocks forged device signature, altered report, and unsigned original',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-evidence');
      await runIndependentQa({...f.opts,agentId:'agent_qa',
        repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner});
      const {signer}=qaSigningFixture(f);
      const sent=[];
      const fetcher=async(url,opts)=>{
        if(opts.method==='GET')return f.fetcher(url,opts);
        sent.push(opts);throw Error('This test must never POST invalid QA evidence');
      };
      const opts={...f.opts,agentId:'agent_qa',signer,evidenceDir,fetcher};
      await assert.rejects(submitQaEvidenceForOwner(opts),
        /QA_UPLOAD_LOCAL_EVIDENCE_UNTRUSTED/);
      await attestIndependentQa({...f.opts,agentId:'agent_qa',signer,evidenceDir});
      const attFile=path.join(evidenceDir,'qa_attested_ticket_abc.json');
      const a=fs.readFileSync(attFile,'utf8');
      fs.writeFileSync(attFile,a.replace('DEVICE_OS_VAULT_ED25519','DEVICE_FORGED'));
      await assert.rejects(submitQaEvidenceForOwner(opts),
        /QA_EVIDENCE_ATTESTATION_INVALID/);
      fs.writeFileSync(attFile,a);
      const reportFile=path.join(evidenceDir,'qa_result_ticket_abc.json');
      fs.appendFileSync(reportFile,' ');
      await assert.rejects(submitQaEvidenceForOwner(opts),
        /QA_EVIDENCE_ATTESTATION_MISMATCH/);
      assert.equal(sent.length,0);
    }finally{f.close();}
  });
test('QA Central uploads are fixed scoped OS-vault actions, never generic renderer POST',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.ok(pkg.build.files.includes('qa-evidence-submit.cjs'));
  assert.match(main,/ipcMain\.handle\('sutradhar:submitQaEvidenceForOwner'/);
  assert.match(main,/ipcMain\.handle\('sutradhar:submitOwnerReviewedQaReceipt'/);
  assert.match(preload,/submitQaEvidenceForOwner:\(agentId,ticketId\)/);
  assert.match(preload,/submitOwnerReviewedQaReceipt:\(agentId,ticketId\)/);
  assert.match(html,/id="workerQAUpload"/);
  assert.match(html,/id="workerQAReceipt"/);
  assert.match(js,/get\('workerQAUpload'\)\.addEventListener/);
  assert.match(js,/get\('workerQAReceipt'\)\.addEventListener/);
  assert.doesNotMatch(preload,/signWorkerAction|evidence_base64|request_id|private_key_pem/);
});

const {publishReviewedCandidate,validatePolicy,publicationPushArgs,
  parseRefs,verifySingleCommit}=require('../apps/desktop/git-publish.cjs');
const {verifiedLocal}=require('../apps/desktop/qa-evidence-submit.cjs');
async function publicationFixture(f){
  await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
  const docker=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-publish');
  await runIndependentQa({...f.opts,agentId:'agent_qa',repoDir:f.qaRepo,
    evidenceDir,policy:docker.policy,dockerRunner:docker.runner});
  const {signer}=qaSigningFixture(f);
  await attestIndependentQa({...f.opts,agentId:'agent_qa',signer,evidenceDir});
  f.updateTask({...f.task(),status:'INTEGRATING',version:4});
  const origin='https://central.example.com',agentId='agent_qa',ticketId='ticket_abc';
  const inspected=await verifiedLocal({origin,agentId,ticketId,signer,
    dir:evidenceDir,fetcher:f.fetcher,allowReceiptReplay:true});
  const local={schema:1,context:inspected.context,
    body:{request_id:'qareceipt_local123'}};
  const journal={...local,sha256:hex(JSON.stringify(local))};
  fs.writeFileSync(path.join(evidenceDir,'qa_central_receipt_ticket_abc_receipt.json'),
    JSON.stringify(journal)+'\n');
  const gitExe=path.join(f.temp,'git.exe');
  fs.writeFileSync(gitExe,'trusted stub: mock only');
  const policy={schema:1,enabled:true,git_exe:gitExe,
    allowed_repository:'example/repo',
    credential_mode:'GCM_PRECONFIGURED_NONINTERACTIVE'};
  const preflight={preflight_ready:true,one_shot:true,
    automatic_push_allowed:false,git_published:false,merge_performed:false,
    agent_id:agentId,ticket_id:ticketId,project_id:'project_aaa',
    repository:'example/repo',base_branch:'main',branch:'ai/ticket_abc',
    baseline_sha:f.baseline,candidate_head_sha:f.head,candidate_tree_sha:f.tree,
    write_scopes:['src/feature.ts'],version:4,epoch:7,
    qa_evidence_sha256:inspected.evidenceSha,
    qa_receipt_id:'12345678-1234-4234-8234-123456789abc'};
  const seen=[],bodySeen=[];
  let failAt=null,remoteChanged=false;
  const runner=(binary,args,opts)=>{
    assert.equal(binary,gitExe);
    assert.equal(opts.windowsHide,true);
    assert.equal(opts.env.GCM_INTERACTIVE,'never');
    assert.equal(opts.env.GIT_TERMINAL_PROMPT,'0');
    assert.equal(opts.env.GIT_CONFIG_GLOBAL,'/dev/null');
    assert.ok(!JSON.stringify(opts.env).includes('private_key_pem'));
    seen.push({type:'git',args});
    if(args.includes('ls-remote')){
      return {status:0,stdout:
        (remoteChanged?'f'.repeat(40):f.baseline)+'\trefs/heads/main\n',
        stderr:''};
    }
    if(args.includes('push')){
      if(failAt==='push')return {status:128,stdout:'',stderr:'network unknown'};
      assert.ok(args.some(x=>x==='--force-with-lease=refs/heads/ai/ticket_abc:'));
      assert.ok(args.includes('https://github.com/example/repo.git'));
      assert.ok(!args.some(x=>x.includes('--force=')||x==='--force'));
      return {status:0,stdout:'To github.com\n*\t'+f.head+
        ':refs/heads/ai/ticket_abc\t[new branch]\nDone\n',stderr:''};
    }
    // Real Git object reads from temporary bare quarantine.
    return cp.spawnSync('git',args,{...opts,
      env:{...opts.env,PATH:process.env.PATH}});
  };
  const fetcher=async(url,opts)=>{
    const uri=new URL(url).pathname;
    if(uri==='/v7/tasks/detail/ticket_abc')return f.fetcher(url,opts);
    if(uri==='/v7/git/preflight/ticket_abc'){
      seen.push({type:'preflight'});
      return new Response(JSON.stringify(preflight),{status:200});
    }
    if(opts.method!=='POST')throw Error('Unexpected URL '+uri);
    const body=JSON.parse(opts.body);bodySeen.push({uri,body});
    if(uri==='/v7/git/reserve'){
      assert.equal(fs.existsSync(path.join(evidenceDir,
        'git_publish_ticket_abc_intent.json')),true);
      assert.equal(body.expected_candidate_head_sha,f.head);
      assert.equal(body.expected_candidate_tree_sha,f.tree);
      assert.equal(body.expected_ticket_version,4);
      seen.push({type:'reserve'});
      return new Response(JSON.stringify({accepted:true,one_shot:true,
        ticket_id:ticketId,repository:'example/repo',base_branch:'main',
        branch:'ai/ticket_abc',baseline_sha:f.baseline,
        candidate_head_sha:f.head,candidate_tree_sha:f.tree,epoch:7}),
        {status:200});
    }
    if(uri==='/v7/git/confirm'){
      seen.push({type:'confirm'});
      assert.equal(body.expected_remote_head_sha,f.head);
      return new Response(JSON.stringify({accepted:true,ticket_id:ticketId,
        remote_head_sha:f.head,tree_sha:f.tree,
        status:'PUSH_CONFIRMED_NOT_MERGED'}),{status:200});
    }
    throw Error('Unexpected signed request '+uri);
  };
  return {evidenceDir,signer,policy,seen,bodySeen,runner,fetcher,
    opts:{origin,agentId,ticketId,signer,evidenceDir,policy,
      bundlePath:f.offer,repoDir:f.qaRepo,gitRunner:runner,fetcher},
    failPush:()=>{failAt='push';},changeRemote:()=>{remoteChanged=true;}};
}
test('local Git absent-branch lease creates exact ai/* ref once, never changes main',
  {skip:!available},()=>{
    const f=fixture();
    try{
      const remote=path.join(f.temp,'test-remote.git');
      cp.execFileSync('git',['init','--bare',remote]);
      cmd(f.repo,'push',remote,'main:refs/heads/main');
      const args=publicationPushArgs({head:f.head,
        destination:'refs/heads/ai/ticket_abc',
        url:'https://github.com/example/repo.git'});
      assert.ok(args.includes('--force-with-lease=refs/heads/ai/ticket_abc:'));
      const local=args.map(x=>x==='https://github.com/example/repo.git'?remote:x);
      const first=cp.spawnSync('git',['-C',f.work,...local],{encoding:'utf8'});
      assert.equal(first.status,0,first.stderr);
      assert.equal(cmd(remote,'rev-parse','refs/heads/ai/ticket_abc'),f.head);
      assert.equal(cmd(remote,'rev-parse','refs/heads/main'),f.baseline);
      const second=cp.spawnSync('git',['-C',f.work,...local],{encoding:'utf8'});
      assert.equal(second.status,0,'Git permits a same-SHA no-op, so exit code alone is unsafe');
      assert.match(second.stdout,/\[up to date\]/);
      assert.doesNotMatch(second.stdout,/\[new branch\]/);
      assert.equal(cmd(remote,'rev-parse','refs/heads/ai/ticket_abc'),f.head);
      assert.equal(cmd(remote,'rev-parse','refs/heads/main'),f.baseline);
      assert.throws(()=>publicationPushArgs({head:f.head,
        destination:'refs/heads/main',url:'https://github.com/example/repo.git'}),
        /GIT_PUBLISH_PUSH_ARGUMENTS_DENIED/);
    }finally{f.close();}
  });
test('owner-gated QA publication follows immutable Central preflight, one-shot reserve and independent confirm',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      const p=await publicationFixture(f);
      const result=await publishReviewedCandidate(p.opts);
      assert.equal(result.status,'PUSH_CONFIRMED_NOT_MERGED');
      assert.equal(result.remote_head_sha,f.head);
      assert.equal(result.merge_performed,false);
      assert.equal(result.production_deployed,false);
      const gitEvents=p.seen.filter(x=>x.type==='git');
      assert.equal(gitEvents.filter(x=>x.args.includes('push')).length,1);
      assert.equal(gitEvents.filter(x=>x.args.includes('ls-remote')).length,2);
      const order=p.seen.map(x=>x.type);
      assert.ok(order.indexOf('reserve')>order.indexOf('preflight'));
      assert.ok(order.indexOf('confirm')>order.indexOf('reserve'));
      assert.equal(p.bodySeen.filter(x=>x.uri==='/v7/git/reserve').length,1);
      assert.equal(p.bodySeen.filter(x=>x.uri==='/v7/git/confirm').length,1);
      assert.ok(fs.existsSync(result.local_receipt_path));
      assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),f.baseline);
      assert.equal(cmd(f.qaRepo,'status','--porcelain'),'');
      await assert.rejects(publishReviewedCandidate(p.opts),
        /GIT_PUBLISH_PREVIOUS_ATTEMPT_OWNER_RECONCILIATION/);
      assert.equal(p.seen.filter(x=>x.type==='reserve').length,1);
    }finally{f.close();}
  });
test('failed Git remote transport is ambiguous and never retried or re-reserved',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      const p=await publicationFixture(f);
      p.failPush();
      await assert.rejects(publishReviewedCandidate(p.opts),
        /GIT_PUBLISH_REMOTE_COMMAND_FAILED_OR_UNCERTAIN/);
      assert.equal(fs.existsSync(path.join(p.evidenceDir,
        'git_publish_ticket_abc_intent.json')),true);
      assert.equal(fs.existsSync(path.join(p.evidenceDir,
        'git_publish_ticket_abc_receipt.json')),false);
      await assert.rejects(publishReviewedCandidate(p.opts),
        /GIT_PUBLISH_PREVIOUS_ATTEMPT_OWNER_RECONCILIATION/);
      assert.equal(p.seen.filter(x=>x.type==='reserve').length,1);
      assert.equal(p.seen.filter(x=>x.type==='confirm').length,0);
    }finally{f.close();}
  });
test('remote base drift is blocked BEFORE Central reserve or local publication intent',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      const p=await publicationFixture(f);
      p.changeRemote();
      await assert.rejects(publishReviewedCandidate(p.opts),
        /GIT_PUBLISH_REMOTE_BASELINE_CHANGED_OR_DESTINATION_EXISTS/);
      assert.equal(p.seen.filter(x=>x.type==='reserve').length,0);
      assert.equal(fs.existsSync(path.join(p.evidenceDir,
        'git_publish_ticket_abc_intent.json')),false);
    }finally{f.close();}
  });
test('default Git publisher policy is disabled and cannot request Central reservation',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      assert.throws(()=>validatePolicy(require('../apps/desktop/git-publish-policy.json')),
        /GIT_PUBLISH_OWNER_POLICY_DISABLED/);
      await assert.rejects(publishReviewedCandidate({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo,evidenceDir:f.temp,
        signer:{...f.signer,signWorkerAction:()=>null}}),
        /GIT_PUBLISH_OWNER_POLICY_DISABLED/);
    }finally{f.close();}
  });
test('remote ref parser rejects existing destination and all baseline drift',()=>{
  const refs={source:'refs/heads/main',destination:'refs/heads/ai/ticket_abc'};
  const baseline='a'.repeat(40);
  assert.equal(parseRefs(baseline+'\trefs/heads/main\n',refs,baseline),true);
  assert.throws(()=>parseRefs(baseline+'\trefs/heads/main\n'+
    'f'.repeat(40)+'\trefs/heads/ai/ticket_abc\n',refs,baseline),
  /GIT_PUBLISH_REMOTE_BRANCH_CHANGED_OR_UNCERTAIN/);
  assert.throws(()=>parseRefs('f'.repeat(40)+'\trefs/heads/main\n',refs,baseline),
  /GIT_PUBLISH_REMOTE_BASELINE_CHANGED_OR_DESTINATION_EXISTS/);
  assert.throws(()=>parseRefs('',refs,baseline),
  /GIT_PUBLISH_REMOTE_BRANCH_CHANGED_OR_UNCERTAIN/);
});
test('multi-commit candidate is rejected even if QA handoff allows bounded linear ancestry',
  {skip:!available},()=>{
    const f=fixture();
    try{
      const gitExe=path.join(f.temp,'git.exe');
      fs.writeFileSync(gitExe,'stub');
      const run=(binary,args,opts)=>cp.spawnSync('git',args,{...opts,
        env:{...opts.env,PATH:process.env.PATH}});
      verifySingleCommit(f.work,{
        candidate_head_sha:f.head,candidate_tree_sha:f.tree,
        baseline_sha:f.baseline},gitExe,run);
      fs.writeFileSync(path.join(f.work,'src','feature.ts'),'export const n=3;\n');
      cmd(f.work,'add','.');
      cmd(f.work,'-c','user.name=SUTRADHAR tests',
        '-c','user.email=noreply@example.invalid','commit','-m','second commit');
      const head2=cmd(f.work,'rev-parse','HEAD');
      const tree2=cmd(f.work,'rev-parse','HEAD^{tree}');
      assert.throws(()=>verifySingleCommit(f.work,{
        candidate_head_sha:head2,candidate_tree_sha:tree2,
        baseline_sha:f.baseline},gitExe,run),
      /GIT_PUBLISH_REQUIRES_SINGLE_COMMIT_OVER_BASELINE/);
    }finally{f.close();}
  });
test('Git publication Desktop MAIN only, without credentials or raw command access in renderer',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const setup=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.ok(pkg.build.files.includes('git-publish.cjs'));
  assert.ok(pkg.build.files.includes('git-publish-policy.json'));
  assert.match(main,/ipcMain\.handle\('sutradhar:publishReviewedGitBranch'/);
  assert.match(preload,/publishReviewedGitBranch:\(agentId,ticketId\)/);
  assert.match(html,/id="workerGitPublish"/);
  assert.match(setup,/get\('workerGitPublish'\)\.addEventListener/);
  assert.doesNotMatch(preload,/git_exe|credential_mode|private_key_pem|request_id|force-with-lease/);
});

test('frozen Master-failover QA requires explicit sandbox recovery and separate Owner restore before receipt',
  {skip:!available},async()=>{
  const f=fixture();
  try{
    // Developer exported the ORIGINAL exact bundle before Master failover.
    await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
    f.updateTask({...f.task(),status:'RECONCILIATION_REQUIRED',version:4});
    const d=fakeDocker(f),evidenceDir=path.join(f.temp,'qa-recovery');
    await assert.rejects(inspectQAHandoff({...f.opts,agentId:'agent_qa',
      repoDir:f.qaRepo}),/HANDOFF_CENTRAL_TASK_NOT_AUTHORIZED/);
    assert.equal((await inspectQAHandoff({...f.opts,agentId:'agent_qa',
      repoDir:f.qaRepo,recoveryReviewOnly:true})).verified,true);
    await assert.rejects(runIndependentQa({...f.opts,agentId:'agent_qa',
      repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner}),
      /HANDOFF_CENTRAL_TASK_NOT_AUTHORIZED/);
    assert.equal(d.seen.some(z=>z.args[0]==='create'),false,
      'Normal QA button cannot execute a frozen candidate');
    await assert.rejects(inspectQAHandoff({...f.opts,agentId:'agent_qa',
      repoDir:f.qaRepo,recoveryReviewOnly:true,mode:'PUBLISH'}),
      /HANDOFF_QA_MODE_INVALID/);
    const tested=await runIndependentQa({...f.opts,agentId:'agent_qa',
      repoDir:f.qaRepo,evidenceDir,policy:d.policy,dockerRunner:d.runner,
      recoveryReviewOnly:true});
    assert.equal(tested.test_passed,true);
    assert.equal(tested.qa_receipt_submitted,false);
    assert.equal(tested.git_published,false);
    assert.equal(d.seen.filter(z=>z.args[0]==='create').length,1);
    const {signer}=qaSigningFixture(f);
    await assert.rejects(attestIndependentQa({...f.opts,agentId:'agent_qa',
      signer,evidenceDir}),/QA_EVIDENCE_CENTRAL_CHANGED_OWNER_REVIEW/);
    const attested=await attestIndependentQa({...f.opts,agentId:'agent_qa',
      signer,evidenceDir,recoveryReviewOnly:true});
    assert.equal(attested.qa_approved,false);
    let proposal=null,evidenceHash=null,approved=false,restored=false,recorded=false;
    let evidencePosts=0,receiptPosts=0;
    const receiptId='12345678-1234-4234-8234-123456789abc';
    const fetcher=async(url,opts)=>{
      const uri=new URL(url).pathname;
      if(uri.startsWith('/v7/tasks/detail/'))return f.fetcher(url,opts);
      if(uri.startsWith('/v7/tasks/qa-review/')){
        assert.equal(uri,'/v7/tasks/qa-review/'+proposal);
        const status=recorded?'INTEGRATING':
          restored?'SUBMITTED_FOR_REVIEW':'RECONCILIATION_REQUIRED';
        return new Response(JSON.stringify({
          review_proposal_id:proposal,ticket_id:'ticket_abc',
          qa_agent_id:'agent_qa',owner_review_state:approved?'APPROVED':'PENDING',
          task_status:status,candidate_head_sha:f.head,candidate_tree_sha:f.tree,
          evidence_sha256:evidenceHash,qa_receipt_recorded:recorded,
          qa_receipt_id:recorded?receiptId:null,owner_review_required:true,
          automatic_qa_approval_allowed:false,automatic_qa_receipt_allowed:false,
          git_published:false,
          manual_next_action:recorded?'RECEIPT_RECORDED_REVIEW_GIT_SEPARATELY':
            approved?(restored?'OWNER_APPROVED_MANUAL_RECEIPT_SEPARATE':
              'OWNER_RESTORE_QA_CANDIDATE_BEFORE_RECEIPT'):'WAIT_FOR_OWNER_REVIEW'
        }),{status:200});
      }
      assert.equal(opts.method,'POST');
      const body=JSON.parse(opts.body);
      if(uri==='/v7/tasks/qa-evidence'){
        evidencePosts++;
        evidenceHash=body.attestation.message.evidence_sha256;
        proposal='qaev_'+crypto.createHash('sha256').update([
          'ticket_abc','agent_qa',signer.snapshot().node_id,
          f.head,f.tree,evidenceHash,
          hex(Buffer.from(body.attestation.signature,'base64')),'PASS'
        ].join('\n')).digest('hex');
        return new Response(JSON.stringify({
          accepted:true,review_proposal_id:proposal,status:'PENDING_OWNER_REVIEW',
          evidence_sha256:evidenceHash,device_signature_verified:true,
          qa_approved:false,qa_receipt_submitted:false,integration_performed:false,
          git_published:false
        }),{status:200});
      }
      if(uri==='/v7/tasks/qa-receipt'){
        receiptPosts++;
        assert.equal(approved,true);
        assert.equal(restored,true,'Owner must separately restore the exact candidate');
        assert.equal(recorded,false);
        recorded=true;
        f.updateTask({...f.task(),status:'INTEGRATING',version:6});
        return new Response(JSON.stringify({
          accepted:true,ticket_id:'ticket_abc',receipt_id:receiptId,
          status:'INTEGRATING',evidence_level:'AGENT_ATTESTED'
        }),{status:200});
      }
      throw Error('Unexpected QA request '+uri);
    };
    const opts={...f.opts,agentId:'agent_qa',evidenceDir,signer,fetcher};
    await assert.rejects(submitQaEvidenceForOwner(opts),
      /QA_UPLOAD_CENTRAL_CANDIDATE_CHANGED/);
    assert.equal(evidencePosts,0);
    const upload=await submitQaEvidenceForOwner({...opts,recoveryReviewOnly:true});
    assert.equal(upload.device_signature_verified,true);
    assert.equal(upload.qa_receipt_submitted,false);
    assert.equal(evidencePosts,1);
    await assert.rejects(submitOwnerReviewedQaReceipt(opts),
      /QA_RECEIPT_OWNER_REVIEW_PENDING/);
    approved=true; // simulated *separate* Owner approval
    await assert.rejects(submitOwnerReviewedQaReceipt(opts),
      /QA_RECEIPT_OWNER_RESTORE_CANDIDATE_REQUIRED/);
    assert.equal(receiptPosts,0);
    assert.equal(fs.existsSync(path.join(evidenceDir,
      'qa_central_receipt_ticket_abc_pending.json')),false);
    // Simulate separate Owner RESTORE_QA_CANDIDATE (server's real
    // signed/Owner MySQL contract has its own integration assertions).
    restored=true;
    f.updateTask({...f.task(),status:'SUBMITTED_FOR_REVIEW',version:5});
    const accepted=await submitOwnerReviewedQaReceipt(opts);
    assert.equal(accepted.status,'INTEGRATING');
    assert.equal(accepted.git_published,false);
    assert.equal(receiptPosts,1);
    const again=await submitOwnerReviewedQaReceipt(opts);
    assert.equal(again.reconciled_from_central,true);
    assert.equal(receiptPosts,1,'Never send a duplicate receipt after recorded proof');
    assert.equal(cmd(f.qaRepo,'rev-parse','HEAD'),f.baseline);
  }finally{f.close();}
});
test('Frozen QA UI has dedicated explicit action, no arbitrary commands or receipt bypass',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.match(html,/id="workerQARecover"/);
  assert.match(js,/get\('workerQARecover'\)\.addEventListener/);
  assert.match(preload,/runFrozenQaRecovery:\(agentId,ticketId\)/);
  assert.match(preload,/sutradhar:runIndependentQa',agentId,ticketId,true/);
  assert.match(main,/QA_RECOVERY_REQUIRES_FROZEN_CANDIDATE/);
  assert.match(main,/frozenQaReviewStage/);
  assert.match(main,/QA_RECOVERY_MODE_INVALID/);
  assert.doesNotMatch(preload,/recoveryReviewOnly:|owner_confirmed_recovery_review|signWorkerAction|evidence_base64/);
});


test('independent QA history rejects nested execution/secret metadata despite broad scope',
  {skip:!available},()=>{
    const {verifyHistory}=require('../apps/desktop/qa-handoff.cjs');
    for(const unsafe of ['package.json','.env.production','.npmrc','.gitignore']){
      const f=fixture();
      try{
        fs.writeFileSync(path.join(f.work,'src',unsafe),'blocked configuration\n');
        cmd(f.work,'add','--','src/'+unsafe);
        cmd(f.work,'-c','user.name=SUTRADHAR tests',
          '-c','user.email=noreply@example.invalid',
          'commit','-m','attempt to add nested privileged file');
        const head=cmd(f.work,'rev-parse','HEAD');
        const tree=cmd(f.work,'rev-parse','HEAD^{tree}');
        assert.throws(()=>verifyHistory(f.work,{
          candidate_head_sha:head,candidate_tree_sha:tree,
          baseline_sha:f.baseline,write_scopes:['src']
        }),/HANDOFF_QA_OUT_OF_SCOPE_HISTORY/);
      }finally{f.close();}
    }
  });
