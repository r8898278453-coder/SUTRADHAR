'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {verifyOffer,cmp,sha256File}=require('../apps/desktop/update-policy.cjs');
test('versions compare numerically and require stable semantic version',()=>{
  assert.equal(cmp('7.0.10','7.0.9'),1);
  assert.equal(cmp('7.0.0','7.0.0'),0);
  assert.equal(cmp('6.9.9','7.0.0'),-1);
  assert.throws(()=>cmp('7.0.0-alpha.1','7.0.0'));
  assert.throws(()=>cmp('999999999999999999.0.0','7.0.0'));
  assert.throws(()=>cmp('1000000.0.0','7.0.0'));
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
    const signed={schema:2,application:'desktop',channel:'stable',type:'update',
      version:'7.1.0',source_sha:'a'.repeat(40),protocol:7,
      filename:path.basename(file),installer_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      installer_bytes:bytes.length,publisher_subject:'CN=SUTRADHAR Verified',
      issued_ms:now-3000,expires_ms:now+180000,
      rollout:{wave_id:'wave_pilot01',node_ids:['node_'+('a'.repeat(32))],
        owner_approved_at_ms:now-3000}};
    const wrap=x=>({signed:x,signature_base64:crypto.sign(null,
      Buffer.from(JSON.stringify(x)),privateKey).toString('base64')});
    const check=(env,change={})=>verifyOffer({
      envelope:env,pinnedPublicKeyPem:pub,installerPath:file,
      currentVersion:'7.0.0',nodeId:'node_'+('a'.repeat(32)),
      protocol:7,publisherSubject:'CN=SUTRADHAR Verified',
      now,rolloutApproved:true,...change});
    const envelope=wrap(signed);
    assert.equal(check(envelope).accepted,true);
    assert.equal(check(envelope).wave_id,'wave_pilot01');
    assert.equal(check({...envelope,signature_base64:
      envelope.signature_base64.slice(0,-2)+'==='.slice(0,3)}).error_code,
      'UPDATE_SIGNATURE_INVALID','malformed padding must never be normalized');
    assert.equal(check({...envelope,extra:true}).error_code,'UPDATE_SIGNATURE_INVALID');
    assert.equal(check(wrap({...signed,automatic_install:true})).error_code,
      'UPDATE_SIGNED_FIELDS_INVALID');
    assert.equal(check(wrap({...signed,owner_emergency_rollback_approved:true})).error_code,
      'UPDATE_SIGNED_FIELDS_INVALID');
    assert.equal(check(envelope,{nodeId:'node_'+('b'.repeat(32))}).error_code,
      'UPDATE_DEVICE_NOT_IN_OWNER_WAVE');
    assert.equal(check(envelope,{nodeId:null}).error_code,
      'UPDATE_LOCAL_IDENTITY_REQUIRED');
    assert.equal(check(wrap({...signed,schema:1})).accepted,false);
    assert.equal(check(wrap({...signed,rollout:undefined})).accepted,false);
    assert.equal(check(wrap({...signed,rollout:{...signed.rollout,
      node_ids:[signed.rollout.node_ids[0],signed.rollout.node_ids[0]]}})).accepted,false);
    assert.equal(check(envelope,{rolloutApproved:false}).error_code,'OWNER_ROLLOUT_APPROVAL_REQUIRED');
    assert.equal(check(envelope,{pinnedPublicKeyPem:other.export({format:'pem',type:'spki'}).toString()}).accepted,false);
    assert.equal(check({...envelope,signed:{...signed,version:'7.2.0'}}).accepted,false);
    assert.equal(check(wrap({...signed,rollout:{...signed.rollout,
      wave_id:'invalid-wave'}})).error_code,'UPDATE_SIGNED_ROLLOUT_INVALID');
    assert.equal(check(wrap({...signed,rollout:{...signed.rollout,
      owner_approved_at_ms:now+100}})).error_code,'UPDATE_SIGNED_ROLLOUT_INVALID');
    assert.equal(check(wrap({...signed,rollout:{...signed.rollout,
      node_ids:[]}})).error_code,'UPDATE_SIGNED_ROLLOUT_INVALID');
    assert.equal(check(wrap({...signed,rollout:{...signed.rollout,
      node_ids:['node_notvalid']}})).error_code,'UPDATE_SIGNED_ROLLOUT_INVALID');
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
    const s={schema:2,application:'desktop',channel:'stable',type:'rollback',
      version:'7.0.0',source_sha:'a'.repeat(40),protocol:7,
      filename:path.basename(file),installer_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      installer_bytes:bytes.length,publisher_subject:'CN=SUTRADHAR Verified',
      issued_ms:now,expires_ms:now+60000,owner_emergency_rollback_approved:true,
      rollout:{wave_id:'wave_rollback01',node_ids:['node_'+('c'.repeat(32))],
        owner_approved_at_ms:now}};
    const envelope={signed:s,signature_base64:crypto.sign(null,Buffer.from(JSON.stringify(s)),
      keys.privateKey).toString('base64')};
    const opts={envelope,pinnedPublicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),
      installerPath:file,currentVersion:'7.1.0',nodeId:'node_'+('c'.repeat(32)),
      protocol:7,publisherSubject:'CN=SUTRADHAR Verified',
      now,rolloutApproved:true,kind:'rollback'};
    assert.equal(verifyOffer(opts).accepted,true);
    const extra={...s,unknown_delivery_instruction:'execute now'};
    assert.equal(verifyOffer({...opts,envelope:{signed:extra,
      signature_base64:crypto.sign(null,Buffer.from(JSON.stringify(extra)),
        keys.privateKey).toString('base64')}}).error_code,
      'UPDATE_SIGNED_FIELDS_INVALID');
    assert.equal(verifyOffer({...opts,nodeId:'node_'+('a'.repeat(32))}).error_code,
      'UPDATE_DEVICE_NOT_IN_OWNER_WAVE');
    assert.equal(verifyOffer({...opts,envelope:{...envelope,
      signed:{...s,owner_emergency_rollback_approved:false}}}).accepted,false);
    assert.equal(verifyOffer({...opts,currentVersion:'6.9.0'}).accepted,false);
    assert.equal(verifyOffer({...opts,kind:'update'}).accepted,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Streaming SHA-256 reads large local installers without loading whole file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-sha-'));
  try{
    const file=path.join(dir,'SUTRADHAR Desktop.exe');
    const bytes=crypto.randomBytes(3*1024*1024+11);
    fs.writeFileSync(file,bytes);
    assert.equal(sha256File(file),
      crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.throws(()=>sha256File('relative.exe'),/UPDATE_INSTALLER_PATH_INVALID/);
    assert.throws(()=>sha256File(dir),/UPDATE_INSTALLER_FILE_TYPE_INVALID/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('installer hash rejects symbolic links and changed file type',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-link-'));
  try{
    const file=path.join(dir,'SUTRADHAR Desktop.exe');
    fs.writeFileSync(file,crypto.randomBytes(2048));
    assert.equal(sha256File(file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    const link=path.join(dir,'copy.exe');
    try{
      fs.symlinkSync(file,link);
      assert.throws(()=>sha256File(link),/UPDATE_INSTALLER_FILE_TYPE_INVALID/);
    }catch(e){
      if(e.code!=='EPERM'&&e.code!=='EACCES'&&e.code!=='ENOTSUP')throw e;
    }
    assert.throws(()=>sha256File(dir),/UPDATE_INSTALLER_FILE_TYPE_INVALID/);
    assert.throws(()=>sha256File(path.join(dir,'missing.exe')));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
