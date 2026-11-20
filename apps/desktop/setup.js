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
      ['Installer preparation',s.installerPreparation||'NONE'],
      ['Installer execution',s.installerExecution||'NOT_ATTEMPTED'],
      ['Direct installer exit',s.directInstallerExit||'NOT_OBSERVED'],
      ['Persistent process observer',s.persistentObserver||'NO_WITNESS_OUTCOME_UNKNOWN'],
      ['Post-install observation',s.postInstallObservation||'NOT_RECORDED'],
      ['Failed install review',s.failedInstallReview||'NOT_RECORDED'],
      ['Owner recovery investigation',s.failedRecoveryApproval||'NOT_RECORDED'],
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
    const select=get('workerAgent'),before=select.value;
    select.replaceChildren();
    for(const id of (s.agentIds||[])){
      const option=document.createElement('option');
      option.value=id;option.textContent=id;select.append(option);
    }
    if((s.agentIds||[]).includes(before))select.value=before;
    const approvedReadOnly=Boolean(s.workerClaimSupported&&s.agentProcessRunning&&
      s.centralReport?.acknowledgedNow&&s.maintenanceHold==='NONE'&&
      s.enrollmentState==='SUBMITTED');
    select.disabled=!approvedReadOnly;
    get('workerList').disabled=!approvedReadOnly;
    get('workerDetail').disabled=!approvedReadOnly;
    get('workerClaim').disabled=!approvedReadOnly;
    get('workerResume').disabled=!approvedReadOnly;
    get('workerCheckpoint').disabled=!approvedReadOnly;
    get('workerRenew').disabled=!approvedReadOnly;
    get('workerSubmit').disabled=!approvedReadOnly;
    get('workerExport').disabled=!approvedReadOnly;
    get('workerQAInspect').disabled=!approvedReadOnly;
    get('workerQARun').disabled=!approvedReadOnly||!s.qaRunnerConfigured;
    get('workerQAAttest').disabled=!approvedReadOnly;
    get('workerQAUpload').disabled=!approvedReadOnly;
    get('workerQAReceipt').disabled=!approvedReadOnly;

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
get('approveFailedInstallReview').addEventListener('click',async()=>{
  const button=get('approveFailedInstallReview');button.disabled=true;
  get('updateFeedback').textContent='Verifying independent Owner review grant, device-signed failed-install evidence, Central cancellation and cluster readiness…';
  try{
    const result=await api.approveFailedInstallReview();
    get('updateFeedback').textContent=result.canceled?'Owner investigation canceled.':
      'Signed incident review recorded for '+result.node_id+
      '. PC STILL ISOLATED. No hold release, installer retry, rollback or agent restart authorized.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='OWNER REVIEW BLOCKED: '+String(e.message||e)+
      '. Keep all diagnostic records and the local hold for manual investigation.';
  }finally{button.disabled=false;}
});
get('reviewFailedInstall').addEventListener('click',async()=>{
  const button=get('reviewFailedInstall');button.disabled=true;
  get('updateFeedback').textContent='Checking old installed version, protected device identity and Central maintenance…';
  try{
    const r=await api.reviewFailedInstall();
    get('updateFeedback').textContent=r.canceled?
      'Diagnostic canceled. No files changed.':
      'Owner diagnostic recorded for '+r.node_id+': '+r.state+
      '. Installer result remains UNKNOWN. Original hold ACTIVE. No automatic rollback, release or retry allowed.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='DIAGNOSTIC BLOCKED: '+
      String(e.message||e)+'. Preserve all journals and contact Owner.';
  }finally{button.disabled=false;}
});
get('observePostInstall').addEventListener('click',async()=>{
  const button=get('observePostInstall');button.disabled=true;
  get('updateFeedback').textContent='Verifying signed installer launch, current Desktop signature/version, OS-vault identity and Central maintenance…';
  try{
    const r=await api.observePostInstall();
    get('updateFeedback').textContent='Target '+r.observed_version+
      ', same device identity and Central DRAINED fence OBSERVED for '+r.node_id+
      '. Windows installer completion is NOT proven. The local hold remains active; Owner cancellation and separately signed hold release are still required.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='POST-INSTALL VERIFICATION BLOCKED: '+
      String(e.message||e)+'. Keep the hold and all execution receipts. Owner recovery review required.';
  }finally{button.disabled=false;}
});
get('inspectPostUpdateIdentity').addEventListener('click',async()=>{
  const button=get('inspectPostUpdateIdentity');button.disabled=true;
  get('updateFeedback').textContent='Checking device public-key and agent identity against staged baseline…';
  try{
    const r=await api.inspectPostUpdateIdentity();
    get('updateFeedback').textContent='Identity fingerprint and agent IDs unchanged for '+r.node_id+
      '. Installed version observed '+r.observed_version+
      ', staged target '+r.target_version+
      (r.version_matches_target?' (version matches).':' (version NOT matched).')+
      ' This does NOT prove installer execution or Central reconciliation.';
  }catch(e){get('updateFeedback').textContent='Identity continuity BLOCKED: '+
    String(e.message||e)+'. Preserve local identity and call Owner.';}
  finally{button.disabled=false;}
});
get('inspectPersistentInstallerObserver').addEventListener('click',async()=>{
  const button=get('inspectPersistentInstallerObserver');button.disabled=true;
  get('updateFeedback').textContent='Checking enrolled identity, signed launch and unsigned process-liveness witness…';
  try{
    const r=await api.inspectPersistentInstallerObserver();
    get('updateFeedback').textContent=r.available?
      'Persistent observer reports '+r.state+
      '. UNSIGNED / UNTRUSTED diagnostic only; exit code UNKNOWN and Windows setup completion UNPROVEN. Maintenance hold and manual Owner checks remain required.':
      'No persistent observer witness. Outcome UNKNOWN. Preserve maintenance hold and signed installer receipts.';
  }catch(e){
    get('updateFeedback').textContent='OBSERVER INSPECTION BLOCKED: '+
      String(e.message||e)+'. Do not delete any maintenance journal.';
  }finally{button.disabled=false;}
});
get('inspectDirectInstallerExit').addEventListener('click',async()=>{
  const button=get('inspectDirectInstallerExit');button.disabled=true;
  get('updateFeedback').textContent='Verifying device-signed launch chain and any direct installer exit observation…';
  try{
    const v=await api.inspectDirectInstallerExit();
    get('updateFeedback').textContent=v.observed?
      'DIRECT installer process exit observed. Code: '+
      String(v.direct_process_exit_code===null?'unknown':v.direct_process_exit_code)+
      ', signal: '+String(v.direct_process_exit_signal||'none')+
      '. NSIS/UAC completion and successful installation remain UNPROVEN. Hold and automatic retry are blocked.':
      'No direct process exit record is available. Outcome UNKNOWN. Do not infer success/failure or delete the hold.';
  }catch(e){
    get('updateFeedback').textContent='EXIT INSPECTION BLOCKED: '+
      String(e.message||e)+'. Preserve original installer receipts for Owner review.';
  }finally{button.disabled=false;}
});
get('launchStagedInstaller').addEventListener('click',async()=>{
  const button=get('launchStagedInstaller');button.disabled=true;
  get('updateFeedback').textContent='Checking separate Owner execution grant, staged Authenticode, Central DRAINED state and local identity…';
  try{
    const r=await api.launchStagedInstaller();
    get('updateFeedback').textContent=r.canceled?'Installer launch canceled.':
      'Windows '+r.kind+' installer process launched for '+r.node_id+
      '. INSTALL RESULT UNKNOWN. SUTRADHAR will exit. Finish Windows prompts, then check identity, version and Central recovery. No automatic retry.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='Execution BLOCKED: '+String(e.message||e)+
      '. Preserve all journals and the maintenance hold; Owner review required.';
  }finally{button.disabled=false;}
});
get('prepareInstaller').addEventListener('click',async()=>{
  const button=get('prepareInstaller');button.disabled=true;
  get('updateFeedback').textContent='Verifying Owner DRAINED fence, signed offer, Windows publisher and identity…';
  try{
    const result=await api.prepareInstaller();
    get('updateFeedback').textContent=result.canceled?'Preparation canceled. No files staged.':
      'Signed '+result.kind+' installer staged for '+result.node_id+
      ' ('+result.target_version+'). Local identity fingerprint recorded; installer NOT executed. Owner-assisted next step only.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='Staging BLOCKED: '+String(e.message||e)+
      '. Do not delete recovery hold or preparation receipts.';
  }finally{button.disabled=false;}
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
get('restartAfterMaintenance').addEventListener('click',async()=>{
  const button=get('restartAfterMaintenance');button.disabled=true;
  get('updateFeedback').textContent='Verifying one-time Owner grant, fresh Central state and new agent heartbeat…';
  try{
    const result=await api.restartAfterMaintenance();
    get('updateFeedback').textContent=result.canceled?'Manual restart canceled.':
      'Central recovery reconciliation observed for '+result.node_id+
      ' (epoch '+result.epoch+'). Auto-restart is STILL blocked. No installer executed.';
    await loadStatus();
  }catch(e){
    get('updateFeedback').textContent='Manual recovery BLOCKED: '+
      String(e.message||e)+
      '. Do not delete restart attempt or maintenance audit files. Owner review required.';
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


get('workerList').addEventListener('click',async()=>{
  const button=get('workerList');button.disabled=true;
  const output=get('workerTasks');
  output.textContent='Requesting signed, read-only task list from Central…';
  try{
    const reply=await api.inspectWorkerTasks(get('workerAgent').value,null);
    output.textContent=reply.tasks.length?
      JSON.stringify(reply.tasks,null,2):
      'No currently READY tasks are assigned to this agent. Ask the Owner to check project access.';
  }catch(error){output.textContent='Read-only inspection blocked: '+String(error?.message||error);}
  finally{await loadStatus();}
});
get('workerDetail').addEventListener('click',async()=>{
  const button=get('workerDetail');button.disabled=true;
  const output=get('workerTasks'),ticket=get('workerTicket').value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(ticket)){
    output.textContent='Enter an exact Central task ID (letters, numbers, underscores or hyphens).';
    await loadStatus();return;
  }
  output.textContent='Requesting signed, read-only ticket details…';
  try{
    const reply=await api.inspectWorkerTasks(get('workerAgent').value,ticket);
    output.textContent=JSON.stringify(reply.task,null,2);
  }catch(error){output.textContent='Read-only inspection blocked: '+String(error?.message||error);}
  finally{await loadStatus();}
});

function exactWorkerTicket(){
  const ticket=get('workerTicket').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(ticket))
    throw Error('Enter an exact ticket ID before claiming or verifying the lease.');
  return ticket;
}
get('workerClaim').addEventListener('click',async()=>{
  const button=get('workerClaim');button.disabled=true;
  const output=get('workerTasks');
  try{
    const ticket=exactWorkerTicket(),agent=get('workerAgent').value;
    output.textContent='Choose your already-trusted local Git checkout. You must confirm before any task is claimed.';
    const r=await api.claimWorkerTask(agent,ticket);
    output.textContent=r.canceled?
      'Canceled. No new claim request was sent.':
      'Central accepted task '+r.ticket_id+' for '+r.agent_id+
      '. Isolated worktree: '+r.worktree+
      '. Live lease verified; no AI, QA or Git push started. Claim must be checkpointed or renewed within Central limits.';
  }catch(error){
    output.textContent='Claim/recovery blocked: '+String(error?.message||error)+
      '. Preserve any local worktree and pending journal. Retry only the same ticket, agent and trusted checkout if the Master epoch has not changed; otherwise ask Owner to reconcile.';
  }finally{await loadStatus();}
});
get('workerResume').addEventListener('click',async()=>{
  const button=get('workerResume');button.disabled=true;
  const output=get('workerTasks');
  try{
    const r=await api.resumeWorkerTask(get('workerAgent').value,exactWorkerTicket());
    output.textContent='Original work lease is live for '+r.agent_id+' / '+r.ticket_id+
      ' (status '+r.status+'). Local branch: '+r.worktree+
      '. This is a read-only continuity check; does not renew, run code or publish.';
  }catch(error){
    output.textContent='Signed lease verification blocked: '+String(error?.message||error)+
      '. Do not use an expired/unknown task lease; contact Owner if recovery is uncertain.';
  }finally{await loadStatus();}
});

get('workerCheckpoint').addEventListener('click',async()=>{
  const button=get('workerCheckpoint'),output=get('workerTasks');
  button.disabled=true;
  try{
    const ticket=exactWorkerTicket(),agent=get('workerAgent').value;
    const summary=get('workerSummary').value,next=get('workerNextAction').value;
    if(!summary.trim()||summary.length>8000||!next.trim()||next.length>500)
      throw Error('Describe completed work and next action; do not include secrets.');
    output.textContent='Checking current Master, original lease and local Git checkout…';
    const r=await api.checkpointWorkerTask(agent,ticket,summary,next);
    output.textContent=r.canceled?'Canceled; no new checkpoint sent.':
      'Checkpoint generation '+r.checkpoint_generation+' verified by Central for '+
      ticket+'. Lease remains bounded. No QA, Git push or automatic coding was started.'+
      (r.replayed?' Original pending request replayed.':'');
  }catch(error){
    output.textContent='Checkpoint blocked: '+String(error?.message||error)+
      '. Preserve any pending progress journal; repeat identical summary and next action only if the original lease is still valid. Otherwise ask Owner to reconcile.';
  }finally{await loadStatus();}
});
get('workerRenew').addEventListener('click',async()=>{
  const button=get('workerRenew'),output=get('workerTasks');
  button.disabled=true;
  try{
    const ticket=exactWorkerTicket(),agent=get('workerAgent').value;
    const reason=get('workerRenewReason').value;
    if(reason.trim()!==reason||reason.length<12||reason.length>300)
      throw Error('Enter a 12–300 character progress/recovery reason.');
    output.textContent='Checking approved Master and the current worker lease…';
    const r=await api.renewWorkerLease(agent,ticket,reason);
    output.textContent=r.canceled?'Canceled; no renewal requested.':
      'Central verified bounded lease extension for '+ticket+
      '. Remaining lease: '+r.lease_seconds_remaining+
      ' seconds at Central acknowledgment. No automatic work was started.'+
      (r.replayed?' Original pending request replayed.':'');
  }catch(error){
    output.textContent='Renewal blocked: '+String(error?.message||error)+
      '. Early renewal, expired lease, stale Master or spent four-hour budget cannot be bypassed. Preserve pending journal for Owner review.';
  }finally{await loadStatus();}
});

get('workerSubmit').addEventListener('click',async()=>{
  const button=get('workerSubmit'),output=get('workerTasks');
  button.disabled=true;
  try{
    const agent=get('workerAgent').value,ticket=exactWorkerTicket();
    output.textContent='Validating committed Git candidate and signed Central checkpoint…';
    const r=await api.submitWorkerCandidate(agent,ticket);
    if(r.canceled){
      output.textContent='Canceled. No submission was sent.';
    }else{
      output.textContent='Central candidate record verified for '+ticket+
        '. Git HEAD: '+r.candidate_head_sha+
        '. Git tree: '+r.candidate_tree_sha+
        '. Changed paths: '+r.changed_paths.join(', ')+
        '. Status: SUBMITTED_FOR_REVIEW. No Git push, QA pass, merge or deployment performed.'+
        (r.already_submitted?' Existing Central submission reconciled.':
          (r.replayed?' Original pending request replayed.':''));
    }
  }catch(error){
    output.textContent='Submission blocked: '+String(error?.message||error)+
      '. Preserve the local Git worktree and pending submission journal. '+
      'Do not change commits or send a new claim while Central status is uncertain; ask Owner to reconcile.';
  }finally{await loadStatus();}
});

get('workerExport').addEventListener('click',async()=>{
  const output=get('workerTasks');get('workerExport').disabled=true;
  try{
    const r=await api.exportCandidateHandoff(get('workerAgent').value,exactWorkerTicket());
    output.textContent=r.canceled?'Export canceled; no files written.':
      'Exported offline candidate bundle: '+r.bundle_path+
      ' and manifest: '+r.manifest_path+
      '. SHA256: '+r.bundle_sha256+
      '. Move BOTH files to another approved QA PC using your trusted transfer method. '+
      'This does not publish Git or approve QA.';
  }catch(error){
    output.textContent='Offline export blocked: '+String(error?.message||error)+
      '. Preserve existing source and any previously exported files; do not overwrite uncertain handoffs.';
  }finally{await loadStatus();}
});
get('workerQAInspect').addEventListener('click',async()=>{
  const output=get('workerTasks');get('workerQAInspect').disabled=true;
  try{
    const r=await api.inspectQAHandoff(get('workerAgent').value,exactWorkerTicket());
    output.textContent=r.canceled?'QA inspection canceled.':
      'Independent QA handoff inspected ONLY. Exact Central candidate: '+
      r.candidate_head_sha+' / tree '+r.candidate_tree_sha+
      '. Bundle SHA256: '+r.bundle_sha256+
      '. No objects entered your trusted checkout, no tests ran, and no QA approval was sent.';
  }catch(error){
    output.textContent='QA inspection blocked: '+String(error?.message||error)+
      '. Do not execute the bundle or manually force a Git import. Ask the Owner to review the mismatch.';
  }finally{await loadStatus();}
});
get('workerQARun').addEventListener('click',async()=>{
  const output=get('workerTasks'),button=get('workerQARun');
  button.disabled=true;
  try{
    const r=await api.runIndependentQa(get('workerAgent').value,exactWorkerTicket());
    if(r.canceled){output.textContent='Sandbox run canceled. No test was executed.';}
    else{output.textContent='Independent QA local Docker test recorded for '+r.ticket_id+
      '. Candidate SHA '+r.candidate_head_sha+
      '. Test result: '+(r.test_passed?'PASS in local sandbox':'FAIL / not proven')+
      '. Evidence file: '+r.evidence_path+
      '. No Central QA receipt, QA approval, Git publication or deployment was performed.';}
  }catch(error){
    output.textContent='QA sandbox execution blocked or uncertain: '+
      String(error?.message||error)+
      '. Do not repeat this ticket automatically. Preserve the local qa_started journal and ask the Owner to inspect Docker cleanup and exact hashes.';
  }finally{await loadStatus();}
});
get('workerQAAttest').addEventListener('click',async()=>{
  const output=get('workerTasks'),button=get('workerQAAttest');
  button.disabled=true;
  try{
    const r=await api.attestQaEvidence(get('workerAgent').value,exactWorkerTicket());
    output.textContent=r.canceled?'QA evidence signing canceled; no signature created.':
      'Device-signed LOCAL evidence for '+r.ticket_id+'. Exact Git SHA '+
      r.candidate_head_sha+'; report SHA-256 '+r.evidence_sha256+
      '. Signed file: '+r.local_attestation_path+
      '. Give the Owner BOTH qa_result and qa_attested files, and independently verify '+
      'the approved Central node public key fingerprint '+r.public_key_fingerprint_sha256+
      '. This is not Central QA approval or Git publication.';
  }catch(error){
    output.textContent='QA evidence signing blocked: '+String(error?.message||error)+
      '. Preserve local report and attempt journal; ask Owner to investigate tampering or changed Central candidate.';
  }finally{await loadStatus();}
});
get('workerQAUpload').addEventListener('click',async()=>{
  const output=get('workerTasks');get('workerQAUpload').disabled=true;
  try{
    const r=await api.submitQaEvidenceForOwner(get('workerAgent').value,
      exactWorkerTicket());
    output.textContent=r.canceled?'Central evidence upload canceled.':
      'Central validated the QA device signature. Review ID: '+
      r.review_proposal_id+'. Status: '+r.status+
      '. Owner must inspect the original QA report and runner independently. '+
      'No QA receipt, Git push or production deployment occurred.';
  }catch(error){
    output.textContent='Central QA evidence upload blocked/uncertain: '+
      String(error?.message||error)+
      '. Preserve immutable local journal. Retry only the exact agent/ticket.';
  }finally{await loadStatus();}
});
get('workerQAReceipt').addEventListener('click',async()=>{
  const output=get('workerTasks');get('workerQAReceipt').disabled=true;
  try{
    const r=await api.submitOwnerReviewedQaReceipt(get('workerAgent').value,
      exactWorkerTicket());
    output.textContent=r.canceled?'QA receipt canceled.':
      'Central reviewed QA receipt: '+r.status+
      ', exact ticket '+r.ticket_id+
      '. This DOES NOT perform Git publication, merge or deployment.';
  }catch(error){
    output.textContent='QA receipt denied/uncertain: '+
      String(error?.message||error)+
      '. Never bypass Owner approval or repeat with a new request ID.';
  }finally{await loadStatus();}
});
