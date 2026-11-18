let key='',timer=null;
const $=id=>document.getElementById(id);
function message(text,error=false){$('message').textContent=text;$('message').className=error?'message error':'message';}
async function request(path,options={}){
  if(!key)throw new Error('Owner API key required');
  const res=await fetch(path,{...options,headers:{authorization:'Bearer '+key,
    ...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})},
    cache:'no-store',credentials:'omit'});
  const out=await res.json();
  if(!res.ok)throw new Error(out.error_code||'HTTP '+res.status);
  return out;
}
function value(id,text){$(id).textContent=text===undefined||text===null?'—':String(text);}
function cell(row,text){const e=document.createElement('td');e.textContent=text===null||text===undefined?'—':String(text);row.append(e);}
function rows(id,values){const body=$(id);body.replaceChildren();for(const row of values){const tr=document.createElement('tr');for(const v of row)cell(tr,v);body.append(tr);}}
function date(raw){if(!raw)return '—';const d=new Date(raw.endsWith('Z')?raw:raw+'Z');return isNaN(d.getTime())?'—':d.toLocaleString();}

let gitRecoverySnapshot=null,gitRecoverySelection=null,gitRecoveryPending=null;
const gitHead=/^[a-f0-9]{40}$/;
function recoveryStatus(text){value('git-recovery-status',text);}
function clearGitRecoveryReview(){
  gitRecoverySelection=null;gitRecoveryPending=null;
  $('git-recovery-ticket').value='';$('git-recovery-expected-head').value='';
  $('git-recovery-epoch').value='';$('git-recovery-confirm-sha').value='';
  $('git-recovery-reason').value='';$('git-recovery-consent').checked=false;
  updateGitRecoveryAction();
}
function updateGitRecoveryAction(){
  const intent=gitRecoveryPending||(
    gitRecoverySelection&&gitRecoverySnapshot&&gitRecoverySnapshot.master_live&&
    gitRecoverySnapshot.phase==='RECOVERING'&&gitRecoverySelection.preflight_eligible
      ?{ticket_id:gitRecoverySelection.ticket_id,
        expected_master_epoch:gitRecoverySnapshot.epoch,
        candidate_head_sha:gitRecoverySelection.candidate_head_sha,
        reason:$('git-recovery-reason').value.trim()}:null);
  const matching=Boolean(intent&&
    $('git-recovery-ticket').value===intent.ticket_id&&
    Number($('git-recovery-epoch').value)===intent.expected_master_epoch&&
    $('git-recovery-expected-head').value===intent.candidate_head_sha&&
    gitHead.test(intent.candidate_head_sha)&&
    $('git-recovery-confirm-sha').value===intent.candidate_head_sha&&
    $('git-recovery-consent').checked&&
    $('git-recovery-reason').value.trim().length>=12&&
    $('git-recovery-reason').value.trim().length<=500&&
    (!gitRecoveryPending||$('git-recovery-reason').value.trim()===gitRecoveryPending.reason));
  $('git-recovery-verify').disabled=!matching||!key;
  $('git-recovery-verify').textContent=gitRecoveryPending
    ?'Retry same recovery request':'Verify exact remote evidence';
}
function chooseGitRecovery(job){
  if(gitRecoveryPending){
    recoveryStatus('A recovery request may have been accepted. Retry the same request or clear it explicitly.');
    return;
  }
  if(!gitRecoverySnapshot||!gitRecoverySnapshot.master_live||
    gitRecoverySnapshot.phase!=='RECOVERING'||!job.preflight_eligible){
    recoveryStatus('Selection blocked: Central has no live RECOVERING Master or matching proof preflight.');
    return;
  }
  gitRecoverySelection=job;
  $('git-recovery-ticket').value=job.ticket_id;
  $('git-recovery-expected-head').value=job.candidate_head_sha;
  $('git-recovery-epoch').value=String(gitRecoverySnapshot.epoch);
  $('git-recovery-confirm-sha').value='';
  $('git-recovery-reason').value='';
  $('git-recovery-consent').checked=false;
  recoveryStatus('Review '+job.ticket_id+' ('+job.repository+' / '+job.branch_name+
    '). Type the exact approved commit SHA and your incident reason.');
  updateGitRecoveryAction();
}
function renderGitRecoveryQueue(data){
  const valid=Boolean(data&&Number.isSafeInteger(data.epoch)&&
    typeof data.phase==='string'&&typeof data.master_live==='boolean'&&
    Array.isArray(data.unresolved_jobs)&&data.unresolved_jobs.length<=300);
  gitRecoverySnapshot=valid?data:null;
  const jobs=valid?data.unresolved_jobs:[];
  value('git-recovery-count',valid
    ?jobs.length+' uncertain job(s) · '+data.phase+' · epoch '+data.epoch
    :'Unavailable — check Central API');
  const body=$('git-recovery-jobs');body.replaceChildren();
  for(const job of jobs){
    const tr=document.createElement('tr');
    cell(tr,job.ticket_id);cell(tr,job.git_state);cell(tr,job.task_status);
    cell(tr,job.publication_epoch);cell(tr,job.candidate_head_sha);
    const reasons=Array.isArray(job.blocking_reasons)?job.blocking_reasons:[];
    const reasonLabel={
      MASTER_NOT_LIVE_OR_APPROVED:'Master lease expired, offline or revoked',
      MASTER_NOT_RECOVERING:'Master is not recovering',
      CLUSTER_PAUSED:'Cluster paused',
      PUBLICATION_NOT_PRIOR_EPOCH:'Not an earlier Master epoch',
      TICKET_NOT_IN_RECOVERY_STATE:'Ticket status not eligible',
      QA_NOT_INDEPENDENT:'Developer cannot approve own work',
      MATCHING_QA_RECEIPT_MISSING:'Original independent QA proof missing',
      LIVE_WORKER_LEASE:'Active worker lease must be fenced',
      INVALID_REMOTE_PROOF_METADATA:'Candidate repository, branch or SHA invalid'
    };
    cell(tr,job.preflight_eligible?'Ready for read-only review':
      'BLOCKED: '+(reasons.length
        ?reasons.map(x=>reasonLabel[x]||'Unknown safety check').join('; ')
        :'Central did not authorize review'));
    const td=document.createElement('td'),b=document.createElement('button');
    b.type='button';b.textContent='Review';
    b.disabled=!job.preflight_eligible||!data.master_live||data.phase!=='RECOVERING'||
      Boolean(gitRecoveryPending);
    b.addEventListener('click',()=>chooseGitRecovery(job));td.append(b);tr.append(td);
    body.append(tr);
  }
  if(!jobs.length){
    const tr=document.createElement('tr');const td=document.createElement('td');
    td.colSpan=7;td.textContent=valid?'No unresolved Git publication jobs.':'Recovery queue unavailable.';
    tr.append(td);body.append(tr);
  }
  if(!gitRecoveryPending){
    const still=gitRecoverySelection&&jobs.find(j=>
      j.ticket_id===gitRecoverySelection.ticket_id&&
      j.candidate_head_sha===gitRecoverySelection.candidate_head_sha&&
      j.preflight_eligible&&data.epoch===Number($('git-recovery-epoch').value));
    if(!still&&gitRecoverySelection){
      clearGitRecoveryReview();
      recoveryStatus('Recovery selection invalidated by new Central state; review again.');
    }else if(still)gitRecoverySelection=still;
  }else{
    recoveryStatus('A prior Owner request may have succeeded even if the queue changed. Use Retry with the same exact fields and request ID, or clear the attempt.');
  }
  updateGitRecoveryAction();
}

