'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createVault}=require('../apps/desktop/os-vault.cjs');
const {createSignerBridge}=require('../apps/desktop/vault-bridge.cjs');
const {inspectWorkerTasks}=require('../apps/desktop/worker-inspection.cjs');

function safeStorage(){
  const key=crypto.randomBytes(32);
  return {isEncryptionAvailable:()=>true,
    encryptString:s=>{
      const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
      return Buffer.concat([iv,c.update(s,'utf8'),c.final(),c.getAuthTag()]);
    },
    decryptString:x=>{
      const iv=x.subarray(0,12),tag=x.subarray(x.length-16),ct=x.subarray(12,-16);
      const d=crypto.createDecipheriv('aes-256-gcm',key,iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct),d.final()]).toString('utf8');
    }};
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-worker-inspect-'));
  const vault=createVault({safeStorage:safeStorage(),dir,platform:'win32'});
  const signer=createSignerBridge(vault),pub=signer.initialize({agent_ids:['agent_aaa','agent_bbb']});
  return {dir,vault,signer,pub,close:()=>fs.rmSync(dir,{force:true,recursive:true})};
}
function verify(headers,uri,pub){
  const key=crypto.createPublicKey(pub.public_key_pem);
  const canonical=[headers['x-sutradhar-timestamp'],
    headers['x-sutradhar-nonce'],'GET',uri,
    crypto.createHash('sha256').update('').digest('hex')].join('\n');
  return crypto.verify(null,Buffer.from(canonical),key,
    Buffer.from(headers['x-sutradhar-signature'],'base64'));
}
test('read-only worker capability is separate from heartbeat child signer and cannot sign writes',()=>{
  const f=fixture();
  try{
    const s=f.signer;
    assert.throws(()=>s.sign({kind:'node_api',method:'GET',uri:'/v7/tasks/available',body:''}),/DENIED/);
    const headers=s.signWorkerReadOnly({method:'GET',uri:'/v7/tasks/available',agent_id:'agent_aaa'});
    assert.equal(headers['x-sutradhar-agent'],'agent_aaa');
    assert.equal(verify(headers,'/v7/tasks/available',f.pub),true);
    assert.equal(JSON.stringify(headers).includes('PRIVATE KEY'),false);
    for(const bad of [
      {method:'POST',uri:'/v7/tasks/claim',agent_id:'agent_aaa'},
      {method:'POST',uri:'/v7/tasks/available',agent_id:'agent_aaa'},
      {method:'GET',uri:'/v7/tasks/available',agent_id:'agent_wrong'},
      {method:'GET',uri:'/v7/tasks/detail/../../owner',agent_id:'agent_aaa'},
      {method:'GET',uri:'https://attacker.example/v7/tasks/available',agent_id:'agent_aaa'},
      {method:'GET',uri:'/v7/tasks/detail/task_aaa?x=1',agent_id:'agent_aaa'},
      {method:'GET',uri:'/v7/owner/git-recovery',agent_id:'agent_aaa'},
      {method:'GET',uri:'/v7/tasks/detail/ab',agent_id:'agent_aaa'},
      {method:'GET',uri:'/v7/tasks/detail/TICKET_AAA/',agent_id:'agent_aaa'}
    ])assert.throws(()=>s.signWorkerReadOnly(bad),/DENIED/);
    assert.equal(JSON.stringify(s.snapshot()).includes('PRIVATE KEY'),false);
    assert.equal(fs.readFileSync(f.vault.file,'utf8').includes('PRIVATE KEY'),false);
  }finally{f.close();}
});
test('OS-vault-signed list and detail use fixed HTTPS routes, strict response shapes and no request body',async()=>{
  const f=fixture(),calls=[];
  const list=[{ticket_id:'ticket_123',project_id:'project_aaa',
    title:'Implement feature',risk:'LOW',version:3}];
  const detail={...list[0],repository:'example/repo',description:'Authorized scope',
    branch_name:'ai/ticket_123',baseline_sha:'a'.repeat(40),
    write_scopes:['src/feature.ts'],acceptance_criteria:['verifiable test'],
    status:'READY',worker_agent_id:null,latest_checkpoint:null};
  async function fake(url,init){
    calls.push({url,init});
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.credentials,'omit');
    assert.equal(init.cache,'no-store');
    assert.equal(init.headers['x-sutradhar-agent'],'agent_aaa');
    assert.equal(verify(init.headers,new URL(url).pathname,f.pub),true);
    assert.equal(init.body,undefined);
    return new Response(JSON.stringify(url.endsWith('/available')?list:detail),{
      status:200,headers:{'content-type':'application/json'}});
  }
  try{
    const tasks=await inspectWorkerTasks({origin:'https://central.example.com',
      agentId:'agent_aaa',signer:f.signer,fetcher:fake});
    assert.deepEqual(tasks,{mode:'AVAILABLE',agent_id:'agent_aaa',tasks:list});
    const got=await inspectWorkerTasks({origin:'https://central.example.com',
      agentId:'agent_aaa',ticketId:'ticket_123',signer:f.signer,fetcher:fake});
    assert.equal(got.task.ticket_id,'ticket_123');
    assert.deepEqual(got.task.write_scopes,['src/feature.ts']);
    assert.equal(got.task.description,'Authorized scope');
    assert.deepEqual(calls.map(x=>x.url),[
      'https://central.example.com/v7/tasks/available',
      'https://central.example.com/v7/tasks/detail/ticket_123'
    ]);
    assert.equal(JSON.stringify(tasks).includes('private_key_pem'),false);
  }finally{f.close();}
});
test('invalid origin or agent never causes network request or arbitrary signing',async()=>{
  const f=fixture();let requests=0;
  const fake=async()=>{requests++;throw Error('NETWORK_SHOULD_NOT_RUN');};
  try{
    for(const x of [
      {origin:'http://central.example.com',agentId:'agent_aaa'},
      {origin:'https://central.example.com/owner',agentId:'agent_aaa'},
      {origin:'https://central.example.com@evil.example',agentId:'agent_aaa'},
      {origin:'https://central.example.com',agentId:'agent_unknown'},
      {origin:'https://central.example.com',agentId:'agent_aaa',ticketId:'../owner'},
      {origin:'https://central.example.com',agentId:'agent_aaa',ticketId:'ticket_id?x=1'}
    ])await assert.rejects(inspectWorkerTasks({...x,signer:f.signer,fetcher:fake}),
      /DENIED|INVALID/);
    assert.equal(requests,0);
  }finally{f.close();}
});
test('read-only inspection rejects unsafe Central data, unexpected ticket and oversized streams',async()=>{
  const f=fixture();const run=async(ticketId,response)=>inspectWorkerTasks({
    origin:'https://central.example.com',agentId:'agent_aaa',
    ticketId,signer:f.signer,fetcher:async()=>response});
  try{
    await assert.rejects(run(null,new Response(JSON.stringify([{ticket_id:'ticket_123',
      project_id:'project_aaa',risk:'LOW',version:1,title:'x'},
      {ticket_id:'../private',project_id:'project_aaa',risk:'LOW',version:1,title:'x'}]))),
      /INVALID/);
    await assert.rejects(run('ticket_123',new Response(JSON.stringify({ticket_id:'ticket_other'}))),
      /INVALID/);
    await assert.rejects(run(null,new Response('x'.repeat(100000))),/TOO_LARGE/);
    await assert.rejects(run(null,new Response(JSON.stringify({error_code:'PROJECT_ACCESS_DENIED'}),
      {status:403})),/WORKER_INSPECTION_PROJECT_ACCESS_DENIED/);
    await assert.rejects(run(null,new Response('not json')),/INVALID/);
  }finally{f.close();}
});
test('packaged Electron worker inspection is scoped to local sandboxed setup and shipped with QA build',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const setup=fs.readFileSync(path.join(root,'setup.html'),'utf8');
  assert.ok(cfg.build.files.includes('worker-inspection.cjs'));
  assert.match(main,/verifySender\(event\)/);
  assert.match(main,/ipcMain\.handle\('sutradhar:inspectWorkerTasks'/);
  assert.match(main,/WORKER_INSPECTION_REQUIRES_RECENT_CENTRAL_ACK/);
  assert.match(main,/WORKER_INSPECTION_REQUIRES_PACKAGED_WINDOWS_OS_VAULT/);
  assert.match(main,/WORKER_INSPECTION_MAINTENANCE_HOLD/);
  assert.match(preload,/inspectWorkerTasks:\(agentId,ticketId=null\)/);
  assert.match(setup,/id="workerList"/);
  assert.doesNotMatch(preload,/signWorkerReadOnly|private_key_pem/);
});

