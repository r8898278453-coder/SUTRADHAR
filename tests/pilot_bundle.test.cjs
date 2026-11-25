'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {evaluate,hash,PREFIX,validatePayload}=
  require('../scripts/ops/pilot-evidence-verifier.cjs');
const {evaluatePilot}=require('../scripts/ops/pilot-policy.cjs');
const {signBundle}=require('../scripts/release/sign-physical-pilot-evidence.cjs');
const keys=crypto.generateKeyPairSync('ed25519'),
  pub=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const sha='f'.repeat(40),session='a'.repeat(32),
  origin='https://stage.example.com',
  t0=Date.parse('2026-11-20T10:00:00Z'),t1=t0+120000,
  issued=t1+10000,now=issued+1000;
const nodes=Array.from({length:10},(_,i)=>'node_'+(i+1).toString(16).repeat(32)),
  agents=Array.from({length:10},(_,i)=>'agent_pc_'+(i+1));
function snapshot(count,at,promoted=false){
  const selected=nodes.slice(0,count),names=agents.slice(0,count);
  const cluster={master_agent_id:promoted?names[1]:names[0],
    backup1:promoted?(count>=3?names[2]:null):names[1],
    backup2:promoted?null:count>=3?names[2]:null,
    epoch:promoted?12:11,phase:promoted?'RECOVERING':'READY'};
  const remote={cluster,agents:selected.map((node_id,i)=>({
    node_id,agent_id:names[i],state:'APPROVED',node_state:'APPROVED',
    last_seen:new Date(promoted&&i===0?at-300000:at-30000)
      .toISOString().replace(/Z$/,'')
  }))};
  const checked=evaluatePilot(remote,selected,at,promoted?[selected[0]]:[]);
  assert.equal(checked.accepted,true,JSON.stringify(checked));
  return {...checked,capture_schema:1,capture_mode:'OWNER_READONLY_CENTRAL_PILOT',
    central_origin:origin,source_sha_claim:sha,source_sha_verified:false,
    public_dns_prechecked:true,owner_hostname_pinned:true,
    physical_machine_verified:false,node_key_possession_verified:false,
    production_release_authorized:false,read_only:true};
}
function scenario(count=2,kind='failover'){
  const first=snapshot(count,t0),second=snapshot(count,t1,kind==='failover');
  const beforeBytes=Buffer.from(JSON.stringify(first)),
    afterBytes=Buffer.from(JSON.stringify(second)),
    witnessBytes=Buffer.from('Synthetic CI fixture only. No real physical machines or Owner witnesses exist in this test.');
  const payload={schema:1,session_id:session,source_sha:sha,
    case_type:kind,central_origin:origin,expected_node_ids:nodes.slice(0,count),
    before_sha256:hash(beforeBytes),after_sha256:hash(afterBytes),
    physical_witness_sha256:hash(witnessBytes),
    issued_at_ms:issued,expires_at_ms:issued+3600000,
    owner_review_note:'Owner separately reviewed exact test labels, timestamps and signed file evidence.'};
  const sign=p=>({payload:p,signature_base64:crypto.sign(null,
    Buffer.from(PREFIX+JSON.stringify(p)),keys.privateKey).toString('base64')});
  return {envelope:sign(payload),sign,payload,ownerPublicKeyPem:pub,
    expectedSha:sha,expectedSessionId:session,
    beforeBytes,afterBytes,witnessBytes,now};
}
test('2/3 PC signed failover evidence hashes PASS policy only, never real physical claim',()=>{
  for(const count of [2,3]){
    const r=evaluate(scenario(count));
    assert.equal(r.accepted,true,JSON.stringify(r));
    assert.equal(r.node_count,count);
    assert.equal(r.physical_test_verified,false);
    assert.equal(r.production_release_authorized,false);
    assert.equal(r.owner_signature_verified,true);
  }
});
test('3/8/9/10 PC healthy sticky-Master snapshots match exact epoch and role assignment',()=>{
  for(const count of [3,8,9,10]){
    const r=evaluate(scenario(count,'sticky'));
    assert.equal(r.accepted,true,String(count)+' PCs: '+JSON.stringify(r));
  }
});
test('mutated saved before, after or separate witness files fail SHA checks',()=>{
  const x=scenario();
  for(const key of ['beforeBytes','afterBytes','witnessBytes']){
    const r=evaluate({...x,[key]:Buffer.concat([x[key],Buffer.from('tampered')])});
    assert.equal(r.accepted,false,key);
    assert.equal(r.error_code,'PILOT_SIGNED_EVIDENCE_HASH_MISMATCH');
  }
});
test('exact session/commit and independently pinned Owner public key are mandatory',()=>{
  const x=scenario();
  const other=crypto.generateKeyPairSync('ed25519').publicKey.export({
    type:'spki',format:'pem'}).toString();
  for(const patch of [
    {expectedSessionId:'b'.repeat(32)},
    {expectedSha:'c'.repeat(40)},
    {ownerPublicKeyPem:other},
    {envelope:{...x.envelope,payload:{...x.payload,source_sha:'d'.repeat(40)}}}
  ])assert.equal(evaluate({...x,...patch}).accepted,false);
});
test('even newly Owner-signed forged role, epoch, offline node or time cannot bypass failover policy',()=>{
  const x=scenario(),after=JSON.parse(x.afterBytes),before=JSON.parse(x.beforeBytes);
  for(const patch of [
    {deliberately_offline_node_ids:[nodes[1]]},
    {active_approved_nodes:[nodes[0]]},
    {master_node_id:nodes[0]},
    {master_agent_id:agents[0]},
    {epoch:11},
    {measured_at_utc:before.measured_at_utc},
    {source_sha_claim:'d'.repeat(40)},
    {physical_machine_verified:true}
  ]){
    const altered=Buffer.from(JSON.stringify({...after,...patch}));
    const p={...x.payload,after_sha256:hash(altered)};
    const r=evaluate({...x,afterBytes:altered,envelope:x.sign(p)});
    assert.equal(r.accepted,false,JSON.stringify(patch));
  }
});
test('incorrect signed PC lists, bad Owner rationale, expired or impossible timestamps fail',()=>{
  const x=scenario();
  for(const patch of [
    {expires_at_ms:now-1},{issued_at_ms:now+180000},
    {expected_node_ids:[nodes[0],nodes[0]]},
    {expected_node_ids:[nodes[0],nodes[2]]},
    {session_id:'bad'},{owner_review_note:'no'},
    {source_sha:'bad'},{case_type:'unattended-merge'},
    {central_origin:'http://localhost'}
  ]){
    const p={...x.payload,...patch};
    assert.equal(evaluate({...x,envelope:x.sign(p)}).accepted,false,JSON.stringify(patch));
  }
});
test('2 PC sticky and 8 PC failover are not accepted case matrices',()=>{
  assert.ok(validatePayload({...scenario(2).payload,case_type:'sticky'},now));
  assert.ok(validatePayload({...scenario(8,'sticky').payload,case_type:'failover'},now));
});
test('snapshot replay/incorrect order cannot pass a newly signed later session',()=>{
  const x=scenario(3,'sticky'),after=JSON.parse(x.afterBytes);
  for(const measured_at_utc of [new Date(t0).toISOString(),
    new Date(t1+36*3600000).toISOString()]){
    const altered=Buffer.from(JSON.stringify({...after,measured_at_utc}));
    const p={...x.payload,after_sha256:hash(altered)};
    assert.equal(evaluate({...x,afterBytes:altered,envelope:x.sign(p)}).accepted,false);
  }
});


