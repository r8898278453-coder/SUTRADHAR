import {createHash} from 'node:crypto';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export function verifyRecoverySnapshot(input:unknown,epoch:number):string {
  if(!input||typeof input!=='object')throw Error('INVALID_RECOVERY_SNAPSHOT');
  const s=input as Record<string,any>;
  if(!Number.isSafeInteger(epoch)||epoch<1||s.epoch!==epoch||s.phase!=='RECOVERING')
    throw Error('RECOVERY_EPOCH_CHANGED');
  for(const k of ['tickets','checkpoints','events'])
    if(!Array.isArray(s[k])||s[k].length>300)throw Error('RECOVERY_PAGINATION_REQUIRED');
  const ids=new Set<string>(),cpIds=new Set<string>(),events=new Set<number>();
  for(const t of s.tickets){
    if(!t||typeof t.ticket_id!=='string'||!t.ticket_id||ids.has(t.ticket_id)||
      typeof t.status!=='string')throw Error('INVALID_RECOVERY_TICKET');
    ids.add(t.ticket_id);
    if(t.status==='RECONCILIATION_REQUIRED')throw Error('TASK_RECONCILIATION_REQUIRED');
  }
  for(const cp of s.checkpoints){
    if(!cp||typeof cp.ticket_id!=='string'||!cp.ticket_id||cpIds.has(cp.ticket_id)||
      !Number.isSafeInteger(cp.generation)||cp.generation<1||
      typeof cp.summary!=='string'||typeof cp.next_action!=='string'||
      !/^[a-f0-9]{64}$/.test(cp.content_sha256))throw Error('INVALID_RECOVERY_CHECKPOINT');
    cpIds.add(cp.ticket_id);
    if(hash(cp.summary+'\n'+cp.next_action)!==cp.content_sha256)
      throw Error('CHECKPOINT_DIGEST_MISMATCH');
  }
  for(const e of s.events){
    const id=Number(e?.event_id);
    if(!Number.isSafeInteger(id)||id<1||events.has(id))throw Error('INVALID_EVENT_CURSOR');
    events.add(id);
  }
  if(typeof s.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.manifest_sha256))
    throw Error('INVALID_RECOVERY_HASH');
  const {manifest_sha256,...payload}=s;
  const verified=hash(JSON.stringify(payload));
  if(verified!==manifest_sha256)throw Error('RECOVERY_MANIFEST_HASH_MISMATCH');
  return verified;
}
