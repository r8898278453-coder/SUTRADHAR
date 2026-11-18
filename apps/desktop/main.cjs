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
const {recordInspection}=require('./update-inspection-journal.cjs');
const {verifyWindowsPublisher}=require('./windows-authenticode.cjs');
const {prepareInstaller,inspectPreparedIdentity}=require('./maintenance-install-preparation.cjs');
const {launchStagedInstaller}=require('./maintenance-installer-execution.cjs');
const {inspectHold}=require('./maintenance-recovery-hold.cjs');
const {isolateDrainedPc}=require('./maintenance-local-isolation.cjs');
const {requestStopAndConfirm}=require('./maintenance-stop-confirm.cjs');
const {checkRecovery}=require('./maintenance-recovery-preflight.cjs');
const {releaseHold,boundedFile}=require('./maintenance-release-executor.cjs');
const {requiresReconciliation}=require('./maintenance-reconciliation-barrier.cjs');
const {prepareManualRestart,confirmLiveCentral}=require('./maintenance-restart.cjs');
const {waitForFreshAck,recordFreshAck}=require('./maintenance-restart-ack.cjs');
const {
  normalizeCentralUrl,cleanPcName,agentCount,agentIds,
  validateSettings,validateEnrollmentCode
}=require('./desktop-config.cjs');
const {summarizeCentralReceipt}=require('./status.cjs');
const {createVault}=require('./os-vault.cjs');
const {createSignerBridge}=require('./vault-bridge.cjs');
const {enrollWithOwnerGrant}=require('./enrollment.cjs');
const {inspect:inspectEnrollment,prepare:prepareEnrollment,
  markSubmitted:markEnrollmentSubmitted,requireSubmitted,
  reconcilePrepared:reconcileEnrollment}=require('./enrollment-receipt.cjs');
const {installSingleInstanceGuard}=require('./single-instance.cjs');

