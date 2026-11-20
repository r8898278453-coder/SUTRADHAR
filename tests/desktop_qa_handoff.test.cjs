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
