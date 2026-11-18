'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../v7/ui/index.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../v7/ui/dashboard.js'),'utf8');
const HEAD='b'.repeat(40);
function browser({rejectFirstPost=false}={}){
  const items=new Map(),calls=[],posts=[];
  let counter=0,fail=rejectFirstPost;
  let queue={epoch:7,phase:'RECOVERING',master_live:true,unresolved_jobs:[{
    ticket_id:'ticket_alpha',git_state:'RUNNING',publication_epoch:6,
    task_status:'RECONCILIATION_REQUIRED',repository:'owner/repo',
    branch_name:'ai/ticket_alpha',candidate_head_sha:HEAD,
    preflight_eligible:true,matching_qa_receipt:true,has_live_worker_lease:false
  }]};
  function element(id=''){
    return {id,textContent:'',value:'',checked:false,disabled:false,hidden:false,
      className:'',children:[],listeners:{},onclick:null,
      addEventListener(name,fn){this.listeners[name]=fn;},
      append(...nodes){this.children.push(...nodes);},
      replaceChildren(...nodes){this.children=[...nodes];}
    };
  }
  const get=id=>{if(!items.has(id))items.set(id,element(id));return items.get(id);};
  const document={
    getElementById:get,
    createElement:element,
    querySelectorAll:()=>[]
  };
  const payload={
    '/v7/cluster':{cluster:{epoch:7,phase:'RECOVERING',master_agent_id:'agent_master',
      backup1:'agent_b1',backup2:'agent_b2',paused:0},agents:[]},
    '/v7/projects':[], '/v7/tasks':[], '/v7/audit':[],
    '/v7/owner/maintenance':[]
  };
  async function fetch(url,options={}){
    calls.push({url,options});
    assert.equal(options.headers?.authorization,'Bearer '+ 'x'.repeat(40));
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    if(options.method==='POST'){
      assert.equal(url,'/v7/git/recover-remote-proof');
      const d=JSON.parse(options.body);posts.push(d);
      if(fail){fail=false;throw Error('NETWORK_RESPONSE_LOST');}
      queue={...queue,unresolved_jobs:[]};
      return {ok:true,json:async()=>({accepted:true,ticket_id:d.ticket_id,
        remote_head_sha:HEAD,merge_performed:false,automatic_retry_allowed:false})};
    }
    return {ok:true,json:async()=>url==='/v7/owner/git-recovery'?queue:payload[url]};
  }
  const context={document,fetch,crypto:{randomUUID:()=>('00000000-0000-4000-8000-'+
    String(++counter).padStart(12,'0'))},confirm:()=>true,setInterval:()=>1,
    clearInterval:()=>{},console,Date,Number,Math,String,Array,Boolean,Promise,Error};
  vm.runInNewContext(source,context,{filename:'dashboard.js'});
  async function connect(){
    get('key').value='x'.repeat(40);
    await get('connect').onclick();
    assert.equal(get('connection').textContent,'Authenticated · live');
  }
  function selectFirst(){
    const tr=get('git-recovery-jobs').children[0];
    const review=tr.children[tr.children.length-1].children[0];
    assert.equal(review.disabled,false);
    review.listeners.click();
  }
  function completeReview({head=HEAD,reason='Owner inspected the uncertain publication'}={}){
    get('git-recovery-confirm-sha').value=head;
    get('git-recovery-reason').value=reason;
    get('git-recovery-consent').checked=true;
    get('git-recovery-consent').listeners.change();
  }
  return {get,connect,selectFirst,completeReview,posts,calls,
    setQueue(value){queue=value;}};
}
test('Owner Git recovery HTML uses accessible guarded controls',()=>{
  for(const id of ['git-recovery-jobs','git-recovery-ticket','git-recovery-epoch',
    'git-recovery-expected-head','git-recovery-confirm-sha','git-recovery-reason',
    'git-recovery-consent','git-recovery-verify','git-recovery-clear'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/git-recovery-verify" disabled/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|innerHTML|document\.cookie/);
});
test('dashboard requires exact SHA, reason and explicit Owner consent',async()=>{
  const b=browser();await b.connect();b.selectFirst();
  assert.equal(b.get('git-recovery-ticket').value,'ticket_alpha');
  assert.equal(b.get('git-recovery-verify').disabled,true);
  b.completeReview({head:'a'.repeat(40)});
  assert.equal(b.get('git-recovery-verify').disabled,true);
  b.completeReview({reason:'short'});
  assert.equal(b.get('git-recovery-verify').disabled,true);
  b.completeReview();
  assert.equal(b.get('git-recovery-verify').disabled,false);
  await b.get('git-recovery-verify').onclick();
  assert.equal(b.posts.length,1);
  assert.equal(b.posts[0].ticket_id,'ticket_alpha');
  assert.equal(b.posts[0].expected_master_epoch,7);
  assert.equal(b.posts[0].owner_confirmed_readonly_proof,true);
  assert.equal(b.get('git-recovery-ticket').value,'');
  assert.ok(b.get('git-recovery-status').textContent.includes('NO push or merge'));
});
test('network-ambiguous Owner receipt retries same request ID with no repush',async()=>{
  const b=browser({rejectFirstPost:true});
  await b.connect();b.selectFirst();b.completeReview();
  await b.get('git-recovery-verify').onclick();
  assert.equal(b.posts.length,1);
  assert.equal(b.get('git-recovery-verify').disabled,false);
  assert.ok(b.get('git-recovery-status').textContent.includes('Retry'));
  await b.get('git-recovery-verify').onclick();
  assert.equal(b.posts.length,2);
  assert.deepEqual(b.posts[0],b.posts[1]);
  assert.equal(b.calls.filter(x=>x.options.method==='POST').length,2);
});
test('Central preflight unavailability disables selection and submission',async()=>{
  const b=browser();await b.connect();
  b.setQueue({epoch:7,phase:'READY',master_live:true,unresolved_jobs:[{
    ticket_id:'ticket_alpha',candidate_head_sha:HEAD,preflight_eligible:true
  }]});
  await b.get('refresh').onclick();
  const tr=b.get('git-recovery-jobs').children[0];
  assert.equal(tr.children[tr.children.length-1].children[0].disabled,true);
  assert.equal(b.get('git-recovery-verify').disabled,true);
  assert.equal(b.posts.length,0);
});
