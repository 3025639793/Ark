import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AlbumStore} from '../lib/store.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const password='a-test-vault-password';
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'ark-vault-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('encrypted images and metadata stay ciphertext; wrong passwords, locks, tampering and restart',async()=>fixture(async dir=>{
 let store=new AlbumStore(dir);await store.init();const snapshot=await store.create({name:'私人库',encrypted:true,password});const id=snapshot.libraries.at(-1).id;
 const image=await store.import(id,png,'private-character.png');await store.edit(id,image.id,{character:'不可泄露的角色',tags:['私人标签']});
 const raw=await readFile(join(dir,id,'images',image.id));assert.equal(raw.subarray(0,4).toString(),'ARK1');assert.equal(raw.includes(png),false);
 const manifest=await readFile(join(dir,id,'catalog.enc'));assert.equal(manifest.includes(Buffer.from('不可泄露的角色')),false);assert.equal(manifest.includes(Buffer.from('private-character.png')),false);
 assert.deepEqual((await store.file(id,image.id)).bytes,png);store.lock(id);assert.equal(store.state().libraries.at(-1).count,null);
 assert.throws(()=>store.list(id),e=>e.status===423);await assert.rejects(store.file(id,image.id),e=>e.status===423);await assert.rejects(store.unlock(id,'wrong'),e=>e.status===401);await store.unlock(id,password);
 assert.equal(store.list(id)[0].character,'不可泄露的角色');
 const tampered=Buffer.from(raw);tampered[tampered.length-1]^=1;await writeFile(join(dir,id,'images',image.id),tampered);await assert.rejects(store.file(id,image.id));await writeFile(join(dir,id,'images',image.id),raw);
 await store.settings({allowEncryptedRandom:true});store.lockAll();store=new AlbumStore(dir);await store.init();assert.equal(store.state().settings.allowEncryptedRandom,false);assert.equal(store.state().libraries.at(-1).unlocked,false);
 await store.unlock(id,password);assert.deepEqual((await store.file(id,image.id)).bytes,png);await store.remove(id,image.id);assert.equal(store.list(id).length,0);
}));
test('random display requires both permission switches AND an unlocked vault; no immediate repeat',async()=>fixture(async dir=>{
 const store=new AlbumStore(dir);await store.init();const ordinary=await store.import('default',png,'ordinary.png');const snapshot=await store.create({name:'加密库',encrypted:true,password});const id=snapshot.libraries.at(-1).id;const secret=await store.import(id,png,'secret.png');
 for(let n=0;n<10;n++)assert.equal(store.random().id,ordinary.id);
 await store.settings({allowEncryptedRandom:true});assert.equal(store.random().id,ordinary.id);
 await store.allowRandom(id,true);assert.equal(store.random({libraryId:id}).id,secret.id);
 assert.equal(store.random({previousId:ordinary.id}).id,secret.id);assert.equal(store.random({previousId:secret.id}).id,ordinary.id);
 store.lock(id);for(let n=0;n<10;n++)assert.equal(store.random().id,ordinary.id);
 assert.throws(()=>store.random({libraryId:id}),e=>e.status===404);await store.unlock(id,password);await store.settings({allowEncryptedRandom:false});assert.equal(store.random().id,ordinary.id);
 await store.allowRandom('default',false);assert.throws(()=>store.random(),e=>e.status===404);
}));
test('idle lock wipes the key and removes access to metadata and random candidates',async()=>fixture(async dir=>{
 let now=100000;const store=new AlbumStore(dir,{now:()=>now});await store.init();const snapshot=await store.create({name:'加密库',encrypted:true,password});const id=snapshot.libraries.at(-1).id;
 await store.import(id,png,'secret.png');await store.settings({allowEncryptedRandom:true,idleLockMinutes:1});await store.allowRandom(id,true);const key=store.unlocked.get(id).key;
 now+=60001;assert.equal(store.state().libraries.at(-1).unlocked,false);assert.equal(key.every(b=>b===0),true);assert.throws(()=>store.random({libraryId:id}),e=>e.status===404);assert.throws(()=>store.list(id),e=>e.status===423);
}));
test('serialized imports preserve all records and metadata validates',async()=>fixture(async dir=>{
 const store=new AlbumStore(dir);await store.init();await Promise.all(Array.from({length:8},(_,n)=>store.serial(()=>store.import('default',Buffer.concat([png,Buffer.from(String(n))]),`${n}.png`))));assert.equal(store.list('default').length,8);
 const image=store.list('default')[0];await assert.rejects(store.edit('default',image.id,{source:'javascript:alert(1)'}),e=>e.status===400);await store.edit('default',image.id,{tags:['标签','标签'],favorite:true});assert.deepEqual(store.list('default').find(i=>i.id===image.id).tags,['标签']);
 await assert.rejects(store.import('default',Buffer.from('<svg/>'),'bad.svg'),e=>e.status===415);
}));
test('folder classification survives restart; batch deletion is scoped and validates before deleting',async()=>fixture(async dir=>{
 let store=new AlbumStore(dir);await store.init();const first=await store.import('default',Buffer.concat([png,Buffer.from('first')]),'first.png','图片/原神/芙宁娜');const second=await store.import('default',Buffer.concat([png,Buffer.from('second')]),'second.png','图片/原神/纳西妲');const keep=await store.import('default',png,'keep.png');
 store=new AlbumStore(dir);await store.init();assert.equal(store.list('default').find(i=>i.id===first.id).folder,'图片/原神/芙宁娜');
 await assert.rejects(store.import('default',png,'bad.png','../../images'),e=>e.status===400);assert.equal(store.list('default').length,3);
 const snapshot=await store.create({name:'加密文件夹',encrypted:true,password});const vault=snapshot.libraries.at(-1).id;const secret=await store.import(vault,png,'secret.png','图片/秘密分类/角色');
 assert.equal((await readFile(join(dir,vault,'catalog.enc'))).includes(Buffer.from('秘密分类')),false);
 await assert.rejects(store.removeBatch('default',[first.id,secret.id]),e=>e.status===404);assert.equal(store.list('default').length,3);
 const result=await store.removeBatch('default',[first.id,second.id,first.id]);assert.deepEqual(result.deletedIds,[first.id,second.id]);assert.equal(result.cleanupFailures,0);assert.deepEqual(store.list('default').map(i=>i.id),[keep.id]);
 await assert.rejects(readFile(join(dir,'default','images',first.id)),e=>e.code==='ENOENT');assert.deepEqual((await store.file('default',keep.id)).bytes,png);
 store.lock(vault);await assert.rejects(store.removeBatch(vault,[secret.id]),e=>e.status===423);await store.unlock(vault,password);await store.removeBatch(vault,[secret.id]);assert.equal(store.list(vault).length,0);
}));

