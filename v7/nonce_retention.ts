/** Bounded accepted-heartbeat nonce cleanup. Read-only calls never prune. */
export const NONCE_RETENTION_MINUTES=30;
export const NONCE_PRUNE_BATCH=128;
export const NONCE_PRUNE_HEARTBEAT_PERIOD=5;
export function shouldPruneNonces(sequence:unknown,appNow:unknown,dbNow:unknown):boolean{
  return typeof sequence==='number'&&Number.isSafeInteger(sequence)&&
    sequence>=1&&sequence%NONCE_PRUNE_HEARTBEAT_PERIOD===0&&
    typeof appNow==='number'&&Number.isSafeInteger(appNow)&&appNow>0&&
    typeof dbNow==='number'&&Number.isSafeInteger(dbNow)&&dbNow>0&&
    Math.abs(appNow-dbNow)<=60000;
}

// Cleanup must never scan v7_nonces before the reviewed, additive v8
// received_at index exists. DB metadata is checked on each bounded prune
// attempt (never cached across schema migrations).
function strictUnsigned(value:unknown):number|null{
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;
  if(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,14})$/.test(value)){
    const number=Number(value);
    return Number.isSafeInteger(number)?number:null;
  }
  return null;
}
export function hasIndexedNoncePrunePrerequisite(versions:unknown,indexRows:unknown):boolean{
  if(!Array.isArray(versions)||versions.length!==2||
     !Array.isArray(indexRows)||indexRows.length!==1)return false;
  if(strictUnsigned(versions[0]?.version)!==7||
     strictUnsigned(versions[1]?.version)!==8)return false;
  const index=indexRows[0];
  return index!==null&&typeof index==='object'&&
    index.index_name==='idx_nonce_received_at'&&
    index.column_name==='received_at'&&
    strictUnsigned(index.seq_in_index)===1&&
    strictUnsigned(index.non_unique)===1;
}
