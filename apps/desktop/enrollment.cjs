/**
 * Owner enrollment grant never crosses Electron main -> agent child IPC.
 * Only the trusted Electron main process sends it to the HTTPS Central API.
 * No redirect forwarding, credential logging, or silent identity reset.
 */
'use strict';
const {URL}=require('node:url');
function fail(code){throw Error(code);}
function checkOrigin(value){
  if(typeof value!=='string')fail('ENROLL_CENTRAL_URL_INVALID');
  let x;try{x=new URL(value);}catch{fail('ENROLL_CENTRAL_URL_INVALID');}
  if(x.protocol!=='https:'||!x.hostname||x.username||x.password||x.search||x.hash||
    x.pathname!=='/'||(x.port&&x.port!=='443'))
    fail('ENROLL_CENTRAL_URL_INVALID');
  return x.origin;
}
function checkPublicNode(node){
  if(!node||typeof node!=='object'||
    !/^node_[0-9a-f]{32}$/.test(node.node_id)||
    typeof node.public_key_pem!=='string'||!node.public_key_pem.includes('PUBLIC KEY'))
    fail('ENROLL_PUBLIC_NODE_INVALID');
}
async function enrollWithOwnerGrant({origin,grant,displayName,node,signer,fetcher=fetch}={}){
  const trusted=checkOrigin(origin);
  checkPublicNode(node);
  if(typeof grant!=='string'||grant.length<32||grant.length>256||
    /[\s\r\n]/.test(grant))fail('ENROLL_OWNER_GRANT_MISSING_OR_INVALID');
  if(typeof displayName!=='string'||displayName.trim().length<2||
    displayName.length>150)fail('ENROLL_DEVICE_NAME_INVALID');
  if(!signer||typeof signer.sign!=='function')fail('ENROLL_SIGNING_UNAVAILABLE');
  const proof=signer.sign({kind:'enroll'}).proof;
  const body=JSON.stringify({node_id:node.node_id,public_key_pem:node.public_key_pem,
    display_name:displayName.trim(),proof});
  async function call(method,uri,headers,payload){
    let r;
    try{
      r=await fetcher(trusted+uri,{method,headers,body:payload,redirect:'error',
        signal:AbortSignal.timeout(15000)});
    }catch{fail('ENROLL_CENTRAL_NETWORK_UNAVAILABLE');}
    let answer={};
    try{answer=await r.json();}catch{fail('ENROLL_CENTRAL_INVALID_RESPONSE');}
    return {ok:r.ok,status:r.status,answer};
  }
  const submitted=await call('POST','/v7/nodes/enroll',
    {Authorization:'Bearer '+grant,'Content-Type':'application/json'},body);
  if(submitted.ok){
    if(submitted.answer?.accepted!==true||submitted.answer?.node_id!==node.node_id||
      submitted.answer?.owner_approval_required!==true)
      fail('ENROLL_SERVER_ACK_MISMATCH');
    return {accepted:true,ownerApprovalRequired:true};
  }
  if(submitted.status===409&&submitted.answer?.error_code==='NODE_ID_ALREADY_EXISTS'){
    // A previously submitted node may be reconciled only after Owner approval,
    // by proving possession of its existing OS-vault Ed25519 private key.
    const signed=signer.sign({kind:'node_api',method:'GET',uri:'/v7/nodes/me',body:''});
    const verified=await call('GET','/v7/nodes/me',signed,undefined);
    if(!verified.ok||verified.answer?.node_id!==node.node_id)
      fail('ENROLL_EXISTING_IDENTITY_NOT_APPROVED');
    return {accepted:true,ownerApprovalRequired:false};
  }
  if(submitted.status===401)fail('ENROLL_OWNER_GRANT_REJECTED');
  fail('ENROLL_CENTRAL_REFUSED');
}
module.exports={enrollWithOwnerGrant,checkOrigin};