test('compact context includes only bounded exact task/checkpoint fields without provider or execution permission',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const summary='Completed scoped function',next_action='Run tests';
  const checkpoint={generation:2,summary,next_action,content_sha256:crypto.createHash('sha256').update(summary+'\n'+next_action).digest('hex')};
  const task={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature',description:'Narrow implementation',repository:'example/repo',branch_name:'ai/ticket_123',baseline_sha:'a'.repeat(40),risk:'LOW',status:'CHECKPOINTED',version:3,worker_agent_id:'agent_aaa',write_scopes:['src/x.ts','src/x.ts'],acceptance_criteria:['Test passes','Test passes'],latest_checkpoint:checkpoint,private_key_pem:'SENTINEL'};
  const r=compactWorkerContext(task,'agent_aaa'),body=JSON.parse(r.preview);
  assert.deepEqual(body.write_scopes,['src/x.ts']);
  assert.deepEqual(body.acceptance_criteria,['Test passes']);
  assert.equal(body.checkpoint.content_sha256,checkpoint.content_sha256);
  assert.equal(r.utf8_bytes,Buffer.byteLength(r.preview));
  assert.equal(r.context_sha256,crypto.createHash('sha256').update(r.preview).digest('hex'));
  assert.equal(r.provider_sent,false);
  assert.equal(r.lease_verified,false);
  assert.equal(r.automatic_execution_allowed,false);
  assert.doesNotMatch(r.preview,/SENTINEL|private_key_pem/);
  assert.throws(()=>compactWorkerContext({...task,status:'READY'},'agent_aaa'),/OWN_CLAIMED_TASK/);
  assert.throws(()=>compactWorkerContext(task,'agent_bbb'),/OWN_CLAIMED_TASK/);
  assert.throws(()=>compactWorkerContext({...task,write_scopes:['src/.env']},'agent_aaa'),/OWN_CLAIMED_TASK/);
  assert.throws(()=>compactWorkerContext({...task,latest_checkpoint:{...checkpoint,summary:'changed'}},'agent_aaa'),/DIGEST_MISMATCH/);
  assert.throws(()=>compactWorkerContext({...task,description:'界'.repeat(3500)},'agent_aaa'),/BUDGET_EXCEEDED/);
});
test('compact context preview uses existing bounded inspection IPC, never automatic provider transmission',()=>{
  const root=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8'),preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'setup.html'),'utf8'),js=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.match(main,/if\(mode!=='context'\)return result;/);
  assert.match(main,/const preview=compactWorkerContext\(result\.task,agentId\)/);
  assert.match(main,/workerContextReview=\{origin,agentId,ticketId,digest:preview\.context_sha256/);
  assert.match(main,/workerContextReview!==review/);
  assert.match(preload,/previewWorkerContext:\(agentId,ticketId\)=>ipcRenderer.invoke\('sutradhar:inspectWorkerTasks',agentId,ticketId,'context'\)/);
  assert.match(html,/id="workerContext"/);
  assert.match(js,/Nothing sent to provider/);
});

test('inspection rejects malformed UTF-8 before JSON parsing and signing inputs without coercion',async()=>{
  const f=fixture();let calls=0;
  const fetcher=async()=>{calls++;return new Response(Buffer.concat([
    Buffer.from('[{"ticket_id":"ticket_123","project_id":"project_aaa","risk":"LOW","version":1,"title":"'),
    Buffer.from([0xc3,0x28]),Buffer.from('"}]')
  ]));};
  const run=(overrides={})=>inspectWorkerTasks({origin:'https://central.example.com',
    agentId:'agent_aaa',signer:f.signer,fetcher,...overrides});
  try{
    await assert.rejects(run({agentId:['agent_aaa']}),/INPUT_DENIED/);
    await assert.rejects(run({ticketId:['ticket_123']}),/INPUT_DENIED/);
    assert.equal(calls,0);
    await assert.rejects(run(),/RESPONSE_INVALID/);
    assert.equal(calls,1);
    const item={ticket_id:'ticket_123',project_id:'project_aaa',risk:'LOW',version:1,title:'Valid 🌏 हिन्दी'};
    for(const patch of [{version:true},{version:[1]},{version:'1e0'},{ticket_id:['ticket_123']},
      {project_id:['project_aaa']},{title:'bad\uD800'}]){
      await assert.rejects(run({fetcher:async()=>new Response(JSON.stringify([{...item,...patch}]))}),/RESPONSE_INVALID/);
    }
    const valid=await run({fetcher:async()=>new Response(JSON.stringify([{...item,version:'1'}]))});
    assert.deepEqual(valid.tasks,[item]);
  }finally{f.close();}
});
test('context rejects blank criteria, malformed identifiers and lossy checkpoint Unicode',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const t={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature 🌏',
    description:'Implement scoped feature',repository:'example/repo',branch_name:'ai/ticket_123',
    baseline_sha:'a'.repeat(40),risk:'LOW',status:'CLAIMED',version:1,
    worker_agent_id:'agent_aaa',write_scopes:['src/x.ts'],acceptance_criteria:['Test passes']};
  const summary='invalid\uD800',next_action='Test';
  const checkpoint={generation:1,summary,next_action,content_sha256:crypto.createHash('sha256').update(summary+'\n'+next_action).digest('hex')};
  for(const patch of [{acceptance_criteria:['  ']},{description:'bad\uD800'},
    {repository:['example/repo']},{worker_agent_id:['agent_aaa']},{version:true},
    {latest_checkpoint:checkpoint},{candidate_head_sha:['a'.repeat(40)],candidate_tree_sha:'a'.repeat(40)}]){
    assert.throws(()=>compactWorkerContext({...t,...patch},'agent_aaa'),/INVALID|OWN_CLAIMED_TASK/);
  }
  assert.equal(JSON.parse(compactWorkerContext(t,'agent_aaa').preview).title,t.title);
});

