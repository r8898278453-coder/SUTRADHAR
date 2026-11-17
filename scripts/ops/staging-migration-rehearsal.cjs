/**
 * STAGING-ONLY one-step additive MySQL v7->v8 rehearsal executor.
 * Experimental: no production authority and no auto-retry after partial DDL.
 * Has no committed v8 migration to execute until independently reviewed.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {plan,hash}=require('./versioned-migration-plan.cjs');
const {inspect}=require('./staging-schema-inspect.cjs');
const HEX=/^[0-9a-f]{64}$/;
const NAME=/^[A-Za-z0-9_]{1,64}$/;
function fail(code){throw Error(code);}
function validateIntent({target,source,approved,confirmTarget,backupReceiptSha,expectedVersion}){
  if(!NAME.test(target||'')||!NAME.test(source||'')||target===source||
     !/(?:^|_)(?:staging|stage|disposable|test|qa|ci)(?:_|$)/i.test(target)||
     approved!=='yes'||confirmTarget!==target||!HEX.test(backupReceiptSha||'')||
     expectedVersion!==8)fail('STAGING_REHEARSAL_EXACT_INTENT_REQUIRED');
}
function additiveStatements(source){
  if(typeof source!=='string'||Buffer.byteLength(source)>65536||
     /\/\*|\*\/|--|#|\\0/.test(source))fail('STAGING_REHEARSAL_SQL_COMMENTS_BLOCKED');
  const statements=source.split(';').map(x=>x.trim()).filter(Boolean);
  if(!statements.length||statements.length>10)fail('STAGING_REHEARSAL_SQL_INVALID');
  for(const s of statements){
    const nullable=/^ALTER\s+TABLE\s+v7_[a-z0-9_]+\s+ADD\s+COLUMN\s+[a-z][a-z0-9_]*\s+(?:VARCHAR\([1-9][0-9]{0,3}\)|CHAR\([1-9][0-9]{0,2}\)|INT|BIGINT|TEXT|DATETIME\(3\))\s+NULL$/i.test(s);
    const index=/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+[a-z][a-z0-9_]*\s+ON\s+v7_[a-z0-9_]+\s*\(\s*[a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*){0,3}\s*\)$/i.test(s);
    if(!nullable&&!index)fail('STAGING_REHEARSAL_SQL_OUTSIDE_ADDITIVE_ALLOWLIST');
  }
  return statements;
}
async function rehearsal({db,manifest,readFile,schemaText,intent}){
  validateIntent(intent);
  if(!db||typeof db.query!=='function')fail('STAGING_REHEARSAL_DB_REQUIRED');
  const [currentDb]=await db.query('SELECT DATABASE() AS name');
  if(!Array.isArray(currentDb)||currentDb.length!==1||
     currentDb[0].name!==intent.target)fail('STAGING_REHEARSAL_DATABASE_MISMATCH');
  // A fixed lock belongs to this staging database and avoids two parallel
  // operators running DDL against the same cluster version.
  const lockName='sut_staging_migration_'+hash(intent.target).slice(0,28);
  const [lock]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]);
  if(Number(lock?.[0]?.acquired)!==1)fail('STAGING_REHEARSAL_LOCK_BUSY');
  try{
    const [vers]=await db.query('SELECT version FROM v7_schema_versions ORDER BY version ASC');
    if(!Array.isArray(vers)||vers.length!==1||Number(vers[0].version)!==7)
      fail('STAGING_REHEARSAL_REQUIRES_EXACT_V7_BASELINE');
    const p=plan({manifest,readFile,observedVersions:[7],
      actualBaselineSha:hash(schemaText),expectedTarget:8});
    if(p.pending.length!==1||p.pending[0].from_version!==7||
       p.pending[0].to_version!==8)fail('STAGING_REHEARSAL_REQUIRES_SINGLE_V8');
    // Verify actual baseline, not just schema_versions=7.
    const status=await inspect({target:intent.target,source:intent.source,approved:'yes',
      expectedSha:hash(schemaText),schemaText,query:(q,args)=>db.query(q,args)});
    if(!status.accepted)fail('STAGING_REHEARSAL_BASELINE_DRIFT');
    // The planning read is not the execution read. Recheck the EXACT bytes
    // used for DDL so a swapped source file cannot bypass manifest approval.
    const m=p.pending[0],executionSource=readFile(m.file);
    if(typeof executionSource!=='string'||hash(executionSource)!==m.sha256)
      fail('STAGING_REHEARSAL_EXECUTION_SOURCE_CHANGED');
    const statements=additiveStatements(executionSource);
    const id='schema_version_8';
    // Existing STARTED/SUCCEEDED/FAILED audit row blocks ALL reruns.
    const [prior]=await db.query('SELECT migration_id FROM v7_migration_audit WHERE migration_id=?',[id]);
    if(!Array.isArray(prior)||prior.length)fail('STAGING_REHEARSAL_EXISTING_ATTEMPT');
    // Persist a claim BEFORE nontransactional MySQL DDL. If the process dies,
    // an incomplete claim requires operator reconciliation, never auto-retry.
    const [claim]=await db.query(
      'INSERT INTO v7_migration_audit(migration_id,source_sha256,record_counts,destination_counts) VALUES(?,?,?,?)',
      [id,m.sha256,JSON.stringify({status:'STARTED',backup_receipt_sha256:intent.backupReceiptSha}),
        JSON.stringify({status:'INCOMPLETE'})]);
    if(Number(claim?.affectedRows)!==1)fail('STAGING_REHEARSAL_AUDIT_WRITE_FAILED');
    let completed=0;
    try{
      for(const sql of statements){await db.query(sql);completed++;}
      await db.query('INSERT INTO v7_schema_versions(version) VALUES(?)',[8]);
      const [auditUpdated]=await db.query(
        'UPDATE v7_migration_audit SET destination_counts=? WHERE migration_id=? AND source_sha256=?',
        [JSON.stringify({status:'DDL_COMPLETE_UNVERIFIED',statements:completed}),id,m.sha256]);
      if(Number(auditUpdated?.affectedRows)!==1)
        fail('STAGING_REHEARSAL_AUDIT_FINALIZATION_FAILED');
    }catch{
      throw Error('STAGING_REHEARSAL_PARTIAL_DDL_MANUAL_REVIEW_AFTER_'+completed);
    }
    return {accepted:true,status:'STAGING_DDL_REHEARSED_NOT_VERIFIED',version:8,
      statements:completed,backup_receipt_self_reported:true,
      production_approved:false,restore_verified:false,app_compatibility_verified:false};
  }finally{
    try{await db.query('SELECT RELEASE_LOCK(?)',[lockName]);}catch{}
  }
}
async function main(){
  const base=path.resolve(__dirname,'../../migrations');
  const intent={target:process.env.SUTRADHAR_STAGING_DB_NAME,
    source:process.env.DB_NAME,
    approved:process.env.SUTRADHAR_STAGING_REHEARSAL_APPROVED,
    confirmTarget:process.env.SUTRADHAR_STAGING_REHEARSAL_CONFIRM_DB,
    backupReceiptSha:process.env.SUTRADHAR_STAGING_BACKUP_RECEIPT_SHA256,
    expectedVersion:Number(process.env.SUTRADHAR_STAGING_REHEARSAL_TARGET_VERSION)};
  validateIntent(intent); // before DB connection, credentials or side effects
  if(!process.env.DB_HOST||!process.env.DB_USER||!process.env.DB_PASSWORD)
    fail('STAGING_REHEARSAL_CREDENTIALS_REQUIRED');
  const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
  const schemaText=fs.readFileSync(path.resolve(__dirname,'../../v7/schema.sql'),'utf8');
  const mysql=require('mysql2/promise');
  const db=await mysql.createConnection({host:process.env.DB_HOST,
    port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,database:intent.target,
    multipleStatements:false,connectTimeout:10000});
  try{
    const result=await rehearsal({db,manifest,schemaText,intent,
      readFile:file=>fs.readFileSync(path.join(base,file),'utf8')});
    console.log(JSON.stringify(result,null,2));
  }finally{await db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.message||'STAGING_REHEARSAL_FAILED');process.exitCode=1;});
module.exports={validateIntent,additiveStatements,rehearsal};
