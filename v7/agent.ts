/**
 * SUTRADHAR v7 edge daemon. One persistent computer identity and many agents.
 * Never uses MySQL directly, makes LLM calls for heartbeats or self-promotes.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {verifyRecoverySnapshot} from './recovery_validation.ts';
import {verifyExistingAgentOnOwnNode} from './agent_restart_authority.ts';
import {openDeveloperIdentity} from './developer_identity.ts';
import type {DeveloperIdentity as Saved} from './developer_identity.ts';

const home=process.env.SUTRADHAR_NODE_DIR||path.join(os.homedir(),'.sutradhar','v7');
const central=process.env.SUTRADHAR_CENTRAL_URL||'';
if(!/^https:\/\//.test(central)&&!(process.env.SUTRADHAR_ALLOW_HTTP_LOCAL==='true'&&
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/.test(central)))
  throw new Error('HTTPS central URL required (local HTTP requires explicit opt-in)');
const base=central.replace(/\/+$/,'');
// A previously enrolled daemon must not keep an obsolete enrollment secret.
if(fs.existsSync(path.join(home,'enrollment_requested')))delete process.env.SUTRADHAR_ENROLLMENT_CODE;
const agentNames=(process.env.SUTRADHAR_AGENT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
if(!agentNames.length)throw new Error('SUTRADHAR_AGENT_IDS required');

// Local status is informational only. Central remains the authority.
// The Electron setup window reads this file; it contains NO credentials.
const statusFile=path.join(home,'status.json');
function reportStatus(info:Record<string,unknown>){
  try{
    const tmp=statusFile+'.'+process.pid+'.tmp';
    let previous:any={};
    try{previous=JSON.parse(fs.readFileSync(statusFile,'utf8'));}catch{}
    const last_accepted_at=typeof info.last_accepted_at==='string'
      ? info.last_accepted_at : (previous.node_id===state.node_id?previous.last_accepted_at:null);
    fs.writeFileSync(tmp,JSON.stringify({observed_at:new Date().toISOString(),
      node_id:state.node_id,last_accepted_at,...info},null,2)+'\n',{mode:0o600});
    fs.renameSync(tmp,statusFile);fs.chmodSync(statusFile,0o600);
  }catch{console.error('Could not update local agent status');}
}

// This CLI/alpha identity is deliberately PLAINTEXT: never the packaged
// Electron OS-vault identity and never approved for production Windows PCs.
// A stale exclusive lock requires Owner inspection before any restart.
const identitySession=openDeveloperIdentity(home,agentNames);
const state:Saved=identitySession.state;
process.on('exit',()=>identitySession.release());
process.once('SIGINT',()=>{identitySession.release();process.exit(130);});
process.once('SIGTERM',()=>{identitySession.release();process.exit(143);});
const key=crypto.createPrivateKey(state.private_key_pem);
function sig(pathname:string,body:string,ts:number,nonce:string,method='POST'){
  const value=[String(ts),nonce,method,pathname,crypto.createHash('sha256').update(body).digest('hex')].join('\n');
  return crypto.sign(null,Buffer.from(value),key).toString('base64');
}
async function api(pathname:string,payload:any,signed=true){
  const body=JSON.stringify(payload),ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
  const headers:Record<string,string>={'content-type':'application/json'};
  if(signed){headers['x-sutradhar-node']=state.node_id;headers['x-sutradhar-timestamp']=String(ts);
    headers['x-sutradhar-nonce']=nonce;headers['x-sutradhar-signature']=sig(pathname,body,ts,nonce);}
  else {if(!process.env.SUTRADHAR_ENROLLMENT_CODE)throw new Error('Enrollment grant missing');
    headers.authorization='Bearer '+process.env.SUTRADHAR_ENROLLMENT_CODE;}
  const res=await fetch(base+pathname,{method:'POST',headers,body,signal:AbortSignal.timeout(15000)});
  const reply=await res.json() as any;
  if(!res.ok)throw new Error(reply.error_code||'HTTP_'+res.status);
  return reply;
}
async function enroll(){
  const proof=crypto.sign(null,Buffer.from('enroll:'+state.node_id),key).toString('base64');
  return api('/v7/nodes/enroll',{node_id:state.node_id,public_key_pem:state.public_key_pem,
    display_name:process.env.SUTRADHAR_NODE_NAME||os.hostname(),
    general_location:process.env.SUTRADHAR_GENERAL_LOCATION||undefined,proof},false);
}
async function register(agent_id:string){
  return api('/v7/agents/register',{agent_id,capabilities:{
    engine:'BROWSER_ASSISTED',providers:['ChatGPT Web','Google AI Studio'],platform:process.platform}});
}
async function signedGet(pathname:string,agentId?:string){
  const ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
  const value=[String(ts),nonce,'GET',pathname,crypto.createHash('sha256').update('').digest('hex')].join('\n');
  const signature=crypto.sign(null,Buffer.from(value),key).toString('base64');
  const result=await fetch(base+pathname,{method:'GET',headers:{
    'x-sutradhar-node':state.node_id,'x-sutradhar-timestamp':String(ts),
    'x-sutradhar-nonce':nonce,'x-sutradhar-signature':signature,
    ...(agentId?{'x-sutradhar-agent':agentId}:{})
  },signal:AbortSignal.timeout(15000)});
  const reply=await result.json() as any;
  if(!result.ok)throw new Error(reply.error_code||'HTTP_'+result.status);
  return reply;
}
async function reconcileNewMaster(agentId:string,epoch:number){
  const snapshot=await signedGet('/v7/recovery',agentId);
  const manifest=verifyRecoverySnapshot(snapshot,epoch);
  const ack=await api('/v7/leadership/reconcile',{
    request_id:'recovery_'+epoch+'_'+agentId,agent_id:agentId,
    expected_master_epoch:epoch,manifest_sha256:manifest});
  console.info('Master recovery checkpoint verified:',ack.phase,'epoch',epoch);
}
async function heartbeat(epoch:number|null){
  state.node_sequence++;for(const a of state.agents)a.sequence++;
  identitySession.persistHeartbeat(state); // fsync BEFORE signing/transmitting
  return api('/v7/nodes/heartbeat',{boot_id:state.boot_id,sequence:state.node_sequence,
    expected_master_epoch:epoch,
    agents:state.agents.map(a=>({agent_id:a.id,sequence:a.sequence,status:'ONLINE'}))});
}
async function run(){
  let epoch:number|null=null;const registered=new Set<string>();
  for(;;){
    let heartbeatAccepted=false;
    try{
      if(!fs.existsSync(path.join(home,'enrollment_requested'))){
        try {
          await enroll();
          fs.writeFileSync(path.join(home,'enrollment_requested'),new Date().toISOString(),{mode:0o600});
          // One-time enrollment grant no longer needed after Central accepts the node.
          delete process.env.SUTRADHAR_ENROLLMENT_CODE;
        } catch(e:any) {
          // The previous enrollment request may have succeeded even when the local
          // marker write was interrupted. Reconcile by proving possession of THIS
          // node's private key to the approved Central; never trust a matching ID alone.
          if(e.message!=='NODE_ID_ALREADY_EXISTS')throw e;
          const existing=await signedGet('/v7/nodes/me');
          if(existing.node_id!==state.node_id)throw new Error('ENROLLMENT_IDENTITY_MISMATCH');
          fs.writeFileSync(path.join(home,'enrollment_requested'),new Date().toISOString(),{mode:0o600});
          // One-time enrollment grant no longer needed after Central accepts the node.
          delete process.env.SUTRADHAR_ENROLLMENT_CODE;
        }
      }
      for(const a of state.agents){if(registered.has(a.id))continue;
        try{await register(a.id);registered.add(a.id);}
        catch(e:any){
          if(e.message==='AGENT_ID_ALREADY_EXISTS'){
            // Another PC may already own this global agent ID. Only Central's
            // node-signed, node-filtered own view can reconcile a restart.
            const own=await signedGet('/v7/nodes/me');
            verifyExistingAgentOnOwnNode(own,state.node_id,a.id);
            registered.add(a.id);
          }else if(e.message!=='NODE_NOT_APPROVED')throw e;
        }}
      if(registered.size===state.agents.length){
        const reply=await heartbeat(epoch);epoch=Number(reply.epoch);
        heartbeatAccepted=true;
        // An accepted signed reply is a real Central acknowledgment, not a UI guess.
        reportStatus({connection:'ACKNOWLEDGED',last_accepted_at:reply.server_received_at,
          epoch:Number(reply.epoch),master_agent_id:reply.master_agent_id||null,
          phase:String(reply.phase||''),backups:Array.isArray(reply.backups)?reply.backups:[],
          agent_ids:state.agents.map(a=>a.id)});
        if(reply.master_agent_id&&state.agents.some(a=>a.id===reply.master_agent_id)&&reply.phase==='RECOVERING')
          await reconcileNewMaster(reply.master_agent_id,Number(reply.epoch));}
    }catch(e:any){
      // A failed/ambiguous identity write poisons this daemon. Never continue
      // generating node-authenticated requests against uncertain counters.
      if(/^DEV_EDGE_(?:IDENTITY_|HEARTBEAT_)/.test(String(e?.message||'')))
        throw e;
      console.error('Central unavailable/not approved:',String(e.message).slice(0,100));
      reportStatus({connection:heartbeatAccepted?'RECOVERY_BLOCKED':'NOT_ACKNOWLEDGED',
        last_error_at:new Date().toISOString(),
        error_code:String(e.message).slice(0,100),agent_ids:state.agents.map(a=>a.id)});
      const record={at:new Date().toISOString(),node_id:state.node_id,sequence:state.node_sequence,
        event:'CENTRAL_UNAVAILABLE'};
      const json=JSON.stringify(record),signature=crypto.sign(null,Buffer.from(json),key).toString('base64');
      fs.appendFileSync(path.join(home,'sealed_outbox.jsonl'),JSON.stringify({record,signature})+'\n',{mode:0o600});
    }
    await new Promise(resolve=>setTimeout(resolve,60000));
  }
}
run().catch(e=>{console.error('Edge startup failed:',e.message);process.exitCode=1;});
