/**
 * Controlled legacy SQLite -> MySQL inventory staging, never a blind cutover.
 * Import only non-secret metadata, verify counts/hashes, and keep all imported
 * tickets quarantined until explicit project-by-project reconciliation.
 */
import {DatabaseSync} from 'node:sqlite';
import mysql from 'mysql2/promise';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
const source=process.argv[2],migrationId=process.argv[3];
if(process.env.SUTRADHAR_MIGRATION_APPROVED!=='yes'||!source||!migrationId||
   !/^[a-zA-Z0-9_-]{4,100}$/.test(migrationId))
  throw new Error('Requires SUTRADHAR_MIGRATION_APPROVED=yes, SQLite file, migration ID');
const abs=path.resolve(source);
const backup=process.env.SUTRADHAR_LEGACY_BACKUP_SHA256||'';
const hash=(s:string|Buffer)=>crypto.createHash('sha256').update(s).digest('hex');
const original=fs.readFileSync(abs);
if(hash(original)!==backup||!/^[0-9a-f]{64}$/.test(backup))
  throw new Error('SQLite source must match a verified off-machine backup SHA256');
const sqlite=new DatabaseSync(abs,{readOnly:true});
const tables:{
  name:string;id:(x:any)=>string;cols:string[];
}[]=[
  {name:'projects',id:x=>x.project_id,cols:['project_id','name','git_repo_url','status']},
  {name:'tickets',id:x=>x.ticket_id,cols:['ticket_id','project_id','title','status','assigned_to']},
  {name:'workers',id:x=>x.worker_id,cols:['worker_id','name','role','last_seen']},
  {name:'ticket_dependencies',id:x=>x.parent_ticket_id+'_'+x.child_ticket_id,
    cols:['parent_ticket_id','child_ticket_id']},
  {name:'audit_log',id:x=>x.log_id,cols:['log_id','timestamp','actor','action','ticket_id']}
];
const rowsByTable=new Map<string,{id:string;payload:string;sha:string}[]>();
const counts:Record<string,number>={};
for(const table of tables){
  const safe=table.cols.join(',');
  const input=sqlite.prepare('SELECT '+safe+' FROM '+table.name).all() as any[];
  counts[table.name]=input.length;
  rowsByTable.set(table.name,input.map(x=>{
    const id=String(table.id(x));
    if(!id||id.length>120)throw new Error('Invalid legacy record ID');
    const payload=JSON.stringify(Object.fromEntries(table.cols.map(k=>[k,x[k]])));
    return {id,payload,sha:hash(payload)};
  }));
}
sqlite.close();
const pool=mysql.createPool(process.env.SUTRADHAR_MYSQL_URL||{
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  waitForConnections:true,connectionLimit:2
});
const c=await pool.getConnection();
try{
  await c.query("SET time_zone = '+00:00'");
  await c.beginTransaction();
  const [existing]:any=await c.query('SELECT migration_id FROM v7_migration_audit WHERE migration_id=? FOR UPDATE',[migrationId]);
  if(existing.length)throw new Error('Migration ID already used; inspect previous evidence');
  for(const table of tables){
    for(const row of rowsByTable.get(table.name)||[]){
      const [prior]:any=await c.query('SELECT source_sha256 FROM v7_legacy_imports WHERE source_table=? AND source_id=? FOR UPDATE',
        [table.name,row.id]);
      if(prior.length&&prior[0].source_sha256!==row.sha)
        throw new Error('Conflict with previously imported legacy record');
      await c.query('INSERT IGNORE INTO v7_legacy_imports(source_table,source_id,source_sha256,safe_payload) VALUES(?,?,?,?)',
        [table.name,row.id,row.sha,row.payload]);
    }
  }
  const destination:Record<string,number>={};
  for(const table of tables){
    const [results]:any=await c.query('SELECT COUNT(*) n FROM v7_legacy_imports WHERE source_table=?',[table.name]);
    destination[table.name]=Number(results[0].n);
    if(destination[table.name]!==counts[table.name])throw new Error('Legacy record count mismatch: '+table.name);
  }
  await c.query('INSERT INTO v7_migration_audit(migration_id,source_sha256,record_counts,destination_counts) VALUES(?,?,?,?)',
    [migrationId,backup,JSON.stringify(counts),JSON.stringify(destination)]);
  await c.commit();
  console.log(JSON.stringify({staged:true,authoritative:false,migration_id:migrationId,source_sha256:backup,
    source_counts:counts,destination_counts:destination},null,2));
}catch(e){await c.rollback();throw e;}finally{c.release();await pool.end();}
