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
