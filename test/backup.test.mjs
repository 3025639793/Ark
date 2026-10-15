import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AlbumStore} from '../lib/store.mjs';
import {ThemeStore} from '../lib/theme.mjs';
import {createBackup} from '../lib/backup.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('complete backup restores ordinary photos, encrypted bytes, classifications and settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ark-backup-'));try{
  const directory=join(root,'data'),destination=join(root,'copies');await mkdir(destination);const store=new AlbumStore(directory);await store.init();
  const image=await store.import('default',png,'portrait.png','作品/角色',false,'角色甲');await store.protect('default',[image.id],'backup-password');const row=store.catalogs.get('default')[0],cipher=await readFile(join(directory,'default','images',row.storage));
  const vault=(await store.create({name:'整库备份',encrypted:true})).libraries.at(-1).id;const vaultPhoto=await store.import(vault,png,'vault.png');
  const plain=await store.import('default',Buffer.concat([png,Buffer.from('plain')]),'ordinary.png');const theme=new ThemeStore(directory);await theme.init();await theme.claimEgg('passport');await theme.setImage(png);
  let locked=0;const result=await createBackup(store,destination,{onLocked:()=>locked++});assert.equal(locked,1);assert.equal(store.masterKey,null);assert.equal(store.activeBackup,false);assert.ok(result.files>=5);assert.deepEqual(await readFile(join(result.directory,'default','images',row.storage)),cipher);
  const restored=new AlbumStore(result.directory);await restored.init();assert.equal(restored.list('default',{includeLocked:false})[0].id,plain.id);await restored.unlockImages('default',image.id,'backup-password','session');assert.equal(restored.list('default',{includeLocked:false}).find(row=>row.id===image.id).character,'角色甲');assert.deepEqual((await restored.file('default',image.id)).bytes,png);
  await restored.unlock(vault,'backup-password','session');assert.deepEqual((await restored.file(vault,vaultPhoto.id)).bytes,png);
  const restoredTheme=new ThemeStore(result.directory);await restoredTheme.init();assert.deepEqual(restoredTheme.state().seenEggs,['passport']);assert.deepEqual((await restoredTheme.image()).bytes,png);
  await createBackup(restored,destination);assert.equal((await readdir(destination)).filter(name=>name.endsWith('.partial')).length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('backup rejects recursive destinations and busy imports without changing original data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ark-backup-guard-'));try{
  const store=new AlbumStore(join(root,'data'));await store.init();await assert.rejects(createBackup(store,store.directory),error=>error.status===400);
  store.activeImport=true;await assert.rejects(createBackup(store,root),error=>error.status===409);store.activeImport=false;
  const file=join(root,'not-a-folder');await writeFile(file,'test');await assert.rejects(createBackup(store,file));assert.equal(store.activeBackup,false);assert.equal(store.list('default').length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
