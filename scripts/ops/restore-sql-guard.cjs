/**
 * Bounded lexical preflight for authenticated single-schema mysqldump.
 * NOT a complete MySQL SQL parser or a DB privilege isolation boundary.
 * Owner still must use credentials scoped ONLY to empty staging schema.
 */
'use strict';
const {MAX_DUMP_BYTES}=require('./backup-crypto.cjs');
const single=new Set(['USE','SOURCE','SYSTEM','GRANT','REVOKE']);
const schemaActions=new Set(['CREATE','DROP','ALTER','RENAME']);
const objectHeads=new Set(['TABLE','INTO','FROM','JOIN','UPDATE',
  'REFERENCES','CALL','VIEW','PROCEDURE','FUNCTION','TRIGGER','EVENT','DELETE']);
const objectModifiers=new Set(['IF','NOT','EXISTS','TEMPORARY','LOW_PRIORITY',
  'IGNORE','QUICK']);
function reject(){throw Error('BACKUP_HAS_DATABASE_SWITCH_OR_DROP');}
function validateRestoreSql(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>MAX_DUMP_BYTES)reject();
  let sql;
  try{sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{reject();}
  let state='normal',quote='',word='',previous='',tokens=0;
  let awaitingObject=false,objectFirst=false,pendingOnTarget=false,pendingRename=false;
  function flush(){
    if(!word)return;
    const now=word.toUpperCase();word='';
    if(single.has(now)||
       (now==='DATABASE'||now==='SCHEMA'||now==='USER')&&schemaActions.has(previous)||
       now==='GLOBAL'&&previous==='SET'||
       now==='PRIVILEGES'&&previous==='FLUSH'||
       (now==='MASTER'||now==='REPLICA')&&previous==='RESET')
      reject();
    if(awaitingObject){
      if(!objectModifiers.has(now)){
        awaitingObject=false;
        objectFirst=true;
      }
    }else objectFirst=false;
    if(now==='RENAME')pendingRename=true;
    if(now==='TRIGGER'||now==='INDEX')pendingOnTarget=true;
    if(now==='ON'&&pendingOnTarget){
      awaitingObject=true;objectFirst=false;pendingOnTarget=false;
    }
    if(now==='TO'&&pendingRename){
      awaitingObject=true;objectFirst=false;
    }
    if(objectHeads.has(now)){
      awaitingObject=true;objectFirst=false;
    }
    previous=now;tokens++;
  }
  for(let i=0;i<sql.length;i++){
    const c=sql[i],next=sql[i+1],after=sql[i+2];
    if(state==='line'){if(c==='\n')state='normal';continue;}
    if(state==='comment'){
      if(c==='*'&&next==='/'){state='normal';i++;}
      continue;
    }
    if(state==='quote'){
      if(c==='\\'){i++;continue;}
      if(c===quote){
        if(next===quote){i++;continue;}
        state='normal';
      }
      continue;
    }
    if(state==='identifier'){
      if(c==='\x60'){
        if(next==='\x60'){i++;continue;}
        state='normal';
        word='SUTRADHAR_QUOTED_IDENTIFIER';flush();
      }
      continue;
    }
    if(state==='exec'&&c==='*'&&next==='/'){
      flush();state='normal';i++;continue;
    }
    if(state==='normal'&&c==='/'&&next==='*'){
      flush();
      if(after==='!'){
        state='exec';i+=2;
        while(/[0-9]/.test(sql[i+1]||''))i++;
      }else{state='comment';i++;}
      continue;
    }
    if(state==='normal'&&(c==='#'||
        c==='-'&&next==='-'&&/\s/.test(after||''))){
      flush();state='line';if(c==='-')i++;
      continue;
    }
    if(c==='\''||c==='"'){flush();quote=c;state='quote';continue;}
    if(c==='\x60'){flush();state='identifier';continue;}
    if(c==='\\'&&(next==='!'||next==='.'))reject();
    if(/[A-Za-z0-9_]/.test(c)){
      word+=c;
      if(word.length>256)reject();
      continue;
    }
    flush();
    if(c==='.'&&objectFirst)reject();
    if(c===';'){
      previous='';awaitingObject=false;objectFirst=false;
      pendingOnTarget=false;pendingRename=false;
    }else if(!/\s/.test(c))objectFirst=false;
  }
  if(state!=='normal'&&state!=='line')reject();
  flush();
  if(tokens<2)reject();
  return Object.freeze({accepted:true,db_permissions_verified:false});
}
module.exports={validateRestoreSql};
