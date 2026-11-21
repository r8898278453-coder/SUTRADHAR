/**
 * SUTRADHAR v7 control plane. Stateless Express endpoints; MySQL is the sole
 * authority. No process timers, websockets, in-memory election or demo fallback.
 * Deliberately never executes code, Git push, merge, Docker or provider prompts.
 */
import express from 'express';
import type {Request, Response, NextFunction} from 'express';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import mysql from 'mysql2/promise';
import type {PoolConnection} from 'mysql2/promise';
import {verifyGitHubMergeEvidence} from '../github_merge_verifier.ts';
import {createVerifiedDraftPr,inspectVerifiedDraftPr} from '../github_pr_creator.ts';
import {inspectGitRemote} from './git_remote.ts';
import {inspectGithubPrReview} from './pr_review.ts';
import {chooseLeader,chooseBackups,firstElectionOpen,ID_RE,SHA_RE,safeScope,scopesOverlap,digest,validTaskBranch,isProtectedScope} from './rules.ts';
import {checkMaintenanceIntent,checkDrainStart} from './maintenance.ts';
import {planWorkerLeaseExtension} from './worker_lease_policy.ts';
import {permitSignedHeartbeatPilotRecord} from './pilot_heartbeat_window.ts';
import {validSignedHeartbeat} from './heartbeat_validation.ts';
import {inspectLeadershipSafety} from './leadership_diagnostic.ts';
import {verifyQaEvidencePackage,qaEvidenceProposalId,validatedStoredQaEvidence,QaEvidenceError} from './qa_evidence.ts';
import sharedContract from '../packages/shared/contract.json';

const app=express();
const MAX_BODY='128kb';
app.disable('x-powered-by');
app.use(express.json({limit:MAX_BODY,verify:(req:any,_res,buf)=>{req.rawBody=Buffer.from(buf);}}));
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
const PORT=Number(process.env.PORT||3000);
const mysqlUrl=process.env.SUTRADHAR_MYSQL_URL||process.env.DATABASE_URL;
const dbConfig=mysqlUrl?{uri:mysqlUrl}:{
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER||'',
  password:process.env.DB_PASSWORD||'',
  database:process.env.DB_NAME||''
};
const configured=Boolean((process.env.SUTRADHAR_ADMIN_KEY||'').length>=32 &&
  (process.env.SUTRADHAR_ENROLLMENT_CODE||'').length>=32 &&
  (mysqlUrl||(process.env.DB_USER&&process.env.DB_PASSWORD&&process.env.DB_NAME)));
const pool=configured?mysql.createPool({...dbConfig,waitForConnections:true,connectionLimit:5,
  queueLimit:20,timezone:'Z',dateStrings:true,enableKeepAlive:true,
  ssl:process.env.SUTRADHAR_MYSQL_TLS==='true'?{rejectUnauthorized:true}:undefined} as any):null;