async function refresh(){
  const [cluster,projects,tasks,audit]=await Promise.all([
    request('/v7/cluster'),request('/v7/projects'),request('/v7/tasks'),request('/v7/audit')]);
  const c=cluster.cluster;
  // Optional migration-sensitive Owner maintenance surface. Keep the core
  // dashboard readable if the new staging schema is not yet provisioned,
  // but disable planning until the server returns valid authoritative rows.
  let maintenance=null;
  try{maintenance=await request('/v7/owner/maintenance');}catch{}
  const maintenanceReady=Array.isArray(maintenance);
  $('plan-maintenance').disabled=!maintenanceReady;
  $('start-pc-drain').disabled=!maintenanceReady;
  $('finalize-pc-drain').disabled=!maintenanceReady;
  $('cancel-maintenance').disabled=!maintenanceReady;
  value('maintenanceCount',maintenanceReady?
    maintenance.length+' records':'Unavailable — schema/health review required');
  rows('maintenance-plans',maintenanceReady?maintenance.map(p=>[
    p.plan_id,p.node_id,p.wave_id,
    p.state+(Number(p.fence_active)===1?' / OWNER RELEASE REQUIRED':''),
    p.expected_epoch,
    Number(p.fence_active)===1?'DURABLE FENCE — no automatic expiry':date(p.expires_at)]):[]);
  // Optional read-only Owner queue. Fail closed if API/schema is unavailable.
  let gitRecovery=null;
  try{gitRecovery=await request('/v7/owner/git-recovery');}catch{}
  renderGitRecoveryQueue(gitRecovery);
  $('maintenance-epoch').value=String(c.epoch);
  value('master',c.master_agent_id||'No Master');value('epoch',c.epoch);
  value('phase',c.phase);value('backup1',c.backup1||'None');value('backup2','Backup 2: '+(c.backup2||'None'));
  value('paused',Number(c.paused)?'PAUSED':'RUNNING');
  value('lease','Lease to: '+date(c.lease_until));
  if(c.elected_at){const seconds=Math.max(0,Math.floor((Date.now()-new Date(c.elected_at+'Z').getTime())/1000));
    value('tenure','Elected '+date(c.elected_at)+' · '+Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m');}
  else value('tenure','Fresh cluster / awaiting candidate');
  value('agentCount',cluster.agents.length+' agents');
  rows('agents',cluster.agents.map(a=>[a.agent_id,a.node_id,a.state+' / '+a.node_state,
    a.last_seen?'Seen '+date(a.last_seen):'Not yet heard']));
  value('projectCount',projects.length+' projects');rows('projects',projects.map(p=>[p.display_name,p.repository,p.status]));
  value('taskCount',tasks.length+' tasks');rows('tasks',tasks.map(t=>[t.ticket_id,t.worker_agent_id,t.status,t.version]));
  value('auditCount',audit.length+' recent');rows('audit',audit.map(a=>[date(a.created_at),a.event_type,a.actor]));
  value('connection','Authenticated · live');$('dashboard').hidden=false;
}
$('connect').onclick=async()=>{clearGitRecoveryReview();key=$('key').value;$('key').value='';try{await refresh();message('Authenticated. Data refreshed.');}
  catch(e){key='';$('dashboard').hidden=true;value('connection','Disconnected');message(e.message,true);}
  if(timer)clearInterval(timer);
  if(key)timer=setInterval(()=>refresh().catch(e=>message(e.message,true)),20000);
};
$('disconnect').onclick=()=>{key='';clearGitRecoveryReview();gitRecoverySnapshot=null;$('dashboard').hidden=true;value('connection','Disconnected');
  if(timer)clearInterval(timer);message('Disconnected. Credentials cleared from memory.');};
$('refresh').onclick=()=>refresh().catch(e=>message(e.message,true));
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',async()=>{
  const command=button.dataset.command;
  const payload={};
  if(command.endsWith('_NODE'))payload.node_id=$('node-id').value.trim();
  if(command.endsWith('_AGENT')){payload.agent_id=$('agent-id').value.trim();
    payload.master_eligible=$('eligible').checked;payload.qa_eligible=$('qa').checked;}
  if(command==='GRANT_PROJECT_AGENT'||command==='REVOKE_PROJECT_AGENT'){
    payload.project_id=$('access-project-id').value.trim();
    payload.agent_id=$('access-agent-id').value.trim();
    payload.can_develop=$('can-develop').checked;payload.can_qa=$('can-qa').checked;
  }
  if(command==='CREATE_PROJECT'){payload.project_id=$('project-id').value.trim();
    payload.display_name=$('project-name').value.trim();payload.repository=$('repository').value.trim();}
  if(command.endsWith('_PROPOSAL'))payload.proposal_id=$('proposal-id').value.trim();
  if(!confirm('Confirm owner command: '+command+'?'))return;
  try{
    const body={command,request_id:'web_'+crypto.randomUUID().replaceAll('-',''),payload};
    const result=await request('/v7/owner/command',{method:'POST',body:JSON.stringify(body)});
    message('Accepted receipt '+result.receipt_id);await refresh();
  }catch(e){message(e.message,true);}
}));

