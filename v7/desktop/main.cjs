const {app,BrowserWindow,Menu,shell,dialog}=require('electron');
const central=process.env.SUTRADHAR_CENTRAL_URL;
if(!central||!/^https:\/\//.test(central))throw new Error('HTTPS SUTRADHAR_CENTRAL_URL required');
function create(){
  const win=new BrowserWindow({width:1280,height:850,webPreferences:{
    nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true
  }});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(ev,url)=>{
    if(new URL(url).origin!==new URL(central).origin){ev.preventDefault();shell.openExternal(url);}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'SUTRADHAR',submenu:[{label:'Dashboard',click:()=>win.loadURL(central)},
      {label:'ChatGPT Web (manual)',click:()=>shell.openExternal('https://chatgpt.com/')},
      {label:'Google AI Studio (manual)',click:()=>shell.openExternal('https://aistudio.google.com/')},
      {type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'reload'},{role:'toggleDevTools'}]}
  ]));
  win.loadURL(central).catch(e=>dialog.showErrorBox('Control plane connection failed',String(e)));
}
app.whenReady().then(create);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)create();});
