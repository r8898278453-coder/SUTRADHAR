/**
 * Read-only v7 foreign-key relationship inventory. MySQL constraint NAMES
 * are server-generated and deliberately ignored: compare the relationship,
 * local/referenced column ordering, and ON DELETE/UPDATE actions instead.
 * A passing result is NOT approval for migration, restore or deployment.
 */
'use strict';
const {splitTopLevel}=require('./schema-column-inventory.cjs');
const TABLE=/^v7_[a-z0-9_]+$/;
const COLUMN=/^[a-z][a-z0-9_]*$/;
const fail=code=>{throw Error(code);};
function names(part){
  const out=part.split(',').map(s=>s.trim().replace(/^`|`$/g,'').toLowerCase());
  if(!out.length||out.some(s=>!COLUMN.test(s))||new Set(out).size!==out.length)
    fail('SCHEMA_FK_COLUMNS_INVALID');
  return out;
}
function action(value){
  const v=String(value||'RESTRICT').trim().toUpperCase().replace(/\s+/g,' ');
  if(!['RESTRICT','NO ACTION','CASCADE','SET NULL'].includes(v))
    fail('SCHEMA_FK_ACTION_UNSUPPORTED');
  return v==='NO ACTION'?'RESTRICT':v;
}
function key(fk){
  return JSON.stringify([fk.table,fk.columns,fk.ref_table,fk.ref_columns,fk.on_delete,fk.on_update]);
}
function expectedForeignKeys(schema){
  if(typeof schema!=='string'||schema.length>1024*1024)fail('SCHEMA_FK_SOURCE_INVALID');
  const clean=schema.split('\n').filter(s=>!s.trimStart().startsWith('--')).join('\n');
  const re=/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(v7_[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*ENGINE\s*=\s*InnoDB\s*;/gi;
  const result=[];let tables=0;
  for(const m of clean.matchAll(re)){
    tables++;const table=m[1].toLowerCase();
    for(const item of splitTopLevel(m[2])){
      if(!/^(?:CONSTRAINT\s+\`?[a-z0-9_]+\`?\s+)?FOREIGN\s+KEY\b/i.test(item))continue;
      const hit=/^(?:CONSTRAINT\s+\`?[a-z0-9_]+\`?\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+(v7_[a-z0-9_]+)\s*\(([^)]*)\)([\s\S]*)$/i.exec(item);
      if(!hit)fail('SCHEMA_FK_CLAUSE_UNSUPPORTED');
      const options=hit[4].trim();
      const del=/\bON\s+DELETE\s+(RESTRICT|NO\s+ACTION|CASCADE|SET\s+NULL)\b/i.exec(options);
      const upd=/\bON\s+UPDATE\s+(RESTRICT|NO\s+ACTION|CASCADE|SET\s+NULL)\b/i.exec(options);
      const remainder=options.replace(/\bON\s+(?:DELETE|UPDATE)\s+(?:RESTRICT|NO\s+ACTION|CASCADE|SET\s+NULL)\b/gi,'').trim();
      if(remainder)fail('SCHEMA_FK_CLAUSE_UNSUPPORTED');
      result.push({table,columns:names(hit[1]),ref_table:hit[2].toLowerCase(),
        ref_columns:names(hit[3]),on_delete:action(del?.[1]),on_update:action(upd?.[1])});
    }
  }
  if(tables<5)fail('SCHEMA_FK_TABLES_INCOMPLETE');
  const unique=new Set(result.map(key));
  if(unique.size!==result.length)fail('SCHEMA_FK_DUPLICATE_EXPECTED');
  return result;
}
function compareForeignKeys(expected,rows,expectedSchema){
  if(!Array.isArray(expected)||!Array.isArray(rows)||
     (expectedSchema!==undefined&&!/^[A-Za-z0-9_]{1,64}$/.test(expectedSchema)))
    fail('SCHEMA_FK_INVENTORY_INVALID');
  const groups=new Map();
  for(const r of rows){
    const table=String(r?.table_name||'').toLowerCase();
    const constraint=String(r?.constraint_name||'');
    if(!TABLE.test(table)||!constraint||constraint.length>128)
      fail('SCHEMA_FK_METADATA_INVALID');
    if(expectedSchema!==undefined&&r.referenced_table_schema!==expectedSchema)
      fail('SCHEMA_FK_CROSS_DATABASE_REFERENCE');
    const name=String(r.column_name||'').toLowerCase();
    const parent=String(r.referenced_table_name||'').toLowerCase();
    const parentName=String(r.referenced_column_name||'').toLowerCase();
    const seq=Number(r.ordinal_position);
    if(!COLUMN.test(name)||!TABLE.test(parent)||!COLUMN.test(parentName)||
       !Number.isSafeInteger(seq)||seq<1||seq>64)
      fail('SCHEMA_FK_METADATA_INVALID');
    const id=table+'\n'+constraint;
    const candidate={table,ref_table:parent,on_delete:action(r.delete_rule),
      on_update:action(r.update_rule),seq,col:name,ref:parentName};
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(candidate);
  }
  const found=[];
  for(const members of groups.values()){
    members.sort((a,b)=>a.seq-b.seq);
    const first=members[0];
    if(members.some((r,i)=>r.seq!==i+1||r.table!==first.table||
       r.ref_table!==first.ref_table||r.on_delete!==first.on_delete||
       r.on_update!==first.on_update))
      fail('SCHEMA_FK_METADATA_CONFLICT');
    found.push({table:first.table,columns:members.map(r=>r.col),
      ref_table:first.ref_table,ref_columns:members.map(r=>r.ref),
      on_delete:first.on_delete,on_update:first.on_update});
  }
  const counts=new Map();
  for(const fk of found)counts.set(key(fk),(counts.get(key(fk))||0)+1);
  const missing=[];
  for(const fk of expected){
    if((counts.get(key(fk))||0)>0)counts.set(key(fk),counts.get(key(fk))-1);
    else missing.push(key(fk));
  }
  const extra=[...counts].flatMap(([k,n])=>Array.from({length:n},()=>k));
  return {accepted:missing.length===0&&extra.length===0,missing,extra,
    expected_fk_count:expected.length,observed_fk_count:found.length,
    production_approved:false,ddl_executed:false};
}
module.exports={expectedForeignKeys,compareForeignKeys};
