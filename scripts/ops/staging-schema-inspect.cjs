/**
 * Read-only staging schema inventory. Never creates, alters or drops tables.
 * A match is NOT migration approval or a restore rehearsal.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DB=/^[A-Za-z0-9_]{1,64}$/;
const HEX=/^[a-f0-9]{64}$/;
const {expectedColumns,compareColumns}=require('./schema-column-inventory.cjs');
const {expectedStructure,compareStructure}=require('./schema-structure-inventory.cjs');
const {expectedForeignKeys,compareForeignKeys}=require('./schema-foreign-key-inventory.cjs');
function expectedTables(schema){
  if(typeof schema!=='string'||schema.length>1024*1024)throw Error('SCHEMA_SOURCE_INVALID');
  const tables=[...schema.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?(v7_[A-Za-z0-9_]+)`?\s*\(/gi)]
    .map(m=>m[1].toLowerCase());
  if(tables.length<5||new Set(tables).size!==tables.length)
    throw Error('SCHEMA_TABLE_LIST_INVALID');
  return tables.sort();
}
function validateTarget({target,source,approved,expectedSha,schemaText}){
  if(!DB.test(target||'')||!DB.test(source||'')||target===source||
    !/(?:^|_)(?:stage|staging|test|disposable|qa|ci)(?:_|$)/i.test(target)||
    approved!=='yes'||!HEX.test(expectedSha||''))
    throw Error('STAGING_SCHEMA_TARGET_NOT_APPROVED');
  const actual=crypto.createHash('sha256').update(schemaText).digest('hex');
  if(actual!==expectedSha)throw Error('STAGING_SCHEMA_SOURCE_SHA_MISMATCH');
  return expectedTables(schemaText);
}
async function inspect({target,source,approved,expectedSha,schemaText,query}){
  const tables=validateTarget({target,source,approved,expectedSha,schemaText});
  if(typeof query!=='function')throw Error('STAGING_SCHEMA_DB_READER_UNAVAILABLE');
  const [rows]=await query('SELECT table_name, engine FROM information_schema.tables WHERE table_schema=? AND table_type=?',
    [target,'BASE TABLE']);
  if(!Array.isArray(rows))throw Error('STAGING_SCHEMA_INVENTORY_INVALID');
  const observed=new Map();
  for(const row of rows){
    const name=String(row.table_name||row.TABLE_NAME||'').toLowerCase();
    const engine=String(row.engine||row.ENGINE||'').toUpperCase();
    if(!/^v7_[a-z0-9_]+$/.test(name)||observed.has(name)||engine!=='INNODB')
      throw Error('STAGING_SCHEMA_UNEXPECTED_OR_NON_INNODB_TABLE');
    observed.set(name,engine);
  }
  const missing=tables.filter(t=>!observed.has(t));
  const extra=[...observed.keys()].filter(t=>!tables.includes(t));
  // Read-only live column inventory: names cannot silently disappear/appear.
  // This does not prove type/default/index/FK compatibility.
  const [columnRows]=await query(
    'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=?',
    [target]);
  const columns=compareColumns(expectedColumns(schemaText),columnRows);
  const [indexRows]=await query(
    'SELECT table_name,index_name,seq_in_index,column_name,non_unique FROM information_schema.statistics WHERE table_schema=?',
    [target]);
  const structure=compareStructure(expectedStructure(schemaText),columnRows,indexRows);
  const [foreignKeyRows]=await query(
    'SELECT k.table_name,k.constraint_name,k.column_name,k.ordinal_position,k.referenced_table_schema,k.referenced_table_name,k.referenced_column_name,r.delete_rule,r.update_rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.constraint_name=k.constraint_name AND r.table_name=k.table_name WHERE k.table_schema=? AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name,k.constraint_name,k.ordinal_position',
    [target]);
  const foreignKeys=compareForeignKeys(expectedForeignKeys(schemaText),foreignKeyRows,target);
  let schemaVersion=null;
  if(!missing.includes('v7_schema_versions')){
    const [v]=await query('SELECT version FROM v7_schema_versions ORDER BY version DESC LIMIT 2',[]);
    if(!Array.isArray(v)||v.length!==1||!Number.isSafeInteger(Number(v[0].version)))
      throw Error('STAGING_SCHEMA_VERSION_INVALID');
    schemaVersion=Number(v[0].version);
  }
  return {accepted:missing.length===0&&extra.length===0&&schemaVersion===7&&columns.accepted&&structure.accepted&&foreignKeys.accepted,
    status:'STAGING_SCHEMA_READ_ONLY_INVENTORY',source_sha256:expectedSha,
    column_inventory:columns,structure_inventory:structure,foreign_key_inventory:foreignKeys,
    expected_table_count:tables.length,observed_table_count:observed.size,
    missing,extra,schema_version:schemaVersion,production_accepted:false,
    migration_executed:false,restore_proven:false};
}
async function main(){
  const schemaPath=path.resolve(__dirname,'../../v7/schema.sql');
  const schemaText=fs.readFileSync(schemaPath,'utf8');
  const target=process.env.SUTRADHAR_STAGING_DB_NAME||'';
  const source=process.env.DB_NAME||'';
  const approved=process.env.SUTRADHAR_STAGING_SCHEMA_CHECK_APPROVED;
  const expectedSha=process.env.SUTRADHAR_EXPECTED_SCHEMA_SHA256||'';
  // Validate everything before creating a database connection.
  validateTarget({target,source,approved,expectedSha,schemaText});
  if(!process.env.DB_HOST||!process.env.DB_USER||!process.env.DB_PASSWORD)
    throw Error('STAGING_SCHEMA_DB_CREDENTIALS_MISSING');
  const mysql=require('mysql2/promise');
  const connection=await mysql.createConnection({
    host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:target,
    connectTimeout:10000,multipleStatements:false});
  try{
    const result=await inspect({target,source,approved,expectedSha,schemaText,
      query:(sql,params)=>connection.query(sql,params)});
    console.log(JSON.stringify(result,null,2));
    if(!result.accepted)process.exitCode=1;
  }finally{await connection.end();}
}
if(require.main===module)main().catch(()=>{console.error('STAGING_SCHEMA_READ_ONLY_CHECK_FAILED');process.exitCode=1;});
module.exports={expectedTables,validateTarget,inspect};
