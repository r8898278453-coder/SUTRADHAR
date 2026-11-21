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
const identity=()=>{
  const keys=crypto.generateKeyPairSync('ed25519');
  return {
    node_id:'node_'+'a'.repeat(32),
    private_key_pem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    public_key_pem:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
    boot_id:'boot_'+'b'.repeat(32),
    node_sequence:1,agents:[{id:'agent_test_1',sequence:1}]
  };
};
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
    assert.throws(()=>v.save({...y,node_id:'node_'+'c'.repeat(32)}),/ROTATION_REQUIRES_OWNER/);
    assert.throws(()=>v.save({...y,node_sequence:3,
      agents:[{id:'agent_test_1',sequence:2}]}),/AGENT_REPLAY_DENIED/);
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
    const rotated=identity();
    assert.throws(()=>v.save({...initial,
      private_key_pem:rotated.private_key_pem,
      public_key_pem:rotated.public_key_pem}),
      /IDENTITY_ROTATION_REQUIRES_OWNER/);
    assert.throws(()=>v.save({...initial,agents:[]}),/IDENTITY_INVALID/);
    assert.throws(()=>v.save({...initial,agents:[
      {id:'agent_test_1',sequence:2},{id:'agent_test_1',sequence:3}]}),/IDENTITY_INVALID/);
    assert.throws(()=>v.save({...initial,agents:[
      {id:'agent_other',sequence:2}]}),/AGENT_LIST_CHANGE_REQUIRES_OWNER/);
    assert.throws(()=>v.save({...initial,boot_id:'boot_'+'d'.repeat(32),
      node_sequence:2,agents:[{id:'agent_test_1',sequence:2}]}),
      /BOOT_ROTATION_COUNTER_CHANGE_DENIED/);
    const restart={...initial,boot_id:'boot_'+'d'.repeat(32)};
    v.save(restart);
    assert.equal(v.read().boot_id,restart.boot_id);
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
    // The foreign fixture still exists, so replacing the disappeared
    // ciphertext must be blocked. Remove only this test-created artifact
    // to model a genuinely fresh private vault directory.
    assert.throws(()=>v.save(identity()),
      /OS_VAULT_IDENTITY_MISSING_OWNER_RECOVERY_REQUIRED/);
    fs.unlinkSync(foreign);
    const fresh=identity();
    v.save(fresh);
    fs.chmodSync(dir,0o755);
    assert.throws(()=>v.save({...fresh,node_sequence:2,
      agents:[{id:'agent_test_1',sequence:2}]}),
      /OS_VAULT_DIRECTORY_NOT_PRIVATE/,
      'A pre-existing identity in an exposed directory must never be rewritten');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('new identity may narrow an otherwise empty directory before storing encrypted bytes',()=>{
  if(process.platform==='win32')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-initial-perms-'));
  try{
    fs.chmodSync(dir,0o755);
    const v=createVault({safeStorage:testStore(),dir,platform:'linux'});
    const fresh=identity();
    v.save(fresh);
    assert.equal(fs.statSync(dir).mode&0o077,0);
    assert.deepEqual(v.read(),fresh);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('OS vault never silently rekeys when ciphertext is missing but old files remain',()=>{
  for(const filename of [
    'identity.osvault.json.1234.interrupted.tmp',
    'enrollment_requested','status.json','sealed_outbox.jsonl','maintenance-hold.json'
  ]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-residual-'));
    try{
      const storage=testStore();
      const v=createVault({safeStorage:storage,dir,platform:'win32'});
      fs.writeFileSync(path.join(dir,filename),'old evidence',{mode:0o600});
      const before=fs.readFileSync(path.join(dir,filename));
      assert.throws(()=>v.read(),
        /OS_VAULT_IDENTITY_MISSING_OWNER_RECOVERY_REQUIRED/,filename);
      assert.throws(()=>v.save(identity()),
        /OS_VAULT_IDENTITY_MISSING_OWNER_RECOVERY_REQUIRED/,filename);
      assert.equal(fs.existsSync(v.file),false,'No replacement key can be generated');
      assert.deepEqual(fs.readFileSync(path.join(dir,filename)),before,
        'Owner evidence must remain untouched');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('OS vault accepts only exact encrypted record and real matching Ed25519 keys',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-schema-'));
  try{
    const storage=testStore();
    const v=createVault({safeStorage:storage,dir,platform:'win32'});
    const valid=identity();
    v.save(valid);
    const originalRecord=JSON.parse(fs.readFileSync(v.file,'utf8'));
    const raw=body=>storage.encryptString(JSON.stringify(body)).toString('base64');
    const writeBody=body=>fs.writeFileSync(v.file,
      JSON.stringify({version:1,mode:'os-safeStorage',ciphertext:raw(body)})+'\n',{mode:0o600});
    assert.deepEqual(v.read(),valid);
    const wrong=identity();
    for(const body of [
      {...valid,private_key_pem:wrong.private_key_pem},
      {...valid,public_key_pem:wrong.public_key_pem},
      {...valid,private_key_pem:'FAKE PRIVATE KEY'},
      {...valid,public_key_pem:'FAKE PUBLIC KEY'}
    ]){
      writeBody(body);
      assert.throws(()=>v.read(),/OS_VAULT_IDENTITY_KEY_MISMATCH/);
      assert.throws(()=>v.save(valid),/OS_VAULT_IDENTITY_KEY_MISMATCH/);
    }
    for(const body of [
      {...valid,unexpected:'secret'},
      {...valid,node_id:'node_malformed'},
      {...valid,agents:[{...valid.agents[0],unknown_field:'secret'}]},
      {...valid,agents:[{id:99,sequence:1}]},
      {...valid,agents:[{id:valid.agents[0].id,sequence:-1}]}
    ]){
      writeBody(body);
      assert.throws(()=>v.read(),/OS_VAULT_IDENTITY_INVALID/);
    }
    for(const record of [
      {...originalRecord,unknown_metadata:'injection'},
      {...originalRecord,ciphertext:'abcdef**'},
      {...originalRecord,ciphertext:'  '+originalRecord.ciphertext+'  '}
    ]){
      fs.writeFileSync(v.file,JSON.stringify(record),{mode:0o600});
      assert.throws(()=>v.read(),/OS_VAULT_RECORD_INVALID/);
    }
    fs.writeFileSync(v.file,JSON.stringify(originalRecord)+'\n',{mode:0o600});
    assert.deepEqual(v.read(),valid);
    assert.equal(fs.readFileSync(v.file,'utf8').includes(valid.private_key_pem),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('OS vault treats dangling symlink as unsafe, never as absent identity',()=>{
  if(process.platform==='win32')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-dangling-'));
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'linux'});
    fs.symlinkSync(path.join(dir,'nonexistent'),v.file);
    assert.throws(()=>v.read(),/OS_VAULT_FILE_UNSAFE/);
    assert.throws(()=>v.save(identity()),/OS_VAULT_FILE_UNSAFE/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed ciphertext fsync leaves previous encrypted identity untouched',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-vault-interrupted-'));
  const original=fs.fsyncSync;
  try{
    const v=createVault({safeStorage:testStore(),dir,platform:'win32'});
    const previous=identity();
    v.save(previous);
    const originalBytes=fs.readFileSync(v.file);
    fs.fsyncSync=function(){throw Error('TEST_ONLY_INTERRUPTED_FLUSH');};
    try{
      assert.throws(()=>v.save({...previous,node_sequence:2,
        agents:[{id:'agent_test_1',sequence:2}]}),
        /TEST_ONLY_INTERRUPTED_FLUSH/);
    }finally{fs.fsyncSync=original;}
    assert.deepEqual(fs.readFileSync(v.file),originalBytes);
    assert.deepEqual(v.read(),previous);
    assert.deepEqual(fs.readdirSync(dir),['identity.osvault.json']);
  }finally{fs.fsyncSync=original;fs.rmSync(dir,{recursive:true,force:true});}
});
