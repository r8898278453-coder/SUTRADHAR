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
$('connect').onclick=async()=>{key=$('key').value;$('key').value='';try{await refresh();message('Authenticated. Data refreshed.');}
  catch(e){key='';$('dashboard').hidden=true;value('connection','Disconnected');message(e.message,true);}
  if(timer)clearInterval(timer);
  if(key)timer=setInterval(()=>refresh().catch(e=>message(e.message,true)),20000);
};
$('disconnect').onclick=()=>{key='';$('dashboard').hidden=true;value('connection','Disconnected');
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