const maintId=/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
$('plan-maintenance').onclick=async()=>{
  const node_id=$('maintenance-node-id').value.trim();
  const wave_id=$('maintenance-wave').value.trim();
  const target_version=$('maintenance-version').value.trim();
  const offer_sha256=$('maintenance-offer-sha').value.trim();
  const expected_epoch=Number($('maintenance-epoch').value);
  if(!/^node_[0-9a-f]{32}$/.test(node_id)||
    !/^wave_[a-z0-9][a-z0-9_-]{2,59}$/.test(wave_id)||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(target_version)||
    !/^[0-9a-f]{64}$/.test(offer_sha256)||
    !Number.isSafeInteger(expected_epoch)||expected_epoch<1){
    message('Provide exact node ID, wave, stable version, Owner-signed offer SHA and current epoch.',true);
    return;
  }
  if(!confirm('Record a 5-minute OWNER MAINTENANCE INTENT for '+node_id+
    '? This does NOT authorize or run an installer.'))return;
  const plan_id='plan_'+crypto.randomUUID().replaceAll('-','');
  try{
    const result=await request('/v7/owner/command',{method:'POST',
      body:JSON.stringify({request_id:'maint_'+crypto.randomUUID().replaceAll('-',''),
        command:'PLAN_PC_UPDATE',
        payload:{plan_id,node_id,wave_id,target_version,offer_sha256,expected_epoch}})});
    message('INTENT ONLY recorded: '+result.state.plan_id+
      '. Installer execution NOT approved. Expires in 5 minutes.');
    $('maintenance-cancel-id').value=result.state.plan_id;
    await refresh();
  }catch(e){message('Maintenance plan BLOCKED: '+e.message,true);}
};
async function submitDrain(command,label){
  const plan_id=$('maintenance-drain-id').value.trim();
  if(!maintId.test(plan_id)){message('Valid exact plan ID required to manage drain.',true);return;}
  const description=command==='START_PC_DRAIN'?
    'start a durable fence blocking NEW tasks (existing work continues)':
    'mark this PC DRAINED only after Central verifies no unfinished work';
  if(!confirm('Owner confirmation: '+description+' for '+plan_id+
    '? This does NOT authorize an installer.'))return;
  try{
    const response=await request('/v7/owner/command',{method:'POST',
      body:JSON.stringify({request_id:'drain_'+crypto.randomUUID().replaceAll('-',''),
        command,payload:{plan_id}})});
    message(label+': '+response.state.state+'. Installer execution still NOT approved.');
    $('maintenance-cancel-id').value=plan_id;
    await refresh();
  }catch(e){message(label+' BLOCKED: '+e.message,true);}
}
$('start-pc-drain').onclick=()=>submitDrain('START_PC_DRAIN','Durable fence');
$('finalize-pc-drain').onclick=()=>submitDrain('FINALIZE_PC_DRAIN','Drain validation');

