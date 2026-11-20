/**
 * Owner-operated read-only one-time heartbeat sample. Invoke manually
 * four or more times ~60 seconds apart, setting a NEW absolute output
 * path each time. There is NO recurring agent/cron or background work.
 */
'use strict';
const {captureHeartbeat}=require('./pilot-heartbeat-capture.cjs');
const {output}=require('./pilot-readonly.cjs');
async function main(){
  const e=process.env;
  const result=await captureHeartbeat({
    origin:e.SUTRADHAR_CENTRAL_URL||'',
    allowedHostname:e.SUTRADHAR_PILOT_ALLOWED_HOSTNAME||'',
    expectedSha:e.SUTRADHAR_PILOT_SOURCE_SHA||'',
    nodeIds:(e.SUTRADHAR_PILOT_NODE_IDS||'').split(',').map(x=>x.trim()).filter(Boolean),
    adminKey:e.SUTRADHAR_ADMIN_KEY||''
  });
  output(result);
  if(!result.accepted)process.exitCode=1;
}
if(require.main===module)main().catch(()=>{
  console.error('PILOT_HEARTBEAT_READONLY_CAPTURE_FAILED');
  process.exitCode=1;
});
module.exports={main};
