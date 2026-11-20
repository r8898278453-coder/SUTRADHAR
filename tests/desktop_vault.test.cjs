'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createVault}=require('../apps/desktop/os-vault.cjs');
function testStore(){
  const secret=crypto.randomBytes(32);
  return {
    isEncryptionAvailable:()=>true,
    encryptString:x=>{
      const iv=crypto.randomBytes(12),engine=crypto.createCipheriv('aes-256-gcm',secret,iv);
      const bytes=Buffer.concat([engine.update(Buffer.from(x)),engine.final()]);
      return Buffer.concat([iv,engine.getAuthTag(),bytes]);
    },
    decryptString:x=>{
      const engine=crypto.createDecipheriv('aes-256-gcm',secret,x.subarray(0,12));
      engine.setAuthTag(x.subarray(12,28));
      return Buffer.concat([engine.update(x.subarray(28)),engine.final()]).toString();
    },
    getSelectedStorageBackend:()=> 'gnome_libsecret'
  };
}
const identity=()=>({
  node_id:'node_test_identity',private_key_pem:'-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  public_key_pem:'-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
  boot_id:'boot_test',node_sequence:1,agents:[{id:'agent_test_1',sequence:1}]
});
test('OS vault encrypts persisted identity and prevents replay/clone',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-'));
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'win32'});
    const x=identity();
    v.save(x);
    const bytes=fs.readFileSync(v.file,'utf8');
    assert.equal(bytes.includes('PRIVATE KEY'),false);
    assert.equal(bytes.includes('node_test_identity'),false);
    assert.deepEqual(v.read(),x);
    const y={...x,node_sequence:2,agents:[{id:'agent_test_1',sequence:3}]};
    v.save(y);assert.deepEqual(v.read(),y);
    assert.throws(()=>v.save(x),/SEQUENCE_ROLLBACK/);
    assert.throws(()=>v.save({...y,node_id:'node_different'}),/ROTATION_REQUIRES_OWNER/);
    assert.throws(()=>v.save({...y,agents:[{id:'agent_test_1',sequence:2}]}),/AGENT_REPLAY_DENIED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('OS vault blocks missing key providers and plaintext Linux fallback',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-'));
  try{
    assert.throws(()=>createVault({safeStorage:{isEncryptionAvailable:()=>false},dir}),/UNAVAILABLE/);
    assert.throws(()=>createVault({safeStorage:{isEncryptionAvailable:()=>true,
      getSelectedStorageBackend:()=>'basic_text'},dir,platform:'linux'}),/PLAINTEXT/);
    fs.writeFileSync(path.join(dir,'identity.json'),'unsafe plaintext');
    assert.throws(()=>createVault({safeStorage:testStore(),dir,platform:'win32'}),/LEGACY_PLAINTEXT/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('OS vault fails closed for corrupted ciphertext; never silently rekeys',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-'));
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'win32'});
    const i=identity();v.save(i);
    const record=JSON.parse(fs.readFileSync(v.file,'utf8'));
    record.ciphertext=crypto.randomBytes(99).toString('base64');
    fs.writeFileSync(v.file,JSON.stringify(record));
    assert.throws(()=>v.read());
    assert.throws(()=>v.save(i));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('vault serializes encrypted identity writes with local file+directory sync',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-fsync-'));
  const original=fs.fsyncSync;
  let flushes=0;
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'win32'});
    fs.fsyncSync=function(fd){flushes++;return original(fd);};
    try{v.save(identity());}
    finally{fs.fsyncSync=original;}
    assert.ok(flushes>=(process.platform==='win32'?1:2),
      'Encrypted bytes must be flushed before returning from vault.save');
    assert.equal(v.read().node_sequence,1);
    if(process.platform!=='win32'){
      assert.equal(fs.statSync(v.file).mode&0o077,0);
      assert.equal(fs.statSync(dir).mode&0o077,0);
    }
  }finally{fs.fsyncSync=original;fs.rmSync(dir,{recursive:true,force:true});}
});
test('OS vault rejects same-boot replay, silent private-key rotation and agent reassignment',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-fence-'));
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'win32'}),
      initial=identity();
    v.save(initial);
    assert.throws(()=>v.save({...initial}),/SEQUENCE_ROLLBACK_OR_REPLAY/);
    assert.throws(()=>v.save({...initial,
      private_key_pem:'-----BEGIN PRIVATE KEY-----\nchanged\n-----END PRIVATE KEY-----'}),
      /IDENTITY_ROTATION_REQUIRES_OWNER/);
    assert.throws(()=>v.save({...initial,agents:[]}),/IDENTITY_INVALID/);
    assert.throws(()=>v.save({...initial,agents:[
      {id:'agent_test_1',sequence:2},{id:'agent_test_1',sequence:3}]}),/IDENTITY_INVALID/);
    assert.throws(()=>v.save({...initial,agents:[
      {id:'agent_other',sequence:2}]}),/AGENT_LIST_CHANGE_REQUIRES_OWNER/);
    assert.throws(()=>v.save({...initial,boot_id:'boot_restart',
      node_sequence:2,agents:[{id:'agent_test_1',sequence:2}]}),
      /BOOT_ROTATION_COUNTER_CHANGE_DENIED/);
    const restart={...initial,boot_id:'boot_restart'};
    v.save(restart);
    assert.equal(v.read().boot_id,'boot_restart');
    assert.throws(()=>v.save(restart),/SEQUENCE_ROLLBACK_OR_REPLAY/);
    const advancing={...restart,node_sequence:2,agents:[
      {id:'agent_test_1',sequence:2}]};
    v.save(advancing);
    assert.equal(v.read().node_sequence,2);
    assert.throws(()=>v.save({...advancing,node_sequence:3,
      agents:[{id:'agent_test_1',sequence:2}]}),/AGENT_REPLAY_DENIED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('vault refuses unsafe symlink file and public directory on POSIX',()=>{
  if(process.platform==='win32')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-perms-'));
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'linux'});
    const foreign=path.join(dir,'other.json');
    fs.writeFileSync(foreign,'{}',{mode:0o600});
    fs.symlinkSync(foreign,v.file);
    assert.throws(()=>v.read(),/OS_VAULT_FILE_UNSAFE/);
    assert.throws(()=>v.save(identity()),/OS_VAULT_FILE_UNSAFE/);
    fs.unlinkSync(v.file);
    fs.chmodSync(dir,0o755);
    assert.throws(()=>v.save(identity()),/OS_VAULT_DIRECTORY_NOT_PRIVATE/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
