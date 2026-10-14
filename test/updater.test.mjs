import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {UpdateController}=require('../desktop/updater.cjs');
class FakeUpdater extends EventEmitter{
 checks=0;downloads=0;installs=[];
 async checkForUpdates(){this.checks++;this.emit('checking-for-update');this.emit('update-available',{version:'0.5.0'});}
 async downloadUpdate(){this.downloads++;this.emit('download-progress',{percent:45});this.emit('update-downloaded',{version:'0.5.0'});}
 quitAndInstall(...args){this.installs.push(args);}
}
test('updates require explicit download and install; preserve data by preparing only at install',async()=>{
 const updater=new FakeUpdater();let prepared=0;const states=[];const controller=new UpdateController({updater,currentVersion:'0.4.0',supported:true,notify:s=>states.push(s),beforeInstall:async()=>{prepared++;}});
 assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);assert.equal(updater.allowPrerelease,false);
 await controller.install();await controller.download();assert.equal(updater.downloads,0);assert.equal(prepared,0);
 await controller.check();assert.equal(controller.state.status,'available');assert.equal(updater.downloads,0);assert.equal(prepared,0);
 await controller.download();assert.equal(controller.state.status,'ready');assert.equal(updater.installs.length,0);assert.equal(prepared,0);assert.ok(states.some(s=>s.progress===45));
 await controller.check();assert.equal(updater.checks,1);await controller.install();assert.equal(prepared,1);assert.deepEqual(updater.installs,[[false,true]]);
});
test('offline errors can be retried and an unpacked ZIP never starts auto-update',async()=>{
 const updater=new FakeUpdater();const unsupported=new UpdateController({updater,currentVersion:'0.4.0',supported:false});await unsupported.check();await unsupported.download();await unsupported.install();assert.equal(updater.checks,0);assert.equal(updater.downloads,0);assert.deepEqual(updater.installs,[]);
 const other=new FakeUpdater();const controller=new UpdateController({updater:other,currentVersion:'0.4.0',supported:true});other.checkForUpdates=async()=>{throw Error('offline');};await controller.check();assert.equal(controller.state.status,'error');other.checkForUpdates=async()=>other.emit('update-not-available');await controller.check();assert.equal(controller.state.status,'current');
 other.emit('error',Error('network'));assert.equal(controller.state.status,'error');
});
