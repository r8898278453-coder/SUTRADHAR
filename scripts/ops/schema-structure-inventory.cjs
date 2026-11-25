/**
 * Read-only baseline data-type, required non-null and declared-index audit.
 * Does not validate defaults/collations/FKs, implicitly added indexes, or data.
 */
'use strict';
const {splitTopLevel,expectedColumns}=require('./schema-column-inventory.cjs');
function fault(code){throw Error(code);}
function normalizeType(value){
  if(typeof value!=='string')fault('SCHEMA_TYPE_MISSING');
  const t=value.trim().toLowerCase().replace(/\s+/g,' ');
  // MySQL 5/8 may represent INTEGER display widths differently.
  return t.replace(/\b(bigint|int|integer|smallint|tinyint)\(\d+\)/g,'$1')
    .replace(/\binteger\b/g,'int');
}
function expectedStructure(source){
  const names=expectedColumns(source);
  const text=source.split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n');
  const found={};
  const tableRe=/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(v7_[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*ENGINE\s*=\s*InnoDB\s*;/gi;
  for(const m of text.matchAll(tableRe)){
    const table=m[1].toLowerCase(),col={},indexes={};
    for(const item of splitTopLevel(m[2])){
      const field=/^([a-z][a-z0-9_]*)\s+(ENUM\([^)]*\)|(?:BIGINT|INT|INTEGER|TINYINT|SMALLINT|VARCHAR|CHAR|TEXT|LONGTEXT|MEDIUMTEXT|DATETIME|TIMESTAMP|JSON|BOOLEAN|DECIMAL|BLOB|VARBINARY)(?:\([^)]*\))?(?:\s+UNSIGNED)?)(.*)$/i.exec(item);
      if(field){
        const fieldName=field[1].toLowerCase();
        const inlinePrimary=/\bPRIMARY\s+KEY\b/i.test(field[3]);
        const inlineUnique=/\bUNIQUE\b/i.test(field[3]);
        col[fieldName]={type:normalizeType(field[2]),
          required_non_null:/\bNOT\s+NULL\b/i.test(field[3])||inlinePrimary};
        // The baseline declares several PKs directly on columns rather than
        // with separate PRIMARY KEY(...) clauses. Never silently skip them.
        if(inlinePrimary){
          if(indexes.PRIMARY)fault('SCHEMA_INDEX_DUPLICATE');
          indexes.PRIMARY={columns:[fieldName],unique:true};
        }
        if(inlineUnique){
          if(indexes[fieldName])fault('SCHEMA_INDEX_DUPLICATE');
          indexes[fieldName]={columns:[fieldName],unique:true};
        }
        continue;
      }
      const index=/^(PRIMARY\s+KEY|UNIQUE\s+KEY\s+[a-z][a-z0-9_]*|INDEX\s+[a-z][a-z0-9_]*|KEY\s+[a-z][a-z0-9_]*)\s*\(([^)]*)\)/i.exec(item);
      if(index){
        const head=index[1].trim().split(/\s+/);
        const name=head[0].toUpperCase()==='PRIMARY'?'PRIMARY':head[head.length-1].toLowerCase();
        if(indexes[name])fault('SCHEMA_INDEX_DUPLICATE');
        const cols=index[2].split(',').map(x=>x.trim().replace(/`/g,'').toLowerCase());
        if(!cols.length||cols.some(x=>!/^[a-z][a-z0-9_]*$/.test(x)))fault('SCHEMA_INDEX_INVALID');
        indexes[name]={columns:cols,unique:head[0].toUpperCase()==='PRIMARY'||head[0].toUpperCase()==='UNIQUE'};
        continue;
      }
      if(!/^FOREIGN\s+KEY\b/i.test(item))fault('SCHEMA_STRUCTURE_UNSUPPORTED_DEFINITION');
    }
    if(Object.keys(col).sort().join('|')!==names[table]?.join('|'))
      fault('SCHEMA_STRUCTURE_COLUMNS_UNPARSEABLE');
    found[table]={columns:col,indexes};
  }
  if(Object.keys(found).length!==Object.keys(names).length)fault('SCHEMA_STRUCTURE_TABLES_INCOMPLETE');
  return found;
}
function compareStructure(expected,columnRows,indexRows){
  if(!expected||typeof expected!=='object'||!Array.isArray(columnRows)||!Array.isArray(indexRows))
    fault('SCHEMA_STRUCTURE_INPUT_INVALID');
  const problems=[],seen=new Set();
  for(const row of columnRows){
    const table=String(row?.table_name||'').toLowerCase(),name=String(row?.column_name||'').toLowerCase();
    if(!expected[table]?.columns[name])continue; // names checked by separate inventory
    const key=table+'.'+name;
    if(seen.has(key))fault('SCHEMA_STRUCTURE_DUPLICATE_COLUMN');seen.add(key);
    const want=expected[table].columns[name];
    const real=normalizeType(row.column_type);
    if(real!==want.type)problems.push('TYPE:'+key);
    if(want.required_non_null&&row.is_nullable!=='NO')problems.push('NULLABILITY:'+key);
  }
  for(const [table,def] of Object.entries(expected))
    for(const name of Object.keys(def.columns))
      if(!seen.has(table+'.'+name))problems.push('MISSING_COLUMN_METADATA:'+table+'.'+name);
  const observed={};
  for(const row of indexRows){
    const table=String(row?.table_name||'').toLowerCase();
    if(!expected[table])continue;
    const name=String(row.index_name||'').toLowerCase();
    const key=table+'.'+name;
    if(!observed[key])observed[key]=[];
    const seq=Number(row.seq_in_index),nonUnique=Number(row.non_unique);
    if(!Number.isSafeInteger(seq)||seq<1||!Number.isSafeInteger(nonUnique)||![0,1].includes(nonUnique)||
       !/^[a-z][a-z0-9_]*$/.test(String(row.column_name||'').toLowerCase()))
      fault('SCHEMA_STRUCTURE_INDEX_ROW_INVALID');
    observed[key].push({seq,col:String(row.column_name).toLowerCase(),unique:nonUnique===0});
  }
  for(const [table,def] of Object.entries(expected))
    for(const [name,want] of Object.entries(def.indexes)){
      const rows=observed[table+'.'+name.toLowerCase()];
      if(!rows||rows.length!==want.columns.length){problems.push('INDEX_MISSING_OR_LENGTH:'+table+'.'+name);continue;}
      const sorted=rows.slice().sort((a,b)=>a.seq-b.seq);
      if(sorted.some((x,i)=>x.seq!==i+1||x.col!==want.columns[i]||x.unique!==want.unique))
        problems.push('INDEX_MISMATCH:'+table+'.'+name);
    }
  return {accepted:problems.length===0,problems:problems.sort(),
    checked_declared_index_count:Object.values(expected).reduce((n,d)=>n+Object.keys(d.indexes).length,0),
    checked_column_type_count:seen.size,
    foreign_keys_defaults_collations_and_implicit_indexes_verified:false,
    production_approved:false};
}
module.exports={expectedStructure,compareStructure,normalizeType};
