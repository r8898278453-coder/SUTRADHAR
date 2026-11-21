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
    const saved={...pub,node_sequence:1,
      agents:pub.agents.map(a=>({...a,sequence:1}))};
    bridge.saveCounters(saved);
    const body=JSON.stringify({boot_id:saved.boot_id,sequence:1,
      expected_master_epoch:null,
      agents:[{agent_id:'agent_aaa',sequence:1,status:'ONLINE'}]});
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
      agents:[{id:'agent_aaa',sequence:1}]};
    assert.deepEqual(bridge.saveCounters(updated),{stored:true});
    assert.equal(bridge.snapshot().node_sequence,1);
    assert.throws(()=>bridge.saveCounters(updated),/VAULT_IDENTITY_OR_SEQUENCE_MISMATCH/,
      'A second child must not reuse an already-saved heartbeat sequence');
    const sameNodeFromAnotherBridge=createSignerBridge(vault);
    assert.throws(()=>sameNodeFromAnotherBridge.saveCounters(updated),
      /VAULT_IDENTITY_OR_SEQUENCE_MISMATCH/,
      'Concurrent child may not replay the same on-disk counters');
    const nextState={...updated,node_sequence:2,
      agents:[{id:'agent_aaa',sequence:2}]};
    assert.deepEqual(bridge.saveCounters(nextState),{stored:true});
    assert.equal(vault.read().node_sequence,2);
    assert.throws(()=>bridge.saveCounters({...nextState,node_sequence:3}),
      /VAULT_AGENT_REPLAY_OR_IDENTITY_MISMATCH/,
      'Node counter advances cannot leave agent counter unchanged');
    assert.throws(()=>bridge.saveCounters(pub),/MISMATCH/);
    assert.throws(()=>bridge.saveCounters({...updated,private_key_pem:'secret'}),/INVALID/);
    assert.throws(()=>bridge.saveCounters({...updated,node_id:'node_wrong'}),/MISMATCH/);
    assert.throws(()=>bridge.saveCounters({...updated,boot_id:'boot_wrong'}),/MISMATCH/);
    assert.throws(()=>bridge.saveCounters({...updated,agents:[{id:'agent_wrong',sequence:3}]}),/MISMATCH/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('heartbeat signature is bound to fsynced boot and exact saved node/agent sequences',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-hb-bind-'));
  try{
    const vault=createVault({safeStorage:safeStorage(),dir,platform:'win32'});
    const bridge=createSignerBridge(vault);
    const pub=bridge.initialize({agent_ids:['agent_aaa','agent_bbb']});
    const packet=(nodeSeq,seqA,seqB)=>({
      boot_id:pub.boot_id,sequence:nodeSeq,expected_master_epoch:null,
      agents:[{agent_id:'agent_aaa',sequence:seqA,status:'ONLINE'},
        {agent_id:'agent_bbb',sequence:seqB,status:'ONLINE'}]
    });
    const sign=body=>bridge.sign({kind:'node_api',method:'POST',
      uri:'/v7/nodes/heartbeat',body:JSON.stringify(body)});
    assert.throws(()=>sign(packet(1,1,1)),/VAULT_HEARTBEAT_STATE_MISMATCH/,
      'Cannot sign a heartbeat before the counters are durably saved');
    const saved={...pub,node_sequence:1,
      agents:pub.agents.map(x=>({...x,sequence:1}))};
    bridge.saveCounters(saved);
    const genuine=packet(1,1,1);
    const headers=sign(genuine);
    const canonical=[headers['x-sutradhar-timestamp'],headers['x-sutradhar-nonce'],
      'POST','/v7/nodes/heartbeat',
      crypto.createHash('sha256').update(JSON.stringify(genuine)).digest('hex')].join('\n');
    assert.equal(crypto.verify(null,Buffer.from(canonical),
      crypto.createPublicKey(pub.public_key_pem),
      Buffer.from(headers['x-sutradhar-signature'],'base64')),true);
    for(const forged of [
      packet(2,2,2),packet(0,1,1),packet(1,2,1),packet(1,1,2),
      {...genuine,boot_id:'boot_'+'f'.repeat(32)},
      {...genuine,agents:[genuine.agents[1],genuine.agents[0]]},
      {...genuine,agents:[genuine.agents[0]]},
      {...genuine,agents:[{...genuine.agents[0],status:'BUSY'},genuine.agents[1]]},
      {...genuine,expected_master_epoch:1.5},
      {...genuine,unapproved:'operation'},
      {...genuine,agents:[{...genuine.agents[0],extra:'x'},genuine.agents[1]]}
    ])assert.throws(()=>sign(forged),/VAULT_HEARTBEAT_STATE_MISMATCH/);
    assert.throws(()=>bridge.sign({kind:'node_api',method:'POST',
      uri:'/v7/nodes/heartbeat',body:'{invalid'}),/VAULT_HEARTBEAT_STATE_MISMATCH/);
    // Non-heartbeat sign scope remains unchanged.
    assert.ok(bridge.sign({kind:'node_api',method:'GET',uri:'/v7/nodes/me',body:''})['x-sutradhar-signature']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('packaged signer demands exactly one persisted counter step for EVERY local agent',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-exact-step-'));
  try{
    const v=createVault({safeStorage:safeStorage(),dir,platform:'win32'});
    const signer=createSignerBridge(v);
    const initial=signer.initialize({agent_ids:['agent_aaa','agent_bbb']});
    const first={...initial,node_sequence:1,
      agents:initial.agents.map(x=>({...x,sequence:1}))};
    for(const forged of [
      {...first,node_sequence:2},
      {...first,agents:[{...first.agents[0],sequence:2},first.agents[1]]},
      {...first,agents:[first.agents[0],{...first.agents[1],sequence:2}]}
    ])assert.throws(()=>signer.saveCounters(forged),/VAULT_(?:IDENTITY_OR_SEQUENCE_MISMATCH|AGENT_REPLAY_OR_IDENTITY_MISMATCH)/);
    assert.deepEqual(signer.saveCounters(first),{stored:true});
    assert.equal(v.read().node_sequence,1);
    assert.deepEqual(v.read().agents.map(x=>x.sequence),[1,1]);
    assert.throws(()=>signer.saveCounters(first),/VAULT_IDENTITY_OR_SEQUENCE_MISMATCH/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('uncertain encrypted counter write denies every signing capability on the same PC',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-poison-'));
  const original=fs.fsyncSync,storage=safeStorage();
  try{
    const vault=createVault({safeStorage:storage,dir,platform:'win32'});
    const bridge=createSignerBridge(vault);
    const pub=bridge.initialize({agent_ids:['agent_aaa']});
    const next={...pub,node_sequence:pub.node_sequence+1,
      agents:pub.agents.map(x=>({...x,sequence:x.sequence+1}))};
    let flushes=0;
    fs.fsyncSync=function(fd){
      if(++flushes===(process.platform==='win32'?2:3))
        throw Error('TEST_FAIL_VAULT_COUNTER_FSYNC');
      return original(fd);
    };
    try{
      assert.throws(()=>bridge.saveCounters(next),/TEST_FAIL_VAULT_COUNTER_FSYNC/);
    }finally{fs.fsyncSync=original;}
    const code=/OS_VAULT_WRITE_COMMIT_UNCERTAIN_OWNER_REVIEW/;
    assert.throws(()=>bridge.snapshot(),code);
    assert.throws(()=>bridge.initialize({agent_ids:['agent_aaa']}),code);
    assert.throws(()=>bridge.sign({kind:'node_api',method:'GET',
      uri:'/v7/nodes/me',body:''}),code);
    assert.throws(()=>bridge.signWorkerReadOnly({method:'GET',
      uri:'/v7/tasks/available',agent_id:'agent_aaa'}),code);
    assert.throws(()=>bridge.signWorkerAction({operation:'claim',
      agent_id:'agent_aaa',payload:{}}),code);
    assert.throws(()=>bridge.signQaEvidence({agent_id:'agent_aaa'}),code);
    const recreated=createSignerBridge(createVault({safeStorage:storage,dir,platform:'win32'}));
    assert.throws(()=>recreated.snapshot(),
      /OS_VAULT_WRITE_INTENT_OWNER_REVIEW_REQUIRED/);
    assert.equal(fs.existsSync(path.join(dir,'identity.osvault.write-intent')),true);
  }finally{fs.fsyncSync=original;fs.rmSync(dir,{recursive:true,force:true});}
});
