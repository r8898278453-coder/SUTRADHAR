/**
 * Independently inspect current source and restored STAGING MySQL snapshots.
 * Read-only, bounded and fail-closed. It does NOT prove that the historical
 * encrypted dump exactly matches the current source; Owner must separately
 * establish source quiescence, backup timing and production authorization.
 */
'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {readEncryptedArchive}=require('./backup-safe-read.cjs');
const {decryptDump}=require('./backup-crypto.cjs');
const DB=/^[A-Za-z0-9_]{1,64}$/,HEX=/^[0-9a-f]{64}$/;
const PAGE=256,MAX_TABLES=128,MAX_PER_TABLE=100000,MAX_TOTAL=500000;
const MAX_ROW=1024*1024,MAX_DATA=256*1024*1024;
const abort=code=>{throw Error(code);};
const qname=n=>{if(!DB.test(n||''))abort('RESTORE_VERIFY_IDENTIFIER_INVALID');
  return String.fromCharCode(96)+n+String.fromCharCode(96);};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function validate({sourceDb,targetDb,expectedSourceDb,expectedTargetDb,
  approved,expectedBackupSha}){
  if(!DB.test(sourceDb||'')||!DB.test(targetDb||'')||
     sourceDb===targetDb||expectedSourceDb!==sourceDb||
     expectedTargetDb!==targetDb||approved!=='yes'||
     !/(?:^|_)(?:stage|staging|test|qa|disposable|ci)(?:_|$)/i.test(targetDb||'')||
     !HEX.test(expectedBackupSha||''))
    abort('RESTORE_VERIFY_EXACT_OWNER_APPROVAL_REQUIRED');
}
function norm(v){
  if(v===null)return ['null'];
  if(Buffer.isBuffer(v))return ['bytes',v.toString('base64')];
  if(v instanceof Date)return ['date',v.toISOString()];
  if(typeof v==='string')return ['str',v];
  if(typeof v==='number'&&Number.isFinite(v))return ['num',String(v)];
  if(typeof v==='bigint')return ['bigint',String(v)];
  if(typeof v==='boolean')return ['bool',v];
  if(Array.isArray(v))return ['array',v.map(norm)];
  if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)
    return ['object',Object.keys(v).sort().map(k=>[k,norm(v[k])])];
  abort('RESTORE_VERIFY_DATA_TYPE_UNSUPPORTED');
}
function pack(row,columns){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     Object.keys(row).length!==columns.length)
    abort('RESTORE_VERIFY_DATA_SHAPE_INVALID');
  const bytes=Buffer.from(JSON.stringify(columns.map(c=>norm(row[c]))));
  if(bytes.length>MAX_ROW)abort('RESTORE_VERIFY_ROW_TOO_LARGE');
  return bytes;
}
const META={
  tables:'SELECT table_name AS table_name,engine AS engine,table_type AS table_type FROM information_schema.tables WHERE table_schema=? ORDER BY table_name',
  columns:'SELECT table_name AS table_name,column_name AS column_name,ordinal_position AS ordinal_position,column_type AS column_type,is_nullable AS is_nullable,column_default AS column_default,extra AS extra,character_set_name AS character_set_name,collation_name AS collation_name FROM information_schema.columns WHERE table_schema=? ORDER BY table_name,ordinal_position',
  indexes:'SELECT table_name AS table_name,index_name AS index_name,seq_in_index AS seq_in_index,column_name AS column_name,non_unique AS non_unique,index_type AS index_type,sub_part AS sub_part FROM information_schema.statistics WHERE table_schema=? ORDER BY table_name,index_name,seq_in_index',
  fks:'SELECT k.table_name AS table_name,k.constraint_name AS constraint_name,k.column_name AS column_name,k.ordinal_position AS ordinal_position,k.referenced_table_schema AS referenced_table_schema,k.referenced_table_name AS referenced_table_name,k.referenced_column_name AS referenced_column_name,r.delete_rule AS delete_rule,r.update_rule AS update_rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.constraint_name=k.constraint_name AND r.table_name=k.table_name WHERE k.table_schema=? AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name,k.constraint_name,k.ordinal_position'
};
async function inventory(query,db){
  const meta={};
  for(const [kind,sql] of Object.entries(META)){
    const data=await query(sql,[db]);
    if(!Array.isArray(data)||data.length>10000)
      abort('RESTORE_VERIFY_METADATA_TOO_LARGE');
    meta[kind]=kind==='fks'?data.map(x=>{
      if(x.referenced_table_schema!==db)
        abort('RESTORE_VERIFY_EXTERNAL_FOREIGN_KEY');
      return {...x,referenced_table_schema:'LOCAL_SCHEMA'};
    }):data;
  }
  const tables=meta.tables;
  if(tables.length<1||tables.length>MAX_TABLES||
     new Set(tables.map(t=>t.table_name)).size!==tables.length||
     tables.some(t=>!DB.test(t.table_name||'')||
       t.table_type!=='BASE TABLE'||t.engine?.toUpperCase()!=='INNODB'))
    abort('RESTORE_VERIFY_UNSAFE_TABLE_SET');
  const names=tables.map(t=>t.table_name),allowed=new Set(names);
  for(const k of ['columns','indexes','fks'])
    if(meta[k].some(row=>!allowed.has(row.table_name)||
       !DB.test(row.column_name||'')))
      abort('RESTORE_VERIFY_STRUCTURE_INVALID');
  const columns={},pk={};
  for(const table of names){
    const cols=meta.columns.filter(x=>x.table_name===table)
      .map(x=>x.column_name);
    const keys=meta.indexes.filter(x=>x.table_name===table&&
      x.index_name==='PRIMARY')
      .sort((a,b)=>Number(a.seq_in_index)-Number(b.seq_in_index));
    if(!cols.length||cols.length>150||new Set(cols).size!==cols.length||
       !keys.length||keys.some((x,i)=>Number(x.seq_in_index)!==i+1||
         Number(x.non_unique)!==0||!cols.includes(x.column_name)))
      abort('RESTORE_VERIFY_PRIMARY_KEY_REQUIRED');
    columns[table]=cols;pk[table]=keys.map(x=>x.column_name);
  }
  return {names,columns,pk,digest:hash(JSON.stringify(meta))};
}
async function scan(query,db,table,cols,keys,count){
  const h=crypto.createHash('sha256');
  h.update('SUTRADHAR_RESTORE_SCAN_V1\n'+table+'\n');
  let bytes=0;
  for(let offset=0;offset<count;offset+=PAGE){
    const size=Math.min(PAGE,count-offset);
    const sql='SELECT '+cols.map(qname).join(',')+' FROM '+
      qname(db)+'.'+qname(table)+' ORDER BY '+keys.map(qname).join(',')+
      ' LIMIT ? OFFSET ?';
    const rows=await query(sql,[size,offset]);
    if(!Array.isArray(rows)||rows.length!==size)
      abort('RESTORE_VERIFY_PAGE_CHANGED');
    for(const row of rows){
      const blob=pack(row,cols);
      bytes+=blob.length;
      if(bytes>MAX_DATA)abort('RESTORE_VERIFY_DATA_TOO_LARGE');
      h.update(String(blob.length)+':');h.update(blob);h.update('\n');
    }
  }
  return {digest:h.digest('hex'),bytes};
}
async function compare({sourceDb,targetDb,expectedSourceDb,expectedTargetDb,
  expectedBackupSha,approved,sourceQuery,targetQuery}){
  validate({sourceDb,targetDb,expectedSourceDb,expectedTargetDb,
    expectedBackupSha,approved});
  if(typeof sourceQuery!=='function'||typeof targetQuery!=='function')
    abort('RESTORE_VERIFY_READERS_REQUIRED');
  const a=await inventory(sourceQuery,sourceDb),b=await inventory(targetQuery,targetDb);
  if(a.digest!==b.digest)abort('RESTORE_VERIFY_SCHEMA_MISMATCH');
  let total=0,totalBytes=0;
  const verified=[];
  for(const table of a.names){
    const sql='SELECT COUNT(*) AS n FROM '+qname(table);
    const left=await sourceQuery(sql,[]);
    const right=await targetQuery(sql,[]);
    const x=Number(left?.[0]?.n),y=Number(right?.[0]?.n);
    if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||
       x<0||y<0||x>MAX_PER_TABLE||y>MAX_PER_TABLE)
      abort('RESTORE_VERIFY_ROW_LIMIT');
    if(x!==y)abort('RESTORE_VERIFY_ROW_COUNT_MISMATCH');
    total+=x;
    if(total>MAX_TOTAL)abort('RESTORE_VERIFY_TOTAL_ROW_LIMIT');
    const s=await scan(sourceQuery,sourceDb,table,a.columns[table],a.pk[table],x);
    const t=await scan(targetQuery,targetDb,table,a.columns[table],a.pk[table],x);
    if(s.digest!==t.digest||s.bytes!==t.bytes)
      abort('RESTORE_VERIFY_DATA_MISMATCH');
    totalBytes+=s.bytes;
    if(totalBytes>MAX_DATA)abort('RESTORE_VERIFY_DATA_TOO_LARGE');
    verified.push({table,row_count:x,sha256:s.digest});
  }
  return {accepted:true,status:'STAGING_RESTORE_CURRENT_SNAPSHOTS_MATCH',
    source_db:sourceDb,target_db:targetDb,
    encrypted_backup_sha256:expectedBackupSha,
    table_count:verified.length,verified_row_count:total,
    schema_sha256:a.digest,data_sha256:hash(JSON.stringify(verified)),
    tables:verified,read_only:true,ddl_executed:false,dml_executed:false,
    source_quiescence_proven:false,exact_backup_snapshot_proven:false,
    production_release_authorized:false,owner_review_required:true};
}
async function main(){
  const args={sourceDb:process.env.DB_NAME||'',
    targetDb:process.env.SUTRADHAR_TARGET_DB_NAME||'',
    expectedSourceDb:process.env.SUTRADHAR_RESTORE_VERIFY_SOURCE_DB_NAME||'',
    expectedTargetDb:process.env.SUTRADHAR_EXPECTED_TARGET_DB_NAME||'',
    approved:process.env.SUTRADHAR_RESTORE_VERIFY_APPROVED||'',
    expectedBackupSha:process.env.SUTRADHAR_RESTORE_VERIFY_BACKUP_SHA256||''};
  validate(args);
  const file=process.env.SUTRADHAR_ENCRYPTED_BACKUP_PATH||'';
  if(!path.isAbsolute(file))abort('RESTORE_VERIFY_BACKUP_ABSOLUTE_PATH_REQUIRED');
  let encrypted;
  try{encrypted=readEncryptedArchive(file);}
  catch{abort('RESTORE_VERIFY_BACKUP_FILE_UNSAFE');}
  if(hash(encrypted)!==args.expectedBackupSha)
    abort('RESTORE_VERIFY_BACKUP_SHA_MISMATCH');
  const key=process.env.SUTRADHAR_BACKUP_KEY_BASE64||'';
  if(!key)abort('RESTORE_VERIFY_BACKUP_KEY_REQUIRED');
  const proof=decryptDump(encrypted,{
    keyBase64:key,expectedSourceDb:args.sourceDb});
  proof.plain.fill(0);
  const host=process.env.DB_HOST||'',user=process.env.DB_USER||'';
  const password=process.env.DB_PASSWORD||'';
  const port=Number(process.env.DB_PORT||3306);
  if(!/^[A-Za-z0-9._:-]{1,200}$/.test(host)||!user||!password||
     /[\r\n]/.test(password)||!Number.isInteger(port)||port<1||port>65535)
    abort('RESTORE_VERIFY_DB_CREDENTIALS_INVALID');
  const mysql=require('mysql2/promise');
  const opts={host,user,password,port,dateStrings:true,
    supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false,
    connectTimeout:10000};
  const src=await mysql.createConnection({...opts,database:args.sourceDb});
  let dst=null;
  try{
    dst=await mysql.createConnection({...opts,database:args.targetDb});
    for(const conn of [src,dst]){
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    }
    const query=conn=>async(sql,params)=>(await conn.execute(sql,params))[0];
    const result=await compare({...args,
      sourceQuery:query(src),targetQuery:query(dst)});
    console.log(JSON.stringify(result,null,2));
  }finally{
    for(const conn of [src,dst].filter(Boolean)){
      try{await conn.rollback();}catch{}
      await conn.end();
    }
  }
}
if(require.main===module)main().catch(error=>{
  // Only the dedicated disposable loopback CI database may reveal a small
  // allowlisted error CODE for diagnosing regression tests. No SQL, secrets,
  // raw rows, stack traces, paths or remote database responses are logged.
  if(process.env.NODE_ENV==='test'&&process.env.DB_HOST==='127.0.0.1'&&
     process.env.DB_NAME==='sutradhar_backup_ci_source'&&
     process.env.SUTRADHAR_MYSQL_RECOVERY_TEST_SENTINEL==='disposable-only'){
    const raw=String(error?.code||error?.message||'');
    const sanitized=/^(?:RESTORE_VERIFY_[A-Z_]+|ER_[A-Z_]+)$/.test(raw)?
      raw:String(error?.name||'UNKNOWN').replace(/[^A-Z_a-z]/g,'').slice(0,40);
    console.error('DISPOSABLE_CI_RESTORE_DIAGNOSTIC:'+sanitized);
  }
  console.error('STAGING_RESTORE_READ_ONLY_VERIFICATION_FAILED');
  process.exitCode=1;
});
module.exports={compare,validate,inventory,pack};