class Fault extends Error {
  constructor(public code:string,public status=409){super(code);}
}
const fault=(code:string,status=409):never=>{throw new Fault(code,status);};
function okId(x:unknown){return typeof x==='string'&&ID_RE.test(x);}
function requireId(x:unknown){if(!okId(x))fault('INVALID_ID',400);return x as string;}
function requireSha(x:unknown):string{if(typeof x!=='string'||!SHA_RE.test(x))fault('INVALID_SHA',400);return x as string;}
function requireStr(x:unknown,max=1000):string{if(typeof x!=='string'||!x.trim()||x.length>max)fault('INVALID_FIELD',400);return (x as string).trim();}
function storedQaProof(value:any,invalidCode:string):ReturnType<typeof validatedStoredQaEvidence>{
  try{
    return validatedStoredQaEvidence(typeof value==='string'?JSON.parse(value):value);
  }catch{return fault(invalidCode,409);}
}
function uploadedQaProof(input:Parameters<typeof verifyQaEvidencePackage>[0]){
  try{return verifyQaEvidencePackage(input);}
  catch(e){if(e instanceof QaEvidenceError)return fault(e.code,400);throw e;}
}
function safeEqual(a:string|undefined,b:string|undefined){
  if(!a||!b)return false;
  const x=crypto.createHash('sha256').update(a).digest();
  const y=crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x,y);
}
function admin(req:Request){if(!configured)fault('CONTROL_UNAVAILABLE',503);
  if(!safeEqual(req.header('authorization')?.replace(/^Bearer /i,''),process.env.SUTRADHAR_ADMIN_KEY))fault('UNAUTHORIZED',401);
}
function getPool(){if(!pool)fault('CONTROL_UNAVAILABLE',503);return pool!;}
async function transaction<T>(fn:(c:PoolConnection)=>Promise<T>):Promise<T>{
  const c=await getPool().getConnection();
  try{await c.query("SET time_zone = '+00:00'");await c.beginTransaction();
    const out=await fn(c);await c.commit();return out;
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
async function rows(c:PoolConnection,sql:string,args:any[]=[]):Promise<any[]>{
  const [r]=await c.query(sql,args);return r as any[];
}
async function one(c:PoolConnection,sql:string,args:any[]=[]){return (await rows(c,sql,args))[0]||null;}
async function dbNow(c:PoolConnection):Promise<number>{
  const r=await one(c,"SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') AS stamp");
  return Date.parse(r.stamp);
}
async function event(c:PoolConnection,type:string,actor:string,epoch:number,resource:string|null,payload:any=null){
  await c.query('INSERT INTO v7_events(event_type,actor,epoch,resource_id,payload_json) VALUES(?,?,?,?,?)',
    [type,actor,epoch,resource,payload===null?null:JSON.stringify(payload)]);
}
async function leader(c:PoolConnection,lock=true){
  const r=await one(c,'SELECT * FROM v7_cluster WHERE singleton=1'+(lock?' FOR UPDATE':''));
  if(!r)fault('SCHEMA_NOT_INITIALIZED',503);
  return r;
}
async function idem(c:PoolConnection,actor:string,requestId:string,name:string,input:any,fn:()=>Promise<any>){
  requireId(requestId);
  const op=name+':'+digest(JSON.stringify(input||{}));
  // Insert the operation claim before side effects. A concurrent duplicate
  // blocks on MySQL's unique key, then reads the committed receipt.
  const [claimed]:any=await c.query(
    'INSERT IGNORE INTO v7_commands(actor,request_id,operation,response_json) VALUES(?,?,?,?)',
    [actor,requestId,op,JSON.stringify({pending:true})]);
  if(claimed.affectedRows===0){
    const prior=await one(c,'SELECT operation,response_json FROM v7_commands WHERE actor=? AND request_id=? FOR UPDATE',
      [actor,requestId]);
    if(!prior||prior.operation!==op)fault('IDEMPOTENCY_KEY_REUSED',409);
    const saved=typeof prior.response_json==='string'?JSON.parse(prior.response_json):prior.response_json;
    if(saved?.pending)fault('COMMAND_NOT_RECONCILED',503);
    return saved;
  }
  const result=await fn();
  await c.query('UPDATE v7_commands SET response_json=? WHERE actor=? AND request_id=?',
    [JSON.stringify(result),actor,requestId]);
  return result;
}
async function nodeAuth(req:Request){
  const nodeId=requireId(req.header('x-sutradhar-node'));
  const ts=Number(req.header('x-sutradhar-timestamp'));
  const nonce=requireId(req.header('x-sutradhar-nonce'));
  const signature=req.header('x-sutradhar-signature');
  if(!Number.isSafeInteger(ts)||Math.abs(Date.now()-ts)>120000||!signature||signature.length>256)
    fault('SIGNATURE_INVALID',401);
  const node=await transaction(async c=>{
    const n=await one(c,'SELECT node_id,public_key_pem,state FROM v7_nodes WHERE node_id=?',[nodeId]);
    if(!n||n.state!=='APPROVED')fault('NODE_NOT_APPROVED',403);
    const raw=(req as any).rawBody||Buffer.alloc(0);
    const signed=[String(ts),nonce,req.method,req.path,digest(raw)].join('\n');
    let verified=false;
    try{verified=crypto.verify(null,Buffer.from(signed),crypto.createPublicKey(n.public_key_pem),Buffer.from(signature||'','base64'));}
    catch{verified=false;}
    if(!verified)fault('SIGNATURE_INVALID',401);
    // Unique nonce is durable across processes and survives crashes.
    await c.query('INSERT INTO v7_nonces(node_id,nonce) VALUES(?,?)',[nodeId,nonce]);
    return n;
  });
  return node;
}

// Read-only proof of a still-approved, current Master. A nonexpired DB lease
// alone is insufficient after an Owner node/agent revocation.
async function approvedMasterLease(c:PoolConnection,ld:any):Promise<boolean>{
  if(!ld.master_agent_id||!ld.lease_until||
     Date.parse(ld.lease_until+'Z')<=await dbNow(c))return false;
  const master=await one(c,'SELECT a.agent_id FROM v7_agents a '+
    'JOIN v7_nodes n ON n.node_id=a.node_id '+
    'WHERE a.agent_id=? AND a.state="APPROVED" AND n.state="APPROVED"',
    [ld.master_agent_id]);
  return Boolean(master);
}

// Claim/election and Owner fence transitions serialize on v7_cluster row.
// This DB fence persists until an explicit Owner cancellation, NEVER expires
// implicitly like an advisory five-minute intent.
async function requireNoNodeDrain(c:PoolConnection,nodeId:string){
  const fence=await one(c,
    'SELECT node_id,state FROM v7_pc_maintenance_fences WHERE node_id=? FOR UPDATE',[nodeId]);
  if(fence)fault('PC_MAINTENANCE_FENCED',423);
}
async function maintenanceAgentEvidence(c:PoolConnection,nodeId:string){
  return rows(c,
    'SELECT a.agent_id,a.state,a.master_eligible,a.qa_eligible,a.status,a.active_ticket,'+
    'TIMESTAMPDIFF(SECOND,a.last_seen,UTC_TIMESTAMP(3)) AS heartbeat_age_seconds,'+
    'EXISTS(SELECT 1 FROM v7_leases l WHERE l.agent_id=a.agent_id AND l.revoked=0 '+
    'AND l.expires_at>UTC_TIMESTAMP(3)) AS has_live_work_lease,'+
    'EXISTS(SELECT 1 FROM v7_git_jobs g WHERE g.agent_id=a.agent_id '+
    'AND g.state IN ("RUNNING","NEEDS_RECONCILIATION")) AS has_unreconciled_git_job '+
    'FROM v7_agents a WHERE a.node_id=? ORDER BY a.agent_id',[nodeId]);
}
async function maintenanceRedundancyEvidence(c:PoolConnection,ids:any[]){
  return rows(c,
    'SELECT a.agent_id,a.state,n.state AS node_state,'+
    'TIMESTAMPDIFF(SECOND,a.last_seen,UTC_TIMESTAMP(3)) AS heartbeat_age_seconds '+
    'FROM v7_agents a JOIN v7_nodes n ON n.node_id=a.node_id '+
    'WHERE a.agent_id IN (?,?,?)',ids);
}

async function signedAgent(c:PoolConnection,nodeId:string,agentId:string,qa=false){
  const a=await one(c,'SELECT * FROM v7_agents WHERE agent_id=? AND node_id=? FOR UPDATE',[agentId,nodeId]);
  if(!a||a.state!=='APPROVED'||(qa&&!a.qa_eligible))fault('AGENT_NOT_AUTHORIZED',403);
  return a;
}
async function readyMaster(c:PoolConnection,nodeId:string,agentId:string,epoch:any){
  const ld=await leader(c);
  if(ld.paused)fault('CLUSTER_PAUSED',423);
  if(ld.master_agent_id!==agentId||Number(ld.epoch)!==Number(epoch))fault('STALE_MASTER_EPOCH',409);
  const live=await one(c,'SELECT a.agent_id FROM v7_agents a JOIN v7_nodes n ON n.node_id=a.node_id WHERE a.agent_id=? AND a.node_id=? AND a.state="APPROVED" AND n.state="APPROVED"',[agentId,nodeId]);
  if(!live)fault('MASTER_REVOKED',403);
  const now=await dbNow(c),until=ld.lease_until?Date.parse(ld.lease_until+'Z'):0;
  if(until<=now)fault('LEASE_EXPIRED',409);
  if(ld.phase!=='READY')fault('MASTER_RECOVERING',423);
  return ld;
}
async function candidates(c:PoolConnection){
  const results=await rows(c,
    'SELECT a.agent_id,a.node_id,a.last_seen,a.master_eligible,r.arrival_id '+
    'FROM v7_agents a JOIN v7_nodes n ON a.node_id=n.node_id '+
    'JOIN v7_arrivals r ON r.agent_id=a.agent_id '+
    'LEFT JOIN v7_pc_maintenance_fences f ON f.node_id=a.node_id '+
    'WHERE a.state="APPROVED" AND n.state="APPROVED" AND a.master_eligible=1 '+
    'AND f.node_id IS NULL ORDER BY r.arrival_id');
  return results.map(x=>({agent_id:x.agent_id,node_id:x.node_id,
    arrival_id:Number(x.arrival_id),last_seen_ms:Date.parse(x.last_seen+'Z'),
    eligible:Boolean(x.master_eligible)}));
}
// The latest missing-Master event is authoritative. Never skip a malformed
// latest event and accidentally use a stale older event for a new epoch.
// Observation uses this same evidence path as mutating election.
async function missingMasterEvidence(c:PoolConnection,epoch:number){
  const record=await one(c,
    "SELECT event_id,payload_json FROM v7_events "+
    "WHERE event_type='MASTER_MISSING' AND epoch=? "+
    "ORDER BY event_id DESC LIMIT 1",[epoch]);
  if(!record)return {event_present:false,previous_master_agent_id:null,
    previous_master_node_id:null};
  let previous:string|null=null;
  try{
    const payload=typeof record.payload_json==='string'?
      JSON.parse(record.payload_json):record.payload_json;
    if(okId(payload?.previous))previous=payload.previous;
  }catch{ /* fail closed instead of resolving an earlier event */ }
  const bound=previous?await one(c,
    'SELECT node_id FROM v7_agents WHERE agent_id=?',[previous]):null;
  return {event_present:true,previous_master_agent_id:previous,
    previous_master_node_id:typeof bound?.node_id==='string'?bound.node_id:null};
}
async function evaluate(c:PoolConnection,reason='heartbeat'){
  const ld=await leader(c);
  const now=await dbNow(c), cs=await candidates(c);
  const old=ld.master_agent_id||null;
  // A revoked/offline Master may be absent from eligible candidates; its
  // persisted enrollment still identifies the physical node that MUST NOT
  // be mistaken for an independent backup. Do not trust an agent assertion.
  const oldNode=old?(cs.find(x=>x.agent_id===old)?.node_id||
    (await one(c,'SELECT node_id FROM v7_agents WHERE agent_id=?',[old]))?.node_id||null):null;
  // Once a Master becomes missing, preserve its previous PC exclusion until
  // an INDEPENDENT node takes over. Without this, a second heartbeat from
  // another agent on the original PC can immediately re-elect that PC while
  // its old heartbeat/worker state is ambiguous. Reuse durable central audit
  // history; never depend on a volatile process cache or node-supplied ID.
  const missingFence=!old&&ld.phase==='NO_MASTER'&&Boolean(ld.bootstrapped_at);
  const missing=missingFence?await missingMasterEvidence(c,Number(ld.epoch)):null;
  const next=chooseLeader({master_agent_id:old,master_node_id:oldNode,
    recovery_requires_independent_node:missingFence,
    recovery_excluded_node_id:missing?.previous_master_node_id||null,
    lease_until_ms:ld.lease_until?Date.parse(ld.lease_until+'Z'):null,
    bootstrapped:Boolean(ld.bootstrapped_at),epoch:Number(ld.epoch),
    backup1:ld.backup1,backup2:ld.backup2},cs,now);
  let epoch=Number(ld.epoch),phase=ld.phase;
  if(next!==old){
    if(next){
      epoch++;phase='RECOVERING';
      // All old-epoch worker leases are fenced; no unfinished work is claimed complete.
      await c.query('UPDATE v7_tickets t JOIN v7_leases w ON w.ticket_id=t.ticket_id SET t.status="RECONCILIATION_REQUIRED",t.version=t.version+1 WHERE w.revoked=0');
      await c.query('UPDATE v7_leases SET revoked=1 WHERE revoked=0');
      await c.query('UPDATE v7_cluster SET epoch=?,bootstrapped_at=COALESCE(bootstrapped_at,UTC_TIMESTAMP(3)),master_agent_id=?,elected_at=UTC_TIMESTAMP(3),lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 180 SECOND),phase=?,version=version+1 WHERE singleton=1',
        [epoch,next,phase]);
      await event(c,'MASTER_PROMOTED','central',epoch,next,{previous:old,reason});
    }else{
      phase='NO_MASTER';
      await c.query('UPDATE v7_cluster SET master_agent_id=NULL,lease_until=NULL,phase=?,version=version+1 WHERE singleton=1',[phase]);
      await event(c,'MASTER_MISSING','central',epoch,null,{previous:old,reason});
    }
  }
  if(next){
    const [oneBackup,twoBackup]=chooseBackups(next,cs,now);
    if(oneBackup!==ld.backup1||twoBackup!==ld.backup2||next!==old){
      await c.query('UPDATE v7_cluster SET backup1=?,backup2=?,version=version+1 WHERE singleton=1',[oneBackup,twoBackup]);
    }
  }else if(ld.backup1||ld.backup2){
    await c.query('UPDATE v7_cluster SET backup1=NULL,backup2=NULL,version=version+1 WHERE singleton=1');
  }
  return await leader(c,false);
}
async function ownerCommand(c:PoolConnection,actor:string,body:any){
  const command=requireStr(body.command,40);
  const payload=body.payload||{};
  return idem(c,actor,requireId(body.request_id),command,payload,async()=>{
    const ld=await leader(c);
    let result:any;
    // A status command may create an Owner audit/receipt, but must never
    // promote a Master or revoke worker leases merely by observing them.
    if(command==='STATUS') result={cluster:ld};
    else if(command==='PAUSE'||command==='RESUME'){
      await c.query('UPDATE v7_cluster SET paused=?,version=version+1 WHERE singleton=1',[command==='PAUSE'?1:0]);
      result={paused:command==='PAUSE'};
    }else if(command==='APPROVE_NODE'||command==='REVOKE_NODE'){
      const nodeId=requireId(payload.node_id);
      const state=command==='APPROVE_NODE'?'APPROVED':'REVOKED';
      const [u]:any=await c.query('UPDATE v7_nodes SET state=? WHERE node_id=?',[state,nodeId]);
      if(u.affectedRows!==1)fault('NODE_NOT_FOUND',404);
      result={node_id:nodeId,state};await evaluate(c,'node-revoked');
    }else if(command==='APPROVE_AGENT'||command==='REVOKE_AGENT'){
      const id=requireId(payload.agent_id),state=command==='APPROVE_AGENT'?'APPROVED':'REVOKED';
      const [u]:any=await c.query('UPDATE v7_agents SET state=?,master_eligible=?,qa_eligible=? WHERE agent_id=?',
        [state,state==='APPROVED'&&payload.master_eligible===true?1:0,state==='APPROVED'&&payload.qa_eligible===true?1:0,id]);
      if(u.affectedRows!==1)fault('AGENT_NOT_FOUND',404);
      result={agent_id:id,state};await evaluate(c,'agent-revoked');
    }else if(command==='PLAN_PC_UPDATE'){
      // Owner-controlled short-lived INTENT. No agent stop, task drain,
      // maintenance lease, installer execution or rollback is granted here.
      const planId=requireId(payload.plan_id),nodeId=requireId(payload.node_id);
      const wave=requireStr(payload.wave_id,64),version=requireStr(payload.target_version,24);
      const offerSha=payload.offer_sha256;
      if(!/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(wave)||
         !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)||
         version.split('.').map(Number).some(x=>!Number.isSafeInteger(x)||x>999999)||
         (typeof offerSha!=='string'||!/^[a-f0-9]{64}$/.test(offerSha)))
        fault('MAINTENANCE_PLAN_FIELDS_INVALID',400);
      const target=await one(c,'SELECT node_id,state FROM v7_nodes WHERE node_id=? FOR UPDATE',[nodeId]);
      if(!target||target.state!=='APPROVED')fault('MAINTENANCE_NODE_NOT_APPROVED',403);
      const now=await dbNow(c),roleIds=[ld.master_agent_id,ld.backup1,ld.backup2];
      const decision=checkMaintenanceIntent({
        cluster:{...ld,lease_until_ms:ld.lease_until?Date.parse(ld.lease_until+'Z'):null},
        agents:await maintenanceAgentEvidence(c,nodeId),
        redundancy:await maintenanceRedundancyEvidence(c,roleIds),
        expectedEpoch:Number(payload.expected_epoch),nowMs:now
      });
      if(!decision.accepted)fault(decision.error_code||'MAINTENANCE_INTENT_DENIED',409);
      const activeFence=await one(c,
        'SELECT node_id FROM v7_pc_maintenance_fences WHERE node_id=? FOR UPDATE',[nodeId]);
      if(activeFence)fault('MAINTENANCE_NODE_ALREADY_FENCED',409);
      const existing=await one(c,'SELECT plan_id FROM v7_pc_maintenance_plans '+
        'WHERE node_id=? AND state="INTENT_ONLY" AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[nodeId]);
      if(existing)fault('MAINTENANCE_PLAN_ALREADY_ACTIVE',409);
      await c.query('INSERT INTO v7_pc_maintenance_plans '+
        '(plan_id,node_id,wave_id,target_version,offer_sha256,expected_epoch,expires_at) '+
        'VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE))',
        [planId,nodeId,wave,version,offerSha,Number(ld.epoch)]);
      result={plan_id:planId,node_id:nodeId,state:'INTENT_ONLY',expires_in_seconds:300,
        expected_epoch:Number(ld.epoch),installer_execution_allowed:false};
    }else if(command==='START_PC_DRAIN'){
      const planId=requireId(payload.plan_id);
      const plan=await one(c,'SELECT * FROM v7_pc_maintenance_plans '+
        'WHERE plan_id=? AND state="INTENT_ONLY" '+
        'AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[planId]);
      if(!plan)fault('MAINTENANCE_INTENT_EXPIRED_OR_CANCELLED',409);
      const target=await one(c,'SELECT node_id,state FROM v7_nodes WHERE node_id=?',[plan.node_id]);
      if(target?.state!=='APPROVED')fault('MAINTENANCE_NODE_NOT_APPROVED',403);
      const now=await dbNow(c),roleIds=[ld.master_agent_id,ld.backup1,ld.backup2];
      const decision=checkDrainStart({
        cluster:{...ld,lease_until_ms:ld.lease_until?Date.parse(ld.lease_until+'Z'):null},
        agents:await maintenanceAgentEvidence(c,plan.node_id),
        redundancy:await maintenanceRedundancyEvidence(c,roleIds),
        expectedEpoch:Number(plan.expected_epoch),nowMs:now
      });
      if(!decision.accepted)fault(decision.error_code||'MAINTENANCE_DRAIN_DENIED',409);
      const existing=await one(c,'SELECT node_id FROM v7_pc_maintenance_fences '+
        'WHERE node_id=? FOR UPDATE',[plan.node_id]);
      if(existing)fault('MAINTENANCE_NODE_ALREADY_FENCED',409);
      await c.query('INSERT INTO v7_pc_maintenance_fences '+
        '(node_id,plan_id,state,expected_epoch) VALUES(?,?,"DRAINING",?)',
        [plan.node_id,planId,Number(ld.epoch)]);
      result={plan_id:planId,node_id:plan.node_id,state:'DRAINING',
        active_worker_leases_preserved:true,new_claims_blocked:true,
        automatic_expiry:false,installer_execution_allowed:false};
    }else if(command==='FINALIZE_PC_DRAIN'){
      const planId=requireId(payload.plan_id);
      const fence=await one(c,'SELECT * FROM v7_pc_maintenance_fences '+
        'WHERE plan_id=? FOR UPDATE',[planId]);
      if(!fence||fence.state!=='DRAINING')fault('MAINTENANCE_DRAIN_NOT_ACTIVE',409);
      const now=await dbNow(c),roleIds=[ld.master_agent_id,ld.backup1,ld.backup2];
      const decision=checkMaintenanceIntent({
        cluster:{...ld,lease_until_ms:ld.lease_until?Date.parse(ld.lease_until+'Z'):null},
        agents:await maintenanceAgentEvidence(c,fence.node_id),
        redundancy:await maintenanceRedundancyEvidence(c,roleIds),
        expectedEpoch:Number(fence.expected_epoch),nowMs:now
      });
      if(!decision.accepted)fault(decision.error_code||'MAINTENANCE_DRAIN_NOT_IDLE',409);
      const unfinished=await one(c,
        'SELECT COUNT(*) AS n FROM v7_tickets t JOIN v7_agents a '+
        'ON a.agent_id=t.worker_agent_id WHERE a.node_id=? '+
        'AND t.status IN ("CLAIMED","RUNNING","CHECKPOINTED",'+
        '"TEST_FAILED","RECONCILIATION_REQUIRED")',[fence.node_id]);
      if(Number(unfinished.n)>0)fault('MAINTENANCE_TICKETS_REQUIRE_RECONCILIATION',409);
      await c.query('UPDATE v7_pc_maintenance_fences '+
        'SET state="DRAINED",drained_at=UTC_TIMESTAMP(3) WHERE plan_id=?',[planId]);
      result={plan_id:planId,node_id:fence.node_id,state:'DRAINED',
        new_claims_blocked:true,automatic_expiry:false,
        installer_execution_allowed:false};
    }else if(command==='CANCEL_PC_UPDATE'){
      const planId=requireId(payload.plan_id);
      const plan=await one(c,'SELECT * FROM v7_pc_maintenance_plans '+
        'WHERE plan_id=? AND state="INTENT_ONLY" FOR UPDATE',[planId]);
      if(!plan)fault('MAINTENANCE_PLAN_NOT_ACTIVE',409);
      // Only explicit Owner cancellation unblocks future claims. Deleting
      // the fence is atomic with cancelling the plan under leader lock.
      const [released]:any=await c.query(
        'DELETE FROM v7_pc_maintenance_fences WHERE plan_id=?',[planId]);
      const [u]:any=await c.query('UPDATE v7_pc_maintenance_plans '+
        'SET state="CANCELLED",closed_at=UTC_TIMESTAMP(3) '+
        'WHERE plan_id=? AND state="INTENT_ONLY"',[planId]);
      if(u.affectedRows!==1)fault('MAINTENANCE_PLAN_NOT_ACTIVE',409);
      result={plan_id:planId,state:'CANCELLED',
        previously_fenced:released.affectedRows===1,
        new_claims_may_resume:released.affectedRows===1,
        installer_execution_allowed:false};
    }else if(command==='CREATE_PROJECT'){
      const id=requireId(payload.project_id),name=requireStr(payload.display_name,170);
      const repo=requireStr(payload.repository,190),base=requireStr(payload.base_branch||'main',80);
      if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)||!/^[a-zA-Z0-9._/-]+$/.test(base))fault('INVALID_REPOSITORY',400);
      await c.query('INSERT INTO v7_projects(project_id,display_name,repository,base_branch) VALUES(?,?,?,?)',
        [id,name,repo,base]);
      result={project_id:id,created:true};
    }else if(command==='GRANT_PROJECT_AGENT'||command==='REVOKE_PROJECT_AGENT'){
      const projectId=requireId(payload.project_id),agentId=requireId(payload.agent_id);
      const project=await one(c,'SELECT project_id FROM v7_projects WHERE project_id=? FOR UPDATE',[projectId]);
      const agent=await one(c,'SELECT state FROM v7_agents WHERE agent_id=?',[agentId]);
      if(!project||agent?.state!=='APPROVED')fault('INVALID_PROJECT_AGENT',409);
      if(command==='REVOKE_PROJECT_AGENT')await c.query('DELETE FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [projectId,agentId]);
      else await c.query('INSERT INTO v7_project_agents(project_id,agent_id,can_develop,can_qa) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE can_develop=VALUES(can_develop),can_qa=VALUES(can_qa)',
        [projectId,agentId,payload.can_develop===true?1:0,payload.can_qa===true?1:0]);
      result={project_id:projectId,agent_id:agentId,action:command};
    }else if(command==='APPROVE_QA_EVIDENCE'||command==='REJECT_QA_EVIDENCE'){
      const proposalId=requireId(payload.review_proposal_id);
      const reviewNote=requireStr(payload.review_note,500);
      if(!/^qaev_[a-f0-9]{64}$/.test(proposalId)||reviewNote.length<20)
        fault('QA_OWNER_REVIEW_INPUT_INVALID',400);
      if(command==='APPROVE_QA_EVIDENCE'&&
         (payload.device_identity_confirmed!==true||
          payload.runner_provenance_reviewed!==true||
          payload.test_evidence_reviewed!==true||
          payload.independence_verified!==true))
        fault('QA_OWNER_INDEPENDENT_REVIEW_REQUIRED',403);
      const review=await one(c,'SELECT * FROM v7_approvals WHERE proposal_id=? '+
        'AND kind="QA_EVIDENCE_REVIEW" FOR UPDATE',[proposalId]);
      if(!review||review.state!=='PENDING')fault('QA_REVIEW_NOT_PENDING',409);
      const proof=storedQaProof(review.justification,'QA_REVIEW_PROOF_CORRUPT');
      if(qaEvidenceProposalId(proof)!==proposalId||
         review.ticket_id!==proof.ticket_id)
        fault('QA_REVIEW_PROOF_CORRUPT',409);
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',
        [proof.ticket_id]);
      if(!t||t.status!=='SUBMITTED_FOR_REVIEW'||
         t.worker_agent_id!==proof.developer_agent_id||
         t.candidate_head_sha!==proof.candidate_head_sha||
         t.candidate_tree_sha!==proof.candidate_tree_sha||
         t.baseline_sha!==proof.baseline_sha)
        fault('QA_REVIEW_CANDIDATE_CHANGED',409);
      const grant=await one(c,'SELECT a.agent_id FROM v7_agents a '+
        'JOIN v7_nodes n ON n.node_id=a.node_id '+
        'JOIN v7_project_agents pa ON pa.agent_id=a.agent_id AND pa.project_id=? '+
        'WHERE a.agent_id=? AND a.node_id=? AND a.state="APPROVED" '+
        'AND a.qa_eligible=1 AND n.state="APPROVED" AND pa.can_qa=1',
        [t.project_id,proof.qa_agent_id,proof.node_id]);
      const workerNode=await one(c,
        'SELECT node_id FROM v7_agents WHERE agent_id=?',[t.worker_agent_id]);
      if(!grant||t.worker_agent_id===proof.qa_agent_id||
         !workerNode||workerNode.node_id===proof.node_id)
        fault('QA_REVIEW_INDEPENDENCE_OR_ACCESS_REVOKED',403);
      await c.query('UPDATE v7_approvals SET state=?,resolved_at=UTC_TIMESTAMP(3) '+
        'WHERE proposal_id=? AND state="PENDING"',
        [command==='APPROVE_QA_EVIDENCE'?'APPROVED':'DENIED',proposalId]);
      // The Owner may verify real Docker logs and physical independence OUTSIDE
      // Central; do not describe these boolean attestations as automatic proof.
      result={ticket_id:proof.ticket_id,review_proposal_id:proposalId,
        state:command==='APPROVE_QA_EVIDENCE'?'APPROVED':'DENIED',
        evidence_sha256:proof.evidence_sha256,
        passed:proof.passed,qa_receipt_submitted:false,
        integration_performed:false,review_note:reviewNote};
    }else if(command==='APPROVE_PROPOSAL'||command==='DENY_PROPOSAL'){
      const id=requireId(payload.proposal_id),state=command==='APPROVE_PROPOSAL'?'APPROVED':'DENIED';
      const reserved=await one(c,'SELECT kind FROM v7_approvals WHERE proposal_id=? FOR UPDATE',[id]);
      if(reserved?.kind==='QA_EVIDENCE_REVIEW')fault('QA_REVIEW_REQUIRES_OWNER_EVIDENCE_COMMAND',403);
      const [u]:any=await c.query('UPDATE v7_approvals SET state=?,resolved_at=UTC_TIMESTAMP(3) WHERE proposal_id=? AND state="PENDING"',[state,id]);
      if(u.affectedRows!==1)fault('PROPOSAL_NOT_PENDING',409);
      const ticketRow=await one(c,'SELECT ticket_id,status FROM v7_tickets WHERE ticket_id=(SELECT ticket_id FROM v7_approvals WHERE proposal_id=?) FOR UPDATE',[id]);
      if(state==='APPROVED'&&ticketRow?.status==='WAITING_AUTHORIZATION'){
        const unresolved=await one(c,'SELECT COUNT(*) n FROM v7_approvals WHERE ticket_id=? AND state!="APPROVED"',[ticketRow.ticket_id]);
        if(Number(unresolved.n)===0)await c.query('UPDATE v7_tickets SET status="READY",version=version+1 WHERE ticket_id=?',[ticketRow.ticket_id]);
      }
      result={proposal_id:id,state,ticket_id:ticketRow?.ticket_id||null};
    }else if(command==='RECONCILE_TICKET'){
      const id=requireId(payload.ticket_id),reason=requireStr(payload.reason,500);
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[id]);
      if(!t||t.status!=='RECONCILIATION_REQUIRED')fault('TICKET_NOT_RECONCILABLE',409);
      // A ticket with any recorded Git publication has a separate recovery
      // protocol; treating it as fresh READY work could duplicate remote effects.
      if(await one(c,'SELECT ticket_id FROM v7_git_jobs WHERE ticket_id=?',[id]))
        fault('GIT_PUBLICATION_REQUIRES_SEPARATE_RECOVERY',423);
      // A human must externally reconcile uncertain Git effects before authorizing retry.
      if(payload.remote_checked!==true)fault('REMOTE_RECONCILIATION_REQUIRED',409);
      await c.query('UPDATE v7_tickets SET status="READY",worker_agent_id=NULL,version=version+1 WHERE ticket_id=?',[id]);
      await c.query('DELETE FROM v7_reservations WHERE ticket_id=?',[id]);
      result={ticket_id:id,status:'READY',reason};
    }else fault('UNKNOWN_OWNER_COMMAND',400);
    await event(c,'OWNER_'+command,actor,Number(ld.epoch),result.project_id||result.ticket_id||result.node_id||result.plan_id||null,
      {command,resource:result.project_id||result.ticket_id||result.node_id||result.plan_id||null});
    return {accepted:true,receipt_id:body.request_id,state:result};
  });
}
function jsonRoute(fn:(req:Request,res:Response)=>Promise<any>){
  return async(req:Request,res:Response,next:NextFunction)=>{
    try{const out=await fn(req,res);if(!res.headersSent)res.json(out);}
    catch(e){next(e);}
  };
}
app.get('/v7/health',jsonRoute(async()=>{
  if(!configured)fault('CONTROL_UNAVAILABLE',503);
  await transaction(async c=>{await leader(c,false);});
  return {service:'sutradhar-v7',ready:true,authority:'mysql',
    api_protocol:sharedContract.api_protocol,
    // Operator capture MUST confirm this BEFORE calling GET /v7/cluster.
    // Older builds permitted GET to elect/fence; a pilot must refuse them.
    read_only_cluster_snapshot:true};
}));
app.post('/v7/owner/migrate',jsonRoute(async req=>{
  admin(req);
  if(process.env.SUTRADHAR_ALLOW_MIGRATIONS!=='true')fault('MIGRATION_DISABLED',403);
  // Support BOTH legacy repo-root run and the independent Central bundle.
  // Never resolve a caller-supplied file path for database schema execution.
  const localBundleDir=typeof __dirname==='string'?__dirname:path.dirname(process.argv[1]||process.cwd());
  const bundleSchema=path.resolve(localBundleDir,'v7/schema.sql');
  const repoSchema=path.resolve(process.cwd(),'v7/schema.sql');
  const schemaFile=fs.existsSync(bundleSchema)?bundleSchema:repoSchema;
  const sql=fs.readFileSync(schemaFile,'utf8').split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const statements=sql.split(';').map(x=>x.trim()).filter(Boolean);
  const c=await getPool().getConnection();
  let held=false;
  try{
    await c.query("SET time_zone = '+00:00'");
    // MySQL DDL auto-commits; this is ONLY a one-time empty-DB bootstrap,
    // never an in-place migration on existing data.
    const lockName='sut_v7_init_'+crypto.createHash('sha256').update(String((await one(c,'SELECT DATABASE() AS name'))?.name||'')).digest('hex').slice(0,32);
    const lock=await one(c,'SELECT GET_LOCK(?,0) AS acquired',[lockName]);
    if(Number(lock?.acquired)!==1)fault('SCHEMA_BOOTSTRAP_ALREADY_RUNNING',409);
    held=true;
    const dbName=(await one(c,'SELECT DATABASE() AS name'))?.name;
    if(typeof dbName!=='string'||!dbName)fault('SCHEMA_TARGET_INVALID',409);
    // Approval must name this exact database; an enabled migration toggle
    // alone does not permit schema creation in a wrongly configured MySQL DB.
    if(process.env.SUTRADHAR_BOOTSTRAP_EMPTY_DB_APPROVED!=='yes'||
       process.env.SUTRADHAR_BOOTSTRAP_TARGET_DB!==dbName)
      fault('SCHEMA_BOOTSTRAP_EXACT_TARGET_APPROVAL_REQUIRED',403);
    const tables=await one(c,
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=?',[dbName]);
    if(!tables||Number(tables.n)!==0)fault('SCHEMA_BOOTSTRAP_REQUIRES_EMPTY_DATABASE',409);
    // Do not try to clean up partial tables on failure. Operator must inspect
    // and recreate a disposable DB rather than blindly retrying DDL.
    let completed=0;
    try{
      for(const stmt of statements){await c.query(stmt);completed++;}
      await c.query('INSERT IGNORE INTO v7_schema_versions(version) VALUES(7)');
      await c.query('INSERT IGNORE INTO v7_cluster(singleton) VALUES(1)');
    }catch{fault('SCHEMA_BOOTSTRAP_PARTIAL_FAILURE_AFTER_'+completed,503);}
    return {accepted:true,schema_version:7,statements:statements.length,
      bootstrap_only:true,production_migration_approved:false};
  }finally{
    if(held){try{
      const name='sut_v7_init_'+crypto.createHash('sha256').update(String((await one(c,'SELECT DATABASE() AS name'))?.name||'')).digest('hex').slice(0,32);
      await c.query('SELECT RELEASE_LOCK(?)',[name]);
    }catch{}}
    c.release();
  }
}));
app.post('/v7/nodes/enroll',jsonRoute(async req=>{
  if(!safeEqual(req.header('authorization')?.replace(/^Bearer /i,''),process.env.SUTRADHAR_ENROLLMENT_CODE))
    fault('ENROLLMENT_NOT_AUTHORIZED',401);
  const {node_id,public_key_pem,display_name,general_location,proof}=req.body||{};
  requireId(node_id);requireStr(display_name,150);
  if(typeof public_key_pem!=='string'||public_key_pem.length>3000||
    typeof proof!=='string'||proof.length>256)fault('INVALID_NODE_KEY',400);
  let pub:crypto.KeyObject;
  try{pub=crypto.createPublicKey(public_key_pem);
    if(pub.asymmetricKeyType!=='ed25519'||!crypto.verify(null,Buffer.from('enroll:'+node_id),
      pub,Buffer.from(proof,'base64')))fault('INVALID_NODE_KEY',400);
  }catch{fault('INVALID_NODE_KEY',400);}
  return transaction(async c=>{
    const existing=await one(c,'SELECT node_id,state FROM v7_nodes WHERE node_id=? FOR UPDATE',[node_id]);
    if(existing)fault('NODE_ID_ALREADY_EXISTS',409);
    await c.query('INSERT INTO v7_nodes(node_id,public_key_pem,display_name,general_location) VALUES(?,?,?,?)',
      [node_id,public_key_pem,display_name,typeof general_location==='string'?general_location.slice(0,150):null]);
    await event(c,'NODE_ENROLL_REQUEST','enrollment',0,node_id);
    return {accepted:true,node_id,state:'PENDING',owner_approval_required:true};
  });
}));
app.post('/v7/owner/command',jsonRoute(async req=>{
  admin(req);return transaction(async c=>ownerCommand(c,'owner:web',req.body||{}));
}));
app.post('/v7/telegram/webhook',jsonRoute(async req=>{
  if(!safeEqual(req.header('x-telegram-bot-api-secret-token'),process.env.TELEGRAM_WEBHOOK_SECRET))
    fault('UNAUTHORIZED',401);
  const msg=req.body?.message;
  const user=String(msg?.from?.id||''),chat=String(msg?.chat?.id||'');
  if(!user||!chat||user!==process.env.TELEGRAM_ADMIN_USER_ID||
     chat!==process.env.TELEGRAM_ALLOWED_CHAT_ID)fault('UNAUTHORIZED',401);
  const text=String(msg?.text||'').trim();
  const actions:{[key:string]:string}={'/status':'STATUS','/pause':'PAUSE','/resume':'RESUME'};
  const command=actions[text.split('@')[0]];
  if(!command)return {ok:true,ignored:true};
  const request_id='tg_'+String(req.body.update_id);
  const result=await transaction(async c=>ownerCommand(c,'owner:telegram',{request_id,command,payload:{}}));
  // Notification is best effort. The durable command receipt already exists.
  if(process.env.TELEGRAM_BOT_TOKEN){
    try{await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:chat,text:JSON.stringify(result.state).slice(0,3000)}),
      signal:AbortSignal.timeout(4000)
    });}catch{ /* never retry an accepted command just to deliver notification */ }
  }
  return {ok:true,accepted:true};
}));
app.post('/v7/agents/register',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  const id=requireId(req.body?.agent_id);
  const caps=req.body?.capabilities||{};
  if(JSON.stringify(caps).length>1500)fault('CAPABILITY_TOO_LARGE',400);
  return transaction(async c=>{
    await leader(c); // Serialized with Owner drain activation.
    await requireNoNodeDrain(c,node.node_id);
    const existing=await one(c,'SELECT agent_id FROM v7_agents WHERE agent_id=?',[id]);
    if(existing)fault('AGENT_ID_ALREADY_EXISTS',409);
    await c.query('INSERT INTO v7_agents(agent_id,node_id,capability_json) VALUES(?,?,?)',[id,node.node_id,JSON.stringify(caps)]);
    await event(c,'AGENT_REGISTERED',id,0,id);
    return {accepted:true,agent_id:id,state:'PENDING',owner_approval_required:true};
  });
}));
app.post('/v7/nodes/heartbeat',jsonRoute(async req=>{
  const node=await nodeAuth(req),data=req.body;
  // Reject coercible strings, booleans, unknown fields and partial/duplicate
  // agent packets BEFORE acquiring the MySQL leader lock or updating counters.
  if(!validSignedHeartbeat(data))fault('INVALID_HEARTBEAT',400);
  const sequence=data.sequence,bootId=requireId(data.boot_id);
  return transaction(async c=>{
    // All worker/Owner/heartbeat writes take the leader lock FIRST, avoiding
    // cross-order deadlocks with task admission and persistent drain fencing.
    const ld=await leader(c);
    const n=await one(c,'SELECT * FROM v7_nodes WHERE node_id=? FOR UPDATE',[node.node_id]);
    if(sequence<=Number(n.last_sequence))fault('REPLAY_SEQUENCE',409);
    await c.query('UPDATE v7_nodes SET last_sequence=?,boot_id=?,last_seen=UTC_TIMESTAMP(3) WHERE node_id=?',
      [sequence,bootId,node.node_id]);
    const clock=await dbNow(c),seen=new Set<string>();
    for(const entry of data.agents){
      const id=requireId(entry.agent_id),seq=entry.sequence;
      if(seen.has(id)||!Number.isSafeInteger(seq)||seq<1)fault('INVALID_AGENT_SEQUENCE',400);
      seen.add(id);
      const a=await signedAgent(c,node.node_id,id);
      if(seq<=Number(a.last_sequence))fault('REPLAY_AGENT_SEQUENCE',409);
      // Heartbeat is reachability, not a declaration of work completion.
      // The packaged edge reports ONLINE even when no ticket is assigned.
      // Derive maintenance-facing work state from authoritative MySQL ticket,
      // lease and Git ledgers. An explicit BUSY/BLOCKED report only tightens
      // the gate; an IDLE/ONLINE report cannot override Central evidence.
      if(!['IDLE','BUSY','BLOCKED','ONLINE'].includes(entry.status))
        fault('INVALID_AGENT_ACTIVITY',400);
      const activity=await one(c,
        'SELECT (SELECT t.ticket_id FROM v7_tickets t WHERE t.worker_agent_id=? '+
        'AND t.status IN ("CLAIMED","RUNNING","CHECKPOINTED","TEST_FAILED",'+
        '"SUBMITTED_FOR_REVIEW","INTEGRATING","RECONCILIATION_REQUIRED") '+
        'ORDER BY t.updated_at DESC,t.ticket_id LIMIT 1) AS active_ticket,'+
        'EXISTS(SELECT 1 FROM v7_leases l WHERE l.agent_id=? AND l.revoked=0 '+
        'AND l.expires_at>UTC_TIMESTAMP(3)) AS has_work_lease,'+
        'EXISTS(SELECT 1 FROM v7_git_jobs j WHERE j.agent_id=? '+
        'AND j.state IN ("RUNNING","NEEDS_RECONCILIATION")) AS has_git_job',
        [id,id,id]);
      const centralBusy=Boolean(activity.active_ticket||
        Number(activity.has_work_lease)===1||Number(activity.has_git_job)===1);
      const status=entry.status==='BLOCKED'?'BLOCKED':
        (centralBusy||entry.status==='BUSY'?'BUSY':'IDLE');
      await c.query('UPDATE v7_agents SET last_sequence=?,last_seen=UTC_TIMESTAMP(3),'+
        'status=?,active_ticket=? WHERE agent_id=?',
        [seq,status,activity.active_ticket||null,id]);
      if(a.master_eligible&&(firstElectionOpen(clock)||Boolean(ld.bootstrapped_at))){
        await c.query('INSERT IGNORE INTO v7_arrivals(agent_id) VALUES(?)',[id]);
      }
    }
    if(ld.master_agent_id&&seen.has(ld.master_agent_id)&&data.expected_master_epoch===Number(ld.epoch)&&
      ld.lease_until&&Date.parse(ld.lease_until+'Z')>clock){
      await c.query('UPDATE v7_cluster SET lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 180 SECOND) WHERE singleton=1');
    }
    const elected=await evaluate(c,'heartbeat');
    // Alpha pilot audit is OFF without an explicit Owner-staged UTC start/end
    // window (maximum one hour). Even a forgotten enable flag cannot write
    // after expiry or after 64 lifetime records per approved node.
    // The leader-row lock above serializes this cap with parallel heartbeats.
    const raw=(req as any).rawBody as Buffer;
    const auditScope={
      enabled:process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_EVIDENCE,
      startsAt:process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_START_UTC,
      endsAt:process.env.SUTRADHAR_PILOT_SIGNED_HEARTBEAT_END_UTC,
      serverNowMs:clock,rawBodyLength:Buffer.isBuffer(raw)?raw.length:0
    };
    if(permitSignedHeartbeatPilotRecord({...auditScope,existingNodeRecords:0})){
      const previousPilotRows=await one(c,
        'SELECT COUNT(*) AS n FROM v7_events WHERE event_type=? AND actor=?',
        ['NODE_HEARTBEAT_ACCEPTED',node.node_id]);
      if(permitSignedHeartbeatPilotRecord({...auditScope,
          existingNodeRecords:Number(previousPilotRows?.n)})){
        await event(c,'NODE_HEARTBEAT_ACCEPTED',node.node_id,
          Number(elected.epoch),node.node_id,{
            schema:1,node_id:node.node_id,
            timestamp_ms:Number(req.header('x-sutradhar-timestamp')),
            nonce:req.header('x-sutradhar-nonce'),
            signature_base64:req.header('x-sutradhar-signature'),
            body_base64:raw.toString('base64'),accepted_at_ms:clock
          });
      }
    }
    return {accepted:true,server_received_at:new Date(clock).toISOString(),epoch:Number(elected.epoch),
      master_agent_id:elected.master_agent_id,phase:elected.phase,
      backups:[elected.backup1,elected.backup2],paused:Boolean(elected.paused),
      heartbeat_interval_seconds:60};
  });
}));
// Owner-only, bounded GET export of committed accepted heartbeat packet rows.
app.get('/v7/owner/heartbeat-evidence/:nodeId',jsonRoute(async req=>{
  admin(req);
  const nodeId=requireId(req.params.nodeId);
  if(!/^node_[a-f0-9]{32}$/.test(nodeId))fault('PILOT_NODE_ID_INVALID',400);
  return transaction(async c=>{
    const known=await one(c,'SELECT node_id FROM v7_nodes WHERE node_id=?',[nodeId]);
    if(!known)fault('NODE_NOT_FOUND',404);
    const recent=await rows(c,
      'SELECT event_id,UNIX_TIMESTAMP(created_at)*1000 AS committed_at_ms,'+
      'payload_json FROM v7_events WHERE event_type=? AND actor=? '+
      'ORDER BY event_id DESC LIMIT 8',['NODE_HEARTBEAT_ACCEPTED',nodeId]);
    return {schema:1,mode:'OWNER_CENTRAL_ACCEPTED_SIGNED_HEARTBEAT_LOG',
      node_id:nodeId,records:recent.reverse().map(x=>({
        event_id:Number(x.event_id),committed_at_ms:Number(x.committed_at_ms),
        payload:typeof x.payload_json==='string'?
          JSON.parse(x.payload_json):x.payload_json
      })),read_only:true,physical_machine_verified:false,
      production_release_authorized:false};
  });
}));
// Owner-only crash-recovery MySQL observation for one original node identity.
// The inspected PC cannot sign while its durable orphaned child marker is held.
// Do NOT ask it to clear that marker or use a node credential to collect this.
// No lease extension, Master election, counter adjustment or authorization.
app.get('/v7/owner/node-recovery/:nodeId',jsonRoute(async req=>{
  admin(req);
  const nodeId=requireId(req.params.nodeId);
  if(!/^node_[0-9a-f]{32}$/.test(nodeId))
    fault('OWNER_RECOVERY_NODE_ID_INVALID',400);
  return transaction(async c=>{
    const node=await one(c,
      'SELECT node_id,state,public_key_pem,boot_id,'+
      'CAST(last_sequence AS CHAR) AS accepted_node_sequence_decimal,'+
      'TIMESTAMPDIFF(SECOND,last_seen,UTC_TIMESTAMP(3)) AS heartbeat_age_seconds '+
      'FROM v7_nodes WHERE node_id=?',[nodeId]);
    if(!node)fault('NODE_NOT_FOUND',404);
    let pub:crypto.KeyObject;
    try{
      pub=crypto.createPublicKey(node.public_key_pem);
      if(pub.asymmetricKeyType!=='ed25519')
        fault('OWNER_RECOVERY_NODE_PUBLIC_KEY_INVALID',409);
    }catch{fault('OWNER_RECOVERY_NODE_PUBLIC_KEY_INVALID',409);}
    const keyFingerprint=crypto.createHash('sha256').update(
      pub.export({type:'spki',format:'der'})).digest('hex');
    const agents=await rows(c,
      'SELECT agent_id,state,master_eligible,qa_eligible,status,'+
      'CAST(last_sequence AS CHAR) AS accepted_sequence_decimal,'+
      'TIMESTAMPDIFF(SECOND,last_seen,UTC_TIMESTAMP(3)) AS heartbeat_age_seconds '+
      'FROM v7_agents WHERE node_id=? ORDER BY agent_id LIMIT 51',[nodeId]);
    if(agents.length>50)fault('OWNER_RECOVERY_AGENT_ROSTER_TOO_LARGE',409);
    const ld=await leader(c,false);
    const epochRow=await one(c,
      'SELECT CAST(epoch AS CHAR) AS epoch_decimal FROM v7_cluster WHERE singleton=1');
    if(!epochRow)fault('SCHEMA_NOT_INITIALIZED',503);
    const maintenance=await one(c,
      'SELECT plan_id,state,CAST(expected_epoch AS CHAR) AS expected_epoch_decimal '+
      'FROM v7_pc_maintenance_fences WHERE node_id=?',[nodeId]);
    const pending=await one(c,
      'SELECT COUNT(*) AS n FROM v7_pc_maintenance_plans '+
      'WHERE node_id=? AND state="INTENT_ONLY"',[nodeId]);
    const leases=await one(c,
      'SELECT COUNT(*) AS n FROM v7_leases l '+
      'JOIN v7_agents a ON a.agent_id=l.agent_id '+
      'WHERE a.node_id=? AND l.revoked=0 '+
      'AND l.expires_at>UTC_TIMESTAMP(3)',[nodeId]);
    const outstanding=await one(c,
      'SELECT COUNT(*) AS n FROM v7_tickets t '+
      'JOIN v7_agents a ON a.agent_id=t.worker_agent_id '+
      'WHERE a.node_id=? AND t.status NOT IN ("DONE","CANCELLED")',[nodeId]);
    // A Git effect on a different QA PC may still be associated with a
    // ticket originally developed here. Count BOTH developer and QA links.
    const git=await one(c,
      'SELECT COUNT(*) AS n FROM v7_git_jobs g '+
      'JOIN v7_tickets t ON t.ticket_id=g.ticket_id '+
      'LEFT JOIN v7_agents qa ON qa.agent_id=g.agent_id '+
      'LEFT JOIN v7_agents worker ON worker.agent_id=t.worker_agent_id '+
      'WHERE g.state IN ("RUNNING","NEEDS_RECONCILIATION") '+
      'AND (qa.node_id=? OR worker.node_id=?)',[nodeId,nodeId]);
    const mine=new Set(agents.map(a=>a.agent_id));
    const roleIds=[ld.master_agent_id,ld.backup1,ld.backup2];
    const count=(v:any)=>Number(v?.n||0);
    return {
      schema:1,mode:'OWNER_CENTRAL_NODE_CRASH_RECOVERY_OBSERVATION',
      node_id:nodeId,node_state:node.state,
      node_public_key_fingerprint_sha256:keyFingerprint,
      accepted_boot_id:node.boot_id||null,
      accepted_node_sequence_decimal:String(node.accepted_node_sequence_decimal),
      heartbeat_age_seconds:node.heartbeat_age_seconds===null?null:
        Number(node.heartbeat_age_seconds),
      agents:agents.map(a=>({
        agent_id:a.agent_id,state:a.state,
        accepted_sequence_decimal:String(a.accepted_sequence_decimal),
        status:a.status,master_eligible:Boolean(a.master_eligible),
        qa_eligible:Boolean(a.qa_eligible),
        heartbeat_age_seconds:a.heartbeat_age_seconds===null?null:
          Number(a.heartbeat_age_seconds)
      })),
      cluster:{
        epoch_decimal:String(epochRow.epoch_decimal),phase:ld.phase,
        paused:Boolean(ld.paused),
        master_agent_id:ld.master_agent_id||null,
        backup1:ld.backup1||null,backup2:ld.backup2||null,
        original_pc_in_cluster_roles:roleIds.some(x=>mine.has(x))
      },
      maintenance:{
        active_fence:Boolean(maintenance),
        fence_state:maintenance?.state||null,
        plan_id:maintenance?.plan_id||null,
        expected_epoch_decimal:maintenance?
          String(maintenance.expected_epoch_decimal):null,
        unresolved_intent_count:count(pending)
      },
      outstanding_worker_ticket_count:count(outstanding),
      active_worker_lease_count:count(leases),
      unresolved_git_job_count:count(git),
      observed_at_central_ms:await dbNow(c),
      read_only:true,central_state_modified:false,
      device_signature_verified_by_this_request:false,
      local_os_vault_verified:false,physical_pc_verified:false,
      owner_reconciliation_complete:false,
      agent_restart_allowed:false,marker_removal_allowed:false,
      installer_execution_allowed:false,production_release_authorized:false,
      next_action:'Owner: compare this MySQL snapshot with the original PC, the OS-vault key fingerprint, full accepted heartbeat/agent counters, QA and Git side effects. Preserve crash marker. This report NEVER grants signing, restart, marker deletion or installation.'
    };
  });
}));
// Owner dashboard and physical-pilot snapshots are OBSERVATION ONLY.
// Never evaluate an election, extend a lease, fence workers, or append events
// from a GET: a physical pilot must not cause the failover it claims to witness.
// Mutating election remains confined to authenticated heartbeat/Owner actions.
app.get('/v7/cluster',jsonRoute(async req=>{
  admin(req);
  return transaction(async c=>{
    const ld=await leader(c,false);
    const agents=await rows(c,'SELECT a.agent_id,a.node_id,a.state,a.status,a.master_eligible,a.qa_eligible,a.last_seen,n.state AS node_state FROM v7_agents a JOIN v7_nodes n ON n.node_id=a.node_id ORDER BY a.agent_id');
    return {cluster:ld,agents};
  });
}));
// Owner-facing read-only safety explanation. Unlike evaluate(), this endpoint
// never promotes, extends leases, revokes workers or authorizes recovery.
app.get('/v7/owner/leadership-safety',jsonRoute(async req=>{
  admin(req);
  return transaction(async c=>{
    const ld=await leader(c,false),now=await dbNow(c);
    const roster=await candidates(c);
    const roleIds=[ld.master_agent_id,ld.backup1,ld.backup2];
    const bindings=await rows(c,
      'SELECT agent_id,node_id FROM v7_agents WHERE agent_id IN (?,?,?)',
      roleIds);
    const roleNodes:Record<string,string>=Object.create(null);
    for(const b of bindings)roleNodes[b.agent_id]=b.node_id;
    const missingFence=!ld.master_agent_id&&ld.phase==='NO_MASTER'&&
      Boolean(ld.bootstrapped_at);
    const evidence=missingFence?await missingMasterEvidence(c,Number(ld.epoch)):
      {event_present:false,previous_master_agent_id:null,
        previous_master_node_id:null};
    return inspectLeadershipSafety({
      cluster:{epoch:Number(ld.epoch),phase:ld.phase,paused:Boolean(ld.paused),
        bootstrapped:Boolean(ld.bootstrapped_at),
        master_agent_id:ld.master_agent_id||null,
        master_node_id:ld.master_agent_id?
          roleNodes[ld.master_agent_id]||null:null,
        master_lease_until_ms:ld.lease_until?
          Date.parse(ld.lease_until+'Z'):null,
        backup1:ld.backup1||null,backup2:ld.backup2||null},
      roleNodes,missing:{required:missingFence,...evidence},
      candidates:roster,nowMs:now
    });
  });
}));
app.get('/v7/nodes/me',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  return transaction(async c=>({node_id:node.node_id,
    agents:await maintenanceAgentEvidence(c,node.node_id)}));
}));
// Signed recovery evidence for this node's EXACT historical maintenance plan.
// Read only. Cancellation is Owner-authenticated in /v7/owner/command;
// this endpoint NEVER grants permission to restart a Windows process.
app.get('/v7/nodes/maintenance/recovery/:planId',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  const planId=requireId(req.params.planId);
  return transaction(async c=>{
    const plan=await one(c,'SELECT p.plan_id,p.node_id,p.wave_id,p.offer_sha256,'+
      'p.state,p.closed_at,f.node_id AS fence_node_id '+
      'FROM v7_pc_maintenance_plans p '+
      'LEFT JOIN v7_pc_maintenance_fences f ON f.plan_id=p.plan_id '+
      'WHERE p.plan_id=? AND p.node_id=?',[planId,node.node_id]);
    if(!plan)fault('MAINTENANCE_RECOVERY_PLAN_NOT_FOUND',404);
    const live=await one(c,'SELECT COUNT(*) AS n FROM v7_pc_maintenance_fences WHERE node_id=?',[node.node_id]);
    const pending=await one(c,'SELECT COUNT(*) AS n FROM v7_pc_maintenance_plans '+
      'WHERE node_id=? AND state="INTENT_ONLY"',[node.node_id]);
    const cancellationVerified=plan.state==='CANCELLED'&&Boolean(plan.closed_at)&&
      !plan.fence_node_id&&Number(live?.n)===0&&Number(pending?.n)===0;
    return {node_id:node.node_id,plan_id:plan.plan_id,
      wave_id:plan.wave_id,offer_sha256:plan.offer_sha256,
      state:plan.state,cancellation_verified:cancellationVerified,
      any_active_fence:Number(live?.n)!==0,
      any_active_maintenance_intent:Number(pending?.n)!==0,
      local_hold_release_allowed:false,installer_execution_allowed:false,
      recovery_requires_owner:true};
  });
}));
// A signed node may inspect Owner intent, but it is NEVER an install lease.
app.get('/v7/nodes/maintenance',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  return transaction(async c=>{
    const plan=await one(c,'SELECT p.plan_id,p.node_id,p.wave_id,p.target_version,'+
      'p.offer_sha256,p.expected_epoch,p.expires_at,f.state AS fence_state '+
      'FROM v7_pc_maintenance_plans p '+
      'LEFT JOIN v7_pc_maintenance_fences f ON f.plan_id=p.plan_id '+
      'WHERE p.node_id=? AND p.state="INTENT_ONLY" '+
      'AND (p.expires_at>UTC_TIMESTAMP(3) OR f.node_id IS NOT NULL) '+
      'ORDER BY p.created_at DESC LIMIT 1',[node.node_id]);
    const ld=await leader(c,false);
    return {node_id:node.node_id,intent:plan?{
      plan_id:plan.plan_id,wave_id:plan.wave_id,target_version:plan.target_version,
      offer_sha256:plan.offer_sha256,
      expected_epoch:Number(plan.expected_epoch),expires_at:plan.expires_at,
      state:Number(plan.expected_epoch)!==Number(ld.epoch)?'STALE_EPOCH':
        plan.fence_state||'INTENT_ONLY',
      fence_active:Boolean(plan.fence_state),fence_release_requires_owner:true
    }:null,installer_execution_allowed:false,owner_maintenance_lease:false};
  });
}));
app.get('/v7/owner/maintenance',jsonRoute(async req=>{
  admin(req);
  return transaction(c=>rows(c,'SELECT p.plan_id,p.node_id,p.wave_id,p.target_version,'+
    'p.offer_sha256,p.expected_epoch,COALESCE(f.state,p.state) AS state,'+
    'p.created_at,p.expires_at,p.closed_at,f.started_at AS drain_started_at,'+
    'f.drained_at,f.node_id IS NOT NULL AS fence_active '+
    'FROM v7_pc_maintenance_plans p LEFT JOIN v7_pc_maintenance_fences f '+
    'ON f.plan_id=p.plan_id ORDER BY p.created_at DESC LIMIT 100'));
}));
app.get('/v7/projects',jsonRoute(async req=>{
  admin(req);return transaction(c=>rows(c,'SELECT * FROM v7_projects ORDER BY created_at DESC LIMIT 100'));
}));
app.get('/v7/tasks',jsonRoute(async req=>{
  admin(req);
  return transaction(c=>rows(c,'SELECT ticket_id,project_id,title,status,risk,version,worker_agent_id FROM v7_tickets ORDER BY updated_at DESC LIMIT 150'));
}));
app.get('/v7/cluster/state',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  return transaction(async c=>{
    const mine=await one(c,'SELECT node_id FROM v7_nodes WHERE node_id=? AND state="APPROVED"',[node.node_id]);
    if(!mine)fault('NODE_NOT_APPROVED',403);
    // Signed GET creates a nonce replay record as usual, but never runs
    // election/fencing. Only an authorized heartbeat or Owner mutation
    // advances the Master. Read-side promotion would falsify pilot evidence.
    const ld=await leader(c,false);
    return {epoch:Number(ld.epoch),master_agent_id:ld.master_agent_id,
      phase:ld.phase,paused:Boolean(ld.paused),backups:[ld.backup1,ld.backup2]};
  });
}));
app.get('/v7/tasks/available',jsonRoute(async req=>{
  const node=await nodeAuth(req),agentId=requireId(req.header('x-sutradhar-agent'));
  return transaction(async c=>{
    await leader(c); // Serialize availability check with Owner fence.
    await signedAgent(c,node.node_id,agentId);
    await requireNoNodeDrain(c,node.node_id);
    const allowed=await rows(c,
      'SELECT t.ticket_id,t.project_id,t.title,t.risk,t.version FROM v7_tickets t '+
      'JOIN v7_project_agents a ON a.project_id=t.project_id '+
      'WHERE a.agent_id=? AND a.can_develop=1 AND t.status="READY" ORDER BY t.updated_at LIMIT 50',
      [agentId]);
    const out=[];
    for(const t of allowed){
      const unmet=await one(c,'SELECT COUNT(*) n FROM v7_dependencies d JOIN v7_tickets p ON p.ticket_id=d.dependency_id WHERE d.ticket_id=? AND p.status!="DONE"',[t.ticket_id]);
      if(Number(unmet.n)===0)out.push(t);
    }
    return out;
  });
}));
app.get('/v7/tasks/detail/:ticketId',jsonRoute(async req=>{
  const node=await nodeAuth(req),agentId=requireId(req.header('x-sutradhar-agent'));
  const ticketId=requireId(req.params.ticketId);
  return transaction(async c=>{
    await signedAgent(c,node.node_id,agentId);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    if(!t)fault('TASK_NOT_FOUND',404);
    const access=await one(c,'SELECT can_develop,can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
      [t.project_id,agentId]);
    if(!access||(Number(access.can_develop)!==1&&Number(access.can_qa)!==1))fault('PROJECT_ACCESS_DENIED',403);
    const p=await one(c,'SELECT repository,base_branch FROM v7_projects WHERE project_id=?',[t.project_id]);
    const latest=await one(c,'SELECT generation,summary,next_action,content_sha256 FROM v7_checkpoints WHERE ticket_id=? ORDER BY generation DESC LIMIT 1',[ticketId]);
    return {ticket_id:t.ticket_id,project_id:t.project_id,repository:p.repository,base_branch:p.base_branch,
      title:t.title,description:t.description,baseline_sha:t.baseline_sha,branch_name:t.branch_name,
      risk:t.risk,status:t.status,version:t.version,write_scopes:t.scopes_json,
      acceptance_criteria:t.criteria_json,worker_agent_id:t.worker_agent_id,
      candidate_head_sha:t.candidate_head_sha,candidate_tree_sha:t.candidate_tree_sha,
      latest_checkpoint:latest};
  });
}));
async function recoveryManifest(c:PoolConnection){
  const ld=await leader(c,false),epoch=Number(ld.epoch);
  // Current work state is authoritative; finished-ticket history is retained
  // in MySQL but is not part of every new Master startup snapshot.
  const tickets=await rows(c,'SELECT ticket_id,project_id,status,version,worker_agent_id FROM v7_tickets WHERE status NOT IN ("DONE","CANCELLED") ORDER BY updated_at,ticket_id LIMIT 301');
  const checkpoints=await rows(c,'SELECT x.ticket_id,x.generation,x.summary,x.next_action,x.content_sha256 FROM v7_checkpoints x INNER JOIN (SELECT ticket_id,MAX(generation) gen FROM v7_checkpoints GROUP BY ticket_id) y ON y.ticket_id=x.ticket_id AND y.gen=x.generation JOIN v7_tickets t ON t.ticket_id=x.ticket_id WHERE t.status NOT IN ("DONE","CANCELLED") ORDER BY x.ticket_id LIMIT 301');
  // Events form an append-only audit ledger. Recovery needs a bounded recent
  // window and high-water cursor, not every historical event ever recorded.
  const events=await rows(c,'SELECT event_id,event_type,actor,epoch,resource_id,created_at FROM v7_events '+
    'WHERE event_type!="NODE_HEARTBEAT_ACCEPTED" ORDER BY event_id DESC LIMIT 300');
  const newest=await one(c,'SELECT COALESCE(MAX(event_id),0) AS event_id FROM v7_events '+
    'WHERE event_type!="NODE_HEARTBEAT_ACCEPTED"');
  // Unknown external Git side effects are a separate safety barrier, even
  // when the related ticket has no live worker lease.
  const unresolvedGitJobs=await rows(c,'SELECT ticket_id,agent_id,epoch,state FROM v7_git_jobs WHERE state IN ("RUNNING","NEEDS_RECONCILIATION") ORDER BY ticket_id LIMIT 301');
  if(tickets.length>300||checkpoints.length>300||unresolvedGitJobs.length>300)
    fault('RECOVERY_PAGINATION_REQUIRED',409);
  const result={epoch,phase:ld.phase,tickets,checkpoints,events,
    event_high_watermark:Number(newest.event_id),unresolved_git_jobs:unresolvedGitJobs};
  return {...result,manifest_sha256:digest(JSON.stringify(result))};
}
app.get('/v7/recovery',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  const agentId=requireId(req.header('x-sutradhar-agent'));
  return transaction(async c=>{
    await signedAgent(c,node.node_id,agentId);
    const ld=await leader(c,false);
    if(ld.master_agent_id!==agentId||!ld.lease_until||
       Date.parse(ld.lease_until+'Z')<=await dbNow(c))fault('NOT_LIVE_MASTER',403);
    return recoveryManifest(c);
  });
}));
app.post('/v7/leadership/reconcile',jsonRoute(async req=>{
  const node=await nodeAuth(req),id=requireId(req.body?.agent_id);
  const epoch=Number(req.body?.expected_master_epoch);
  if(typeof req.body?.manifest_sha256!=='string'||!/^[0-9a-f]{64}$/.test(req.body.manifest_sha256))
    fault('MISSING_RECOVERY_MANIFEST',400);
  return transaction(async c=>{
    const ld=await leader(c);
    await signedAgent(c,node.node_id,id);
    if(ld.master_agent_id!==id||Number(ld.epoch)!==epoch||!ld.lease_until||
       Date.parse(ld.lease_until+'Z')<=await dbNow(c))fault('STALE_MASTER_EPOCH',409);
    // A valid Master may lose the HTTP reply AFTER Central commits READY.
    // Check the durable (actor, request_id, epoch, manifest) receipt FIRST;
    // new intents still enforce RECOVERING, exact manifest and reconciliation
    // barriers. The leader row is held FOR UPDATE throughout, so concurrent
    // identical reconciliations have one event and one durable response.
    return idem(c,id,req.body.request_id,'RECOVERY',{epoch,hash:req.body.manifest_sha256},async()=>{
      if(ld.phase!=='RECOVERING')fault('INVALID_PHASE',409);
      const current=await recoveryManifest(c);
      if(current.manifest_sha256!==req.body.manifest_sha256)fault('STALE_RECOVERY_MANIFEST',409);
      if(current.tickets.some(t=>t.status==='RECONCILIATION_REQUIRED'))
        fault('TASK_RECONCILIATION_REQUIRED',423);
      if(current.unresolved_git_jobs.length)
        fault('GIT_RECONCILIATION_REQUIRED',423);
      await c.query('UPDATE v7_cluster SET phase="READY",version=version+1 WHERE singleton=1');
      await event(c,'MASTER_RECOVERY_ACK',id,epoch,null,{manifest_sha256:req.body.manifest_sha256});
      return {accepted:true,phase:'READY',epoch};
    });
  });
}));
app.post('/v7/tasks/plan',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id),projectId=requireId(d.project_id);
  const scope=d.write_scopes, deps=d.dependencies||[];
  if(!Array.isArray(scope)||!scope.length||scope.length>30||!scope.every(safeScope)||new Set(scope).size!==scope.length||
    !Array.isArray(deps)||deps.length>30||deps.includes(ticketId))fault('INVALID_TASK_SCOPE',400);
  const risk=d.risk;
  if(!['LOW','MEDIUM','HIGH','CORE'].includes(risk))fault('INVALID_RISK',400);
  const criteria=d.acceptance_criteria;
  if(!Array.isArray(criteria)||!criteria.length||criteria.length>30||criteria.some(x=>typeof x!=='string'||x.length>500))
    fault('MISSING_ACCEPTANCE_CRITERIA',400);
  const baseline=requireSha(d.baseline_sha),title=requireStr(d.title,220),description=requireStr(d.description,10000);
  const fingerprint=digest(JSON.stringify([projectId,title.trim().toLowerCase(),
    description.trim().toLowerCase(),[...scope].sort(),[...deps].sort()]));
  const branch=requireStr(d.branch_name,120);
  if(!validTaskBranch(branch))fault('INVALID_BRANCH',400);
  return transaction(async c=>{
    const ld=await readyMaster(c,node.node_id,agentId,d.expected_master_epoch);
    return idem(c,agentId,d.request_id,'TASK_PLAN',d,async()=>{
      const project=await one(c,'SELECT * FROM v7_projects WHERE project_id=? AND status="ACTIVE" FOR UPDATE',[projectId]);
      if(!project)fault('PROJECT_NOT_FOUND',404);
      const sensitive=scope.some(isProtectedScope);
      const approvalNeeded=risk==='CORE'||risk==='HIGH'||sensitive;
      let approved=false;
      if(d.proposal_id){
        const proposal=await one(c,'SELECT state FROM v7_approvals WHERE proposal_id=? AND ticket_id=? FOR UPDATE',[d.proposal_id,ticketId]);
        approved=proposal?.state==='APPROVED';
      }
      const status=approvalNeeded&&!approved?'WAITING_AUTHORIZATION':'READY';
      for(const dependency of deps){
        requireId(dependency);
        const other=await one(c,'SELECT project_id FROM v7_tickets WHERE ticket_id=?',[dependency]);
        if(!other||other.project_id!==projectId)fault('INVALID_DEPENDENCY',409);
      }
      await c.query('INSERT INTO v7_tickets(ticket_id,project_id,creator_agent_id,fingerprint,created_epoch,title,description,baseline_sha,branch_name,risk,scopes_json,criteria_json,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [ticketId,projectId,agentId,fingerprint,Number(ld.epoch),title,description,baseline,branch,risk,JSON.stringify(scope),JSON.stringify(criteria),status]);
      for(const dep of deps)await c.query('INSERT INTO v7_dependencies(ticket_id,dependency_id) VALUES(?,?)',[ticketId,dep]);
      if(approvalNeeded&&!approved){
        const proposalId=d.proposal_id?requireId(d.proposal_id):'approval_'+crypto.randomUUID().replace(/-/g,'');
        if(!d.proposal_id)await c.query('INSERT INTO v7_approvals(proposal_id,ticket_id,kind,justification) VALUES(?,?,?,?)',
          [proposalId,ticketId,sensitive?'CORE_SECURITY':risk,description.slice(0,500)]);
      }
      await event(c,'TASK_PLANNED',agentId,Number(ld.epoch),ticketId,{project_id:projectId,status,risk,scope_digest:digest(JSON.stringify(scope))});
      return {accepted:true,ticket_id:ticketId,status,version:1,owner_approval_required:approvalNeeded&&!approved};
    });
  });
}));
app.post('/v7/tasks/claim',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{},agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  return transaction(async c=>{
    // Leader row FIRST: this serializes claims with Owner fence activation.
    // Once fenced, no new claim can race in between verification and insert.
    const ld=await leader(c);
    await signedAgent(c,node.node_id,agentId);
    await requireNoNodeDrain(c,node.node_id);
    if(ld.paused||ld.phase!=='READY'||Number(ld.epoch)!==Number(d.expected_master_epoch)||
       !ld.lease_until||Date.parse(ld.lease_until+'Z')<=await dbNow(c))fault('NO_READY_MASTER',423);
    return idem(c,agentId,d.request_id,'TASK_CLAIM',d,async()=>{
      // Project row serializes all overlapping path reservations.
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
      if(!t)fault('TASK_NOT_FOUND',404);
      await one(c,'SELECT project_id FROM v7_projects WHERE project_id=? FOR UPDATE',[t.project_id]);
      const locked=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(locked.status!=='READY'||(d.expected_version!==undefined&&Number(d.expected_version)!==Number(locked.version)))
        fault('TASK_NOT_READY',409);
      const outstanding=await rows(c,'SELECT dependency_id FROM v7_dependencies WHERE ticket_id=?',[ticketId]);
      for(const dep of outstanding){const p=await one(c,'SELECT status FROM v7_tickets WHERE ticket_id=?',[dep.dependency_id]);
        if(p?.status!=='DONE')fault('DEPENDENCY_UNVERIFIED',409);}
      const busy=await one(c,'SELECT COUNT(*) n FROM v7_leases WHERE agent_id=? AND revoked=0 AND expires_at>UTC_TIMESTAMP(3)',[agentId]);
      if(Number(busy.n)>=1)fault('AGENT_CAPACITY_EXCEEDED',409);
      const access=await one(c,'SELECT can_develop FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [t.project_id,agentId]);
      if(!access?.can_develop)fault('PROJECT_ACCESS_DENIED',403);
      const scope=typeof locked.scopes_json==='string'?JSON.parse(locked.scopes_json):locked.scopes_json;
      const reserved=await rows(c,'SELECT scope,ticket_id FROM v7_reservations WHERE project_id=? FOR UPDATE',[t.project_id]);
      for(const s of scope)if(reserved.some(x=>scopesOverlap(s,x.scope)))fault('SCOPE_CONFLICT',409);
      for(const s of scope)await c.query('INSERT INTO v7_reservations(project_id,scope,ticket_id) VALUES(?,?,?)',[t.project_id,s,ticketId]);
      const leaseId=crypto.randomUUID();
      await c.query('INSERT INTO v7_leases(ticket_id,agent_id,epoch,lease_id,expires_at,revoked) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 600 SECOND),0) ON DUPLICATE KEY UPDATE agent_id=VALUES(agent_id),epoch=VALUES(epoch),lease_id=VALUES(lease_id),expires_at=VALUES(expires_at),revoked=0',
        [ticketId,agentId,Number(ld.epoch),leaseId]);
      await c.query('UPDATE v7_tickets SET status="CLAIMED",worker_agent_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE ticket_id=?',
        [agentId,ticketId]);
      await event(c,'TASK_CLAIMED',agentId,Number(ld.epoch),ticketId);
      return {accepted:true,ticket_id:ticketId,lease_id:leaseId,epoch:Number(ld.epoch),version:Number(locked.version)+1,
        lease_seconds:600,write_scopes:scope};
    });
  });
}));
async function workerLease(c:PoolConnection,nodeId:string,agentId:string,ticketId:string,leaseId:string,epoch:any){
  const ld=await leader(c);
  await signedAgent(c,nodeId,agentId);
  if(ld.paused||Number(ld.epoch)!==Number(epoch)||!ld.master_agent_id||ld.phase!=='READY'||
     !ld.lease_until||Date.parse(ld.lease_until+'Z')<=await dbNow(c)||
     !await approvedMasterLease(c,ld))
    fault('STALE_MASTER_EPOCH',409);
  const lease=await one(c,'SELECT * FROM v7_leases WHERE ticket_id=? FOR UPDATE',[ticketId]);
  if(!lease||lease.revoked||lease.agent_id!==agentId||lease.lease_id!==leaseId||
     Number(lease.epoch)!==Number(epoch))fault('WORKER_LEASE_INVALID',403);
  if(Date.parse(lease.expires_at+'Z')<=await dbNow(c))fault('WORKER_LEASE_EXPIRED',409);
  return await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
}
// The existing v7_tickets.updated_at column is reset only upon a successful
// task claim, not by checkpoints. It is the Central DB claim-time anchor for a
// bounded work session. No new schema column or Hostinger migration is needed.
async function extendWorkerLease(c:PoolConnection,ticketId:string,t:any,
    kind:'renew'|'checkpoint'){
  const lease=await one(c,'SELECT expires_at FROM v7_leases WHERE ticket_id=?',[ticketId]);
  if(!lease)fault('WORKER_LEASE_INVALID',403);
  const parseDb=(date:any)=>typeof date==='string'?
    Date.parse(date.replace(' ','T')+'Z'):NaN;
  const now=await dbNow(c);
  let extension;
  try{
    extension=planWorkerLeaseExtension(parseDb(t.updated_at),
      parseDb(lease.expires_at),now,kind);
  }catch(e:any){
    const code=String(e?.message||'WORKER_RENEWAL_UNAVAILABLE');
    if(!['WORKER_LEASE_CLOCK_INVALID','WORKER_LEASE_EXPIRED',
      'WORKER_RENEWAL_NOT_DUE','WORKER_RENEWAL_BUDGET_EXHAUSTED'].includes(code))
      fault('WORKER_RENEWAL_UNAVAILABLE',409);
    fault(code,409);
  }
  const expiresAt=new Date(extension!.expires_at_ms).toISOString();
  await c.query('UPDATE v7_leases SET expires_at=? WHERE ticket_id=?',
    [expiresAt.replace('T',' ').replace('Z',''),ticketId]);
  return {lease_expires_at:expiresAt,
    lease_seconds_remaining:extension!.seconds_remaining,
    absolute_claim_deadline:new Date(extension!.absolute_deadline_ms).toISOString()};
}
// An explicit, audited, signed renewal is allowed ONLY while the original
// worker lease and current approved Master are still live. A 4-hour cap from
// the original claim prevents unattended indefinite lease retention.
app.post('/v7/tasks/renew-lease',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const id=requireId(d.agent_id),ticket=requireId(d.ticket_id);
  const leaseId=requireId(d.lease_id),reason=requireStr(d.reason,300);
  if(reason.length<12)fault('WORKER_RENEW_REASON_REQUIRED',400);
  return transaction(c=>idem(c,id,d.request_id,'WORKER_RENEW_LEASE',d,async()=>{
    const t=await workerLease(c,node.node_id,id,ticket,leaseId,d.expected_master_epoch);
    if(!t||!['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(t.status))
      fault('WORKER_RENEW_STATE_INVALID',409);
    const expiry=await extendWorkerLease(c,ticket,t,'renew');
    await event(c,'WORKER_LEASE_RENEWED',id,Number(d.expected_master_epoch),
      ticket,{reason:reason.slice(0,300),expires_at:expiry.lease_expires_at});
    return {accepted:true,ticket_id:ticket,agent_id:id,
      lease_id:leaseId,epoch:Number(d.expected_master_epoch),
      ...expiry,automatic_execution_allowed:false};
  }));
}));
// Read-only restart preflight: verify the local record's existing live lease.
// No extension, re-claim, new permission or Git side-effect is performed.
app.post('/v7/tasks/resume-check',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  return transaction(async c=>{
    const t=await workerLease(c,node.node_id,agentId,ticketId,
      requireId(d.lease_id),d.expected_master_epoch);
    if(!t||!['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(t.status))
      fault('TASK_NOT_RESUMABLE',409);
    const project=await one(c,'SELECT repository FROM v7_projects WHERE project_id=?',[t.project_id]);
    if(!project)fault('PROJECT_NOT_FOUND',404);
    const latest=await one(c,'SELECT generation,summary,next_action,content_sha256 FROM v7_checkpoints WHERE ticket_id=? ORDER BY generation DESC LIMIT 1',[ticketId]);
    return {resume_allowed:true,automatic_execution_allowed:false,
      ticket_id:ticketId,agent_id:agentId,epoch:Number(d.expected_master_epoch),
      project_id:t.project_id,repository:project.repository,baseline_sha:t.baseline_sha,
      branch_name:t.branch_name,write_scopes:t.scopes_json,status:t.status,
      latest_checkpoint:latest};
  });
}));
app.post('/v7/tasks/checkpoint',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{},id=requireId(d.agent_id),ticket=requireId(d.ticket_id);
  const summary=requireStr(d.summary,8000),next=requireStr(d.next_action,500);
  return transaction(async c=>idem(c,id,d.request_id,'CHECKPOINT',d,async()=>{
    const t=await workerLease(c,node.node_id,id,ticket,requireId(d.lease_id),d.expected_master_epoch);
    if(!['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(t.status))fault('CHECKPOINT_NOT_ALLOWED',409);
    const latest=await one(c,'SELECT COALESCE(MAX(generation),0) n FROM v7_checkpoints WHERE ticket_id=?',[ticket]);
    const generation=Number(latest.n)+1,hash=digest(summary+'\n'+next);
    await c.query('INSERT INTO v7_checkpoints(ticket_id,generation,agent_id,epoch,summary,next_action,content_sha256) VALUES(?,?,?,?,?,?,?)',
      [ticket,generation,id,d.expected_master_epoch,summary,next,hash]);
    await c.query('UPDATE v7_tickets SET status="CHECKPOINTED",version=version+1 WHERE ticket_id=?',[ticket]);
    // Checkpoints also respect the absolute claim lifetime. They may extend
    // active work, but never bypass the same bounded renewal safety budget.
    const expiry=await extendWorkerLease(c,ticket,t,'checkpoint');
    await event(c,'TASK_CHECKPOINTED',id,Number(d.expected_master_epoch),ticket,{generation,sha256:hash});
    return {accepted:true,ticket_id:ticket,generation,content_sha256:hash,
      version:Number(t.version)+1,...expiry};
  }));
}));
app.post('/v7/tasks/submit',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{},id=requireId(d.agent_id),ticket=requireId(d.ticket_id);
  const head=requireSha(d.candidate_head_sha),tree=requireSha(d.candidate_tree_sha);
  return transaction(async c=>idem(c,id,d.request_id,'TASK_SUBMIT',d,async()=>{
    const t=await workerLease(c,node.node_id,id,ticket,requireId(d.lease_id),d.expected_master_epoch);
    if(!['CLAIMED','RUNNING','CHECKPOINTED','TEST_FAILED'].includes(t.status))fault('SUBMISSION_NOT_ALLOWED',409);
    const checkpoint=await one(c,'SELECT checkpoint_id FROM v7_checkpoints WHERE ticket_id=? LIMIT 1',[ticket]);
    if(!checkpoint)fault('CHECKPOINT_REQUIRED',409);
    await c.query('UPDATE v7_tickets SET status="SUBMITTED_FOR_REVIEW",candidate_head_sha=?,candidate_tree_sha=?,version=version+1 WHERE ticket_id=?',
      [head,tree,ticket]);
    await event(c,'TASK_SUBMITTED',id,Number(d.expected_master_epoch),ticket,{head,tree});
    return {accepted:true,ticket_id:ticket,status:'SUBMITTED_FOR_REVIEW'};
  }));
}));
// Signed node/QA-agent upload: verify the *exact report bytes* and device
// signature against the approved node key from MySQL. This only creates a
// PENDING Owner review. No QA pass, integration or Git privilege is granted.
// Owner-only review queue: safe metadata, no private report blobs or keys.
// The operator must still obtain and inspect the original real Docker evidence
// independently before deciding a review. Zero automatic approval.
app.get('/v7/owner/qa-reviews',jsonRoute(async req=>{
  admin(req);
  return transaction(async c=>{
    const reviews=await rows(c,
      'SELECT proposal_id,ticket_id,justification,created_at '+
      'FROM v7_approvals WHERE kind="QA_EVIDENCE_REVIEW" '+
      'AND state="PENDING" ORDER BY created_at ASC LIMIT 50');
    return {reviews:reviews.map(row=>{
      const p=storedQaProof(row.justification,'QA_REVIEW_PROOF_CORRUPT');
      if(qaEvidenceProposalId(p)!==row.proposal_id||p.ticket_id!==row.ticket_id)
        fault('QA_REVIEW_PROOF_CORRUPT',409);
      return {review_proposal_id:row.proposal_id,ticket_id:p.ticket_id,
        qa_agent_id:p.qa_agent_id,developer_agent_id:p.developer_agent_id,
        node_id:p.node_id,candidate_head_sha:p.candidate_head_sha,
        candidate_tree_sha:p.candidate_tree_sha,
        baseline_sha:p.baseline_sha,evidence_sha256:p.evidence_sha256,
        image_sha256:p.image_sha256,passed:p.passed,
        state:'PENDING',owner_review_required:true};
    }),qa_approved_automatically:false,integration_performed:false};
  });
}));
app.post('/v7/tasks/qa-evidence',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  return transaction(async c=>{
    await leader(c);
    await signedAgent(c,node.node_id,agentId,true);
    await requireNoNodeDrain(c,node.node_id);
    return idem(c,agentId,d.request_id,'QA_EVIDENCE',d,async()=>{
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(!t||t.status!=='SUBMITTED_FOR_REVIEW'||t.worker_agent_id===agentId)
        fault('QA_EVIDENCE_INDEPENDENCE_OR_STATE',409);
      const dev=await one(c,'SELECT node_id FROM v7_agents WHERE agent_id=?',
        [t.worker_agent_id]);
      if(!dev||dev.node_id===node.node_id)
        fault('QA_DEVICE_NOT_INDEPENDENT',403);
      const grant=await one(c,
        'SELECT can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [t.project_id,agentId]);
      if(!grant?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
      const proof=uploadedQaProof({
        evidence_base64:d.evidence_base64,attestation:d.attestation,
        enrolled_public_key_pem:node.public_key_pem,node_id:node.node_id,
        agent_id:agentId,ticket_id:ticketId,worker_agent_id:t.worker_agent_id,
        baseline_sha:t.baseline_sha,candidate_head_sha:t.candidate_head_sha,
        candidate_tree_sha:t.candidate_tree_sha});
      if(d.evidence_ref!==proof.evidence_ref)fault('QA_EVIDENCE_REF_MISMATCH',400);
      const proposalId=qaEvidenceProposalId(proof);
      const prior=await one(c,'SELECT * FROM v7_approvals WHERE proposal_id=? FOR UPDATE',
        [proposalId]);
      if(prior){
        const p=storedQaProof(prior.justification,'QA_EVIDENCE_EXISTING_PROOF_INVALID');
        if(prior.kind!=='QA_EVIDENCE_REVIEW'||prior.ticket_id!==ticketId||
           JSON.stringify(p)!==JSON.stringify(proof))
          fault('QA_EVIDENCE_PROPOSAL_COLLISION',409);
      }else{
        await c.query('INSERT INTO v7_approvals(proposal_id,ticket_id,kind,justification) VALUES(?,?,?,?)',
          [proposalId,ticketId,'QA_EVIDENCE_REVIEW',JSON.stringify(proof)]);
      }
      await event(c,'QA_EVIDENCE_DEVICE_VERIFIED',agentId,Number((await leader(c)).epoch),
        ticketId,{proposal:proposalId,evidence_sha256:proof.evidence_sha256,
          node_id:node.node_id,passed:proof.passed});
      return {accepted:true,review_proposal_id:proposalId,
        status:prior?.state==='APPROVED'?'APPROVED_OWNER_REVIEW':
          prior?.state==='DENIED'?'DENIED_OWNER_REVIEW':'PENDING_OWNER_REVIEW',
        evidence_sha256:proof.evidence_sha256,device_signature_verified:true,
        qa_approved:false,qa_receipt_submitted:false,
        integration_performed:false,git_published:false};
    });
  });
}));
app.post('/v7/tasks/qa-receipt',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{},id=requireId(d.agent_id),ticket=requireId(d.ticket_id);
  const evidenceRef=requireStr(d.evidence_ref,450),hash=requireStr(d.evidence_sha256,64);
  if(!/^[0-9a-f]{64}$/.test(hash)||typeof d.passed!=='boolean')fault('INVALID_QA_RECEIPT',400);
  // No legacy hash-only attestation or generic Owner approval can advance QA.
  // The proof must be independently signed, Central-verified and Owner-reviewed.
  return transaction(async c=>{
    await leader(c); // QA work from a fenced PC cannot start anew.
    await signedAgent(c,node.node_id,id,true);
    await requireNoNodeDrain(c,node.node_id);
    return idem(c,id,d.request_id,'QA_RECEIPT',d,async()=>{
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticket]);
      if(!t||t.status!=='SUBMITTED_FOR_REVIEW'||t.worker_agent_id===id)fault('QA_INDEPENDENCE_OR_STATE',409);
      const developer=await one(c,'SELECT node_id FROM v7_agents WHERE agent_id=?',[t.worker_agent_id]);
      if(!developer||developer.node_id===node.node_id)
        fault('QA_DEVICE_NOT_INDEPENDENT',403);
      const access=await one(c,'SELECT can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [t.project_id,id]);
      if(!access?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
      if(t.candidate_head_sha!==d.candidate_head_sha||t.candidate_tree_sha!==d.candidate_tree_sha)
        fault('CANDIDATE_SHA_MISMATCH',409);
      if(typeof d.review_proposal_id!=='string'||
         !/^qaev_[a-f0-9]{64}$/.test(d.review_proposal_id)||
         evidenceRef!=='sha256:'+hash)
        fault('QA_VERIFIED_REVIEW_REQUIRED',403);
      const reviewId=d.review_proposal_id;
      const review=await one(c,'SELECT * FROM v7_approvals WHERE proposal_id=? '+
        'AND ticket_id=? AND kind="QA_EVIDENCE_REVIEW" FOR UPDATE',[reviewId,ticket]);
      if(!review||review.state!=='APPROVED')fault('QA_VERIFIED_OWNER_REVIEW_REQUIRED',403);
      const proof=storedQaProof(review.justification,'QA_VERIFIED_REVIEW_CORRUPT');
      if(qaEvidenceProposalId(proof)!==reviewId||
         proof.node_id!==node.node_id||proof.qa_agent_id!==id||
         proof.developer_agent_id!==t.worker_agent_id||
         proof.ticket_id!==ticket||proof.baseline_sha!==t.baseline_sha||
         proof.candidate_head_sha!==t.candidate_head_sha||
         proof.candidate_tree_sha!==t.candidate_tree_sha||
         proof.evidence_sha256!==hash||proof.evidence_ref!==evidenceRef||
         proof.passed!==d.passed)
        fault('QA_VERIFIED_EVIDENCE_MISMATCH',409);
      const used=await one(c,'SELECT receipt_id FROM v7_qa_receipts '+
        'WHERE ticket_id=? AND evidence_sha256=? FOR UPDATE',[ticket,hash]);
      if(used)fault('QA_EVIDENCE_ALREADY_CONSUMED',409);
      const receipt=crypto.randomUUID();
      await c.query('INSERT INTO v7_qa_receipts(receipt_id,ticket_id,agent_id,head_sha,tree_sha,passed,evidence_sha256,evidence_ref) VALUES(?,?,?,?,?,?,?,?)',
        [receipt,ticket,id,t.candidate_head_sha,t.candidate_tree_sha,d.passed?1:0,hash,evidenceRef]);
      const status=d.passed?'INTEGRATING':'TEST_FAILED';
      await c.query('UPDATE v7_tickets SET status=?,version=version+1 WHERE ticket_id=?',[status,ticket]);
      await event(c,'QA_RECEIPT',id,Number((await leader(c)).epoch),ticket,{receipt,passed:d.passed,hash});
      return {accepted:true,receipt_id:receipt,ticket_id:ticket,status,
        // Signed agent receipt is NOT proof of live GitHub merge/deployment.
        evidence_level:'AGENT_ATTESTED'};
    });
  });
}));
app.post('/v7/tasks/propose-change',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{},id=requireId(d.agent_id),ticket=requireId(d.ticket_id);
  const kind=requireStr(d.kind,50),reason=requireStr(d.justification,1500);
  if(kind==='QA_EVIDENCE_REVIEW')fault('QA_REVIEW_KIND_RESERVED',403);
  return transaction(async c=>{
    await leader(c);
    await signedAgent(c,node.node_id,id);
    await requireNoNodeDrain(c,node.node_id);
    return idem(c,id,d.request_id,'PROPOSE_CHANGE',d,async()=>{
      const t=await one(c,'SELECT ticket_id FROM v7_tickets WHERE ticket_id=?',[ticket]);
      if(!t)fault('TASK_NOT_FOUND',404);
      const proposal='proposal_'+crypto.randomUUID().replace(/-/g,'');
      await c.query('INSERT INTO v7_approvals(proposal_id,ticket_id,kind,justification) VALUES(?,?,?,?)',
        [proposal,ticket,kind,reason]);
      await event(c,'CHANGE_PROPOSAL',id,Number((await leader(c)).epoch),ticket,{proposal,kind});
      return {accepted:true,proposal_id:proposal,status:'PENDING'};
    });
  });
}));
// The PC performs the scoped Git push. Hostinger reserves one attempt, and
// *independently* reads the remote GitHub commit/tree before accepting proof.
// Signed, strictly READ-ONLY preflight. The QA PC may inspect a candidate
// before reserving ANY one-shot remote Git write. No future promise that a
// remote branch will remain absent is implied by this Central response.
app.get('/v7/git/preflight/:ticketId',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  const agentId=requireId(req.header('x-sutradhar-agent'));
  const ticketId=requireId(req.params.ticketId);
  return transaction(async c=>{
    const ld=await leader(c,false);
    await signedAgent(c,node.node_id,agentId,true);
    await requireNoNodeDrain(c,node.node_id);
    if(ld.paused||ld.phase!=='READY'||!ld.lease_until||
       Date.parse(ld.lease_until+'Z')<=await dbNow(c)||
       !await approvedMasterLease(c,ld))
      fault('GIT_PREFLIGHT_MASTER_UNAVAILABLE',409);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    if(!t||t.status!=='INTEGRATING'||t.worker_agent_id===agentId)
      fault('GIT_PREFLIGHT_QA_INCOMPLETE',409);
    const dev=await one(c,'SELECT node_id FROM v7_agents WHERE agent_id=?',
      [t.worker_agent_id]);
    if(!dev||dev.node_id===node.node_id)
      fault('GIT_PREFLIGHT_QA_DEVICE_NOT_INDEPENDENT',403);
    const allowed=await one(c,'SELECT can_qa FROM v7_project_agents '+
      'WHERE project_id=? AND agent_id=?',[t.project_id,agentId]);
    if(!allowed?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
    const qa=await one(c,'SELECT receipt_id,evidence_sha256 FROM v7_qa_receipts '+
      'WHERE ticket_id=? AND agent_id=? AND passed=1 AND head_sha=? AND tree_sha=?',
      [ticketId,agentId,t.candidate_head_sha,t.candidate_tree_sha]);
    if(!qa)fault('GIT_PREFLIGHT_QA_RECEIPT_MISSING',409);
    const p=await one(c,'SELECT repository,base_branch FROM v7_projects WHERE project_id=?',
      [t.project_id]);
    if(!p)fault('GIT_PREFLIGHT_PROJECT_MISSING',409);
    if(['HIGH','CORE'].includes(t.risk)){
      const approval=await one(c,'SELECT proposal_id FROM v7_approvals '+
        'WHERE ticket_id=? AND state="APPROVED" AND kind!="QA_EVIDENCE_REVIEW"',
        [ticketId]);
      if(!approval)fault('OWNER_APPROVAL_REQUIRED',403);
    }
    if(await one(c,'SELECT ticket_id FROM v7_git_jobs WHERE ticket_id=?',[ticketId]))
      fault('GIT_JOB_ALREADY_RESERVED_RECONCILE',409);
    const scopes=typeof t.scopes_json==='string'?JSON.parse(t.scopes_json):t.scopes_json;
    return {preflight_ready:true,one_shot:true,automatic_push_allowed:false,
      agent_id:agentId,ticket_id:ticketId,project_id:t.project_id,
      repository:p.repository,base_branch:p.base_branch,branch:t.branch_name,
      baseline_sha:t.baseline_sha,
      candidate_head_sha:t.candidate_head_sha,
      candidate_tree_sha:t.candidate_tree_sha,
      write_scopes:scopes,version:Number(t.version),epoch:Number(ld.epoch),
      qa_receipt_id:qa.receipt_id,
      qa_evidence_sha256:qa.evidence_sha256,
      git_published:false,merge_performed:false};
  });
}));
app.post('/v7/git/reserve',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  return transaction(async c=>{
    const ld=await leader(c);
    await signedAgent(c,node.node_id,agentId,true);
    await requireNoNodeDrain(c,node.node_id);
    if(ld.paused||ld.phase!=='READY'||Number(ld.epoch)!==Number(d.expected_master_epoch)||
       !ld.lease_until||Date.parse(ld.lease_until+'Z')<=await dbNow(c))
      fault('STALE_MASTER_EPOCH',409);
    return idem(c,agentId,d.request_id,'GIT_RESERVE',{
      ticketId,epoch:d.expected_master_epoch,
      head:d.expected_candidate_head_sha,tree:d.expected_candidate_tree_sha,
      version:d.expected_ticket_version},async()=>{
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(!t||t.status!=='INTEGRATING'||t.worker_agent_id===agentId)fault('QA_NOT_COMPLETE',409);
      if(t.candidate_head_sha!==d.expected_candidate_head_sha||
         t.candidate_tree_sha!==d.expected_candidate_tree_sha||
         Number(t.version)!==d.expected_ticket_version)
        fault('GIT_RESERVATION_CANDIDATE_CHANGED',409);
      const developer=await one(c,
        'SELECT node_id FROM v7_agents WHERE agent_id=?',[t.worker_agent_id]);
      if(!developer||developer.node_id===node.node_id)
        fault('GIT_RESERVATION_QA_DEVICE_NOT_INDEPENDENT',403);
      const allowed=await one(c,'SELECT can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [t.project_id,agentId]);
      if(!allowed?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
      const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? AND agent_id=? AND passed=1 AND head_sha=? AND tree_sha=?',
        [ticketId,agentId,t.candidate_head_sha,t.candidate_tree_sha]);
      if(!qa)fault('INDEPENDENT_QA_RECEIPT_REQUIRED',409);
      if(!SHA_RE.test(String(t.candidate_head_sha||''))||
         !SHA_RE.test(String(t.candidate_tree_sha||'')))
        fault('GIT_RESERVATION_CANDIDATE_INVALID',409);
      if(['HIGH','CORE'].includes(t.risk)){
        const approval=await one(c,'SELECT proposal_id FROM v7_approvals WHERE ticket_id=? AND state="APPROVED" AND kind!="QA_EVIDENCE_REVIEW"',[ticketId]);
        if(!approval)fault('OWNER_APPROVAL_REQUIRED',403);
      }
      if(await one(c,'SELECT ticket_id FROM v7_git_jobs WHERE ticket_id=?',[ticketId]))
        fault('GIT_JOB_ALREADY_RESERVED_RECONCILE',409);
      await c.query('INSERT INTO v7_git_jobs(ticket_id,agent_id,epoch,request_id,state) VALUES(?,?,?,?,"RUNNING")',
        [ticketId,agentId,Number(ld.epoch),d.request_id]);
      await event(c,'GIT_PUBLICATION_RESERVED',agentId,Number(ld.epoch),ticketId);
      const p=await one(c,'SELECT repository,base_branch FROM v7_projects WHERE project_id=?',
        [t.project_id]);
      if(!p)fault('GIT_RESERVATION_PROJECT_MISSING',409);
      return {accepted:true,ticket_id:ticketId,repository:p.repository,
        base_branch:p.base_branch,branch:t.branch_name,baseline_sha:t.baseline_sha,
        candidate_head_sha:t.candidate_head_sha,candidate_tree_sha:t.candidate_tree_sha,
        epoch:Number(ld.epoch),one_shot:true};
    });
  });
}));
app.get('/v7/git/job/:ticketId',jsonRoute(async req=>{
  const node=await nodeAuth(req),agentId=requireId(req.header('x-sutradhar-agent')),
    ticketId=requireId(req.params.ticketId);
  return transaction(async c=>{
    await signedAgent(c,node.node_id,agentId,true);
    const job=await one(c,'SELECT j.*,t.project_id FROM v7_git_jobs j JOIN v7_tickets t ON t.ticket_id=j.ticket_id WHERE j.ticket_id=?',[ticketId]);
    if(!job)fault('GIT_JOB_NOT_FOUND',404);
    const access=await one(c,'SELECT can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
      [job.project_id,agentId]);
    if(!access?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
    return {ticket_id:ticketId,state:job.state,epoch:Number(job.epoch),
      remote_head_sha:job.remote_head_sha,pr_number:job.pr_number,
      pr_url:job.pr_number?job.pr_url:null,
      pr_owner_reconciliation_required:!job.pr_number&&
        String(job.pr_url||'').startsWith('DRAFT_PR_ATTEMPT_PENDING:')};
  });
}));
app.post('/v7/git/confirm',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  const expectedHead=d.expected_remote_head_sha;
  if(expectedHead===undefined||requireSha(expectedHead)!==expectedHead)
    fault('GIT_CONFIRM_EXACT_CANDIDATE_REQUIRED',400);
  const info=await transaction(async c=>{
    await signedAgent(c,node.node_id,agentId,true);
    const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticketId]);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    if(!job||!t||job.agent_id!==agentId||job.state==='NEEDS_RECONCILIATION'||
       t.status!=='INTEGRATING')fault('GIT_PUBLISH_NOT_RESERVED',409);
    const p=await one(c,'SELECT * FROM v7_projects WHERE project_id=?',[t.project_id]);
    return {job,t,p};
  });
  if(info.job.state==='CONFIRMED'){
    if(info.job.remote_head_sha!==expectedHead&&expectedHead!==undefined)
      fault('REMOTE_HEAD_MISMATCH',409);
    return {accepted:true,already_confirmed:true,ticket_id:ticketId,
      remote_head_sha:info.job.remote_head_sha,branch:info.t.branch_name};
  }
  const proof=await inspectGitRemote({
    repo:info.p.repository,token:process.env.SUTRADHAR_GITHUB_TOKEN||'',
    branch:info.t.branch_name,baseBranch:info.p.base_branch,
    baseline:info.t.baseline_sha,tree:info.t.candidate_tree_sha,
    writeScopes:typeof info.t.scopes_json==='string'?JSON.parse(info.t.scopes_json):info.t.scopes_json,
    expectedHead:info.t.candidate_head_sha
  });
  const verified=proof.verified?proof:fault('REMOTE_PUBLISH_UNCERTAIN_'+proof.error_code,409);
  return transaction(async c=>{
    const ld=await leader(c);
    await signedAgent(c,node.node_id,agentId,true);
    // Existing Git publication may be confirmed for reconciliation, even if
    // the Owner started draining after it was reserved. No NEW reservation.
    if(ld.paused||ld.phase!=='READY'||Number(ld.epoch)!==Number(info.job.epoch)||
       !ld.lease_until||Date.parse(ld.lease_until+'Z')<=await dbNow(c))
      fault('STALE_MASTER_EPOCH',409);
    return idem(c,agentId,d.request_id,'GIT_CONFIRM',{ticketId,head:verified.headSha},async()=>{
      const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',[ticketId]);
      const t=await one(c,'SELECT status,candidate_tree_sha FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(job?.state!=='RUNNING'||t?.status!=='INTEGRATING'||
         t.candidate_head_sha!==verified.headSha||t.candidate_tree_sha!==verified.treeSha||
         Number(job.epoch)!==Number(ld.epoch))fault('GIT_CONFIRM_VERSION_CONFLICT',409);
      await c.query('UPDATE v7_git_jobs SET state="CONFIRMED",remote_head_sha=?,remote_tree_sha=?,changed_files_json=?,verified_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE ticket_id=?',
        [verified.headSha,verified.treeSha,JSON.stringify(verified.changedFiles),ticketId]);
      await event(c,'GIT_BRANCH_REMOTE_CONFIRMED',agentId,Number(ld.epoch),ticketId,{
        head:verified.headSha,tree:verified.treeSha});
      return {accepted:true,ticket_id:ticketId,remote_head_sha:verified.headSha,
        tree_sha:verified.treeSha,status:'PUSH_CONFIRMED_NOT_MERGED'};
    });
  });
}));
// Owner-only read-only recovery queue. Never infer that an unmatched remote
// branch is safe to re-publish. These are preflight hints, NOT permission to push.
app.get('/v7/owner/git-recovery',jsonRoute(async req=>{
  admin(req);
  return transaction(async c=>{
    const ld=await leader(c,false);
    const masterLive=await approvedMasterLease(c,ld);
    const jobs=await rows(c,
      'SELECT j.ticket_id,j.state AS git_state,j.epoch AS publication_epoch,'+
      'j.agent_id AS qa_agent_id,t.status AS task_status,t.worker_agent_id,'+
      't.branch_name,t.baseline_sha,t.candidate_head_sha,t.candidate_tree_sha,'+
      'p.repository,'+
      'EXISTS(SELECT 1 FROM v7_qa_receipts q WHERE q.ticket_id=j.ticket_id '+
      'AND q.agent_id=j.agent_id AND q.passed=1 AND q.head_sha=t.candidate_head_sha '+
      'AND q.tree_sha=t.candidate_tree_sha) AS matching_qa_receipt,'+
      'EXISTS(SELECT 1 FROM v7_leases l WHERE l.ticket_id=j.ticket_id '+
      'AND l.revoked=0 AND l.expires_at>UTC_TIMESTAMP(3)) AS has_live_worker_lease '+
      'FROM v7_git_jobs j JOIN v7_tickets t ON t.ticket_id=j.ticket_id '+
      'JOIN v7_projects p ON p.project_id=t.project_id '+
      'WHERE j.state IN ("RUNNING","NEEDS_RECONCILIATION") '+
      'ORDER BY j.updated_at DESC,j.ticket_id LIMIT 301');
    if(jobs.length>300)fault('GIT_RECOVERY_PAGINATION_REQUIRED',409);
    const epoch=Number(ld.epoch);
    return {epoch,phase:ld.phase,master_agent_id:ld.master_agent_id||null,
      master_live:masterLive,
      unresolved_jobs:jobs.map(j=>{
        const publicationEpoch=Number(j.publication_epoch);
        const qaValid=Number(j.matching_qa_receipt)===1;
        const liveLease=Number(j.has_live_worker_lease)===1;
        const problems:string[]=[];
        if(!masterLive)problems.push('MASTER_NOT_LIVE_OR_APPROVED');
        if(ld.phase!=='RECOVERING')problems.push('MASTER_NOT_RECOVERING');
        if(Number(ld.paused))problems.push('CLUSTER_PAUSED');
        if(!Number.isSafeInteger(publicationEpoch)||publicationEpoch>=epoch)
          problems.push('PUBLICATION_NOT_PRIOR_EPOCH');
        if(!['INTEGRATING','RECONCILIATION_REQUIRED'].includes(j.task_status))
          problems.push('TICKET_NOT_IN_RECOVERY_STATE');
        if(j.qa_agent_id===j.worker_agent_id)problems.push('QA_NOT_INDEPENDENT');
        if(!qaValid)problems.push('MATCHING_QA_RECEIPT_MISSING');
        if(liveLease)problems.push('LIVE_WORKER_LEASE');
        if(!SHA_RE.test(String(j.baseline_sha||''))||
          !SHA_RE.test(String(j.candidate_head_sha||''))||
          !SHA_RE.test(String(j.candidate_tree_sha||''))||
          !/^ai\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(String(j.branch_name||''))||
          !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(j.repository||'')))
          problems.push('INVALID_REMOTE_PROOF_METADATA');
        const recoverable=problems.length===0;
        return {ticket_id:j.ticket_id,git_state:j.git_state,
          publication_epoch:publicationEpoch,qa_agent_id:j.qa_agent_id,
          task_status:j.task_status,repository:j.repository,
          branch_name:j.branch_name,candidate_head_sha:j.candidate_head_sha,
          candidate_tree_sha:j.candidate_tree_sha,baseline_sha:j.baseline_sha,
          matching_qa_receipt:qaValid,has_live_worker_lease:liveLease,
          preflight_eligible:recoverable,blocking_reasons:problems};
      })};
  });
}));
// Explicit Owner-initiated READ-ONLY verification for an uncertain publication
// left behind by a previous Master epoch. No retry, push, PR or merge occurs.
// This is deliberately separate from the worker's live-epoch Git confirmation.
app.post('/v7/git/recover-remote-proof',jsonRoute(async req=>{
  admin(req);
  const d=req.body||{},ticketId=requireId(d.ticket_id),requestId=requireId(d.request_id);
  const epoch=Number(d.expected_master_epoch),reason=requireStr(d.reason,500);
  if(d.owner_confirmed_readonly_proof!==true)
    fault('OWNER_EXPLICIT_GIT_RECOVERY_CONFIRMATION_REQUIRED',403);
  // Lost HTTP replies must be safely replayable without re-reading GitHub or
  // repeating DB mutations. Bind the receipt to exact Owner input and head.
  const replay=await transaction(async c=>{
    const prior=await one(c,
      'SELECT operation,response_json FROM v7_commands WHERE actor=? AND request_id=?',
      ['owner:web',requestId]);
    if(!prior)return null;
    const result=typeof prior.response_json==='string'
      ?JSON.parse(prior.response_json):prior.response_json;
    if(!result?.accepted||result.ticket_id!==ticketId||
       !SHA_RE.test(String(result.remote_head_sha||'')))
      fault('IDEMPOTENCY_KEY_REUSED',409);
    const op='GIT_RECOVERY_REMOTE_PROOF:'+digest(JSON.stringify({
      ticketId,epoch,head:result.remote_head_sha,reason}));
    if(prior.operation!==op)fault('IDEMPOTENCY_KEY_REUSED',409);
    return result;
  });
  if(replay)return replay;
  const info=await transaction(async c=>{
    const ld=await leader(c);
    if(Number(ld.paused)||ld.phase!=='RECOVERING'||Number(ld.epoch)!==epoch||
       !(await approvedMasterLease(c,ld)))
      fault('RECOVERY_MASTER_EPOCH_NOT_LIVE',409);
    const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticketId]);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    if(!job||!t||!['RUNNING','NEEDS_RECONCILIATION'].includes(job.state)||
       Number(job.epoch)>=epoch||!['INTEGRATING','RECONCILIATION_REQUIRED'].includes(t.status)||
       !SHA_RE.test(String(t.candidate_head_sha||''))||
       !SHA_RE.test(String(t.candidate_tree_sha||'')))
      fault('GIT_RECOVERY_NOT_ELIGIBLE',409);
    if(job.agent_id===t.worker_agent_id)fault('GIT_RECOVERY_QA_INDEPENDENCE_REQUIRED',409);
    const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? AND agent_id=? AND passed=1 AND head_sha=? AND tree_sha=? LIMIT 1',
      [ticketId,job.agent_id,t.candidate_head_sha,t.candidate_tree_sha]);
    if(!qa)fault('GIT_RECOVERY_QA_PROOF_REQUIRED',409);
    const p=await one(c,'SELECT repository,base_branch FROM v7_projects WHERE project_id=?',[t.project_id]);
    if(!p)fault('GIT_RECOVERY_PROJECT_MISSING',409);
    return {job,t,p};
  });
  // Enforce EXACT accepted candidate SHA, not merely similar diff or tree.
  const proof=await inspectGitRemote({
    repo:info.p.repository,token:process.env.SUTRADHAR_GITHUB_TOKEN||'',
    branch:info.t.branch_name,baseBranch:info.p.base_branch,
    baseline:info.t.baseline_sha,tree:info.t.candidate_tree_sha,
    writeScopes:typeof info.t.scopes_json==='string'
      ?JSON.parse(info.t.scopes_json):info.t.scopes_json,
    expectedHead:info.t.candidate_head_sha
  });
  const verified=proof.verified?proof:fault('GIT_RECOVERY_REMOTE_UNCERTAIN_'+proof.error_code,409);
  return transaction(async c=>{
    const ld=await leader(c);
    if(Number(ld.paused)||ld.phase!=='RECOVERING'||Number(ld.epoch)!==epoch||
       !(await approvedMasterLease(c,ld)))
      fault('RECOVERY_MASTER_EPOCH_CHANGED',409);
    return idem(c,'owner:web',requestId,'GIT_RECOVERY_REMOTE_PROOF',
      {ticketId,epoch,head:verified.headSha,reason},async()=>{
      const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',[ticketId]);
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(!j||!t||!['RUNNING','NEEDS_RECONCILIATION'].includes(j.state)||
         Number(j.epoch)!==Number(info.job.epoch)||j.agent_id!==info.job.agent_id||
         Number(t.version)!==Number(info.t.version)||
         !['INTEGRATING','RECONCILIATION_REQUIRED'].includes(t.status)||
         t.project_id!==info.t.project_id||t.branch_name!==verified.branch||
         t.baseline_sha!==verified.baseline||
         t.candidate_head_sha!==verified.headSha||
         t.candidate_tree_sha!==verified.treeSha||
         JSON.stringify(t.scopes_json)!==JSON.stringify(info.t.scopes_json))
        fault('GIT_RECOVERY_RECORD_CHANGED',409);
      if(j.agent_id===t.worker_agent_id)fault('GIT_RECOVERY_QA_INDEPENDENCE_CHANGED',409);
      const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? AND agent_id=? AND passed=1 AND head_sha=? AND tree_sha=? LIMIT 1',
        [ticketId,j.agent_id,verified.headSha,verified.treeSha]);
      if(!qa)fault('GIT_RECOVERY_QA_PROOF_CHANGED',409);
      const liveLease=await one(c,'SELECT ticket_id FROM v7_leases WHERE ticket_id=? AND revoked=0 AND expires_at>UTC_TIMESTAMP(3)',[ticketId]);
      if(liveLease)fault('GIT_RECOVERY_ACTIVE_WORKER_LEASE',423);
      await c.query('UPDATE v7_git_jobs SET state="CONFIRMED",remote_head_sha=?,remote_tree_sha=?,changed_files_json=?,verified_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE ticket_id=?',
        [verified.headSha,verified.treeSha,JSON.stringify(verified.changedFiles),ticketId]);
      if(t.status==='RECONCILIATION_REQUIRED')
        await c.query('UPDATE v7_tickets SET status="INTEGRATING",version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE ticket_id=?',[ticketId]);
      await event(c,'OWNER_GIT_RECOVERY_REMOTE_VERIFIED','owner:web',epoch,ticketId,
        {head:verified.headSha,tree:verified.treeSha,prior_epoch:Number(j.epoch),reason});
      return {accepted:true,ticket_id:ticketId,remote_head_sha:verified.headSha,
        status:'PUSH_CONFIRMED_NOT_MERGED',ticket_status:'INTEGRATING',
        automatic_retry_allowed:false,merge_performed:false};
    });
  });
}));
// The existing git-job pr_url column is a durable *intent marker* until an
// exact remote draft is independently recorded. There is deliberately no
// schema migration and no automatic re-create after an ambiguous POST.
const DRAFT_INTENT_PREFIX='DRAFT_PR_ATTEMPT_PENDING:';
function configuredDraftPrWrite(){
  const token=process.env.SUTRADHAR_GITHUB_PR_TOKEN||'';
  return process.env.SUTRADHAR_ENABLE_PR_CREATION==='true'&&
    token.length>=20&&!/\s/.test(token);
}
const REPO_FULL=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function prChangedFiles(t:any,j:any){
  let files:any,scopes:any;
  try{
    files=typeof j.changed_files_json==='string'
      ?JSON.parse(j.changed_files_json):j.changed_files_json;
    scopes=typeof t.scopes_json==='string'?JSON.parse(t.scopes_json):t.scopes_json;
  }catch{fault('DRAFT_PR_REMOTE_FILES_UNTRUSTED',409);}
  if(!Array.isArray(files)||!Array.isArray(scopes)||
     files.length<1||files.length>99||scopes.length<1||scopes.length>30||
     new Set(files).size!==files.length||
     files.some((f:any)=>typeof f!=='string'||f.length>450||
       !/^[A-Za-z0-9._/-]+$/.test(f)||f.startsWith('/')||
       f.split('/').some((part:string)=>!part||part==='.'||part==='..')||
       !scopes.some((scope:any)=>typeof scope==='string'&&
         (f===scope||f.startsWith(scope+'/')))))
    fault('DRAFT_PR_REMOTE_FILES_UNTRUSTED',409);
  return files as string[];
}
function prExactContext(t:any,j:any,p:any){
  if(!t||!j||!p||t.status!=='INTEGRATING'||j.state!=='CONFIRMED'||
     !REPO_FULL.test(String(p.repository||''))||
     !validTaskBranch(String(t.branch_name||''))||
     !SHA_RE.test(String(t.baseline_sha||''))||
     !SHA_RE.test(String(t.candidate_head_sha||''))||
     !SHA_RE.test(String(t.candidate_tree_sha||''))||
     j.remote_head_sha!==t.candidate_head_sha||
     j.remote_tree_sha!==t.candidate_tree_sha)
    fault('DRAFT_PR_EXACT_REMOTE_QA_RECEIPT_REQUIRED',409);
  const allowed=prChangedFiles(t,j);
  return {ticket_id:t.ticket_id,project_id:t.project_id,
    repository:p.repository,base_branch:p.base_branch,branch:t.branch_name,
    baseline_sha:t.baseline_sha,candidate_head_sha:t.candidate_head_sha,
    candidate_tree_sha:t.candidate_tree_sha,changed_files:allowed,
    version:Number(t.version)};
}
async function prEvidence(c:PoolConnection,t:any,j:any){
  if(j.agent_id===t.worker_agent_id)fault('DRAFT_PR_INDEPENDENT_QA_REQUIRED',403);
  const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? '+
    'AND agent_id=? AND passed=1 AND head_sha=? AND tree_sha=?',
    [t.ticket_id,j.agent_id,t.candidate_head_sha,t.candidate_tree_sha]);
  if(!qa)fault('DRAFT_PR_OWNER_REVIEWED_QA_REQUIRED',409);
  if(['HIGH','CORE'].includes(t.risk)){
    const approval=await one(c,'SELECT proposal_id FROM v7_approvals '+
      'WHERE ticket_id=? AND state="APPROVED" AND kind!="QA_EVIDENCE_REVIEW"',
      [t.ticket_id]);
    if(!approval)fault('OWNER_APPROVAL_REQUIRED',403);
  }
}
function prGithubInput(info:any){
  return {repo:info.p.repository,token:process.env.SUTRADHAR_GITHUB_PR_TOKEN||'',
    branch:info.t.branch_name,baseBranch:info.p.base_branch,
    ticketId:info.t.ticket_id,baselineCommit:info.t.baseline_sha,
    candidateTreeSha:info.t.candidate_tree_sha,
    expectedHeadSha:info.t.candidate_head_sha,
    changedFiles:prChangedFiles(info.t,info.j),
    allowedFiles:prChangedFiles(info.t,info.j),
    title:info.t.title,description:info.t.description};
}
function checkedDraftPrRemote(pr:any,info:any){
  if(!pr?.created||!Number.isSafeInteger(pr.prNumber)||pr.prNumber<1||
     pr.existing!==true&&pr.existing!==false||
     pr.headSha!==info.t.candidate_head_sha||
     pr.treeSha!==info.t.candidate_tree_sha||
     pr.repo!==info.p.repository||pr.branch!==info.t.branch_name||
     pr.url!=='https://github.com/'+info.p.repository+'/pull/'+pr.prNumber)
    fault('DRAFT_PR_REMOTE_UNCERTAIN_OWNER_RECONCILIATION',409);
}
async function finalizeDraftPr(info:any,pr:any,attemptId:string,op:string,
  recovery?:{requestId:string;head:string;reason:string}){
  return transaction(async c=>{
    await leader(c);
    const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',
      [info.t.ticket_id]);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',
      [info.t.ticket_id]);
    const p=await one(c,'SELECT * FROM v7_projects WHERE project_id=?',
      [info.t.project_id]);
    const expected=prExactContext(info.t,info.j,info.p);
    const actual=prExactContext(t,j,p);
    const attempt=await one(c,'SELECT operation,response_json FROM v7_commands '+
      'WHERE actor="owner:web" AND request_id=? FOR UPDATE',[attemptId]);
    const saved=typeof attempt?.response_json==='string'
      ?JSON.parse(attempt.response_json):attempt?.response_json;
    if(JSON.stringify(expected)!==JSON.stringify(actual)||
       j.pr_number!==null||j.pr_url!==DRAFT_INTENT_PREFIX+attemptId||
       !attempt||attempt.operation!==op||saved?.pending!==true||
       saved?.ticket_id!==t.ticket_id||
       saved?.candidate_head_sha!==t.candidate_head_sha)
      fault('DRAFT_PR_FINALIZATION_CHANGED_OWNER_RECOVERY',409);
    await prEvidence(c,t,j);
    const result={accepted:true,ticket_id:t.ticket_id,draft:true,
      existing_remote_draft:pr.existing,pr_number:pr.prNumber,url:pr.url,
      head_sha:pr.headSha,tree_sha:pr.treeSha,base_branch:p.base_branch,
      status:'REVIEW_REQUIRED',merge_performed:false,
      automatic_merge_allowed:false};
    await c.query('UPDATE v7_git_jobs SET pr_number=?,pr_url=?,updated_at=UTC_TIMESTAMP(3) '+
      'WHERE ticket_id=? AND pr_number IS NULL AND pr_url=?',
      [pr.prNumber,pr.url,t.ticket_id,DRAFT_INTENT_PREFIX+attemptId]);
    await c.query('UPDATE v7_commands SET response_json=? WHERE actor="owner:web" '+
      'AND request_id=? AND operation=?',
      [JSON.stringify(result),attemptId,op]);
    await event(c,'GITHUB_DRAFT_PR_VERIFIED','owner:web',
      Number((await leader(c)).epoch),t.ticket_id,
      {pr_number:pr.prNumber,head:pr.headSha,base:p.base_branch});
    if(recovery){
      const recovered={...result,recovered_readonly:true,
        second_pr_create_attempt:false};
      return idem(c,'owner:web',recovery.requestId,'DRAFT_PR_RECOVER',
        {ticketId:t.ticket_id,head:recovery.head,reason:recovery.reason},async()=>{
        await event(c,'DRAFT_PR_OWNER_READONLY_RECOVERY','owner:web',
          Number((await leader(c)).epoch),t.ticket_id,
          {pr_number:pr.prNumber,reason:recovery.reason});
        return recovered;
      });
    }
    return result;
  });
}
// Inspect-only Owner queue, never checks GitHub or creates an external PR.
app.get('/v7/owner/pr-recovery',jsonRoute(async req=>{
  admin(req);
  return transaction(async c=>{
    const jobs=await rows(c,'SELECT j.ticket_id,j.request_id,j.pr_url,'+
      'j.remote_head_sha,j.remote_tree_sha,t.branch_name,p.repository,p.base_branch '+
      'FROM v7_git_jobs j JOIN v7_tickets t ON t.ticket_id=j.ticket_id '+
      'JOIN v7_projects p ON p.project_id=t.project_id '+
      'WHERE j.pr_number IS NULL AND LEFT(j.pr_url,?)=? '+
      'ORDER BY j.updated_at DESC LIMIT 101',
      [DRAFT_INTENT_PREFIX.length,DRAFT_INTENT_PREFIX]);
    if(jobs.length>100)fault('DRAFT_PR_RECOVERY_PAGINATION_REQUIRED',409);
    return {manual_owner_reconciliation_required:true,automatic_recreate_allowed:false,
      attempts:jobs.map(j=>({ticket_id:j.ticket_id,
        original_request_id:String(j.pr_url).slice(DRAFT_INTENT_PREFIX.length),
        repository:j.repository,base_branch:j.base_branch,
        branch:j.branch_name,remote_head_sha:j.remote_head_sha,
        remote_tree_sha:j.remote_tree_sha,remote_post_result:'UNKNOWN'}))};
  });
}));
// This preflight performs no GitHub POST, reservation, or Git job mutation.
app.get('/v7/owner/pr-preflight/:ticketId',jsonRoute(async req=>{
  admin(req);
  const ticketId=requireId(req.params.ticketId);
  return transaction(async c=>{
    const ld=await leader(c,false);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticketId]);
    const p=t?await one(c,'SELECT * FROM v7_projects WHERE project_id=?',
      [t.project_id]):null;
    const context=prExactContext(t,j,p);
    await prEvidence(c,t,j);
    const masterReady=ld.phase==='READY'&&!Number(ld.paused)&&
      await approvedMasterLease(c,ld);
    const enabled=configuredDraftPrWrite();
    return {...context,ready_for_owner_intent:Boolean(masterReady)&&
      enabled&&!j.pr_url&&!j.pr_number,
      creation_enabled:enabled,master_ready:Boolean(masterReady),
      recovery_required:Boolean(j.pr_url&&!j.pr_number),
      already_registered:Boolean(j.pr_number),
      git_published_verified:true,draft_pr_created:Boolean(j.pr_number),
      merge_performed:false};
  });
}));
// Owner-controlled PR creation, fail closed. Persist durable ONE-SHOT intent
// before the first GitHub POST and refuse to repeat an uncertain request.
app.post('/v7/git/pr-draft',jsonRoute(async req=>{
  admin(req);
  if(process.env.SUTRADHAR_ENABLE_PR_CREATION!=='true')
    fault('DRAFT_PR_CREATION_DISABLED',403);
  if(!configuredDraftPrWrite())fault('DRAFT_PR_TOKEN_NOT_CONFIGURED',503);
  const d=req.body||{},ticketId=requireId(d.ticket_id),
    requestId=requireId(d.request_id);
  const expectedHead=requireSha(d.expected_remote_head_sha);
  const expectedTree=requireSha(d.expected_candidate_tree_sha);
  const reviewNote=requireStr(d.owner_review_note,500);
  if(d.owner_confirmed_draft_only!==true||reviewNote.length<20)
    fault('DRAFT_PR_EXPLICIT_OWNER_CONFIRMATION_REQUIRED',403);
  const op='DRAFT_PR_CREATION:'+digest(JSON.stringify({
    ticketId,expectedHead,expectedTree,reviewNote}));
  const reserved=await transaction(async c=>{
    const ld=await leader(c);
    if(ld.paused||ld.phase!=='READY'||!await approvedMasterLease(c,ld))
      fault('DRAFT_PR_MASTER_NOT_READY',409);
    const prior=await one(c,'SELECT operation,response_json FROM v7_commands '+
      'WHERE actor="owner:web" AND request_id=? FOR UPDATE',[requestId]);
    if(prior){
      if(prior.operation!==op)fault('IDEMPOTENCY_KEY_REUSED',409);
      const receipt=typeof prior.response_json==='string'
        ?JSON.parse(prior.response_json):prior.response_json;
      if(receipt?.accepted===true)return {replay:receipt};
      fault('DRAFT_PR_RECONCILIATION_REQUIRED',409);
    }
    const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',
      [ticketId]);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',
      [ticketId]);
    const p=t?await one(c,'SELECT * FROM v7_projects WHERE project_id=?',
      [t.project_id]):null;
    prExactContext(t,j,p);
    await prEvidence(c,t,j);
    if(j.pr_number||j.pr_url)fault('DRAFT_PR_ALREADY_REGISTERED_OR_UNCERTAIN',409);
    if(t.candidate_head_sha!==expectedHead||t.candidate_tree_sha!==expectedTree)
      fault('DRAFT_PR_CANDIDATE_CHANGED',409);
    const intent={pending:true,kind:'DRAFT_PR_CREATION',
      ticket_id:ticketId,candidate_head_sha:expectedHead,
      candidate_tree_sha:expectedTree,repository:p.repository,
      branch:t.branch_name,base_branch:p.base_branch,
      automatic_retry_allowed:false};
    await c.query('INSERT INTO v7_commands(actor,request_id,operation,response_json) '+
      'VALUES("owner:web",?,?,?)',[requestId,op,JSON.stringify(intent)]);
    const [written]:any=await c.query('UPDATE v7_git_jobs SET pr_url=?,updated_at=UTC_TIMESTAMP(3) '+
      'WHERE ticket_id=? AND pr_number IS NULL AND pr_url IS NULL',
      [DRAFT_INTENT_PREFIX+requestId,ticketId]);
    if(written.affectedRows!==1)fault('DRAFT_PR_INTENT_RACE',409);
    await event(c,'DRAFT_PR_ONE_SHOT_INTENT_RESERVED','owner:web',
      Number(ld.epoch),ticketId,{request_id:requestId,head:expectedHead});
    return {info:{t,j,p}};
  });
  if('replay' in reserved)return reserved.replay;
  const info=reserved.info;
  const pr=await createVerifiedDraftPr(prGithubInput(info));
  if(!pr.created)fault('DRAFT_PR_REMOTE_UNCERTAIN_'+pr.error,409);
  checkedDraftPrRemote(pr,info);
  return finalizeDraftPr(info,pr,requestId,op);
}));
// Only GET GitHub APIs, even when a prior PR creation POST timed out.
// The original immutable PR attempt is reconciled; never recreate a draft.
app.post('/v7/git/pr-recover-readonly',jsonRoute(async req=>{
  admin(req);
  const d=req.body||{},ticketId=requireId(d.ticket_id),
    requestId=requireId(d.request_id),
    head=requireSha(d.expected_remote_head_sha),
    reason=requireStr(d.reason,500);
  if(d.owner_confirmed_readonly_proof!==true||reason.length<20)
    fault('DRAFT_PR_OWNER_READONLY_CONFIRMATION_REQUIRED',403);
  const op='DRAFT_PR_RECOVER:'+digest(JSON.stringify({ticketId,head,reason}));
  const info=await transaction(async c=>{
    const prior=await one(c,'SELECT operation,response_json FROM v7_commands '+
      'WHERE actor="owner:web" AND request_id=?',[requestId]);
    if(prior){
      if(prior.operation!==op)fault('IDEMPOTENCY_KEY_REUSED',409);
      const saved=typeof prior.response_json==='string'
        ?JSON.parse(prior.response_json):prior.response_json;
      if(saved?.accepted)return {replay:saved};
      fault('DRAFT_PR_RECOVERY_NOT_RECONCILED',409);
    }
    const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticketId]);
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    const p=t?await one(c,'SELECT * FROM v7_projects WHERE project_id=?',
      [t.project_id]):null;
    prExactContext(t,j,p);
    const attemptId=String(j?.pr_url||'').startsWith(DRAFT_INTENT_PREFIX)
      ?String(j.pr_url).slice(DRAFT_INTENT_PREFIX.length):'';
    if(j.pr_number||!attemptId||!okId(attemptId)||
       t.candidate_head_sha!==head)
      fault('DRAFT_PR_NO_PENDING_OWNER_RECOVERY',409);
    await prEvidence(c,t,j);
    const attempt=await one(c,'SELECT operation,response_json FROM v7_commands '+
      'WHERE actor="owner:web" AND request_id=?',[attemptId]);
    const saved=typeof attempt?.response_json==='string'
      ?JSON.parse(attempt.response_json):attempt?.response_json;
    if(!attempt?.operation?.startsWith('DRAFT_PR_CREATION:')||
       !saved?.pending||saved.ticket_id!==ticketId||
       saved.candidate_head_sha!==head||
       saved.candidate_tree_sha!==t.candidate_tree_sha)
      fault('DRAFT_PR_INTENT_INVALID',409);
    return {info:{t,j,p},attemptId,attemptOp:attempt.operation};
  });
  if('replay' in info)return info.replay;
  // No POST: only an already existing, exact open draft can be reconciled.
  const pr=await inspectVerifiedDraftPr(prGithubInput(info.info));
  if(!pr.created||pr.existing!==true)
    fault('DRAFT_PR_READONLY_PROOF_UNAVAILABLE',409);
  checkedDraftPrRemote(pr,info.info);
  return finalizeDraftPr(info.info,pr,info.attemptId,info.attemptOp,
    {requestId,head,reason});
}));
// Owner read-only snapshot of human-review and required CI on the immutable
// registered candidate. NEVER marks a PR ready through GitHub, merges, or
// grants a bypass of target-repository protection. The status can go stale.
app.get('/v7/owner/pr-review/:ticketId',jsonRoute(async req=>{
  admin(req);
  const ticketId=requireId(req.params.ticketId);
  const info=await transaction(async c=>{
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticketId]);
    const p=t?await one(c,'SELECT * FROM v7_projects WHERE project_id=?',
      [t.project_id]):null;
    const context=prExactContext(t,j,p);
    await prEvidence(c,t,j);
    if(!Number.isSafeInteger(Number(j.pr_number))||Number(j.pr_number)<1||
       j.pr_url!=='https://github.com/'+p.repository+'/pull/'+j.pr_number)
      fault('VERIFIED_GIT_DRAFT_PR_REQUIRED',409);
    return {t,j,p,context};
  });
  const required=(process.env.SUTRADHAR_REQUIRED_CHECKS||'')
    .split(';').map(x=>x.trim()).filter(Boolean);
  const preview=await inspectGithubPrReview({
    repo:info.p.repository,token:process.env.SUTRADHAR_GITHUB_TOKEN||'',
    prNumber:Number(info.j.pr_number),baseBranch:info.p.base_branch,
    branch:info.t.branch_name,baselineSha:info.t.baseline_sha,
    headSha:info.j.remote_head_sha,treeSha:info.t.candidate_tree_sha,
    changedFiles:prChangedFiles(info.t,info.j),
    requiredChecks:required,
    requiredApprovals:Number(process.env.SUTRADHAR_MIN_GITHUB_APPROVALS||1)
  });
  return {ticket_id:ticketId,repository:info.p.repository,
    pr_number:Number(info.j.pr_number),url:info.j.pr_url,
    expected_head_sha:info.j.remote_head_sha,
    expected_tree_sha:info.t.candidate_tree_sha,
    base_branch:info.p.base_branch,review:preview,
    snapshot_only:true,read_only:true,merge_performed:false,
    production_deployed:false};
}));
app.post('/v7/tasks/verify-merge',jsonRoute(async req=>{
  // This does NOT merge: read-only authenticated remote verification only.
  admin(req);
  const d=req.body||{},ticket=requireId(d.ticket_id),requestId=requireId(d.request_id);
  const head=requireSha(d.expected_remote_head_sha);
  const prNumber=Number(d.expected_pr_number);
  const note=requireStr(d.owner_review_note,500);
  if(d.owner_confirmed_readonly_verification!==true||note.length<20||
     !Number.isSafeInteger(prNumber)||prNumber<1)
    fault('MERGE_VERIFICATION_OWNER_CONFIRMATION_REQUIRED',403);
  // A lost HTTP response after DONE must be replayable from the original
  // durable idempotency receipt; otherwise a valid request would falsely
  // return NOT_READY_FOR_GIT_VERIFICATION on retries.
  const prior=await transaction(async c=>{
    const row=await one(c,'SELECT operation,response_json FROM v7_commands '+
      'WHERE actor="owner:web" AND request_id=? FOR UPDATE',[requestId]);
    if(!row)return null;
    if(row.operation!=='VERIFY_MERGE:'+digest(JSON.stringify(d)))
      fault('IDEMPOTENCY_KEY_REUSED',409);
    const saved=typeof row.response_json==='string'
      ?JSON.parse(row.response_json):row.response_json;
    if(!saved||saved.pending)fault('COMMAND_NOT_RECONCILED',503);
    return saved;
  });
  if(prior)return prior;
  const info=await transaction(async c=>{
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticket]);
    if(!t||t.status!=='INTEGRATING')fault('NOT_READY_FOR_GIT_VERIFICATION',409);
    const p=await one(c,'SELECT * FROM v7_projects WHERE project_id=?',[t.project_id]);
    const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? AND passed=1 AND head_sha=? AND tree_sha=?',
      [ticket,t.candidate_head_sha,t.candidate_tree_sha]);
    if(!qa)fault('QA_REQUIRED',409);
    const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticket]);
    if(!job||job.state!=='CONFIRMED'||!job.remote_head_sha||!job.pr_number||
       job.pr_url!=='https://github.com/'+p.repository+'/pull/'+job.pr_number)
      fault('VERIFIED_GIT_DRAFT_PR_REQUIRED',409);
    if(job.remote_head_sha!==head||Number(job.pr_number)!==prNumber||
       t.candidate_head_sha!==head)
      fault('MERGE_VERIFICATION_CANDIDATE_CHANGED',409);
    if(t.risk==='CORE'||t.risk==='HIGH'){
      const approval=await one(c,'SELECT proposal_id FROM v7_approvals WHERE ticket_id=? AND state="APPROVED" AND kind!="QA_EVIDENCE_REVIEW"',[ticket]);
      if(!approval)fault('OWNER_APPROVAL_REQUIRED',409);
    }
    return {t,p,job};
  });
  const token=process.env.SUTRADHAR_GITHUB_TOKEN||'';
  const requiredChecks=(process.env.SUTRADHAR_REQUIRED_CHECKS||'').split(';').filter(Boolean);
  const verification=await verifyGitHubMergeEvidence({
    repo:info.p.repository,token,branch:info.t.branch_name,
    allowedFiles:typeof info.job.changed_files_json==='string'?JSON.parse(info.job.changed_files_json):info.job.changed_files_json,
    baselineCommit:info.t.baseline_sha,candidateTreeSha:info.t.candidate_tree_sha,
    requiredChecks,requiredApprovals:Math.max(1,Number(process.env.SUTRADHAR_MIN_GITHUB_APPROVALS||1)),
    expectedPrNumber:Number(info.job.pr_number),expectedHeadSha:info.job.remote_head_sha,
    mainBranch:info.p.base_branch
  });
  if(!verification.verified)fault('GITHUB_VERIFICATION_FAILED_'+verification.error,409);
  return transaction(async c=>idem(c,'owner:web',requestId,'VERIFY_MERGE',d,async()=>{
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticket]);
    const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',[ticket]);
    if(job?.state!=='CONFIRMED'||job.remote_head_sha!==info.job.remote_head_sha||
       Number(job.pr_number)!==Number(info.job.pr_number)||
       job.pr_url!==info.job.pr_url||
       t.status!=='INTEGRATING'||t.candidate_head_sha!==info.t.candidate_head_sha||
       t.candidate_tree_sha!==info.t.candidate_tree_sha||
       t.baseline_sha!==info.t.baseline_sha)
      fault('VERSION_CONFLICT',409);
    const p=await one(c,'SELECT repository,base_branch FROM v7_projects WHERE project_id=?',
      [t.project_id]);
    if(!p||p.repository!==info.p.repository||
       p.base_branch!==info.p.base_branch)
      fault('VERSION_CONFLICT',409);
    await c.query('INSERT INTO v7_git_receipts(ticket_id,receipt_json) VALUES(?,?)',
      [ticket,JSON.stringify(verification)]);
    await c.query('UPDATE v7_tickets SET status="DONE",version=version+1 WHERE ticket_id=?',[ticket]);
    await c.query('DELETE FROM v7_reservations WHERE ticket_id=?',[ticket]);
    await c.query('UPDATE v7_leases SET revoked=1 WHERE ticket_id=?',[ticket]);
    await event(c,'GITHUB_MERGE_VERIFIED','owner:web',Number((await leader(c)).epoch),
      ticket,{...verification,owner_review_note:note});
    return {accepted:true,ticket_id:ticket,status:'DONE',
      evidence_level:'REMOTE_VERIFIED',github:verification,
      read_only:true,merge_performed:false,production_deployed:false};
  }));
}));
app.get('/v7/audit',jsonRoute(async req=>{
  admin(req);return transaction(c=>rows(c,'SELECT event_id,event_type,actor,epoch,resource_id,payload_json,created_at FROM v7_events '+
    'WHERE event_type!="NODE_HEARTBEAT_ACCEPTED" ORDER BY event_id DESC LIMIT 250'));
}));
app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{
  if(res.headersSent)return;
  if(err instanceof Fault)return res.status(err.status).json({accepted:false,error_code:err.code,retryable:err.status===503});
  if(err?.code==='ER_DUP_ENTRY')return res.status(409).json({accepted:false,error_code:'CONFLICT',retryable:false});
  if(err?.code==='ER_LOCK_DEADLOCK'||err?.code==='ER_LOCK_WAIT_TIMEOUT')
    return res.status(503).json({accepted:false,error_code:'DB_TRANSIENT',retryable:true});
  if(err?.type==='entity.parse.failed'||err?.type==='entity.too.large')
    return res.status(400).json({accepted:false,error_code:'BAD_JSON',retryable:false});
  console.error('V7 request failed:',err?.code||err?.name||'UNKNOWN');
  return res.status(503).json({accepted:false,error_code:'CONTROL_UNAVAILABLE',retryable:true});
});
if(process.env.NODE_ENV==='production'){
  const bundleDir=typeof __dirname==='string'?__dirname:path.dirname(process.argv[1]||process.cwd());
  const dir=fs.existsSync(path.resolve(bundleDir,'index.html'))?path.resolve(bundleDir):path.resolve(process.cwd(),'dist');
  app.use(express.static(dir,{index:false}));
  app.get('*',(_req,res)=>res.sendFile(path.join(dir,'index.html')));
}
if(process.env.SUTRADHAR_V7_NO_LISTEN!=='true'){
  app.listen(PORT,'0.0.0.0',()=>console.log('SUTRADHAR v7 MySQL control plane listening; configured='+configured));
}
export async function shutdownV7ForTests(){if(process.env.NODE_ENV!=='test')fault('TEST_ONLY',403);await pool?.end();}
export {app,transaction,evaluate,ownerCommand};