$('cancel-maintenance').onclick=async()=>{
  const plan_id=$('maintenance-cancel-id').value.trim();
  if(!maintId.test(plan_id)){message('Valid exact plan ID required to cancel.',true);return;}
  if(!confirm('RELEASE Owner maintenance fence for '+plan_id+
    '? New task claims and leader candidacy may resume immediately. Do not release'+
    ' if any real PC maintenance is underway. This does NOT install software.'))return;
  try{
    await request('/v7/owner/command',{method:'POST',
      body:JSON.stringify({request_id:'maint_'+crypto.randomUUID().replaceAll('-',''),
        command:'CANCEL_PC_UPDATE',payload:{plan_id}})});
    message('Maintenance plan cancelled and any durable task fence RELEASED.'+
      ' New work may resume. No installer or agent was operated.');
    await refresh();
  }catch(e){message('Cancellation failed: '+e.message,true);}
};

async function gitOperation(pathname){
  const ticket_id=$('git-ticket-id').value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(ticket_id)){message('Valid ticket ID required',true);return;}
  if(!confirm('Perform Owner-authorized Git verification for '+ticket_id+'? This will never merge main.'))return;
  try{
    const body={request_id:'git_'+crypto.randomUUID().replaceAll('-',''),ticket_id};
    const response=await request(pathname,{method:'POST',body:JSON.stringify(body)});
    message('Git operation accepted: '+JSON.stringify(response).slice(0,600));
    await refresh();
  }catch(e){message(e.message,true);}
}
$('draft-pr').onclick=()=>gitOperation('/v7/git/pr-draft');
$('verify-merge').onclick=()=>gitOperation('/v7/tasks/verify-merge');


