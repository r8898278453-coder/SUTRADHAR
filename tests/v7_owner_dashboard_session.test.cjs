'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../v7/ui/dashboard.js'),'utf8');
const nodeId='node_'+'a'.repeat(32);
function browser(){
  const nodes=new Map(),pending=[],queries=[],downloads=[];
  function element(id){
    if(!nodes.has(id))nodes.set(id,{
      value:'',textContent:'',className:'',hidden:id==='dashboard',
      disabled:false,checked:false,listeners:{},children:[],
      addEventListener(type,cb){this.listeners[type]=cb;},
      replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
      click(){downloads.push({href:this.href,download:this.download});}
    });
    return nodes.get(id);
  }
  const document={
    getElementById:element,querySelectorAll:()=>[],
    createElement:()=>element('_anonymous_'+nodes.size)
  };
  const fetch=(url,options)=>new Promise(resolve=>{
    queries.push({url,options});
    pending.push({url,resolve});
  });
  const ctx=vm.createContext({
    document,window:{SutradharCrashCrosscheck:{
      inspectPair:()=>{throw Error('SHOULD_NOT_REACH_STALE_INSPECTOR');}
    }},
    fetch,console,Date,Error,Math,Number,JSON,Array,Object,Set,
    Blob:class {
      constructor(parts){this.text=parts.join('');this.size=Buffer.byteLength(this.text);}
    },
    URL:{createObjectURL(blob){
      downloads.push({blobText:blob.text});return 'blob:test-only';
    },revokeObjectURL(){}},
    setTimeout:fn=>fn(),
    setInterval:()=>99,clearInterval:()=>{},crypto:{randomUUID:()=> 'uuid'},
    confirm:()=>false
  });
  vm.runInContext(src,ctx,{filename:'dashboard.js',timeout:3000});
  vm.runInContext("key='api-key-a';ownerSessionVersion=1;",ctx);
  element('dashboard').hidden=false;
  element('node-recovery-input').value=nodeId;
  return {element,pending,queries,downloads,ctx,flush:async()=>{await Promise.resolve();await Promise.resolve();}};
}
function complete(p,data={}){
  p.resolve({ok:true,status:200,json:async()=>data});
}
function snapshot(){
  return {schema:1,mode:'OWNER_CENTRAL_NODE_CRASH_RECOVERY_OBSERVATION',
    node_id:nodeId,read_only:true,central_state_modified:false,
    agent_restart_allowed:false,marker_removal_allowed:false,
    installer_execution_allowed:false,production_release_authorized:false,
    owner_reconciliation_complete:false,
    cluster:{epoch_decimal:'8',phase:'READY'},
    node_state:'APPROVED',node_public_key_fingerprint_sha256:'c'.repeat(64),
    accepted_boot_id:'boot_1',accepted_node_sequence_decimal:'4',
    maintenance:{active_fence:false,unresolved_intent_count:0},
    active_worker_lease_count:0,outstanding_worker_ticket_count:0,
    unresolved_git_job_count:0,historical_effects:{},agents:[],
    observed_at_central_ms:Date.now()};
}
test('Owner logout discards in-flight node recovery GET (no old-session data)',async()=>{
  const b=browser(),e=b.element;
  const run=e('node-recovery-inspect').listeners.click();
  assert.equal(b.pending.length,1);
  e('disconnect').onclick();
  complete(b.pending.shift(),snapshot());
  await run;
  assert.equal(e('dashboard').hidden,true);
  assert.match(e('node-recovery-results').textContent,/Disconnected/);
  assert.doesNotMatch(e('node-recovery-results').textContent,/Accepted node sequence/);
  assert.ok(b.queries.every(q=>q.options.credentials==='omit'));
  assert.ok(b.queries.every(q=>q.options.body===undefined));
});
test('Owner edits and restores local input while dual GET pending: second GET never fires',async()=>{
  const b=browser(),e=b.element;
  e('node-recovery-pin').value='c'.repeat(64);
  e('node-recovery-local-json').value='{"schema":1,"state":"OWNER_REVIEW_REQUIRED"}';
  const run=e('node-recovery-crosscheck').listeners.click();
  assert.equal(b.pending.length,1);
  e('node-recovery-pin').value='f'.repeat(64);
  e('node-recovery-pin').listeners.input();
  e('node-recovery-pin').value='c'.repeat(64);
  complete(b.pending.shift(),snapshot());
  await run;
  assert.equal(b.queries.length,1,'input revision prevents a second stale read');
  assert.match(e('node-recovery-crosscheck-results').textContent,/inputs changed/);
});
test('same API token after session generation change cannot reuse old GET',async()=>{
  const b=browser(),e=b.element;
  const run=e('node-recovery-inspect').listeners.click();
  vm.runInContext('ownerSessionVersion++;',b.ctx);
  complete(b.pending.shift(),snapshot());
  await run;
  assert.doesNotMatch(e('node-recovery-results').textContent,/Accepted node sequence/);
});
test('in-flight full dashboard refresh cannot reopen after logout',async()=>{
  const b=browser(),e=b.element;
  const run=e('refresh').onclick();
  assert.equal(b.pending.length,4);
  e('disconnect').onclick();
  for(const req of b.pending.splice(0))
    complete(req,{cluster:{epoch:1},agents:[]});
  await run;
  assert.equal(e('dashboard').hidden,true);
  assert.equal(e('connection').textContent,'Disconnected');
  assert.equal(b.queries.length,4,'stale refresh never starts more API requests');
});
test('Owner recovery UI remains GET-only; no local diagnostic or pin transmitted',async()=>{
  const b=browser(),e=b.element;
  e('node-recovery-pin').value='c'.repeat(64);
  e('node-recovery-local-json').value='{"schema":1,"secret_marker":"local-only"}';
  const run=e('node-recovery-crosscheck').listeners.click();
  complete(b.pending.shift(),snapshot());
  // A request has multiple await boundaries (fetch + res.json).
  // Drain any subsequently scheduled GET deterministically.
  for(let i=0;i<10;i++){
    await b.flush();
    for(const pending of b.pending.splice(0))complete(pending,snapshot());
  }
  await run;
  assert.equal(b.queries.length,2,'dual Owner comparison performs exactly two GETs');
  assert.ok(b.queries.every(q=>!q.url.includes('secret_marker')));
  assert.ok(b.queries.every(q=>q.options.body===undefined));
  assert.ok(b.queries.every(q=>q.options.method===undefined));
  assert.match(e('node-recovery-crosscheck-results').textContent,/HOLD/);
});

