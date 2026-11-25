'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const ts=require('typescript');
const {inspectMasterBaseline,inspectMasterSourceHints,compareMasterAstHints}=require('../apps/desktop/worker-claim.cjs');
const parser=require('../apps/desktop/master-ast-parser.cjs');
const baseline='a'.repeat(40);
const task=(id,deps=[],sha=baseline)=>({ticket_id:'ticket_'+id,baseline_sha:sha,branch_name:'ai/'+id,title:'Task '+id,
  description:'Implement exact scope',risk:'LOW',write_scopes:['src/'+id+'.ts'],acceptance_criteria:['Verify scoped behavior'],dependencies:deps,contract_keys:[]});
const report=(hints,patch={})=>({inspection_mode:'AST_SYNTAX',baseline_sha:baseline,
  semantic_discovery_verified:false,type_resolution_verified:false,automatic_execution_allowed:false,provider_sent:false,
  source_contents_returned:false,hints,...patch});
const edge=(a,b)=>({kind:'CROSS_TASK_RELATIVE_IMPORT',from_ticket:'ticket_'+a,to_ticket:'ticket_'+b,source_path:'src/'+a+'.ts',target_path:'src/'+b+'.ts'});
for(const [label,tasks,status] of [
  ['direct',[task('a',['ticket_b']),task('b')],'DECLARED_ORDER_PRESENT'],
  ['transitive',[task('a',['ticket_c']),task('b'),task('c',['ticket_b'])],'DECLARED_ORDER_PRESENT'],
  ['reverse',[task('a'),task('b',['ticket_a'])],'REVERSE_DECLARED_ORDER_REVIEW'],
  ['reverse transitive',[task('a'),task('b',['ticket_c']),task('c',['ticket_a'])],'REVERSE_DECLARED_ORDER_REVIEW'],
  ['none',[task('a'),task('b')],'NO_DECLARED_ORDER_REVIEW'],
  ['common ancestor',[task('a',['ticket_c']),task('b',['ticket_c']),task('c')],'NO_DECLARED_ORDER_REVIEW'],
  ['external only',[task('a',['external_one']),task('b')],'NO_DECLARED_ORDER_REVIEW']
]){
  test('source vs declared DAG '+label,()=>{
    const before=JSON.stringify(tasks),r=compareMasterAstHints(tasks,report([edge('a','b')]));
    assert.equal(r.source_order_comparisons[0].status,status);
    assert.equal(r.source_order_review_count,status==='DECLARED_ORDER_PRESENT'?0:1);
    assert.equal(r.declared_edges_changed,false);
    assert.equal(r.automatic_admission_allowed,false);assert.equal(r.automatic_execution_allowed,false);
    assert.equal(r.semantic_discovery_verified,false);assert.equal(JSON.stringify(tasks),before);
  });
}
test('shared dependency is not a task ordering assertion',()=>{
  const h={kind:'SHARED_RELATIVE_IMPORT',ticket_ids:['ticket_a','ticket_b'],target_path:'src/shared.ts'};
  const r=compareMasterAstHints([task('a'),task('b')],report([h]));
  assert.equal(r.shared_dependency_review_count,1);
  assert.equal(r.shared_dependency_reviews[0].status,'SHARED_DEPENDENCY_REVIEW');
  assert.deepEqual(r.source_order_comparisons,[]);
});
test('no hints never asserts independence',()=>{
  const r=compareMasterAstHints([task('a'),task('b')],report([]));
  assert.equal(r.source_order_review_count,0);assert.equal(r.semantic_discovery_verified,false);
  assert.equal(r.automatic_execution_allowed,false);
});
for(const [field,value] of Object.entries({inspection_mode:'LEXICAL_LEGACY',baseline_sha:'b'.repeat(40),semantic_discovery_verified:true,
  type_resolution_verified:true,automatic_execution_allowed:true,provider_sent:true,source_contents_returned:true,hints:[] })){
  if(field==='hints')continue;
  test('AST comparison rejects changed '+field,()=>assert.throws(()=>compareMasterAstHints([task('a'),task('b')],report([],{[field]:value})),/REVIEW_INPUT_INVALID/));
}
for(const bad of [
  {...edge('a','b'),from_ticket:'ticket_unknown'},{...edge('a','b'),to_ticket:'ticket_unknown'},
  edge('a','a'),{...edge('a','b'),source_path:'src/unrelated.ts'},
  {...edge('a','b'),target_path:'src/unrelated.ts'},{...edge('a','b'),target_path:'../bad.ts'},
  {...edge('a','b'),source_path:'src/a.ts\n'},{...edge('a','b'),target_path:'src/b.ts\n'},
  {...edge('a','b'),kind:'INVENTED'},
  {kind:'SHARED_RELATIVE_IMPORT',ticket_ids:['ticket_a'],target_path:'src/shared.ts'},
  {kind:'SHARED_RELATIVE_IMPORT',ticket_ids:['ticket_a','ticket_a'],target_path:'src/shared.ts'},
  {kind:'SHARED_RELATIVE_IMPORT',ticket_ids:['ticket_a','ticket_unknown'],target_path:'src/shared.ts'}
]){
  test('AST comparison rejects malformed hint '+JSON.stringify(bad),()=>assert.throws(()=>compareMasterAstHints([task('a'),task('b')],report([bad])),/REVIEW_HINT_INVALID/));
}
test('comparison limit is 40',()=>assert.throws(()=>compareMasterAstHints([task('a'),task('b')],report(Array(41).fill(edge('a','b')))),/REVIEW_INPUT_INVALID/));
test('comparison rejects declared cycle before reviewing hints',()=>assert.throws(()=>compareMasterAstHints([task('a',['ticket_b']),task('b',['ticket_a'])],report([])),/DEPENDENCY_CYCLE/));
test('shared AST runtime refuses missing parser',()=>assert.throws(()=>parser.parseReferences(null,'src/a.ts',Buffer.from('')),/AST_RUNTIME_UNAVAILABLE/));
const gitAvailable=spawnSync('git',['--version']).status===0;
function repoFixture(files,fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-desktop-ast-'));
  const git=(...a)=>execFileSync('git',['-C',dir,...a],{encoding:'utf8',timeout:10000}).trim();
  try{
    git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','AST test');
    git('remote','add','origin','https://github.com/example/repo.git');
    for(const [name,data] of Object.entries(files)){const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
    git('add','.');git('commit','-qm','AST fixtures');
    const sha=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',sha);
    const project={project_id:'project_aaa',repository:'example/repo',base_branch:'main'};
    const observed=inspectMasterBaseline({repoDir:dir,project});
    return fn({dir,git,sha,args:{repoDir:dir,project,observed,tasks:[task('a',[],sha),task('b',[],sha)],typescriptRuntime:ts}});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
for(const [label,source,expected] of [
  ['import',"import './b';",true],['export',"export * from './b';",true],
  ['type import',"type X=import('./b').X;",true],['import equals',"import b=require('./b');",true],
  ['literal dynamic',"const x=import('./b');",true],['require',"const x=require('./b');",true],
  ['suffix substitution',"import './b.js';",true],['comment',"// import './b';",false],
  ['string decoy',"const x=\"import './b';\";",false],['property call',"obj.require('./b');",false],
  ['nonliteral',"import(name);",false],['syntax error',"import './b'; const =",false]
]){
  test('Desktop immutable AST integration '+label,{skip:!gitAvailable},()=>repoFixture({'src/a.ts':source,'src/b.ts':'export const b=1;'},({args})=>{
    const r=inspectMasterSourceHints(args);
    assert.equal(r.inspection_mode,'AST_SYNTAX');
    assert.equal(r.hints.some(h=>h.kind==='CROSS_TASK_RELATIVE_IMPORT'&&h.from_ticket==='ticket_a'&&h.to_ticket==='ticket_b'),expected);
    assert.equal(r.semantic_discovery_verified,false);assert.equal(r.type_resolution_verified,false);
    assert.equal(r.remote_freshness_verified,false);assert.equal(r.source_contents_returned,false);
    assert.equal(r.provider_sent,false);
    if(label==='syntax error'){assert.equal(r.ast_files.find(f=>f.source_path==='src/a.ts').status,'PARSE_ERROR');assert.equal(r.ast_parse_incomplete,true);}
  }));
}
test('Desktop AST reports unknown, missing and ambiguous separately',{skip:!gitAvailable},()=>repoFixture({
  'src/a.ts':"import './b'; import './missing'; import('external'); require(name);",
  'src/b.ts':'export const x=1;','src/b/index.js':'export const y=1;'
},({args})=>{
  const r=inspectMasterSourceHints(args),a=r.ast_files.find(f=>f.source_path==='src/a.ts');
  assert.deepEqual(a,{source_path:'src/a.ts',status:'PARSED',resolved:0,ambiguous:1,missing:1,unsupported:2});
  assert.equal(r.ast_unknown_reference_count,4);assert.equal(r.hints.length,0);
}));
test('Desktop AST size and encoding failures are explicit',{skip:!gitAvailable},()=>repoFixture({
  'src/a.ts':Buffer.alloc(16385,120),'src/b.ts':Buffer.from([0xc3,0x28])
},({args})=>{
  const r=inspectMasterSourceHints(args);
  assert.deepEqual(r.ast_files.map(f=>f.status),['SIZE_LIMIT','ENCODING_ERROR']);
  assert.equal(r.skipped_file_count,2);assert.equal(r.ast_parse_incomplete,true);
}));
test('Desktop AST does not expose source and ignores dirty working tree',{skip:!gitAvailable},()=>repoFixture({
  'src/a.ts':"import './b'; const SECRET_PRIVATE_FIXTURE='synthetic';",'src/b.ts':'export const b=1;'
},({dir,git,args})=>{
  fs.writeFileSync(path.join(dir,'src/a.ts'),'dirty working tree');
  const before=git('status','--porcelain'),r=inspectMasterSourceHints(args);
  assert.equal(r.hints.length,1);assert.equal(JSON.stringify(r).includes('SECRET_PRIVATE_FIXTURE'),false);
  assert.equal(git('status','--porcelain'),before);
  assert.equal(compareMasterAstHints(args.tasks,r).source_order_review_count,1);
}));
test('Desktop AST refuses changed local ref',{skip:!gitAvailable},()=>repoFixture({
  'src/a.ts':"import './b';",'src/b.ts':'export const b=1;'
},({dir,git,args})=>{
  fs.writeFileSync(path.join(dir,'src/a.ts'),'changed');git('add','.');git('commit','-qm','new');
  git('update-ref','refs/remotes/origin/main',git('rev-parse','HEAD'));
  assert.throws(()=>inspectMasterSourceHints(args),/BASELINE_CHANGED/);
}));
test('Desktop AST reference overflow discards partial edges',{skip:!gitAvailable},()=>repoFixture({
  'src/a.ts':Array(129).fill("import './b';").join('\n'),'src/b.ts':'export const b=1;'
},({args})=>{
  const r=inspectMasterSourceHints(args);
  assert.equal(r.ast_files.find(f=>f.source_path==='src/a.ts').status,'REFERENCE_LIMIT');
  assert.equal(r.ast_parse_incomplete,true);assert.equal(r.hints.length,0);
}));
test('packaged AST uses fixed resource path, read-only IPC and manifest provenance',()=>{
  const root=path.resolve(__dirname,'../apps/desktop'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
  const main=read('main.cjs'),build=read('build.cjs'),pkg=JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('master-ast-parser.cjs'));
  assert.deepEqual(pkg.build.extraResources.slice(1).map(x=>x.to),['master-typescript.cjs','master-typescript-LICENSE.txt','master-typescript-NOTICE.txt']);
  assert.match(main,/require\(path.join\(process.resourcesPath,'master-typescript.cjs'\)\)/);
  assert.match(main,/source_order_review:compareMasterAstHints\(tasks,report\)/);
  assert.match(main,/MASTER_AST_PACKAGED_RUNTIME_UNAVAILABLE/);
  assert.match(build,/DESKTOP_AST_RUNTIME_LOCK_MISMATCH/);
  assert.match(build,/ast_resource_sha256/);
  assert.match(read('setup.js'),/r.inspection_mode!=='AST_SYNTAX'/);
});
