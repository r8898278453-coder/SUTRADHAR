import * as crypto from 'node:crypto';
import contract from '../packages/shared/contract.json';
export const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const LEASE_SECONDS = contract.stale_after_seconds;
export const HEARTBEAT_SECONDS = contract.heartbeat_interval_seconds;
export type Candidate = {agent_id:string;node_id:string;arrival_id:number;last_seen_ms:number;eligible:boolean};
export type Leader = {master_agent_id:string|null;master_node_id?:string|null;recovery_excluded_node_id?:string|null;recovery_requires_independent_node?:boolean;lease_until_ms:number|null;bootstrapped:boolean;epoch:number;backup1:string|null;backup2:string|null};
export function firstElectionOpen(utcMs:number) {
  // 08:00 Asia/Kolkata on the current Indian calendar day, no daily reelection.
  const d=new Date(utcMs+330*60000);
  return d.getUTCHours()>=8;
}
export function chooseLeader(leader:Leader,candidates:Candidate[],utcMs:number) {
  const healthy=candidates.filter(x=>x.eligible && utcMs-x.last_seen_ms < LEASE_SECONDS*1000 && x.last_seen_ms<=utcMs+5000)
    .sort((a,b)=>a.arrival_id-b.arrival_id || a.agent_id.localeCompare(b.agent_id));
  if (leader.master_agent_id && leader.lease_until_ms && leader.lease_until_ms>utcMs &&
      healthy.some(x=>x.agent_id===leader.master_agent_id)) return leader.master_agent_id;
  if (!leader.bootstrapped && !firstElectionOpen(utcMs)) return null;
  // A second agent on the failed Master's OWN PC is not an independent
  // failover node. Use the persisted Master->node binding even if the
  // Master agent has since been revoked and is absent from candidates.
  // When that binding cannot be established, do not guess a successor.
  const oldNode=leader.master_agent_id?
    (leader.master_node_id||candidates.find(x=>x.agent_id===leader.master_agent_id)?.node_id):null;
  if(leader.master_agent_id&&!oldNode)return null;
  // After NO_MASTER, a second heartbeat from the previous PC must not
  // silently bootstrap that machine as its own "independent" replacement.
  // A missing history binding is an explicit safety hold.
  if(leader.recovery_requires_independent_node&&!leader.recovery_excluded_node_id)
    return null;
  const excluded=oldNode||leader.recovery_excluded_node_id||null;
  const independentlyHealthy=excluded?
    healthy.filter(x=>x.node_id!==excluded):healthy;
  if (leader.bootstrapped) for (const id of [leader.backup1,leader.backup2]) {
    if (id && independentlyHealthy.some(x=>x.agent_id===id)) return id;
  }
  return independentlyHealthy[0]?.agent_id||null;
}
export function chooseBackups(master:string|null,candidates:Candidate[],utcMs:number) {
  const healthy=candidates.filter(x=>x.eligible && x.agent_id!==master &&
    utcMs-x.last_seen_ms < LEASE_SECONDS*1000&&x.last_seen_ms<=utcMs+5000)
    .sort((a,b)=>a.arrival_id-b.arrival_id || a.agent_id.localeCompare(b.agent_id));
  const current=candidates.find(x=>x.agent_id===master);
  // Never label two agents sharing a node as distinct failover machines.
  // A missing slot remains null until another approved PC heartbeats.
  const used=new Set<string>(current?[current.node_id]:[]);
  const selected:Candidate[]=[];
  for (const c of healthy) if (!used.has(c.node_id)&&selected.length<2){
    selected.push(c);used.add(c.node_id);
  }
  return [selected[0]?.agent_id||null,selected[1]?.agent_id||null] as const;
}
export function safeScope(s:string) {
  if(typeof s!=='string'||s.length>450||s.length<1||s.startsWith('/')||s.includes('\\')||
     s.split('/').some(x=>!x||x==='.'||x==='..')||s.includes('\0'))return false;
  // Nested Git metadata, npm execution config and environment secrets
  // are not authorized simply because a parent scope is ordinary.
  const blocked=new Set(['.git','.gitattributes','.gitmodules','.lfsconfig',
    '.npmrc','node_modules','package.json','package-lock.json',
    'yarn.lock','pnpm-lock.yaml']);
  if(s.split('/').some(part=>blocked.has(part.toLowerCase())||
       part.toLowerCase()==='.env'||part.toLowerCase().startsWith('.env.')))
    return false;
  return /^[a-zA-Z0-9._/-]+$/.test(s);
}
// Central, read-only Git verifier and the PC publisher must agree on
// publishable branch syntax. Be stricter than GitHub's general ref grammar.
export function validTaskBranch(branch:unknown):boolean{
  return typeof branch==='string'&&
    /^ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(branch)&&
    !branch.includes('..')&&!branch.endsWith('.')&&!branch.endsWith('.lock');
}

// Protected control-plane, signing and release sources may never become
// ordinary LOW-risk work solely because the task creator declared them LOW.
// Prefix matching includes child directories but not unrelated lookalikes.
export function isProtectedScope(scope:unknown):boolean{
  if(typeof scope!=='string'||!safeScope(scope))return true;
  const p=scope.toLowerCase();
  const roots=['v7','core','contracts','migrations','.github','hooks','apps',
    'sandbox','scripts','packages'];
  if(roots.some(root=>p===root||p.startsWith(root+'/')))return true;
  const top=['server.ts','server_db.ts','package.json','package-lock.json',
    'tsconfig.json','github_merge_verifier.ts','github_pr_creator.ts',
    'github_rollback_reconciler.ts','sequential_runner.py','.env.example',
    'dockerfile','docker-compose.yml','docker-compose.yaml',
    'project blue print.txt'];
  return top.includes(p);
}
export function scopesOverlap(a:string,b:string) {
  return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
}
export function digest(s:string|Buffer) {return crypto.createHash('sha256').update(s).digest('hex');}
