'use strict';
// Shared syntactic parser, with the trusted TypeScript runtime supplied by the
// developer CLI or the packaged Desktop. Never resolve modules from a project.
const path=require('node:path');
const {TextDecoder}=require('node:util');
const LIMITS=Object.freeze({files:12,blob:16384,tree:1048576,references:128,edges:40});
const fail=code=>{throw Error(code);};
const safePath=p=>typeof p==='string'&&p.length<=450&&!/[\r\n]/.test(p)&&/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(p)&&
  p.split('/').every(s=>s!=='.'&&s!=='..'&&!s.endsWith('.')&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
const source=p=>/\.(?:[cm]?[jt]s|tsx|jsx)$/i.test(p);
const sha=s=>typeof s==='string'&&s.length===40&&/^[0-9a-f]{40}$/.test(s);
const order=(a,b)=>a<b?-1:a>b?1:0;
function parseReferences(ts,file,raw){
  if(!ts||typeof ts.createSourceFile!=='function')fail('AST_RUNTIME_UNAVAILABLE');
  if(!safePath(file)||!source(file)||!Buffer.isBuffer(raw)||raw.length>LIMITS.blob)fail('AST_SOURCE_INVALID');
  let code;try{code=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{fail('AST_SOURCE_ENCODING');}
  const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,false);
  if(ast.parseDiagnostics.length)return {status:'PARSE_ERROR',references:[],unknown:0};
  const refs=new Set();let unknown=0,count=0,overflow=false;
  function add(node){
    if(++count>LIMITS.references){overflow=true;return;}
    if(!node||!ts.isStringLiteralLike(node)){unknown++;return;}
    const s=node.text;
    if(/[\r\n]/.test(s)||!/^(?:\.\/|\.\.\/)[A-Za-z0-9_@./-]+$/.test(s)||s.length>450){unknown++;return;}
    refs.add(s);
  }
  // Iterative traversal avoids our own recursive visitor on nested input.
  const stack=[ast];
  while(stack.length&&!overflow){
    const n=stack.pop();
    if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)){
      if(n.moduleSpecifier)add(n.moduleSpecifier);
    }else if(ts.isImportEqualsDeclaration(n)&&ts.isExternalModuleReference(n.moduleReference)){
      add(n.moduleReference.expression);
    }else if(ts.isImportTypeNode(n)){
      add(ts.isLiteralTypeNode(n.argument)?n.argument.literal:null);
    }else if(ts.isCallExpression(n)){
      if(n.expression.kind===ts.SyntaxKind.ImportKeyword||
         (ts.isIdentifier(n.expression)&&n.expression.text==='require')){
        add(n.arguments.length===1?n.arguments[0]:null);
      }
    }
    ts.forEachChild(n,c=>{stack.push(c);});
  }
  return {status:overflow?'REFERENCE_LIMIT':'PARSED',references:overflow?[]:[...refs].sort(order),unknown};
}
function resolveReference(file,spec,inventory){
  if(!safePath(file)||!source(file)||typeof spec!=='string'||spec.length>450||/[\r\n]/.test(spec)||
     !/^(?:\.\/|\.\.\/)[A-Za-z0-9_@./-]+$/.test(spec))return {status:'UNSUPPORTED'};
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  if(!safePath(base))return {status:'OUTSIDE_OR_UNSAFE'};
  const ext=['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'];
  const substitutions={'.js':['.ts','.tsx'],'.jsx':['.tsx'],'.mjs':['.mts'],'.cjs':['.cts']};
  const suffix=path.posix.extname(base);
  const candidates=new Set([base,...ext.map(e=>base+e),...ext.map(e=>base+'/index'+e),
    ...(substitutions[suffix]||[]).map(e=>base.slice(0,-suffix.length)+e)]);
  const found=[...candidates].filter(p=>safePath(p)&&source(p)&&inventory.has(p)).sort(order);
  return found.length===1?{status:'RESOLVED',target:found[0]}:{status:found.length?'AMBIGUOUS':'MISSING'};
}
module.exports={LIMITS,safePath,source,parseReferences,resolveReference};
