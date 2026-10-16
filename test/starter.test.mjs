import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startLocalApp} from '../server.mjs';
import {fixturePng} from '../scripts/image-fixture.cjs';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'ark-starter-')),starterDir=join(root,'starter'),dataDir=join(root,'data');await mkdir(starterDir);
 const images=[fixturePng(16,12),fixturePng(12,16)];for(let i=0;i<images.length;i++)await writeFile(join(starterDir,`melusine-${i}.png`),images[i]);
 await writeFile(join(starterDir,'manifest.json'),JSON.stringify({version:'1',images:images.map((_,i)=>({file:`melusine-${i}.png`,title:`美露莘 ${i}`,character:i?'希格雯':'爱贝尔'}))}));
 return {root,starterDir,dataDir,images,async start(){return startLocalApp({dataDir,starterDir});}};
}
test('starter images are seeded once; encrypted and reclassified samples are removable without deleting personal imports',async()=>{
 const f=await fixture();let app;try{
  app=await f.start();const store=app.store;assert.equal(store.state().starterImages.count,2);assert.equal(store.list('default')[0].series,'原神');
  const adopted=await store.import('default',f.images[0],'personal-copy.png');assert.equal(adopted.duplicate,true);assert.equal(store.state().starterImages.count,1);
  const own=await store.import('default',fixturePng(20,20),'my-picture.png','自己的分类',false,'我的角色');
  const seeded=store.list('default').find(image=>image.id!==adopted.id&&image.id!==own.id);await store.edit('default',seeded.id,{character:'改过分类',folder:'其他文件夹'});await store.protect('default',[seeded.id],'starter-test-password');
  await app.close();app=await f.start();assert.equal(app.store.state().starterImages.count,1);assert.equal(app.store.list('default').length,3);
  const result=await app.store.serial(()=>app.store.starterCollection.remove());assert.deepEqual(result.deletedIds,[seeded.id]);assert.equal(result.cleanupFailures,0);
  assert.deepEqual((await app.store.file('default',adopted.id)).bytes,f.images[0]);assert.equal(app.store.list('default').find(image=>image.id===own.id).character,'我的角色');
  await app.close();app=await f.start();assert.equal(app.store.state().starterImages.count,0);assert.equal(app.store.list('default').length,2);
  const added=await app.store.serial(()=>app.store.starterCollection.add());assert.equal(added.added,1);assert.equal(added.skipped,1);assert.equal(app.store.state().starterImages.count,1);
 }finally{await app?.close();await rm(f.root,{recursive:true,force:true});}
});
test('existing libraries require an explicit opt-in; matching user photos never become removable samples',async()=>{
 const f=await fixture();let app;try{
  app=await startLocalApp({dataDir:f.dataDir,starterDir:null});const own=await app.store.import('default',f.images[0],'my-picture.png');await app.close();app=await f.start();
  assert.equal(app.store.state().starterImages.available,true);assert.equal(app.store.state().starterImages.count,0);assert.equal(app.store.list('default').length,1);
  const result=await app.store.serial(()=>app.store.starterCollection.add());assert.deepEqual(result,{added:1,skipped:1});await app.store.serial(()=>app.store.starterCollection.remove());assert.equal(app.store.list('default')[0].id,own.id);
 }finally{await app?.close();await rm(f.root,{recursive:true,force:true});}
});
test('failed starter catalog writes roll back new files and leave personal content intact',async()=>{
 const f=await fixture();let app;try{
  app=await startLocalApp({dataDir:f.dataDir,starterDir:null});const own=await app.store.import('default',fixturePng(20,20),'personal.png');await app.close();app=await f.start();
  const store=app.store,save=store.saveCatalog;store.saveCatalog=async()=>{throw Error('simulated full disk');};
  await assert.rejects(store.serial(()=>store.starterCollection.add()),/simulated full disk/);store.saveCatalog=save;
  assert.equal(store.activeImport,false);assert.deepEqual(store.list('default').map(image=>image.id),[own.id]);assert.deepEqual(await readdir(join(f.dataDir,'default','images')),[own.id]);assert.equal(store.registry.starterPack,undefined);
  await store.serial(()=>store.starterCollection.add());assert.equal(store.state().starterImages.count,2);
 }finally{await app?.close();await rm(f.root,{recursive:true,force:true});}
});
test('an interrupted starter plan resumes without adopting unrelated photos or duplicating committed samples',async()=>{
 const f=await fixture();let app;try{
  app=await f.start();const own=await app.store.import('default',fixturePng(20,20),'personal.png');const initial=app.store.list('default').map(image=>image.id);app.store.registry.starterPack.status='installing';await app.store.saveRegistry();await app.close();app=await f.start();
  assert.deepEqual(new Set(app.store.list('default').map(image=>image.id)),new Set(initial));assert.equal(app.store.registry.starterPack.status,'installed');await app.store.serial(()=>app.store.starterCollection.remove());assert.equal(app.store.list('default')[0].id,own.id);
 }finally{await app?.close();await rm(f.root,{recursive:true,force:true});}
});
test('starter cleanup API requires the local token and rejects actions during imports',async()=>{
 const f=await fixture();let app;try{
  app=await f.start();const html=await(await fetch(app.url)).text(),token=/<meta name="ark-token" content="([a-f0-9]{64})">/.exec(html)[1];
  assert.equal((await fetch(app.url+'/api/starter-images',{method:'DELETE'})).status,403);
  app.store.activeImport=true;assert.equal((await fetch(app.url+'/api/starter-images',{method:'DELETE',headers:{'X-Ark-Token':token}})).status,409);app.store.activeImport=false;
  const response=await fetch(app.url+'/api/starter-images',{method:'DELETE',headers:{'X-Ark-Token':token}});assert.equal(response.status,200);assert.equal((await response.json()).deletedIds.length,2);assert.equal(app.store.state().starterImages.count,0);
  const manifest=JSON.parse(await readFile(join(f.starterDir,'manifest.json'),'utf8'));manifest.images[0].file='../outside.png';await writeFile(join(f.starterDir,'manifest.json'),JSON.stringify(manifest));await app.close();app=await f.start();assert.equal(app.store.state().starterImages.available,false);assert.equal(app.store.list('default').length,0);
 }finally{if(app)app.store.activeImport=false;await app?.close();await rm(f.root,{recursive:true,force:true});}
});
