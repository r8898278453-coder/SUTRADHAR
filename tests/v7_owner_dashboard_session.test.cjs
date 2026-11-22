'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../v7/ui/dashboard.js'),'utf8');
const nodeId='node_'+'a'.repeat(32);
function browser(){
  const nodes=new Map(),pending=[],queries=[];
  function element(id){
    if(!nodes.has(id))nodes.set(id,{
      value:'',textContent:'',className:'',hidden:id==='dashboard',
      disabled:false,checked:false,listeners:{},
      addEventListener(type,cb){this.listeners[type]=cb;},
      replaceChildren(){},append(){}
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
    setInterval:()=>99,clearInterval:()=>{},crypto:{randomUUID:()=> 'uuid'},
    confirm:()=>false
  });
  vm.runInContext(src,ctx,{filename:'dashboard.js',timeout:3000});
  vm.runInContext("key='api-key-a';ownerSessionVersion=1;",ctx);
  element('dashboard').hidden=false;
  element('node-recovery-input').value=nodeId;
  return {element,pending,queries,ctx,flush:async()=>{await Promise.resolve();await Promise.resolve();}};
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
  await b.flush();
  if(b.pending.length)complete(b.pending.shift(),snapshot());
  await run;
  assert.ok(b.queries.every(q=>!q.url.includes('secret_marker')));
  assert.ok(b.queries.every(q=>q.options.body===undefined));
  assert.ok(b.queries.every(q=>q.options.method===undefined));
  assert.match(e('node-recovery-crosscheck-results').textContent,/HOLD/);
});