test('explicit-click review export follows dual GET and never includes API token',async()=>{
  const b=browser(),e=b.element;
  e('node-recovery-pin').value='c'.repeat(64);
  e('node-recovery-local-json').value='{"schema":1,"state":"OWNER_REVIEW_REQUIRED"}';
  const api=b.ctx.window.SutradharCrashCrosscheck;
  api.inspectPair=()=>({
    state:'OWNER_REVIEW_REQUIRED',read_only:true,
    compared_node_id:nodeId,local_session_marker_shape_valid:true,
    central_fingerprint_matches_independent_enrollment_pin:true,
    central_observation_unchanged:true,central_observation_window_bounded:true,
    central_browser_clock_near_central:true,preliminary_inconsistency_count:0,
    finding_codes:['PHYSICAL_PC_AND_WINDOWS_DPAPI_NOT_VERIFIED'],
    agent_restart_allowed:false,marker_removal_allowed:false,
    owner_reconciliation_complete:false,installer_execution_allowed:false,
    production_release_authorized:false
  });
  api.makeReviewInputBundle=input=>({
    schema:1,kind:'SUTRADHAR_OWNER_CRASH_REVIEW_INPUT_BUNDLE_V1',
    read_only:true,agent_restart_allowed:false,
    input:{nodeId:input.nodeId,observedAtClientMs:input.observedAtClientMs}
  });
  const run=e('node-recovery-crosscheck').listeners.click();
  assert.equal(e('node-recovery-save-bundle').disabled,true);
  assert.equal(b.downloads.length,0,'no automatic browser download');
  complete(b.pending.shift(),snapshot());
  for(let i=0;i<12;i++){
    await b.flush();
    for(const item of b.pending.splice(0))complete(item,snapshot());
  }
  await run;
  assert.equal(b.queries.length,2);
  assert.equal(e('node-recovery-save-bundle').disabled,false);
  assert.equal(b.downloads.length,0,'explicit second click required');
  e('node-recovery-save-bundle').listeners.click();
  assert.equal(b.downloads.filter(x=>x.blobText).length,1);
  const saved=b.downloads.find(x=>x.blobText).blobText;
  assert.doesNotMatch(saved,/api-key-a/);
  assert.match(saved,/OWNER_CRASH_REVIEW_INPUT_BUNDLE/);
  assert.ok(b.queries.every(q=>q.options.body===undefined));
  e('node-recovery-pin').listeners.input();
  assert.equal(e('node-recovery-save-bundle').disabled,true);
  const count=b.downloads.length;
  e('node-recovery-save-bundle').listeners.click();
  assert.equal(b.downloads.length,count,'input invalidation blocks stale download');
  e('disconnect').onclick();
  assert.equal(e('node-recovery-save-bundle').disabled,true);
});


const aliasBinding={project_id:'project_demo',agent_id:'agent_demo',
  provider:'CHATGPT_WEB',account_ref:'account_demo',workspace_ref:'workspace_demo'};
