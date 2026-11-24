'use strict';
// Developer-only bulk advisory planner. Input is a trusted local JSON file
// streamed through stdin; never accept a remote URL or invoke Git/provider.
const fs=require('node:fs');
const {TextDecoder}=require('node:util');
const {analyzeBulkPlanningDraft,extractBulkReviewGroup}=require('../../apps/desktop/worker-claim.cjs');
const MAX=524288;
function parseBulkInput(raw,selection=null){
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>MAX)throw Error('BULK_INPUT_SIZE');
  let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw Error('BULK_INPUT_INVALID_JSON_OR_ENCODING');}
  if(!data||Array.isArray(data)||Object.keys(data).sort().join('|')!=='schema|tasks'||
    data.schema!=='SUTRADHAR_BULK_DECLARATIONS_V1')throw Error('BULK_INPUT_SCHEMA');
  return selection===null?analyzeBulkPlanningDraft(data.tasks):extractBulkReviewGroup(data.tasks,selection.digest,selection.groupId);
}
function readStdin(){
  if(process.stdin.isTTY)throw Error('BULK_INPUT_REDIRECT_REQUIRED');
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
  try{
    const args=process.argv.slice(2);
    if(args.length!==0&&(args.length!==3||args[0]!=='--extract'))throw Error('BULK_CLI_ARGUMENTS');
    const selection=args.length?{digest:args[1],groupId:args[2]}:null;
    process.stdout.write(JSON.stringify(parseBulkInput(readStdin(),selection),null,2)+'\n');
  }
  catch{process.stderr.write('Bulk review refused. Check the local JSON schema, size, declarations and dependencies. No task was admitted or dispatched.\n');process.exitCode=1;}
}
module.exports={parseBulkInput};