let setupWindow=null,dashboardWindow=null,agent=null,tray=null;
let current=null,pendingEnrollmentCode=null,shuttingDown=false,retryTimer=null,configurationCorrupt=false;
let vault=null,vaultError=null,signer=null;
let maintenanceRestartBusy=false;
let installerPreparationBusy=false;
let installerExecutionBusy=false;
const trustedProviders={
  chatgpt:'https://chatgpt.com/',
  ai_studio:'https://aistudio.google.com/'
};
function home(){return app.getPath('userData');}
function nodeDir(){return path.join(home(),'node');}
function configFile(){return path.join(home(),'desktop-settings.json');}
function enrollmentReceiptPath(){return path.join(nodeDir(),'enrollment-receipt.json');}
function legacyEnrollmentMarker(){return path.join(nodeDir(),'enrollment_requested');}
function readSettings(){
  if(!fs.existsSync(configFile()))return null;
  return validateSettings(JSON.parse(fs.readFileSync(configFile(),'utf8')));
}
function writeSettings(x){
  fs.mkdirSync(home(),{recursive:true,mode:0o700});
  const tmp=configFile()+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(x,null,2)+'\n',{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,configFile());
  try{fs.chmodSync(configFile(),0o600);}catch{}
}
function agentScript(){
  return app.isPackaged
    ?path.join(process.resourcesPath,'secure-agent.cjs')
    :path.join(__dirname,'dist','secure-agent.cjs');
}
function safeStatus(){
  let nodeId=null,enrollmentState='NOT_REQUESTED',enrollmentError=null;
  try{nodeId=vault?.read()?.node_id||null;}catch{vaultError='OS_VAULT_IDENTITY_UNREADABLE';}
  try{
    if(current){
      const state=inspectEnrollment({dir:nodeDir(),node:vault?.read(),centralUrl:current.centralUrl});
      enrollmentState=state?.state||'NOT_REQUESTED';
      if(enrollmentState==='SUBMITTED')pendingEnrollmentCode=null;
    }
  }catch(e){enrollmentState='OWNER_REVIEW_REQUIRED';enrollmentError=String(e.message||e).slice(0,100);}
  let installerExecution='NOT_ATTEMPTED';
  try{
    if(fs.existsSync(path.join(nodeDir(),'installer-execution-attempt.json')))
      installerExecution=fs.existsSync(path.join(nodeDir(),'installer-execution-launch-observed.json'))?
        'PROCESS_STARTED_INSTALL_RESULT_UNKNOWN':'ATTEMPT_UNCERTAIN_OWNER_REVIEW';
  }catch{installerExecution='UNKNOWN_OWNER_REVIEW';}
  let installerPreparation='NONE';
  try{
    const attempt=path.join(nodeDir(),'installer-preparation-attempt.json');
    const ready=path.join(nodeDir(),'installer-preparation-ready.json');
    if(fs.existsSync(attempt)||fs.existsSync(ready))
      installerPreparation=fs.existsSync(ready)?'STAGED_NOT_INSTALLED':'INTERRUPTED_OWNER_REVIEW';
  }catch{installerPreparation='ERROR_OWNER_REVIEW';}
  let maintenanceHold='NONE';
  try{if(requiresReconciliation(nodeDir()))maintenanceHold='RELEASE_RECONCILIATION_REQUIRED';}
  catch{maintenanceHold='CORRUPT_OWNER_REVIEW_REQUIRED';}
  if(fs.existsSync(nodeDir())){
    try{const hold=inspectHold({dir:nodeDir(),nodeId});
      if(hold.active)maintenanceHold='OWNER_REVIEW_REQUIRED';}
    catch(e){maintenanceHold='CORRUPT_OWNER_REVIEW_REQUIRED';}
  }
  const agentProcessRunning=Boolean(agent&&agent.exitCode===null);
  const startupSupported=Boolean(app.isPackaged&&['win32','darwin'].includes(process.platform));
  let startupEnabled=false;
  try{if(startupSupported)startupEnabled=Boolean(app.getLoginItemSettings().openAtLogin);}catch{}
  let centralReport=null;
  try{
    const detail=JSON.parse(fs.readFileSync(path.join(nodeDir(),'status.json'),'utf8'));
    centralReport=summarizeCentralReceipt(detail,nodeId,agentProcessRunning);
  }catch{}
  return {configured:Boolean(current),centralUrl:current?.centralUrl||null,
    pcName:current?.pcName||null,agentIds:current?.agentIds||[],
    nodeId,enrollmentRequested:enrollmentState==='SUBMITTED',
    enrollmentState,enrollmentError,
    agentProcessRunning,centralReport,maintenanceHold,installerPreparation,installerExecution,startupSupported,startupEnabled,
    signingStatus:vaultError||(vault?'OS_BACKED_ENCRYPTED_ALPHA':'OS_VAULT_UNAVAILABLE'),productionReady:false};
}
function startAgent({manualOwnerRestart=false}={}){
  if(!current||shuttingDown||agent)return null;
  if(requiresReconciliation(nodeDir())&&!manualOwnerRestart)
    throw Error('MAINTENANCE_POST_RELEASE_RECONCILIATION_REQUIRED');
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
  const fd=fs.openSync(path.join(home(),'edge-agent.log'),'a',0o600);
  try{
    agent=spawn(process.execPath,[script],{
      env,stdio:['ignore',fd,fd,'ipc'],windowsHide:true
    });
  }finally{fs.closeSync(fd);}

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
    }catch(e){reply.error=String(e.message||'VAULT_ERROR').slice(0,100);}
    try{if(agent===spawnedAgent&&spawnedAgent.connected)spawnedAgent.send(reply);}catch{}
  });
  spawnedAgent.on('error',()=>{ /* Agent stopped: operator can inspect local log. */ });
  spawnedAgent.on('exit',()=>{
    if(agent!==spawnedAgent)return; // Ignore stale child exit after a replacement.
    agent=null;
    if(shuttingDown)return;
    try{if(requiresReconciliation(nodeDir()))return;}catch{return;}
    // A confirmed or uncertain maintenance stop must not schedule retries.
    // Even malformed on-disk holds require Owner review, never a restart.
    if(fs.existsSync(nodeDir())){
      try{
        if(inspectHold({dir:nodeDir(),nodeId:vault?.read()?.node_id}).active)return;
      }catch{return;}
    }
    if(retryTimer)clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>{
      retryTimer=null;
      try{startAgent();}catch{ /* User may need to resupply enrollment code. */ }
    },15000);
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
  setupWindow.on('closed',()=>{setupWindow=null;});
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
  const response=await fetch(origin+'/v7/health',{method:'GET',
    headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Central health check failed (HTTP '+response.status+'). Ask the Owner to verify Hostinger and MySQL.');
  const obj=await response.json();
  const local=JSON.parse(fs.readFileSync(path.join(__dirname,'contract.json'),'utf8'));
  if(obj.service!=='sutradhar-v7'||obj.ready!==true||obj.authority!=='mysql')
    throw Error('This is not a ready SUTRADHAR Central server');
  if(obj.api_protocol!==local.api_protocol)
    throw Error('Central/Desktop protocol mismatch. Update the compatible Desktop version first.');
}
const primaryInstance=installSingleInstanceGuard(app,()=>showSetup());
app.whenReady().then(()=>{
  if(!primaryInstance)return;
  try{vault=createVault({safeStorage,dir:nodeDir()});signer=createSignerBridge(vault);}
  catch(e){vaultError=String(e.message||'OS_VAULT_UNAVAILABLE');}
  try{current=readSettings();}catch{
    configurationCorrupt=true;
    dialog.showErrorBox('Invalid Desktop settings','Stored configuration is unreadable. Do not delete device identity; contact the Owner.');
  }
  ipcMain.handle('sutradhar:getStatus',event=>{verifySender(event);return safeStatus();});
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
    const stopped=await requestStopAndConfirm(agent,{timeoutMs:12000});
    // A failed/uncertain stop does not erase the persisted hold. The agent
    // cannot auto-restart; Owner must review the actual local process.
    return {...isolated,...stopped};
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
app.on('before-quit',()=>{
  shuttingDown=true;
  if(retryTimer)clearTimeout(retryTimer);
  if(agent&&agent.exitCode===null){try{agent.kill();}catch{}}
});
app.on('window-all-closed',()=>{if(!tray&&process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)showSetup();});