test('content dedup, folder roles, mixed encryption, scopes and deletion preserve images',async()=>fixture(async dir=>{
 let now=100000;let store=new AlbumStore(dir,{now:()=>now});await store.init();
 const a=await store.import('default',png,'private-name.png','收藏/角色甲',true);
 assert.equal(a.character,'角色甲');assert.equal((await store.import('default',png,'renamed.png')).duplicate,true);
 await store.protect('default',[a.id],password);const stub=store.catalogs.get('default')[0];
 assert.equal((await readFile(join(dir,'default','images',stub.storage))).includes(png),false);
 await assert.rejects(readFile(join(dir,'default','images',a.id)),e=>e.code==='ENOENT');
 assert.equal((await readFile(join(dir,'default','catalog.json'))).includes(Buffer.from('private-name.png')),false);
 assert.equal(store.list('default')[0].locked,true);await assert.rejects(store.file('default',a.id),e=>e.status===423);
 assert.equal((await store.import('default',png,'again.png')).duplicate,true);
 await assert.rejects(store.unlockImages('default',a.id,'bad','single'),e=>e.status===401);
 await store.unlockImages('default',a.id,password,'single');assert.deepEqual((await store.file('default',a.id)).bytes,png);assert.equal(store.list('default')[0].locked,true);
 await store.settings({allowEncryptedRandom:true});assert.throws(()=>store.random(),e=>e.status===404);store.lockImage(a.id);await assert.rejects(store.file('default',a.id),e=>e.status===423);
 await store.unlockImages('default',a.id,password,'5');assert.equal(store.random().id,a.id);const key=store.imageKeys.get(a.id).key;now+=300001;store.state();assert.ok(key.every(b=>b===0));assert.equal(store.list('default')[0].locked,true);
 await store.deleteCharacter('default','角色甲');assert.equal(store.list('default')[0].character,'');
 await store.unlockImages('default',a.id,password,'session');now+=36000000;assert.equal(store.list('default')[0].locked,false);
 await store.edit('default',a.id,{title:'updated'});assert.equal(store.list('default')[0].character,'');
 await store.unprotect('default',a.id);assert.equal(store.list('default')[0].character,'');assert.deepEqual((await store.file('default',a.id)).bytes,png);
 await store.protect('default',[a.id],password);store.lockAll();store=new AlbumStore(dir);await store.init();assert.equal(store.list('default')[0].locked,true);
 await store.removeBatch('default',[a.id]);assert.equal(store.list('default').length,0);
}));
test('import protection prevents locking and idle expiry',async()=>fixture(async dir=>{
 const store=new AlbumStore(dir);await store.init();store.activeImport=true;assert.throws(()=>store.lockAll(),e=>e.status===409);store.activeImport=false;store.lockAll();
}));

test('explicit parent role survives nested folders; duplicate corrections are opt-in and preserve encryption',async()=>fixture(async dir=>{
 const store=new AlbumStore(dir);await store.init();const image=await store.import('default',png,'wallpaper.png','收藏/作品/角色甲/壁纸',false,'角色甲');assert.equal(image.character,'角色甲');assert.equal(image.folder,'收藏/作品/角色甲/壁纸');
 let result=await store.import('default',png,'renamed.png','收藏/作品/新角色/壁纸',false,'新角色');assert.equal(result.duplicate,true);assert.equal(result.updated,false);assert.equal(store.list('default')[0].character,'角色甲');
 await store.protect('default',[image.id],password);
 result=await store.import('default',png,'renamed.png','收藏/作品/新角色/壁纸',false,'新角色',true);assert.equal(result.updated,true);assert.equal(result.image.locked,true);assert.equal(result.image.character,'新角色');assert.equal(store.list('default')[0].folder,'收藏/作品/角色甲/壁纸');
 await store.import('default',png,'again.png','收藏/作品/未知',false,'',true);assert.equal(store.list('default')[0].character,'新角色');
 await store.unlockImages('default',image.id,password,'session');assert.equal(store.list('default')[0].character,'新角色');assert.deepEqual((await store.file('default',image.id)).bytes,png);
 await assert.rejects(store.import('default',png,'invalid.png','收藏',false,'x'.repeat(201)),e=>e.status===400);
}));
