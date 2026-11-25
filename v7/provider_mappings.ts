/**
 * Owner-declared provider workspace bindings, not provider authentication.
 * Bounded registry declarations and legacy deployment configuration; no
 * external provider requests. Never store credentials, URLs or cookies here.
 */
import {createHash} from 'node:crypto';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const ACCOUNT=/^account_[A-Za-z0-9_-]{3,64}$/;
const WORKSPACE=/^workspace_[A-Za-z0-9_-]{3,96}$/;
const PROVIDERS=['CHATGPT_WEB','GOOGLE_AI_STUDIO'] as const;
type Provider=typeof PROVIDERS[number];
export type Binding={project_id:string;agent_id:string;provider:Provider;
  account_ref:string;workspace_ref:string};
const exact=(v:unknown,re:RegExp):v is string=>typeof v==='string'&&!/[\r\n]/.test(v)&&re.test(v);
const invalid=()=>{throw Error('PROVIDER_MAPPING_CONFIG_INVALID');};
export function parseProviderMappings(raw:unknown):Binding[]{
  if(raw===undefined||raw==='')return [];
  if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)return invalid();
  let items:unknown;
  try{items=JSON.parse(raw);}catch{return invalid();}
  if(!Array.isArray(items)||items.length>100)return invalid();
  const bindings:Binding[]=[],assignments=new Set<string>();
  const workspaces=new Map<string,string>(),accounts=new Map<string,string>();
  for(const x of items){
    if(!x||typeof x!=='object'||Array.isArray(x)||
       Object.keys(x).sort().join('|')!=='account_ref|agent_id|project_id|provider|workspace_ref'||
       !exact(x.project_id,ID)||!exact(x.agent_id,ID)||
       !PROVIDERS.includes(x.provider)||!exact(x.account_ref,ACCOUNT)||
       !exact(x.workspace_ref,WORKSPACE))return invalid();
    const assignment=[x.project_id,x.agent_id,x.provider].join('|').toLowerCase();
    const workspace=[x.provider,x.account_ref,x.workspace_ref].join('|').toLowerCase();
    const account=[x.project_id,x.provider,x.account_ref].join('|').toLowerCase();
    // A provider/account/workspace cannot be mapped to another project.
    // Within a project an account cannot ambiguously refer to two workspaces.
    if(assignments.has(assignment)||
       (workspaces.has(workspace)&&workspaces.get(workspace)!==x.project_id)||
       (accounts.has(account)&&accounts.get(account)!==x.workspace_ref))
      throw Error('PROVIDER_MAPPING_CONFLICT');
    assignments.add(assignment);workspaces.set(workspace,x.project_id);
    accounts.set(account,x.workspace_ref);
    bindings.push({project_id:x.project_id,agent_id:x.agent_id,provider:x.provider,
      account_ref:x.account_ref,workspace_ref:x.workspace_ref});
  }
  return bindings;
}
export function declaredProviderMappings(raw:unknown,projectId:string,agentId:string){
  if(!exact(projectId,ID)||!exact(agentId,ID))return invalid();
  return parseProviderMappings(raw).filter(x=>x.project_id===projectId&&x.agent_id===agentId)
    .sort((a,b)=>a.provider<b.provider?-1:a.provider>b.provider?1:0)
    .map(x=>({provider:x.provider,account_ref:x.account_ref,workspace_ref:x.workspace_ref,
      binding_sha256:createHash('sha256').update(JSON.stringify(x)).digest('hex'),
      state:'OWNER_DECLARED_UNVERIFIED' as const,provider_mapping_verified:false as const,
      automatic_execution_allowed:false as const}));
}


// Canonical full-snapshot replacement makes revocation explicit (including
// an empty registry) and allows optimistic concurrency without schema DDL.
// The digest covers version and every declaration, not provider identity.
export function providerRegistrySnapshot(version:unknown,bindings:unknown){
  if(typeof version!=='number'||!Number.isSafeInteger(version)||version<1||
     !Array.isArray(bindings))throw Error('PROVIDER_REGISTRY_INVALID');
  const canonical=parseProviderMappings(JSON.stringify(bindings)).sort((a,b)=>{
    const x=[a.project_id,a.agent_id,a.provider].join('|');
    const y=[b.project_id,b.agent_id,b.provider].join('|');
    return x<y?-1:x>y?1:0;
  });
  const payload={version,bindings:canonical};
  return {...payload,registry_sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
export function verifyProviderRegistrySnapshot(input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).sort().join('|')!=='bindings|registry_sha256|version')
    throw Error('PROVIDER_REGISTRY_INVALID');
  const x=input as Record<string,unknown>;
  const snapshot=providerRegistrySnapshot(x.version,x.bindings);
  if(x.registry_sha256!==snapshot.registry_sha256)throw Error('PROVIDER_REGISTRY_INVALID');
  return snapshot;
}


