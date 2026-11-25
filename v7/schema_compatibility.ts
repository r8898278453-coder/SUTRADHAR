/**
 * Runtime database compatibility gate. Schema v7 is supported; additive v8 is
 * supported only with exact pinned migration audit AND actual physical index.
 * This does NOT prove live data quality, production approval or DBA review.
 */
import {hasIndexedNoncePrunePrerequisite} from './nonce_retention.ts';
export const REVIEWED_V8_MIGRATION_SHA256=
  '0d9d85f54d9781cf84e42eaa46dd26274cfce990786984c05e73a2f6dd1c596f';
function int(value:unknown):number|null{
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;
  if(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,14})$/.test(value)){
    const n=Number(value);return Number.isSafeInteger(n)?n:null;
  }
  return null;
}
export function supportedSchemaVersion(rows:unknown):7|8|null{
  if(!Array.isArray(rows))return null;
  if(rows.length===1&&int(rows[0]?.version)===7)return 7;
  if(rows.length===2&&int(rows[0]?.version)===7&&int(rows[1]?.version)===8)return 8;
  return null;
}
function readAuditJson(raw:unknown):any|null{
  try{
    const value=typeof raw==='string'?JSON.parse(raw):raw;
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    return value;
  }catch{return null;}
}
export function validReviewedV8Schema(versions:unknown,indexes:unknown,audits:unknown):boolean{
  if(supportedSchemaVersion(versions)!==8||
     !hasIndexedNoncePrunePrerequisite(versions,indexes)||
     !Array.isArray(audits)||audits.length!==1)return false;
  const row=audits[0];
  if(!row||row.source_sha256!==REVIEWED_V8_MIGRATION_SHA256)return false;
  const start=readAuditJson(row.record_counts);
  const end=readAuditJson(row.destination_counts);
  return start?.status==='STARTED'&&
    typeof start.backup_receipt_sha256==='string'&&
    /^[0-9a-f]{64}$/.test(start.backup_receipt_sha256)&&
    end?.status==='DDL_COMPLETE_UNVERIFIED'&&end.statements===1;
}
