const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
let server,window,dir;
app.whenReady().then(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'ark-theme-preview-'));
 const {startLocalApp}=await import('../server.mjs');server=await startLocalApp({dataDir:dir});
 window=new BrowserWindow({width:1280,height:900,backgroundColor:'#f4effb',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const errors=[];window.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
 await window.loadURL(server.url);
 await window.webContents.executeJavaScript(`(async()=>{
  await document.fonts.ready;
  await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
  const deadline=Date.now()+10000;
  while(document.querySelector('#library-select').options.length===0){if(Date.now()>deadline)throw Error('Album failed to initialize');await new Promise(resolve=>setTimeout(resolve,50));}
  if(!document.querySelector('.brand-mascot').naturalWidth)throw Error('Logo did not load');
  if(document.querySelectorAll('img[src=\"/mascot.png\"]').length!==1)throw Error('Logo should appear only once inside the album');
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 })()`);
 await require('./verify-navigation.cjs').verifyNavigation(window,server);
 await require('./verify-folder-preview.cjs').verifyFolderPreview(window);
 await require('./verify-encryption.cjs').verifyEncryption(window,server);
 await require('./verify-original.cjs').verifyOriginal(window,server);
 if(errors.length)throw new Error(errors.join('\n'));
 const screenshot=await window.webContents.capturePage();await fs.mkdir('release',{recursive:true});await fs.writeFile('release/preview.png',screenshot.toPNG());
 window.destroy();await server.close();await fs.rm(dir,{recursive:true,force:true});console.log('Native Electron theme initialized; preview captured.');app.exit(0);
}).catch(async error=>{console.error(error);window?.destroy();await server?.close();if(dir)await fs.rm(dir,{recursive:true,force:true});app.exit(1);});
