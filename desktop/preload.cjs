const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('arkDesktop',{
 openDataFolder:()=>ipcRenderer.invoke('ark:open-data-folder'),
 onLibrariesLocked:callback=>{ipcRenderer.on('ark:libraries-locked',()=>callback());},
});