function registryRead(version,bindings=[]){
  return {version,bindings,source:version?'MYSQL_OWNER_REGISTRY':'LEGACY_ENV_CONFIGURATION',
    registry_sha256:version?'a'.repeat(64):null,legacy_fallback_active:!version,
    provider_mapping_verified:false,automatic_execution_allowed:false};
}
async function loadRegistry(b,data){
  const run=b.element('provider-registry-load').onclick();
  assert.equal(b.pending.length,1);
  assert.equal(b.pending[0].url,'/v7/owner/provider-registry');
  complete(b.pending.shift(),data);await run;
}
function confirmRegistry(b){
  b.ctx.confirm=()=>true;
  b.element('provider-registry-consent').checked=true;
  b.element('provider-registry-consent').listeners.change();
}
function registryReceipt(post,version,count){
  return {accepted:true,receipt_id:post.request_id,state:{registry_version:version,
    registry_sha256:'a'.repeat(64),binding_count:count,
    provider_mapping_verified:false,automatic_execution_allowed:false}};
}
async function awaitPending(b){
  for(let i=0;i<12&&!b.pending.length;i++)await b.flush();
  assert.equal(b.pending.length,1);
}
test('Owner registry editor adds aliases locally and saves exactly one CAS replacement with readback',async()=>{
  const b=browser(),e=b.element;
  await loadRegistry(b,registryRead(0));
  assert.match(e('provider-registry-status').textContent,/NOT listed/);
  assert.equal(e('provider-registry-save').disabled,true);
  e('provider-project').value=aliasBinding.project_id;
  e('provider-agent').value=aliasBinding.agent_id;
  e('provider-kind').value=aliasBinding.provider;
  e('provider-account').value=aliasBinding.account_ref;
  e('provider-workspace').value=aliasBinding.workspace_ref;
  confirmRegistry(b);
  assert.equal(e('provider-registry-save').disabled,true,'unadded input blocks save');
  e('provider-registry-add').onclick();
  assert.equal(b.queries.length,1,'draft changes never POST');
  assert.equal(e('provider-registry-consent').checked,false);
  confirmRegistry(b);
  assert.equal(e('provider-registry-save').disabled,false);
  const run=e('provider-registry-save').onclick();
  assert.equal(b.pending.length,1);
  assert.equal(b.queries[1].options.method,'POST');
  assert.equal(b.queries[1].options.redirect,'error');
  const post=JSON.parse(b.queries[1].options.body);
  assert.equal(post.command,'REPLACE_PROVIDER_REGISTRY');
  assert.deepEqual(post.payload,{expected_version:0,bindings:[aliasBinding]});
  await e('provider-registry-save').onclick();
  assert.equal(b.queries.length,2,'busy save blocks a second POST');
  complete(b.pending.shift(),registryReceipt(post,1,1));
  await awaitPending(b);
  complete(b.pending.shift(),registryRead(1,[aliasBinding]));
  await run;
  assert.match(e('provider-registry-status').textContent,/Saved and read back exact version 1/);
  assert.equal(e('provider-registry-save').disabled,true);
  assert.ok(b.queries.every(x=>x.options.credentials==='omit'));
});
test('Owner registry empty replacement requires explicit consent and current readback',async()=>{
  const b=browser(),e=b.element;
  await loadRegistry(b,registryRead(4,[aliasBinding]));
  const remove=e('provider-registry-rows').children[0].children[5].children[0];
  remove.onclick();
  assert.equal(b.queries.length,1);
  assert.equal(e('provider-registry-save').disabled,true);
  confirmRegistry(b);
  const run=e('provider-registry-save').onclick();
  const post=JSON.parse(b.queries[1].options.body);
  assert.deepEqual(post.payload,{expected_version:4,bindings:[]});
  complete(b.pending.shift(),registryReceipt(post,5,0));
  await awaitPending(b);
  complete(b.pending.shift(),registryRead(6,[]));
  await run;
  assert.match(e('provider-registry-status').textContent,/Save not verified/);
  assert.equal(e('provider-registry-save').disabled,true);
  assert.equal(e('provider-registry-add').disabled,true);
  await e('provider-registry-save').onclick();
  assert.equal(b.queries.length,3,'no automatic retry after later competing version');
});
test('Owner logout during registry POST discards late receipt and never performs readback',async()=>{
  const b=browser(),e=b.element;
  await loadRegistry(b,registryRead(0));
  confirmRegistry(b);
  const run=e('provider-registry-save').onclick();
  const post=JSON.parse(b.queries[1].options.body);
  e('disconnect').onclick();
  complete(b.pending.shift(),registryReceipt(post,1,0));
  await run;
  assert.equal(b.queries.length,2);
  assert.match(e('provider-registry-status').textContent,/session changed/);
  assert.equal(e('provider-registry-save').disabled,true);
  assert.equal(e('provider-registry-rows').children.length,0);
});
test('Owner registry rejects malformed alias metadata, never displays secrets as a draft',async()=>{
  const b=browser(),e=b.element;
  await loadRegistry(b,registryRead(1,[{...aliasBinding,account_ref:'user@example.org'}]));
  assert.match(e('provider-registry-status').textContent,/unavailable or invalid/);
  assert.equal(e('provider-registry-add').disabled,true);
  assert.equal(e('provider-registry-save').disabled,true);
  assert.equal(e('provider-registry-rows').children.length,0);
});
test('Owner registry stale GET after logout cannot display earlier session aliases',async()=>{
  const b=browser(),e=b.element;
  const run=e('provider-registry-load').onclick();
  e('disconnect').onclick();
  complete(b.pending.shift(),registryRead(1,[aliasBinding]));
  await run;
  assert.equal(e('provider-registry-rows').children.length,0);
  assert.equal(e('provider-registry-save').disabled,true);
});
