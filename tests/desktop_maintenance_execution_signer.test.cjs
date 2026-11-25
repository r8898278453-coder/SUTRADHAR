'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const script=path.join(__dirname,'../scripts/release/sign-maintenance-installer-execution.cjs');
const nodeId='node_'+'b'.repeat(32);
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sign-exec-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function vars(dir){
  const key=crypto.generateKeyPairSync('ed25519');
  const pem=key.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const keyFile=path.join(dir,'owner-private.pem');
  fs.writeFileSync(keyFile,pem,{mode:0o600});
  const output=path.join(dir,'one-time.json');
  const env={...process.env,
    SUTRADHAR_OWNER_INSTALL_EXECUTION_APPROVED:'yes',
    SUTRADHAR_INSTALL_NODE_ID:nodeId,
    SUTRADHAR_INSTALL_PLAN_ID:'plan_pilot_123',
    SUTRADHAR_INSTALL_WAVE_ID:'wave_pilot01',
    SUTRADHAR_INSTALL_OFFER_SHA256:'c'.repeat(64),
    SUTRADHAR_INSTALL_EXE_SHA256:'d'.repeat(64),
    SUTRADHAR_INSTALL_KIND:'update',
    SUTRADHAR_INSTALL_TARGET_VERSION:'7.1.0',
    SUTRADHAR_INSTALL_MASTER_EPOCH:'11',
    SUTRADHAR_INSTALL_EXECUTION_SIGNING_KEY_FILE:keyFile,
    SUTRADHAR_INSTALL_EXECUTION_GRANT_OUTPUT:output};
  return {env,output,publicKey:key.publicKey};
}
function sign(env){return cp.spawnSync(process.execPath,[script],
  {encoding:'utf8',env,timeout:10000});}
test('offline Owner execution signer makes independently verifiable 5-minute one-PC grant',()=>fixture(dir=>{
  const {env,output,publicKey}=vars(dir);
  const run=sign(env);
  assert.equal(run.status,0,run.stderr);
  const raw=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(raw.signed.action,'launch_staged_windows_installer');
  assert.equal(raw.signed.node_id,nodeId);
  assert.equal(raw.signed.expires_ms-raw.signed.issued_ms,300000);
  assert.equal(crypto.verify(null,Buffer.from(JSON.stringify(raw.signed)),
    publicKey,Buffer.from(raw.signature_base64,'base64')),true);
  assert.ok(!fs.readFileSync(output,'utf8').includes('PRIVATE KEY'));
  const replay=sign(env);
  assert.notEqual(replay.status,0,'Existing grant must not be overwritten');
}));
test('unsigned approval, malformed node and unapproved rollback refuse signing',()=>fixture(dir=>{
  const {env,output}=vars(dir);
  const invalid=[
    {...env,SUTRADHAR_OWNER_INSTALL_EXECUTION_APPROVED:'no'},
    {...env,SUTRADHAR_INSTALL_NODE_ID:'node_bad'},
    {...env,SUTRADHAR_INSTALL_MASTER_EPOCH:'0'},
    {...env,SUTRADHAR_INSTALL_KIND:'rollback'}
  ];
  for(const c of invalid){
    const result=sign(c);
    assert.notEqual(result.status,0,c.SUTRADHAR_INSTALL_KIND);
    assert.equal(fs.existsSync(output),false);
  }
  const approved={...env,SUTRADHAR_INSTALL_KIND:'rollback',
    SUTRADHAR_OWNER_EMERGENCY_ROLLBACK_APPROVED:'yes'};
  assert.equal(sign(approved).status,0);
}));
