const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('arkDesktop',{
 getUpdateState:()=>ipcRenderer.invoke('ark:update-get'),
 checkForUpdates:()=>ipcRenderer.invoke('ark:update-check'),
 downloadUpdate:()=>ipcRenderer.invoke('ark:update-download'),
 installUpdate:()=>ipcRenderer.invoke('ark:update-install'),
 onUpdateState:callback=>{ipcRenderer.on('ark:update-state',(_event,state)=>callback(state));},
 openDataFolder:()=>ipcRenderer.invoke('ark:open-data-folder'),
 onLibrariesLocked:callback=>{ipcRenderer.on('ark:libraries-locked',()=>callback());},
});
