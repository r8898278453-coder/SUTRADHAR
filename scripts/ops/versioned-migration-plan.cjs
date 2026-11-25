/**
 * SUTRADHAR reviewed schema migration PLAN verifier.
 * Read-only planning only: no SQL execution, release promotion or production
 * permission. A future executor MUST add independently reviewed safeguards.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const HEX=/^[0-9a-f]{64}$/;
const ID=/^v[1-9][0-9]{0,3}__[a-z][a-z0-9_]{2,70}\.sql$/;
function fail(code){throw Error(code);}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function validateManifest(manifest,readFile){
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
     Object.keys(manifest).sort().join('|')!=='baseline_schema_sha256|baseline_version|migrations|schema')
    fail('MIGRATION_MANIFEST_SHAPE_INVALID');
  if(manifest.schema!==1||manifest.baseline_version!==7||
     !HEX.test(manifest.baseline_schema_sha256)||!Array.isArray(manifest.migrations)||
     manifest.migrations.length>100||typeof readFile!=='function')
    fail('MIGRATION_MANIFEST_INVALID');
  const migrations=[];
  let last=7;
  for(const m of manifest.migrations){
    if(!m||typeof m!=='object'||Array.isArray(m)||
       Object.keys(m).sort().join('|')!=='file|from_version|sha256|to_version'||
       !Number.isSafeInteger(m.from_version)||!Number.isSafeInteger(m.to_version)||
       m.from_version!==last||m.to_version!==last+1||!HEX.test(m.sha256)||
       typeof m.file!=='string'||!ID.test(m.file)||
       !m.file.startsWith('v'+m.to_version+'__'))
      fail('MIGRATION_ORDER_OR_PATH_INVALID');
    const source=readFile(m.file);
    if(typeof source!=='string'||Buffer.byteLength(source)>65536||
       hash(source)!==m.sha256)fail('MIGRATION_SOURCE_HASH_MISMATCH');
    // Planning does not assert DDL is safe to execute. SQL is deliberately
    // not executed or interpreted here, and requires independent review.
    migrations.push(Object.freeze({from_version:m.from_version,
      to_version:m.to_version,file:m.file,sha256:m.sha256}));
    last=m.to_version;
  }
  return Object.freeze({baseline_version:7,baseline_schema_sha256:manifest.baseline_schema_sha256,
    migrations,latest_version:last});
}
function plan({manifest,readFile,observedVersions,actualBaselineSha,expectedTarget}){
  const spec=validateManifest(manifest,readFile);
  if(!HEX.test(actualBaselineSha||'')||actualBaselineSha!==spec.baseline_schema_sha256)
    fail('MIGRATION_BASELINE_DRIFT');
  if(!Array.isArray(observedVersions)||observedVersions.length<1||
     observedVersions.some(v=>!Number.isSafeInteger(v)||v<7))
    fail('MIGRATION_HISTORY_INVALID');
  const seen=[...new Set(observedVersions)].sort((a,b)=>a-b);
  if(seen.length!==observedVersions.length||seen[0]!==7||
     seen.some((v,i)=>v!==7+i))fail('MIGRATION_HISTORY_GAP');
  const current=seen[seen.length-1];
  if(current>spec.latest_version)fail('MIGRATION_DATABASE_NEWER_THAN_SOURCE');
  if(!spec.migrations.slice(0,current-7).every((x,i)=>x.to_version===seen[i+1]))
    fail('MIGRATION_HISTORY_NOT_IN_MANIFEST');
  if(!Number.isSafeInteger(expectedTarget)||expectedTarget!==spec.latest_version)
    fail('MIGRATION_TARGET_NOT_EXPLICIT');
  return {accepted:true,mode:'READ_ONLY_PLAN',current_version:current,
    target_version:expectedTarget,pending:spec.migrations.filter(x=>x.to_version>current),
    migration_execution_allowed:false,production_approved:false,
    warning:'This checks manifest integrity and version sequence only; column/index/FK drift, real data, backward compatibility and restore require independent validation.'};
}
async function main(){
  const base=path.resolve(__dirname,'../../migrations');
  const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
  const schema=fs.readFileSync(path.resolve(__dirname,'../../v7/schema.sql'));
  const target=process.env.SUTRADHAR_STAGING_DB_NAME||'';
  const source=process.env.DB_NAME||'';
  if(!/^[a-zA-Z0-9_]{1,64}$/.test(target)||
     !/(?:^|_)(?:staging|stage|test|disposable|ci|qa)(?:_|$)/i.test(target)||
     !/^[a-zA-Z0-9_]{1,64}$/.test(source)||source===target||
     process.env.SUTRADHAR_MIGRATION_PLAN_APPROVED!=='yes')
    fail('MIGRATION_READ_ONLY_STAGING_TARGET_INVALID');
  if(!process.env.DB_HOST||!process.env.DB_USER||!process.env.DB_PASSWORD)
    fail('MIGRATION_STAGING_READ_ONLY_CREDENTIALS_REQUIRED');
  const mysql=require('mysql2/promise');
  const db=await mysql.createConnection({host:process.env.DB_HOST,
    port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,database:target,
    connectTimeout:10000,multipleStatements:false});
  try{
    const [versions]=await db.query('SELECT version FROM v7_schema_versions ORDER BY version ASC');
    if(!Array.isArray(versions)||versions.length>101)fail('MIGRATION_HISTORY_INVALID');
    const r=plan({manifest,readFile:file=>fs.readFileSync(path.join(base,file),'utf8'),
      observedVersions:versions.map(row=>Number(row.version)),
      actualBaselineSha:hash(schema),
      expectedTarget:Number(process.env.SUTRADHAR_MIGRATION_TARGET_VERSION)});
    console.log(JSON.stringify({...r,staging_db:target,observed_from_database:true},null,2));
  }finally{await db.end();}
}
if(require.main===module){
  main().catch(e=>{console.error(e.message||'MIGRATION_PLAN_REJECTED');process.exitCode=1;});
}
module.exports={validateManifest,plan,hash};
