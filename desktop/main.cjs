const { app, BrowserWindow, ipcMain, shell, powerMonitor } = require('electron');
const path = require('node:path');
const { existsSync } = require('node:fs');
const { autoUpdater } = require('electron-updater');
const { UpdateController } = require('./updater.cjs');
app.setName('Ark');
app.setPath('userData',path.join(app.getPath('appData'),'Ark'));
let localApp, window;
const hasLock=app.requestSingleInstanceLock();
if(!hasLock)app.quit();
else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  const { startLocalApp }=await import('../server.mjs');
  const { createBackup }=await import('../lib/backup.mjs');
  const dataDir=path.join(app.getPath('userData'),'album-data');localApp=await startLocalApp({dataDir});
  window=new BrowserWindow({width:1280,height:850,minWidth:800,minHeight:600,title:'Ark · 本地相册',backgroundColor:'#f4effb',autoHideMenuBar:true,icon:path.join(__dirname,'../public/mascot.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'ark-local-session'}});
  const origin=localApp.url;
  const fromApp=event=>event.sender===window?.webContents&&event.senderFrame?.url.startsWith(origin+'/');
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(localApp.store.activeImport||new URL(url).origin!==origin)event.preventDefault();});
  ipcMain.handle('ark:open-data-folder',async event=>{if(!fromApp(event))return;await shell.openPath(dataDir);});
  ipcMain.handle('ark:backup',async event=>{
   if(!fromApp(event))throw Error('请求来源无效');if(localApp.store.activeImport||localApp.store.activeBackup)throw Error('请等待导入或备份完成。');
   const result=await require('electron').dialog.showOpenDialog(window,{title:'选择备份保存位置',properties:['openDirectory','createDirectory']});if(result.canceled)return {cancelled:true};
   return createBackup(localApp.store,result.filePaths[0],{onLocked:()=>window?.webContents.send('ark:libraries-locked')});
  });
  powerMonitor.on('lock-screen',async()=>{if(localApp.store.activeImport){localApp.store.pendingLock=true;return;}await localApp.store.serial(()=>localApp.store.lockAll());window?.webContents.send('ark:libraries-locked');});
  const updates=new UpdateController({
   updater:autoUpdater,currentVersion:app.getVersion(),supported:app.isPackaged&&process.platform==='win32'&&existsSync(path.join(path.dirname(app.getPath('exe')),'.ark-installed')),
   notify:state=>{if(window&&!window.isDestroyed())window.webContents.send('ark:update-state',state);},
   beforeInstall:async()=>{if(localApp.store.activeBackup)throw Error('请等待备份完成。');await localApp.store.serial(()=>localApp.store.lockAll());window?.webContents.send('ark:libraries-locked');},
  });
  for(const [channel,operation] of [['ark:update-get',()=>updates.snapshot()],['ark:update-check',()=>updates.check()],['ark:update-download',()=>updates.download()],['ark:update-install',()=>updates.install()]]){
   ipcMain.handle(channel,event=>{if(!fromApp(event))throw new Error('请求来源无效');return operation();});
  }
  await window.loadURL(origin);
  if(updates.state.status!=='unsupported')setTimeout(()=>{if(window&&!window.isDestroyed())updates.check();},2500).unref();
  window.on('close',event=>{if(localApp.store.activeImport||localApp.store.activeBackup){event.preventDefault();require('electron').dialog.showMessageBox(window,{type:'info',message:localApp.store.activeBackup?'正在备份，请等待完成后关闭。':'正在处理图片，请等待完成后关闭。'});}});
  window.on('closed',()=>{window=null;});
 }).catch(error=>{require('electron').dialog.showErrorBox('Ark 无法启动',error.message);app.quit();});
 let closing=false;
 app.on('before-quit',event=>{if(localApp&&!closing){event.preventDefault();if(localApp.store.activeImport||localApp.store.activeBackup)return;closing=true;localApp.close().finally(()=>app.quit());}});
 app.on('window-all-closed',()=>app.quit());
}
