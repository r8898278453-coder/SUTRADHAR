/**
 * Bound work-lease extensions to a single Central-authoritative claim window.
 * v7_tickets.updated_at is set explicitly at each successful claim; the
 * current v7 schema does not auto-update it on checkpoint/submission.
 *
 * This policy NEVER elects a Master or reinstates an expired lease.
 */
export const WORKER_LEASE_SECONDS=600;
export const WORKER_MAX_ACTIVE_SECONDS=4*60*60;
export const WORKER_RENEW_WINDOW_SECONDS=7*60;
const isTime=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
export type LeaseExtension={expires_at_ms:number;seconds_remaining:number;absolute_deadline_ms:number};

export function planWorkerLeaseExtension(
  claimedAtMs:number,currentExpiresAtMs:number,nowMs:number,kind:'renew'|'checkpoint'
):LeaseExtension{
  if(!isTime(claimedAtMs)||!isTime(currentExpiresAtMs)||!isTime(nowMs)||
    (kind!=='renew'&&kind!=='checkpoint')||
    claimedAtMs>nowMs||currentExpiresAtMs<claimedAtMs)
    throw Error('WORKER_LEASE_CLOCK_INVALID');
  if(currentExpiresAtMs<=nowMs)throw Error('WORKER_LEASE_EXPIRED');
  const deadline=claimedAtMs+WORKER_MAX_ACTIVE_SECONDS*1000;
  if(!Number.isSafeInteger(deadline)||deadline<=nowMs+30000)
    throw Error('WORKER_RENEWAL_BUDGET_EXHAUSTED');
  if(kind==='renew'&&currentExpiresAtMs-nowMs>WORKER_RENEW_WINDOW_SECONDS*1000)
    throw Error('WORKER_RENEWAL_NOT_DUE');
  const next=Math.min(nowMs+WORKER_LEASE_SECONDS*1000,deadline);
  if(next<=currentExpiresAtMs)
    throw Error('WORKER_RENEWAL_BUDGET_EXHAUSTED');
  return {expires_at_ms:next,seconds_remaining:Math.floor((next-nowMs)/1000),
    absolute_deadline_ms:deadline};
}
