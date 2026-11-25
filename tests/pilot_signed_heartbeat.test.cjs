'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
  crypto=require('node:crypto'),fs=require('node:fs'),
  path=require('node:path'),os=require('node:os');
const {audit}=require('../scripts/ops/pilot-signed-heartbeat-audit.cjs');
const {capture,saveReceipt}=require('../scripts/ops/pilot-signed-heartbeat-capture.cjs');
const keys=crypto.generateKeyPairSync('ed25519'),
  pinnedPublicKeyPem=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const node='node_'+'a'.repeat(32),start=Date.parse('2026-11-20T13:30:00Z');
function packet(i,now=start+i*60000){
  const body=Buffer.from(JSON.stringify({boot_id:'boot_'+'b'.repeat(32),
    sequence:i+1,expected_master_epoch:10,agents:[
      {agent_id:'agent_one',sequence:i+1,status:'ONLINE'},
      {agent_id:'agent_two',sequence:i+10,status:'ONLINE'}]}));
  const ts=now-10000,nonce='nonce_'+(i+1).toString(16).padStart(32,'0');
  const signed=[ts,nonce,'POST','/v7/nodes/heartbeat',
    crypto.createHash('sha256').update(body).digest('hex')].join('\n');
  return {event_id:i+1,committed_at_ms:now,payload:{
    schema:1,node_id:node,timestamp_ms:ts,nonce,
    signature_base64:crypto.sign(null,Buffer.from(signed),keys.privateKey).toString('base64'),
    body_base64:body.toString('base64'),accepted_at_ms:now-100}};
}
function fixture(){return {schema:1,mode:'OWNER_CENTRAL_ACCEPTED_SIGNED_HEARTBEAT_LOG',
  node_id:node,read_only:true,physical_machine_verified:false,
  production_release_authorized:false,
  records:[0,1,2,3].map(i=>packet(i))};}
const inspect=(exported=fixture(),override={})=>audit({exported,
  pinnedPublicKeyPem,expectedNodeId:node,now:start+3*60000+10000,...override});
function altered(f){const e=fixture();f(e);return inspect(e);}
function signedMutate(index,cb){
  const e=fixture(),r=e.records[index],p=r.payload;
  const b=JSON.parse(Buffer.from(p.body_base64,'base64').toString());
  cb(b);
  const raw=Buffer.from(JSON.stringify(b));
  p.body_base64=raw.toString('base64');
  const signed=[p.timestamp_ms,p.nonce,'POST','/v7/nodes/heartbeat',
    crypto.createHash('sha256').update(raw).digest('hex')].join('\n');
  p.signature_base64=crypto.sign(null,Buffer.from(signed),keys.privateKey).toString('base64');
  return inspect(e);
}
test('four signed accepted packets pass a limited offline verification, never production proof',()=>{
  const r=inspect();assert.equal(r.accepted,true,JSON.stringify(r));
  assert.equal(r.packet_signatures_verified,true);
  assert.equal(r.central_accepted_event_rows_reviewed,true);
  assert.equal(r.independent_database_attestation_verified,false);
  assert.equal(r.physical_machine_verified,false);
  assert.equal(r.production_release_authorized,false);
});
test('wrong independent public key, tampered body or signature is refused',()=>{
  const other=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
  assert.equal(inspect(fixture(),{pinnedPublicKeyPem:other}).accepted,false);
  assert.equal(altered(x=>{x.records[2].payload.body_base64=packet(1).payload.body_base64;}).accepted,false);
  assert.equal(altered(x=>{x.records[0].payload.signature_base64=packet(1).payload.signature_base64;}).accepted,false);
});
test('nonce replay, wrong event ordering and timestamp rollback are rejected',()=>{
  assert.equal(altered(x=>{x.records[3].payload.nonce=x.records[2].payload.nonce;}).accepted,false);
  assert.equal(altered(x=>{[x.records[1],x.records[2]]=[x.records[2],x.records[1]];}).accepted,false);
  assert.equal(altered(x=>{x.records[2].committed_at_ms=x.records[1].committed_at_ms;}).accepted,false);
});
test('signed skipped node or agent sequence, changed membership and boot fail',()=>{
  for(const change of [
    b=>{b.sequence=50;},
    b=>{b.agents[1].sequence=100;},
    b=>{b.agents[0].agent_id='agent_evil';},
    b=>{b.boot_id='boot_other';},
    b=>{b.agents.push({...b.agents[0]});}
  ])assert.equal(signedMutate(2,change).accepted,false);
});
test('untrusted export flags, stale rows, future request and too few samples fail',()=>{
  for(const change of [
    e=>{e.read_only=false;},
    e=>{e.records=e.records.slice(1);},
    e=>{e.records[0].payload.timestamp_ms+=250000;},
    e=>{e.node_id='node_'+'b'.repeat(32);},
    e=>{e.records[2].payload.node_id='node_'+'b'.repeat(32);},
    e=>{e.records[2].payload.unexpected=true;}
  ])assert.equal(altered(change).accepted,false);
  assert.equal(inspect(fixture(),{now:start+3*60000+24*3600000}).accepted,false);
});
test('Owner read-only capture uses one pinned-hostname DNS-checked authenticated GET',async()=>{
  const calls=[],key='owner-test-only-key'.repeat(3);
  const reply=await capture({origin:'https://stage.example.com',
    allowedHostname:'stage.example.com',nodeId:node,adminKey:key,
    resolveHost:async()=>[{family:4,address:'8.8.8.8'}],
    fetcher:async(url,opts)=>{
      calls.push(new URL(url).pathname);
      assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
      assert.equal(opts.credentials,'omit');
      assert.equal(opts.headers.Authorization,'Bearer '+key);
      return new Response(JSON.stringify(fixture()),{status:200});
    }});
  assert.deepEqual(reply,fixture());
  assert.deepEqual(calls,['/v7/owner/heartbeat-evidence/'+node]);
});
test('capture denies private DNS, wrong hostname, HTTP redirect and invalid response',async()=>{
  const common={origin:'https://stage.example.com',nodeId:node,
    adminKey:'owner-test-only-key'.repeat(3)};
  for(const args of [
    {allowedHostname:'other.example.com',resolveHost:async()=>[{family:4,address:'8.8.8.8'}]},
    {allowedHostname:'stage.example.com',resolveHost:async()=>[{family:4,address:'127.0.0.1'}]},
    {allowedHostname:'stage.example.com',resolveHost:async()=>[{family:4,address:'8.8.8.8'}],
      fetcher:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/'}})}
  ])await assert.rejects(capture({...common,...args}));
});
test('captured file cannot overwrite existing private evidence',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-signed-heartbeat-'));
  try{
    if(process.platform!=='win32')fs.chmodSync(dir,0o700);
    const file=path.join(dir,'proof.json');
    assert.match(saveReceipt(file,fixture()),/^[a-f0-9]{64}$/);
    const bytes=fs.readFileSync(file);
    assert.throws(()=>saveReceipt(file,fixture()),/EEXIST/);
    assert.deepEqual(fs.readFileSync(file),bytes);
    if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o077,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
