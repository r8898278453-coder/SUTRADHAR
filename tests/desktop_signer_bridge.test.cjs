'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createVault}=require('../apps/desktop/os-vault.cjs');
const {createSignerBridge}=require('../apps/desktop/vault-bridge.cjs');
function safeStorage(){
  const key=crypto.randomBytes(32);
  return {isEncryptionAvailable:()=>true,
    encryptString:s=>{
      const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
      return Buffer.concat([iv,c.update(s,'utf8'),c.final(),c.getAuthTag()]);
    },
    decryptString:x=>{
      const iv=x.subarray(0,12),tag=x.subarray(x.length-16),ct=x.subarray(12,-16);
      const d=crypto.createDecipheriv('aes-256-gcm',key,iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct),d.final()]).toString('utf8');
    }
  };
}
test('signer bridge creates OS-vault identity but reveals public metadata only',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-'));
  try{
    const vault=createVault({safeStorage:safeStorage(),dir,platform:'win32'});
    const signer=createSignerBridge(vault);
    const pub=signer.initialize({agent_ids:['agent_aaa','agent_bbb']});
    assert.match(pub.node_id,/^node_[0-9a-f]{32}$/);
    assert.equal(JSON.stringify(pub).includes('PRIVATE KEY'),false);
    assert.equal(JSON.stringify(signer.snapshot()).includes('PRIVATE KEY'),false);
    const full=vault.read();
    assert.equal(full.node_id,pub.node_id);
    assert.match(full.private_key_pem,/PRIVATE KEY/);
    assert.equal(fs.readFileSync(vault.file,'utf8').includes('PRIVATE KEY'),false);
    const again=signer.initialize({agent_ids:['agent_aaa','agent_bbb']});
    assert.equal(again.node_id,pub.node_id);
    assert.notEqual(again.boot_id,pub.boot_id);
    assert.throws(()=>signer.initialize({agent_ids:['agent_bbb','agent_aaa']}),/REQUIRES_OWNER/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('signer bridge signs only known API methods and node enrollment proof',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-'));
  try{
    const vault=createVault({safeStorage:safeStorage(),dir,platform:'win32'});
    const bridge=createSignerBridge(vault);
    const pub=bridge.initialize({agent_ids:['agent_aaa']});
    const key=crypto.createPublicKey(pub.public_key_pem);
    const proof=bridge.sign({kind:'enroll'}).proof;
    assert.equal(crypto.verify(null,Buffer.from('enroll:'+pub.node_id),key,Buffer.from(proof,'base64')),true);
    const body=JSON.stringify({agents:[]});
    const headers=bridge.sign({kind:'node_api',method:'POST',uri:'/v7/nodes/heartbeat',body});
    const canonical=[headers['x-sutradhar-timestamp'],headers['x-sutradhar-nonce'],
      'POST','/v7/nodes/heartbeat',crypto.createHash('sha256').update(body).digest('hex')].join('\n');
    assert.equal(crypto.verify(null,Buffer.from(canonical),key,
      Buffer.from(headers['x-sutradhar-signature'],'base64')),true);
    assert.equal(JSON.stringify(headers).includes('PRIVATE KEY'),false);
    for(const bad of [
      {kind:'node_api',method:'POST',uri:'/v7/nodes/migrate',body:'{}'},
      {kind:'node_api',method:'GET',uri:'/v7/nodes/me',body:'{}'},
      {kind:'node_api',method:'POST',uri:'/v7/agents/register',body:'bad'},
      {kind:'node_api',method:'POST',uri:'https://attacker.example/v7/nodes/heartbeat',body:'{}'},
      {kind:'enroll',uri:'/v7/nodes/me'}
    ])assert.throws(()=>bridge.sign(bad),/DENIED|INVALID/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('only monotonic counters, exact node and current boot ID may be saved by child',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-'));
  try{
    const vault=createVault({safeStorage:safeStorage(),dir,platform:'win32'});
    const bridge=createSignerBridge(vault);
    const pub=bridge.initialize({agent_ids:['agent_aaa']});
    const updated={...pub,node_sequence:pub.node_sequence+1,
      agents:[{id:'agent_aaa',sequence:2}]};
    assert.deepEqual(bridge.saveCounters(updated),{stored:true});
    assert.equal(bridge.snapshot().node_sequence,1);
    assert.throws(()=>bridge.saveCounters(pub),/MISMATCH/);
    assert.throws(()=>bridge.saveCounters({...updated,private_key_pem:'secret'}),/INVALID/);
    assert.throws(()=>bridge.saveCounters({...updated,node_id:'node_wrong'}),/MISMATCH/);
    assert.throws(()=>bridge.saveCounters({...updated,boot_id:'boot_wrong'}),/MISMATCH/);
    assert.throws(()=>bridge.saveCounters({...updated,agents:[{id:'agent_wrong',sequence:3}]}),/MISMATCH/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
