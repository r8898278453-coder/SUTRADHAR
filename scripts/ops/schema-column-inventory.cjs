/**
 * Structural column inventory for the pinned v7 SQL baseline.
 * Read-only inspection of column NAMES only; SQL type/index/FK/default
 * compatibility must be validated by independent DBA/QA review.
 */
'use strict';
function fail(code){throw Error(code);}
function splitTopLevel(text){
  const out=[];let quote=null,depth=0,start=0;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quote){
      if(ch==='\\'&&i+1<text.length){i++;continue;}
      if(ch===quote){if(text[i+1]===quote){i++;continue;}quote=null;}
      continue;
    }
    if(ch==="'"||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='('){depth++;continue;}
    if(ch===')'){if(--depth<0)fail('SCHEMA_COLUMN_PAREN_INVALID');continue;}
    if(ch===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}
  }
  if(depth!==0||quote)fail('SCHEMA_COLUMN_PAREN_INVALID');
  out.push(text.slice(start).trim());
  return out;
}
function expectedColumns(schemaText){
  if(typeof schemaText!=='string'||schemaText.length>1024*1024)
    fail('SCHEMA_COLUMN_SOURCE_INVALID');
  const text=schemaText.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');
  const result={};const re=/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?(v7_[a-z0-9_]+)`?\s*\(/gi;
  for(const m of text.matchAll(re)){
    const table=m[1].toLowerCase();if(result[table])fail('SCHEMA_COLUMN_DUPLICATE_TABLE');
    const start=m.index+m[0].length;let depth=1,end=-1,quote=null;
    for(let i=start;i<text.length;i++){
      const ch=text[i];
      if(quote){
        if(ch==='\\'&&i+1<text.length){i++;continue;}
        if(ch===quote){if(text[i+1]===quote){i++;continue;}quote=null;}
      }else if(ch==="'"||ch==='"'||ch==='`'){quote=ch;}
      else if(ch==='(')depth++;
      else if(ch===')'&&--depth===0){end=i;break;}
    }
    if(end<0||quote)fail('SCHEMA_COLUMN_PAREN_INVALID');
    const columns=[];
    for(const item of splitTopLevel(text.slice(start,end))){
      const column=/^`?([a-z][a-z0-9_]*)`?\s+(?:BIGINT|INT|TINYINT|SMALLINT|VARCHAR|CHAR|TEXT|LONGTEXT|MEDIUMTEXT|DATETIME|TIMESTAMP|JSON|ENUM|BOOLEAN|DECIMAL|BLOB|VARBINARY)\b/i.exec(item);
      if(column)columns.push(column[1].toLowerCase());
      else if(!/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE(?:\s+KEY|\s+INDEX)?|INDEX|KEY|CONSTRAINT|CHECK)\b/i.test(item))
        fail('SCHEMA_COLUMN_UNKNOWN_DEFINITION');
    }
    if(columns.length===0||new Set(columns).size!==columns.length)
      fail('SCHEMA_COLUMN_INVALID_OR_DUPLICATE');
    result[table]=columns.sort();
  }
  if(Object.keys(result).length<5)fail('SCHEMA_COLUMN_TABLES_INCOMPLETE');
  return result;
}
function compareColumns(expected,rows){
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||!Array.isArray(rows))
    fail('SCHEMA_COLUMN_INVENTORY_INVALID');
  const observed=new Map();
  for(const row of rows){
    const table=String(row?.table_name||row?.TABLE_NAME||'').toLowerCase();
    if(!/^v7_[a-z0-9_]+$/.test(table))continue;
    const name=String(row?.column_name||row?.COLUMN_NAME||'').toLowerCase();
    if(!/^[a-z][a-z0-9_]*$/.test(name))fail('SCHEMA_COLUMN_INVENTORY_INVALID');
    if(!observed.has(table))observed.set(table,new Set());
    if(observed.get(table).has(name))fail('SCHEMA_COLUMN_DUPLICATE_OBSERVATION');
    observed.get(table).add(name);
  }
  const missing=[],extra=[];
  for(const [table,columns] of Object.entries(expected)){
    for(const column of columns)if(!observed.get(table)?.has(column))missing.push(table+'.'+column);
  }
  for(const [table,columns] of observed){
    for(const column of columns)if(!expected[table]?.includes(column))extra.push(table+'.'+column);
  }
  return {accepted:missing.length===0&&extra.length===0,missing:missing.sort(),extra:extra.sort(),
    expected_column_count:Object.values(expected).reduce((n,a)=>n+a.length,0),
    observed_column_count:[...observed.values()].reduce((n,a)=>n+a.size,0),
    verified_column_names_only:true,types_indexes_and_foreign_keys_verified:false};
}
module.exports={expectedColumns,compareColumns,splitTopLevel};
