/**
 * Owner-operated manual pilot inspection. This is a GET-only Central
 * snapshot/compare utility; it cannot create nodes, elect Master, power
 * off machines, release maintenance holds, or sign physical evidence.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),
  crypto=require('node:crypto');
const {capture}=require('./pilot-capture.cjs');
const {compareFailover}=require('./pilot-policy.cjs');
const mode=process.argv[2]||'snapshot';
function getIds(key){
  return (process.env[key]||'').split(',').map(x=>x.trim()).filter(Boolean);
}
const target=process.env.SUTRADHAR_PILOT_RECEIPT_PATH;
function readReceipt(file){
  if(typeof file!=='string'||!path.isAbsolute(file))
    throw Error('PILOT_RECEIPT_ABSOLUTE_PATH_REQUIRED');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<20||stat.size>128*1024)
    throw Error('PILOT_RECEIPT_FILE_INVALID');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function output(result){
  if(typeof target!=='string'||!path.isAbsolute(target))
    throw Error('PILOT_OUTPUT_ABSOLUTE_PATH_REQUIRED');
  if(fs.existsSync(target))
    throw Error('PILOT_RECEIPT_WOULD_OVERWRITE');
  const directory=path.dirname(target);
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error('PILOT_OUTPUT_DIRECTORY_UNSAFE');
  const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
  if(bytes.length>128*1024)throw Error('PILOT_RECEIPT_TOO_LARGE');
  const fd=fs.openSync(target,'wx',0o600);
  try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  console.log(JSON.stringify({result:result.accepted?'SNAPSHOT_ACCEPTED':'NOT_ACCEPTED',
    evidence_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    production_release_authorized:false}));
}
async function main(){
  if(mode==='compare'){
    const before=readReceipt(process.env.SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH);
    const after=readReceipt(process.env.SUTRADHAR_PILOT_AFTER_RECEIPT_PATH);
    const checked=compareFailover(before,after);
    output(checked);
    if(!checked.accepted)process.exitCode=1;
    return;
  }
  if(mode!=='snapshot')throw Error('PILOT_USAGE_SNAPSHOT_OR_COMPARE');
  const result=await capture({
    origin:process.env.SUTRADHAR_CENTRAL_URL||'',
    allowedHostname:process.env.SUTRADHAR_PILOT_ALLOWED_HOSTNAME||'',
    expectedSha:process.env.SUTRADHAR_PILOT_SOURCE_SHA||'',
    nodeIds:getIds('SUTRADHAR_PILOT_NODE_IDS'),
    offlineNodes:getIds('SUTRADHAR_PILOT_INTENTIONALLY_OFFLINE_NODE_IDS'),
    adminKey:process.env.SUTRADHAR_ADMIN_KEY||''
  });
  output(result);
  if(!result.accepted)process.exitCode=1;
}
if(require.main===module)main().catch(()=>{
  console.error('PILOT_INSPECTION_FAILED_WITHOUT_REMOTE_MUTATION');
  process.exitCode=1;
});
module.exports={main,readReceipt,output};
