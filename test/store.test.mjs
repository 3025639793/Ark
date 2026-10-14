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
 const store=new AlbumStore(dir);await store.init();await Promise.all(Array.from({length:8},(_,n)=>store.serial(()=>store.import('default',png,`${n}.png`))));assert.equal(store.list('default').length,8);
 const image=store.list('default')[0];await assert.rejects(store.edit('default',image.id,{source:'javascript:alert(1)'}),e=>e.status===400);await store.edit('default',image.id,{tags:['标签','标签'],favorite:true});assert.deepEqual(store.list('default').find(i=>i.id===image.id).tags,['标签']);
 await assert.rejects(store.import('default',Buffer.from('<svg/>'),'bad.svg'),e=>e.status===415);
}));
test('folder classification survives restart; batch deletion is scoped and validates before deleting',async()=>fixture(async dir=>{
 let store=new AlbumStore(dir);await store.init();const first=await store.import('default',png,'first.png','图片/原神/芙宁娜');const second=await store.import('default',png,'second.png','图片/原神/纳西妲');const keep=await store.import('default',png,'keep.png');
 store=new AlbumStore(dir);await store.init();assert.equal(store.list('default').find(i=>i.id===first.id).folder,'图片/原神/芙宁娜');
 await assert.rejects(store.import('default',png,'bad.png','../../images'),e=>e.status===400);assert.equal(store.list('default').length,3);
 const snapshot=await store.create({name:'加密文件夹',encrypted:true,password});const vault=snapshot.libraries.at(-1).id;const secret=await store.import(vault,png,'secret.png','图片/秘密分类/角色');
 assert.equal((await readFile(join(dir,vault,'catalog.enc'))).includes(Buffer.from('秘密分类')),false);
 await assert.rejects(store.removeBatch('default',[first.id,secret.id]),e=>e.status===404);assert.equal(store.list('default').length,3);
 const result=await store.removeBatch('default',[first.id,second.id,first.id]);assert.deepEqual(result.deletedIds,[first.id,second.id]);assert.equal(result.cleanupFailures,0);assert.deepEqual(store.list('default').map(i=>i.id),[keep.id]);
 await assert.rejects(readFile(join(dir,'default','images',first.id)),e=>e.code==='ENOENT');assert.deepEqual((await store.file('default',keep.id)).bytes,png);
 store.lock(vault);await assert.rejects(store.removeBatch(vault,[secret.id]),e=>e.status===423);await store.unlock(vault,password);await store.removeBatch(vault,[secret.id]);assert.equal(store.list(vault).length,0);
}));