// Strict local/manual attempt metadata. No prompt, response, remote session
// identifier, provider credential, or unverified token-count is accepted.
export type ProviderAttempt={attempt_id:string;ticket_id:string;agent_id:string;lease_id:string;
  epoch:number;registry_version:number;provider:Provider;binding_sha256:string;
  checkpoint_generation:number;checkpoint_sha256:string;context_sha256:string;
  state:'OPEN'|'INTERRUPTED'|'CLOSED';resolution:'WORKER_CHECKPOINT'|'OWNER_REVIEW'|null};
export function validateProviderAttempt(input:unknown):ProviderAttempt{
  const fail=()=>{throw Error('PROVIDER_ATTEMPT_INVALID');};
  if(!input||typeof input!=='object'||Array.isArray(input))return fail();
  const x=input as Record<string,unknown>;
  const keys='agent_id|attempt_id|binding_sha256|checkpoint_generation|checkpoint_sha256|context_sha256|epoch|lease_id|provider|registry_version|resolution|state|ticket_id';
  if(Object.keys(x).sort().join('|')!==keys)return fail();
  const positive=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
  const hash=(v:unknown)=>typeof v==='string'&&v.length===64&&/^[0-9a-f]{64}$/.test(v);
  if(!exact(x.attempt_id,/^attempt_[a-f0-9]{32}$/)||!exact(x.ticket_id,ID)||
     !exact(x.agent_id,ID)||!exact(x.lease_id,ID)||!positive(x.epoch)||
     !positive(x.registry_version)||!positive(x.checkpoint_generation)||
     !PROVIDERS.includes(x.provider as Provider)||!hash(x.binding_sha256)||
     !hash(x.checkpoint_sha256)||!hash(x.context_sha256)||
     !['OPEN','INTERRUPTED','CLOSED'].includes(x.state as string)||
     (x.state==='CLOSED'?!['WORKER_CHECKPOINT','OWNER_REVIEW'].includes(x.resolution as string):x.resolution!==null))
    return fail();
  return x as ProviderAttempt;
}


// Owner-attested provider display readings, NOT provider API verification.
// Counts are per exact closed attempt, never an inferred token estimate.
export type ProviderUsageReading={ticket_id:string;attempt_id:string;context_sha256:string;
  input_tokens:number;output_tokens:number;cached_input_tokens:number|null;
  evidence_reviewed:true};
