/**
 * SUTRADHAR Desktop first-run assisted alpha:
 * local setup UI, approved Central health check, persistent per-PC config and
 * supervised signed edge agent. No unapproved provider automation.
 * Not a production-signed installer or OS-vault backed identity yet.
 */
'use strict';
const {app,BrowserWindow,Menu,shell,ipcMain,dialog}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {
  normalizeCentralUrl,cleanPcName,agentCount,agentIds,
  validateSettings,validateEnrollmentCode
}=require('./desktop-config.cjs');

let setupWindow=null,dashboardWindow=null,agent=null;
let current=null,pendingEnrollmentCode=null,shuttingDown=false,retryTimer=null,configurationCorrupt=false;
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
    ?path.join(process.resourcesPath,'edge-agent.cjs')
    :path.join(__dirname,'dist','edge-agent.cjs');
}
function safeStatus(){
  if(fs.existsSync(enrollmentMarker()))pendingEnrollmentCode=null;
  let nodeId=null;
  try{
    const identity=JSON.parse(fs.readFileSync(path.join(nodeDir(),'identity.json'),'utf8'));
    if(typeof identity.node_id==='string')nodeId=identity.node_id;
  }catch{}
  const agentProcessRunning=Boolean(agent&&agent.exitCode===null);
  let centralReport=null;
  try{
    const detail=JSON.parse(fs.readFileSync(path.join(nodeDir(),'status.json'),'utf8'));
    if(detail.node_id===nodeId){
      const accepted=typeof detail.last_accepted_at==='string'?Date.parse(detail.last_accepted_at):NaN;
      const fresh=Number.isFinite(accepted)&&accepted<=Date.now()+5000&&
        Date.now()-accepted<=180000;
      centralReport={
        acknowledgedNow:Boolean(agentProcessRunning&&fresh&&detail.connection==='ACKNOWLEDGED'),
        lastAcceptedAt:Number.isFinite(accepted)?new Date(accepted).toISOString():null,
        errorCode:typeof detail.error_code==='string'?detail.error_code:null,
        phase:typeof detail.phase==='string'?detail.phase:null,
        masterAgentId:typeof detail.master_agent_id==='string'?detail.master_agent_id:null
      };
    }
  }catch{}
  return {configured:Boolean(current),centralUrl:current?.centralUrl||null,
    pcName:current?.pcName||null,agentIds:current?.agentIds||[],
    nodeId,enrollmentRequested:fs.existsSync(enrollmentMarker()),
    agentProcessRunning,centralReport,
    signingStatus:'ALPHA_NOT_OS_VAULT_BACKED',productionReady:false};
}
function startAgent(){
  if(fs.existsSync(enrollmentMarker()))pendingEnrollmentCode=null;
  if(!current||shuttingDown||agent&&agent.exitCode===null)return;
  const script=agentScript();
  if(!fs.existsSync(script))throw Error('Edge agent not built. Developer: run npm run build:desktop at repo root.');
  if(!fs.existsSync(enrollmentMarker())&&!pendingEnrollmentCode)
    throw Error('Enter the one-time enrollment code to request Owner approval');
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',
    SUTRADHAR_CENTRAL_URL:current.centralUrl,
    SUTRADHAR_NODE_NAME:current.pcName,
    SUTRADHAR_AGENT_IDS:current.agentIds.join(','),
    SUTRADHAR_NODE_DIR:nodeDir()};
  // Never pass unrelated Central/DB/GitHub administrator secrets to a PC agent.
  for(const k of Object.keys(env))if(
    /^DB_|^DATABASE_URL$|^SUTRADHAR_ADMIN_KEY$|^SUTRADHAR_MYSQL|^SUTRADHAR_GITHUB|^TELEGRAM_/.test(k))delete env[k];
  if(pendingEnrollmentCode)env.SUTRADHAR_ENROLLMENT_CODE=pendingEnrollmentCode;
  else delete env.SUTRADHAR_ENROLLMENT_CODE;
  fs.mkdirSync(nodeDir(),{recursive:true,mode:0o700});
  const fd=fs.openSync(path.join(home(),'edge-agent.log'),'a',0o600);
  try{
    agent=spawn(process.execPath,[script],{
      env,stdio:['ignore',fd,fd],windowsHide:true
    });
  }finally{fs.closeSync(fd);}
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
  ipcMain.handle('sutradhar:openDashboard',event=>{
    verifySender(event);showDashboard();return {opened:true};
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
      {type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'copy'},{role:'paste'},{role:'selectAll'}]}
  ]));
  showSetup();
});
app.on('before-quit',()=>{
  shuttingDown=true;
  if(retryTimer)clearTimeout(retryTimer);
  if(agent&&agent.exitCode===null){try{agent.kill();}catch{}}
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)showSetup();});
