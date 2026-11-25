'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {parseReferences,resolveReference,inspectSnapshot}=require('../scripts/ops/master-ast-hints.cjs');
const parse=(source,file='src/a.ts')=>parseReferences(file,Buffer.from(source));
const forms=[
  s=>"import '"+s+"';",
  s=>"import x from '"+s+"';",
  s=>"import {x as y} from '"+s+"';",
  s=>"import * as x from '"+s+"';",
  s=>"export * from '"+s+"';",
  s=>"export {x} from '"+s+"';",
  s=>"const x = import('"+s+"');",
  s=>"const x = require('"+s+"');",
  s=>"import x = require('"+s+"');",
  s=>"type X = import('"+s+"').X;",
  s=>"import type {X} from '"+s+"';",
  s=>"export type {X} from '"+s+"';"
];
const specifiers=['./b','../b','./b.ts','./b.mts','./nested/index','./with-dash','./with_under','./@scope/b'];
for(let i=0;i<forms.length;i++)for(const spec of specifiers)
  test('AST literal syntax '+i+' '+spec,()=>assert.deepEqual(parse(forms[i](spec)),{status:'PARSED',references:[spec],unknown:0}));
const decoys=[
  "// import './b';","/* require('./b') */", 'const x = "import \'./b\'";',
  "const x = 'require(\"./b\")';", "const x = /require\\('\\.\\/b'\\)/;",
  "const x = {from:'./b'};", "obj.require('./b');","const x = './b';",
  "const x = {import:'./b'};", "export const x = './b';",
  "const x = 1; // export * from './b';","/* import x from './b' */ export {};"
];
for(let i=0;i<decoys.length;i++)
  test('AST decoy '+i,()=>assert.deepEqual(parse(decoys[i]),{status:'PARSED',references:[],unknown:0}));
const unsupported=['pkg','@scope/pkg','https://example.test/b','/absolute','./a?raw','./a#b','./a with space','./a\\n','./a\\r','./a\\t'];
for(const spec of unsupported)test('unsupported specifier '+JSON.stringify(spec),()=>{
  const x=parse("import '"+spec+"';");assert.deepEqual(x,{status:'PARSED',references:[],unknown:1});
});
for(const ext of ['ts','tsx','mts','cts','js','jsx','mjs','cjs']){
  test('extension resolution '+ext,()=>assert.deepEqual(resolveReference('src/a.ts','./b',new Map([['src/b.'+ext,'blob']])),
    {status:'RESOLVED',target:'src/b.'+ext}));
  test('index resolution '+ext,()=>assert.deepEqual(resolveReference('src/a.ts','./b',new Map([['src/b/index.'+ext,'blob']])),
    {status:'RESOLVED',target:'src/b/index.'+ext}));
}
for(const [spec,target] of [['./b.js','src/b.ts'],['./b.jsx','src/b.tsx'],['./b.mjs','src/b.mts'],['./b.cjs','src/b.cts']])
  test('conservative runtime suffix substitution '+spec,()=>assert.deepEqual(resolveReference('src/a.ts',spec,new Map([[target,'blob']])),{status:'RESOLVED',target}));
for(const p of ['../x.ts','/x.ts','src//x.ts','src/../x.ts','src/./x.ts','src/CON.ts','src/NUL.js','src/a.ts\n','src/a.ts\r','src/a.ts ','src\\a.ts','src/a.py'])
  test('deny unsafe source '+JSON.stringify(p),()=>assert.throws(()=>parseReferences(p,Buffer.from('')),/AST_SOURCE_INVALID/));
test('reject invalid UTF8',()=>assert.throws(()=>parseReferences('src/a.ts',Buffer.from([0xc3,0x28])),/AST_SOURCE_ENCODING/));
test('reject oversized blob',()=>assert.throws(()=>parseReferences('src/a.ts',Buffer.alloc(16385)),/AST_SOURCE_INVALID/));
test('syntax errors suppress partial evidence',()=>assert.deepEqual(parse("import './b'; const ="),{status:'PARSE_ERROR',references:[],unknown:0}));
test('computed import and require are unknown',()=>assert.deepEqual(parse('import(name); require(name);'),{status:'PARSED',references:[],unknown:2}));
test('duplicate references deduplicated',()=>assert.deepEqual(parse("import './b'; export * from './b';"),{status:'PARSED',references:['./b'],unknown:0}));
test('reference count limit suppresses partial evidence',()=>assert.equal(parse(Array.from({length:129},(_,i)=>"import './b"+i+"';").join('\n')).status,'REFERENCE_LIMIT'));
test('ambiguous file vs directory never selects one',()=>assert.deepEqual(resolveReference('src/a.ts','./b',new Map([['src/b.ts','x'],['src/b/index.js','y']])),{status:'AMBIGUOUS'}));
test('case mismatch never resolves',()=>assert.deepEqual(resolveReference('src/a.ts','./B',new Map([['src/b.ts','x']])),{status:'MISSING'}));
test('outside root denied',()=>assert.deepEqual(resolveReference('src/a.ts','../../b',new Map()),{status:'OUTSIDE_OR_UNSAFE'}));
test('runtime suffix substitution ambiguity',()=>assert.deepEqual(resolveReference('src/a.ts','./b.js',new Map([['src/b.js','x'],['src/b.ts','y']])),{status:'AMBIGUOUS'}));
test('real Git snapshot ignores dirty worktree and hides source contents',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-ast-'));
  const git=(...a)=>execFileSync('git',['-C',dir,...a],{encoding:'utf8'}).trim();
  try{
    git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','AST test');
    fs.mkdirSync(path.join(dir,'src'));
    fs.writeFileSync(path.join(dir,'src/a.ts'),"import './b'; const secret='SYNTHETIC_PRIVATE_MARKER';");
    fs.writeFileSync(path.join(dir,'src/b.ts'),'export const b=1;');
    fs.writeFileSync(path.join(dir,'src/big.ts'),' '.repeat(16385));
    git('add','.');git('commit','-qm','snapshot');const commit=git('rev-parse','HEAD');
    fs.writeFileSync(path.join(dir,'src/a.ts'),"import './dirty';");
    const before=git('status','--porcelain');
    const x=inspectSnapshot(dir,commit,['src/a.ts','src/big.ts','src/missing.ts']);
    assert.deepEqual(x.edges,[{source_path:'src/a.ts',target_path:'src/b.ts'}]);
    assert.deepEqual(x.files.map(f=>f.status),['PARSED','SIZE_LIMIT','MISSING']);
    assert.equal(x.commit_sha,commit);
    assert.equal(x.tree_sha,git('rev-parse','HEAD^{tree}'));
    assert.equal(x.automatic_execution_allowed,false);
    assert.equal(x.remote_freshness_verified,false);
    assert.equal(x.source_contents_returned,false);
    assert.equal(JSON.stringify(x).includes('SYNTHETIC_PRIVATE_MARKER'),false);
    assert.equal(git('status','--porcelain'),before);
    assert.throws(()=>inspectSnapshot(dir,'HEAD',['src/a.ts']),/AST_REQUEST_INVALID/);
    assert.throws(()=>inspectSnapshot(dir,commit,['src/a.ts','src/A.ts']),/AST_REQUEST_INVALID/);
    assert.throws(()=>inspectSnapshot(path.join(dir,'src'),commit,['src/a.ts']),/AST_REPOSITORY_ROOT_MISMATCH/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
