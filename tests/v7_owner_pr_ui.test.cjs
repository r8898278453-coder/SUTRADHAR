'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../v7/ui/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../v7/ui/dashboard.js'),'utf8');
const HEAD='b'.repeat(40),TREE='c'.repeat(40),BASE='a'.repeat(40);
function browser(){
  const elements=new Map(),calls=[],posts=[];
  let counter=0,failFirstCreate=true;
  let attempt=[];
  function el(id=''){
    return {id,textContent:'',value:'',checked:false,disabled:false,hidden:false,
      className:'',children:[],listeners:{},onclick:null,
      addEventListener(k,fn){this.listeners[k]=fn;},
      append(...nodes){this.children.push(...nodes);},
      replaceChildren(...nodes){this.children=[...nodes];}};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,el(id));return elements.get(id);};
  const document={getElementById:get,createElement:el,querySelectorAll:()=>[]};
  const data={
    '/v7/cluster':{cluster:{epoch:7,phase:'READY',master_agent_id:'agent_master',
      backup1:'agent_b1',backup2:'agent_b2',paused:0},agents:[]},
    '/v7/projects':[],'/v7/tasks':[],'/v7/audit':[],
    '/v7/owner/maintenance':[],
    '/v7/owner/git-recovery':{epoch:7,phase:'READY',master_live:true,unresolved_jobs:[]},
    '/v7/owner/pr-preflight/ticket_demo':{
      ticket_id:'ticket_demo',project_id:'project_demo',repository:'example/repo',
      branch:'ai/ticket_demo',base_branch:'main',baseline_sha:BASE,
      candidate_head_sha:HEAD,candidate_tree_sha:TREE,
      version:6,ready_for_owner_intent:true,git_published_verified:true,
      creation_enabled:true,master_ready:true,merge_performed:false
    }
  };
  async function fetch(url,options={}){
    calls.push({url,method:options.method||'GET'});
    assert.equal(options.headers?.authorization,'Bearer '+'x'.repeat(40));
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    if(options.method==='POST'){
      const body=JSON.parse(options.body);posts.push({url,body});
      if(url==='/v7/git/pr-draft'){
        assert.equal(body.owner_confirmed_draft_only,true);
        assert.equal(body.expected_remote_head_sha,HEAD);
        assert.equal(body.expected_candidate_tree_sha,TREE);
        if(failFirstCreate){
          failFirstCreate=false;
          attempt=[{ticket_id:'ticket_demo',original_request_id:body.request_id,
            repository:'example/repo',base_branch:'main',
            branch:'ai/ticket_demo',remote_head_sha:HEAD,
            remote_tree_sha:TREE,remote_post_result:'UNKNOWN'}];
          throw Error('GITHUB_PR_REPLY_LOST');
        }
        throw Error('Duplicate PR creation was attempted');
      }
      if(url==='/v7/git/pr-recover-readonly'){
        assert.equal(body.expected_remote_head_sha,HEAD);
        assert.equal(body.owner_confirmed_readonly_proof,true);
        attempt=[];
        return {ok:true,json:async()=>({accepted:true,ticket_id:'ticket_demo',
          head_sha:HEAD,url:'https://github.com/example/repo/pull/77',
          pr_number:77,recovered_readonly:true,second_pr_create_attempt:false,
          merge_performed:false})};
      }
      throw Error('Unexpected POST '+url);
    }
    if(url==='/v7/owner/pr-recovery')
      return {ok:true,json:async()=>({
        manual_owner_reconciliation_required:true,
        automatic_recreate_allowed:false,attempts:attempt})};
    if(!(url in data))throw Error('Unexpected read '+url);
    return {ok:true,json:async()=>data[url]};
  }
  const sandbox={document,fetch,confirm:()=>true,
    crypto:{randomUUID:()=>('00000000-0000-4000-8000-'
      +String(++counter).padStart(12,'0'))},
    setInterval:()=>1,clearInterval:()=>{},console,Date,Number,
    Math,String,Array,Boolean,Promise,Error};
  vm.runInNewContext(js,sandbox,{filename:'dashboard.js'});
  async function connect(){
    get('key').value='x'.repeat(40);await get('connect').onclick();
    assert.equal(get('connection').textContent,'Authenticated · live');
  }
  return {get,calls,posts,connect,
    async refresh(){await get('refresh').onclick();}};
}
test('Owner PR dashboard has guarded exact-SHA consent and read-only recovery controls',()=>{
  for(const id of ['pr-preflight','pr-expected-head','pr-confirm-head',
    'pr-owner-note','pr-consent','draft-pr','pr-status','pr-recovery-jobs',
    'pr-recovery-ticket','pr-recovery-expected-head','pr-recovery-confirm-head',
    'pr-recovery-reason','pr-recovery-consent','pr-recovery-verify'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/id="draft-pr"[^>]*disabled/);
  assert.match(html,/id="pr-recovery-verify"[^>]*disabled/);
  assert.doesNotMatch(js,/(?:localStorage|sessionStorage)\.(?:setItem|getItem)|\.innerHTML\s*=|document\.cookie/);
});
test('Owner must preflight, retype exact SHA, explain review and consent to one PR write',async()=>{
  const b=browser();await b.connect();
  const get=b.get;
  get('git-ticket-id').value='ticket_demo';
  await get('pr-preflight').onclick();
  assert.equal(get('pr-expected-head').value,HEAD);
  assert.equal(get('draft-pr').disabled,true);
  get('pr-confirm-head').value='f'.repeat(40);
  get('pr-confirm-head').listeners.input();
  get('pr-owner-note').value='Owner individually reviewed exact tested candidate';
  get('pr-owner-note').listeners.input();
  get('pr-consent').checked=true;
  get('pr-consent').listeners.change();
  assert.equal(get('draft-pr').disabled,true);
  get('pr-confirm-head').value=HEAD;
  get('pr-confirm-head').listeners.input();
  assert.equal(get('draft-pr').disabled,false);
});
test('lost GitHub PR create response permanently disables second Create and exposes read-only recovery',async()=>{
  const b=browser();await b.connect();const get=b.get;
  get('git-ticket-id').value='ticket_demo';
  await get('pr-preflight').onclick();
  get('pr-confirm-head').value=HEAD;
  get('pr-owner-note').value='Owner reviewed QA candidate and permits draft creation';
  get('pr-consent').checked=true;
  get('pr-confirm-head').listeners.input();
  get('pr-owner-note').listeners.input();
  get('pr-consent').listeners.change();
  assert.equal(get('draft-pr').disabled,false);
  await get('draft-pr').onclick();
  assert.equal(get('draft-pr').disabled,true);
  assert.match(get('pr-status').textContent,/DO NOT retry Create/);
  assert.equal(b.posts.filter(p=>p.url==='/v7/git/pr-draft').length,1);
  await b.refresh();
  const job=get('pr-recovery-jobs').children[0];
  assert.ok(job);
  job.children.at(-1).children[0].listeners.click();
  get('pr-recovery-confirm-head').value=HEAD;
  get('pr-recovery-reason').value='Owner checked exact existing GitHub draft independently';
  get('pr-recovery-consent').checked=true;
  get('pr-recovery-confirm-head').listeners.input();
  get('pr-recovery-reason').listeners.input();
  get('pr-recovery-consent').listeners.change();
  assert.equal(get('pr-recovery-verify').disabled,false);
  await get('pr-recovery-verify').onclick();
  assert.equal(b.posts.filter(p=>p.url==='/v7/git/pr-draft').length,1);
  assert.equal(b.posts.filter(p=>p.url==='/v7/git/pr-recover-readonly').length,1);
  assert.match(get('pr-recovery-status').textContent,/No new PR created/);
});
