/**
 * SUTRADHAR Desktop first-run assisted alpha:
 * local setup UI, approved Central health check, persistent per-PC config and
 * supervised signed edge agent. No unapproved provider automation.
 * Not a production-signed installer or OS-vault backed identity yet.
 */
'use strict';
const {app,BrowserWindow,Menu,Tray,shell,ipcMain,dialog,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {verifyOffer}=require('./update-policy.cjs');
const {
  normalizeCentralUrl,cleanPcName,agentCount,agentIds,
  validateSettings,validateEnrollmentCode
}=require('./desktop-config.cjs');
const {summarizeCentralReceipt}=require('./status.cjs');
const {createVault}=require('./os-vault.cjs');
const {createSignerBridge}=require('./vault-bridge.cjs');

let setupWindow=null,dashboardWindow=null,agent=null,tray=null;
let current=null,pendingEnrollmentCode=null,shuttingDown=false,retryTimer=null,configurationCorrupt=false;
let vault=null,vaultError=null,signer=null;
const trustedProviders={
  chatgpt:'https://chatgpt.com/',
  ai_studio:'https://aistudio.google.com/'
};
function home(){return app.getPath('userData');}
function nodeDir(){return path.join(home(),'node');}
function configFile(){return path.join(home(),'desktop-settings.json');}
function enrollmentMarker(){return path.join(nodeDir(),'enrollment_requested');}
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
  if(fs.existsSync(enrollmentMarker()))pendingEnrollmentCode=null;
  let nodeId=null;
  try{nodeId=vault?.read()?.node_id||null;}catch{vaultError='OS_VAULT_IDENTITY_UNREADABLE';}
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
    nodeId,enrollmentRequested:fs.existsSync(enrollmentMarker()),
    agentProcessRunning,centralReport,startupSupported,startupEnabled,
    signingStatus:vaultError||(vault?'OS_BACKED_ENCRYPTED_ALPHA':'OS_VAULT_UNAVAILABLE'),productionReady:false};
}
function startAgent(){
  if(fs.existsSync(enrollmentMarker()))pendingEnrollmentCode=null;
  if(!current||shuttingDown||agent&&agent.exitCode===null)return;
  if(!vault||!signer)throw Error(vaultError||'OS_VAULT_UNAVAILABLE');
  const script=agentScript();
  if(!fs.existsSync(script))throw Error('Edge agent not built. Developer: run npm run build:desktop at repo root.');
  if(!fs.existsSync(enrollmentMarker())&&!pendingEnrollmentCode)
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

  agent.on('message',async msg=>{
    if(!msg||msg.type!=='vault:request'||!Number.isSafeInteger(msg.id)||
      msg.id<1||!['initialize','saveCounters','sign','grant','consumeGrant'].includes(msg.op))return;
    const reply={type:'vault:response',id:msg.id};
    try{
      if(!vault)throw Error('OS_VAULT_UNAVAILABLE');
      if(JSON.stringify(msg).length>45000)throw Error('VAULT_MESSAGE_TOO_LARGE');
      if(msg.op==='initialize')reply.result=signer.initialize(msg.payload);
      if(msg.op==='saveCounters')reply.result=signer.saveCounters(msg.payload);
      if(msg.op==='sign')reply.result=signer.sign(msg.payload);
      if(msg.op==='grant'){
        if(fs.existsSync(enrollmentMarker()))throw Error('ENROLLMENT_ALREADY_REQUESTED');
        if(!pendingEnrollmentCode)throw Error('OWNER_ENROLLMENT_GRANT_REQUIRED');
        reply.result=pendingEnrollmentCode;
      }
      if(msg.op==='consumeGrant'){pendingEnrollmentCode=null;reply.result=true;}
    }catch(e){reply.error=String(e.message||'VAULT_ERROR').slice(0,100);}
    try{agent?.send(reply);}catch{}
  });
  agent.on('error',()=>{ /* Agent stopped: operator can inspect local log. */ });
  agent.on('exit',()=>{
    agent=null;
    if(shuttingDown)return;
    if(retryTimer)clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>{
      retryTimer=null;
      try{startAgent();}catch{ /* User may need to resupply enrollment code. */ }
    },15000);
  });
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
app.whenReady().then(()=>{
  try{vault=createVault({safeStorage,dir:nodeDir()});signer=createSignerBridge(vault);}
  catch(e){vaultError=String(e.message||'OS_VAULT_UNAVAILABLE');}
  // Forget the one-time enrollment grant promptly even if the setup window closes.
  const enrollmentCleanup=setInterval(()=>{
    if(fs.existsSync(enrollmentMarker())){
      pendingEnrollmentCode=null;
      clearInterval(enrollmentCleanup);
    }
  },5000);
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
    const code=validateEnrollmentCode(payload.enrollmentCode);
    if(!vault)throw Error(vaultError||'OS_VAULT_UNAVAILABLE');
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
  ipcMain.handle('sutradhar:verifyLocalUpdate',async(event)=>{
    verifySender(event);
    if(process.platform!=='win32'||!app.isPackaged)
      throw Error('Offline signed update verification requires an approved packaged Windows app.');
    const trust=JSON.parse(fs.readFileSync(path.join(__dirname,'update-trust.json'),'utf8'));
    if(trust.schema!==1||trust.status!=='OWNER_PROTECTED_RELEASE'||
      typeof trust.public_key_pem!=='string'||typeof trust.publisher_subject!=='string')
      throw Error('UPDATE_TRUST_NOT_CONFIGURED. An Owner-signed production release is required.');
    const selected=await dialog.showOpenDialog(setupWindow,{
      title:'Select Owner-signed update offer JSON (inspection only)',
      properties:['openFile'],filters:[{name:'Signed update JSON',extensions:['json']}]
    });
    if(selected.canceled||selected.filePaths.length!==1)return {canceled:true};
    const signed=JSON.parse(fs.readFileSync(selected.filePaths[0],'utf8'));
    const installer=path.join(path.dirname(selected.filePaths[0]),
      String(signed?.signed?.filename||'INVALID'));
    const kind=signed?.signed?.type==='rollback'?'rollback':'update';
    const verified=verifyOffer({envelope:signed,pinnedPublicKeyPem:trust.public_key_pem,
      installerPath:installer,currentVersion:app.getVersion(),protocol:7,
      publisherSubject:trust.publisher_subject,rolloutApproved:true,kind});
    if(!verified.accepted)throw Error(String(verified.error_code));
    const script='$s=Get-AuthenticodeSignature -LiteralPath '+JSON.stringify(installer)+
      '; if($s.Status -ne "Valid" -or $null -eq $s.SignerCertificate){exit 42};'+
      ' if($s.SignerCertificate.Subject -cne '+JSON.stringify(trust.publisher_subject)+'){exit 43}';
    const check=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
      {timeout:30000,windowsHide:true,encoding:'utf8'});
    if(check.error||check.status!==0)throw Error('UPDATE_WINDOWS_SIGNER_VERIFICATION_FAILED');
    return {verifiedOffline:true,installed:false,version:verified.version,
      kind,sha256:verified.file_sha256,
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
  if(current&&fs.existsSync(enrollmentMarker())){
    try{startAgent();}catch{ /* Setup UI explains any missing build/runtime. */ }
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