test('compact provider payload is canonical, smaller, and retains every task field',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const t={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature 🌏',
    description:'Implement scoped feature',repository:'example/repo',branch_name:'ai/ticket_123',
    baseline_sha:'a'.repeat(40),risk:'LOW',status:'CLAIMED',version:1,
    worker_agent_id:'agent_aaa',write_scopes:['src/z.ts','src/x.ts','src/z.ts'],
    acceptance_criteria:['Test passes','Negative test passes']};
  const result=compactWorkerContext(t,'agent_aaa'),parsed=JSON.parse(result.preview);
  assert.equal(result.preview,JSON.stringify(parsed));
  assert.ok(result.utf8_bytes<Buffer.byteLength(JSON.stringify(parsed,null,2)));
  assert.deepEqual(parsed.write_scopes,['src/x.ts','src/z.ts']);
  assert.deepEqual(parsed.acceptance_criteria,t.acceptance_criteria);
  const reordered=compactWorkerContext({...t,write_scopes:['src/x.ts','src/z.ts']},'agent_aaa');
  assert.equal(reordered.context_sha256,result.context_sha256);
  assert.equal(result.provider_mapping_verified,false);
  assert.equal(result.provider_sent,false);
  for(const patch of [{repository:'../repo'},{repository:'example/.'},
    {branch_name:'ai/task..other'},{branch_name:'ai/task.'},{branch_name:'ai/task.lock'}]){
    assert.throws(()=>compactWorkerContext({...t,...patch},'agent_aaa'),/RESPONSE_INVALID/);
  }
});

