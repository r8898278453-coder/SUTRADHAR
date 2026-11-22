/**
 * Independent READ-ONLY v8 staging migration postcheck.
 * Confirms committed version/audit metadata and the actual nonce index.
 * This is not evidence of live Hostinger acceptance, data recovery or release.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validateManifest,hash}=require('./versioned-migration-plan.cjs');
const NAME=/^[A-Za-z0-9_]{1,64}$/,HEX=/^[a-f0-9]{64}$/;
function fail(code){throw Error(code);}
function validatePostcheckIntent(intent,manifest,readFile,schemaText){
  if(!intent||!NAME.test(intent.target||'')||!NAME.test(intent.source||'')||
     intent.target===intent.source||
     !/(?:^|_)(?:staging|stage|disposable|test|qa|ci)(?:_|$)/i.test(intent.target)||
     intent.approved!=='yes'||intent.confirmTarget!==intent.target||
     !HEX.test(intent.expectedMigrationSha||''))
    fail('STAGING_V8_EXACT_READ_ONLY_INTENT_REQUIRED');
  const spec=validateManifest(manifest,readFile);
  if(typeof schemaText!=='string'||hash(schemaText)!==spec.baseline_schema_sha256)
    fail('STAGING_V8_BASELINE_SOURCE_DRIFT');
  if(spec.latest_version!==8||spec.migrations.length!==1||
     spec.migrations[0].from_version!==7||spec.migrations[0].to_version!==8||
     spec.migrations[0].sha256!==intent.expectedMigrationSha)
    fail('STAGING_V8_REVIEWED_MIGRATION_MISMATCH');
  return spec.migrations[0];
}
function parseAuditField(value){
  let parsed=value;
  if(typeof value==='string'){
    try{parsed=JSON.parse(value);}catch{fail('STAGING_V8_AUDIT_INVALID');}
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    fail('STAGING_V8_AUDIT_INVALID');
  return parsed;
}
function exactVersions(rows){
  return Array.isArray(rows)&&rows.length===2&&
    Number(rows[0]?.version)===7&&Number(rows[1]?.version)===8;
}
async function verifyPostV8({db,manifest,readFile,schemaText,intent}){
  const migration=validatePostcheckIntent(intent,manifest,readFile,schemaText);
  if(!db||typeof db.query!=='function')fail('STAGING_V8_READ_ONLY_DB_REQUIRED');
  const [connected]=await db.query('SELECT DATABASE() AS name');
  if(!Array.isArray(connected)||connected.length!==1||
     connected[0]?.name!==intent.target)fail('STAGING_V8_DATABASE_MISMATCH');
  const [before]=await db.query('SELECT version FROM v7_schema_versions ORDER BY version ASC');
  if(!exactVersions(before))fail('STAGING_V8_VERSION_HISTORY_DRIFT');
  const [audits]=await db.query(
    'SELECT source_sha256,record_counts,destination_counts FROM v7_migration_audit WHERE migration_id=?',
    ['schema_version_8']);
  if(!Array.isArray(audits)||audits.length!==1||
     audits[0]?.source_sha256!==migration.sha256)fail('STAGING_V8_AUDIT_SOURCE_DRIFT');
  const started=parseAuditField(audits[0].record_counts);
  const completed=parseAuditField(audits[0].destination_counts);
  if(started.status!=='STARTED'||!HEX.test(started.backup_receipt_sha256||'')||
     completed.status!=='DDL_COMPLETE_UNVERIFIED'||completed.statements!==1)
    fail('STAGING_V8_AUDIT_INCOMPLETE');
  const [indexes]=await db.query(
    'SELECT index_name AS index_name,seq_in_index AS seq_in_index,'+
    'column_name AS column_name,non_unique AS non_unique FROM information_schema.statistics '+
    'WHERE table_schema=? AND table_name=? AND index_name=?',
    [intent.target,'v7_nonces','idx_nonce_received_at']);
  if(!Array.isArray(indexes)||indexes.length!==1||
     indexes[0]?.index_name!=='idx_nonce_received_at'||
     indexes[0]?.column_name!=='received_at'||
     Number(indexes[0]?.seq_in_index)!==1||
     Number(indexes[0]?.non_unique)!==1)
    fail('STAGING_V8_INDEX_DRIFT');
  const [after]=await db.query('SELECT version FROM v7_schema_versions ORDER BY version ASC');
  if(!exactVersions(after))fail('STAGING_V8_VERSION_HISTORY_CHANGED');
  return {accepted:true,status:'READ_ONLY_V8_METADATA_POSTCHECK',
    database:intent.target,source_migration_sha256:migration.sha256,
    schema_versions:[7,8],index:'v7_nonces.idx_nonce_received_at(received_at)',
    backup_receipt_self_reported:true,
    sql_writes_performed:false,migration_execution_allowed:false,
    real_hostinger_accepted:false,restore_verified:false,
    application_compatibility_verified:false,production_approved:false};
}
async function main(){
  const root=path.resolve(__dirname,'../..');
  const base=path.join(root,'migrations');
  const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
  const schemaText=fs.readFileSync(path.join(root,'v7/schema.sql'),'utf8');
  const intent={target:process.env.SUTRADHAR_STAGING_DB_NAME,
    source:process.env.DB_NAME,
    approved:process.env.SUTRADHAR_STAGING_V8_POSTCHECK_APPROVED,
    confirmTarget:process.env.SUTRADHAR_STAGING_V8_POSTCHECK_CONFIRM_DB,
    expectedMigrationSha:process.env.SUTRADHAR_EXPECTED_V8_MIGRATION_SHA256};
  validatePostcheckIntent(intent,manifest,
    file=>fs.readFileSync(path.join(base,file),'utf8'),schemaText);
  if(!process.env.DB_HOST||!process.env.DB_USER||!process.env.DB_PASSWORD)
    fail('STAGING_V8_READ_ONLY_CREDENTIALS_REQUIRED');
  const mysql=require('mysql2/promise');
  const db=await mysql.createConnection({
    host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,
    database:intent.target,connectTimeout:10000,multipleStatements:false});
  try{
    console.log(JSON.stringify(await verifyPostV8({db,manifest,schemaText,intent,
      readFile:file=>fs.readFileSync(path.join(base,file),'utf8')}),null,2));
  }finally{await db.end();}
}
if(require.main===module)main().catch(e=>{
  console.error(e.message||'STAGING_V8_POSTCHECK_REJECTED');process.exitCode=1;
});
module.exports={validatePostcheckIntent,verifyPostV8,parseAuditField};
