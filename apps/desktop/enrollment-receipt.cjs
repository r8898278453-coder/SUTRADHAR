/**
 * OS-vault identity-bound first-enrollment receipt. Two-phase submission:
 * PREPARED is persisted BEFORE any network request, SUBMITTED only after the
 * expected Central acknowledgement. Neither implies Owner approval.
 *
 * A PREPARED receipt after crash/timeout is intentionally NOT resubmitted
 * automatically; require Owner inspection to avoid duplicate node enrollment.
 * Legacy timestamp-only receipts are not trusted and never silently migrated.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicWrite}=require('./os-vault.cjs');
const {boundedCentralJson}=require('./bounded-central-json.cjs');
const {normalizeCentralUrl}=require('./desktop-config.cjs');
const VERSION=1;
const ID=/^node_[0-9a-f]{32}$/;
const HASH=/^[0-9a-f]{64}$/;
function fail(code){throw Error(code);}
function paths(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))fail('ENROLLMENT_NODE_DIR_INVALID');
  return {receipt:path.join(dir,'enrollment-receipt.json'),
    legacy:path.join(dir,'enrollment_requested')};
}
function binding(node,centralUrl){
  if(!node||typeof node!=='object'||!ID.test(node.node_id)||
    typeof node.public_key_pem!=='string'||!node.public_key_pem.includes('PUBLIC KEY')||
    typeof centralUrl!=='string')fail('ENROLLMENT_IDENTITY_UNAVAILABLE');
  let url;
  try{url=new URL(centralUrl);}catch{fail('ENROLLMENT_ORIGIN_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    url.pathname!=='/'||Boolean(url.port&&url.port!=='443')||
    url.origin!==centralUrl)fail('ENROLLMENT_ORIGIN_INVALID');
  try{
    if(normalizeCentralUrl(centralUrl)!==centralUrl)
      fail('ENROLLMENT_ORIGIN_INVALID');
  }catch{fail('ENROLLMENT_ORIGIN_INVALID');}
  return {node_id:node.node_id,public_key_sha256:
    crypto.createHash('sha256').update(node.public_key_pem).digest('hex'),
    central_origin:centralUrl};
}
function inspect({dir,node,centralUrl}){
  const {receipt,legacy}=paths(dir);
  if(fs.existsSync(legacy))fail('LEGACY_ENROLLMENT_RECEIPT_OWNER_REVIEW_REQUIRED');
  if(!fs.existsSync(receipt))return null;
  // Check the binding before reading attacker-modifiable metadata.
  const expected=binding(node,centralUrl);
  const stat=fs.lstatSync(receipt);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096||stat.size<100)
    fail('ENROLLMENT_RECEIPT_INVALID');
  let saved;
  try{saved=JSON.parse(fs.readFileSync(receipt,'utf8'));}
  catch{fail('ENROLLMENT_RECEIPT_INVALID');}
  if(!saved||typeof saved!=='object'||Object.keys(saved).sort().join('|')!==
     ['central_origin','node_id','prepared_at','public_key_sha256','state','version'].join('|')||
    saved.version!==VERSION||!['PREPARED','SUBMITTED'].includes(saved.state)||
    !ID.test(saved.node_id)||!HASH.test(saved.public_key_sha256)||
    saved.node_id!==expected.node_id||
    saved.public_key_sha256!==expected.public_key_sha256||
    saved.central_origin!==expected.central_origin||
    typeof saved.prepared_at!=='string'||!Number.isFinite(Date.parse(saved.prepared_at)))
    fail('ENROLLMENT_RECEIPT_IDENTITY_ORIGIN_MISMATCH');
  return saved;
}
function prepare({dir,node,centralUrl,at=new Date().toISOString()}){
  const {receipt}=paths(dir);
  const old=inspect({dir,node,centralUrl});
  if(old)fail('ENROLLMENT_ALREADY_PREPARED_OR_SUBMITTED');
  const saved={version:VERSION,state:'PREPARED',...binding(node,centralUrl),prepared_at:at};
  if(!Number.isFinite(Date.parse(at)))fail('ENROLLMENT_PREPARED_AT_INVALID');
  if(fs.existsSync(receipt))fail('ENROLLMENT_RECEIPT_CONFLICT');
  atomicWrite(receipt,JSON.stringify(saved)+'\n');
  return {state:'PREPARED'};
}
function markSubmitted({dir,node,centralUrl}){
  const {receipt}=paths(dir);
  const old=inspect({dir,node,centralUrl});
  if(!old||old.state!=='PREPARED')
    fail('ENROLLMENT_PREPARED_RECEIPT_REQUIRED');
  atomicWrite(receipt,JSON.stringify({...old,state:'SUBMITTED'})+'\n');
  return {state:'SUBMITTED'};
}
function requireSubmitted({dir,node,centralUrl}){
  const status=inspect({dir,node,centralUrl});
  if(status&&status.state==='PREPARED')
    fail('ENROLLMENT_SUBMISSION_UNCERTAIN_OWNER_REVIEW_REQUIRED');
  return Boolean(status&&status.state==='SUBMITTED');
}
/**
 * Explicit Owner-assisted recovery: only GET from already configured Central.
 * A 200 response requires valid Ed25519 signed nodeAuth AND APPROVED node in
 * Central; a pending/unsubmitted node cannot be silently accepted. No grant
 * or registration POST is sent and no key material leaves the main process.
 */
async function reconcilePrepared({dir,node,centralUrl,signer,fetcher=fetch}){
  const previous=inspect({dir,node,centralUrl});
  if(!previous||previous.state!=='PREPARED')
    fail('ENROLLMENT_RECONCILIATION_REQUIRES_PREPARED_RECEIPT');
  if(!signer||typeof signer.sign!=='function')
    fail('ENROLLMENT_SIGNING_UNAVAILABLE');
  const uri='/v7/nodes/me';
  const signed=signer.sign({kind:'node_api',method:'GET',uri,body:''});
  if(!signed||signed['x-sutradhar-node']!==node.node_id||
    typeof signed['x-sutradhar-nonce']!=='string'||
    typeof signed['x-sutradhar-signature']!=='string')
    fail('ENROLLMENT_SIGNED_PROOF_INVALID');
  let response;
  try{
    response=await fetcher(centralUrl+uri,{
      method:'GET',headers:{...signed,Accept:'application/json'},
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(15000)
    });
  }catch{fail('ENROLLMENT_RECONCILIATION_NETWORK_UNAVAILABLE');}
  if(!response?.ok)
    fail('ENROLLMENT_NOT_YET_OWNER_APPROVED');
  let answer;
  try{answer=await boundedCentralJson(response);}
  catch(error){
    if(error?.message==='CENTRAL_JSON_TOO_LARGE')
      fail('ENROLLMENT_RECONCILIATION_RESPONSE_TOO_LARGE');
    fail('ENROLLMENT_RECONCILIATION_RESPONSE_INVALID');
  }
  if(answer?.node_id!==node.node_id)
    fail('ENROLLMENT_RECONCILIATION_NODE_MISMATCH');
  markSubmitted({dir,node,centralUrl});
  return {accepted:true,ownerApprovalVerified:true};
}

module.exports={inspect,prepare,markSubmitted,requireSubmitted,reconcilePrepared};
