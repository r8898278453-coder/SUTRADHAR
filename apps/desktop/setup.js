'use strict';
const api=window.sutradharDesktop;
const get=id=>document.getElementById(id);
function showFeedback(message){get('feedback').textContent=message;}
async function loadStatus(){
  try{
    const s=await api.getStatus();
    if(s.configured){
      get('central').value=s.centralUrl;
      get('pcName').value=s.pcName;
      get('agentCount').value=String(s.agentIds.length);
      for(const id of ['central','pcName','agentCount'])get(id).disabled=true;
    }
    const grid=document.createElement('div');grid.className='status-grid';
    const entries=[
      ['Central',s.centralUrl||'Not configured'],
      ['PC',s.pcName||'Not configured'],
      ['Node ID',s.nodeId||'Not created'],
      ['Agent IDs',(s.agentIds||[]).join(', ')||'Not created'],
      ['Enrollment request',s.enrollmentRequested?'Submitted to Central; Owner approval may still be pending':'Not confirmed'],
      ['Local process',s.agentProcessRunning?'Running':'Not running'],
      ['Central acknowledgment',s.centralReport?.acknowledgedNow?
        'Agent reports heartbeat accepted by Central (verify in Owner dashboard)' :
        'Not currently acknowledged — pending approval / offline / error'],
      ['Last accepted heartbeat',s.centralReport?.lastAcceptedAt||'Not yet accepted'],
      ['Last Central error',s.centralReport?.errorCode||'None reported'],
      ['Master recovery phase',s.centralReport?.phase||'Not yet confirmed'],
      ['Security phase','Alpha: OS credential vault and signed installer pending']
    ];
    for(const [label,value] of entries){
      const k=document.createElement('span');k.textContent=label;
      const v=document.createElement('strong');v.textContent=value;
      grid.append(k,v);
    }
    get('status').replaceChildren(grid);
    get('dashboard').disabled=!s.configured;
    if(s.enrollmentRequested){get('code').value='';get('code').placeholder='Already enrolled; code not required for later starts';}
  }catch(e){get('status').textContent='Could not read local status: '+String(e.message||e);}
}
get('setupForm').addEventListener('submit',async e=>{
  e.preventDefault();get('save').disabled=true;showFeedback('Checking Central and starting the local agent…');
  try{
    const result=await api.saveSetup({
      centralUrl:get('central').value,pcName:get('pcName').value,
      agentCount:Number(get('agentCount').value),enrollmentCode:get('code').value
    });
    get('code').value='';
    showFeedback('Local setup submitted. Ask the Owner to APPROVE the PC and its agent IDs in Central. The agent will report status every 60 seconds once approved.');
    await loadStatus();
  }catch(err){showFeedback(String(err?.message||err));}
  finally{get('save').disabled=false;}
});
get('refresh').addEventListener('click',loadStatus);
get('dashboard').addEventListener('click',async()=>{try{await api.openDashboard();}catch(e){showFeedback(String(e.message||e));}});
get('chatgpt').addEventListener('click',async()=>{try{await api.openProvider('chatgpt');}catch(e){showFeedback(String(e.message||e));}});
get('studio').addEventListener('click',async()=>{try{await api.openProvider('ai_studio');}catch(e){showFeedback(String(e.message||e));}});
loadStatus();
// The status panel observes local signed-ack receipts; it does not declare success from a running process.
setInterval(loadStatus,15000);
