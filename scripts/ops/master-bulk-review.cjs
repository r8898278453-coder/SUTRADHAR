'use strict';
// Developer-only bulk advisory planner. Input is a trusted local JSON file
// streamed through stdin; never accept a remote URL or invoke Git/provider.
const fs=require('node:fs');
const {TextDecoder}=require('node:util');
const {analyzeBulkPlanningDraft}=require('../../apps/desktop/worker-claim.cjs');
const MAX=524288;
function parseBulkInput(raw){
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>MAX)throw Error('BULK_INPUT_SIZE');
  let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw Error('BULK_INPUT_INVALID_JSON_OR_ENCODING');}
  if(!data||Array.isArray(data)||Object.keys(data).sort().join('|')!=='schema|tasks'||
    data.schema!=='SUTRADHAR_BULK_DECLARATIONS_V1')throw Error('BULK_INPUT_SCHEMA');
  return analyzeBulkPlanningDraft(data.tasks);
}
function readStdin(){
  if(process.stdin.isTTY||process.argv.length!==2)throw Error('BULK_INPUT_REDIRECT_REQUIRED');
  const chunks=[],buf=Buffer.alloc(16384);let total=0;
  while(true){
    const n=fs.readSync(0,buf,0,buf.length,null);
    if(n===0)break;
    total+=n;if(total>MAX)throw Error('BULK_INPUT_SIZE');
    chunks.push(Buffer.from(buf.subarray(0,n)));
  }
  return Buffer.concat(chunks,total);
}
if(require.main===module){
  try{process.stdout.write(JSON.stringify(parseBulkInput(readStdin()),null,2)+'\n');}
  catch{process.stderr.write('Bulk review refused. Check the local JSON schema, size, declarations and dependencies. No task was admitted or dispatched.\n');process.exitCode=1;}
}
module.exports={parseBulkInput};
