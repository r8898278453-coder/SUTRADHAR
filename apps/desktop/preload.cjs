'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('sutradharDesktop',Object.freeze({
  getStatus:()=>ipcRenderer.invoke('sutradhar:getStatus'),
  reconcileEnrollment:()=>ipcRenderer.invoke('sutradhar:reconcileEnrollment'),
  saveSetup:input=>ipcRenderer.invoke('sutradhar:saveSetup',input),
  setStartup:enabled=>ipcRenderer.invoke('sutradhar:setStartup',enabled),
  verifyLocalUpdate:()=>ipcRenderer.invoke('sutradhar:verifyLocalUpdate'),
  openDashboard:()=>ipcRenderer.invoke('sutradhar:openDashboard'),
  openProvider:name=>ipcRenderer.invoke('sutradhar:openProvider',name)
}));