test('provider declarations are bound to exact task project and worker and excluded from prompt bytes',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const t={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature',
    description:'Implement scoped feature',repository:'example/repo',branch_name:'ai/ticket_123',
    baseline_sha:'a'.repeat(40),risk:'LOW',status:'CLAIMED',version:1,
    worker_agent_id:'agent_aaa',write_scopes:['src/x.ts'],acceptance_criteria:['Test passes']};
  const binding={project_id:t.project_id,agent_id:t.worker_agent_id,provider:'CHATGPT_WEB',
    account_ref:'account_operator',workspace_ref:'workspace_example'};
  const mapping={provider:binding.provider,account_ref:binding.account_ref,workspace_ref:binding.workspace_ref,
    binding_sha256:crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    state:'OWNER_DECLARED_UNVERIFIED',provider_mapping_verified:false,automatic_execution_allowed:false};
  const task={...t,provider_mapping_state:'OWNER_DECLARED_UNVERIFIED',provider_mappings:[mapping]};
  const r=compactWorkerContext(task,'agent_aaa');
  assert.deepEqual(r.provider_mappings,[mapping]);
  assert.equal(r.provider_mapping_verified,false);
  assert.equal(r.context_sha256,compactWorkerContext(t,'agent_aaa').context_sha256);
  assert.doesNotMatch(r.preview,/account_operator|workspace_example/);
  for(const altered of [{...mapping,provider_mapping_verified:true},{...mapping,binding_sha256:'0'.repeat(64)},
    {...mapping,workspace_ref:'https://example.invalid'},{...mapping,token:'SENTINEL'}]){
    assert.throws(()=>compactWorkerContext({...task,provider_mappings:[altered]},'agent_aaa'),/WORKER_PROVIDER_MAPPING_INVALID/);
  }
  assert.throws(()=>compactWorkerContext({...task,project_id:'project_bbb'},'agent_aaa'),/WORKER_PROVIDER_MAPPING_INVALID/);
  assert.throws(()=>compactWorkerContext({...task,provider_mappings:[mapping,mapping]},'agent_aaa'),/WORKER_PROVIDER_MAPPING_INVALID/);
});

