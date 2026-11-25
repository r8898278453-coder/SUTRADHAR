'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../v7/ui/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../v7/ui/dashboard.js'),'utf8');
const central=fs.readFileSync(path.join(__dirname,'../v7/central.ts'),'utf8');
const review='qaev_'+'a'.repeat(64),head='b'.repeat(40),tree='c'.repeat(40);
const pending={
  review_proposal_id:review,ticket_id:'ticket_frozen',
  qa_agent_id:'qa_worker',developer_agent_id:'dev_worker',
  node_id:'node_00000000000000000000000000000002',
  baseline_sha:'a'.repeat(40),candidate_head_sha:head,
  candidate_tree_sha:tree,evidence_sha256:'d'.repeat(64),
  image_sha256:'e'.repeat(64),passed:true,state:'PENDING',owner_review_required:true
};
const frozen={...pending,owner_review_state:'APPROVED',
  task_status:'RECONCILIATION_REQUIRED',owner_restoration_needed:true,
  restore_preflight_verified:false,automatic_qa_receipt_allowed:false,
  git_published_verified:false};
const queue=()=>({reviews:[pending],frozen_recovery_reviews:[frozen],
  epoch:12,phase:'RECOVERING',recovering_master_live:true,read_only:true,
  qa_approved_automatically:false,automatic_restoration_allowed:false,
  integration_performed:false});
