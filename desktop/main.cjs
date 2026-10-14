const { app, BrowserWindow, ipcMain, shell, powerMonitor } = require('electron');
const path = require('node:path');
app.setName('Ark');
app.setPath('userData',path.join(app.getPath('appData'),'Ark'));
let localApp, window;
const hasLock=app.requestSingleInstanceLock();
if(!hasLock)app.quit();
else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  const { startLocalApp }=await import('../server.mjs');
  const dataDir=path.join(app.getPath('userData'),'album-data');localApp=await startLocalApp({dataDir});
  window=new BrowserWindow({width:1280,height:850,minWidth:800,minHeight:600,title:'Ark · 本地相册',backgroundColor:'#f5f3f0',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'ark-local-session'}});
  const origin=localApp.url;
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  ipcMain.handle('ark:open-data-folder',async event=>{if(event.sender!==window?.webContents)return;await shell.openPath(dataDir);});
  powerMonitor.on('lock-screen',async()=>{await localApp.store.serial(()=>localApp.store.lockAll());window?.webContents.send('ark:libraries-locked');});
  await window.loadURL(origin);
  window.on('closed',()=>{window=null;});
 }).catch(error=>{require('electron').dialog.showErrorBox('Ark 无法启动',error.message);app.quit();});
 let closing=false;
 app.on('before-quit',event=>{if(localApp&&!closing){event.preventDefault();closing=true;localApp.close().finally(()=>app.quit());}});
 app.on('window-all-closed',()=>app.quit());
}
