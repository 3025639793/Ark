import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, imageType, metadata } from './store.mjs';

// Only IDs created by this collection may be removed by its cleanup action.
export class StarterCollection {
 constructor(store,directory){this.store=store;this.directory=directory;this.pack=null;this.error='';}
 async init(){
  if(!this.directory)return;
  try{this.pack=JSON.parse(await readFile(join(this.directory,'manifest.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')this.error='初始图片暂时无法读取。';return;}
  if(typeof this.pack?.version!=='string'||!this.pack.version||!Array.isArray(this.pack.images)||!this.pack.images.length||this.pack.images.some(image=>!image||typeof image.file!=='string'||!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/.test(image.file))){this.pack=null;this.error='初始图片清单无效。';return;}
  if((this.store.isNewProfile&&!this.store.registry.starterPack)||this.store.registry.starterPack?.status==='installing'){
   try{await this.add();}catch{this.error='初始图片未能完整添加，可在设置中重试。';}
  }
 }
 ids(){const known=new Set(this.store.registry.starterPack?.ids||[]);return (this.store.catalogs.get('default')||[]).filter(image=>known.has(image.id)).map(image=>image.id);}
 state(){return {available:!!this.pack,total:this.pack?.images.length||0,count:this.ids().length,error:this.error};}
 async add(){
  if(!this.pack)fail(404,'软件尚未包含初始图片。');
  const store=this.store;if(store.activeImport||store.activeBackup)fail(409,'请等待当前图片操作完成。');store.activeImport=true;
  const lib=store.library('default'),original=store.catalogs.get('default'),rows=[...original],created=[];const previous=store.registry.starterPack;let planned=false,committed=false;
  try{
   const ids=this.ids(),hashes=new Set(rows.map(image=>image.hash));let added=0;
   for(const entry of this.pack.images){
    const bytes=await readFile(join(this.directory,entry.file)),mime=imageType(bytes);if(!mime||bytes.length>25*1024*1024)fail(400,'初始图片格式或大小无效。');
    const hash=createHash('sha256').update(bytes).digest('hex');if(hashes.has(hash))continue;
    const id=randomUUID(),target=join(store.directory,'default','images',id);
    const image={id,hash,filename:entry.file,mime,bytes:bytes.length,title:entry.title||'美露莘',character:'美露莘',series:'原神',folder:'初始图片/美露莘',tags:['初始图片'],artist:'',source:'',favorite:false,...metadata(entry),created_at:new Date(store.now()+added).toISOString()};
    const file=await open(target,'wx',0o600);created.push(target);try{await file.writeFile(bytes);}finally{await file.close();}rows.push(image);ids.push(id);hashes.add(hash);added++;
   }
   // The saved plan lets an interrupted first launch resume without adopting
   // unrelated images or adding another copy of already committed pictures.
   store.registry.starterPack={version:this.pack.version,status:'installing',ids};await store.saveRegistry();planned=true;
   await store.saveCatalog(lib,rows);committed=true;
   store.registry.starterPack={...store.registry.starterPack,status:'installed'};await store.saveRegistry();this.error='';return {added,skipped:this.pack.images.length-added};
  }catch(error){
   if(!committed){await Promise.all(created.map(file=>unlink(file).catch(()=>{})));if(previous===undefined)delete store.registry.starterPack;else store.registry.starterPack=previous;if(planned)await store.saveRegistry().catch(()=>{});}
   throw error;
  }finally{store.activeImport=false;if(store.pendingLock){store.pendingLock=false;store.lockAll();}}
 }
 async remove(){
  const store=this.store;if(store.activeImport||store.activeBackup)fail(409,'请等待当前图片操作完成。');
  const ids=this.ids();if(!ids.length)return {deletedIds:[],cleanupFailures:0};store.activeImport=true;
  try{
   const previous=store.registry.starterPack;store.registry.starterPack={...previous,status:'removed'};try{await store.saveRegistry();}catch(error){store.registry.starterPack=previous;throw error;}
   let cleanupFailures=0;for(let offset=0;offset<ids.length;offset+=500){const result=await store.removeBatch('default',ids.slice(offset,offset+500));cleanupFailures+=result.cleanupFailures;}
   store.registry.starterPack={...store.registry.starterPack,ids:[]};await store.saveRegistry();return {deletedIds:ids,cleanupFailures};
  }finally{store.activeImport=false;if(store.pendingLock){store.pendingLock=false;store.lockAll();}}
 }
}
