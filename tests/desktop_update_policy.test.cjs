'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {verifyOffer,cmp}=require('../apps/desktop/update-policy.cjs');
test('versions compare numerically and require stable semantic version',()=>{
  assert.equal(cmp('7.0.10','7.0.9'),1);
  assert.equal(cmp('7.0.0','7.0.0'),0);
  assert.equal(cmp('6.9.9','7.0.0'),-1);
  assert.throws(()=>cmp('7.0.0-alpha.1','7.0.0'));
});
test('Owner-signed update offer rejects forged, expired, wrong protocol and altered artifacts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-update-'));
  try{
    const file=path.join(dir,'SUTRADHAR Desktop.exe'),bytes=crypto.randomBytes(1600);
    fs.writeFileSync(file,bytes);
    const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
    const {publicKey:other}=crypto.generateKeyPairSync('ed25519');
    const pub=publicKey.export({format:'pem',type:'spki'}).toString();
    const now=Date.parse('2026-11-12T12:00:00Z');
    const signed={schema:1,application:'desktop',channel:'stable',type:'update',
      version:'7.1.0',source_sha:'a'.repeat(40),protocol:7,
      filename:path.basename(file),installer_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      installer_bytes:bytes.length,publisher_subject:'CN=SUTRADHAR Verified',
      issued_ms:now-3000,expires_ms:now+180000};
    const wrap=x=>({signed:x,signature_base64:crypto.sign(null,
      Buffer.from(JSON.stringify(x)),privateKey).toString('base64')});
    const check=(env,change={})=>verifyOffer({
      envelope:env,pinnedPublicKeyPem:pub,installerPath:file,
      currentVersion:'7.0.0',protocol:7,publisherSubject:'CN=SUTRADHAR Verified',
      now,rolloutApproved:true,...change});
    const envelope=wrap(signed);
    assert.equal(check(envelope).accepted,true);
    assert.equal(check(envelope,{rolloutApproved:false}).error_code,'OWNER_ROLLOUT_APPROVAL_REQUIRED');
    assert.equal(check(envelope,{pinnedPublicKeyPem:other.export({format:'pem',type:'spki'}).toString()}).accepted,false);
    assert.equal(check({...envelope,signed:{...signed,version:'7.2.0'}}).accepted,false);
    assert.equal(check(wrap({...signed,expires_ms:now-1})).accepted,false);
    assert.equal(check(wrap({...signed,protocol:8})).accepted,false);
    assert.equal(check(wrap({...signed,publisher_subject:'CN=Wrong'})).accepted,false);
    assert.equal(check(wrap({...signed,version:'7.0.0'})).accepted,false);
    assert.equal(check(wrap({...signed,filename:'../SUTRADHAR Desktop.exe'})).accepted,false);
    fs.writeFileSync(file,crypto.randomBytes(1600));
    assert.equal(check(envelope).error_code,'UPDATE_INSTALLER_SHA_MISMATCH');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rollback is separately signed, cannot be forced by normal update offer',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-rollback-'));
  try{
    const file=path.join(dir,'SUTRADHAR Desktop.exe'),bytes=crypto.randomBytes(1100);
    fs.writeFileSync(file,bytes);
    const keys=crypto.generateKeyPairSync('ed25519');
    const now=Date.parse('2026-11-12T12:00:00Z');
    const s={schema:1,application:'desktop',channel:'stable',type:'rollback',
      version:'7.0.0',source_sha:'a'.repeat(40),protocol:7,
      filename:path.basename(file),installer_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      installer_bytes:bytes.length,publisher_subject:'CN=SUTRADHAR Verified',
      issued_ms:now,expires_ms:now+60000,owner_emergency_rollback_approved:true};
    const envelope={signed:s,signature_base64:crypto.sign(null,Buffer.from(JSON.stringify(s)),
      keys.privateKey).toString('base64')};
    const opts={envelope,pinnedPublicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),
      installerPath:file,currentVersion:'7.1.0',protocol:7,publisherSubject:'CN=SUTRADHAR Verified',
      now,rolloutApproved:true,kind:'rollback'};
    assert.equal(verifyOffer(opts).accepted,true);
    assert.equal(verifyOffer({...opts,envelope:{...envelope,
      signed:{...s,owner_emergency_rollback_approved:false}}}).accepted,false);
    assert.equal(verifyOffer({...opts,currentVersion:'6.9.0'}).accepted,false);
    assert.equal(verifyOffer({...opts,kind:'update'}).accepted,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
