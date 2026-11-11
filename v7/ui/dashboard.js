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
