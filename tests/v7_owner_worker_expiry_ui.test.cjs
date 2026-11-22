'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../v7/ui/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../v7/ui/dashboard.js'),'utf8');
const central=fs.readFileSync(path.join(__dirname,'../v7/central.ts'),'utf8');
const good={mode:'OWNER_READ_ONLY_EXPIRED_WORKER_LEASES',epoch:7,master_live:true,
  server_time_utc:'2026-11-23T00:00:00Z',truncated:false,read_only:true,
  worker_lease_revoked:false,automatic_reassignment_allowed:false,
  production_release_authorized:false,tickets:[{
    ticket_id:'ticket_expired_worker',worker_agent_id:'agent_worker',
    status:'CHECKPOINTED',version:3,lease_epoch:7,expired_seconds:30,
    manual_quarantine_eligible:true}]};
function browser({report=good,lostFirst=false}={}){
  const elements=new Map(),calls=[],posts=[];
  const item=id=>({id,textContent:'',value:'',disabled:false,hidden:false,
    children:[],className:'',listeners:{},onclick:null,
    addEventListener(k,fn){this.listeners[k]=fn;},
    append(...c){this.children.push(...c);},
    replaceChildren(...c){this.children=c;}});
  const get=id=>{if(!elements.has(id))elements.set(id,item(id));return elements.get(id);};
  const payload={'/v7/cluster':{cluster:{epoch:7,phase:'READY',
    master_agent_id:'agent_master',paused:0,backup1:null,backup2:null},agents:[]},
    '/v7/projects':[],'/v7/tasks':[],'/v7/audit':[],
    '/v7/owner/maintenance':[],'/v7/owner/worker-expiry':report};
  const fetch=async(url,opts={})=>{
    calls.push({url,opts});
    assert.equal(opts.headers.authorization,'Bearer '+'x'.repeat(40));
    assert.equal(opts.cache,'no-store');assert.equal(opts.credentials,'omit');
    if(opts.method==='POST'){
      assert.equal(url,'/v7/owner/command');
      const body=JSON.parse(opts.body);
      assert.equal(body.command,'QUARANTINE_EXPIRED_WORKER');
      posts.push(body);
      if(lostFirst&&posts.length===1)throw Error('POST_ACK_LOST');
      return{ok:true,json:async()=>({accepted:true,state:{
        ticket_id:'ticket_expired_worker',epoch:7,status:'RECONCILIATION_REQUIRED',
        old_lease_revoked:true,checkpoint_preserved:true,
        automatic_reassignment_allowed:false}})};
    }
    return{ok:true,json:async()=>payload[url]};
  };
  const document={getElementById:get,createElement:item,querySelectorAll:()=>[]};
  vm.runInNewContext(js,{document,fetch,crypto:{randomUUID:()=> 'a'.repeat(32)},
    setInterval:()=>1,clearInterval:()=>{},confirm:()=>true,
    console,Date,Number,Math,String,Array,Boolean,Promise,Error},
    {filename:'dashboard.js'});
  return{get,calls,posts,async connect(){
    get('key').value='x'.repeat(40);
    await get('connect').onclick();
    assert.equal(get('connection').textContent,'Authenticated · live');}};
}
test('Owner expiry GET only and accessible panel never auto-quarantine',async()=>{
  for(const id of ['worker-expiry-title','worker-expiry-status',
    'worker-expiry-ticket','worker-expiry-reason','worker-expiry-rows',
    'worker-expiry-quarantine','worker-expiry-action-status'])
    assert.ok(html.includes('id="'+id+'"'));
  const route=central.match(/app\.get\('\/v7\/owner\/worker-expiry',jsonRoute\(async req=>\{([\s\S]*?)\n\}\)\);/);
  assert.ok(route);assert.match(route[1],/admin\(req\)/);
  assert.match(route[1],/leader\(c,false\)/);
  assert.doesNotMatch(route[1],/UPDATE v7_|DELETE FROM|INSERT INTO|evaluate\(c/);
  assert.doesNotMatch(js,/\.innerHTML\s*=|(?:localStorage|sessionStorage)\.(?:getItem|setItem)/);
  const b=browser();await b.connect();
  assert.equal(b.posts.length,0);
  assert.equal(b.get('worker-expiry-quarantine').disabled,false);
  assert.ok(b.get('worker-expiry-status').textContent.includes('1 expired'));
});
test('Owner expiry untrusted or missing data is HOLD with no mutations',async()=>{
  for(const report of [null,{...good,read_only:false},
    {...good,automatic_reassignment_allowed:true},
    {...good,master_live:false},{...good,truncated:true}]){
    const b=browser({report});await b.connect();
    assert.equal(b.get('worker-expiry-quarantine').disabled,true);
    assert.equal(b.posts.length,0);
  }
});
test('lost Owner quarantine reply reuses original exact request ID and payload',async()=>{
  const b=browser({lostFirst:true});await b.connect();
  b.get('worker-expiry-ticket').value='ticket_expired_worker';
  b.get('worker-expiry-reason').value='Reviewed old worker and preserve remote Git evidence';
  await b.get('worker-expiry-quarantine').onclick();
  assert.equal(b.posts.length,1);
  assert.match(b.get('worker-expiry-action-status').textContent,/HOLD/);
  await b.get('worker-expiry-quarantine').onclick();
  assert.equal(b.posts.length,2);
  assert.equal(JSON.stringify(b.posts[0]),JSON.stringify(b.posts[1]));
  assert.equal(b.posts[0].payload.expected_master_epoch,7);
  assert.ok(b.get('worker-expiry-action-status').textContent.includes('receipt verified'));
  assert.ok(b.posts.every(x=>x.command==='QUARANTINE_EXPIRED_WORKER'));
});
