/**
 * SUTRADHAR v7 edge daemon. One persistent computer identity and many agents.
 * Never uses MySQL directly, makes LLM calls for heartbeats or self-promotes.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
type Saved = {node_id:string;private_key_pem:string;public_key_pem:string;
  node_sequence:number;boot_id:string;agents:{id:string;sequence:number}[]};
const home=process.env.SUTRADHAR_NODE_DIR||path.join(os.homedir(),'.sutradhar','v7');
const filename=path.join(home,'identity.json'),central=process.env.SUTRADHAR_CENTRAL_URL||'';
if(!/^https:\/\//.test(central)&&!(process.env.SUTRADHAR_ALLOW_HTTP_LOCAL==='true'&&
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/.test(central)))
  throw new Error('HTTPS central URL required (local HTTP requires explicit opt-in)');
const base=central.replace(/\/+$/,'');
const agentNames=(process.env.SUTRADHAR_AGENT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
if(!agentNames.length)throw new Error('SUTRADHAR_AGENT_IDS required');
fs.mkdirSync(home,{recursive:true,mode:0o700});
function persist(data:Saved){const tmp=filename+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,filename);fs.chmodSync(filename,0o600);}
function newIdentity():Saved{
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  return {node_id:'node_'+crypto.randomUUID().replace(/-/g,''),
    boot_id:'boot_'+crypto.randomUUID().replace(/-/g,''),
    private_key_pem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    public_key_pem:publicKey.export({type:'spki',format:'pem'}).toString(),node_sequence:0,agents:[]};}
const state:Saved=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):newIdentity();
const ids=new Set(state.agents.map(x=>x.id));
for(const id of agentNames){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(id))throw new Error('Invalid agent ID');
  if(!ids.has(id)){state.agents.push({id,sequence:0});ids.add(id);}}
state.boot_id='boot_'+crypto.randomUUID().replace(/-/g,'');persist(state);
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
  if(snapshot.epoch!==epoch||snapshot.phase!=='RECOVERING')throw new Error('Recovery epoch changed');
  if(snapshot.tickets.length>=300||snapshot.checkpoints.length>=300||snapshot.events.length>=300)
    throw new Error('Recovery manifest pagination required; block READY');
  if(snapshot.tickets.some((t:any)=>t.status==='RECONCILIATION_REQUIRED'))
    throw new Error('Task reconciliation required before READY; owner must verify remote Git effects');
  const cursors=new Set<number>();
  for(const e of snapshot.events){
    if(cursors.has(Number(e.event_id)))throw new Error('Duplicate event cursor');
    cursors.add(Number(e.event_id));
  }
  for(const cp of snapshot.checkpoints){
    const expected=crypto.createHash('sha256').update(cp.summary+'\n'+cp.next_action).digest('hex');
    if(expected!==cp.content_sha256)throw new Error('Checkpoint digest mismatch');
  }
  const {manifest_sha256,...payload}=snapshot;
  const manifest=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if(manifest!==manifest_sha256)throw new Error('Central recovery manifest hash mismatch');
  const ack=await api('/v7/leadership/reconcile',{
    request_id:'recovery_'+epoch+'_'+agentId,agent_id:agentId,
    expected_master_epoch:epoch,manifest_sha256:manifest});
  console.info('Master recovery checkpoint verified:',ack.phase,'epoch',epoch);
}
async function heartbeat(epoch:number|null){
  state.node_sequence++;for(const a of state.agents)a.sequence++;
  persist(state); // Never reuse sequences after a crash/ambiguous reply.
  return api('/v7/nodes/heartbeat',{boot_id:state.boot_id,sequence:state.node_sequence,
    expected_master_epoch:epoch,
    agents:state.agents.map(a=>({agent_id:a.id,sequence:a.sequence,status:'ONLINE'}))});
}
async function run(){
  let epoch:number|null=null;const registered=new Set<string>();
  for(;;){
    try{
      if(!fs.existsSync(path.join(home,'enrollment_requested'))){
        try {
          await enroll();
          fs.writeFileSync(path.join(home,'enrollment_requested'),new Date().toISOString(),{mode:0o600});
        } catch(e:any) {
          // The previous enrollment request may have succeeded even when the local
          // marker write was interrupted. Reconcile by proving possession of THIS
          // node's private key to the approved Central; never trust a matching ID alone.
          if(e.message!=='NODE_ID_ALREADY_EXISTS')throw e;
          const existing=await signedGet('/v7/nodes/me');
          if(existing.node_id!==state.node_id)throw new Error('ENROLLMENT_IDENTITY_MISMATCH');
          fs.writeFileSync(path.join(home,'enrollment_requested'),new Date().toISOString(),{mode:0o600});
        }
      }
      for(const a of state.agents){if(registered.has(a.id))continue;
        try{await register(a.id);registered.add(a.id);}
        catch(e:any){if(e.message==='AGENT_ID_ALREADY_EXISTS')registered.add(a.id);
          else if(e.message!=='NODE_NOT_APPROVED')throw e;}}
      if(registered.size===state.agents.length){
        const reply=await heartbeat(epoch);epoch=Number(reply.epoch);
        if(reply.master_agent_id&&state.agents.some(a=>a.id===reply.master_agent_id)&&reply.phase==='RECOVERING')
          await reconcileNewMaster(reply.master_agent_id,Number(reply.epoch));}
    }catch(e:any){
      console.error('Central unavailable/not approved:',String(e.message).slice(0,100));
      const record={at:new Date().toISOString(),node_id:state.node_id,sequence:state.node_sequence,
        event:'CENTRAL_UNAVAILABLE'};
      const json=JSON.stringify(record),signature=crypto.sign(null,Buffer.from(json),key).toString('base64');
      fs.appendFileSync(path.join(home,'sealed_outbox.jsonl'),JSON.stringify({record,signature})+'\n',{mode:0o600});
    }
    await new Promise(resolve=>setTimeout(resolve,60000));
  }
}
run().catch(e=>{console.error('Edge startup failed:',e.message);process.exitCode=1;});
