'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {enrollWithOwnerGrant}=require('../apps/desktop/enrollment.cjs');
const kp=crypto.generateKeyPairSync('ed25519');
const node={node_id:'node_'+'a'.repeat(32),public_key_pem:kp.publicKey.export({format:'pem',type:'spki'}).toString()};
const grant='test-grant-'+('x'.repeat(36));
const calls=[];
const signer={sign:request=>{
  if(request.kind==='enroll')return {proof:crypto.sign(null,
    Buffer.from('enroll:'+node.node_id),kp.privateKey).toString('base64')};
  if(request.kind==='node_api')return {'x-sutradhar-node':node.node_id};
  throw Error('invalid signing request');
}};
const response=(status,body)=>({ok:status>=200&&status<300,status,
  json:async()=>body});
const args={origin:'https://stage.example.com',grant,node,signer,displayName:'Office PC 01'};
test('Owner grant is sent by Electron parent over HTTPS and never returned to child',async()=>{
  calls.length=0;
  const result=await enrollWithOwnerGrant({...args,fetcher:async(url,opts)=>{
    calls.push({url,opts});
    return response(200,{accepted:true,node_id:node.node_id,owner_approval_required:true});
  }});
  assert.deepEqual(result,{accepted:true,ownerApprovalRequired:true});
  assert.equal(JSON.stringify(result).includes(grant),false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://stage.example.com/v7/nodes/enroll');
  assert.equal(calls[0].opts.redirect,'error');
  assert.equal(calls[0].opts.headers.Authorization,'Bearer '+grant);
  const requestBody=JSON.parse(calls[0].opts.body);
  assert.equal(requestBody.node_id,node.node_id);
  assert.equal(crypto.verify(null,Buffer.from('enroll:'+node.node_id),
    kp.publicKey,Buffer.from(requestBody.proof,'base64')),true);
  assert.equal(calls[0].opts.body.includes(grant),false);
});
test('Previously enrolled node may be reconciled only after signed Owner approval',async()=>{
  const seen=[];
  const approved=await enrollWithOwnerGrant({...args,fetcher:async(url,opts)=>{
    seen.push({url,opts});
    if(url.endsWith('/nodes/enroll'))return response(409,{error_code:'NODE_ID_ALREADY_EXISTS'});
    return response(200,{node_id:node.node_id});
  }});
  assert.deepEqual(approved,{accepted:true,ownerApprovalRequired:false});
  assert.equal(seen.length,2);
  assert.equal(seen[1].opts.method,'GET');
  assert.equal(seen[1].opts.headers['x-sutradhar-node'],node.node_id);
  await assert.rejects(enrollWithOwnerGrant({...args,fetcher:async url=>{
    if(url.endsWith('/nodes/enroll'))return response(409,{error_code:'NODE_ID_ALREADY_EXISTS'});
    return response(403,{error_code:'NODE_NOT_APPROVED'});
  }}),/ENROLL_EXISTING_IDENTITY_NOT_APPROVED/);
});
test('Redirects, rejected owner grants and mismatched server proof fail closed',async()=>{
  const badHost=['http://stage.example.com','https://evil@stage.example.com',
    'https://stage.example.com/path','https://stage.example.com?token=x'];
  for(const origin of badHost){
    let invoked=false;
    await assert.rejects(enrollWithOwnerGrant({...args,origin,fetcher:async()=>{invoked=true;}}),
      /ENROLL_CENTRAL_URL_INVALID/);
    assert.equal(invoked,false);
  }
  await assert.rejects(enrollWithOwnerGrant({...args,grant:'short'}),/ENROLL_OWNER_GRANT/);
  await assert.rejects(enrollWithOwnerGrant({...args,fetcher:async()=>response(401,{error_code:'ENROLLMENT_NOT_AUTHORIZED'})}),
    /ENROLL_OWNER_GRANT_REJECTED/);
  await assert.rejects(enrollWithOwnerGrant({...args,fetcher:async()=>response(200,{accepted:true,
    node_id:'node_'+('b'.repeat(32)),owner_approval_required:true})}),/ENROLL_SERVER_ACK_MISMATCH/);
  await assert.rejects(enrollWithOwnerGrant({...args,fetcher:async()=>{throw Error('redirect');}}),
    /ENROLL_CENTRAL_NETWORK_UNAVAILABLE/);
});