test('Owner signer hashes exact local evidence, verifies policy before signing and never grants production',()=>{
  const x=scenario(3,'failover');
  const {before_sha256,after_sha256,physical_witness_sha256,
    issued_at_ms,expires_at_ms,...draft}=x.payload;
  const privateKeyPem=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const result=signBundle({draft,beforeBytes:x.beforeBytes,
    afterBytes:x.afterBytes,witnessBytes:x.witnessBytes,
    privateKeyPem,ownerAcknowledged:'yes',now});
  assert.equal(result.physical_test_verified,false);
  assert.equal(result.production_release_authorized,false);
  assert.equal(result.envelope.payload.before_sha256,hash(x.beforeBytes));
  assert.equal(result.envelope.payload.physical_witness_sha256,hash(x.witnessBytes));
  assert.equal(evaluate({...x,envelope:result.envelope,now}).accepted,true);
  assert.throws(()=>signBundle({draft,beforeBytes:x.beforeBytes,
    afterBytes:x.afterBytes,witnessBytes:x.witnessBytes,
    privateKeyPem,ownerAcknowledged:'no',now}),/EXPLICIT_SIGNING/);
  assert.throws(()=>signBundle({draft,beforeBytes:x.beforeBytes,
    afterBytes:Buffer.concat([x.afterBytes,Buffer.from('tampered')]),
    witnessBytes:x.witnessBytes,privateKeyPem,ownerAcknowledged:'yes',now}),
    /POLICY_BLOCKED/);
});


