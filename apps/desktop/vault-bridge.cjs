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
  'GET /v7/nodes/me','GET /v7/cluster/state','GET /v7/nodes/maintenance','GET /v7/recovery',
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
  // NOT exposed to the supervised agent's 'sign' IPC operation. Electron
  // main invokes this narrower capability only for an interactive user
  // request from the sandboxed local setup window. Read-only task discovery
  // cannot sign a claim, checkpoint, QA, Git, Owner or installer operation.
  function signWorkerReadOnly({method,uri,agent_id}={}){
    const v=identity();
    if(method!=='GET'||typeof uri!=='string'||!AGENT_ID.test(agent_id||'')||
      !v.agents.some(a=>a.id===agent_id)||
      !(uri==='/v7/tasks/available'||
        /^\/v7\/tasks\/detail\/[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(uri)))
      fail('VAULT_WORKER_READONLY_REQUEST_DENIED');
    const key=crypto.createPrivateKey(v.private_key_pem);
    const ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
    const hash=crypto.createHash('sha256').update('').digest('hex');
    const canonical=[String(ts),nonce,'GET',uri,hash].join('\n');
    return {'x-sutradhar-node':v.node_id,'x-sutradhar-timestamp':String(ts),
      'x-sutradhar-nonce':nonce,
      'x-sutradhar-signature':crypto.sign(null,Buffer.from(canonical),key).toString('base64'),
      'x-sutradhar-agent':agent_id};
  }
  // Electron MAIN only. The existing supervised heartbeat child IPC exposes
  // sign({kind:'node_api'}) but NEVER signWorkerAction. Each operation has a
  // fixed path and exact JSON shape; there is no generic POST signing oracle.
  function signWorkerAction({operation,agent_id,payload}={}){
    const v=identity();
    if(!AGENT_ID.test(agent_id||'')||!v.agents.some(a=>a.id===agent_id)||
       !payload||typeof payload!=='object'||Array.isArray(payload)||
       payload.agent_id!==agent_id)
      fail('VAULT_WORKER_ACTION_DENIED');
    const id=x=>typeof x==='string'&&AGENT_ID.test(x);
    const epoch=Number.isSafeInteger(payload.expected_master_epoch)&&
      payload.expected_master_epoch>0;
    let uri,expected;
    if(operation==='claim'){
      uri='/v7/tasks/claim';
      expected=['request_id','agent_id','ticket_id','expected_version',
        'expected_master_epoch'];
      if(!id(payload.ticket_id)||!id(payload.request_id)||
        !payload.request_id.startsWith('claim_')||
        !Number.isSafeInteger(payload.expected_version)||
        payload.expected_version<1||!epoch)fail('VAULT_WORKER_ACTION_DENIED');
    }else if(operation==='resume-check'){
      uri='/v7/tasks/resume-check';
      expected=['agent_id','ticket_id','lease_id','expected_master_epoch'];
      if(!id(payload.ticket_id)||typeof payload.lease_id!=='string'||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.lease_id)||
        !epoch)fail('VAULT_WORKER_ACTION_DENIED');
    }else if(operation==='submit'){
      uri='/v7/tasks/submit';
      expected=['request_id','agent_id','ticket_id','lease_id',
        'expected_master_epoch','candidate_head_sha','candidate_tree_sha'];
      if(!id(payload.ticket_id)||!id(payload.request_id)||
        !payload.request_id.startsWith('submit_')||
        typeof payload.lease_id!=='string'||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.lease_id)||
        !/^[a-f0-9]{40}$/.test(payload.candidate_head_sha||'')||
        !/^[a-f0-9]{40}$/.test(payload.candidate_tree_sha||'')||
        !epoch)fail('VAULT_WORKER_ACTION_DENIED');
    }else if(operation==='qa-evidence'){
      uri='/v7/tasks/qa-evidence';
      expected=['request_id','agent_id','ticket_id','evidence_base64',
        'attestation','evidence_ref'];
      if(!id(payload.request_id)||!payload.request_id.startsWith('qaevidence_')||
         !id(payload.ticket_id)||
         typeof payload.evidence_base64!=='string'||
         payload.evidence_base64.length<100||payload.evidence_base64.length>22000||
         !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.evidence_base64)||
         !payload.attestation||typeof payload.attestation!=='object'||
         Array.isArray(payload.attestation)||
         payload.attestation.schema!==1||
         typeof payload.evidence_ref!=='string'||
         !/^sha256:[a-f0-9]{64}$/.test(payload.evidence_ref))
        fail('VAULT_WORKER_ACTION_DENIED');
    }else if(operation==='qa-receipt'){
      uri='/v7/tasks/qa-receipt';
      expected=['request_id','agent_id','ticket_id','candidate_head_sha',
        'candidate_tree_sha','evidence_sha256','evidence_ref',
        'passed','review_proposal_id'];
      if(!id(payload.request_id)||!payload.request_id.startsWith('qareceipt_')||
         !id(payload.ticket_id)||
         !/^[a-f0-9]{40}$/.test(payload.candidate_head_sha||'')||
         !/^[a-f0-9]{40}$/.test(payload.candidate_tree_sha||'')||
         !/^[a-f0-9]{64}$/.test(payload.evidence_sha256||'')||
         payload.evidence_ref!=='sha256:'+payload.evidence_sha256||
         typeof payload.passed!=='boolean'||
         !/^qaev_[a-f0-9]{64}$/.test(payload.review_proposal_id||''))
        fail('VAULT_WORKER_ACTION_DENIED');
    }else if(operation==='renew-lease'||operation==='checkpoint'){
      uri=operation==='renew-lease'?'/v7/tasks/renew-lease':'/v7/tasks/checkpoint';
      expected=operation==='renew-lease'?
        ['request_id','agent_id','ticket_id','lease_id','expected_master_epoch','reason']:
        ['request_id','agent_id','ticket_id','lease_id','expected_master_epoch','summary','next_action'];
      if(!id(payload.ticket_id)||!id(payload.request_id)||
        !payload.request_id.startsWith(operation==='renew-lease'?'renew_':'checkpoint_')||
        typeof payload.lease_id!=='string'||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.lease_id)||
        !epoch)fail('VAULT_WORKER_ACTION_DENIED');
      if(operation==='renew-lease'){
        if(typeof payload.reason!=='string'||payload.reason.trim()!==payload.reason||
          payload.reason.length<12||payload.reason.length>300)
          fail('VAULT_WORKER_ACTION_DENIED');
      }else if(typeof payload.summary!=='string'||!payload.summary.trim()||
        payload.summary.length>8000||typeof payload.next_action!=='string'||
        !payload.next_action.trim()||payload.next_action.length>500)
        fail('VAULT_WORKER_ACTION_DENIED');
    }else fail('VAULT_WORKER_ACTION_DENIED');
    if(Object.keys(payload).length!==expected.length||
      Object.keys(payload).some(k=>!expected.includes(k)))
      fail('VAULT_WORKER_ACTION_DENIED');
    const body=JSON.stringify(payload);
    if(Buffer.byteLength(body,'utf8')>(operation==='qa-evidence'?48*1024:
      operation==='checkpoint'?16*1024:2048))
      fail('VAULT_WORKER_ACTION_DENIED');
    const key=crypto.createPrivateKey(v.private_key_pem);
    const ts=Date.now(),nonce='nonce_'+crypto.randomUUID().replace(/-/g,'');
    const canonical=[String(ts),nonce,'POST',uri,
      crypto.createHash('sha256').update(body).digest('hex')].join('\n');
    return {uri,body,headers:{
      'x-sutradhar-node':v.node_id,
      'x-sutradhar-timestamp':String(ts),
      'x-sutradhar-nonce':nonce,
      'x-sutradhar-signature':crypto.sign(null,Buffer.from(canonical),key).toString('base64'),
      'x-sutradhar-agent':agent_id
    }};
  }
  // Local QA evidence is NOT an API signature: this narrower capability
  // signs only one immutable hash-bound report statement under a distinct
  // domain. The child sign() bridge and renderer never expose it.
  function signQaEvidence(payload={}){
    const v=identity(),agent=payload.agent_id;
    const keys=['agent_id','ticket_id','candidate_head_sha',
      'candidate_tree_sha','evidence_sha256','passed'];
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||
       Object.keys(payload).length!==keys.length||
       Object.keys(payload).some(k=>!keys.includes(k))||
       !AGENT_ID.test(agent||'')||!v.agents.some(a=>a.id===agent)||
       !AGENT_ID.test(payload.ticket_id||'')||
       !/^[a-f0-9]{40}$/.test(payload.candidate_head_sha||'')||
       !/^[a-f0-9]{40}$/.test(payload.candidate_tree_sha||'')||
       !/^[a-f0-9]{64}$/.test(payload.evidence_sha256||'')||
       typeof payload.passed!=='boolean')
      fail('VAULT_QA_EVIDENCE_SIGN_DENIED');
    const message={schema:1,kind:'SUTRADHAR_INDEPENDENT_QA_EVIDENCE',
      node_id:v.node_id,agent_id:agent,ticket_id:payload.ticket_id,
      candidate_head_sha:payload.candidate_head_sha,
      candidate_tree_sha:payload.candidate_tree_sha,
      evidence_sha256:payload.evidence_sha256,passed:payload.passed};
    const bytes=Buffer.from('SUTRADHAR_QA_EVIDENCE_V1\n'+JSON.stringify(message));
    const signature=crypto.sign(null,bytes,
      crypto.createPrivateKey(v.private_key_pem)).toString('base64');
    return {message,signature,public_key_pem:v.public_key_pem};
  }
  return Object.freeze({initialize,saveCounters,sign,signWorkerReadOnly,signWorkerAction,signQaEvidence,snapshot:()=>publicSnapshot(vault.read())});
}
module.exports={createSignerBridge,publicSnapshot,validateAgentIds};
