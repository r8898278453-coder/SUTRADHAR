/**
 * Manual, read-only, authenticated physical-PC pilot observer.
 * Does not simulate PC attendance or force master failover.
 * Save before and after JSON receipts outside Git, compare offline.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluatePilot,compareFailover}=require('./pilot-policy.cjs');
const mode=process.argv[2]||'snapshot';
const ids=(process.env.SUTRADHAR_PILOT_NODE_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
if(ids.length<2||ids.length>10||new Set(ids).size!==ids.length)
  throw Error('Provide 2–10 verified distinct physical SUTRADHAR_PILOT_NODE_IDS');
const target=process.env.SUTRADHAR_PILOT_RECEIPT_PATH;
if(!target||!path.isAbsolute(target))throw Error('Provide absolute private SUTRADHAR_PILOT_RECEIPT_PATH');
function output(result){
  if(fs.existsSync(target))throw Error('Refusing to overwrite pilot evidence');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({receipt:target,result:result.accepted?'PASS':'NOT_ACCEPTED',
    failures:result.failures||[],sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}));
}
async function main(){
  if(mode==='compare'){
    const before=process.env.SUTRADHAR_PILOT_BASELINE_RECEIPT_PATH;
    const after=process.env.SUTRADHAR_PILOT_AFTER_RECEIPT_PATH;
    if(!before||!after||!path.isAbsolute(before)||!path.isAbsolute(after))throw Error('Two absolute pilot receipt paths required');
    const a=JSON.parse(fs.readFileSync(before,'utf8'));
    const z=JSON.parse(fs.readFileSync(after,'utf8'));
    const result=compareFailover(a,z);
    output(result);
    if(!result.accepted)process.exitCode=1;
    return;
  }
  if(mode!=='snapshot')throw Error('Usage: snapshot|compare');
  const url=(process.env.SUTRADHAR_CENTRAL_URL||'').replace(/\/+$/,'');
  const key=process.env.SUTRADHAR_ADMIN_KEY||'';
  if(!/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(url)||key.length<32)
    throw Error('Production HTTPS Central URL and Owner API key required');
  const get=async uri=>{
    const r=await fetch(url+uri,{headers:{Authorization:'Bearer '+key,
      Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('CENTRAL_READ_FAILED_HTTP_'+r.status);
    return r.json();
  };
  const health=await get('/v7/health');
  if(health.ready!==true||health.authority!=='mysql'||health.api_protocol!==7)
    throw Error('CENTRAL_NOT_READY_OR_WRONG_PROTOCOL');
  const cluster=await get('/v7/cluster');
  const offline=(process.env.SUTRADHAR_PILOT_INTENTIONALLY_OFFLINE_NODE_IDS||'')
    .split(',').map(x=>x.trim()).filter(Boolean);
  if(offline.some(x=>!ids.includes(x)))throw Error('OFFLINE_NODE_NOT_IN_PILOT');
  const result=evaluatePilot(cluster,ids,Date.now(),offline);
  output(result);
  if(!result.accepted)process.exitCode=1;
}
main().catch(e=>{console.error(String(e.message||'PILOT_CHECK_FAILED'));process.exitCode=1;});