const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {registerBundle}=
  require('../scripts/ops/pilot-session-ledger.cjs');
function withPrivateLedger(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-pilot-ledger-'));
  if(process.platform!=='win32')fs.chmodSync(dir,0o700);
  try{return fn(dir);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('Owner pilot registry verifies exact signed evidence then records session once',()=>withPrivateLedger(dir=>{
  const x=scenario();
  const first=registerBundle({...x,ledgerDir:dir});
  assert.equal(first.accepted,true,JSON.stringify(first));
  assert.equal(first.session_recorded,true);
  assert.equal(first.physical_test_verified,false);
  assert.equal(first.production_release_authorized,false);
  const location=path.join(dir,session+'.json');
  const original=fs.readFileSync(location);
  const saved=JSON.parse(original);
  assert.equal(saved.session_id,session);
  assert.equal(saved.source_sha,sha);
  assert.equal(saved.before_sha256,hash(x.beforeBytes));
  assert.equal(saved.production_release_authorized,false);
  if(process.platform!=='win32')
    assert.equal(fs.statSync(location).mode&0o077,0);
  const retry=registerBundle({...x,ledgerDir:dir});
  assert.equal(retry.accepted,false);
  assert.equal(retry.error_code,'PILOT_SESSION_ALREADY_RECORDED');
  assert.deepEqual(fs.readFileSync(location),original);
}));
test('invalid Owner signature, wrong expected SHA and tampered witness never consume session',()=>withPrivateLedger(dir=>{
  const x=scenario();
  for(const patch of [
    {expectedSha:'b'.repeat(40)},
    {ownerPublicKeyPem:crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()},
    {witnessBytes:Buffer.concat([x.witnessBytes,Buffer.from('tamper')])}
  ]){
    const result=registerBundle({...x,...patch,ledgerDir:dir});
    assert.equal(result.accepted,false);
    assert.equal(result.error_code,'PILOT_SESSION_SIGNED_EVIDENCE_NOT_VERIFIED');
  }
  assert.deepEqual(fs.readdirSync(dir),[]);
}));
test('Owner pilot registry rejects public, symlinked, absent and relative ledger directories',()=>withPrivateLedger(dir=>{
  const x=scenario(),nested=path.join(dir,'new-directory'),
    linked=path.join(dir,'symlink');
  const checks=[registerBundle({...x,ledgerDir:nested}),
    registerBundle({...x,ledgerDir:'relative-folder'})];
  assert.ok(checks.every(r=>!r.accepted));
  if(process.platform!=='win32'){
    fs.symlinkSync(dir,linked,'dir');
    assert.equal(registerBundle({...x,ledgerDir:linked}).accepted,false);
    fs.chmodSync(dir,0o777);
    assert.equal(registerBundle({...x,ledgerDir:dir}).accepted,false);
    fs.chmodSync(dir,0o700);
  }
  assert.equal(fs.existsSync(path.join(dir,session+'.json')),false);
}));
test('partial old ledger record blocks same session without destructive recovery',()=>withPrivateLedger(dir=>{
  const target=path.join(dir,session+'.json');
  fs.writeFileSync(target,'{"partial":', {flag:'wx',mode:0o600});
  const x=scenario();
  const result=registerBundle({...x,ledgerDir:dir});
  assert.equal(result.accepted,false);
  assert.equal(result.error_code,'PILOT_SESSION_ALREADY_RECORDED');
  assert.equal(fs.readFileSync(target,'utf8'),'{"partial":');
}));
