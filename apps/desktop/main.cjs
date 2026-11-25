/**
 * SUTRADHAR Desktop first-run assisted alpha:
 * local setup UI, approved Central health check, persistent per-PC config and
 * supervised signed edge agent. No unapproved provider automation.
 * Not a production-signed installer; OS-backed encrypted identity is alpha and
 * requires physical Windows acceptance.
 */
'use strict';
const {app,BrowserWindow,Menu,Tray,shell,ipcMain,dialog,safeStorage}=require('electron');
const fs=require('node:fs');

const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {verifyOffer,sha256File}=require('./update-policy.cjs');
const {checkReadiness}=require('./update-readiness.cjs');
const {verifyCentralHealth}=require('./central-health.cjs');
const {readDesktopSettings,writeDesktopSettings}=require('./settings-store.cjs');
const {recordInspection}=require('./update-inspection-journal.cjs');
const {verifyWindowsPublisher}=require('./windows-authenticode.cjs');
const {prepareInstaller,inspectPreparedIdentity}=require('./maintenance-install-preparation.cjs');
const {launchStagedInstaller}=require('./maintenance-installer-execution.cjs');
const {inspectDirectExitFromJournals}=require('./maintenance-installer-direct-exit.cjs');
const {inspectObserverWitness}=require('./maintenance-installer-persistent-observer.cjs');
const {observePostInstall}=require('./maintenance-postinstall-verification.cjs');
const {observeFailedAttempt}=require('./maintenance-failed-install-review.cjs');
const {prepareFailedInstallRecoveryReview}=require('./maintenance-failure-owner-review.cjs');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {isolateDrainedPc}=require('./maintenance-local-isolation.cjs');
const {requestStopAndConfirm}=require('./maintenance-stop-confirm.cjs');
const {checkRecovery}=require('./maintenance-recovery-preflight.cjs');
const {releaseHold,boundedFile}=require('./maintenance-release-executor.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {requireNoInstallerIncident}=require('./maintenance-install-incident-barrier.cjs');
const {summarizeMaintenanceEvidence}=require('./maintenance-status-evidence.cjs');
const {inspectAgentSession,requireNoAgentSession,beginAgentSession,finishObservedSession}=require('./agent-session-fence.cjs');
const {classifyObservedAgentExit}=require('./agent-session-exit-policy.cjs');
const {inspectCrashEvidence}=require('./agent-crash-evidence.cjs');
const {prepareManualRestart,confirmLiveCentral}=require('./maintenance-restart.cjs');
const {waitForFreshAck,recordFreshAck}=require('./maintenance-restart-ack.cjs');
const {
  normalizeCentralUrl,cleanPcName,agentCount,agentIds,
  validateSettings,validateEnrollmentCode
}=require('./desktop-config.cjs');
const {summarizeCentralReceipt}=require('./status.cjs');
const {readNodeStatus}=require('./node-status.cjs');
const {createVault}=require('./os-vault.cjs');
const {createProof:createPilotNodeProof,writeExclusive:writePilotNodeProof}=
  require('./pilot-node-continuity.cjs');
const {createSignerBridge}=require('./vault-bridge.cjs');
const {inspectWorkerTasks,compactWorkerContext}=require('./worker-inspection.cjs');
const {claimApprovedTask,resumeApprovedTask,recordProviderAttempt,previewMasterBatch,commitMasterBatch,inspectMasterBatchReceipt,listMasterProjects,lookupMasterProject,inspectMasterBaseline,requireMasterBaseline,inspectMasterSourceHints,analyzeMasterPlanningDraft,buildMasterPlanningContext,createMasterDraftStore,createMasterBatchJournal}=require('./worker-claim.cjs');
const {readBulkManifest,reviewBulkManifest,selectBulkDraft}=require('./master-bulk-desktop.cjs');
const {progressWorkerTask}=require('./worker-progress.cjs');
const {submitWorkerCandidate}=require('./worker-submit.cjs');
const {exportCandidateHandoff,inspectQAHandoff}=require('./qa-handoff.cjs');
const {runIndependentQa,validPolicy}=require('./qa-execution.cjs');
const {attestIndependentQa}=require('./qa-evidence.cjs');
const {submitQaEvidenceForOwner,submitOwnerReviewedQaReceipt}=require('./qa-evidence-submit.cjs');
const {publishReviewedCandidate,validatePolicy:validateGitPublishPolicy}=require('./git-publish.cjs');
const gitPublishPolicy=require('./git-publish-policy.json');
const qaRunnerPolicy=require('./qa-runner-policy.json');
const {enrollWithOwnerGrant}=require('./enrollment.cjs');
const {inspect:inspectEnrollment,prepare:prepareEnrollment,
  markSubmitted:markEnrollmentSubmitted,requireSubmitted,
  reconcilePrepared:reconcileEnrollment}=require('./enrollment-receipt.cjs');
const {installSingleInstanceGuard}=require('./single-instance.cjs');

let setupWindow=null,dashboardWindow=null,agent=null,tray=null;
let current=null,pendingEnrollmentCode=null,shuttingDown=false,retryTimer=null,configurationCorrupt=false;
let vault=null,vaultError=null,signer=null;
let agentSession=null,expectedQuitChild=null,expectedMaintenanceStopChild=null,quitCompletionStarted=false;
let maintenanceRestartBusy=false;
let workerClaimBusy=false;
// Tab-local review metadata only; never retain prompt text or credentials here.
let workerContextReview=null;
let masterBatchReview=null;
let masterBaselineReview=null;
// Only native-selected path and digests are retained, never the bulk task text.
let masterBulkReview=null;
let installerPreparationBusy=false;
let installerExecutionBusy=false;
let postInstallBusy=false;
let failedInstallReviewBusy=false;
let failedRecoveryApprovalBusy=false;
const trustedProviders={
  chatgpt:'https://chatgpt.com/',
  ai_studio:'https://aistudio.google.com/'
};
function home(){return app.getPath('userData');}
function nodeDir(){return path.join(home(),'node');}
function configFile(){return path.join(home(),'desktop-settings.json');}
function enrollmentReceiptPath(){return path.join(nodeDir(),'enrollment-receipt.json');}
function legacyEnrollmentMarker(){return path.join(nodeDir(),'enrollment_requested');}
function readSettings(){return readDesktopSettings({file:configFile()});}
function writeSettings(x){return writeDesktopSettings({file:configFile(),settings:x});}
function agentScript(){
  return app.isPackaged
    ?path.join(process.resourcesPath,'secure-agent.cjs')
    :path.join(__dirname,'dist','secure-agent.cjs');
}
function safeStatus(){
  let nodeId=null,enrollmentState='NOT_REQUESTED',enrollmentError=null;
  try{nodeId=vault?.read()?.node_id||null;}
  catch{if(!vaultError)vaultError='OS_VAULT_IDENTITY_UNREADABLE';}
  try{
    if(current){
      const state=inspectEnrollment({dir:nodeDir(),node:vault?.read(),centralUrl:current.centralUrl});
      enrollmentState=state?.state||'NOT_REQUESTED';
      if(enrollmentState==='SUBMITTED')pendingEnrollmentCode=null;
    }
  }catch(e){enrollmentState='OWNER_REVIEW_REQUIRED';enrollmentError=String(e.message||e).slice(0,100);}
  // Filename presence is a diagnostic hint only. Never display a dangling or
  // unsigned record as a completed Owner review or installed application.
  const {failedRecoveryApproval,failedInstallReview,postInstallObservation,
    persistentObserver,directInstallerExit,installerExecution,
    installerPreparation}=summarizeMaintenanceEvidence({dir:nodeDir()});
  let maintenanceHold='NONE';
  try{if(requiresReconciliation(nodeDir()))maintenanceHold='RELEASE_RECONCILIATION_REQUIRED';}
  catch{maintenanceHold='CORRUPT_OWNER_REVIEW_REQUIRED';}
  if(fs.existsSync(nodeDir())){
    try{const hold=inspectHold({dir:nodeDir(),nodeId});
      if(hold.active)maintenanceHold='OWNER_REVIEW_REQUIRED';}
    catch(e){maintenanceHold='CORRUPT_OWNER_REVIEW_REQUIRED';}
  }
  let agentSessionStatus='NONE';
  try{
    if(inspectAgentSession({dir:nodeDir()}).active)
      agentSessionStatus=agent&&agentSession?'TRACKED_CHILD_RUNNING':'OWNER_REVIEW_REQUIRED';
  }catch{agentSessionStatus='OWNER_REVIEW_REQUIRED';}
  const agentProcessRunning=Boolean(agent&&agent.exitCode===null);
  const startupSupported=Boolean(app.isPackaged&&['win32','darwin'].includes(process.platform));
  let startupEnabled=false;
  try{if(startupSupported)startupEnabled=Boolean(app.getLoginItemSettings().openAtLogin);}catch{}
  let centralReport=null;
  try{
    const detail=readNodeStatus({file:path.join(nodeDir(),'status.json'),nodeId});
    centralReport=summarizeCentralReceipt(detail,nodeId,agentProcessRunning);
  }catch{}
  return {configured:Boolean(current),centralUrl:current?.centralUrl||null,
    pcName:current?.pcName||null,agentIds:current?.agentIds||[],
    nodeId,enrollmentRequested:enrollmentState==='SUBMITTED',
    enrollmentState,enrollmentError,
    agentProcessRunning,agentSessionStatus,centralReport,maintenanceHold,installerPreparation,installerExecution,directInstallerExit,persistentObserver,postInstallObservation,failedInstallReview,failedRecoveryApproval,startupSupported,startupEnabled,
    workerClaimSupported:Boolean(process.platform==='win32'&&app.isPackaged),
    qaRunnerConfigured:(()=>{try{validPolicy(qaRunnerPolicy);return true;}catch{return false;}})(),
    gitPublishConfigured:(()=>{try{validateGitPublishPolicy(gitPublishPolicy);return true;}catch{return false;}})(),
    signingStatus:vaultError||(vault?'OS_BACKED_ENCRYPTED_ALPHA':'OS_VAULT_UNAVAILABLE'),productionReady:false};
}
function startAgent({manualOwnerRestart=false}={}){
  if(!current||shuttingDown||agent)return null;
  // A failed/ambiguous signed-counter commit is a terminal Owner hold for
  // this Desktop process, not an ordinary child crash or heartbeat outage.
  if(vaultError)throw Error(vaultError);
  // Orphan from an abrupt prior Electron/child exit always requires Owner review.
  // Manual maintenance restart grants cannot bypass this independent safety hold.
  requireNoAgentSession({dir:nodeDir()});
  if(requiresReconciliation(nodeDir())&&!manualOwnerRestart)
    throw Error('MAINTENANCE_POST_RELEASE_RECONCILIATION_REQUIRED');
  requireNoInstallerIncident({dir:nodeDir(),manualOwnerRestart});
  // Persisted local hold overrides automatic restart even if Central currently
  // appears healthy; corrupted holds also fail closed for Owner review.
  if(fs.existsSync(nodeDir())){
    const hold=inspectHold({dir:nodeDir(),nodeId:vault?.read()?.node_id});
    if(hold.active)throw Error('MAINTENANCE_HOLD_OWNER_REVIEW_REQUIRED');
  }
  if(!vault||!signer)throw Error(vaultError||'OS_VAULT_UNAVAILABLE');
  const enrolled=requireSubmitted({dir:nodeDir(),node:vault.read(),centralUrl:current.centralUrl});
  if(enrolled)pendingEnrollmentCode=null;
  const script=agentScript();
  if(!fs.existsSync(script))throw Error('Edge agent not built. Developer: run npm run build:desktop at repo root.');
  if(!enrolled&&!pendingEnrollmentCode)
    throw Error('Enter the one-time enrollment code to request Owner approval');
  // Allowlisted OS process settings only: no inherited DB/GitHub/admin/Telegram
  // secrets or the one-time enrollment grant in child environment.
  const env={};
  for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE',
    'APPDATA','LOCALAPPDATA','HOME','LANG','LC_ALL','HOMEDRIVE','HOMEPATH']){
    if(typeof process.env[name]==='string')env[name]=process.env[name];
  }
  Object.assign(env,{
    ELECTRON_RUN_AS_NODE:'1',SUTRADHAR_VAULT_BRIDGE:'1',
    SUTRADHAR_CENTRAL_URL:current.centralUrl,
    SUTRADHAR_NODE_NAME:current.pcName,
    SUTRADHAR_AGENT_IDS:current.agentIds.join(','),
    SUTRADHAR_NODE_DIR:nodeDir()
  });
  fs.mkdirSync(nodeDir(),{recursive:true,mode:0o700});
  // A child session is durably recorded BEFORE spawn. An interrupted Main,
  // power loss or unobserved exit cannot silently resume signing at login.
  let session,fd;
  try{
    session=beginAgentSession({dir:nodeDir()});
    agentSession=session;
    fd=fs.openSync(path.join(home(),'edge-agent.log'),'a',0o600);
    agent=spawn(process.execPath,[script],{
      env,stdio:['ignore',fd,fd,'ipc'],windowsHide:true
    });
  }catch{
    // Any failure here may have left the session marker on disk.
    // The interactive Main signer must be revoked even for a sync failure.
    vaultError='OS_VAULT_AGENT_LAUNCH_UNCERTAIN_OWNER_REVIEW';
    signer=null;
    throw Error(vaultError);
  }finally{
    if(fd!==undefined){
      try{fs.closeSync(fd);}
      catch{
        // If spawned, child handlers below still attach, but no signing.
        vaultError='OS_VAULT_AGENT_LOG_CLOSE_UNCERTAIN_OWNER_REVIEW';
        signer=null;
      }
    }
  }

  const spawnedAgent=agent;
  spawnedAgent.on('message',async msg=>{
    if(agent!==spawnedAgent||!spawnedAgent.connected)return;
    if(!msg||msg.type!=='vault:request'||!Number.isSafeInteger(msg.id)||
      msg.id<1||!['initialize','saveCounters','sign','enroll'].includes(msg.op))return;
    const reply={type:'vault:response',id:msg.id};
    try{
      if(!vault)throw Error('OS_VAULT_UNAVAILABLE');
      if(JSON.stringify(msg).length>45000)throw Error('VAULT_MESSAGE_TOO_LARGE');
      if(msg.op==='initialize')reply.result=signer.initialize(msg.payload);
      if(msg.op==='saveCounters')reply.result=signer.saveCounters(msg.payload);
      if(msg.op==='sign'){
        if(msg.payload?.kind==='enroll')throw Error('ENROLL_PROOF_RESTRICTED_TO_MAIN');
        reply.result=signer.sign(msg.payload);
      }
      if(msg.op==='enroll'){
        if(!current)throw Error('DEVICE_SETTINGS_NOT_CONFIGURED');
        const node=signer.snapshot();
        const scope={dir:nodeDir(),node,centralUrl:current.centralUrl};
        if(requireSubmitted(scope)){
          reply.result={accepted:true,ownerApprovalRequired:true};
        }else{
          const grant=pendingEnrollmentCode;
          pendingEnrollmentCode=null; // Single use even if network request fails.
          if(!grant)throw Error('OWNER_ENROLLMENT_GRANT_REQUIRED');
          // Record intent before transmitting anything. After a crash or
          // ambiguous network outcome, only Owner review may reconcile.
          prepareEnrollment(scope);
          reply.result=await enrollWithOwnerGrant({
            origin:current.centralUrl,grant,displayName:current.pcName,
            node,signer
          });
          if(reply.result?.accepted!==true)throw Error('ENROLLMENT_UNCONFIRMED');
          markEnrollmentSubmitted(scope);
          pendingEnrollmentCode=null;
        }
      }
    }catch(e){
      if(msg.op==='saveCounters'){
        // Freeze automatic child restart AND Main's interactive signing
        // handlers, even when the failure occurred before vault.save().
        vaultError='OS_VAULT_COUNTER_COMMIT_UNCERTAIN_OWNER_REVIEW';
        signer=null;
      }
      reply.error=msg.op==='saveCounters'&&vaultError?
        vaultError:String(e.message||'VAULT_ERROR').slice(0,100);
    }
    try{if(agent===spawnedAgent&&spawnedAgent.connected)spawnedAgent.send(reply);}catch{}
  });
  spawnedAgent.on('error',()=>{
    // spawn errors are not guaranteed to yield an observed child exit.
    // Leave the pre-spawn session marker intact across an app relaunch.
    if(agent!==spawnedAgent)return;
    vaultError='OS_VAULT_AGENT_PROCESS_ERROR_OWNER_REVIEW_REQUIRED';
    signer=null;
  });
  spawnedAgent.on('exit',(exitCode,signal)=>{
    if(agent!==spawnedAgent)return; // Ignore stale child exit after a replacement.
    agent=null;
    let ownerHold=false,holdInspectionFailed=false;
    try{
      ownerHold=inspectHold({dir:nodeDir(),nodeId:vault?.read()?.node_id}).active;
    }catch{holdInspectionFailed=true;}
    // Never use maintenance hold existence as proof of requested stop.
    // Only an explicit per-child request AND the actual observed exit may
    // retire its pre-spawn marker; unknown/crash exit preserves it.
    const ownerStop=ownerHold&&!holdInspectionFailed&&
      expectedMaintenanceStopChild===spawnedAgent;
    const appStop=shuttingDown&&expectedQuitChild===spawnedAgent;
    const clean=exitCode===0&&!signal;
    let decision;
    try{
      decision=classifyObservedAgentExit({
        exitCode,signal:signal||null,ownerHold,
        ownerStopRequested:ownerStop,appStopRequested:appStop,
        shuttingDown,vaultHealthy:!vaultError,
        holdInspectionHealthy:!holdInspectionFailed
      });
    }catch{
      // Malformed/unknown child status cannot retire a durable crash marker.
      vaultError='OS_VAULT_AGENT_EXIT_STATUS_UNTRUSTED_OWNER_REVIEW';
      signer=null;
      decision={retire:false,reason:null};
    }
    if(decision.retire){
      try{
        finishObservedSession({dir:nodeDir(),session_id:session.session_id,
          reason:decision.reason});
        agentSession=null;
      }catch{
        vaultError='OS_VAULT_AGENT_SESSION_RETIRE_UNCERTAIN_OWNER_REVIEW';
        signer=null;
      }
    }
    if(!decision.retire){
      // A retained crash marker must never leave an interactive signer alive,
      // including an exitCode=0 while an unrequested maintenance hold exists.
      // The legacy abnormal-exit branch below supplies the specific error for
      // an otherwise healthy/unexpected nonzero child exit.
      signer=null;
      if(clean||shuttingDown||ownerHold||holdInspectionFailed)
        vaultError=vaultError||'OS_VAULT_AGENT_SESSION_UNRECONCILED_OWNER_REVIEW';
    }
    if(shuttingDown||vaultError)return; // Never retry when retirement is uncertain.
    if(holdInspectionFailed){vaultError='MAINTENANCE_HOLD_INSPECTION_OWNER_REVIEW';signer=null;return;}
    if(ownerStop)return; // Local Owner hold blocks all further normal work.
    // Always revoke the interactive signer on an abnormal exit, even during
    // post-release reconciliation. A maintenance barrier is not a signer hold.
    if(!clean){
      vaultError='OS_VAULT_AGENT_CRASH_OWNER_REVIEW_REQUIRED';
      signer=null;
      return;
    }
    try{if(requiresReconciliation(nodeDir()))return;}catch{return;}
    if(!agentSession){
      if(retryTimer)clearTimeout(retryTimer);
      retryTimer=setTimeout(()=>{
        retryTimer=null;
        try{startAgent();}catch{ /* Persistent hold or Owner enrollment review. */ }
      },15000);
    }
  });
  return spawnedAgent;
}
async function confirmQuit(){
  const {response}=await dialog.showMessageBox({
    type:'warning',buttons:['Keep SUTRADHAR running','Quit and stop local agent'],
    defaultId:0,cancelId:0,noLink:true,
    message:'Stop SUTRADHAR on this PC?',
    detail:'Stopping the local agent stops its 60-second heartbeats. Central may promote an eligible backup after the lease expires.'
  });
  if(response===1)app.quit();
}
async function createTray(){
  // Use the installed executable's OS icon; no unsigned remote icon assets.
  const icon=await app.getFileIcon(process.execPath);
  if(icon.isEmpty())throw Error('No system tray icon available');
  tray=new Tray(icon);
  tray.setToolTip('SUTRADHAR Desktop — local agent status');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open SUTRADHAR status',click:showSetup},
    {label:'Open Central dashboard',click:()=>{try{showDashboard();}catch{showSetup();}}},
    {type:'separator'},
    {label:'Quit and stop agent',click:confirmQuit}
  ]));
  tray.on('double-click',showSetup);
}
function showSetup(){
  if(setupWindow&&!setupWindow.isDestroyed()){setupWindow.focus();return;}
  setupWindow=new BrowserWindow({
    width:780,height:760,minWidth:650,minHeight:650,
    title:'SUTRADHAR Desktop — Setup',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,
      webSecurity:true,preload:path.join(__dirname,'preload.cjs')}
  });
  setupWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  setupWindow.webContents.on('will-navigate',ev=>ev.preventDefault());
  setupWindow.loadFile(path.join(__dirname,'setup.html'));
  setupWindow.on('closed',()=>{setupWindow=null;masterBulkReview=null;});
}
function showDashboard(){
  if(!current)throw Error('Finish Desktop setup first');
  const origin=new URL(current.centralUrl).origin;
  if(dashboardWindow&&!dashboardWindow.isDestroyed()){dashboardWindow.focus();return;}
  dashboardWindow=new BrowserWindow({width:1280,height:880,title:'SUTRADHAR Central',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  dashboardWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  dashboardWindow.webContents.on('will-navigate',(event,target)=>{
    try{
      if(new URL(target).origin!==origin||!target.startsWith('https://'))event.preventDefault();
    }catch{event.preventDefault();}
  });
  dashboardWindow.loadURL(current.centralUrl).catch(()=>{
    if(dashboardWindow&&!dashboardWindow.isDestroyed())
      dialog.showErrorBox('Central unavailable','Check your Central HTTPS URL and Hostinger health.');
  });
  dashboardWindow.on('closed',()=>{dashboardWindow=null;});
}
function verifySender(event){
  if(!setupWindow||setupWindow.isDestroyed()||event.sender!==setupWindow.webContents)
    throw Error('Local setup window authorization required');
}
async function checkCentral(origin){
  const local=JSON.parse(fs.readFileSync(path.join(__dirname,'contract.json'),'utf8'));
  return verifyCentralHealth({origin,expectedProtocol:local.api_protocol});
}
const primaryInstance=installSingleInstanceGuard(app,()=>showSetup());
app.whenReady().then(()=>{
  if(!primaryInstance)return;
  try{
    // Never expose an interactive signing capability on an orphaned session.
    requireNoAgentSession({dir:nodeDir()});
    vault=createVault({safeStorage,dir:nodeDir()});signer=createSignerBridge(vault);
  }
  catch(e){vaultError=String(e.message||'OS_VAULT_UNAVAILABLE');}
  try{current=readSettings();}catch{
    configurationCorrupt=true;
    dialog.showErrorBox('Invalid Desktop settings','Stored configuration is unreadable. Do not delete device identity; contact the Owner.');
  }
  ipcMain.handle('sutradhar:getStatus',event=>{verifySender(event);return safeStatus();});
  ipcMain.handle('sutradhar:inspectAgentCrashEvidence',event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged)
      throw Error('AGENT_CRASH_DIAGNOSTIC_PACKAGED_WINDOWS_REQUIRED');
    if(agent)
      throw Error('AGENT_CRASH_DIAGNOSTIC_CHILD_EXIT_UNCONFIRMED');
    // No signer, node key, Central API or installer operation is required.
    // Intentionally works when the crashed session blocked vault startup.
    return inspectCrashEvidence({dir:nodeDir()});
  });
  ipcMain.handle('sutradhar:saveSetup',async(event,payload)=>{
    verifySender(event);
    if(configurationCorrupt)throw Error('Invalid stored device settings. Owner-guided recovery required; never overwrite an existing identity automatically.');
    if(!payload||typeof payload!=='object')throw Error('Invalid configuration');
    const centralUrl=normalizeCentralUrl(payload.centralUrl);
    const pcName=cleanPcName(payload.pcName);
    const count=agentCount(payload.agentCount);
    if(current&&(centralUrl!==current.centralUrl||pcName!==current.pcName||
       count!==current.agentIds.length))
      throw Error('This PC identity is already configured. Request an Owner-guided reconfiguration instead.');
    if(!vault)throw Error(vaultError||'OS_VAULT_UNAVAILABLE');
    if(current&&requireSubmitted({dir:nodeDir(),node:vault.read(),centralUrl:current.centralUrl}))
      return safeStatus();
    const code=validateEnrollmentCode(payload.enrollmentCode);
    await checkCentral(centralUrl);
    if(!current){
      const candidate={centralUrl,pcName,agentIds:agentIds(count)};
      writeSettings(candidate);
      current=candidate;
    }
    pendingEnrollmentCode=code;startAgent();
    // This means the agent process started, NOT that Central approved the PC.
    return safeStatus();
  });
  ipcMain.handle('sutradhar:reconcileEnrollment',async event=>{
    verifySender(event);
    if(!current||!vault||!signer)throw Error(vaultError||'DEVICE_NOT_CONFIGURED');
    const result=await reconcileEnrollment({
      dir:nodeDir(),node:signer.snapshot(),centralUrl:current.centralUrl,signer
    });
    if(result.accepted===true){
      pendingEnrollmentCode=null;
      try{startAgent();}catch{ /* Existing child retries; status shows any further error. */ }
    }
    return safeStatus();
  });
  // No private-key access is exposed to setup HTML or the supervised agent.
  // Human must choose both a local Owner challenge and the new destination.
  ipcMain.handle('sutradhar:exportPilotNodeProof',async event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault)
      throw Error('PILOT_NODE_PACKAGED_WINDOWS_REQUIRED');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
      centralUrl:current.centralUrl}))
      throw Error('PILOT_NODE_EXISTING_ENROLLED_VAULT_REQUIRED');
    const picked=await dialog.showOpenDialog(setupWindow,{
      title:'Choose Owner-reviewed pilot continuity challenge JSON',
      properties:['openFile'],filters:[{name:'Pilot challenge',extensions:['json']}]
    });
    if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
    const file=picked.filePaths[0],stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<50||stat.size>10000)
      throw Error('PILOT_NODE_CHALLENGE_FILE_UNSAFE');
    const challenge=JSON.parse(fs.readFileSync(file,'utf8'));
    const choice=await dialog.showMessageBox(setupWindow,{
      type:'warning',buttons:['Cancel','BEFORE (baseline)','AFTER (new boot)'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Export an OS-vault signed continuity observation?',
      detail:'Save BEFORE/AFTER evidence to a new, protected Owner-reviewed folder with a NEW filename. A failed or interrupted save must never be overwritten or deleted as a retry. Windows folder ACL and power-loss durability still require independent Owner verification. The signature only proves key possession/software boot ID and counters, NOT real hardware reboot, production, installation or failover authorization.'
    });
    if(choice.response===0)return {canceled:true};
    const phase=choice.response===1?'BEFORE':'AFTER';
    const proof=createPilotNodeProof({node,challenge,phase,
      centralOrigin:current.centralUrl,now:Date.now()});
    const destination=await dialog.showSaveDialog(setupWindow,{
      title:'Save immutable signed '+phase+' node continuity proof (private)',
      defaultPath:'sutradhar-pilot-'+phase.toLowerCase()+'-'+
        node.node_id.slice(0,15)+'.json',
      filters:[{name:'Signed node proof',extensions:['json']}]
    });
    if(destination.canceled||!destination.filePath)return {canceled:true};
    return writePilotNodeProof(destination.filePath,proof);
  });
  ipcMain.handle('sutradhar:setStartup',(event,enabled)=>{
    verifySender(event);
    if(typeof enabled!=='boolean')throw Error('Invalid auto-start preference');
    if(!app.isPackaged||!['win32','darwin'].includes(process.platform))
      throw Error('Auto-start requires a packaged Windows/macOS app');
    app.setLoginItemSettings({openAtLogin:enabled});
    return safeStatus();
  });
  ipcMain.handle('sutradhar:openDashboard',event=>{
    verifySender(event);showDashboard();return {opened:true};
  });
  ipcMain.handle('sutradhar:inspectWorkerTasks',async(event,agentId,ticketId=null,mode='detail')=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('WORKER_INSPECTION_REQUIRES_PACKAGED_WINDOWS_OS_VAULT');
    // Do not use the local vault while the PC has an uncertain maintenance
    // stop, installer attempt or partial recovery state.
    if(shuttingDown||maintenanceRestartBusy||postInstallBusy||
      failedInstallReviewBusy||failedRecoveryApprovalBusy||
      installerExecutionBusy||installerPreparationBusy||
      requiresReconciliation(nodeDir()))
      throw Error('WORKER_INSPECTION_LOCAL_OPERATION_FENCED');
    requireNoInstallerIncident({dir:nodeDir(),manualOwnerRestart:false});
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,centralUrl:current.centralUrl}))
      throw Error('WORKER_INSPECTION_ENROLLMENT_NOT_CONFIRMED');
    if(inspectHold({dir:nodeDir(),nodeId:node.node_id}).active)
      throw Error('WORKER_INSPECTION_MAINTENANCE_HOLD');
    // An OS process existing is not proof of an approved Central agent.
    // Central also enforces signed node/agent approval and project ACL.
    const status=safeStatus();
    if(!status.agentProcessRunning||!status.centralReport?.acknowledgedNow)
      throw Error('WORKER_INSPECTION_REQUIRES_RECENT_CENTRAL_ACK');
    if(!['detail','context'].includes(mode)||(mode==='context'&&ticketId===null))
      throw Error('WORKER_INSPECTION_MODE_DENIED');
    const origin=current.centralUrl;
    if(mode==='context')workerContextReview=null;
    const result=await inspectWorkerTasks({origin,agentId,ticketId,signer});
    if(mode!=='context')return result;
    const preview=compactWorkerContext(result.task,agentId);
    if(current?.centralUrl!==origin)throw Error('WORKER_PROVIDER_CENTRAL_CHANGED');
    workerContextReview={origin,agentId,ticketId,digest:preview.context_sha256,
      registryVersion:preview.provider_registry_version,
      mappings:preview.provider_mappings.map(m=>({provider:m.provider,binding_sha256:m.binding_sha256}))};
    return preview;
  });

  function approvedWorkerOperator(agentId,ticketId,alreadyLocked=false){
    if(workerClaimBusy&&!alreadyLocked)throw Error('WORKER_OPERATION_ALREADY_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('WORKER_OPERATION_REQUIRES_PACKAGED_WINDOWS_OS_VAULT');
    if(typeof agentId!=='string'||!current.agentIds.includes(agentId)||
      typeof ticketId!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(ticketId))
      throw Error('WORKER_OPERATION_AGENT_OR_TICKET_INVALID');
    if(shuttingDown||maintenanceRestartBusy||postInstallBusy||
      failedInstallReviewBusy||failedRecoveryApprovalBusy||
      installerExecutionBusy||installerPreparationBusy||
      requiresReconciliation(nodeDir()))
      throw Error('WORKER_OPERATION_LOCAL_FENCED');
    requireNoInstallerIncident({dir:nodeDir(),manualOwnerRestart:false});
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
      centralUrl:current.centralUrl}))
      throw Error('WORKER_OPERATION_ENROLLMENT_NOT_CONFIRMED');
    if(inspectHold({dir:nodeDir(),nodeId:node.node_id}).active)
      throw Error('WORKER_OPERATION_MAINTENANCE_HOLD');
    const status=safeStatus();
    if(!status.agentProcessRunning||!status.centralReport?.acknowledgedNow)
      throw Error('WORKER_OPERATION_CENTRAL_HEARTBEAT_REQUIRED');
    return current.centralUrl;
  }
  // A frozen candidate is reviewable for exact evidence, NEVER eligible
  // for a QA receipt until a separate Owner RESTORE_QA_CANDIDATE command.
  // A fresh OS-vault signed GET is required on each separate manual stage.
  async function frozenQaReviewStage(origin,agentId,ticketId){
    const task=(await inspectWorkerTasks({origin,agentId,ticketId,signer})).task;
    if(!task||!['SUBMITTED_FOR_REVIEW','RECONCILIATION_REQUIRED'].includes(task.status))
      throw Error('QA_RECOVERY_CENTRAL_TASK_STATE_INVALID');
    return task.status==='RECONCILIATION_REQUIRED';
  }
  function masterJournal(){
    const node=vault.read();
    if(!node)throw Error('MASTER_BATCH_JOURNAL_IDENTITY_REQUIRED');
    return createMasterBatchJournal({dir:path.join(nodeDir(),'master-batch-journal'),safeStorage,nodeId:node.node_id});
  }
  function masterDraftStore(origin,agentId){
    const node=vault.read();
    if(!node)throw Error('MASTER_DRAFT_IDENTITY_REQUIRED');
    return createMasterDraftStore({dir:path.join(nodeDir(),'master-unconfirmed-drafts'),
      safeStorage,nodeId:node.node_id,origin,agentId});
  }
  ipcMain.handle('sutradhar:loadMasterUnconfirmedDraft',async(event,agentId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,'project_draft');
    workerClaimBusy=true;masterBatchReview=null;masterBaselineReview=null;masterBulkReview=null;
    try{
      if(masterJournal().pending())throw Error('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
      return masterDraftStore(origin,agentId).load();
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:saveMasterUnconfirmedDraft',async(event,agentId,draft,expectedDigest)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,'project_draft');
    workerClaimBusy=true;masterBatchReview=null;masterBulkReview=null;
    try{
      if(masterJournal().pending())throw Error('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
      if(expectedDigest!==null&&(typeof expectedDigest!=='string'||expectedDigest.length!==64||!/^[a-f0-9]{64}$/.test(expectedDigest)))
        throw Error('MASTER_DRAFT_REVISION_INVALID');
      return masterDraftStore(origin,agentId).save(draft,expectedDigest);
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:listMasterProjects',async(event,agentId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,'project_catalog');
    workerClaimBusy=true;
    try{
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,'project_catalog',true)!==origin)throw Error('WORKER_BATCH_CENTRAL_CHANGED');
      };
      const result=await listMasterProjects({origin,agentId,signer,beforeMutation});
      beforeMutation();return result;
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:recoverMasterBatchDraft',async(event,agentId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,'project_recovery');
    workerClaimBusy=true;masterBatchReview=null;masterBulkReview=null;
    try{
      const saved=masterJournal().pending();
      if(!saved)return {pending:false};
      const x=saved.intent;
      if(x.origin!==origin||x.body.agent_id!==agentId)
        throw Error('MASTER_BATCH_JOURNAL_ORIGINAL_AGENT_AND_CENTRAL_REQUIRED');
      return {pending:true,project_id:x.body.project_id,request_id:x.body.request_id,
        tasks:x.body.tasks,plan_order:x.review.plan_order,preview_sha256:x.review.preview_sha256,epoch:x.body.expected_master_epoch,
        automatic_execution_allowed:false};
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:inspectMasterBaseline',async(event,agentId,projectId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId);
    workerClaimBusy=true;masterBatchReview=null;masterBaselineReview=null;masterBulkReview=null;
    try{
      if(masterJournal().pending())throw Error('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,projectId,true)!==origin)
          throw Error('WORKER_BATCH_CENTRAL_CHANGED');
      };
      const bound=await lookupMasterProject({origin,agentId,projectId,signer,beforeMutation});
      const picked=await dialog.showOpenDialog(setupWindow,{
        title:'Choose the already-trusted local Git checkout for this exact project',
        properties:['openDirectory']
      });
      if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
      beforeMutation();
      const repoDir=picked.filePaths[0];
      const observed=inspectMasterBaseline({repoDir,project:bound.project});
      beforeMutation();
      masterBaselineReview={origin,agentId,projectId,epoch:bound.epoch,project:bound.project,repoDir,observed};
      return observed;
    }finally{workerClaimBusy=false;}
  });
  async function recheckMasterBaseline(saved,{origin,agentId,projectId,tasks,beforeMutation}){
    if(!saved||masterBaselineReview!==saved||saved.origin!==origin||saved.agentId!==agentId||saved.projectId!==projectId)
      throw Error('MASTER_BASELINE_INSPECTION_REQUIRED');
    const fresh=await lookupMasterProject({origin,agentId,projectId,signer,beforeMutation});
    beforeMutation();
    if(masterBaselineReview!==saved||fresh.epoch!==saved.epoch||
       JSON.stringify(fresh.project)!==JSON.stringify(saved.project))
      throw Error('MASTER_BASELINE_PROJECT_OR_EPOCH_CHANGED');
    return requireMasterBaseline({tasks,observed:saved.observed,
      current:inspectMasterBaseline({repoDir:saved.repoDir,project:fresh.project})});
  }
  // Recheck the exact signed project and Master epoch, then reobserve the
  // trusted local tracking ref. Bulk review is not a Central mutation.
  async function bulkBaselineCurrent(saved,{origin,agentId,projectId,guard}){
    guard();
    if(!saved||masterBaselineReview!==saved||saved.origin!==origin||
       saved.agentId!==agentId||saved.projectId!==projectId)
      throw Error('MASTER_BASELINE_INSPECTION_REQUIRED');
    const fresh=await lookupMasterProject({origin,agentId,projectId,signer,beforeMutation:guard});
    guard();
    if(masterBaselineReview!==saved||fresh.epoch!==saved.epoch||
       JSON.stringify(fresh.project)!==JSON.stringify(saved.project))
      throw Error('MASTER_BASELINE_PROJECT_OR_EPOCH_CHANGED');
    return inspectMasterBaseline({repoDir:saved.repoDir,project:fresh.project});
  }
  ipcMain.handle('sutradhar:inspectMasterBulkManifest',async(event,agentId,projectId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId),baseline=masterBaselineReview;
    workerClaimBusy=true;masterBulkReview=null;masterBatchReview=null;
    const guard=()=>{
      verifySender(event);
      if(approvedWorkerOperator(agentId,projectId,true)!==origin||masterJournal().pending())
        throw Error('MASTER_BULK_LOCAL_FENCED');
    };
    try{
      await bulkBaselineCurrent(baseline,{origin,agentId,projectId,guard});
      const picked=await dialog.showOpenDialog(setupWindow,{
        title:'Choose a trusted local bulk task declarations JSON file',
        properties:['openFile'],filters:[{name:'Task declarations JSON',extensions:['json']}]
      });
      guard();
      if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
      const current=await bulkBaselineCurrent(baseline,{origin,agentId,projectId,guard});
      const file=picked.filePaths[0];
      const report=reviewBulkManifest(readBulkManifest(file),baseline.observed,current);
      guard();
      masterBulkReview={origin,agentId,projectId,baseline,file,
        fileDigest:report.file_sha256,manifestDigest:report.manifest_sha256};
      return report;
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:selectMasterBulkDraft',async(event,agentId,projectId,fileDigest,manifestDigest,groupId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId),saved=masterBulkReview;
    workerClaimBusy=true;masterBulkReview=null;masterBatchReview=null;
    const guard=()=>{
      verifySender(event);
      if(approvedWorkerOperator(agentId,projectId,true)!==origin||masterJournal().pending())
        throw Error('MASTER_BULK_LOCAL_FENCED');
    };
    try{
      if(!saved||saved.origin!==origin||saved.agentId!==agentId||saved.projectId!==projectId||
         saved.fileDigest!==fileDigest||saved.manifestDigest!==manifestDigest)
        throw Error('MASTER_BULK_REVIEW_REQUIRED');
      const current=await bulkBaselineCurrent(saved.baseline,{origin,agentId,projectId,guard});
      const result=selectBulkDraft(readBulkManifest(saved.file),saved.baseline.observed,current,
        fileDigest,manifestDigest,groupId);
      guard();
      return result;
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:inspectMasterSourceHints',async(event,agentId,projectId,tasks)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId);
    workerClaimBusy=true;
    try{
      if(masterJournal().pending())throw Error('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
      const baseline=masterBaselineReview;
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,projectId,true)!==origin)
          throw Error('WORKER_BATCH_CENTRAL_CHANGED');
      };
      if(!Array.isArray(tasks)||tasks.length<2||tasks.length>10||
         Buffer.byteLength(JSON.stringify(tasks),'utf8')>65536)
        throw Error('MASTER_SOURCE_HINT_SCOPE_INVALID');
      await recheckMasterBaseline(baseline,{origin,agentId,projectId,tasks,beforeMutation});
      const report=inspectMasterSourceHints({repoDir:baseline.repoDir,project:baseline.project,
        observed:baseline.observed,tasks});
      beforeMutation();
      return {...report,declared_planning_review:analyzeMasterPlanningDraft(tasks)};
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:buildMasterPlanningContext',async(event,agentId,projectId,tasks)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId);
    workerClaimBusy=true;
    try{
      if(masterJournal().pending())throw Error('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
      const baseline=masterBaselineReview;
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,projectId,true)!==origin)
          throw Error('WORKER_BATCH_CENTRAL_CHANGED');
      };
      analyzeMasterPlanningDraft(tasks);
      await recheckMasterBaseline(baseline,{origin,agentId,projectId,tasks,beforeMutation});
      const result=buildMasterPlanningContext({observed:baseline.observed,tasks});
      beforeMutation();return result;
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:previewMasterBatch',async(event,agentId,projectId,requestId,tasks)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId);
    if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(requestId)||
       !Array.isArray(tasks)||tasks.length<2||tasks.length>10)
      throw Error('WORKER_BATCH_INPUT_DENIED');
    workerClaimBusy=true;masterBatchReview=null;masterBulkReview=null;
    try{
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,projectId,true)!==origin)throw Error('WORKER_BATCH_CENTRAL_CHANGED');
      };
      if(masterJournal().pending())throw Error('MASTER_BATCH_JOURNAL_PENDING_INSPECT_RECEIPT');
      const baseline=masterBaselineReview;
      const localBaseline=await recheckMasterBaseline(baseline,{origin,agentId,projectId,tasks,beforeMutation});
      const prepared=await previewMasterBatch({origin,agentId,projectId,requestId,tasks,signer,beforeMutation});
      beforeMutation();
      if(prepared.body.expected_master_epoch!==baseline.epoch||masterBaselineReview!==baseline)
        throw Error('MASTER_BASELINE_PROJECT_OR_EPOCH_CHANGED');
      masterBatchReview={origin,prepared,baseline};
      return {...prepared.review,local_baseline_observation:localBaseline};
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:commitMasterBatch',async(event,agentId,projectId,requestId,reviewedDigest)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId);
    const saved=masterBatchReview,body=saved?.prepared.body,review=saved?.prepared.review;
    if(!saved||saved.origin!==origin||body.agent_id!==agentId||body.project_id!==projectId||
       body.request_id!==requestId||review.preview_sha256!==reviewedDigest)
      throw Error('WORKER_BATCH_REVIEW_REQUIRED');
    workerClaimBusy=true;
    try{
      const confirmed=await dialog.showMessageBox(setupWindow,{
        type:'warning',buttons:['Cancel — no batch admission','Admit exact reviewed task batch'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Admit '+body.tasks.length+' reviewed tasks into Central?',
        detail:'Project: '+projectId+'\nMaster: '+agentId+' / epoch '+body.expected_master_epoch+
          '\nRequest: '+requestId+'\nDigest: '+reviewedDigest+'\nOrdered tickets: '+review.plan_order.join(', ')+
          '\nLocal tracking ref: '+saved.baseline.observed.tracking_ref+' / '+saved.baseline.observed.baseline_sha+
          '\nRemote freshness and upstream changes are NOT verified. Internal dependencies may require later planning after upstream merge.'+
          '\nConfirm the complete reviewed task text, baseline, scope, criteria and dependency declarations. No execution, claim, provider send or Git action.'
      });
      if(confirmed.response!==1)return {canceled:true};
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,projectId,true)!==origin||masterBatchReview!==saved)
          throw Error('WORKER_BATCH_REVIEW_CHANGED');
      };
      beforeMutation();
      await recheckMasterBaseline(saved.baseline,{origin,agentId,projectId,tasks:body.tasks,beforeMutation});
      beforeMutation();
      const journal=masterJournal();
      const pending=journal.begin(origin,saved.prepared);
      // Persist exact admission intent before signing/sending; a lost
      // response or crash retains the hold across app restarts.
      const result=await commitMasterBatch({origin,agentId,prepared:saved.prepared,signer,beforeMutation});
      beforeMutation();
      return journal.close(pending.key,result);
    }finally{masterBatchReview=null;masterBulkReview=null;workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:inspectMasterBatchReceipt',async(event,agentId,projectId,requestId,reviewedDigest)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,projectId);
    if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(requestId))
      throw Error('WORKER_BATCH_INPUT_DENIED');
    workerClaimBusy=true;masterBatchReview=null;masterBulkReview=null;
    try{
      const journal=masterJournal(),pending=journal.pending();
      if(pending&&(pending.intent.origin!==origin||pending.intent.body.agent_id!==agentId||
         pending.intent.body.project_id!==projectId||pending.intent.body.request_id!==requestId||
         pending.intent.review.preview_sha256!==reviewedDigest))
        throw Error('MASTER_BATCH_JOURNAL_INSPECT_EXACT_PENDING_FIRST');
      const result=await inspectMasterBatchReceipt({origin,agentId,projectId,requestId,reviewedDigest,signer});
      if(approvedWorkerOperator(agentId,projectId,true)!==origin)throw Error('WORKER_BATCH_CENTRAL_CHANGED');
      return pending?journal.close(pending.key,result):result;
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:claimWorkerTask',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    // A direct user action chooses a trusted local checkout. Neither task
    // descriptions nor the remote Central server can choose local file paths.
    workerClaimBusy=true;
    try{
      const picked=await dialog.showOpenDialog(setupWindow,{
        title:'Select your trusted local Git checkout for this task',
        properties:['openDirectory']
      });
      if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
      const confirmed=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — no task claim','Create isolated worktree and claim task'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Claim this Owner-approved Central task on this PC?',
        detail:'Agent: '+agentId+'\nTask: '+ticketId+
          '\nTrusted local Git checkout: '+picked.filePaths[0]+
          '\nGit for Windows must already be installed. Only the authorized baseline is checked out in a separate local worktree; no push, merge, AI provider, QA or installer execution occurs. Network uncertainty is journaled for safe retry.'
      });
      if(confirmed.response!==1)return {canceled:true};
      // An Owner maintenance change while the dialog was open must veto work.
      // Re-check the fences and agent liveness without releasing busy guard.
      approvedWorkerOperator(agentId,ticketId,true);
      const workerDir=path.join(nodeDir(),'worker');
      fs.mkdirSync(workerDir,{recursive:true,mode:0o700});
      return await claimApprovedTask({
        origin,agentId,ticketId,repoDir:picked.filePaths[0],
        dir:workerDir,signer
      });
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:resumeWorkerTask',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      return await resumeApprovedTask({
        origin,agentId,ticketId,
        dir:path.join(nodeDir(),'worker'),signer
      });
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:recordProviderAttempt',async(event,agentId,ticketId,action,provider,reviewedDigest,attemptId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    if(!['BEGIN','INTERRUPT','CLOSE'].includes(action)||
       (action==='BEGIN'&&(!['CHATGPT_WEB','GOOGLE_AI_STUDIO'].includes(provider)||
         typeof reviewedDigest!=='string'||reviewedDigest.length!==64||!/^[a-f0-9]{64}$/.test(reviewedDigest)))||
       (action!=='BEGIN'&&(typeof attemptId!=='string'||attemptId.length!==40||!/^attempt_[a-f0-9]{32}$/.test(attemptId))))
      throw Error('WORKER_PROVIDER_ATTEMPT_INPUT_DENIED');
    const review=action==='BEGIN'?workerContextReview:null;
    const reviewedBinding=review?.mappings.find(m=>m.provider===provider);
    if(action==='BEGIN'&&(!review||review.origin!==origin||review.agentId!==agentId||
       review.ticketId!==ticketId||review.digest!==reviewedDigest||
       !Number.isSafeInteger(review.registryVersion)||review.registryVersion<1||!reviewedBinding))
      throw Error('WORKER_PROVIDER_PREVIEW_REVIEW_REQUIRED');
    workerClaimBusy=true;
    try{
      const confirmed=await dialog.showMessageBox(setupWindow,{
        type:'warning',buttons:['Cancel — no attempt mutation','Record reviewed metadata ONLY'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Record provider attempt '+action+' for '+ticketId+'?',
        detail:'Agent: '+agentId+'\n'+(action==='BEGIN'?'Provider: '+provider+'\nReviewed context SHA-256: '+reviewedDigest+
          '\nIndependently review actual provider permission, account, workspace and exact context for secrets.':
          'Attempt: '+attemptId+(action==='CLOSE'?'\nConfirm independent review of actual external session and original local worktree, and a fresh checkpoint.':'\nRecord interruption only. Do not repeat an uncertain remote action.'))+
          '\nNo provider request, browser automation, Git push, lease extension or task reassignment occurs.'
      });
      if(confirmed.response!==1)return {canceled:true};
      const beforeMutation=()=>{
        if(approvedWorkerOperator(agentId,ticketId,true)!==origin)
          throw Error('WORKER_PROVIDER_CENTRAL_CHANGED');
        if(action==='BEGIN'&&workerContextReview!==review)throw Error('WORKER_PROVIDER_PREVIEW_REVIEW_CHANGED');
      };
      beforeMutation();
      return await recordProviderAttempt({origin,agentId,ticketId,action,provider,reviewedDigest,attemptId,
        reviewedRegistryVersion:review?.registryVersion,reviewedBindingDigest:reviewedBinding?.binding_sha256,
        dir:path.join(nodeDir(),'worker'),signer,beforeMutation});
    }finally{workerContextReview=null;workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:checkpointWorkerTask',async(event,agentId,ticketId,summary,nextAction)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    if(typeof summary!=='string'||!summary.trim()||summary.length>8000||
      typeof nextAction!=='string'||!nextAction.trim()||nextAction.length>500)
      throw Error('WORKER_CHECKPOINT_INPUT_INVALID');
    workerClaimBusy=true;
    try{
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'question',
        buttons:['Cancel — preserve local task','Save signed checkpoint to Central'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Record this task checkpoint in Central?',
        detail:'Agent: '+agentId+'\nTask: '+ticketId+
          '\nSummary length: '+summary.length+' characters'+
          '\nThis creates an auditable time-limited checkpoint. No code, AI, Git publish or QA runs.'
      });
      if(ok.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return progressWorkerTask({origin,agentId,ticketId,
        dir:path.join(nodeDir(),'worker'),signer,operation:'checkpoint',
        summary,next_action:nextAction});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:renewWorkerLease',async(event,agentId,ticketId,reason)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    if(typeof reason!=='string'||reason.trim()!==reason||
      reason.length<12||reason.length>300)
      throw Error('WORKER_RENEW_REASON_INVALID');
    workerClaimBusy=true;
    try{
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'question',
        buttons:['Cancel — do not renew','Request bounded lease extension'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Request a signed lease extension from Central?',
        detail:'Agent: '+agentId+'\nTask: '+ticketId+
          '\nCentral permits at most 600 seconds per extension and four hours from original claim. Expired/stale leases cannot be restarted. Nothing runs automatically.'
      });
      if(ok.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return progressWorkerTask({origin,agentId,ticketId,
        dir:path.join(nodeDir(),'worker'),signer,operation:'renew-lease',reason});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:submitWorkerCandidate',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — keep local work','Submit exact committed candidate for independent review'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Submit this committed Git candidate to Central?',
        detail:'Agent: '+agentId+'\nTask: '+ticketId+
          '\nThis checks the original Master lease, verified checkpoint, clean Git worktree, immutable baseline and all changed paths. Central records the exact HEAD/tree SHA for independent QA. Nothing is pushed to GitHub; no model command, QA receipt, merge or production deployment is triggered.'
      });
      if(ok.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return submitWorkerCandidate({
        origin,agentId,ticketId,dir:path.join(nodeDir(),'worker'),signer
      });
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:exportCandidateHandoff',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      const selected=await dialog.showSaveDialog(setupWindow,{
        title:'Export the exact Central-submitted candidate for independent QA',
        defaultPath:'sutradhar-'+ticketId+'.bundle',
        filters:[{name:'SUTRADHAR offline Git bundle',extensions:['bundle']}]
      });
      if(selected.canceled||!selected.filePath)return {canceled:true};
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — export nothing','Export only verified Git objects and manifest'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Prepare a manual offline candidate handoff?',
        detail:'This only exports the exact committed candidate already recorded in Central. '+
          'Both files (.bundle and .bundle.json) must be carried securely to the independent QA PC. '+
          'No Git push, QA, installer or automatic execution is permitted.'
      });
      if(ok.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return exportCandidateHandoff({origin,agentId,ticketId,
        dir:path.join(nodeDir(),'worker'),signer,bundlePath:selected.filePath});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:inspectQAHandoff',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      const bundle=await dialog.showOpenDialog(setupWindow,{
        title:'Choose the copied candidate .bundle file on this QA PC',
        properties:['openFile'],
        filters:[{name:'SUTRADHAR offline Git bundle',extensions:['bundle']}]
      });
      if(bundle.canceled||bundle.filePaths.length!==1)return {canceled:true};
      const repo=await dialog.showOpenDialog(setupWindow,{
        title:'Choose YOUR trusted Git checkout at the approved baseline',
        properties:['openDirectory']
      });
      if(repo.canceled||repo.filePaths.length!==1)return {canceled:true};
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — inspect nothing','Inspect copied objects in temporary quarantine'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Inspect this handoff for independent QA?',
        detail:'Central task '+ticketId+' will be checked with this QA agent. '+
          'The bundle SHA and full commit history are independently verified in a disposable BARE Git store. '+
          'Your trusted repository stays unchanged. No checkout, tests, QA approval, push or code execution.'
      });
      if(ok.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return inspectQAHandoff({origin,agentId,ticketId,signer,
        bundlePath:bundle.filePaths[0],repoDir:repo.filePaths[0]});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:runIndependentQa',async(event,agentId,ticketId,recoveryReviewOnly=false)=>{
    verifySender(event);
    if(typeof recoveryReviewOnly!=='boolean')throw Error('QA_RECOVERY_MODE_INVALID');
    const origin=approvedWorkerOperator(agentId,ticketId);
    // No default testing: only an Owner-pinned, locally installed image and
    // absolute trusted Docker executable are accepted by the packaged app.
    validPolicy(qaRunnerPolicy);
    workerClaimBusy=true;
    try{
      if(recoveryReviewOnly){
        // Explicit second authorization: this does NOT restore the ticket.
        const frozen=await frozenQaReviewStage(origin,agentId,ticketId);
        if(!frozen)throw Error('QA_RECOVERY_REQUIRES_FROZEN_CANDIDATE');
        const consent=await dialog.showMessageBox(setupWindow,{
          type:'warning',
          buttons:['Cancel — keep frozen candidate','Inspect and test frozen evidence ONCE'],
          defaultId:0,cancelId:0,noLink:true,
          message:'Independent QA of a FROZEN Master-failover candidate?',
          detail:'Central status is RECONCILIATION_REQUIRED. You must already possess the '+
            'original exact offline bundle, approved QA baseline and Owner-pinned Docker image. '+
            'This creates ONE irreversible local Docker attempt, not a QA receipt. '+
            'Owner must separately review signed evidence then explicitly restore the '+
            'candidate before the signed QA receipt is allowed. Do not redo an old attempt.'});
        if(consent.response!==1)return {canceled:true};
      }
      const bundle=await dialog.showOpenDialog(setupWindow,{
        title:'Choose the independently transferred QA candidate .bundle',
        properties:['openFile'],
        filters:[{name:'SUTRADHAR offline Git bundle',extensions:['bundle']}]
      });
      if(bundle.canceled||bundle.filePaths.length!==1)return {canceled:true};
      const repo=await dialog.showOpenDialog(setupWindow,{
        title:'Choose trusted QA Git checkout at the exact approved baseline',
        properties:['openDirectory']
      });
      if(repo.canceled||repo.filePaths.length!==1)return {canceled:true};
      const approved=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — do not execute','Execute one isolated offline Docker pytest run'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Run a ONE-TIME independent sandbox test?',
        detail:'The exact candidate will be reverified with Central. A pinned, preinstalled '+
          'Owner-configured Docker image executes fixed pytest tests/ in an ephemeral '+
          'networkless, unprivileged container. The trusted Git checkout stays unchanged. '+
          'This creates a persistent local one-attempt audit and UNATTESTED test result. '+
          'No QA receipt, approval, Git publish, merge or production deployment occurs. '+
          'A crash/uncertain Docker cleanup must be investigated by the Owner; no automatic retry.'
      });
      if(approved.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return runIndependentQa({origin,agentId,ticketId,signer,
        bundlePath:bundle.filePaths[0],repoDir:repo.filePaths[0],
        evidenceDir:path.join(nodeDir(),'qa'),recoveryReviewOnly});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:attestQaEvidence',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — do not sign','Sign exact local QA report for Owner review'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Use this PC OS vault to sign the exact QA test report?',
        detail:'An existing, completed one-time Docker QA result and its matching '+
          'execution intent must already exist. Central ticket, QA-agent independence '+
          'and candidate head/tree are rechecked. The signed report is for offline '+
          'Owner validation against the independently approved device public key. '+
          'Signing is NOT a QA pass or Central QA receipt. No Git publish or '+
          'deployment happens; unsigned/tampered evidence is rejected.'
      });
      if(ok.response!==1)return {canceled:true};
      const recoveryReviewOnly=await frozenQaReviewStage(origin,agentId,ticketId);
      if(recoveryReviewOnly){
        const consent=await dialog.showMessageBox(setupWindow,{
          type:'warning',
          buttons:['Cancel — keep local evidence','Sign FROZEN evidence for Owner ONLY'],
          defaultId:0,cancelId:0,noLink:true,
          message:'Sign frozen candidate evidence, NOT a QA pass?',
          detail:'Independent Master failover requires separate Owner evidence review '+
            'AND separate exact candidate restoration. Signing does not unfreeze the task.'});
        if(consent.response!==1)return {canceled:true};
      }
      approvedWorkerOperator(agentId,ticketId,true);
      return attestIndependentQa({origin,agentId,ticketId,signer,
        evidenceDir:path.join(nodeDir(),'qa'),recoveryReviewOnly});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:submitQaEvidenceForOwner',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — send nothing','Send exact signed evidence for Owner review ONLY'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Upload this QA device-signed test report to Central?',
        detail:'A completed local QA test, durable attempt journal and the local '+
          'OS-vault attestation are required. Central validates the enrolled '+
          'device key, exact bytes, allowed QA project access and distinct '+
          'Developer/QA agents. Only a PENDING Owner review is created. '+
          'No QA pass, Git push, merge or deployment occurs. '+
          'If the network outcome is uncertain, retain the original request ID.'
      });
      if(ok.response!==1)return {canceled:true};
      const recoveryReviewOnly=await frozenQaReviewStage(origin,agentId,ticketId);
      if(recoveryReviewOnly){
        const consent=await dialog.showMessageBox(setupWindow,{
          type:'warning',
          buttons:['Cancel — do not upload','Upload FROZEN evidence for Owner review'],
          defaultId:0,cancelId:0,noLink:true,
          message:'Upload signed QA evidence for a FROZEN task?',
          detail:'This requests an independently reviewed QA proposal only. '+
            'Owner must approve the report AND separately restore the exact '+
            'candidate. It does not permit a QA receipt while frozen.'});
        if(consent.response!==1)return {canceled:true};
      }
      approvedWorkerOperator(agentId,ticketId,true);
      return submitQaEvidenceForOwner({origin,agentId,ticketId,signer,
        evidenceDir:path.join(nodeDir(),'qa'),recoveryReviewOnly});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:submitOwnerReviewedQaReceipt',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    workerClaimBusy=true;
    try{
      const ok=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — do not send QA receipt',
          'Request exact Owner-approved QA receipt from Central'],
        defaultId:0,cancelId:0,noLink:true,
        message:'Submit QA receipt after independent Owner approval?',
        detail:'An Owner must have separately reviewed the actual Docker '+
          'runner, original report, device public key and independent QA setup, '+
          'then explicitly approved the exact QA evidence proposal in Central. '+
          'Central rejects any missing, tampered or unapproved proof. A PASS '+
          'changes this ticket to INTEGRATING; FAIL to TEST_FAILED. '+
          'No Git push, merge or production deployment will be performed.'
      });
      if(ok.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return submitOwnerReviewedQaReceipt({origin,agentId,ticketId,signer,
        evidenceDir:path.join(nodeDir(),'qa')});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:publishReviewedGitBranch',async(event,agentId,ticketId)=>{
    verifySender(event);
    const origin=approvedWorkerOperator(agentId,ticketId);
    // The Owner must have approved the immutable Git-for-Windows executable,
    // exact GitHub repository and noninteractive OS credential helper before
    // packaging. Unconfigured installations cannot even attempt a reserve.
    validateGitPublishPolicy(gitPublishPolicy);
    workerClaimBusy=true;
    try{
      const bundle=await dialog.showOpenDialog(setupWindow,{
        title:'Choose SAME offline QA-reviewed Git bundle (.bundle)',
        properties:['openFile'],
        filters:[{name:'SUTRADHAR reviewed Git bundle',extensions:['bundle']}]
      });
      if(bundle.canceled||bundle.filePaths.length!==1)return {canceled:true};
      const repo=await dialog.showOpenDialog(setupWindow,{
        title:'Choose your trusted baseline Git checkout (will NOT be modified)',
        properties:['openDirectory']
      });
      if(repo.canceled||repo.filePaths.length!==1)return {canceled:true};
      const approved=await dialog.showMessageBox(setupWindow,{
        type:'warning',
        buttons:['Cancel — no remote Git write',
          'Reserve and create ONE exact remote branch (NO MERGE)'],
        defaultId:0,cancelId:0,noLink:true,
        message:'PUBLISH exact Owner-reviewed candidate to GitHub?',
        detail:'Repository: '+gitPublishPolicy.allowed_repository+
          '\nQA agent: '+agentId+'\nTicket: '+ticketId+
          '\nThis is a REAL one-time GitHub branch creation, NOT a preview. '+
          'Central must already have an independent Owner-reviewed PASS receipt. '+
          'The selected bundle and local QA report are verified again; '+
          'remote base must match the approved baseline, destination must be ABSENT. '+
          'After reservation, an interruption or uncertain result permanently '+
          'blocks automatic retry and requires Owner remote reconciliation. '+
          'Git Credential Manager must already hold a scoped permission. '+
          'No GitHub PR, merge, main push, deployment or release signing occurs.'
      });
      if(approved.response!==1)return {canceled:true};
      approvedWorkerOperator(agentId,ticketId,true);
      return publishReviewedCandidate({origin,agentId,ticketId,signer,
        bundlePath:bundle.filePaths[0],repoDir:repo.filePaths[0],
        evidenceDir:path.join(nodeDir(),'qa')});
    }finally{workerClaimBusy=false;}
  });
  ipcMain.handle('sutradhar:checkUpdateReadiness',async event=>{
    verifySender(event);
    if(!app.isPackaged||!current||!vault||!signer)
      throw Error('UPDATE_READINESS_REQUIRES_PACKAGED_CONFIGURED_PC');
    const node=vault.read();
    if(!node||!requireSubmitted({
      dir:nodeDir(),node,centralUrl:current.centralUrl
    }))throw Error('UPDATE_READINESS_REQUIRES_ENROLLED_IDENTITY');
    return checkReadiness({centralOrigin:current.centralUrl,
      nodeId:node.node_id,agentIds:current.agentIds,signer});
  });
  ipcMain.handle('sutradhar:isolateDrainedPc',async event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('MAINTENANCE_ISOLATION_REQUIRES_PACKAGED_WINDOWS_PC');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,centralUrl:current.centralUrl}))
      throw Error('MAINTENANCE_ISOLATION_REQUIRES_ENROLLED_IDENTITY');
    const confirmation=await dialog.showMessageBox(setupWindow,{
      type:'warning',
      buttons:['Cancel — keep agent running','Verify Owner drain and stop local agent'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Isolate this PC for Owner maintenance?',
      detail:'Only a signed Central DRAINED fence for this non-Master/non-backup PC will be accepted. A persistent recovery hold will prevent future automatic agent starts. No installer runs. Owner-assisted recovery is required.'
    });
    if(confirmation.response!==1)return {canceled:true,agent_stopped:false};
    const isolated=await isolateDrainedPc({dir:nodeDir(),
      centralOrigin:current.centralUrl,nodeId:node.node_id,
      agentIds:current.agentIds,signer});
    // Persisted hold precedes termination. Its existence also rejects the
    // already-installed auto-restart timer on the child-process exit path.
    if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
    const target=agent;
    // Bind authority to exactly the child the Owner explicitly chose to
    // stop. Timeout/error clears this expectation but NEVER clears the
    // durable maintenance hold or an unretired child-session marker.
    expectedMaintenanceStopChild=null;
    try{
      const stopped=await requestStopAndConfirm(target,{
        timeoutMs:12000,
        onStopAccepted:acceptedChild=>{
          if(acceptedChild===target&&agent===target)
            expectedMaintenanceStopChild=target;
        }
      });
      // A failed/uncertain stop does not erase the persisted hold. The agent
      // cannot auto-restart; Owner must review the actual local process.
      return {...isolated,...stopped};
    }finally{
      if(expectedMaintenanceStopChild===target)
        expectedMaintenanceStopChild=null;
    }
  });
  ipcMain.handle('sutradhar:checkMaintenanceRecovery',async event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('MAINTENANCE_RECOVERY_REQUIRES_PACKAGED_WINDOWS_PC');
    const node=vault.read();
    if(!node||!requireSubmitted({
      dir:nodeDir(),node,centralUrl:current.centralUrl
    }))throw Error('MAINTENANCE_RECOVERY_REQUIRES_ENROLLED_IDENTITY');
    return checkRecovery({dir:nodeDir(),centralOrigin:current.centralUrl,
      nodeId:node.node_id,signer});
  });
  ipcMain.handle('sutradhar:releaseMaintenanceHold',async event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('RECOVERY_RELEASE_REQUIRES_PACKAGED_WINDOWS_PC');
    // The tracked child reference is cleared ONLY by the observed exit
    // callback. signalCode/kill() do not prove that the process has exited.
    if(agent)
      throw Error('RECOVERY_RELEASE_AGENT_EXIT_NOT_CONFIRMED');
    if(postInstallBusy||failedInstallReviewBusy||failedRecoveryApprovalBusy||installerExecutionBusy||installerPreparationBusy)
      throw Error('RECOVERY_RELEASE_INSTALL_OPERATION_IN_PROGRESS');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,centralUrl:current.centralUrl}))
      throw Error('RECOVERY_RELEASE_REQUIRES_ENROLLED_IDENTITY');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'maintenance-release-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       typeof trust.public_key_pem!=='string')
      throw Error('RECOVERY_RELEASE_OWNER_TRUST_NOT_CONFIGURED');
    const confirm=await dialog.showMessageBox(setupWindow,{
      type:'warning',buttons:['Cancel','Verify signed Owner grant and archive hold'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Owner-authorized maintenance hold release?',
      detail:'The local hold is archived only after checking the Owner Ed25519 grant and Central cancellation twice. Agent remains blocked pending separate reconciliation. No installer executes.'
    });
    if(confirm.response!==1)return {canceled:true};
    const selected=await dialog.showOpenDialog(setupWindow,{
      title:'Select exact Owner-signed maintenance release grant',
      properties:['openFile'],filters:[{name:'Owner release grant JSON',extensions:['json']}]
    });
    if(selected.canceled||selected.filePaths.length!==1)return {canceled:true};
    return releaseHold({dir:nodeDir(),centralOrigin:current.centralUrl,
      nodeId:node.node_id,signer,agentStopped:true,
      node,agentIds:current.agentIds,currentVersion:app.getVersion(),
      installedExecutable:app.getPath('exe'),platform:process.platform,
      publisherSubject:JSON.parse(fs.readFileSync(
        path.join(__dirname,'update-trust.json'),'utf8')).publisher_subject,
      pinnedPublicKeyPem:trust.public_key_pem,
      grantEnvelope:boundedFile(selected.filePaths[0])});
  });
  ipcMain.handle('sutradhar:restartAfterMaintenance',async event=>{
    verifySender(event);
    if(maintenanceRestartBusy)
      throw Error('MAINTENANCE_RESTART_OPERATION_ALREADY_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('MAINTENANCE_RESTART_REQUIRES_PACKAGED_WINDOWS_PC');
    // Only the observed child exit callback clears the tracked child.
    if(agent||shuttingDown)
      throw Error('MAINTENANCE_RESTART_AGENT_EXIT_NOT_CONFIRMED');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
       centralUrl:current.centralUrl}))
      throw Error('MAINTENANCE_RESTART_REQUIRES_ENROLLED_IDENTITY');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'maintenance-release-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       typeof trust.public_key_pem!=='string')
      throw Error('MAINTENANCE_RESTART_OWNER_TRUST_UNCONFIGURED');
    const confirmed=await dialog.showMessageBox(setupWindow,{
      type:'warning',
      buttons:['Cancel','Verify one-time grant and manually restart agent'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Owner-authorized maintenance recovery restart?',
      detail:'The exact released PC, signed grant, live Central roles, and idle work are checked. An irreversible attempt is recorded before starting. A new Central heartbeat is mandatory. Automatic retries remain blocked.'
    });
    if(confirmed.response!==1)return {canceled:true};
    const picked=await dialog.showOpenDialog(setupWindow,{
      title:'Select separately signed Owner one-time restart grant JSON',
      properties:['openFile'],
      filters:[{name:'Maintenance restart grant',extensions:['json']}]
    });
    if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
    maintenanceRestartBusy=true;
    let startedChild=null;
    try{
      const prepared=await prepareManualRestart({
        dir:nodeDir(),centralOrigin:current.centralUrl,
        nodeId:node.node_id,agentIds:current.agentIds,signer,
        pinnedPublicKeyPem:trust.public_key_pem,
        grantEnvelope:boundedFile(picked.filePaths[0])
      });
      if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
      const startedAtMs=Date.now();
      startedChild=startAgent({manualOwnerRestart:true});
      if(!startedChild)
        throw Error('MAINTENANCE_RESTART_CHILD_START_UNCONFIRMED');
      const ack=await waitForFreshAck({
        dir:nodeDir(),nodeId:node.node_id,agentIds:current.agentIds,
        epoch:prepared.epoch,startedAtMs,
        isChildActive:()=>agent===startedChild&&
          startedChild.exitCode===null&&startedChild.signalCode===null
      });
      if(!ack.confirmed)
        throw Error('MAINTENANCE_RESTART_ACK_NOT_CONFIRMED_'+ack.reason);
      await confirmLiveCentral({centralOrigin:current.centralUrl,
        nodeId:node.node_id,agentIds:current.agentIds,signer,
        epoch:prepared.epoch});
      if(agent!==startedChild||startedChild.exitCode!==null||
         startedChild.signalCode!==null)
        throw Error('MAINTENANCE_RESTART_CHILD_EXITED_DURING_RECONCILIATION');
      recordFreshAck({dir:nodeDir(),nodeId:node.node_id,
        grantId:prepared.grant_id,ack});
      return {reconciled:true,node_id:node.node_id,
        epoch:prepared.epoch,restart_grant_id:prepared.grant_id,
        central_heartbeat_observed:true,
        independent_central_state_confirmed:true,
        automatic_restart_allowed:false,
        persistent_barrier_retained:true,installer_executed:false};
    }catch(e){
      // On uncertain recovery, try to stop the one child this operation
      // launched. No receipt is deleted and no retry is scheduled.
      if(startedChild&&agent===startedChild){
        const stopped=await requestStopAndConfirm(startedChild,{timeoutMs:12000});
        if(!stopped.agent_stopped)
          throw Error('MAINTENANCE_RESTART_FAILED_AGENT_STOP_UNCONFIRMED_OWNER_REVIEW');
      }
      throw e;
    }finally{maintenanceRestartBusy=false;}
  });
  ipcMain.handle('sutradhar:approveFailedInstallReview',async event=>{
    verifySender(event);
    if(failedRecoveryApprovalBusy||failedInstallReviewBusy||postInstallBusy||
       installerExecutionBusy||installerPreparationBusy||maintenanceRestartBusy)
      throw Error('FAILURE_EXCEPTION_OPERATION_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('FAILURE_EXCEPTION_PACKAGED_WINDOWS_REQUIRED');
    // A prior kill/signal alone is not proof the tracked agent exited.
    if(agent||shuttingDown)
      throw Error('FAILURE_EXCEPTION_AGENT_EXIT_UNCONFIRMED');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
      centralUrl:current.centralUrl}))
      throw Error('FAILURE_EXCEPTION_ENROLLED_DEVICE_REQUIRED');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'failure-review-trust.json'),'utf8'));
    const updates=JSON.parse(fs.readFileSync(
      path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       typeof trust.public_key_pem!=='string'||
       updates.schema!==1||updates.status!=='OWNER_PROTECTED_RELEASE'||
       updates.channel!=='stable'||typeof updates.publisher_subject!=='string')
      throw Error('FAILURE_EXCEPTION_OWNER_TRUST_NOT_PROVISIONED');
    const confirm=await dialog.showMessageBox(setupWindow,{
      type:'warning',
      buttons:['Cancel','Record Owner review only (NO RELEASE)'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Review cancelled Windows installation without unlocking this PC?',
      detail:'Requires signed old-version diagnostic, a SECOND Owner-signed short-lived review grant, fresh Central cancellation and healthy idle cluster. It only writes a one-time review receipt. It cannot restart agents, roll back, retry installation, or release the local hold.'
    });
    if(confirm.response!==1)return {canceled:true};
    const picked=await dialog.showOpenDialog(setupWindow,{
      title:'Select Owner-signed failed-install REVIEW grant',
      properties:['openFile'],
      filters:[{name:'Owner incident review grant',extensions:['json']}]
    });
    if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
    failedRecoveryApprovalBusy=true;
    try{
      return await prepareFailedInstallRecoveryReview({dir:nodeDir(),node,
        agentIds:current.agentIds,observedVersion:app.getVersion(),
        installedExecutable:app.getPath('exe'),
        publisherSubject:updates.publisher_subject,
        centralOrigin:current.centralUrl,signer,
        grantEnvelope:boundedFile(picked.filePaths[0]),
        pinnedOwnerPublicKeyPem:trust.public_key_pem,
        platform:process.platform});
    }finally{failedRecoveryApprovalBusy=false;}
  });
  ipcMain.handle('sutradhar:reviewFailedInstall',async event=>{
    verifySender(event);
    if(failedInstallReviewBusy||postInstallBusy||installerExecutionBusy||
       installerPreparationBusy||maintenanceRestartBusy)
      throw Error('INSTALL_FAILURE_REVIEW_OPERATION_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('INSTALL_FAILURE_REVIEW_PACKAGED_WINDOWS_REQUIRED');
    if(agent||shuttingDown)
      throw Error('INSTALL_FAILURE_REVIEW_AGENT_MUST_REMAIN_STOPPED');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
       centralUrl:current.centralUrl}))
      throw Error('INSTALL_FAILURE_REVIEW_ORIGINAL_DEVICE_IDENTITY_REQUIRED');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       trust.channel!=='stable'||typeof trust.publisher_subject!=='string')
      throw Error('INSTALL_FAILURE_REVIEW_PINNED_PUBLISHER_REQUIRED');
    const answer=await dialog.showMessageBox(setupWindow,{
      type:'warning',buttons:['Cancel','Record diagnostic — NO RECOVERY'],
      cancelId:0,defaultId:0,noLink:true,
      message:'Record an uncertain or canceled Windows installer attempt?',
      detail:'This checks the unchanged old installed version, device identity, local signed launch evidence and Central DRAINED state. It does NOT determine NSIS exit code, release the hold, launch rollback, or permit automatic retry.'
    });
    if(answer.response!==1)return {canceled:true};
    failedInstallReviewBusy=true;
    try{
      return await observeFailedAttempt({dir:nodeDir(),node,
        agentIds:current.agentIds,observedVersion:app.getVersion(),
        installedExecutable:app.getPath('exe'),
        publisherSubject:trust.publisher_subject,
        centralOrigin:current.centralUrl,signer,
        platform:process.platform});
    }finally{failedInstallReviewBusy=false;}
  });
  ipcMain.handle('sutradhar:observePostInstall',async event=>{
    verifySender(event);
    if(postInstallBusy||installerExecutionBusy||installerPreparationBusy||
       maintenanceRestartBusy)
      throw Error('POSTINSTALL_ANOTHER_OPERATION_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('POSTINSTALL_PACKAGED_WINDOWS_PC_REQUIRED');
    if(agent||shuttingDown)
      throw Error('POSTINSTALL_LOCAL_AGENT_MUST_REMAIN_STOPPED');
    const device=vault.read();
    if(!device||!requireSubmitted({dir:nodeDir(),node:device,
      centralUrl:current.centralUrl}))
      throw Error('POSTINSTALL_EXISTING_ENROLLED_VAULT_REQUIRED');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       trust.channel!=='stable'||typeof trust.publisher_subject!=='string')
      throw Error('POSTINSTALL_OWNER_PUBLISHER_NOT_CONFIGURED');
    postInstallBusy=true;
    try{
      return await observePostInstall({dir:nodeDir(),node:device,
        agentIds:current.agentIds,observedVersion:app.getVersion(),
        installedExecutable:app.getPath('exe'),
        publisherSubject:trust.publisher_subject,
        centralOrigin:current.centralUrl,signer,
        platform:process.platform});
    }finally{postInstallBusy=false;}
  });
  ipcMain.handle('sutradhar:inspectPersistentInstallerObserver',event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault)
      throw Error('INSTALL_OBSERVER_PACKAGED_WINDOWS_REQUIRED');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
      centralUrl:current.centralUrl}))
      throw Error('INSTALL_OBSERVER_ENROLLED_DEVICE_REQUIRED');
    return inspectObserverWitness({dir:nodeDir(),node,
      agentIds:current.agentIds});
  });
  ipcMain.handle('sutradhar:inspectDirectInstallerExit',event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault)
      throw Error('INSTALL_DIRECT_EXIT_REQUIRES_PACKAGED_WINDOWS_PC');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
      centralUrl:current.centralUrl}))
      throw Error('INSTALL_DIRECT_EXIT_ENROLLED_DEVICE_REQUIRED');
    return inspectDirectExitFromJournals({dir:nodeDir(),node,
      agentIds:current.agentIds,observedVersion:app.getVersion()});
  });
  ipcMain.handle('sutradhar:inspectPostUpdateIdentity',event=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault)
      throw Error('UPDATE_IDENTITY_POSTCHECK_PACKAGED_WINDOWS_REQUIRED');
    const device=vault.read();
    if(!device||!requireSubmitted({dir:nodeDir(),node:device,
      centralUrl:current.centralUrl}))
      throw Error('UPDATE_IDENTITY_POSTCHECK_ENROLLED_DEVICE_REQUIRED');
    return inspectPreparedIdentity({dir:nodeDir(),node:device,
      agentIds:current.agentIds,observedVersion:app.getVersion()});
  });
  ipcMain.handle('sutradhar:launchStagedInstaller',async event=>{
    verifySender(event);
    if(installerExecutionBusy||installerPreparationBusy||maintenanceRestartBusy)
      throw Error('UPDATE_EXECUTION_OPERATION_ALREADY_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('UPDATE_EXECUTION_REQUIRES_PACKAGED_WINDOWS_PC');
    // An exit signal is NOT enough: the tracked agent reference must be null.
    if(agent||shuttingDown)
      throw Error('UPDATE_EXECUTION_AGENT_EXIT_UNCONFIRMED');
    const node=vault.read();
    if(!node||!requireSubmitted({dir:nodeDir(),node,
      centralUrl:current.centralUrl}))
      throw Error('UPDATE_EXECUTION_ENROLLED_VAULT_REQUIRED');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'installer-execution-trust.json'),'utf8'));
    const updates=JSON.parse(fs.readFileSync(
      path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       typeof trust.public_key_pem!=='string'||
       updates.schema!==1||updates.status!=='OWNER_PROTECTED_RELEASE'||
       updates.channel!=='stable'||typeof updates.publisher_subject!=='string')
      throw Error('UPDATE_EXECUTION_OWNER_TRUST_UNCONFIGURED');
    const confirmation=await dialog.showMessageBox(setupWindow,{
      type:'warning',buttons:['Cancel','Owner approved — launch interactive installer'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Launch the exact Owner-authorized Windows installer?',
      detail:'This action may change Windows software. It requires a SECOND independent, short-lived Owner signing grant, an unchanged local hold, the staged signed EXE and fresh Central DRAINED evidence. A one-shot journal prevents automatic retry. Windows UAC and setup prompts remain visible; SUTRADHAR will quit when process launch is confirmed. Installation success is NOT proven.'
    });
    if(confirmation.response!==1)return {canceled:true};
    const picked=await dialog.showOpenDialog(setupWindow,{
      title:'Select Owner-signed one-time installer execution grant JSON',
      properties:['openFile'],filters:[{name:'Owner execution grant',extensions:['json']}]
    });
    if(picked.canceled||picked.filePaths.length!==1)return {canceled:true};
    installerExecutionBusy=true;
    try{
      const grantEnvelope=boundedFile(picked.filePaths[0]);
      const result=await launchStagedInstaller({dir:nodeDir(),
        node,agentIds:current.agentIds,observedVersion:app.getVersion(),
        centralOrigin:current.centralUrl,signer,grantEnvelope,
        pinnedExecutionPublicKeyPem:trust.public_key_pem,
        publisherSubject:updates.publisher_subject,platform:process.platform});
      // No automatic retries. The installer runs in its own visible Windows
      // process; Electron quits to avoid locking installed binaries.
      if(result.launched) setTimeout(()=>app.quit(),600);
      return result;
    }finally{installerExecutionBusy=false;}
  });
  ipcMain.handle('sutradhar:prepareInstaller',async event=>{
    verifySender(event);
    if(installerPreparationBusy)
      throw Error('UPDATE_PREPARE_ALREADY_IN_PROGRESS');
    if(process.platform!=='win32'||!app.isPackaged||!current||!vault||!signer)
      throw Error('UPDATE_PREPARE_REQUIRES_PACKAGED_WINDOWS_PC');
    // Child reference is only cleared in the observed child exit callback.
    if(agent||shuttingDown||maintenanceRestartBusy)
      throw Error('UPDATE_PREPARE_AGENT_EXIT_NOT_CONFIRMED');
    const device=vault.read();
    if(!device||!requireSubmitted({dir:nodeDir(),node:device,
      centralUrl:current.centralUrl}))
      throw Error('UPDATE_PREPARE_ENROLLED_IDENTITY_REQUIRED');
    const trust=JSON.parse(fs.readFileSync(
      path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
       trust.channel!=='stable'||typeof trust.public_key_pem!=='string'||
       typeof trust.publisher_subject!=='string')
      throw Error('UPDATE_PREPARE_OWNER_TRUST_UNCONFIGURED');
    const response=await dialog.showMessageBox(setupWindow,{
      type:'warning',buttons:['Cancel','Verify and stage only — NO INSTALL'],
      defaultId:0,cancelId:0,noLink:true,
      message:'Stage a signed Windows installer for Owner review?',
      detail:'Requires the exact Owner DRAINED Central fence, a persistent local hold, an exited agent, an approved signed update/rollback offer and Authenticode publisher. Creates a one-shot local escrow; never runs the installer. An interrupted attempt requires Owner intervention.'
    });
    if(response.response!==1)return {canceled:true};
    const selected=await dialog.showOpenDialog(setupWindow,{
      title:'Select exact Owner-signed update or emergency rollback offer JSON',
      properties:['openFile'],filters:[{name:'Owner signed offer',extensions:['json']}]
    });
    if(selected.canceled||selected.filePaths.length!==1)return {canceled:true};
    installerPreparationBusy=true;
    try{
      const offerFile=selected.filePaths[0];
      const st=fs.lstatSync(offerFile);
      if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>32768)
        throw Error('UPDATE_PREPARE_OFFER_FILE_INVALID');
      const envelope=JSON.parse(fs.readFileSync(offerFile,'utf8'));
      const installer=path.join(path.dirname(offerFile),
        String(envelope?.signed?.filename||'INVALID'));
      return await prepareInstaller({dir:nodeDir(),installerPath:installer,
        envelope,node:device,agentIds:current.agentIds,
        centralOrigin:current.centralUrl,signer,
        currentVersion:app.getVersion(),pinnedPublicKeyPem:trust.public_key_pem,
        publisherSubject:trust.publisher_subject,platform:process.platform});
    }finally{installerPreparationBusy=false;}
  });
  ipcMain.handle('sutradhar:verifyLocalUpdate',async(event)=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged)
      throw Error('Offline signed update verification requires an approved packaged Windows app.');
    if(!current||!vault)throw Error('UPDATE_REQUIRES_CONFIGURED_OS_VAULT_IDENTITY');
    const device=vault.read();
    if(!device||!requireSubmitted({
      dir:nodeDir(),node:device,centralUrl:current.centralUrl
    }))throw Error('UPDATE_REQUIRES_EXISTING_ENROLLED_DEVICE');
    const trust=JSON.parse(fs.readFileSync(path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
      typeof trust.public_key_pem!=='string'||typeof trust.publisher_subject!=='string')
      throw Error('UPDATE_TRUST_NOT_CONFIGURED. An Owner-signed production release is required.');
    const selected=await dialog.showOpenDialog(setupWindow,{
      title:'Select Owner-signed update offer JSON (inspection only)',
      properties:['openFile'],filters:[{name:'Signed update JSON',extensions:['json']}]
    });
    if(selected.canceled||selected.filePaths.length!==1)return {canceled:true};
    const offerStat=fs.statSync(selected.filePaths[0]);
    if(!offerStat.isFile()||offerStat.size>32768||offerStat.size<100)
      throw Error('UPDATE_OFFER_FILE_INVALID_OR_TOO_LARGE');
    const signed=JSON.parse(fs.readFileSync(selected.filePaths[0],'utf8'));
    const installer=path.join(path.dirname(selected.filePaths[0]),
      String(signed?.signed?.filename||'INVALID'));
    const kind=signed?.signed?.type==='rollback'?'rollback':'update';
    const verified=verifyOffer({envelope:signed,pinnedPublicKeyPem:trust.public_key_pem,
      installerPath:installer,currentVersion:app.getVersion(),nodeId:device.node_id,
      protocol:7,publisherSubject:trust.publisher_subject,rolloutApproved:true,kind});
    if(!verified.accepted)throw Error(String(verified.error_code));
    verifyWindowsPublisher({installerPath:installer,
      publisherSubject:trust.publisher_subject,
      expectedSha256:verified.file_sha256});
    // A signed LOCAL INSPECTION receipt is not an installation/release approval.
    // Record once; an interrupted/corrupted journal must never be overwritten.
    const record=recordInspection({dir:nodeDir(),node:device,
      centralOrigin:current.centralUrl,envelope:signed,verified,
      currentVersion:app.getVersion(),authenticodeVerified:true});
    return {verifiedOffline:true,installed:false,version:verified.version,
      kind,waveId:verified.wave_id,nodeId:verified.device_node_id,
      sha256:verified.file_sha256,inspectionReceiptId:record.receipt_id,
      alreadyInspected:record.previously_inspected,ownerInstallApproval:false,
      nextAction:'Owner must separately approve installation/recovery; this tool never runs an installer.'};
  });
  ipcMain.handle('sutradhar:openProvider',(event,provider)=>{
    verifySender(event);
    if(!Object.prototype.hasOwnProperty.call(trustedProviders,provider))
      throw Error('Provider not allowed');
    return shell.openExternal(trustedProviders[provider],{activate:true}).then(()=>({opened:true}));
  });
  // Restart an already enrolled agent automatically. An un-enrolled machine
  // must re-enter a short-lived grant rather than persisting it on disk.
  if(current&&(fs.existsSync(enrollmentReceiptPath())||
      fs.existsSync(legacyEnrollmentMarker()))){
    try{startAgent();}catch{ /* Status UI shows Owner-required enrollment recovery. */ }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'SUTRADHAR',submenu:[
      {label:'Setup / device status',click:showSetup},
      {label:'Central dashboard',click:()=>{try{showDashboard();}catch{showSetup();}}},
      {type:'separator'},
      {label:'ChatGPT Web (manual)',click:()=>shell.openExternal(trustedProviders.chatgpt)},
      {label:'Google AI Studio (manual)',click:()=>shell.openExternal(trustedProviders.ai_studio)},
      {type:'separator'},{label:'Quit and stop agent',click:confirmQuit}]},
    {label:'Edit',submenu:[{role:'copy'},{role:'paste'},{role:'selectAll'}]}
  ]));
  createTray().catch(()=>{/* Tray unavailable: app will exit when all windows close. */});
  showSetup();
});
app.on('before-quit',event=>{
  if(quitCompletionStarted)return;
  shuttingDown=true;
  if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
  if(!agent||agent.exitCode!==null){quitCompletionStarted=true;return;}
  // Give the supervised child a bounded opportunity to emit a REAL exit
  // before Electron quits. Timeout/failed kill leaves the durable marker.
  event.preventDefault();
  const target=agent;
  // No exit-retirement authority until THIS child's kill() request is
  // positively accepted. A preexisting signalCode is not a stop receipt.
  expectedQuitChild=null;
  let finished=false;
  const finish=()=>{
    if(finished)return;finished=true;
    clearTimeout(timer);
    if(expectedQuitChild===target)expectedQuitChild=null;
    quitCompletionStarted=true;
    app.quit();
  };
  target.once('exit',finish);
  const timer=setTimeout(finish,12000);
  try{
    if(target.signalCode===null&&target.kill()===true)
      expectedQuitChild=target;
  }catch{expectedQuitChild=null;}
});
app.on('window-all-closed',()=>{if(!tray&&process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)showSetup();});
