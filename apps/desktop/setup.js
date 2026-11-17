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
      ['Enrollment request',s.enrollmentState==='SUBMITTED'?
        'Submitted to Central; Owner approval may still be pending':
        s.enrollmentState==='OWNER_REVIEW_REQUIRED'?'BLOCKED — Owner must review identity/receipt':
        s.enrollmentState==='PREPARED'?'Submission uncertain — Owner review required':
        'Not yet submitted'],
      ['Enrollment recovery issue',s.enrollmentError||'None reported'],
      ['Local process',s.agentProcessRunning?'Running':'Not running'],
      ['Maintenance recovery hold',s.maintenanceHold||'NONE'],
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
    get('reconcileEnrollment').disabled=!['PREPARED','OWNER_REVIEW_REQUIRED'].includes(s.enrollmentState);
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
      'Verified offline for '+receipt.nodeId+' in '+receipt.waveId+
      ': '+receipt.version+'. '+(receipt.alreadyInspected?
      'Previously inspected signed receipt revalidated.':
      'New node-signed local inspection receipt saved.')+
      ' Installer NOT executed. Seek separate Owner approval.';
  }catch(e){get('updateFeedback').textContent='Update blocked: '+String(e.message||e);}
  finally{button.disabled=false;}
});
get('updateReadiness').addEventListener('click',async()=>{
  const button=get('updateReadiness');
  button.disabled=true;
  get('updateFeedback').textContent='Checking live Central membership and Master/backup roles…';
  try{
    const r=await api.checkUpdateReadiness();
    get('updateFeedback').textContent=
      'Signed Central check: '+r.node_id+' is non-critical at this moment'+
      ' (epoch '+r.epoch+'). '+(r.owner_intent_present?
        'Active 5-minute Owner intent '+r.owner_intent_id+' ('+r.owner_intent_wave_id+').':
        'NO active Owner maintenance intent is recorded.')+
      ' Roles can change immediately. NO installer will run.'+
      ' Owner approval and fresh physical checks are still required.';
  }catch(e){
    get('updateFeedback').textContent='Maintenance BLOCKED: '+String(e.message||e)+
      '. Do not stop the Master, backups or an unverified PC.';
  }finally{button.disabled=false;}
});
get('isolatePc').addEventListener('click',async()=>{
  const button=get('isolatePc');button.disabled=true;
  get('updateFeedback').textContent='Checking signed Owner drain and local agent safety…';
  try{
    const result=await api.isolateDrainedPc();
    get('updateFeedback').textContent=result.canceled?'Isolation canceled. No local hold created.':
      'Persistent recovery hold created for '+result.node_id+
      '. Local agent '+(result.agent_stopped?
        'stop confirmed ('+result.exit_confirmed_by+').':
        'STOP NOT CONFIRMED ('+result.exit_confirmed_by+'); Owner review required.')+
      ' No installer executed. Ask Owner for recovery instructions.';
    await loadStatus();
  }catch(err){get('updateFeedback').textContent=
    'Isolation BLOCKED: '+String(err.message||err)+
    '. Do not manually delete identity or maintenance hold.';}
  finally{button.disabled=false;}
});
get('checkRecovery').addEventListener('click',async()=>{
  const button=get('checkRecovery');button.disabled=true;
  get('updateFeedback').textContent='Verifying signed cancellation of the exact held maintenance plan…';
  try{
    const result=await api.checkMaintenanceRecovery();
    get('updateFeedback').textContent='Owner cancellation verified for '+result.plan_id+
      ' on '+result.node_id+'. LOCAL HOLD STILL ACTIVE. No agent restart or installer execution is authorized. Owner-assisted recovery is required.';
    await loadStatus();
  }catch(e){get('updateFeedback').textContent='Recovery BLOCKED: '+
    String(e.message||e)+'. Keep the local hold and contact Owner.';}
  finally{button.disabled=false;}
});
get('releaseHold').addEventListener('click',async()=>{
  const button=get('releaseHold');button.disabled=true;
  get('updateFeedback').textContent='Checking Owner-signed release grant and live cancellation…';
  try{
    const result=await api.releaseMaintenanceHold();
    get('updateFeedback').textContent=result.canceled?'Release canceled.':
      'Owner release archived for '+result.node_id+
      '. Agent NOT restarted. Separate reconciliation required; do not delete the audit receipt.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='Release BLOCKED: '+String(e.message||e)+
      '. Keep existing recovery records for Owner review.';
  }finally{button.disabled=false;}
});
get('reconcileEnrollment').addEventListener('click',async()=>{
  const button=get('reconcileEnrollment');button.disabled=true;
  showFeedback('Checking this same OS-vault identity against Owner-approved Central (read-only)…');
  try{
    const status=await api.reconcileEnrollment();
    showFeedback(status.enrollmentRequested?
      'Existing PC identity confirmed approved by Central. No new enrollment code used.':
      'Recovery has not been confirmed by Central.');
  }catch(e){showFeedback('Recovery blocked: '+String(e.message||e)+
    '. Ask the Owner to inspect this exact PC identity; do not delete its vault.');}
  finally{await loadStatus();}
});
get('refresh').addEventListener('click',loadStatus);
get('dashboard').addEventListener('click',async()=>{try{await api.openDashboard();}catch(e){showFeedback(String(e.message||e));}});
get('chatgpt').addEventListener('click',async()=>{try{await api.openProvider('chatgpt');}catch(e){showFeedback(String(e.message||e));}});
get('studio').addEventListener('click',async()=>{try{await api.openProvider('ai_studio');}catch(e){showFeedback(String(e.message||e));}});
loadStatus();
// The status panel observes local signed-ack receipts; it does not declare success from a running process.
setInterval(loadStatus,15000);
