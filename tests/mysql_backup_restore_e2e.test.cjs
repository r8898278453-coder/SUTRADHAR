/**
 * Disposable MySQL 8 end-to-end backup/restore verification.
 *
 * Tests real mysqldump + mysql (not just AES-GCM in isolation) against two
 * fixed disposable databases. No production Hostinger credentials or data.
 * MUST be opt-in, NODE_ENV=test, loopback-only, CI-only DB_NAME, and a test
 * sentinel; otherwise this script refuses to connect or mutate anything.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const mysql=require('mysql2/promise');
const base=path.resolve(__dirname,'..');
const sourceDb='sutradhar_backup_ci_source';
const targetDb='sutradhar_backup_staging_ci';
const enabled=process.env.SUTRADHAR_RUN_MYSQL_RECOVERY_E2E==='true';
test('Encrypted MySQL dump restores real rows only to an explicitly empty staging database',
  {skip:!enabled?'Requires disposable CI MySQL test opt-in':false,timeout:240000},
  async()=>{
    if(process.env.NODE_ENV!=='test'||process.env.DB_HOST!=='127.0.0.1'||
      process.env.DB_NAME!=='sutradhar_v7_ci'||
      process.env.SUTRADHAR_MYSQL_RECOVERY_TEST_SENTINEL!=='disposable-only'||
      process.env.DB_USER!=='root'||!process.env.DB_PASSWORD)
      throw Error('DISPOSABLE_MYSQL_E2E_ENVIRONMENT_REQUIRED');
    for(const command of ['mysql','mysqldump']){
      const v=cp.spawnSync(command,['--version'],{encoding:'utf8',timeout:10000});
      assert.equal(v.status,0,command+' client is required on test runner');
    }
    const admin=await mysql.createConnection({
      host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
      user:process.env.DB_USER,password:process.env.DB_PASSWORD
    });
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sutradhar-backup-e2e-'));
    const encryptedPath=path.join(dir,'control-backup.encrypted.json');
    const encryptionKey=crypto.randomBytes(32).toString('base64');
    const run=(mode,extra={})=>cp.spawnSync(process.execPath,
      [path.join(base,'scripts','ops','mysql-ops.cjs'),mode],
      {cwd:base,encoding:'utf8',timeout:180000,
        env:{...process.env,DB_NAME:sourceDb,
          SUTRADHAR_BACKUP_KEY_BASE64:encryptionKey,
          SUTRADHAR_ENCRYPTED_BACKUP_PATH:encryptedPath,...extra}});
    try{
      // Names are static and operations are gated to CI loopback only.
      await admin.query('CREATE DATABASE IF NOT EXISTS '+sourceDb);
      await admin.query('CREATE DATABASE IF NOT EXISTS '+targetDb);
      await admin.query('CREATE TABLE '+sourceDb+'.backup_probe ('+
        'id INT PRIMARY KEY, marker VARCHAR(100) NOT NULL) ENGINE=InnoDB');
      const rows=Array.from({length:10},(_,i)=>[i+1,'test-encrypted-restore-row-'+i]);
      for(const [id,marker] of rows)
        await admin.query('INSERT INTO '+sourceDb+'.backup_probe (id,marker) VALUES(?,?)',
          [id,marker]);
      const result=run('backup');
      assert.equal(result.status,0,'Real mysqldump backup failed: '+result.stderr?.slice(0,300));
      assert.equal(fs.existsSync(encryptedPath),true);
      const ciphertext=fs.readFileSync(encryptedPath,'utf8');
      assert.equal(ciphertext.includes('backup_probe'),false,'Plaintext schema leaked to disk');
      assert.equal(ciphertext.includes('test-encrypted-restore-row'),false,'Plaintext row leaked');
      const backupReceipt=JSON.parse(result.stdout.trim());
      assert.equal(backupReceipt.operation,'BACKUP_CREATED');
      const verifyReceipt=run('verify');
      assert.equal(verifyReceipt.status,0,'Encrypted backup authentication failed');
      assert.equal(JSON.parse(verifyReceipt.stdout.trim()).operation,'BACKUP_AUTHENTICATED');
      const wrongTarget=run('restore',{
        SUTRADHAR_RESTORE_STAGING_APPROVED:'yes',
        SUTRADHAR_TARGET_DB_NAME:targetDb,
        SUTRADHAR_EXPECTED_TARGET_DB_NAME:'different_staging_db'
      });
      assert.notEqual(wrongTarget.status,0,'Missing exact target approval must refuse');
      const restored=run('restore',{
        SUTRADHAR_RESTORE_STAGING_APPROVED:'yes',
        SUTRADHAR_TARGET_DB_NAME:targetDb,
        SUTRADHAR_EXPECTED_TARGET_DB_NAME:targetDb
      });
      assert.equal(restored.status,0,'Real staging restore failed: '+restored.stderr?.slice(0,300));
      assert.equal(JSON.parse(restored.stdout.trim()).operation,'STAGING_RESTORE_COMPLETED');
      const verifyRestored=(more={})=>cp.spawnSync(process.execPath,
        [path.join(base,'scripts','ops','staging-restore-verify.cjs')],
        {cwd:base,encoding:'utf8',timeout:180000,
          env:{...process.env,DB_NAME:sourceDb,
            SUTRADHAR_TARGET_DB_NAME:targetDb,
            SUTRADHAR_EXPECTED_TARGET_DB_NAME:targetDb,
            SUTRADHAR_RESTORE_VERIFY_SOURCE_DB_NAME:sourceDb,
            SUTRADHAR_RESTORE_VERIFY_BACKUP_SHA256:backupReceipt.backup_sha256,
            SUTRADHAR_RESTORE_VERIFY_APPROVED:'yes',
            SUTRADHAR_BACKUP_KEY_BASE64:encryptionKey,
            SUTRADHAR_ENCRYPTED_BACKUP_PATH:encryptedPath,...more}});
      const verifiedRestore=verifyRestored();
      assert.equal(verifiedRestore.status,0,
        'Real independent read-only content comparison failed: '+
        verifiedRestore.stderr?.slice(0,300));
      const independent=JSON.parse(verifiedRestore.stdout.trim());
      assert.equal(independent.accepted,true);
      assert.equal(independent.status,'STAGING_RESTORE_CURRENT_SNAPSHOTS_MATCH');
      assert.equal(independent.verified_row_count,10);
      assert.equal(independent.table_count,1);
      assert.equal(independent.encrypted_backup_sha256,backupReceipt.backup_sha256);
      assert.equal(independent.production_release_authorized,false);
      assert.equal(independent.exact_backup_snapshot_proven,false);
      const noApproval=verifyRestored({SUTRADHAR_RESTORE_VERIFY_APPROVED:'no'});
      assert.notEqual(noApproval.status,0,
        'Read-only verifier must refuse a missing exact Owner approval');
      const wrongBackupHash=verifyRestored({
        SUTRADHAR_RESTORE_VERIFY_BACKUP_SHA256:'f'.repeat(64)});
      assert.notEqual(wrongBackupHash.status,0,
        'Verifier must refuse an altered expected encrypted archive SHA');
      const [actual]=await admin.query('SELECT id,marker FROM '+
        targetDb+'.backup_probe ORDER BY id');
      assert.deepEqual(actual.map(r=>[r.id,r.marker]),rows,'Restored rows differ from source');
      await admin.query('UPDATE '+targetDb+
        '.backup_probe SET marker=? WHERE id=?',['tampered-after-restore',2]);
      const altered=verifyRestored();
      assert.notEqual(altered.status,0,
        'Same-count tampered staging row must invalidate independent verification');
      assert.equal(altered.stdout.trim(),'',
        'Failed independent verification must not leak row contents');
      const second=run('restore',{
        SUTRADHAR_RESTORE_STAGING_APPROVED:'yes',
        SUTRADHAR_TARGET_DB_NAME:targetDb,
        SUTRADHAR_EXPECTED_TARGET_DB_NAME:targetDb
      });
      assert.notEqual(second.status,0,'Nonempty restored database must refuse overwrite');
    }finally{
      try{await admin.query('DROP DATABASE IF EXISTS '+targetDb);}catch{}
      try{await admin.query('DROP DATABASE IF EXISTS '+sourceDb);}catch{}
      await admin.end();fs.rmSync(dir,{recursive:true,force:true});
    }
  });
