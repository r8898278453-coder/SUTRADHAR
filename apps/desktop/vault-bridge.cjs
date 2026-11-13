/**
 * SUTRADHAR Desktop vault-backed signing boundary.
 *
 * Private Ed25519 key stays in Electron main process / OS-encrypted vault.
 * Worker receives only public identity/counters and signed authentication proof.
 * Pure Node module: testable without a Windows signing certificate.
 */
'use strict';
const crypto=require('node:crypto');

const NODE_ID=/^node_[0-9a-f]{32}$/;
const AGENT_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/;
const ALLOWED_REQUESTS=new Set([
  'GET /v7/nodes/me','GET /v7/recovery',
  'POST /v7/agents/register','POST /v7/nodes/heartbeat',
  'POST /v7/leadership/reconcile'
]);
function fail(code){throw Error(code);}
function validateAgentIds(names){
  if(!Array.isArray(names)||names.length<1||names.length>4||
    names.some(x=>typeof x!=='string'||!AGENT_ID.test(x))||
    new Set(names).size!==names.length)fail('VAULT_AGENT_LIST_INVALID');
}
function publicSnapshot(identity){
  if(!identity)return null;
  const {node_id,public_key_pem,node_sequence,boot_id,agents}=identity;
  return {node_id,public_key_pem,node_sequence,boot_id,
    agents:agents.map(a=>({id:a.id,sequence:a.sequence}))};
}
function createSignerBridge(vault){
  if(!vault||typeof vault.read!=='function'||typeof vault.save!=='function')
    fail('VAULT_SIGNER_UNAVAILABLE');
  function identity(){
    const v=vault.read();
    if(!v)fail('VAULT_IDENTITY_NOT_ENROLLED');
    return v;
  }
  function initialize({agent_ids}){
    validateAgentIds(agent_ids);
    let v=vault.read();
    if(!v){
      const kp=crypto.generateKeyPairSync('ed25519');
      v={node_id:'node_'+crypto.randomUUID().replace(/-/g,''),
        private_key_pem:kp.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
        public_key_pem:kp.publicKey.export({type:'spki',format:'pem'}).toString(),
        node_sequence:0,boot_id:'boot_'+crypto.randomUUID().replace(/-/g,''),
        agents:agent_ids.map(id=>({id,sequence:0}))};
    }else{
      const known=v.agents.map(a=>a.id);
      if(known.length!==agent_ids.length||known.some((id,i)=>id!==agent_ids[i]))
        fail('DEVICE_AGENT_LIST_CHANGE_REQUIRES_OWNER');
      v={...v,boot_id:'boot_'+crypto.randomUUID().replace(/-/g,'')};
    }
    vault.save(v);
    return publicSnapshot(v);
  }
  function saveCounters(candidate){
    if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
      Object.keys(candidate).some(x=>!['node_id','public_key_pem',
        'node_sequence','boot_id','agents'].includes(x))||
      'private_key_pem' in candidate)fail('VAULT_PUBLIC_STATE_INVALID');
    const existing=identity();
    if(candidate.node_id!==existing.node_id||
      candidate.public_key_pem!==existing.public_key_pem||
      candidate.boot_id!==existing.boot_id||
      !Number.isSafeInteger(candidate.node_sequence)||
      candidate.node_sequence<existing.node_sequence||
      !Array.isArray(candidate.agents)||candidate.agents.length!==existing.agents.length)
      fail('VAULT_IDENTITY_OR_SEQUENCE_MISMATCH');
    for(let i=0;i<candidate.agents.length;i++){
      const actual=candidate.agents[i],old=existing.agents[i];
      if(!actual||typeof actual!=='object'||Object.keys(actual).some(x=>!['id','sequence'].includes(x))||
        actual.id!==old.id||!Number.isSafeInteger(actual.sequence)||
        actual.sequence<old.sequence)fail('VAULT_AGENT_REPLAY_OR_IDENTITY_MISMATCH');
    }
    vault.save({...existing,node_sequence:candidate.node_sequence,
      agents:candidate.agents.map(a=>({id:a.id,sequence:a.sequence}))});
    return {stored:true};
  }
  function sign({kind,method,uri,body}={}){
    const v=identity();
    const key=crypto.createPrivateKey(v.private_key_pem);
    if(kind==='enroll'){
      if(method!==undefined||uri!==undefined||body!==undefined)fail('VAULT_ENROLL_REQUEST_INVALID');
      return {proof:crypto.sign(null,Buffer.from('enroll:'+v.node_id),key).toString('base64')};
    }
    if(kind!=='node_api'||typeof method!=='string'||typeof uri!=='string'||
      !ALLOWED_REQUESTS.has(method+' '+uri)||typeof body!=='string'||
      Buffer.byteLength(body,'utf8')>128*1024||
      ((method==='GET'&&body!=='')||(method==='POST'&&!body.startsWith('{'))))
      fail('VAULT_SIGN_REQUEST_DENIED');
    const ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
    const hash=crypto.createHash('sha256').update(body).digest('hex');
    const canonical=[String(ts),nonce,method,uri,hash].join('\n');
    const signature=crypto.sign(null,Buffer.from(canonical),key).toString('base64');
    return {'x-sutradhar-node':v.node_id,'x-sutradhar-timestamp':String(ts),
      'x-sutradhar-nonce':nonce,'x-sutradhar-signature':signature};
  }
  return Object.freeze({initialize,saveCounters,sign,snapshot:()=>publicSnapshot(vault.read())});
}
module.exports={createSignerBridge,publicSnapshot,validateAgentIds};