export function validateProviderUsageReading(input:unknown):ProviderUsageReading{
  const fail=()=>{throw Error('PROVIDER_USAGE_READING_INVALID');};
  if(!input||typeof input!=='object'||Array.isArray(input))return fail();
  const x=input as Record<string,unknown>;
  const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1000000000&&!Object.is(v,-0);
  if(Object.keys(x).sort().join('|')!=='attempt_id|cached_input_tokens|context_sha256|evidence_reviewed|input_tokens|output_tokens|ticket_id'||
     !exact(x.ticket_id,ID)||!exact(x.attempt_id,/^attempt_[a-f0-9]{32}$/)||
     !exact(x.context_sha256,/^[a-f0-9]{64}$/)||x.evidence_reviewed!==true||
     !count(x.input_tokens)||!count(x.output_tokens)||
     (x.cached_input_tokens!==null&&(!count(x.cached_input_tokens)||x.cached_input_tokens>x.input_tokens)))
    return fail();
  return {ticket_id:x.ticket_id,attempt_id:x.attempt_id,context_sha256:x.context_sha256,
    input_tokens:x.input_tokens,output_tokens:x.output_tokens,cached_input_tokens:x.cached_input_tokens,
    evidence_reviewed:true} as ProviderUsageReading;
}
export function providerUsageRecord(reading:unknown,attempt:unknown){
  const r=validateProviderUsageReading(reading),a=validateProviderAttempt(attempt);
  if(a.state!=='CLOSED'||r.ticket_id!==a.ticket_id||r.attempt_id!==a.attempt_id||r.context_sha256!==a.context_sha256)
    throw Error('PROVIDER_USAGE_ATTEMPT_MISMATCH');
  const payload={...r,provider:a.provider,agent_id:a.agent_id,registry_version:a.registry_version,
    binding_sha256:a.binding_sha256,attempt_epoch:a.epoch,source:'OWNER_ATTESTED_PROVIDER_DISPLAY' as const,
    provider_usage_verified:false as const,quota_verified:false as const,automatic_execution_allowed:false as const};
  return {...payload,usage_sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
export function verifyProviderUsageRecord(input:unknown,attempt:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PROVIDER_USAGE_RECORD_INVALID');
  const x=input as Record<string,unknown>;
  const {ticket_id,attempt_id,context_sha256,input_tokens,output_tokens,cached_input_tokens,evidence_reviewed}=x;
  const expected=providerUsageRecord({ticket_id,attempt_id,context_sha256,input_tokens,output_tokens,cached_input_tokens,evidence_reviewed},attempt);
  if(Object.keys(x).sort().join('|')!==Object.keys(expected).sort().join('|')||
     Object.entries(expected).some(([k,v])=>x[k]!==v))throw Error('PROVIDER_USAGE_RECORD_INVALID');
  return expected;
}
// Bounded ledger fold; validate transitions and immutable metadata before
// aggregating. Missing observations remain unknown, not zero usage.
export function summarizeProviderUsage(ticketId:string,states:unknown[],readings:unknown[]){
  if(!exact(ticketId,ID)||!Array.isArray(states)||states.length>300||!Array.isArray(readings)||readings.length>100)
    throw Error('PROVIDER_USAGE_HISTORY_LIMIT');
  const attempts=new Map<string,ProviderAttempt>();
  let current:string|null=null;
  for(const raw of states){
    const a=validateProviderAttempt(raw),prior=attempts.get(a.attempt_id);
    if(a.ticket_id!==ticketId)throw Error('PROVIDER_USAGE_HISTORY_INVALID');
    if(!prior){
      if(a.state!=='OPEN'||(current!==null&&attempts.get(current)?.state!=='CLOSED'))
        throw Error('PROVIDER_USAGE_HISTORY_INVALID');
      current=a.attempt_id;
    }else{
      const {state,resolution,...identity}=a,{state:oldState,resolution:oldResolution,...oldIdentity}=prior;
      if(current!==a.attempt_id||Object.entries(identity).some(([k,v])=>oldIdentity[k as keyof typeof oldIdentity]!==v)||
         oldState==='CLOSED'||state==='OPEN'||(oldState==='INTERRUPTED'&&state!=='CLOSED'))
        throw Error('PROVIDER_USAGE_HISTORY_INVALID');
    }
    attempts.set(a.attempt_id,a);
  }
  if(attempts.size>100)throw Error('PROVIDER_USAGE_HISTORY_LIMIT');
  const records=new Map<string,ReturnType<typeof providerUsageRecord>>();
  for(const raw of readings){
    if(!raw||typeof raw!=='object')throw Error('PROVIDER_USAGE_RECORD_INVALID');
    const id=(raw as Record<string,unknown>).attempt_id;
    if(typeof id!=='string'||records.has(id)||!attempts.has(id))throw Error('PROVIDER_USAGE_RECORD_INVALID');
    records.set(id,verifyProviderUsageRecord(raw,attempts.get(id)));
  }
  const totals=PROVIDERS.map(provider=>{
    const matching=[...attempts.values()].filter(a=>a.provider===provider);
    const known=matching.flatMap(a=>{const r=records.get(a.attempt_id);return r?[r]:[];});
    return {provider,attempt_count:matching.length,recorded_attempt_count:known.length,
      unknown_attempt_count:matching.length-known.length,
      recorded_input_tokens:known.reduce((n,r)=>n+r.input_tokens,0),
      recorded_output_tokens:known.reduce((n,r)=>n+r.output_tokens,0),
      recorded_cached_input_tokens:known.reduce((n,r)=>n+(r.cached_input_tokens??0),0),
      cached_input_unknown_record_count:known.filter(r=>r.cached_input_tokens===null).length};
  });
  return {ticket_id:ticketId,attempts:[...attempts.values()].map(a=>({attempt_id:a.attempt_id,provider:a.provider,
    state:a.state,context_sha256:a.context_sha256,usage:records.get(a.attempt_id)??null,
    owner_recording_eligible:a.state==='CLOSED'&&!records.has(a.attempt_id)})),totals,
    read_only:true,provider_usage_verified:false,quota_verified:false,automatic_execution_allowed:false};
}
