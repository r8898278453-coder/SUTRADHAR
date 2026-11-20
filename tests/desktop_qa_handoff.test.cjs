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
test('Central hash mismatch and dirty or untrusted QA origin block untrusted Git transfer',
  {skip:!available},async()=>{
    const f=fixture();
    try{
      await exportCandidateHandoff({...f.opts,agentId:'agent_dev',dir:f.worker});
      f.updateTask({...f.task(),candidate_head_sha:'f'.repeat(40)});
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_MANIFEST_CENTRAL_MISMATCH/);
      f.updateTask(f.task());
      fs.writeFileSync(path.join(f.qaRepo,'untracked.txt'),'not clean');
      await assert.rejects(inspectQAHandoff({...f.opts,
        agentId:'agent_qa',repoDir:f.qaRepo}),/HANDOFF_QA_REPO_NOT_CLEAN_BASELINE/);
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
