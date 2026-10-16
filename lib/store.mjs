import { previewPng } from './preview.mjs';
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, randomInt, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const derive = promisify(scrypt);
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function encrypt(bytes, key) {
 const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
 return Buffer.concat([Buffer.from('ARK1'), iv, ...seal(cipher,bytes)]);
}
function seal(cipher, bytes) { const ciphertext = Buffer.concat([cipher.update(bytes),cipher.final()]); return [cipher.getAuthTag(),ciphertext]; }
export function decrypt(bytes, key) {
 if(bytes.length<32||bytes.subarray(0,4).toString()!=='ARK1')throw new Error('加密文件格式无效');
 const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));decipher.setAuthTag(bytes.subarray(16,32));
 return Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]);
}
async function atomic(path, bytes) {
 const temp=path+'.'+randomUUID()+'.tmp';
 try { await writeFile(temp,bytes,{mode:0o600,flag:'wx'});await rename(temp,path); } finally { await unlink(temp).catch(()=>{}); }
}
export function normalizeFolder(value='') {
 if(typeof value!=='string'||value.length>1024)fail(400,'文件夹分类最多 1024 字。');
 const path=value.replace(/\\/g,'/');
 if(path.startsWith('/')||/^[A-Za-z]:/.test(path)||/[\x00-\x1f]/.test(path))fail(400,'文件夹分类须为相对路径。');
 const segments=path.split('/').filter(Boolean);
 if(segments.some(part=>part==='.'||part==='..'))fail(400,'文件夹分类不能包含 . 或 ..。');
 return segments.join('/');
}
export function metadata(input) {
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'分类信息格式有误。');
 const result={};for(const field of ['title','character','series','artist','source'])if(Object.hasOwn(input,field)){
  if(typeof input[field]!=='string'||input[field].length>(field==='source'?2000:200))fail(400,'文字内容过长或格式有误。');result[field]=input[field].trim();
 }
 if(Object.hasOwn(input,'folder'))result.folder=normalizeFolder(input.folder);
 if(result.source){try{if(!['http:','https:'].includes(new URL(result.source).protocol))throw Error();}catch{fail(400,'来源链接须以 http:// 或 https:// 开头。');}}
 if(Object.hasOwn(input,'tags')){if(!Array.isArray(input.tags)||input.tags.length>30||input.tags.some(t=>typeof t!=='string'||t.length>50))fail(400,'标签最多 30 个，每个最多 50 字。');result.tags=[...new Set(input.tags.map(t=>t.trim()).filter(Boolean))];}
 if(Object.hasOwn(input,'favorite')){if(typeof input.favorite!=='boolean')fail(400,'收藏状态格式有误。');result.favorite=input.favorite;}
 return result;
}
export function imageType(b) {
 if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(b.length>=6&&['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()))return 'image/gif';
 if(b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';
 return null;
}
export class AlbumStore {
 constructor(directory,{now=()=>Date.now()}={}) { this.directory=directory;this.unlocked=new Map();this.catalogs=new Map();this.now=now;this.queue=Promise.resolve();this.imageKeys=new Map();this.activeImport=false;this.lockRevision=0;this.masterKey=null; }
 serial(operation){const task=this.queue.then(operation);this.queue=task.catch(()=>{});return task;}
 async init(){
  this.isNewProfile=false;
  await mkdir(this.directory,{recursive:true,mode:0o700});
  try{this.registry=JSON.parse(await readFile(join(this.directory,'libraries.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;this.isNewProfile=true;this.registry={version:1,settings:{allowEncryptedRandom:false,idleLockMinutes:5},libraries:[{id:'default',name:'我的相册',encrypted:false,allowRandom:true}]};await this.saveRegistry();}
  this.registry.settings.allowEncryptedRandom=false;await this.saveRegistry();
  for(const lib of this.registry.libraries){await mkdir(join(this.directory,lib.id,'images'),{recursive:true,mode:0o700});if(!lib.encrypted){let rows=[];try{rows=JSON.parse(await readFile(this.catalogPath(lib),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}this.catalogs.set(lib.id,rows);}}
 }
 library(id){const lib=this.registry.libraries.find(l=>l.id===id);if(!lib)fail(404,'图片库不存在。');return lib;}
 catalogPath(lib){return join(this.directory,lib.id,lib.encrypted?'catalog.enc':'catalog.json');}
 async saveRegistry(){await atomic(join(this.directory,'libraries.json'),JSON.stringify(this.registry,null,2));}
 expire(){for(const [id,e] of this.imageKeys)if(e.until&&this.now()>=e.until){e.key.fill(0);this.imageKeys.delete(id);this.lockRevision++;}const minutes=this.registry.settings.idleLockMinutes;if(this.activeImport)return;for(const [id,entry] of this.unlocked)if(entry.until?this.now()>=entry.until:entry.scope!=='session'&&minutes&&this.now()-entry.usedAt>=minutes*60000)this.lock(id);}
 lock(id){if(this.activeImport)fail(409,'正在导入，请等待完成后锁定。');const entry=this.unlocked.get(id);if(entry)entry.key.fill(0);this.unlocked.delete(id);this.catalogs.delete(id);}
 lockAll(){if(this.activeImport)fail(409,'正在导入，请等待完成后锁定。');for(const e of this.imageKeys.values())e.key.fill(0);this.imageKeys.clear();this.masterKey?.fill(0);this.masterKey=null;this.lockRevision++;for(const id of [...this.unlocked.keys()])this.lock(id);}
 access(id,touch=true){this.expire();const lib=this.library(id);if(lib.encrypted&&!this.unlocked.has(id))fail(423,'加密库已锁定，请先输入密码。');if(lib.encrypted&&touch)this.unlocked.get(id).usedAt=this.now();return lib;}
 state(){this.expire();return {starterImages:this.starterCollection?.state()||{available:false,total:0,count:0,error:''},masterPassword:{configured:!!this.registry.master,ready:!!this.masterKey},lockRevision:this.lockRevision,importing:this.activeImport,settings:this.registry.settings,libraries:this.registry.libraries.map(({salt,keyCheck,wrappedKey,...lib})=>({...lib,unlocked:!lib.encrypted||this.unlocked.has(lib.id),count:!lib.encrypted||this.unlocked.has(lib.id)?this.catalogs.get(lib.id).filter(row=>!row.protected||this.imageKeys.has(row.id)).length:null}))};}
 async setupMaster(password){
  if(this.registry.master)fail(409,'统一密码已经设置，请使用现有密码。');
  if(typeof password!=='string'||password.length<8||password.length>1024)fail(400,'统一密码至少 8 个字符，最多 1024 个字符。');
  const salt=randomBytes(32).toString('base64');const key=await this.passwordKey(password,salt);this.registry.master={salt,keyCheck:encrypt(Buffer.from('ARK password check v1'),key).toString('base64')};
  try{await this.saveRegistry();}catch(e){delete this.registry.master;key.fill(0);throw e;}
  this.masterKey?.fill(0);this.masterKey=key;return this.state();
 }
 async masterFor(password){
  if(!this.registry.master)fail(409,'请先设置统一密码。');if(typeof this.registry.master.keyCheck!=='string'||Buffer.from(this.registry.master.keyCheck,'base64').length<32)fail(500,'统一密码校验信息缺失或损坏，请恢复完整数据备份。');this.validatePassword(password);const key=await this.passwordKey(password,this.registry.master.salt);try{this.checkPassword(this.registry.master,key);return key;}catch(e){key.fill(0);throw e;}
 }
 async readyMaster(password){
  if(!this.registry.master){await this.setupMaster(password);return this.masterKey;}
  if(password!==undefined){const key=await this.masterFor(password);this.masterKey?.fill(0);this.masterKey=key;}
  if(!this.masterKey)fail(423,'统一密码已锁定，请输入统一密码。');return this.masterKey;
 }
 async contentKey(record,password,master,legacyPassword){
  if(record.wrappedKey){if(!master)fail(500,'统一密码配置缺失，请恢复完整数据备份。');let key;try{key=decrypt(Buffer.from(record.wrappedKey,'base64'),master);}catch{fail(500,'统一密码校验通过，但加密密钥数据损坏。请检查备份。');}return key;}
  return this.passwordKey(legacyPassword===undefined?password:legacyPassword,record.salt);
 }
 async wrapImage(lib,row,key,master){if(master&&!row.wrappedKey)await this.saveCatalog(lib,this.catalogs.get(lib.id).map(r=>r.id===row.id?{...r,wrappedKey:encrypt(key,master).toString('base64')}:r));}
 async create({name,encrypted=false,password}){
  if(typeof name!=='string'||!name.trim()||name.length>60||typeof encrypted!=='boolean')fail(400,'请填写图片库名称，最多 60 字。');
  const master=encrypted?await this.readyMaster(password):null;
  const lib={id:randomUUID(),name:name.trim(),encrypted,allowRandom:!encrypted};let key;
  if(encrypted){lib.salt=randomBytes(32).toString('base64');key=password===undefined?randomBytes(32):await this.passwordKey(password,lib.salt);lib.wrappedKey=encrypt(key,master).toString('base64');lib.keyCheck=encrypt(Buffer.from('ARK password check v1'),key).toString('base64');}
  await mkdir(join(this.directory,lib.id,'images'),{recursive:true,mode:0o700});
  await atomic(this.catalogPath(lib),encrypted?encrypt(Buffer.from('[]'),key):'[]');
  this.registry.libraries.push(lib);try{await this.saveRegistry();}catch(e){this.registry.libraries.pop();key?.fill(0);throw e;}
  this.catalogs.set(lib.id,[]);if(key)this.unlocked.set(lib.id,{key,usedAt:this.now()});return this.state();
 }
 async unlock(id,password,scope,legacyPassword){
  const lib=this.library(id);if(!lib.encrypted)return this.state();
  this.validatePassword(password);if(scope!==undefined)this.validateScope(scope,false);
  let bytes;try{bytes=await readFile(this.catalogPath(lib));}catch(e){if(e.code==='ENOENT')fail(500,'加密库文件缺失，请从备份恢复。');fail(500,'无法读取加密库文件，请检查数据目录权限。');}
  let master;if(lib.wrappedKey)master=await this.masterFor(password);else if(this.registry.master){try{master=await this.masterFor(password);}catch(e){if(e.status!==401)throw e;}}
  if(master){this.masterKey?.fill(0);this.masterKey=Buffer.from(master);}let key;try{key=await this.contentKey(lib,password,master,legacyPassword);}finally{master?.fill(0);}let decoded,rows;
  try{
   this.checkPassword(lib,key);
   try{decoded=decrypt(bytes,key);}catch(e){if(lib.keyCheck)fail(500,'密码校验通过，但加密库数据损坏，请检查备份。');fail(401,'密码不匹配，或旧加密库数据已损坏。请确认使用的是该库的密码。');}
   try{rows=JSON.parse(decoded.toString());if(!Array.isArray(rows))throw Error();}catch{fail(500,'密码校验通过，但加密库目录格式损坏，请检查备份。');}
   if(!this.registry.master)await this.setupMaster(password);this.lock(id);const entry={key,usedAt:this.now()};if(scope){entry.scope=scope;entry.until=scope==='session'?0:this.now()+Number(scope)*60000;}this.unlocked.set(id,entry);this.catalogs.set(id,rows);
   // An old catalog that decrypts successfully can gain an independent password check.
   if(!lib.keyCheck||(!lib.wrappedKey&&this.masterKey)){lib.keyCheck=encrypt(Buffer.from('ARK password check v1'),key).toString('base64');if(this.masterKey)lib.wrappedKey=encrypt(key,this.masterKey).toString('base64');await this.saveRegistry();}
   return this.state();
  }catch(e){if(this.unlocked.get(id)?.key!==key)key.fill(0);throw e;}
 }
 validatePassword(password){if(typeof password!=='string'||!password.length||password.length>1024)fail(400,'请输入密码，最多 1024 个字符。');}
 validateScope(scope,allowSingle=true){if(!(allowSingle?['single','5','15','30','60','session']:['5','15','30','60','session']).includes(scope))fail(400,'请选择有效的临时解锁时段。');}
 passwordKey(password,salt){if(typeof salt!=='string'||Buffer.from(salt,'base64').length!==32)fail(500,'加密密钥参数缺失或损坏，请检查备份。');return derive(password,Buffer.from(salt,'base64'),32,{N:32768,r:8,p:1,maxmem:128*1024*1024});}
 checkPassword(record,key){if(record.keyCheck){try{if(decrypt(Buffer.from(record.keyCheck,'base64'),key).toString()!=='ARK password check v1')throw Error();}catch{if(record.wrappedKey)fail(500,'统一密码校验通过，但加密密钥的校验数据损坏，请检查备份。');fail(401,'密码不匹配，请检查大小写、空格或旧内容的原密码。');}}}
 imagePassword(row,key){
  this.checkPassword(row,key);let bytes;
  try{bytes=decrypt(Buffer.from(row.secret,'base64'),key);}catch{if(row.keyCheck)fail(500,'密码校验通过，但图片分类数据损坏，请检查备份。');fail(401,'密码不匹配，或旧加密图片数据已损坏。');}
  try{const meta=JSON.parse(bytes);if(!meta||meta.id!==row.id)throw Error();return meta;}catch{fail(500,'密码校验通过，但图片分类格式损坏，请检查备份。');}
 }
 grantImage(row,key,scope){this.imageKeys.get(row.id)?.key.fill(0);this.imageKeys.set(row.id,{key,scope,until:scope==='single'||scope==='session'?0:this.now()+Number(scope)*60000});}
 encryptedCollection(){
  this.expire();const images=[],lockedLibraries=[];
  for(const lib of this.registry.libraries){if(lib.encrypted&&!this.unlocked.has(lib.id)){lockedLibraries.push({id:lib.id,name:lib.name});continue;}
   for(const row of this.catalogs.get(lib.id)||[])if(lib.encrypted||row.protected)images.push({...this.visible(lib.id,row),encrypted:true,libraryName:lib.name,wholeLibrary:lib.encrypted,legacy:!lib.encrypted&&!row.wrappedKey});
  }return {images:images.sort((a,b)=>b.created_at.localeCompare(a.created_at)),lockedLibraries};
 }
 async unlockMatching(password,scope,legacyPassword){
  this.validatePassword(password);this.validateScope(scope,false);let master;if(this.registry.master){master=await this.masterFor(password);this.masterKey?.fill(0);this.masterKey=Buffer.from(master);}let count=0,matched=0;const issues=[];
  try{for(const lib of this.registry.libraries){
   if(lib.encrypted){try{await this.unlock(lib.id,password,scope,legacyPassword);matched++;count+=this.catalogs.get(lib.id).length;}catch(e){if(e.status!==401)issues.push({libraryId:lib.id,message:e.message});}continue;}
   for(const row of this.catalogs.get(lib.id).filter(r=>r.protected)){
    let key;try{key=await this.contentKey(row,password,master,legacyPassword);this.imagePassword(row,key);if(!this.registry.master)await this.setupMaster(password);if(!master&&this.masterKey)master=Buffer.from(this.masterKey);await this.wrapImage(lib,row,key,master);this.grantImage(row,key,scope);matched++;count++;}catch(e){key?.fill(0);if(e.status!==401)issues.push({libraryId:lib.id,id:row.id,message:e.message});}
   }
  }
  if(!matched&&!master){if(issues.length)fail(500,issues[0].message);fail(401,'这个密码没有匹配到加密内容。旧版图片请使用原密码接入统一密码。');}
  const collection=this.encryptedCollection();return {count,matched,issues,remaining:collection.images.filter(i=>i.locked).length,lockedLibraries:collection.lockedLibraries.length};
  }finally{master?.fill(0);}
 }
 async saveCatalog(lib,rows){await atomic(this.catalogPath(lib),lib.encrypted?encrypt(Buffer.from(JSON.stringify(rows)),this.unlocked.get(lib.id).key):JSON.stringify(rows));this.catalogs.set(lib.id,rows);}
 list(id,{includeLocked=true}={}){this.access(id);return this.catalogs.get(id).map(row=>this.visible(id,row,!includeLocked)).filter(row=>includeLocked||!row.locked).sort((a,b)=>b.created_at.localeCompare(a.created_at));}
 async import(id,bytes,filename,folder='',inferCharacter=false,character,updateDuplicateCharacter=false){
  folder=normalizeFolder(folder);const assigned=character===undefined?(inferCharacter?folder.split('/').at(-1)?.slice(0,200)||'':''):metadata({character}).character;const lib=this.access(id);if(bytes.length>25*1024*1024)fail(413,'单张图片最多 25 MB。');const mime=imageType(bytes);if(!mime)fail(415,'支持 JPG、PNG、GIF 和 WebP 图片。');
  const hash=createHash('sha256').update(bytes).digest('hex');
  for(const row of this.catalogs.get(id)){if(!row.hash){const old=await this.file(id,row.id);row.hash=createHash('sha256').update(old.bytes).digest('hex');}if(row.hash===hash||row.sourceHash===hash){if(id==='default'&&this.registry.starterPack?.ids?.includes(row.id)){const previous=this.registry.starterPack;this.registry.starterPack={...previous,ids:previous.ids.filter(value=>value!==row.id)};try{await this.saveRegistry();}catch(error){this.registry.starterPack=previous;throw error;}}const updated=updateDuplicateCharacter&&!!assigned&&row.character!==assigned;if(updated)await this.saveCatalog(lib,this.catalogs.get(id).map(r=>r.id===row.id?{...r,character:assigned}:r));return {duplicate:true,id:row.id,updated,image:updated?this.visible(id,this.catalogs.get(id).find(r=>r.id===row.id)):undefined};}}
  const image={hash,id:randomUUID(),filename:filename.slice(0,200),mime,bytes:bytes.length,title:filename.replace(/\.[^.]+$/,'').slice(0,200),character:assigned,series:'',folder,tags:[],artist:'',source:'',favorite:false,created_at:new Date(this.now()).toISOString()};
  const file=join(this.directory,id,'images',image.id);const content=lib.encrypted?encrypt(bytes,this.unlocked.get(id).key):bytes;
  await atomic(file,content);try{await this.saveCatalog(lib,[...this.catalogs.get(id),image]);}catch(e){await unlink(file).catch(()=>{});throw e;}return {...image,libraryId:id};
 }
 find(id,imageId){const lib=this.access(id);const image=this.catalogs.get(id).find(i=>i.id===imageId);if(!image)fail(404,'图片不存在。');return {lib,image};}
 async file(id,imageId){const {lib,image}=this.find(id,imageId);let bytes=await readFile(join(this.directory,id,'images',image.storage||image.id));if(lib.encrypted)bytes=decrypt(bytes,this.unlocked.get(id).key);if(image.protected){this.expire();const grant=this.imageKeys.get(image.id);if(!grant)fail(423,'此图片已加密，输入密码查看。');bytes=decrypt(bytes,grant.key);}return {image:this.visible(id,image,true),bytes};}
 async edit(id,imageId,input){const {lib,image}=this.find(id,imageId);if(image.protected){const grant=this.imageKeys.get(imageId);if(!grant)fail(423,'请先解锁图片。');const updated={...JSON.parse(decrypt(Buffer.from(image.secret,'base64'),grant.key)),character:image.character,series:image.series,folder:image.folder,...metadata(input)};const stub={...image,character:updated.character,series:updated.series,folder:updated.folder,secret:encrypt(Buffer.from(JSON.stringify(updated)),grant.key).toString('base64')};await this.saveCatalog(lib,this.catalogs.get(id).map(i=>i.id===imageId?stub:i));return this.visible(id,stub,true);}const updated={...image,...metadata(input)};await this.saveCatalog(lib,this.catalogs.get(id).map(i=>i.id===imageId?updated:i));return {...updated,libraryId:id};}
 async removeBatch(id,ids){
  const lib=this.access(id);
  if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(value=>typeof value!=='string'||!/^[-a-f0-9]{36}$/.test(value)))fail(400,'每次删除须选择 1 到 500 张图片。');
  const unique=[...new Set(ids)];const selected=new Set(unique);const rows=this.catalogs.get(id);
  if(unique.some(imageId=>!rows.some(image=>image.id===imageId)))fail(404,'所选图片不存在或不属于当前库，请刷新后重试。');
  await this.saveCatalog(lib,rows.filter(image=>!selected.has(image.id)));
  const results=await Promise.allSettled(unique.map(imageId=>unlink(join(this.directory,id,'images',rows.find(r=>r.id===imageId).storage||imageId)).catch(e=>{if(e.code!=='ENOENT')throw e;})));
  for(const imageId of unique){this.imageKeys.get(imageId)?.key.fill(0);this.imageKeys.delete(imageId);}return {deletedIds:unique,cleanupFailures:results.filter(r=>r.status==='rejected').length};
 }
 async remove(id,imageId){return this.removeBatch(id,[imageId]);}
 visible(id,row,detail=false){
  if(!row.protected)return {...row,libraryId:id};
  const grant=this.imageKeys.get(row.id);
  if(grant&&(detail||grant.scope!=='single')){const meta=JSON.parse(decrypt(Buffer.from(row.secret,'base64'),grant.key));return {...meta,character:row.character,series:row.series,folder:row.folder,libraryId:id,protected:true,locked:false,hasPreview:!!row.preview,previewVersion:row.preview?(row.preview.version===2?2:1):0,previewWidth:row.preview?.version===2?row.preview.width:0,previewHeight:row.preview?.version===2?row.preview.height:0,legacy:!row.wrappedKey};}
  return {id:row.id,libraryId:id,protected:true,locked:true,hasPreview:!!row.preview,previewVersion:row.preview?(row.preview.version===2?2:1):0,previewWidth:row.preview?.version===2?row.preview.width:0,previewHeight:row.preview?.version===2?row.preview.height:0,legacy:!row.wrappedKey,title:'已加密 · 输入密码查看',filename:'加密图片',character:row.character,series:row.series,folder:row.folder,tags:[],favorite:false,bytes:row.bytes,created_at:row.created_at};
 }
 validatePreview(preview){
  if(typeof preview==='string'&&/^[A-Za-z0-9+/]{256}$/.test(preview))return preview;
  if(preview&&preview.version===2&&Number.isInteger(preview.width)&&Number.isInteger(preview.height)&&preview.width>=1&&preview.width<=64&&preview.height>=1&&preview.height<=64&&typeof preview.pixels==='string'){
   const length=preview.width*preview.height*3;if(preview.pixels.length===Math.ceil(length/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(preview.pixels)&&Buffer.from(preview.pixels,'base64').length===length)return {version:2,width:preview.width,height:preview.height,pixels:preview.pixels};
  }fail(400,'模糊封面格式有误，最长边最多 64 像素。');
 }
 async setPreview(id,imageId,preview){
  const {lib,image}=this.find(id,imageId);if(!image.protected||!this.imageKeys.has(imageId))fail(423,'请先解锁图片，再生成模糊预览。');preview=this.validatePreview(preview);
  await this.saveCatalog(lib,this.catalogs.get(id).map(row=>row.id===imageId?{...row,preview}:row));return {ok:true};
 }
 preview(id,imageId){
  const {image}=this.find(id,imageId);if(!image.protected||!image.preview)fail(404,'这张图片尚未生成模糊预览。');return previewPng(this.validatePreview(image.preview));
 }
 async protect(id,ids,password,previews={}){
  const lib=this.access(id);if(lib.encrypted)fail(409,'这个库已整体加密，无需重复加密图片。');
  const master=await this.readyMaster(password);
  if(!Array.isArray(ids)||!ids.length||ids.length>500)fail(400,'请选择 1 到 500 张图片。');
  if(!previews||typeof previews!=='object'||Array.isArray(previews))fail(400,'模糊预览格式有误。');for(const [imageId,preview] of Object.entries(previews)){if(!ids.includes(imageId))fail(400,'预览图片不在所选图片中。');previews[imageId]=this.validatePreview(preview);}
  for(const imageId of new Set(ids))this.find(id,imageId);
  const rows=[...this.catalogs.get(id)],indices=new Map(rows.map((row,index)=>[row.id,index])),targets=[],originals=[];
  try{
   for(const imageId of [...new Set(ids)]){
    const image=rows[indices.get(imageId)];if(image.protected)continue;const salt=randomBytes(32).toString('base64'),key=password===undefined?randomBytes(32):await this.passwordKey(password,salt),storage=randomUUID(),target=join(this.directory,id,'images',storage);
    try{const bytes=await readFile(join(this.directory,id,'images',image.id));await atomic(target,encrypt(bytes,key));targets.push(target);originals.push(join(this.directory,id,'images',image.id));
     rows[indices.get(imageId)]={id:image.id,...(image.sourceHash?{sourceHash:image.sourceHash}:{}),hash:image.hash||createHash('sha256').update(bytes).digest('hex'),character:image.character,series:image.series,folder:image.folder,bytes:image.bytes,created_at:image.created_at,protected:true,...(previews[imageId]?{preview:previews[imageId]}:{}),salt,storage,wrappedKey:encrypt(key,master).toString('base64'),keyCheck:encrypt(Buffer.from('ARK password check v1'),key).toString('base64'),secret:encrypt(Buffer.from(JSON.stringify(image)),key).toString('base64')};
    }finally{key.fill(0);}
   }
   await this.saveCatalog(lib,rows);
  }catch(error){await Promise.all(targets.map(target=>unlink(target).catch(()=>{})));throw error;}
  const cleanup=await Promise.allSettled(originals.map(original=>unlink(original)));this.lockRevision++;
  if(cleanup.some(result=>result.status==='rejected'))fail(500,'图片已加密，但部分旧副本清理失败。请检查数据目录权限并保留备份。');return this.list(id);
 }

 async unlockImages(id,imageId,password,scope,legacyPassword){
  this.validatePassword(password);this.validateScope(scope);const {lib,image}=this.find(id,imageId);if(!image.protected)fail(400,'这张图片属于整库加密，请先解锁该库。');
  let master;if(this.registry.master){master=await this.masterFor(password);this.masterKey?.fill(0);this.masterKey=Buffer.from(master);}
  let key;try{key=await this.contentKey(image,password,master,legacyPassword);try{this.imagePassword(image,key);}catch(e){if(e.status===401&&master&&!image.wrappedKey)fail(401,'统一密码正确；这张旧图片还需要填写原密码，验证后将接入统一密码。');throw e;}if(!this.registry.master)await this.setupMaster(password);if(!master&&this.masterKey)master=Buffer.from(this.masterKey);await this.wrapImage(lib,image,key,master);
   if(scope==='single'){this.grantImage(image,key,scope);key=null;return {image:this.visible(id,this.catalogs.get(id).find(r=>r.id===imageId),true),count:1,issues:[]};}
   key.fill(0);key=null;const result=await this.unlockMatching(password,scope,legacyPassword);return {...result,image:this.visible(id,this.catalogs.get(id).find(r=>r.id===imageId),true)};
  }finally{key?.fill(0);master?.fill(0);}
 }
 lockImage(imageId){const e=this.imageKeys.get(imageId);if(e?.scope==='single'){e.key.fill(0);this.imageKeys.delete(imageId);return true;}return false;}
 async unprotect(id,imageId){
  const {lib,image}=this.find(id,imageId);const grant=this.imageKeys.get(imageId);if(!image.protected||!grant)fail(423,'请先输入密码解锁这张图片。');
  const {bytes}=await this.file(id,imageId);const restored={...JSON.parse(decrypt(Buffer.from(image.secret,'base64'),grant.key)),character:image.character,series:image.series,folder:image.folder};
  await atomic(join(this.directory,id,'images',image.id),bytes);
  try{await this.saveCatalog(lib,this.catalogs.get(id).map(r=>r.id===imageId?restored:r));}catch(e){await unlink(join(this.directory,id,'images',image.id)).catch(()=>{});throw e;}
  await unlink(join(this.directory,id,'images',image.storage));grant.key.fill(0);this.imageKeys.delete(imageId);return this.list(id);
 }
 async deleteCharacter(id,name){const lib=this.access(id);if(typeof name!=='string'||!name)fail(400,'请选择角色分类。');await this.saveCatalog(lib,this.catalogs.get(id).map(row=>row.character===name?{...row,character:''}:row));return this.list(id);}
 async settings(input){
  if(!input||typeof input!=='object')fail(400,'设置格式有误。');const next={...this.registry.settings};
  if(Object.hasOwn(input,'allowEncryptedRandom')){if(typeof input.allowEncryptedRandom!=='boolean')fail(400,'设置格式有误。');next.allowEncryptedRandom=input.allowEncryptedRandom;}
  if(Object.hasOwn(input,'idleLockMinutes')){if(![1,5,15,0].includes(input.idleLockMinutes))fail(400,'自动锁定时间无效。');next.idleLockMinutes=input.idleLockMinutes;}
  const previous=this.registry.settings;this.registry.settings=next;try{await this.saveRegistry();}catch(e){this.registry.settings=previous;throw e;}return this.state();
 }
 async allowRandom(id,value){if(typeof value!=='boolean')fail(400,'设置格式有误。');const lib=this.library(id);const old=lib.allowRandom;lib.allowRandom=value;try{await this.saveRegistry();}catch(e){lib.allowRandom=old;throw e;}return this.state();}
 random({libraryId,previousId}={}){
  this.expire();let candidates=[];
  for(const lib of this.registry.libraries){if(libraryId&&lib.id!==libraryId)continue;if(!lib.allowRandom)continue;if(lib.encrypted&&(!this.registry.settings.allowEncryptedRandom||!this.unlocked.has(lib.id)))continue;
   candidates.push(...this.catalogs.get(lib.id).filter(i=>!i.protected||(this.registry.settings.allowEncryptedRandom&&this.imageKeys.get(i.id)?.scope!=='single'&&this.imageKeys.has(i.id))).map(i=>({...this.visible(lib.id,i),libraryName:lib.name,encrypted:lib.encrypted||!!i.protected})));
  }
  if(candidates.length>1)candidates=candidates.filter(i=>i.id!==previousId);
  if(!candidates.length)fail(404,'没有可展示的图片。加密库须解锁，并同时开启全局和该库的随机展示开关。');
  return candidates[randomInt(candidates.length)];
 }
}