test('compact task context retains canonical declared shared contracts without changing write scopes',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const t={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature',
    description:'Implement scoped feature',repository:'example/repo',branch_name:'ai/ticket_123',
    baseline_sha:'a'.repeat(40),risk:'LOW',status:'CLAIMED',version:1,
    worker_agent_id:'agent_aaa',write_scopes:['src/x.ts'],acceptance_criteria:['Test passes']};
  const contract_keys=['api:orders','db:orders'];
  const result=compactWorkerContext({...t,contract_keys},'agent_aaa');
  assert.deepEqual(JSON.parse(result.preview).contract_keys,contract_keys);
  assert.deepEqual(JSON.parse(result.preview).write_scopes,t.write_scopes);
  assert.notEqual(result.context_sha256,compactWorkerContext(t,'agent_aaa').context_sha256);
  assert.equal(result.automatic_execution_allowed,false);
  for(const keys of [['api:Orders'],['db:orders','api:orders'],
    ['api:orders','api:orders.create'],['api:orders','api:orders'],'api:orders'])
    assert.throws(()=>compactWorkerContext({...t,contract_keys:keys},'agent_aaa'),/WORKER_CONTRACT_DECLARATION_INVALID/);
});

test('registry source/version is local metadata only and cannot assert verified permission',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const t={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature',
    description:'Implement scoped feature',repository:'example/repo',branch_name:'ai/ticket_123',
    baseline_sha:'a'.repeat(40),risk:'LOW',status:'CLAIMED',version:1,
    worker_agent_id:'agent_aaa',write_scopes:['src/x.ts'],acceptance_criteria:['Test passes']};
  const r=compactWorkerContext({...t,provider_mapping_state:'UNCONFIGURED',
    provider_mapping_source:'MYSQL_OWNER_REGISTRY',provider_registry_version:2},'agent_aaa');
  assert.equal(r.provider_registry_version,2);
  assert.equal(r.provider_mapping_source,'MYSQL_OWNER_REGISTRY');
  assert.equal(r.context_sha256,compactWorkerContext(t,'agent_aaa').context_sha256);
  assert.doesNotMatch(r.preview,/provider_registry_version|MYSQL_OWNER_REGISTRY/);
  assert.equal(r.provider_mapping_verified,false);
  for(const patch of [{provider_registry_version:0},{provider_registry_version:'2'},
    {provider_mapping_source:'LEGACY_ENV_CONFIGURATION'},
    {provider_mapping_source:'INVALID'}])
    assert.throws(()=>compactWorkerContext({...t,provider_mapping_state:'UNCONFIGURED',
      provider_mapping_source:'MYSQL_OWNER_REGISTRY',provider_registry_version:2,...patch},'agent_aaa'),/WORKER_PROVIDER_MAPPING_INVALID/);
});

test('unresolved provider attempt holds new compact handoff; closed metadata stays outside prompt',()=>{
  const {compactWorkerContext}=require('../apps/desktop/worker-inspection.cjs');
  const t={ticket_id:'ticket_123',project_id:'project_aaa',title:'Feature',
    description:'Implement scoped feature',repository:'example/repo',branch_name:'ai/ticket_123',
    baseline_sha:'a'.repeat(40),risk:'LOW',status:'CHECKPOINTED',version:2,
    worker_agent_id:'agent_aaa',write_scopes:['src/x.ts'],acceptance_criteria:['Test passes']};
  const attempt={attempt_id:'attempt_'+'a'.repeat(32),state:'OPEN',registry_version:1,
    checkpoint_generation:1,context_sha256:'d'.repeat(64),provider:'CHATGPT_WEB',resolution:null};
  for(const state of ['OPEN','INTERRUPTED'])
    assert.throws(()=>compactWorkerContext({...t,provider_attempt:{...attempt,state}},'agent_aaa'),/WORKER_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED/);
  const closed={...attempt,state:'CLOSED',resolution:'WORKER_CHECKPOINT'};
  const result=compactWorkerContext({...t,provider_attempt:closed},'agent_aaa');
  assert.equal(result.context_sha256,compactWorkerContext(t,'agent_aaa').context_sha256);
  assert.doesNotMatch(result.preview,/attempt_id|WORKER_CHECKPOINT/);
  assert.throws(()=>compactWorkerContext({...t,provider_attempt:{...attempt,prompt:'SENTINEL'}},'agent_aaa'),/WORKER_PROVIDER_ATTEMPT_INVALID/);
});
