'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),
  os=require('node:os'),path=require('node:path');
const {createProof,verifyContinuity,writeExclusive,fingerprint}=
  require('../apps/desktop/pilot-node-continuity.cjs');
const SHA='a'.repeat(40),SESSION='b'.repeat(32),
  NODE='node_'+'c'.repeat(32),OTHER='node_'+'d'.repeat(32),
  ORIGIN='https://stage.example.com';
const now=Date.parse('2026-11-20T13:30:00Z');
const kp=crypto.generateKeyPairSync('ed25519'),
  pub=kp.publicKey.export({type:'spki',format:'pem'}).toString(),
  priv=kp.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const challenge=()=>({
  schema:1,session_id:SESSION,source_sha:SHA,central_origin:ORIGIN,
  expected_node_ids:[NODE,OTHER],
  issued_at_ms:now-120000,expires_at_ms:now+3600000
});
const identity=(boot='boot_'+'1'.repeat(32),seq=10)=>({
  node_id:NODE,public_key_pem:pub,private_key_pem:priv,
  boot_id:boot,node_sequence:seq,
  agents:[{id:'agent_one',sequence:seq},{id:'agent_two',sequence:seq+1}]
});
function pair(){
  const c=challenge();
  const before=createProof({node:identity(),challenge:c,
    phase:'BEFORE',centralOrigin:ORIGIN,now:now-30000});
  const after=createProof({node:identity('boot_'+'2'.repeat(32),11),
    challenge:c,phase:'AFTER',centralOrigin:ORIGIN,now:now+30000});
  const expected={challenge:c,before,after,expectedNodeId:NODE,
    expectedPublicKeyPem:pub,expectedSha:SHA,
    expectedSessionId:SESSION,now:now+60000};
  return expected;
}
test('device proves matching Ed25519 key possession and monotonic reboot-era counters only',()=>{
  const evidence=pair();
  const result=verifyContinuity(evidence);
  assert.equal(result.accepted,true,JSON.stringify(result));
  assert.equal(result.same_public_key_signature_verified,true);
  assert.equal(result.key_possession_at_observation_verified,true);
  assert.equal(result.software_boot_id_changed,true);
  assert.equal(result.physical_reboot_verified,false);
  assert.equal(result.os_vault_backend_verified,false);
  assert.equal(result.central_approval_verified,false);
  assert.equal(result.production_release_authorized,false);
  assert.equal(result.node_key_sha256,fingerprint(pub));
  const bytes=JSON.stringify(evidence.before);
  assert.equal(bytes.includes('PRIVATE KEY'),false);
  assert.equal(bytes.includes(priv),false);
});
test('changed key, wrong signed phase, changed central or Git SHA fail',()=>{
  const e=pair();
  const other=crypto.generateKeyPairSync('ed25519');
  const wrong=other.publicKey.export({type:'spki',format:'pem'}).toString();
  for(const patch of [
    {expectedPublicKeyPem:wrong},
    {expectedNodeId:OTHER},
    {expectedSha:'f'.repeat(40)},
    {expectedSessionId:'e'.repeat(32)},
    {challenge:{...e.challenge,central_origin:'https://stage.other.com'}},
    {before:e.after,after:e.before}
  ])assert.equal(verifyContinuity({...e,...patch}).accepted,false);
});
test('same software boot id or lower node/agent counters fail despite valid signatures',()=>{
  const e=pair();
  const examples=[
    identity('boot_'+'1'.repeat(32),11),
    identity('boot_'+'2'.repeat(32),9),
    {...identity('boot_'+'2'.repeat(32),11),
      agents:[{id:'agent_one',sequence:9},{id:'agent_two',sequence:12}]},
    {...identity('boot_'+'2'.repeat(32),11),
      agents:[{id:'agent_other',sequence:11},{id:'agent_two',sequence:12}]}
  ];
  for(const node of examples){
    const altered=createProof({node,challenge:e.challenge,phase:'AFTER',
      centralOrigin:ORIGIN,now:now+30000});
    assert.equal(verifyContinuity({...e,after:altered}).accepted,false);
  }
});
test('replaying signed BEFORE or changing time cannot pass AFTER proof',()=>{
  const e=pair();
  assert.equal(verifyContinuity({...e,after:e.before}).accepted,false);
  const altered=createProof({node:identity('boot_'+'2'.repeat(32),11),
    challenge:e.challenge,phase:'AFTER',centralOrigin:ORIGIN,now:now-40000});
  assert.equal(verifyContinuity({...e,after:altered}).accepted,false);
});
test('malformed challenge, unexpected identity, expired session and wrong keypair never produce proof',()=>{
  const c=challenge(),n=identity();
  const bad=[
    {challenge:{...c,expected_node_ids:[OTHER]}},
    {challenge:{...c,expires_at_ms:now-1}},
    {challenge:{...c,source_sha:'x'}},
    {challenge:{...c,session_id:'short'}},
    {challenge:{...c,central_origin:'http://localhost'}},
    {centralOrigin:'https://production.example.com'},
    {node:{...n,node_id:OTHER,boot_id:'broken'}},
    {node:{...n,private_key_pem:crypto.generateKeyPairSync('ed25519')
      .privateKey.export({type:'pkcs8',format:'pem'}).toString()}},
    {node:{...n,agents:[{id:'agent_one',sequence:-1}]}},
    {node:{...n,node_sequence:-1}}
  ];
  const base={node:n,challenge:c,phase:'BEFORE',centralOrigin:ORIGIN,now};
  for(const patch of bad)assert.throws(()=>createProof({...base,...patch}),undefined,
    JSON.stringify(Object.keys(patch)));
});
test('tampering signed agent IDs and counters is rejected cryptographically',()=>{
  const e=pair();
  const altered=JSON.parse(JSON.stringify(e.after));
  altered.payload.agent_counters[0].sequence+=1;
  assert.equal(verifyContinuity({...e,after:altered}).accepted,false);
  const substituted=JSON.parse(JSON.stringify(e.after));
  substituted.payload.node_id=OTHER;
  assert.equal(verifyContinuity({...e,after:substituted}).accepted,false);
});
test('one-time protected export never overwrites or exports private PEM',()=>{
  const e=pair(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-pilot-proof-'));
  const file=path.join(dir,'before.json');
  try{
    const receipt=writeExclusive(file,e.before);
    assert.equal(receipt.saved,true);
    assert.equal(receipt.key_exported,false);
    assert.equal(receipt.production_release_authorized,false);
    const content=fs.readFileSync(file,'utf8');
    assert.equal(content.includes('PRIVATE KEY'),false);
    assert.equal(verifyContinuity({...e,before:JSON.parse(content)}).accepted,true);
    assert.throws(()=>writeExclusive(file,e.before),/OUTPUT_UNSAFE/);
    const link=path.join(dir,'link.json');
    fs.symlinkSync(file,link);
    assert.throws(()=>writeExclusive(link,e.before),/OUTPUT_UNSAFE/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Desktop export action is packaged-Windows-only main IPC with no private key through preload',()=>{
  const base=path.join(__dirname,'../apps/desktop');
  const main=fs.readFileSync(path.join(base,'main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(base,'preload.cjs'),'utf8');
  const ui=fs.readFileSync(path.join(base,'setup.html'),'utf8');
  assert.match(main,/sutradhar:exportPilotNodeProof/);
  assert.match(main,/process\.platform!=='win32'\|\|!app\.isPackaged/);
  assert.match(main,/requireSubmitted/);
  assert.match(main,/createPilotNodeProof/);
  assert.match(main,/writePilotNodeProof/);
  assert.match(preload,/exportPilotNodeProof:\(\)=>ipcRenderer\.invoke/);
  assert.doesNotMatch(preload,/private_key_pem/);
  assert.match(ui,/id="exportPilotNodeProof"/);
  const packageConfig=JSON.parse(fs.readFileSync(
    path.join(base,'package.json'),'utf8'));
  assert.ok(packageConfig.build.files.includes('pilot-node-continuity.cjs'),
    'Production and unsigned QA Electron package MUST contain this imported module');
});