function browser({report=queue(),lostFirstPost=false}={}){
  const els=new Map(),posts=[],calls=[];
  function el(id=''){return{id,textContent:'',value:'',checked:false,disabled:false,
    hidden:false,children:[],className:'',listeners:{},onclick:null,
    addEventListener(k,cb){this.listeners[k]=cb;},
    append(...x){this.children.push(...x);},
    replaceChildren(...x){this.children=x;}};}
  function get(id){if(!els.has(id))els.set(id,el(id));return els.get(id);}
  const data={
    '/v7/cluster':{cluster:{master_agent_id:'agent_master',epoch:12,
      phase:'RECOVERING',paused:0,backup1:null,backup2:null},agents:[]},
    '/v7/projects':[],'/v7/tasks':[],'/v7/audit':[],
    '/v7/owner/maintenance':[],
    '/v7/owner/qa-reviews':report
  };
  const fetch=async(url,opts={})=>{
    calls.push({url,method:opts.method||'GET'});
    assert.equal(opts.headers.authorization,'Bearer '+'x'.repeat(40));
    assert.equal(opts.cache,'no-store');assert.equal(opts.credentials,'omit');
    if(opts.method==='POST'){
      assert.equal(url,'/v7/owner/command');
      const req=JSON.parse(opts.body);
      posts.push(req);
      assert.ok(['APPROVE_QA_EVIDENCE','REJECT_QA_EVIDENCE',
        'RESTORE_QA_CANDIDATE'].includes(req.command),
        'Never authorize a QA receipt, Git push, merge or deployment');
      if(lostFirstPost&&posts.length===1)throw Error('OWNER_REPLY_LOST');
      return {ok:true,json:async()=>({accepted:true,receipt_id:req.request_id,
        state:req.command==='RESTORE_QA_CANDIDATE'?
          {ticket_id:'ticket_frozen',status:'SUBMITTED_FOR_REVIEW',epoch:12,
            old_worker_lease_restored:false,qa_receipt_submitted:false,
            git_published:false,automatic_reassignment_allowed:false,
            owner_recovery_ack_sent:false}:
          {review_proposal_id:review,state:req.command==='APPROVE_QA_EVIDENCE'?
            'APPROVED':'DENIED',qa_receipt_submitted:false,
            integration_performed:false}})};
    }
    return{ok:true,json:async()=>data[url]??null};
  };
  const document={getElementById:get,createElement:el,
    querySelectorAll:()=>[]};
  vm.runInNewContext(js,{
    document,fetch,crypto:{randomUUID:()=> 'e'.repeat(32)},
    setInterval:()=>1,clearInterval:()=>{},confirm:()=>true,
    console,Date,Number,Math,String,Array,Boolean,Promise,Error
  },{filename:'dashboard.js'});
  return{get,calls,posts,async connect(){
    get('key').value='x'.repeat(40);
    await get('connect').onclick();
    assert.equal(get('connection').textContent,'Authenticated · live');}};
}
test('Owner QA UI is inert on GET and only displays validated signed proof metadata',async()=>{
  for(const id of ['qa-owner-title','qa-owner-status','qa-owner-pending',
    'qa-review-id','qa-review-note','qa-checked-device',
    'qa-checked-runner','qa-checked-evidence','qa-checked-independent',
    'qa-owner-approve','qa-owner-deny','qa-owner-frozen',
    'qa-restore-id','qa-restore-ticket','qa-restore-head',
    'qa-restore-reason','qa-restore-consent','qa-owner-restore',
    'qa-owner-clear','qa-owner-action-status'])
    assert.match(html,new RegExp('id="'+id+'"'),id);
  const route=central.match(/app\.get\('\/v7\/owner\/qa-reviews',jsonRoute\(async req=>\{([\s\S]*?)\n\}\)\);/);
  assert.ok(route,'Explicit Owner-only QA route');
  assert.match(route[1],/admin\(req\)/);
  assert.match(route[1],/leader\(c,false\)/);
  assert.doesNotMatch(route[1],/UPDATE v7_|DELETE FROM|INSERT INTO|evaluate\(c/);
  assert.doesNotMatch(js,/\.innerHTML\s*=|(?:localStorage|sessionStorage)\.(?:getItem|setItem)/);
  const b=browser();await b.connect();
  assert.equal(b.posts.length,0);
  assert.equal(b.get('qa-owner-approve').disabled,false);
  assert.equal(b.get('qa-owner-restore').disabled,false);
  assert.ok(b.get('qa-owner-status').textContent.includes('Pending 1'));
  assert.ok(b.calls.some(c=>c.url==='/v7/owner/qa-reviews'));
});
test('QA Owner UI rejects invalid/unsupported queue and never guesses release readiness',async()=>{
  for(const report of [null,{...queue(),read_only:false},
    {...queue(),automatic_restoration_allowed:true},
    {...queue(),qa_approved_automatically:true},
    {...queue(),frozen_recovery_reviews:[{...frozen,
      automatic_qa_receipt_allowed:true}]}]){
    const b=browser({report});await b.connect();
    assert.equal(b.get('qa-owner-approve').disabled,true);
    assert.equal(b.get('qa-owner-restore').disabled,true);
    assert.equal(b.posts.length,0);
  }
});
test('QA approval requires all four independent confirmations, not just a PASS report',async()=>{
  const b=browser();await b.connect();
  b.get('qa-review-id').value=review;
  b.get('qa-review-note').value='Verified the actual signed report, runner and independent QA PC';
  await b.get('qa-owner-approve').onclick();
  assert.equal(b.posts.length,0);
  for(const id of ['qa-checked-device','qa-checked-runner',
    'qa-checked-evidence','qa-checked-independent'])b.get(id).checked=true;
  await b.get('qa-owner-approve').onclick();
  assert.equal(b.posts.length,1);
  const q=b.posts[0];
  assert.equal(q.command,'APPROVE_QA_EVIDENCE');
  for(const k of ['device_identity_confirmed','runner_provenance_reviewed',
    'test_evidence_reviewed','independence_verified'])
    assert.equal(q.payload[k],true);
  assert.equal(q.payload.review_proposal_id,review);
});
test('uncertain Owner restoration retains exact original SHA/tree/epoch and request ID',async()=>{
  const b=browser({lostFirstPost:true});await b.connect();
  b.get('qa-restore-id').value=review;
  b.get('qa-restore-ticket').value='ticket_frozen';
  b.get('qa-restore-head').value=head;
  b.get('qa-restore-reason').value='Original independently reviewed candidate is safe to restore for separate QA receipt';
  b.get('qa-restore-consent').checked=true;
  await b.get('qa-owner-restore').onclick();
  assert.equal(b.posts.length,1);
  assert.equal(b.posts[0].payload.candidate_tree_sha,tree);
  assert.equal(b.posts[0].payload.expected_master_epoch,12);
  assert.match(b.get('qa-owner-action-status').textContent,/HOLD/);
  b.get('qa-restore-reason').value='Modified reason must NOT create a new Owner intent';
  await b.get('qa-owner-restore').onclick();
  assert.equal(b.posts.length,1,'Changed recovery intent may not be sent');
  b.get('qa-restore-reason').value=
    'Original independently reviewed candidate is safe to restore for separate QA receipt';
  await b.get('qa-owner-restore').onclick();
  assert.equal(b.posts.length,2);
  assert.equal(JSON.stringify(b.posts[0]),JSON.stringify(b.posts[1]));
  assert.equal(b.posts[0].command,'RESTORE_QA_CANDIDATE');
  assert.match(b.get('qa-owner-action-status').textContent,/returned to SUBMITTED_FOR_REVIEW/);
});
test('QA RESTORE remains blocked without live RECOVERING Master and explicit typed HEAD',async()=>{
  const b=browser({report:{...queue(),recovering_master_live:false}});await b.connect();
  assert.equal(b.get('qa-owner-restore').disabled,true);
  assert.equal(b.posts.length,0);
  const c=browser();await c.connect();
  c.get('qa-restore-id').value=review;
  c.get('qa-restore-ticket').value='ticket_frozen';
  c.get('qa-restore-head').value='f'.repeat(40);
  c.get('qa-restore-reason').value='Original independent evidence review was performed';
  c.get('qa-restore-consent').checked=true;
  await c.get('qa-owner-restore').onclick();
  assert.equal(c.posts.length,0,'Wrong HEAD cannot be submitted by Owner UI');
});
