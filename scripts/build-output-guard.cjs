'use strict';
// Closed build directory inventories. Never delete or traverse an unexpected
// output; require operator cleanup in an isolated checkout instead.
const fs=require('node:fs'),path=require('node:path');
const inventories=Object.freeze({
  central:Object.freeze(['server.cjs','index.html','dashboard.js','app.css','v7/schema.sql','release-manifest.json']),
  desktop:Object.freeze(['edge-agent.cjs','secure-agent.cjs','edge-worker.cjs','release-manifest.json'])
});
function inspectBuildOutput(dir,app,{complete=false}={}){
  const files=inventories[app];
  if(!files||!path.isAbsolute(dir))throw Error('BUILD_OUTPUT_ARGUMENT_INVALID');
  const expected=new Set(files),dirs=new Set();
  for(const file of files){
    let parent=path.posix.dirname(file);
    while(parent!=='.'){dirs.add(parent);parent=path.posix.dirname(parent);}
  }
  const seen=new Set();
  function fail(rel){throw Error('BUILD_OUTPUT_UNTRUSTED: '+app+'/'+rel);}
  function scan(abs,rel){
    let stat;
    try{stat=fs.lstatSync(abs);}
    catch(e){if(e.code==='ENOENT'&&!complete&&rel==='')return;throw e;}
    if(stat.isSymbolicLink())fail(rel);
    if(stat.isDirectory()){
      if(rel&&!dirs.has(rel))fail(rel);
      for(const entry of fs.readdirSync(abs))
        scan(path.join(abs,entry),rel?rel+'/'+entry:entry);
    }else{
      if(!expected.has(rel)||!stat.isFile()||stat.nlink!==1)fail(rel);
      seen.add(rel);
    }
  }
  scan(dir,'');
  if(complete&&seen.size!==expected.size)throw Error('BUILD_OUTPUT_INCOMPLETE: '+app);
  return {accepted:true,files:[...seen].sort()};
}
module.exports={inspectBuildOutput,inventories};