for(const id of ['git-recovery-confirm-sha','git-recovery-reason']){
  $(id).addEventListener('input',updateGitRecoveryAction);
}
$('git-recovery-consent').addEventListener('change',updateGitRecoveryAction);
$('git-recovery-clear').onclick=()=>{
  clearGitRecoveryReview();
  recoveryStatus('Review cleared locally. This does NOT revoke a Central receipt or retry a Git push.');
  refresh().catch(e=>message(e.message,true));
};
$('git-recovery-verify').onclick=async()=>{
  updateGitRecoveryAction();
  if($('git-recovery-verify').disabled)return;
  const intent=gitRecoveryPending||{
    request_id:'gitrecover_'+crypto.randomUUID().replaceAll('-',''),
    ticket_id:gitRecoverySelection.ticket_id,
    expected_master_epoch:gitRecoverySnapshot.epoch,
    candidate_head_sha:gitRecoverySelection.candidate_head_sha,
    reason:$('git-recovery-reason').value.trim(),
    owner_confirmed_readonly_proof:true
  };
  if(!confirm('Owner review only: verify exact GitHub HEAD '+intent.candidate_head_sha+
    ' for ticket '+intent.ticket_id+' against Central QA evidence? This performs READ-ONLY GitHub requests and no push or merge.'))return;
  // Keep this exact request ID in tab memory after any unknown network outcome.
  // It is intentionally not persisted in localStorage/cookies or a URL.
  gitRecoveryPending=intent;
  updateGitRecoveryAction();
  recoveryStatus('Checking read-only remote evidence. Do not run a Git push or task retry.');
  try{
    const result=await request('/v7/git/recover-remote-proof',{
      method:'POST',body:JSON.stringify({
        request_id:intent.request_id,ticket_id:intent.ticket_id,
        expected_master_epoch:intent.expected_master_epoch,
        reason:intent.reason,owner_confirmed_readonly_proof:true
      })});
    if(!result.accepted||result.ticket_id!==intent.ticket_id||
      result.remote_head_sha!==intent.candidate_head_sha||
      result.merge_performed!==false||result.automatic_retry_allowed!==false)
      throw new Error('UNEXPECTED_RECOVERY_RECEIPT_REVIEW_REQUIRED');
    clearGitRecoveryReview();
    recoveryStatus('Exact remote commit verified for '+intent.ticket_id+
      '; Git job confirmed, NO push or merge. Independent merge verification remains required.');
    await refresh();
  }catch(e){
    recoveryStatus('Recovery not confirmed: '+e.message+
      '. Retry with the same fields and request ID if the response was lost. Never repush based on this failure.');
    message('Git recovery not confirmed: '+e.message,true);
    updateGitRecoveryAction();
  }
};
