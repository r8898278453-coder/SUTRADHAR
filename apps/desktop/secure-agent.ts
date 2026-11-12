/**
 * SUTRADHAR v7 packaged Desktop agent. The Electron main process alone
 * performs OS-safeStorage encryption/decryption; this child requests state
 * through a private parent-child IPC pipe. No plaintext identity is written
 * to disk and no private key is passed via env/argv.
 *
 * The developer-only v7/agent.ts remains a separate, explicitly alpha daemon.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {HEARTBEAT_SECONDS,ID_RE,digest} from '../../v7/rules.ts';
type Agent={id:string;sequence:number};
type Saved={node_id:string;private_key_pem:string;public_key_pem:string;
  node_sequence:number;boot_id:string;agents:Agent[]};
type Message={type:string;id:number;op?:string;payload?:unknown;result?:any;error?:string};
if(process.env.SUTRADHAR_VAULT_BRIDGE!=='1'||typeof process.send!=='function')
  throw Error('SECURE_AGENT_REQUIRES_ELECTRON_OS_VAULT_BRIDGE');
const central=(process.env.SUTRADHAR_CENTRAL_URL||'').replace(/\/+$/,'');
if(!/^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(central))throw Error('HTTPS_CENTRAL_REQUIRED');
const home=process.env.SUTRADHAR_NODE_DIR||'';
if(!home||!path.isAbsolute(home))throw Error('SECURE_AGENT_REQUIRES_PRIVATE_NODE_DIR');
fs.mkdirSync(home,{recursive:true,mode:0o700});
const agentNames=(process.env.SUTRADHAR_AGENT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
if(agentNames.length===0||agentNames.length>4||new Set(agentNames).size!==agentNames.length||
  agentNames.some(x=>!ID_RE.test(x)))throw Error('INVALID_AGENT_IDS');

let nextId=0;
const waiting=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
process.on('message',(raw:unknown)=>{
  const message=raw as Message;
  if(message?.type!=='vault:response'||!Number.isSafeInteger(message.id))return;
  const pending=waiting.get(message.id);if(!pending)return;
  waiting.delete(message.id);
  if(message.error)pending.reject(Error(String(message.error).slice(0,120)));
  else pending.resolve(message.result);
});
function bridge<T>(op:string,payload?:unknown):Promise<T>{
  if(waiting.size>2)throw Error('VAULT_BRIDGE_BUSY');
  return new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{
      waiting.delete(id);reject(Error('VAULT_BRIDGE_TIMEOUT'));
    },10000);
    waiting.set(id,{
      resolve:v=>{clearTimeout(timer);resolve(v);},
      reject:e=>{clearTimeout(timer);reject(e);}
    });
    process.send!({type:'vault:request',id,op,payload},err=>{
      if(err){const x=waiting.get(id);if(x){waiting.delete(id);x.reject(Error('VAULT_BRIDGE_DISCONNECTED'));}}
    });
  });
}
function createIdentity():Saved{
  const kp=crypto.generateKeyPairSync('ed25519');
  return {node_id:'node_'+crypto.randomUUID().replace(/-/g,''),
    private_key_pem:kp.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    public_key_pem:kp.publicKey.export({type:'spki',format:'pem'}).toString(),
    node_sequence:0,boot_id:'boot_'+crypto.randomUUID().replace(/-/g,''),agents:[]};
}
function privateStatus(state:Saved,extra:Record<string,unknown>){
  const file=path.join(home,'status.json'),tmp=file+'.'+process.pid+'.tmp';
  try{
    let old:any=null;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const last=typeof extra.last_accepted_at==='string'?extra.last_accepted_at:
      old?.node_id===state.node_id?old.last_accepted_at:null;
    fs.writeFileSync(tmp,JSON.stringify({node_id:state.node_id,
      observed_at:new Date().toISOString(),last_accepted_at:last,...extra})+'\n',{mode:0o600});
    fs.renameSync(tmp,file);
  }catch{try{fs.unlinkSync(tmp);}catch{}}
}
async function main(){
  let state=await bridge<Saved|null>('load');
  if(!state)state=createIdentity();
  const ids=new Set(state.agents.map(a=>a.id));
  if(state.agents.some(a=>!agentNames.includes(a.id)))
    throw Error('DEVICE_AGENT_LIST_MISMATCH_REQUIRES_OWNER');
  for(const id of agentNames)if(!ids.has(id))state.agents.push({id,sequence:0});
  state.boot_id='boot_'+crypto.randomUUID().replace(/-/g,'');
  await bridge('save',state);
  const key=crypto.createPrivateKey(state.private_key_pem);
  function signed(method:string,uri:string,body:string){
    const ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
    const value=[String(ts),nonce,method,uri,digest(body)].join('\n');
    return {'x-sutradhar-node':state!.node_id,
      'x-sutradhar-timestamp':String(ts),
      'x-sutradhar-nonce':nonce,
      'x-sutradhar-signature':crypto.sign(null,Buffer.from(value),key).toString('base64')};
  }
  async function send(method:'GET'|'POST',uri:string,data?:any,authorization?:string,agentId?:string){
    const body=method==='POST'?JSON.stringify(data):'';
    const headers:Record<string,string>={'content-type':'application/json'};
    if(authorization)headers.authorization='Bearer '+authorization;
    else Object.assign(headers,signed(method,uri,body));
    if(agentId)headers['x-sutradhar-agent']=agentId;
    const res=await fetch(central+uri,{method,headers,body:method==='POST'?body:undefined,
      signal:AbortSignal.timeout(15000)});
    const answer=await res.json() as any;
    if(!res.ok)throw Error(String(answer?.error_code||'HTTP_'+res.status));
    return answer;
  }
  async function enroll(){
    const file=path.join(home,'enrollment_requested');
    if(fs.existsSync(file))return;
    const grant=await bridge<string>('grant');
    if(!grant||grant.length<32)throw Error('OWNER_ENROLLMENT_GRANT_REQUIRED');
    try{
      const proof=crypto.sign(null,Buffer.from('enroll:'+state!.node_id),key).toString('base64');
      try{
        await send('POST','/v7/nodes/enroll',{
          node_id:state!.node_id,public_key_pem:state!.public_key_pem,
          display_name:process.env.SUTRADHAR_NODE_NAME||'SUTRADHAR Desktop',
          proof
        },grant);
      }catch(e:any){
        if(e.message!=='NODE_ID_ALREADY_EXISTS')throw e;
        const existing=await send('GET','/v7/nodes/me');
        if(existing.node_id!==state!.node_id)throw Error('ENROLLMENT_IDENTITY_CONFLICT');
      }
      fs.writeFileSync(file,new Date().toISOString(),{mode:0o600});
      await bridge('consumeGrant');
    }finally{
      // A grant is never written to disk or added to a child environment.
    }
  }
  async function recovery(masterId:string,epoch:number){
    const data=await send('GET','/v7/recovery',undefined,undefined,masterId);
    if(data.epoch!==epoch||data.phase!=='RECOVERING'||data.tickets.length>=300||
      data.events.length>=300||data.checkpoints.length>=300||
      data.tickets.some((t:any)=>t.status==='RECONCILIATION_REQUIRED'))
      throw Error('RECOVERY_RECONCILIATION_REQUIRED');
    for(const cp of data.checkpoints){
      if(digest(cp.summary+'\n'+cp.next_action)!==cp.content_sha256)
        throw Error('RECOVERY_CHECKPOINT_HASH_MISMATCH');
    }
    const {manifest_sha256,...payload}=data;
    if(digest(JSON.stringify(payload))!==manifest_sha256)
      throw Error('RECOVERY_MANIFEST_HASH_MISMATCH');
    await send('POST','/v7/leadership/reconcile',{
      request_id:'recovery_'+epoch+'_'+masterId,agent_id:masterId,
      expected_master_epoch:epoch,manifest_sha256
    });
  }
  let epoch:number|null=null;
  const registered=new Set<string>();
  for(;;){
    let accepted=false;
    try{
      await enroll();
      for(const agent of state.agents){
        if(registered.has(agent.id))continue;
        try{await send('POST','/v7/agents/register',{agent_id:agent.id,capabilities:{
          engine:'BROWSER_ASSISTED',platform:process.platform,secure_identity:true}});registered.add(agent.id);}
        catch(e:any){if(e.message==='AGENT_ID_ALREADY_EXISTS')registered.add(agent.id);
          else if(e.message!=='NODE_NOT_APPROVED')throw e;}
      }
      if(registered.size===state.agents.length){
        state.node_sequence++;
        for(const a of state.agents)a.sequence++;
        // A durable OS-vault write is mandatory BEFORE sending the heartbeat.
        await bridge('save',state);
        const reply=await send('POST','/v7/nodes/heartbeat',{
          boot_id:state.boot_id,sequence:state.node_sequence,expected_master_epoch:epoch,
          agents:state.agents.map(a=>({agent_id:a.id,sequence:a.sequence,status:'ONLINE'}))
        });
        epoch=Number(reply.epoch);accepted=true;
        privateStatus(state,{connection:'ACKNOWLEDGED',
          last_accepted_at:reply.server_received_at,phase:reply.phase,
          master_agent_id:reply.master_agent_id||null,epoch});
        if(reply.phase==='RECOVERING'&&reply.master_agent_id&&
           state.agents.some(a=>a.id===reply.master_agent_id))
          await recovery(reply.master_agent_id,epoch);
      }
    }catch(e:any){
      privateStatus(state,{connection:accepted?'RECOVERY_BLOCKED':'NOT_ACKNOWLEDGED',
        error_code:String(e.message||'UNKNOWN').slice(0,100),last_error_at:new Date().toISOString()});
      // No LLM or local election. Never print node key, grant or env.
      console.error('Secure edge wait:',String(e.message||'UNKNOWN').slice(0,100));
    }
    await new Promise(resolve=>setTimeout(resolve,HEARTBEAT_SECONDS*1000));
  }
}
main().catch(e=>{console.error('Secure agent blocked:',String(e.message).slice(0,100));process.exitCode=1;});
