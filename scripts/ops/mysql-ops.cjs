/**
 * Trusted operator-machine MySQL backup / staging-only restore.
 * The database client binaries run locally, NOT on shared Hostinger.
 * No command-line passwords, no plaintext dump on disk, no production restore.
 *
 * backup  : SUTRADHAR_ENCRYPTED_BACKUP_PATH=/private/backups/b1.json node ...
 * verify  : SUTRADHAR_ENCRYPTED_BACKUP_PATH=... node ... verify
 * restore : SUTRADHAR_RESTORE_STAGING_APPROVED=yes
 *           SUTRADHAR_TARGET_DB_NAME=sutradhar_staging_empty
 *           node ... restore
 */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const mysql=require('mysql2/promise');
const {encryptDump,decryptDump,MAX_DUMP_BYTES}=require('./backup-crypto.cjs');
const action=process.argv[2];
if(!['backup','verify','restore'].includes(action))throw Error('Usage: node mysql-ops.cjs backup|verify|restore');
const sourceDb=process.env.DB_NAME||'';
const host=process.env.DB_HOST||'',user=process.env.DB_USER||'';
const password=process.env.DB_PASSWORD||'';
const port=Number(process.env.DB_PORT||3306);
const output=process.env.SUTRADHAR_ENCRYPTED_BACKUP_PATH||'';
const key=process.env.SUTRADHAR_BACKUP_KEY_BASE64||'';
if(!/^[A-Za-z0-9_]{1,64}$/.test(sourceDb)||!host||host.length>200||
  !/^[A-Za-z0-9._:-]+$/.test(host)||!/^[A-Za-z0-9_]{1,64}$/.test(user)||
  !password||/[\r\n]/.test(password)||!Number.isInteger(port)||port<1||port>65535||
  !path.isAbsolute(output))
  throw Error('Provide DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME and an absolute encrypted backup path');
if(!key)throw Error('SUTRADHAR_BACKUP_KEY_BASE64 is required; store OFF-machine and never commit it');
function clientConfig(dbName){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sut-mysql-client-'));
  try{fs.chmodSync(dir,0o700);}catch{}
  const file=path.join(dir,'client.cnf');
  // Keep this password outside shell args, env and the resulting backup.
  const escape=x=>String(x).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  fs.writeFileSync(file,'[client]\nuser="'+escape(user)+'"\npassword="'+escape(password)+
    '"\nhost="'+escape(host)+'"\nport='+port+'\n',{mode:0o600,flag:'wx'});
  return {file,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function run(client,args,{input,timeout=120000}={}){
  const r=cp.spawnSync(client,args,{input,encoding:null,timeout,maxBuffer:MAX_DUMP_BYTES+1024*1024,
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR}});
  if(r.error||r.status!==0){
    // Never print stdout/stderr; some DB clients might echo secrets in errors.
    throw Error('MYSQL_CLIENT_OPERATION_FAILED: '+client+' exit status '+String(r.status));
  }
  return r.stdout;
}
function atomicWrite(file,data){
  if(fs.existsSync(file))throw Error('BACKUP_DESTINATION_ALREADY_EXISTS');
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+process.pid+'.tmp';
  try{
    fs.writeFileSync(tmp,data,{mode:0o600,flag:'wx'});
    fs.renameSync(tmp,file);
  }catch(e){try{fs.rmSync(tmp,{force:true});}catch{}throw e;}
}
async function main(){
  if(action==='backup'){
    const auth=clientConfig(sourceDb);
    try{
      const dump=run('mysqldump',[
        '--defaults-extra-file='+auth.file,
        '--protocol=tcp','--single-transaction','--quick','--skip-lock-tables',
        '--hex-blob','--set-gtid-purged=OFF','--no-tablespaces',
        '--routines','--triggers','--events',
        '--default-character-set=utf8mb4',sourceDb]);
      const encrypted=encryptDump(dump,{keyBase64:key,sourceDb});
      atomicWrite(output,encrypted);
      console.log(JSON.stringify({operation:'BACKUP_CREATED',file:output,source_db:sourceDb,
        backup_sha256:crypto.createHash('sha256').update(encrypted).digest('hex'),
        encrypted_bytes:encrypted.length,ready_for_restore:false}));
    }finally{auth.cleanup();}
    return;
  }
  const encrypted=fs.readFileSync(output);
  if(encrypted.length>MAX_DUMP_BYTES*2.0)throw Error('BACKUP_FILE_TOO_LARGE');
  const verified=decryptDump(encrypted,{keyBase64:key,expectedSourceDb:sourceDb});
  if(action==='verify'){
    console.log(JSON.stringify({operation:'BACKUP_AUTHENTICATED',source_db:verified.sourceDb,
      created_at:verified.createdAt,plaintext_sha256:verified.sha256,
      restorable_not_proven:true}));return;
  }
  const target=process.env.SUTRADHAR_TARGET_DB_NAME||'';
  if(process.env.SUTRADHAR_RESTORE_STAGING_APPROVED!=='yes'||
    !/^[A-Za-z0-9_]{1,64}$/.test(target)||target===sourceDb||
    !/(?:^|_)(?:staging|disposable|test|ci)(?:_|$)/i.test(target)||
    process.env.SUTRADHAR_EXPECTED_TARGET_DB_NAME!==target)
    throw Error('STAGING_RESTORE_BLOCKED: empty staging/test DB, exact expected name and approval required');
  if(/^\s*(?:CREATE\s+DATABASE|USE\s+|DROP\s+DATABASE)/im.test(verified.plain.toString('utf8')))
    throw Error('BACKUP_HAS_DATABASE_SWITCH_OR_DROP');
  const connection=await mysql.createConnection({host,user,password,port,database:target});
  try{
    const [rows]=await connection.query(
      'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=?',[target]);
    if(Number(rows[0].n)!==0)throw Error('STAGING_DB_NOT_EMPTY');
  }finally{await connection.end();}
  const auth=clientConfig(target);
  try{
    run('mysql',['--defaults-extra-file='+auth.file,'--protocol=tcp',
      '--default-character-set=utf8mb4','--database='+target],{input:verified.plain,timeout:180000});
    console.log(JSON.stringify({operation:'STAGING_RESTORE_COMPLETED',target_db:target,
      source_db:sourceDb,plaintext_sha256:verified.sha256,
      note:'Run independent schema/table-count/behavior verification before acceptance'}));
  }finally{auth.cleanup();}
}
main().catch(e=>{console.error(String(e.message||'BACKUP_OPERATION_FAILED'));process.exitCode=1;});
