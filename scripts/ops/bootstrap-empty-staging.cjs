/**
 * One-time bootstrap of a new EMPTY, dedicated MySQL staging database.
 * Explicitly NOT an incremental or production migration engine. DDL commits
 * per statement in MySQL; partial failure requires operator review.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const NAME=/^[A-Za-z0-9_]{1,64}$/;
const HASH=/^[a-f0-9]{64}$/;
function plan({target,source,approved,expectedSha,schemaText}){
  if(!NAME.test(target||'')||!NAME.test(source||'')||target===source||
    !/(?:^|_)(?:staging|stage|test|disposable|ci|qa)(?:_|$)/i.test(target)||
    approved!=='yes'||!HASH.test(expectedSha||''))
    throw Error('STAGING_BOOTSTRAP_TARGET_NOT_APPROVED');
  if(typeof schemaText!=='string'||schemaText.length>1024*1024||
     crypto.createHash('sha256').update(schemaText).digest('hex')!==expectedSha)
    throw Error('STAGING_BOOTSTRAP_SCHEMA_HASH_MISMATCH');
  const clean=schemaText.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');
  const statements=clean.split(';').map(s=>s.trim()).filter(Boolean);
  if(statements.length<5||statements.length>100||
     statements.some(sql=>!/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+v7_[A-Za-z0-9_]+\s*\(/i.test(sql)||
       /\b(?:DROP|TRUNCATE|DELETE|UPDATE|GRANT|REVOKE|ALTER|INSERT|REPLACE|LOAD|OUTFILE|PROCEDURE|FUNCTION|TRIGGER)\b/i.test(sql)))
    throw Error('STAGING_BOOTSTRAP_SQL_NOT_ALLOWLISTED');
  const names=statements.map(s=>/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(v7_[A-Za-z0-9_]+)/i.exec(s)[1].toLowerCase());
  if(new Set(names).size!==names.length||!names.includes('v7_schema_versions')||!names.includes('v7_cluster'))
    throw Error('STAGING_BOOTSTRAP_TABLES_INVALID');
  return Object.freeze({target,source,expectedSha,statements});
}
async function apply({spec,query}){
  if(!spec||!Array.isArray(spec.statements)||typeof query!=='function')
    throw Error('STAGING_BOOTSTRAP_PLAN_REQUIRED');
  // No data or existing tables may be touched; CREATE IF NOT EXISTS alone is
  // not sufficient to prove a safe migration of an existing schema.
  const [rows]=await query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=?',[spec.target]);
  if(!Array.isArray(rows)||rows.length!==1||!Number.isSafeInteger(Number(rows[0].n))||
    Number(rows[0].n)!==0)throw Error('STAGING_BOOTSTRAP_DATABASE_NOT_EMPTY');
  let completed=0;
  try{
    for(const statement of spec.statements){await query(statement,[]);completed++;}
    await query('INSERT IGNORE INTO v7_schema_versions(version) VALUES(7)',[]);
    await query('INSERT IGNORE INTO v7_cluster(singleton) VALUES(1)',[]);
  }catch{
    // MySQL DDL auto-commits. DO NOT pretend a transaction rolled back tables.
    throw Error('STAGING_BOOTSTRAP_PARTIAL_FAILURE_MANUAL_REVIEW_REQUIRED_AFTER_'+completed);
  }
  return {accepted:true,operation:'STAGING_EMPTY_DB_BOOTSTRAPPED',table_statements:completed,
    source_sha256:spec.expectedSha,target_db:spec.target,production_accepted:false,
    restore_proven:false,incremental_migration_supported:false};
}
async function main(){
  const schemaText=fs.readFileSync(path.resolve(__dirname,'../../v7/schema.sql'),'utf8');
  const spec=plan({target:process.env.SUTRADHAR_STAGING_DB_NAME||'',
    source:process.env.DB_NAME||'',approved:process.env.SUTRADHAR_STAGING_BOOTSTRAP_APPROVED,
    expectedSha:process.env.SUTRADHAR_EXPECTED_SCHEMA_SHA256||'',schemaText});
  if(!process.env.DB_HOST||!process.env.DB_USER||!process.env.DB_PASSWORD)
    throw Error('STAGING_BOOTSTRAP_DB_CREDENTIALS_REQUIRED');
  const mysql=require('mysql2/promise');
  const connection=await mysql.createConnection({host:process.env.DB_HOST,
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,
    port:Number(process.env.DB_PORT||3306),database:spec.target,
    multipleStatements:false,connectTimeout:10000});
  try{
    const result=await apply({spec,query:(sql,args)=>connection.query(sql,args)});
    console.log(JSON.stringify(result,null,2));
  }finally{await connection.end();}
}
if(require.main===module)main().catch(e=>{
  console.error(String(e.message||'STAGING_BOOTSTRAP_FAILED'));process.exitCode=1;
});
module.exports={plan,apply};
