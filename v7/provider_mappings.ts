/**
 * Owner-declared provider workspace bindings, not provider authentication.
 * Initial read-only deployment configuration; no database migration or
 * external provider requests. Never store credentials, URLs or cookies here.
 */
import {createHash} from 'node:crypto';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const ACCOUNT=/^account_[A-Za-z0-9_-]{3,64}$/;
const WORKSPACE=/^workspace_[A-Za-z0-9_-]{3,96}$/;
const PROVIDERS=['CHATGPT_WEB','GOOGLE_AI_STUDIO'] as const;
type Provider=typeof PROVIDERS[number];
type Binding={project_id:string;agent_id:string;provider:Provider;
  account_ref:string;workspace_ref:string};
const exact=(v:unknown,re:RegExp):v is string=>typeof v==='string'&&re.test(v);
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
