'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../v7/ui/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../v7/ui/dashboard.js'),'utf8');
const central=fs.readFileSync(path.join(__dirname,'../v7/central.ts'),'utf8');
const good={
  schema:1,mode:'OWNER_READ_ONLY_LEADERSHIP_SAFETY',epoch:44,phase:'NO_MASTER',
  paused:false,master_agent_id:null,read_only:true,
  central_state_modified:false,automatic_promotion_allowed:false,
  production_release_authorized:false,
  approved_fresh_eligible_node_count:1,approved_fresh_independent_node_count:0,
  reason_codes:['PREVIOUS_MASTER_IDENTITY_EVIDENCE_MISSING']
};
function browser(report=good){
  const elements=new Map(),calls=[];
  function item(id=''){
    return {id,textContent:'',value:'',checked:false,hidden:false,disabled:false,
      children:[],className:'',listeners:{},
      addEventListener(k,fn){this.listeners[k]=fn;},
      append(...x){this.children.push(...x);},
      replaceChildren(...x){this.children=x;},
      onclick:null};
  }
  const get=id=>{
    if(!elements.has(id))elements.set(id,item(id));
    return elements.get(id);
  };
  const payload={
    '/v7/cluster':{cluster:{master_agent_id:null,epoch:44,phase:'NO_MASTER',
      paused:0,backup1:null,backup2:null},agents:[]},
    '/v7/projects':[],'/v7/tasks':[],'/v7/audit':[],
    '/v7/owner/maintenance':[],'/v7/owner/leadership-safety':report
  };
  const fetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    assert.equal(options.headers.authorization,'Bearer '+'x'.repeat(40));
    assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');
    assert.notEqual(options.method,'POST','Dashboard status may not mutate Central');
    if(url==='/v7/owner/leadership-safety'&&report===null)
      return {ok:false,status:404,json:async()=>({error_code:'UNSUPPORTED'})};
    return {ok:true,json:async()=>payload[url]};
  };
  const document={getElementById:get,createElement:item,querySelectorAll:()=>[]};
  vm.runInNewContext(js,{document,fetch,crypto:{randomUUID:()=> '0'.repeat(32)},
    setInterval:()=>1,clearInterval:()=>{},confirm:()=>false,console,
    Date,Number,Math,String,Array,Boolean,Promise,Error},
    {filename:'dashboard.js'});
  return {get,calls,async connect(){
    get('key').value='x'.repeat(40);
    await get('connect').onclick();
    assert.equal(get('connection').textContent,'Authenticated · live');
  }};
}
test('Owner HTML has accessible, no-consent read-only leadership-safety panel',()=>{
  for(const id of ['leadership-safety-title','leadership-safety-status',
    'leadership-safety-details'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/read-only Owner diagnosis/);
  assert.doesNotMatch(js,/\.innerHTML\s*=|(?:localStorage|sessionStorage)\.(?:getItem|setItem)/);
  const route=central.match(/app\.get\('\/v7\/owner\/leadership-safety',jsonRoute\(async req=>\{([\s\S]*?)\n\}\)\);/);
  assert.ok(route,'Explicit Owner route required');
  assert.match(route[1],/admin\(req\)/);
  assert.match(route[1],/leader\(c,false\)/);
  assert.doesNotMatch(route[1],/evaluate\(c|INSERT INTO|UPDATE v7_cluster|DELETE FROM/);
});
test('NO_MASTER safety hold remains prominent, never auto-elects or posts',async()=>{
  const b=browser();await b.connect();
  assert.ok(b.get('leadership-safety-status').textContent.includes('Review required'));
  assert.ok(b.get('leadership-safety-details').textContent.includes(
    'Previous Master node evidence is missing'));
  assert.ok(b.get('leadership-safety-details').textContent.includes(
    'never a restart, promotion, Git retry or release authorization'));
  assert.equal(b.calls.filter(x=>x.url==='/v7/owner/leadership-safety').length,1);
  assert.equal(b.calls.some(x=>x.method==='POST'),false);
});
test('missing legacy diagnostic and untrusted positive response never become green',async()=>{
  for(const report of [null,{...good,central_state_modified:true},
    {...good,automatic_promotion_allowed:true},
    {...good,production_release_authorized:true},
    {...good,reason_codes:['not_a_code']} ]){
    const b=browser(report);await b.connect();
    assert.ok(b.get('leadership-safety-status').textContent.includes('UNKNOWN'));
    assert.ok(b.get('leadership-safety-details').textContent.includes('Do not infer'));
    assert.equal(b.calls.some(x=>x.method==='POST'),false);
  }
});
