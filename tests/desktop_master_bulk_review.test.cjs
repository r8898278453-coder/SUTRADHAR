'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readBulkManifest,parseManifest,requireBulkLocalBaseline,reviewBulkManifest,selectBulkDraft}=require('../apps/desktop/master-bulk-desktop.cjs');
const baseline='a'.repeat(40);
const observation={project_id:'project_alpha',repository:'owner/repo',base_branch:'main',tracking_ref:'refs/remotes/origin/main',
  baseline_sha:baseline,tree_sha:'b'.repeat(40),local_tracking_ref_verified:true,remote_freshness_verified:false,
  baseline_verified:false,automatic_execution_allowed:false};
const task=(n,patch={})=>{const id='ticket_'+String(n).padStart(3,'0');return {
  ticket_id:id,baseline_sha:baseline,branch_name:'ai/'+id,title:'Task '+n,description:'Synthetic private description '+n,
  risk:'LOW',write_scopes:['src/'+id+'.ts'],acceptance_criteria:['Verify '+id],dependencies:[],contract_keys:[],...patch};};
const tasks=n=>Array.from({length:n},(_,i)=>task(i+1));
const wrap=t=>Buffer.from(JSON.stringify({schema:'SUTRADHAR_BULK_DECLARATIONS_V1',tasks:t}));
const review=raw=>reviewBulkManifest(raw,observation,observation);
const select=(raw,r,groupId='review_001')=>selectBulkDraft(raw,observation,observation,r.file_sha256,r.manifest_sha256,groupId);
const fixture=fn=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-bulk-desktop-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}};
for(const n of [2,3,9,10,11,12,19,20,21,49,50,51,79,80,81,99,100]){
  test('Desktop review partitions and imports local-only group from '+n+' tasks',()=>{
    const t=tasks(n),raw=wrap(t),r=review(raw);
    assert.equal(r.task_count,n);
    assert.equal(r.review_group_count,Math.ceil(n/10));
    assert.equal(r.local_tracking_ref_verified,true);
    assert.equal(r.remote_freshness_verified,false);
    assert.equal(r.automatic_admission_allowed,false);
    assert.equal(r.automatic_execution_allowed,false);
    assert.equal(r.provider_sent,false);
    assert.equal(JSON.stringify(r).includes('Synthetic private description'),false);
    const s=select(raw,r);
    assert.deepEqual(s.tasks,t.slice(0,10));
    assert.equal(s.local_draft_only,true);
    assert.equal(s.central_admission_performed,false);
    assert.equal(s.requires_fresh_central_preview,true);
    assert.equal(s.secret_scan_verified,false);
    assert.equal(s.automatic_execution_allowed,false);
  });
}
for(const n of [11,21,51,81]){
  test('singleton remainder cannot enter multi-task draft '+n,()=>{
    const raw=wrap(tasks(n)),r=review(raw),g=r.review_groups.at(-1);
    assert.deepEqual(g.local_draft_import_blockers,['OUTSIDE_EXISTING_BATCH_LIMITS']);
    assert.throws(()=>select(raw,r,g.group_id),/REQUIRES_SEPARATE_REVIEW/);
  });
}
for(const risk of ['HIGH','CORE']){
  test('protected risk group is visible but cannot import '+risk,()=>{
    const raw=wrap([task(1,{risk}),task(2),task(3)]),r=review(raw);
    const g=r.review_groups.find(x=>x.ticket_ids.includes('ticket_001'));
    assert.equal(g.local_draft_import_allowed,false);
    assert.ok(g.local_draft_import_blockers.includes('ISOLATED_REVIEW_REQUIRED'));
    assert.throws(()=>select(raw,r,g.group_id),/REQUIRES_SEPARATE_REVIEW/);
  });
}
for(const [field,values] of [['write_scopes',[['src/a'],['src/a/b.ts']]],['contract_keys',[['api:shared'],['api:shared.detail']]]]){
  test('unresolved '+field+' conflict blocks both groups',()=>{
    const raw=wrap([task(1,{[field]:values[0]}),task(2,{[field]:values[1]}),task(3),task(4)]),r=review(raw);
    for(const id of ['ticket_001','ticket_002']){
      const g=r.review_groups.find(x=>x.ticket_ids.includes(id));
      assert.ok(g.local_draft_import_blockers.includes('UNRESOLVED_DECLARED_CONFLICT'));
      assert.throws(()=>select(raw,r,g.group_id),/REQUIRES_SEPARATE_REVIEW/);
    }
  });
}
test('unverified external dependency blocks import',()=>{
  const raw=wrap([task(1,{dependencies:['outside_001']}),task(2),task(3)]),r=review(raw);
  const g=r.review_groups.find(x=>x.ticket_ids.includes('ticket_001'));
  assert.ok(g.local_draft_import_blockers.includes('EXTERNAL_DEPENDENCY_UNVERIFIED'));
  assert.throws(()=>select(raw,r,g.group_id),/REQUIRES_SEPARATE_REVIEW/);
});
test('downstream group with two tasks still requires a fresh upstream baseline',()=>{
  const raw=wrap([task(1),task(2),task(3,{dependencies:['ticket_001']}),task(4,{dependencies:['ticket_002']})]),r=review(raw);
  const g=r.review_groups[1];
  assert.equal(g.within_existing_batch_limits,true);
  assert.deepEqual(g.local_draft_import_blockers,['UPSTREAM_BASELINE_REVIEW_REQUIRED']);
  assert.throws(()=>select(raw,r,g.group_id),/REQUIRES_SEPARATE_REVIEW/);
});
for(const [field,value] of Object.entries({project_id:'project_other',repository:'other/repo',base_branch:'develop',
  tracking_ref:'refs/remotes/origin/develop',baseline_sha:'f'.repeat(40),tree_sha:'f'.repeat(40),
  local_tracking_ref_verified:false,remote_freshness_verified:true,baseline_verified:true,automatic_execution_allowed:true})){
  test('changed local observation denied '+field,()=>{
    const raw=wrap(tasks(2)),r=review(raw),fresh={...observation,[field]:value};
    assert.throws(()=>reviewBulkManifest(raw,observation,fresh),/LOCAL_BASELINE_CHANGED/);
    assert.throws(()=>selectBulkDraft(raw,observation,fresh,r.file_sha256,r.manifest_sha256,'review_001'),/LOCAL_BASELINE_CHANGED/);
  });
}
for(const field of ['local_tracking_ref_verified','remote_freshness_verified','baseline_verified','automatic_execution_allowed','baseline_sha']){
  test('even matching observations lacking valid '+field+' are denied',()=>{
    const bad={...observation};delete bad[field];
    assert.throws(()=>requireBulkLocalBaseline({baseline_sha:baseline},bad,bad),/LOCAL_BASELINE_CHANGED/);
  });
}
test('manifest baseline differs from local tracking ref',()=>{
  const raw=wrap(tasks(2).map(t=>({...t,baseline_sha:'d'.repeat(40)})));
  assert.throws(()=>review(raw),/LOCAL_BASELINE_CHANGED/);
});
test('raw file formatting change invalidates a selected review even with same canonical digest',()=>{
  const raw=wrap(tasks(2)),r=review(raw);
  const changed=Buffer.from(JSON.stringify(JSON.parse(raw),null,2));
  assert.equal(review(changed).manifest_sha256,r.manifest_sha256);
  assert.throws(()=>select(changed,r),/FILE_OR_MANIFEST_CHANGED/);
});
test('any changed declaration invalidates an earlier review',()=>{
  const raw=wrap(tasks(12)),r=review(raw);
  const t=tasks(12);t[11].title='changed';
  assert.throws(()=>select(wrap(t),r),/FILE_OR_MANIFEST_CHANGED/);
});
for(const bad of [null,'','a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'a'.repeat(63)+'\n']){
  test('invalid exact file and manifest digests '+JSON.stringify(bad),()=>{
    const raw=wrap(tasks(2)),r=review(raw);
    assert.throws(()=>selectBulkDraft(raw,observation,observation,bad,r.manifest_sha256,'review_001'),/SELECTION_INVALID/);
    assert.throws(()=>selectBulkDraft(raw,observation,observation,r.file_sha256,bad,'review_001'),/SELECTION_INVALID/);
  });
}
for(const [label,raw,pattern] of [
  ['empty',Buffer.alloc(0),/SIZE/],
  ['over limit',Buffer.alloc(524289),/SIZE/],
  ['non-buffer','{}',/SIZE/],
  ['malformed UTF8',Buffer.from([0xc3,0x28]),/ENCODING/],
  ['malformed JSON',Buffer.from('{'),/ENCODING/],
  ['null',Buffer.from('null'),/SCHEMA/],
  ['array',Buffer.from('[]'),/SCHEMA/],
  ['wrong schema',Buffer.from(JSON.stringify({schema:'other',tasks:tasks(2)})),/SCHEMA/],
  ['authority injection',Buffer.from(JSON.stringify({schema:'SUTRADHAR_BULK_DECLARATIONS_V1',tasks:tasks(2),admit:true})),/SCHEMA/],
  ['too many tasks',wrap(tasks(101)),/DRAFT_INVALID/]
]){
  test('invalid bulk input '+label,()=>assert.throws(()=>parseManifest(raw),pattern));
}
test('real local file read returns exact bytes and remains read-only',()=>fixture(dir=>{
  const file=path.join(dir,'backlog.json'),raw=wrap(tasks(50));fs.writeFileSync(file,raw);
  const first=readBulkManifest(file);assert.deepEqual(first,raw);
  assert.equal(review(first).task_count,50);assert.deepEqual(fs.readFileSync(file),raw);
}));
for(const kind of ['empty','oversized','directory','missing','relative']){
  test('native selected file denies '+kind,()=>fixture(dir=>{
    let file=path.join(dir,'input.json');
    if(kind==='empty')fs.writeFileSync(file,'');
    if(kind==='oversized')fs.writeFileSync(file,Buffer.alloc(524289));
    if(kind==='directory')fs.mkdirSync(file);
    if(kind==='relative')file='input.json';
    assert.throws(()=>readBulkManifest(file),/BULK_FILE_/);
  }));
}
test('native reader refuses symbolic links',{skip:process.platform==='win32'},()=>fixture(dir=>{
  const file=path.join(dir,'input.json'),alias=path.join(dir,'alias.json');
  fs.writeFileSync(file,wrap(tasks(2)));fs.symlinkSync(file,alias);
  assert.throws(()=>readBulkManifest(alias),/FILE_UNSAFE/);
}));
test('short descriptor read fails and closes descriptor',()=>fixture(dir=>{
  const file=path.join(dir,'input.json');fs.writeFileSync(file,wrap(tasks(2)));
  let closed=0;
  const io={...fs,readSync:()=>0,closeSync:fd=>{closed++;fs.closeSync(fd);}};
  assert.throws(()=>readBulkManifest(file,{io}),/SHORT_READ/);assert.equal(closed,1);
}));
test('descriptor identity changes are refused and descriptor closed',()=>fixture(dir=>{
  const file=path.join(dir,'input.json');fs.writeFileSync(file,wrap(tasks(2)));
  let closed=0,reads=0;
  const io={...fs,fstatSync:fd=>{const st=fs.fstatSync(fd);if(++reads===2)st.ino++;return st;},
    closeSync:fd=>{closed++;fs.closeSync(fd);}};
  assert.throws(()=>readBulkManifest(file,{io}),/FILE_CHANGED/);assert.equal(closed,1);
}));
test('Desktop IPC is fixed, signed-project fenced, native-only and included in package',()=>{
  const dir=path.resolve(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(dir,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(dir,'preload.cjs'),'utf8');
  const html=fs.readFileSync(path.join(dir,'setup.html'),'utf8');
  const setup=fs.readFileSync(path.join(dir,'setup.js'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  assert.ok(pkg.build.files.includes('master-bulk-desktop.cjs'));
  assert.match(preload,/inspectMasterBulkManifest:\(agentId,projectId\)=>ipcRenderer.invoke/);
  assert.match(preload,/selectMasterBulkDraft:\(agentId,projectId,fileDigest,manifestDigest,groupId\)=>ipcRenderer.invoke/);
  assert.match(main,/async function bulkBaselineCurrent[\s\S]*?await lookupMasterProject[\s\S]*?inspectMasterBaseline/);
  assert.match(main,/ipcMain.handle\('sutradhar:inspectMasterBulkManifest'[\s\S]*?dialog.showOpenDialog[\s\S]*?readBulkManifest\(file\)/);
  assert.match(main,/ipcMain.handle\('sutradhar:selectMasterBulkDraft'[\s\S]*?masterBulkReview=null[\s\S]*?readBulkManifest\(saved.file\)/);
  assert.match(html,/id="masterBulkReport"[^>]*readonly/);
  assert.match(setup,/get\('masterBulkImport'\).addEventListener[\s\S]*?confirm\([\s\S]*?api.selectMasterBulkDraft[\s\S]*?get\('masterRequest'\).value=''/);
  assert.match(setup,/function invalidateMasterReview[\s\S]*?clearMasterBulkReview\(\)/);
});
