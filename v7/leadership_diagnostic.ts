/**
 * Owner-facing v7 leadership safety diagnostic.
 *
 * Observation ONLY. It cannot elect, resume, reconcile, revoke, accept work,
 * or establish that two enrolled node IDs are separate physical Windows PCs.
 * All liveness calculations use the authoritative MySQL server timestamp.
 */
import {firstElectionOpen,LEASE_SECONDS,type Candidate} from './rules.ts';

type RoleState={
  epoch:number;phase:string;paused:boolean;bootstrapped:boolean;
  master_agent_id:string|null;master_node_id:string|null;
  master_lease_until_ms:number|null;backup1:string|null;backup2:string|null;
};
type MissingEvidence={
  required:boolean;event_present:boolean;
  previous_master_agent_id:string|null;previous_master_node_id:string|null;
};
export type LeadershipInspectionInput={
  cluster:RoleState;
  candidates:Candidate[];
  roleNodes:Record<string,string>;
  missing:MissingEvidence;
  nowMs:number;
};
export function inspectLeadershipSafety(x:LeadershipInspectionInput){
  const {cluster:c,missing:m,nowMs}=x;
  if(!Number.isSafeInteger(nowMs)||nowMs<1||!Number.isSafeInteger(c.epoch)||
      c.epoch<0)throw Error('OWNER_LEADERSHIP_DIAGNOSTIC_CLOCK_OR_EPOCH_INVALID');
  const fresh=x.candidates.filter(a=>a.eligible&&
    Number.isFinite(a.last_seen_ms)&&a.last_seen_ms<=nowMs+5000&&
    nowMs-a.last_seen_ms<LEASE_SECONDS*1000);
  const freshNodes=new Set(fresh.map(a=>a.node_id));
  const exclude=c.master_node_id||m.previous_master_node_id;
  const independent=new Set(fresh.filter(a=>a.node_id!==exclude).map(a=>a.node_id));
  const reasons:string[]=[];
  if(c.paused)reasons.push('CLUSTER_PAUSED_OWNER_REVIEW');
  if(c.phase==='RECOVERING')reasons.push('MASTER_RECOVERY_RECONCILIATION_REQUIRED');
  if(!c.master_agent_id){
    if(!c.bootstrapped&&!firstElectionOpen(nowMs))
      reasons.push('INITIAL_ELECTION_WAIT_UNTIL_08_IST');
    if(c.bootstrapped&&c.phase==='NO_MASTER'){
      if(!m.event_present||!m.previous_master_node_id)
        reasons.push('PREVIOUS_MASTER_IDENTITY_EVIDENCE_MISSING');
      else if(independent.size===0)
        reasons.push('WAITING_FOR_DISTINCT_APPROVED_NODE_HEARTBEAT');
      else reasons.push('AWAITING_SIGNED_HEARTBEAT_FOR_ELECTION');
    }else if(!c.bootstrapped&&firstElectionOpen(nowMs))
      reasons.push('AWAITING_FIRST_SIGNED_ELECTION_HEARTBEAT');
    else if(c.phase!=='NO_MASTER')
      reasons.push('INCONSISTENT_MASTER_PHASE_OWNER_REVIEW');
  }else{
    if(!c.master_node_id)reasons.push('MASTER_NODE_BINDING_MISSING');
    if(c.master_lease_until_ms===null||c.master_lease_until_ms<=nowMs)
      reasons.push('MASTER_LEASE_EXPIRED_AWAITING_SIGNED_HEARTBEAT');
    if(!fresh.some(a=>a.agent_id===c.master_agent_id))
      reasons.push('MASTER_APPROVAL_OR_FRESH_HEARTBEAT_MISSING');
  }
  const n1=c.backup1?x.roleNodes[c.backup1]||null:null;
  const n2=c.backup2?x.roleNodes[c.backup2]||null:null;
  if((c.backup1&&!n1)||(c.backup2&&!n2)||
     (n1&&n1===c.master_node_id)||(n2&&n2===c.master_node_id)||
     (n1&&n2&&n1===n2))
    reasons.push('BACKUP_NODE_ID_COLLISION_OR_BINDING_MISSING');
  if(c.master_agent_id&&(!n1||!n2))
    reasons.push('FEWER_THAN_TWO_DISTINCT_BACKUP_NODES');
  return {
    schema:1,mode:'OWNER_READ_ONLY_LEADERSHIP_SAFETY',
    epoch:c.epoch,phase:c.phase,paused:c.paused,
    master_agent_id:c.master_agent_id,master_node_id:c.master_node_id,
    backup1:c.backup1,backup1_node_id:n1,
    backup2:c.backup2,backup2_node_id:n2,
    lease_expired:c.master_lease_until_ms===null||
      c.master_lease_until_ms<=nowMs,
    previous_master_missing_event_present:m.required?m.event_present:null,
    previous_master_agent_id:m.required?m.previous_master_agent_id:null,
    previous_master_node_id:m.required?m.previous_master_node_id:null,
    approved_fresh_eligible_node_count:freshNodes.size,
    approved_fresh_independent_node_count:independent.size,
    reason_codes:[...new Set(reasons)],
    observed_at_utc:new Date(nowMs).toISOString(),
    read_only:true,central_state_modified:false,
    physical_machine_verified:false,automatic_promotion_allowed:false,
    restart_authorized:false,production_release_authorized:false,
    notice:'Observed MySQL state is not a permission to elect, restart, install, or retry Git work.'
  };
}
