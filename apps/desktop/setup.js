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
      ['Device key storage',s.signingStatus||'OS vault unavailable'],
      ['Production release','Not accepted; signed installer and physical vault test pending']
    ];
    for(const [label,value] of entries){
      const k=document.createElement('span');k.textContent=label;
      const v=document.createElement('strong');v.textContent=value;
      grid.append(k,v);
    }
    get('status').replaceChildren(grid);
    get('dashboard').disabled=!s.configured;
    get('autostart').disabled=!s.startupSupported;
    get('autostart').checked=Boolean(s.startupEnabled);
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
get('autostart').addEventListener('change',async e=>{
  const checkbox=e.target;checkbox.disabled=true;
  try{
    await api.setStartup(Boolean(checkbox.checked));
    showFeedback('Login auto-start preference updated locally. Physical installer/startup acceptance is still pending.');
  }catch(error){showFeedback(String(error.message||error));}
  await loadStatus();
});
get('verifyUpdate').addEventListener('click',async()=>{
  const button=get('verifyUpdate');
  button.disabled=true;
  get('updateFeedback').textContent='Checking pinned Owner signature and Windows installer…';
  try{
    const receipt=await api.verifyLocalUpdate();
    get('updateFeedback').textContent=receipt.canceled?'No file selected':
      'Verified offline: '+receipt.version+'. Installer NOT executed. Seek separate Owner approval.';
  }catch(e){get('updateFeedback').textContent='Update blocked: '+String(e.message||e);}
  finally{button.disabled=false;}
});
get('refresh').addEventListener('click',loadStatus);
get('dashboard').addEventListener('click',async()=>{try{await api.openDashboard();}catch(e){showFeedback(String(e.message||e));}});
get('chatgpt').addEventListener('click',async()=>{try{await api.openProvider('chatgpt');}catch(e){showFeedback(String(e.message||e));}});
get('studio').addEventListener('click',async()=>{try{await api.openProvider('ai_studio');}catch(e){showFeedback(String(e.message||e));}});
loadStatus();
// The status panel observes local signed-ack receipts; it does not declare success from a running process.
setInterval(loadStatus,15000);
