/**
 * Owner-triggered GET-only collection of Central signed-heartbeat rows.
 * Fetched JSON is NOT an independently signed Central DB attestation.
 */
'use strict';
const dns=require('node:dns').promises,net=require('node:net'),
  fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseTarget,readJson}=require('./pilot-capture.cjs');
const {publicAddress}=require('./hostinger-staging-preflight.cjs');
const NODE=/^node_[a-f0-9]{32}$/;
async function capture({origin,allowedHostname,nodeId,adminKey,fetcher=fetch,
  resolveHost=host=>dns.lookup(host,{all:true})}={}){
  const url=parseTarget(origin,allowedHostname);
  if(!url||!NODE.test(nodeId||'')||typeof adminKey!=='string'||
     adminKey.length<32||/\s/.test(adminKey))
    throw Error('PILOT_SIGNED_HEARTBEAT_OWNER_SCOPE_UNTRUSTED');
  const answers=await resolveHost(url.hostname);
  if(!Array.isArray(answers)||answers.length<1||answers.length>16||
     answers.some(x=>!x||(x.family!==4&&x.family!==6)||
       net.isIP(x.address)!==x.family||!publicAddress(x.address)))
    throw Error('PILOT_SIGNED_HEARTBEAT_DNS_UNVERIFIED');
  const result=await readJson(fetcher,
    url.origin+'/v7/owner/heartbeat-evidence/'+nodeId,adminKey);
  if(result.schema!==1||
     result.mode!=='OWNER_CENTRAL_ACCEPTED_SIGNED_HEARTBEAT_LOG'||
     result.node_id!==nodeId||!Array.isArray(result.records)||
     result.records.length<4||result.records.length>8||
     result.read_only!==true||result.physical_machine_verified!==false||
     result.production_release_authorized!==false)
    throw Error('PILOT_SIGNED_HEARTBEAT_CENTRAL_RESPONSE_UNTRUSTED');
  return result;
}
function saveReceipt(output,data){
  if(typeof output!=='string'||!path.isAbsolute(output)||output.length>1024)
    throw Error('PILOT_SIGNED_HEARTBEAT_OUTPUT_ABSOLUTE_REQUIRED');
  const dir=fs.lstatSync(path.dirname(output));
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (process.platform!=='win32'&&(dir.mode&0o077)!==0))
    throw Error('PILOT_SIGNED_HEARTBEAT_OUTPUT_DIRECTORY_NOT_PRIVATE');
  const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');
  if(bytes.length>128*1024)
    throw Error('PILOT_SIGNED_HEARTBEAT_OUTPUT_TOO_LARGE');
  const fd=fs.openSync(output,'wx',0o600);
  try{
    let off=0;
    while(off<bytes.length){
      const n=fs.writeSync(fd,bytes,off,bytes.length-off,off);
      if(n<=0)throw Error('PILOT_SIGNED_HEARTBEAT_SHORT_WRITE');
      off+=n;
    }
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
async function main(){
  try{
    const e=process.env;
    const result=await capture({origin:e.SUTRADHAR_CENTRAL_URL,
      allowedHostname:e.SUTRADHAR_PILOT_ALLOWED_HOSTNAME,
      nodeId:e.SUTRADHAR_PILOT_NODE_ID,
      adminKey:e.SUTRADHAR_ADMIN_KEY});
    const digest=saveReceipt(e.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EXPORT_FILE,result);
    console.log(JSON.stringify({saved:true,export_sha256:digest,
      node_id:result.node_id,samples:result.records.length,
      packet_signatures_verified:false,physical_machine_verified:false,
      production_release_authorized:false}));
  }catch{
    console.error('PILOT_SIGNED_HEARTBEAT_CAPTURE_BLOCKED');
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={capture,saveReceipt};
