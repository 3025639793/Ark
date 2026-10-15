import { cp, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './store.mjs';
function contains(parent,path){const part=relative(parent,path);return !part||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));}
export async function createBackup(store,parent,{onLocked=()=>{}}={}){
 if(store.activeImport||store.activeBackup)fail(409,'请等待当前导入或备份完成。');
 store.activeBackup=true;
 try{
 const source=await realpath(store.directory),destination=await realpath(parent);
 if(contains(source,destination))fail(400,'请选择相册数据目录以外的位置保存备份。');
 return await store.serial(async()=>{
  if(store.activeImport)fail(409,'请先等待导入完成。');store.lockAll();onLocked();
  const target=join(destination,`Ark-backup-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`),partial=target+'.partial';let files=0,bytes=0,skippedLinks=0,created=false;
  try{
   await mkdir(partial,{mode:0o700});created=true;
   await cp(source,partial,{recursive:true,force:true,errorOnExist:false,preserveTimestamps:true,filter:async path=>{
    const info=await lstat(path);if(info.isSymbolicLink()){skippedLinks++;return false;}if(basename(path).endsWith('.tmp')||relative(source,path)==='ark-backup.json')return false;if(info.isFile()){files++;bytes+=info.size;}return info.isFile()||info.isDirectory();
   }});
   await writeFile(join(partial,'ark-backup.json'),JSON.stringify({format:'ark-backup-v1',createdAt:new Date().toISOString(),files,bytes},null,2),{mode:0o600,flag:'wx'});await rename(partial,target);return {directory:target,files,bytes,skippedLinks};
  }catch(error){if(created)await rm(partial,{recursive:true,force:true}).catch(()=>{});throw error;}
 });}finally{store.activeBackup=false;}
}
