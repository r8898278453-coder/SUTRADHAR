'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {analyzeBulkPlanningDraft,analyzeMasterPlanningDraft}=require('../apps/desktop/worker-claim.cjs');
const {parseBulkInput}=require('../scripts/ops/master-bulk-review.cjs');
const baseline='a'.repeat(40);
const task=(n,patch={})=>{const id='ticket_'+String(n).padStart(3,'0');return {
  ticket_id:id,baseline_sha:baseline,branch_name:'ai/'+id,title:'Task '+n,
  description:'Synthetic private description '+n,risk:'LOW',write_scopes:['src/'+id+'.ts'],
  acceptance_criteria:['Verify '+id],dependencies:[],contract_keys:[],...patch};};
const tasks=n=>Array.from({length:n},(_,i)=>task(i+1));
const wrap=t=>Buffer.from(JSON.stringify({schema:'SUTRADHAR_BULK_DECLARATIONS_V1',tasks:t}));
const groupOf=(r,id)=>r.review_groups.find(g=>g.ticket_ids.includes(id));
for(const n of [2,3,9,10,11,12,19,20,21,29,30,31,40,49,50,51,60,69,70,71,80,89,90,91,99,100]){
  test('independent backlog partition '+n,()=>{
    const t=tasks(n),r=analyzeBulkPlanningDraft(t);
    assert.equal(r.task_count,n);assert.equal(r.review_group_count,Math.ceil(n/10));
    assert.equal(r.declared_dependency_waves.length,1);
    assert.deepEqual(r.review_groups.flatMap(g=>g.ticket_ids),t.map(x=>x.ticket_id));
    assert.ok(r.review_groups.every(g=>g.ticket_ids.length<=10&&g.manifest_bytes<=65536));
    assert.ok(r.review_groups.every(g=>g.automatic_admission_allowed===false&&g.requires_fresh_central_preview===true));
    assert.equal(r.automatic_execution_allowed,false);
    assert.equal(r.remote_freshness_verified,false);
    assert.equal(r.semantic_discovery_verified,false);
    assert.equal(r.worker_availability_verified,false);
    assert.equal(r.provider_sent,false);
    assert.equal(JSON.stringify(r).includes('Synthetic private description'),false);
    assert.deepEqual(analyzeBulkPlanningDraft([...t].reverse()),r);
  });
}
for(const n of [2,3,10,11,50,100]){
  test('declared chain '+n,()=>{
    const t=tasks(n);
    for(let i=1;i<n;i++)t[i].dependencies=[t[i-1].ticket_id];
    const r=analyzeBulkPlanningDraft(t);
    assert.equal(r.review_group_count,n);
    assert.equal(r.declared_dependency_waves.length,n);
    for(let i=0;i<n;i++){
      const g=r.review_groups[i];
      assert.equal(g.wave,i+1);assert.equal(g.single_task_review,true);
      assert.equal(g.within_existing_batch_limits,false);
      assert.deepEqual(g.depends_on_review_groups,i?[r.review_groups[i-1].group_id]:[]);
      assert.equal(g.requires_upstream_baseline_review,i>0);
    }
    assert.equal(r.upstream_changes_in_baseline_verified,false);
  });
}
for(const risk of ['HIGH','CORE']){
  test('protected risk isolated '+risk,()=>{
    const t=tasks(4);t[1].risk=risk;
    const r=analyzeBulkPlanningDraft(t),g=groupOf(r,t[1].ticket_id);
    assert.deepEqual(g.ticket_ids,[t[1].ticket_id]);
    assert.deepEqual(g.isolation_reasons,[{ticket_id:t[1].ticket_id,reason:'PROTECTED_RISK'}]);
  });
}
for(const [a,b] of [['src/a','src/a/b.ts'],['src/a.ts','SRC/A.TS'],['src/a','src/a']]){
  test('path conflict '+a+' '+b,()=>{
    const t=[task(1,{write_scopes:[a]}),task(2,{write_scopes:[b]}),task(3)];
    const r=analyzeBulkPlanningDraft(t);
    assert.notEqual(groupOf(r,t[0].ticket_id).group_id,groupOf(r,t[1].ticket_id).group_id);
    assert.equal(r.cross_group_conflicts.length,1);
    assert.equal(r.cross_group_conflicts[0].path_conflict,true);
    assert.equal(r.cross_group_conflicts[0].requires_review,true);
    assert.equal(r.unresolved_declared_conflict_count,1);
  });
}
for(const ns of ['api','db','interface','event']){
  test('hierarchical contract conflict '+ns,()=>{
    const t=[task(1,{contract_keys:[ns+':shared']}),task(2,{contract_keys:[ns+':shared.detail']})];
    const r=analyzeBulkPlanningDraft(t);
    assert.equal(r.review_group_count,2);assert.equal(r.cross_group_conflicts[0].contract_conflict,true);
  });
}
test('ordered conflict remains visible but does not invent upstream inclusion',()=>{
  const t=[task(1,{write_scopes:['src/a']}),task(2,{write_scopes:['src/a/b.ts'],dependencies:['ticket_001']})];
  const r=analyzeBulkPlanningDraft(t);
  assert.equal(r.cross_group_conflicts[0].requires_review,false);
  assert.deepEqual(r.cross_group_conflicts[0].declared_order,['ticket_001','ticket_002']);
  assert.equal(r.review_groups[1].requires_upstream_baseline_review,true);
});
test('external dependency isolation and explicit unknown',()=>{
  const t=[task(1,{dependencies:['external_001']}),task(2),task(3)];
  const r=analyzeBulkPlanningDraft(t),g=groupOf(r,'ticket_001');
  assert.deepEqual(g.ticket_ids,['ticket_001']);
  assert.deepEqual(g.external_dependencies_unverified,[{ticket_id:'ticket_001',dependency:'external_001'}]);
  assert.deepEqual(g.isolation_reasons,[{ticket_id:'ticket_001',reason:'EXTERNAL_DEPENDENCY_UNVERIFIED'}]);
});
test('fan-in cross-group dependencies are deduplicated',()=>{
  const t=tasks(5);t[4].dependencies=['ticket_001','ticket_002','ticket_003'];
  const r=analyzeBulkPlanningDraft(t);
  assert.deepEqual(groupOf(r,'ticket_005').depends_on_review_groups,[groupOf(r,'ticket_001').group_id]);
});
test('byte limit splits same-wave tasks without truncation',()=>{
  const t=tasks(10).map(x=>({...x,description:'x'.repeat(10000)}));
  const r=analyzeBulkPlanningDraft(t);
  assert.equal(r.review_group_count,2);
  assert.ok(r.review_groups.every(g=>g.manifest_bytes<=65536));
  assert.equal(r.review_groups.flatMap(g=>g.ticket_ids).length,10);
});
test('all 100 overlapping tasks preserve all 4950 conflict pairs',()=>{
  const t=tasks(100).map(x=>({...x,write_scopes:['src/common']}));
  const r=analyzeBulkPlanningDraft(t);
  assert.equal(r.review_group_count,100);
  assert.equal(r.cross_group_conflicts.length,4950);
  assert.equal(r.unresolved_declared_conflict_count,4950);
});
test('declaration digest binds exact contents and canonical field order',()=>{
  const t=tasks(3),r=analyzeBulkPlanningDraft(t);
  assert.match(r.manifest_sha256,/^[a-f0-9]{64}$/);
  assert.equal(analyzeBulkPlanningDraft(t.map(x=>Object.fromEntries(Object.entries(x).reverse()))).manifest_sha256,r.manifest_sha256);
  assert.notEqual(analyzeBulkPlanningDraft([t[0],{...t[1],description:'changed'},t[2]]).manifest_sha256,r.manifest_sha256);
});
const bad=[
  ['one task',()=>tasks(1),/DRAFT_INVALID/],
  ['101 tasks',()=>tasks(101),/DRAFT_INVALID/],
  ['oversize',()=>tasks(100).map(x=>({...x,description:'x'.repeat(10000)})),/DRAFT_INVALID/],
  ['mixed baseline',()=>[task(1),task(2,{baseline_sha:'b'.repeat(40)})],/MIXED_BASELINE/],
  ['case ticket alias',()=>[task(1),task(2,{ticket_id:'TICKET_001'})],/DUPLICATE_ID_OR_BRANCH/],
  ['case branch alias',()=>[task(1),task(2,{branch_name:'ai/TICKET_001'})],/DUPLICATE_ID_OR_BRANCH/],
  ['dependency alias',()=>[task(1),task(2,{dependencies:['TICKET_001']})],/DEPENDENCY_ALIAS/],
  ['external dependency alias',()=>[task(1,{dependencies:['outside_001']}),task(2,{dependencies:['OUTSIDE_001']})],/DEPENDENCY_ALIAS/],
  ['duplicate scope',()=>[task(1,{write_scopes:['src/a','SRC/A']}),task(2)],/DUPLICATE_OR_ALIAS/],
  ['newline scope',()=>[task(1,{write_scopes:['src/a\n']}),task(2)],/DRAFT_INVALID|DUPLICATE_OR_ALIAS/],
  ['duplicate criterion',()=>[task(1,{acceptance_criteria:['a',' a ']}),task(2)],/DUPLICATE_OR_ALIAS/],
  ['duplicate dependency',()=>[task(1,{dependencies:['outside_001','OUTSIDE_001']}),task(2)],/DUPLICATE_OR_ALIAS/],
  ['branch alias lock',()=>[task(1,{branch_name:'ai/task.LOCK'}),task(2)],/DUPLICATE_OR_ALIAS/],
  ['cycle',()=>[task(1,{dependencies:['ticket_002']}),task(2,{dependencies:['ticket_001']})],/DEPENDENCY_CYCLE/],
  ['self dependency',()=>[task(1,{dependencies:['ticket_001']}),task(2)],/DEPENDENCY_CYCLE/],
  ['unexpected authority',()=>[task(1,{approved:true}),task(2)],/DRAFT_INVALID/],
  ['invalid scope',()=>[task(1,{write_scopes:['../outside']}),task(2)],/DRAFT_INVALID/],
  ['blank title',()=>[task(1,{title:' '}),task(2)],/DRAFT_INVALID/],
  ['malformed unicode',()=>[task(1,{description:'\ud800'}),task(2)],/DRAFT_INVALID/]
];
for(const [label,input,pattern] of bad)test('bulk rejects '+label,()=>assert.throws(()=>analyzeBulkPlanningDraft(input()),pattern));
test('existing desktop graph cap remains ten',()=>{
  assert.equal(analyzeMasterPlanningDraft(tasks(10)).task_count,10);
  assert.throws(()=>analyzeMasterPlanningDraft(tasks(11)),/DRAFT_INVALID/);
});
test('CLI input schema and encoding strict',()=>{
  assert.equal(parseBulkInput(wrap(tasks(50))).task_count,50);
  assert.throws(()=>parseBulkInput(Buffer.from([0xc3,0x28])),/ENCODING/);
  assert.throws(()=>parseBulkInput(Buffer.alloc(524289)),/SIZE/);
  assert.throws(()=>parseBulkInput(Buffer.from('{}')),/SCHEMA/);
  assert.throws(()=>parseBulkInput(Buffer.from(JSON.stringify({schema:'SUTRADHAR_BULK_DECLARATIONS_V1',tasks:tasks(2),execute:true}))),/SCHEMA/);
});
test('real CLI produces review only and does not echo bad input',()=>{
  const cli=path.resolve(__dirname,'../scripts/ops/master-bulk-review.cjs');
  const good=spawnSync(process.execPath,[cli],{input:wrap(tasks(100)),encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
  assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).task_count,100);
  const bad=spawnSync(process.execPath,[cli],{input:'SYNTHETIC_PRIVATE_MARKER',encoding:'utf8',timeout:15000});
  assert.equal(bad.status,1);assert.equal(bad.stdout,'');
  assert.equal(bad.stderr.includes('SYNTHETIC_PRIVATE_MARKER'),false);
});
