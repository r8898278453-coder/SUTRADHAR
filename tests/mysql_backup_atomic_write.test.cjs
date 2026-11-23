'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {writeEncryptedArchive}=require('../scripts/ops/backup-atomic-write.cjs');
const {encryptDump}=require('../scripts/ops/backup-crypto.cjs');
function fixture(run){
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'sut-backup-atomic-'));
  try{return run(d);}finally{fs.rmSync(d,{recursive:true,force:true});}
}
test('complete encrypted output is immutable; symlink cannot overwrite source',()=>fixture(dir=>{
  const file=path.join(dir,'secure','backup.enc.json');
  const first=crypto.randomBytes(700),second=crypto.randomBytes(900);
  assert.equal(writeEncryptedArchive(file,first).created,true);
  assert.deepEqual(fs.readFileSync(file),first);
  assert.throws(()=>writeEncryptedArchive(file,second),/DESTINATION_ALREADY_EXISTS/);
  assert.deepEqual(fs.readFileSync(file),first);
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['backup.enc.json']);
  if(process.platform!=='win32'){
    assert.equal(fs.statSync(file).mode&0o077,0);
    const symlink=path.join(dir,'archive-symlink.json');
    fs.symlinkSync(file,symlink);
    assert.throws(()=>writeEncryptedArchive(symlink,second),/DESTINATION_ALREADY_EXISTS/);
    assert.deepEqual(fs.readFileSync(file),first);
  }
}));
test('two concurrent OS writers cannot replace the winning archive',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-atomic-race-'));
  try{
    const file=path.join(dir,'race.json');
    const src='const m=require(process.env.HELPER_PATH);try{m.writeEncryptedArchive(process.env.ARCHIVE_PATH,Buffer.from(process.env.BYTES));process.exit(0)}catch(e){process.exit(e.message==="BACKUP_DESTINATION_ALREADY_EXISTS"?21:22)}';
    function run(bytes){return new Promise((resolve,reject)=>{
      const child=cp.spawn(process.execPath,['-e',src],{stdio:'ignore',
        env:{...process.env,HELPER_PATH:path.resolve(__dirname,'../scripts/ops/backup-atomic-write.cjs'),
          ARCHIVE_PATH:file,BYTES:bytes}});
      child.once('error',reject);child.once('exit',resolve);
    });}
    const codes=await Promise.all([run('race-A'),run('race-B')]);
    assert.deepEqual(codes.sort((a,b)=>a-b),[0,21]);
    assert.ok(['race-A','race-B'].includes(fs.readFileSync(file,'utf8')));
    assert.deepEqual(fs.readdirSync(dir),['race.json']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('authenticated verify works without DB credentials, restore still refuses',()=>fixture(dir=>{
  const file=path.join(dir,'backup.enc.json'),key=crypto.randomBytes(32).toString('base64');
  writeEncryptedArchive(file,encryptDump(Buffer.alloc(1024,0x61),{
    keyBase64:key,sourceDb:'sut_backup_ci'}));
  const env={...process.env,DB_NAME:'sut_backup_ci',
    DB_HOST:'',DB_USER:'',DB_PASSWORD:'',DB_PORT:'',
    SUTRADHAR_BACKUP_KEY_BASE64:key,SUTRADHAR_ENCRYPTED_BACKUP_PATH:file};
  function cli(action,extras={}){return cp.spawnSync(process.execPath,
    [path.resolve(__dirname,'../scripts/ops/mysql-ops.cjs'),action],
    {env:{...env,...extras},encoding:'utf8',timeout:10000});}
  const verified=cli('verify');
  assert.equal(verified.status,0,verified.stderr);
  assert.equal(JSON.parse(verified.stdout.trim()).operation,'BACKUP_AUTHENTICATED');
  assert.equal(cli('verify',{DB_NAME:'different_db'}).status!==0,true);
  assert.notEqual(cli('restore',{SUTRADHAR_RESTORE_STAGING_APPROVED:'yes',
    SUTRADHAR_TARGET_DB_NAME:'sut_staging_ci',
    SUTRADHAR_EXPECTED_TARGET_DB_NAME:'sut_staging_ci'}).status,0);
}));
test('offline verification refuses symlinked archive',()=>fixture(dir=>{
  if(process.platform==='win32')return;
  const source=path.join(dir,'original'),link=path.join(dir,'link');
  fs.writeFileSync(source,'x'.repeat(200));fs.symlinkSync(source,link);
  const result=cp.spawnSync(process.execPath,
    [path.resolve(__dirname,'../scripts/ops/mysql-ops.cjs'),'verify'],
    {encoding:'utf8',timeout:10000,env:{...process.env,DB_NAME:'sut_backup_ci',
      DB_HOST:'',DB_USER:'',DB_PASSWORD:'',
      SUTRADHAR_BACKUP_KEY_BASE64:crypto.randomBytes(32).toString('base64'),
      SUTRADHAR_ENCRYPTED_BACKUP_PATH:link}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/BACKUP_FILE_UNSAFE/);
}));

test('restore rejects authenticated database-switch SQL before MySQL connection',()=>fixture(dir=>{
  const file=path.join(dir,'switch-archive.json');
  const key=crypto.randomBytes(32).toString('base64'),source='sut_backup_ci',target='sut_staging_ci';
  for(const sql of ['USE', 'CREATE DATABASE', 'DROP DATABASE']){
    const text=sql+' important_production_db;\n'+'INSERT INTO t VALUES (1);\n'.repeat(20);
    if(fs.existsSync(file))fs.unlinkSync(file);
    writeEncryptedArchive(file,encryptDump(Buffer.from(text),{
      keyBase64:key,sourceDb:source}));
    const result=cp.spawnSync(process.execPath,
      [path.resolve(__dirname,'../scripts/ops/mysql-ops.cjs'),'restore'],
      {encoding:'utf8',timeout:10000,env:{...process.env,DB_NAME:source,
        DB_HOST:'127.0.0.1',DB_USER:'root',DB_PASSWORD:'test-no-connect',
        DB_PORT:'3306',SUTRADHAR_BACKUP_KEY_BASE64:key,
        SUTRADHAR_ENCRYPTED_BACKUP_PATH:file,SUTRADHAR_RESTORE_STAGING_APPROVED:'yes',
        SUTRADHAR_TARGET_DB_NAME:target,SUTRADHAR_EXPECTED_TARGET_DB_NAME:target}});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/BACKUP_HAS_DATABASE_SWITCH_OR_DROP/,
      'Refused before attempting connection: '+result.stderr);
  }
}));

test('versioned-comment database switches in encrypted archives are rejected before DB connection',()=>fixture(dir=>{
  const file=path.join(dir,'unsafe.json');
  const key=crypto.randomBytes(32).toString('base64');
  for(const sql of ['/*!50000 USE production_db */;',
    '/* prefix */ CREATE DATABASE production_db;',
    'INSERT INTO x VALUES (1); /*!50000 DROP DATABASE production_db */;']){
    if(fs.existsSync(file))fs.unlinkSync(file);
    writeEncryptedArchive(file,encryptDump(
      Buffer.from(sql+'\n'+'INSERT INTO t VALUES (1);\n'.repeat(20)),
      {keyBase64:key,sourceDb:'sut_backup_ci'}));
    const x=cp.spawnSync(process.execPath,
      [path.resolve(__dirname,'../scripts/ops/mysql-ops.cjs'),'restore'],
      {encoding:'utf8',timeout:10000,env:{...process.env,DB_NAME:'sut_backup_ci',
        DB_HOST:'127.0.0.1',DB_USER:'root',DB_PASSWORD:'test-no-connect',
        DB_PORT:'3306',SUTRADHAR_BACKUP_KEY_BASE64:key,
        SUTRADHAR_ENCRYPTED_BACKUP_PATH:file,SUTRADHAR_RESTORE_STAGING_APPROVED:'yes',
        SUTRADHAR_TARGET_DB_NAME:'sut_staging_ci',
        SUTRADHAR_EXPECTED_TARGET_DB_NAME:'sut_staging_ci'}});
    assert.notEqual(x.status,0,sql);
    assert.match(x.stderr,/BACKUP_HAS_DATABASE_SWITCH_OR_DROP/,sql);
  }
}));
