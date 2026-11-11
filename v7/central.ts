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
import {createVerifiedDraftPr} from '../github_pr_creator.ts';
import {inspectGitRemote} from './git_remote.ts';
import {chooseLeader,chooseBackups,firstElectionOpen,ID_RE,SHA_RE,safeScope,scopesOverlap,digest} from './rules.ts';

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
function requireSha(x:unknown){if(typeof x!=='string'||!SHA_RE.test(x))fault('INVALID_SHA',400);return x;}
function requireStr(x:unknown,max=1000):string{if(typeof x!=='string'||!x.trim()||x.length>max)fault('INVALID_FIELD',400);return (x as string).trim();}
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
    'WHERE a.state="APPROVED" AND n.state="APPROVED" AND a.master_eligible=1 ORDER BY r.arrival_id');
  return results.map(x=>({agent_id:x.agent_id,node_id:x.node_id,
    arrival_id:Number(x.arrival_id),last_seen_ms:Date.parse(x.last_seen+'Z'),
    eligible:Boolean(x.master_eligible)}));
}
async function evaluate(c:PoolConnection,reason='heartbeat'){
  const ld=await leader(c);
  const now=await dbNow(c), cs=await candidates(c);
  const old=ld.master_agent_id||null;
  const next=chooseLeader({master_agent_id:old,
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
    if(command==='STATUS') result={cluster:await evaluate(c,'owner-read')};
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
    }else if(command==='APPROVE_PROPOSAL'||command==='DENY_PROPOSAL'){
      const id=requireId(payload.proposal_id),state=command==='APPROVE_PROPOSAL'?'APPROVED':'DENIED';
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
      // A human must externally reconcile uncertain Git effects before authorizing retry.
      if(payload.remote_checked!==true)fault('REMOTE_RECONCILIATION_REQUIRED',409);
      await c.query('UPDATE v7_tickets SET status="READY",worker_agent_id=NULL,version=version+1 WHERE ticket_id=?',[id]);
      await c.query('DELETE FROM v7_reservations WHERE ticket_id=?',[id]);
      result={ticket_id:id,status:'READY',reason};
    }else fault('UNKNOWN_OWNER_COMMAND',400);
    await event(c,'OWNER_'+command,actor,Number(ld.epoch),result.project_id||result.ticket_id||result.node_id||null,
      {command,resource:result.project_id||result.ticket_id||result.node_id||null});
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
  return {service:'sutradhar-v7',ready:true,authority:'mysql'};
}));
app.post('/v7/owner/migrate',jsonRoute(async req=>{
  admin(req);
  if(process.env.SUTRADHAR_ALLOW_MIGRATIONS!=='true')fault('MIGRATION_DISABLED',403);
  const schemaFile=path.resolve(process.cwd(),'v7/schema.sql');
  const sql=fs.readFileSync(schemaFile,'utf8').split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
  const statements=sql.split(';').map(x=>x.trim()).filter(Boolean);
  const c=await getPool().getConnection();
  try{
    await c.query("SET time_zone = '+00:00'");
    for(const stmt of statements)await c.query(stmt);
    await c.query('INSERT IGNORE INTO v7_schema_versions(version) VALUES(7)');
    await c.query('INSERT IGNORE INTO v7_cluster(singleton) VALUES(1)');
    return {accepted:true,schema_version:7,statements:statements.length};
  }finally{c.release();}
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
    const existing=await one(c,'SELECT agent_id FROM v7_agents WHERE agent_id=?',[id]);
    if(existing)fault('AGENT_ID_ALREADY_EXISTS',409);
    await c.query('INSERT INTO v7_agents(agent_id,node_id,capability_json) VALUES(?,?,?)',[id,node.node_id,JSON.stringify(caps)]);
    await event(c,'AGENT_REGISTERED',id,0,id);
    return {accepted:true,agent_id:id,state:'PENDING',owner_approval_required:true};
  });
}));
app.post('/v7/nodes/heartbeat',jsonRoute(async req=>{
  const node=await nodeAuth(req),data=req.body||{};
  const sequence=Number(data.sequence),bootId=requireId(data.boot_id);
  if(!Number.isSafeInteger(sequence)||sequence<1||!Array.isArray(data.agents)||data.agents.length>30)
    fault('INVALID_HEARTBEAT',400);
  return transaction(async c=>{
    const n=await one(c,'SELECT * FROM v7_nodes WHERE node_id=? FOR UPDATE',[node.node_id]);
    if(sequence<=Number(n.last_sequence))fault('REPLAY_SEQUENCE',409);
    await c.query('UPDATE v7_nodes SET last_sequence=?,boot_id=?,last_seen=UTC_TIMESTAMP(3) WHERE node_id=?',
      [sequence,bootId,node.node_id]);
    const clock=await dbNow(c),seen=new Set<string>();
    for(const entry of data.agents){
      const id=requireId(entry.agent_id),seq=Number(entry.sequence);
      if(seen.has(id)||!Number.isSafeInteger(seq)||seq<1)fault('INVALID_AGENT_SEQUENCE',400);
      seen.add(id);
      const a=await signedAgent(c,node.node_id,id);
      if(seq<=Number(a.last_sequence))fault('REPLAY_AGENT_SEQUENCE',409);
      await c.query('UPDATE v7_agents SET last_sequence=?,last_seen=UTC_TIMESTAMP(3),status=? WHERE agent_id=?',
        [seq,['IDLE','BUSY','BLOCKED','ONLINE'].includes(entry.status)?entry.status:'ONLINE',id]);
      if(a.master_eligible&&(firstElectionOpen(clock)||Boolean((await leader(c,false)).bootstrapped_at))){
        await c.query('INSERT IGNORE INTO v7_arrivals(agent_id) VALUES(?)',[id]);
      }
    }
    const ld=await leader(c);
    if(ld.master_agent_id&&seen.has(ld.master_agent_id)&&Number(data.expected_master_epoch)===Number(ld.epoch)&&
      ld.lease_until&&Date.parse(ld.lease_until+'Z')>clock){
      await c.query('UPDATE v7_cluster SET lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 180 SECOND) WHERE singleton=1');
    }
    const elected=await evaluate(c,'heartbeat');
    return {accepted:true,server_received_at:new Date(clock).toISOString(),epoch:Number(elected.epoch),
      master_agent_id:elected.master_agent_id,phase:elected.phase,
      backups:[elected.backup1,elected.backup2],paused:Boolean(elected.paused),
      heartbeat_interval_seconds:60};
  });
}));
app.get('/v7/cluster',jsonRoute(async req=>{
  admin(req);
  return transaction(async c=>{const ld=await evaluate(c,'owner-status');
    const agents=await rows(c,'SELECT a.agent_id,a.node_id,a.state,a.status,a.master_eligible,a.qa_eligible,a.last_seen,n.state AS node_state FROM v7_agents a JOIN v7_nodes n ON n.node_id=a.node_id ORDER BY a.agent_id');
    return {cluster:ld,agents};});
}));
app.get('/v7/nodes/me',jsonRoute(async req=>{
  const node=await nodeAuth(req);
  return transaction(async c=>({node_id:node.node_id,
    agents:await rows(c,'SELECT agent_id,state,master_eligible,qa_eligible FROM v7_agents WHERE node_id=?',[node.node_id])}));
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
    const ld=await evaluate(c,'signed-read');
    return {epoch:Number(ld.epoch),master_agent_id:ld.master_agent_id,
      phase:ld.phase,paused:Boolean(ld.paused),backups:[ld.backup1,ld.backup2]};
  });
}));
app.get('/v7/tasks/available',jsonRoute(async req=>{
  const node=await nodeAuth(req),agentId=requireId(req.header('x-sutradhar-agent'));
  return transaction(async c=>{
    await signedAgent(c,node.node_id,agentId);
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
  const tickets=await rows(c,'SELECT ticket_id,project_id,status,version,worker_agent_id FROM v7_tickets WHERE status NOT IN ("DONE","CANCELLED") ORDER BY updated_at,ticket_id LIMIT 301');
  const checkpoints=await rows(c,'SELECT x.ticket_id,x.generation,x.summary,x.next_action,x.content_sha256 FROM v7_checkpoints x INNER JOIN (SELECT ticket_id,MAX(generation) gen FROM v7_checkpoints GROUP BY ticket_id) y ON y.ticket_id=x.ticket_id AND y.gen=x.generation ORDER BY x.ticket_id LIMIT 301');
  const events=await rows(c,'SELECT event_id,event_type,actor,epoch,resource_id,created_at FROM v7_events ORDER BY event_id DESC LIMIT 301');
  if(tickets.length>300||checkpoints.length>300||events.length>300)
    fault('RECOVERY_PAGINATION_REQUIRED',409);
  const result={epoch,phase:ld.phase,tickets,checkpoints,events};
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
    await signedAgent(c,node.node_id,id);
    const ld=await leader(c);
    if(ld.master_agent_id!==id||Number(ld.epoch)!==epoch||!ld.lease_until||
       Date.parse(ld.lease_until+'Z')<=await dbNow(c))fault('STALE_MASTER_EPOCH',409);
    if(ld.phase!=='RECOVERING')fault('INVALID_PHASE',409);
    const current=await recoveryManifest(c);
    if(current.manifest_sha256!==req.body.manifest_sha256)fault('STALE_RECOVERY_MANIFEST',409);
    if(current.tickets.some(t=>t.status==='RECONCILIATION_REQUIRED'))
      fault('TASK_RECONCILIATION_REQUIRED',423);
    return idem(c,id,req.body.request_id,'RECOVERY',{epoch,hash:req.body.manifest_sha256},async()=>{
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
  if(!/^ai\/[A-Za-z0-9._/-]+$/.test(branch)||branch.includes('..'))fault('INVALID_BRANCH',400);
  return transaction(async c=>{
    const ld=await readyMaster(c,node.node_id,agentId,d.expected_master_epoch);
    return idem(c,agentId,d.request_id,'TASK_PLAN',d,async()=>{
      const project=await one(c,'SELECT * FROM v7_projects WHERE project_id=? AND status="ACTIVE" FOR UPDATE',[projectId]);
      if(!project)fault('PROJECT_NOT_FOUND',404);
      const sensitive=scope.some((s:string)=>/^(v7|core|contracts|migrations|\.github|server\.ts|server_db\.ts|hooks)(\/|$)/i.test(s));
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
    const a=await signedAgent(c,node.node_id,agentId),ld=await leader(c);
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
  await signedAgent(c,nodeId,agentId);
  const ld=await leader(c);
  if(ld.paused||Number(ld.epoch)!==Number(epoch)||!ld.master_agent_id||ld.phase!=='READY')
    fault('STALE_MASTER_EPOCH',409);
  const lease=await one(c,'SELECT * FROM v7_leases WHERE ticket_id=? FOR UPDATE',[ticketId]);
  if(!lease||lease.revoked||lease.agent_id!==agentId||lease.lease_id!==leaseId||
     Number(lease.epoch)!==Number(epoch))fault('WORKER_LEASE_INVALID',403);
  if(Date.parse(lease.expires_at+'Z')<=await dbNow(c))fault('WORKER_LEASE_EXPIRED',409);
  return await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
}
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
    await c.query('UPDATE v7_leases SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 600 SECOND) WHERE ticket_id=?',[ticket]);
    await event(c,'TASK_CHECKPOINTED',id,Number(d.expected_master_epoch),ticket,{generation,sha256:hash});
    return {accepted:true,ticket_id:ticket,generation,content_sha256:hash,version:Number(t.version)+1};
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
app.post('/v7/tasks/qa-receipt',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{},id=requireId(d.agent_id),ticket=requireId(d.ticket_id);
  const evidenceRef=requireStr(d.evidence_ref,450),hash=requireStr(d.evidence_sha256,64);
  if(!/^[0-9a-f]{64}$/.test(hash)||typeof d.passed!=='boolean')fault('INVALID_QA_RECEIPT',400);
  return transaction(async c=>{
    await signedAgent(c,node.node_id,id,true);
    return idem(c,id,d.request_id,'QA_RECEIPT',d,async()=>{
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticket]);
      if(!t||t.status!=='SUBMITTED_FOR_REVIEW'||t.worker_agent_id===id)fault('QA_INDEPENDENCE_OR_STATE',409);
      const access=await one(c,'SELECT can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [t.project_id,id]);
      if(!access?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
      if(t.candidate_head_sha!==d.candidate_head_sha||t.candidate_tree_sha!==d.candidate_tree_sha)
        fault('CANDIDATE_SHA_MISMATCH',409);
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
  return transaction(async c=>{
    await signedAgent(c,node.node_id,id);
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
app.post('/v7/git/reserve',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  return transaction(async c=>{
    await signedAgent(c,node.node_id,agentId,true);
    const ld=await leader(c);
    if(ld.paused||ld.phase!=='READY'||Number(ld.epoch)!==Number(d.expected_master_epoch)||
       !ld.lease_until||Date.parse(ld.lease_until+'Z')<=await dbNow(c))
      fault('STALE_MASTER_EPOCH',409);
    return idem(c,agentId,d.request_id,'GIT_RESERVE',{ticketId,epoch:d.expected_master_epoch},async()=>{
      const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(!t||t.status!=='INTEGRATING'||t.worker_agent_id===agentId)fault('QA_NOT_COMPLETE',409);
      const allowed=await one(c,'SELECT can_qa FROM v7_project_agents WHERE project_id=? AND agent_id=?',
        [t.project_id,agentId]);
      if(!allowed?.can_qa)fault('PROJECT_QA_ACCESS_DENIED',403);
      const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? AND agent_id=? AND passed=1 AND head_sha=? AND tree_sha=?',
        [ticketId,agentId,t.candidate_head_sha,t.candidate_tree_sha]);
      if(!qa)fault('INDEPENDENT_QA_RECEIPT_REQUIRED',409);
      if(['HIGH','CORE'].includes(t.risk)){
        const approval=await one(c,'SELECT proposal_id FROM v7_approvals WHERE ticket_id=? AND state="APPROVED"',[ticketId]);
        if(!approval)fault('OWNER_APPROVAL_REQUIRED',403);
      }
      if(await one(c,'SELECT ticket_id FROM v7_git_jobs WHERE ticket_id=?',[ticketId]))
        fault('GIT_JOB_ALREADY_RESERVED_RECONCILE',409);
      await c.query('INSERT INTO v7_git_jobs(ticket_id,agent_id,epoch,request_id,state) VALUES(?,?,?,?,"RUNNING")',
        [ticketId,agentId,Number(ld.epoch),d.request_id]);
      await event(c,'GIT_PUBLICATION_RESERVED',agentId,Number(ld.epoch),ticketId);
      return {accepted:true,ticket_id:ticketId,branch:t.branch_name,baseline_sha:t.baseline_sha,
        candidate_tree_sha:t.candidate_tree_sha,one_shot:true};
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
      remote_head_sha:job.remote_head_sha,pr_number:job.pr_number,pr_url:job.pr_url};
  });
}));
app.post('/v7/git/confirm',jsonRoute(async req=>{
  const node=await nodeAuth(req),d=req.body||{};
  const agentId=requireId(d.agent_id),ticketId=requireId(d.ticket_id);
  const expectedHead=d.expected_remote_head_sha;
  if(expectedHead!==undefined)requireSha(expectedHead);
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
    branch:info.t.branch_name,baseline:info.t.baseline_sha,tree:info.t.candidate_tree_sha,
    writeScopes:typeof info.t.scopes_json==='string'?JSON.parse(info.t.scopes_json):info.t.scopes_json,
    expectedHead
  });
  const verified=proof.verified?proof:fault('REMOTE_PUBLISH_UNCERTAIN_'+proof.error_code,409);
  return transaction(async c=>{
    await signedAgent(c,node.node_id,agentId,true);
    const ld=await leader(c);
    if(ld.paused||ld.phase!=='READY'||Number(ld.epoch)!==Number(info.job.epoch)||
       !ld.lease_until||Date.parse(ld.lease_until+'Z')<=await dbNow(c))
      fault('STALE_MASTER_EPOCH',409);
    return idem(c,agentId,d.request_id,'GIT_CONFIRM',{ticketId,head:verified.headSha},async()=>{
      const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',[ticketId]);
      const t=await one(c,'SELECT status,candidate_tree_sha FROM v7_tickets WHERE ticket_id=? FOR UPDATE',[ticketId]);
      if(job?.state!=='RUNNING'||t?.status!=='INTEGRATING'||t.candidate_tree_sha!==verified.treeSha||
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
app.post('/v7/git/pr-draft',jsonRoute(async req=>{
  admin(req);
  if(process.env.SUTRADHAR_ENABLE_PR_CREATION!=='true')
    fault('DRAFT_PR_CREATION_DISABLED',403);
  const d=req.body||{},ticketId=requireId(d.ticket_id);
  const info=await transaction(async c=>{
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticketId]);
    const j=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticketId]);
    if(!t||!j||j.state!=='CONFIRMED'||t.status!=='INTEGRATING')
      fault('GIT_PROOF_REQUIRED',409);
    const p=await one(c,'SELECT * FROM v7_projects WHERE project_id=?',[t.project_id]);
    return {t,j,p};
  });
  const changed=typeof info.j.changed_files_json==='string'?JSON.parse(info.j.changed_files_json):info.j.changed_files_json;
  const pr=await createVerifiedDraftPr({
    repo:info.p.repository,token:process.env.SUTRADHAR_GITHUB_PR_TOKEN||'',
    branch:info.t.branch_name,ticketId,
    baselineCommit:info.t.baseline_sha,candidateTreeSha:info.t.candidate_tree_sha,
    changedFiles:changed,allowedFiles:changed,title:info.t.title,description:info.t.description
  });
  const created=pr.created?pr:fault('DRAFT_PR_REMOTE_UNCERTAIN',409);
  if(created.headSha!==info.j.remote_head_sha)fault('DRAFT_PR_REMOTE_UNCERTAIN',409);
  return transaction(async c=>idem(c,'owner:web',d.request_id,'DRAFT_PR',{ticketId,prNumber:created.prNumber},async()=>{
    const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=? FOR UPDATE',[ticketId]);
    if(!job||job.state!=='CONFIRMED'||job.remote_head_sha!==created.headSha)
      fault('GIT_RECEIPT_CHANGED',409);
    if(job.pr_number&&Number(job.pr_number)!==created.prNumber)
      fault('DRAFT_PR_NUMBER_CONFLICT',409);
    await c.query('UPDATE v7_git_jobs SET pr_number=?,pr_url=?,updated_at=UTC_TIMESTAMP(3) WHERE ticket_id=?',
      [created.prNumber,created.url,ticketId]);
    await event(c,'GITHUB_DRAFT_PR_VERIFIED','owner:web',Number((await leader(c)).epoch),ticketId,
      {pr_number:created.prNumber,head:created.headSha});
    return {accepted:true,ticket_id:ticketId,draft:true,pr_number:created.prNumber,url:created.url,
      status:'REVIEW_REQUIRED'};
  }));
}));
app.post('/v7/tasks/verify-merge',jsonRoute(async req=>{
  // This does NOT merge: read-only authenticated remote verification only.
  admin(req);
  const d=req.body||{},ticket=requireId(d.ticket_id),requestId=requireId(d.request_id);
  const info=await transaction(async c=>{
    const t=await one(c,'SELECT * FROM v7_tickets WHERE ticket_id=?',[ticket]);
    if(!t||t.status!=='INTEGRATING')fault('NOT_READY_FOR_GIT_VERIFICATION',409);
    const p=await one(c,'SELECT * FROM v7_projects WHERE project_id=?',[t.project_id]);
    const qa=await one(c,'SELECT receipt_id FROM v7_qa_receipts WHERE ticket_id=? AND passed=1 AND head_sha=? AND tree_sha=?',
      [ticket,t.candidate_head_sha,t.candidate_tree_sha]);
    if(!qa)fault('QA_REQUIRED',409);
    const job=await one(c,'SELECT * FROM v7_git_jobs WHERE ticket_id=?',[ticket]);
    if(!job||job.state!=='CONFIRMED'||!job.remote_head_sha||!job.pr_number)
      fault('VERIFIED_GIT_DRAFT_PR_REQUIRED',409);
    if(t.risk==='CORE'||t.risk==='HIGH'){
      const approval=await one(c,'SELECT proposal_id FROM v7_approvals WHERE ticket_id=? AND state="APPROVED"',[ticket]);
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
       t.status!=='INTEGRATING'||t.candidate_head_sha!==info.t.candidate_head_sha||
      t.candidate_tree_sha!==info.t.candidate_tree_sha)fault('VERSION_CONFLICT',409);
    await c.query('INSERT INTO v7_git_receipts(ticket_id,receipt_json) VALUES(?,?)',
      [ticket,JSON.stringify(verification)]);
    await c.query('UPDATE v7_tickets SET status="DONE",version=version+1 WHERE ticket_id=?',[ticket]);
    await c.query('DELETE FROM v7_reservations WHERE ticket_id=?',[ticket]);
    await c.query('UPDATE v7_leases SET revoked=1 WHERE ticket_id=?',[ticket]);
    await event(c,'GITHUB_MERGE_VERIFIED','owner:web',Number((await leader(c)).epoch),ticket,verification);
    return {accepted:true,ticket_id:ticket,status:'DONE',evidence_level:'REMOTE_VERIFIED',github:verification};
  }));
}));
app.get('/v7/audit',jsonRoute(async req=>{
  admin(req);return transaction(c=>rows(c,'SELECT event_id,event_type,actor,epoch,resource_id,payload_json,created_at FROM v7_events ORDER BY event_id DESC LIMIT 250'));
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
  const dir=path.resolve(process.cwd(),'dist');
  app.use(express.static(dir,{index:false}));
  app.get('*',(_req,res)=>res.sendFile(path.join(dir,'index.html')));
}
if(process.env.SUTRADHAR_V7_NO_LISTEN!=='true'){
  app.listen(PORT,'0.0.0.0',()=>console.log('SUTRADHAR v7 MySQL control plane listening; configured='+configured));
}
export async function shutdownV7ForTests(){if(process.env.NODE_ENV!=='test')fault('TEST_ONLY',403);await pool?.end();}
export {app,transaction,evaluate,ownerCommand};
