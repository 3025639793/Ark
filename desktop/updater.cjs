class UpdateController {
 constructor({updater,currentVersion,supported,notify=()=>{},beforeInstall=async()=>{}}){
  this.updater=updater;this.notify=notify;this.beforeInstall=beforeInstall;
  this.state={status:supported?'idle':'unsupported',currentVersion,version:'',progress:0,message:supported?'可以检查是否有新版本。':'请使用 Windows 安装版启用软件内更新。'};
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;
  updater.on('checking-for-update',()=>this.set({status:'checking',message:'正在检查更新…'}));
  updater.on('update-available',info=>this.set({status:'available',version:info.version,progress:0,message:`发现新版本 ${info.version}，可下载更新。`}));
  updater.on('update-not-available',()=>this.set({status:'current',version:'',message:'已经是最新版本。'}));
  updater.on('download-progress',info=>this.set({status:'downloading',progress:Math.max(0,Math.min(100,Number(info.percent)||0)),message:'正在下载更新…'}));
  updater.on('update-downloaded',info=>this.set({status:'ready',version:info.version,progress:100,message:'更新已下载，重启并安装后生效。'}));
  updater.on('error',()=>this.set({status:'error',message:'更新失败，请检查网络连接后重新检查更新。'}));
 }
 set(patch){this.state={...this.state,...patch};this.notify(this.snapshot());}
 snapshot(){return {...this.state};}
 async check(){
  if(['unsupported','checking','downloading','ready','installing'].includes(this.state.status))return this.snapshot();
  this.set({status:'checking',message:'正在检查更新…'});
  try{await this.updater.checkForUpdates();}catch{this.set({status:'error',message:'无法检查更新，请确认网络连接后重试。'});}return this.snapshot();
 }
 async download(){
  if(this.state.status!=='available')return this.snapshot();this.set({status:'downloading',progress:0,message:'正在下载更新…'});
  try{await this.updater.downloadUpdate();}catch{this.set({status:'error',message:'下载失败，请检查网络连接后重新检查更新。'});}return this.snapshot();
 }
 async install(){
  if(this.state.status!=='ready')return this.snapshot();this.set({status:'installing',message:'正在关闭相册并安装更新…'});
  try{await this.beforeInstall();this.updater.quitAndInstall(false,true);}catch{this.set({status:'ready',message:'无法启动安装程序，请重试或手动下载安装版。'});}return this.snapshot();
 }
}
module.exports={UpdateController};
