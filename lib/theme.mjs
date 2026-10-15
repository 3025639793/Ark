import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageType, fail } from './store.mjs';
export class ThemeStore {
 constructor(directory){this.directory=join(directory,'theme');this.config={easterEggs:true,image:null,seenEggs:[]};}
 async init(){await mkdir(this.directory,{recursive:true});try{this.config=JSON.parse(await readFile(join(this.directory,'settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
 state(){return {easterEggs:this.config.easterEggs,hasImage:!!this.config.image,imageId:this.config.image?.id||'',seenEggs:this.config.seenEggs||[]};}
 async save(config){const target=join(this.directory,'settings.json');const temp=target+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(config),{mode:0o600});await rename(temp,target);this.config=config;}finally{await unlink(temp).catch(()=>{});}}
 async setImage(bytes){if(bytes.length>10*1024*1024)fail(413,'主题图片最多 10 MB。');const mime=imageType(bytes);if(!mime)fail(415,'主题图片支持 JPG、PNG、GIF、WebP。');const id=randomUUID();const path=join(this.directory,id);await writeFile(path,bytes,{flag:'wx',mode:0o600});const previous=this.config.image;
  try{await this.save({...this.config,image:{id,mime}});}catch(e){await unlink(path).catch(()=>{});throw e;}if(previous)await unlink(join(this.directory,previous.id)).catch(()=>{});return this.state();
 }
 async clearImage(){const old=this.config.image;await this.save({...this.config,image:null});if(old)await unlink(join(this.directory,old.id)).catch(()=>{});return this.state();}
 async settings(input){if(typeof input?.easterEggs!=='boolean')fail(400,'彩蛋设置格式有误。');await this.save({...this.config,easterEggs:input.easterEggs});return this.state();}
 async claimEgg(id){
  if(!['whisper','passport'].includes(id))fail(400,'互动标识无效。');const seen=this.config.seenEggs||[];
  if(!this.config.easterEggs||seen.includes(id))return {...this.state(),triggered:false};
  await this.save({...this.config,seenEggs:[...seen,id]});return {...this.state(),triggered:true};
 }
 async image(){if(!this.config.image)fail(404,'尚未选择主题图片。');return {bytes:await readFile(join(this.directory,this.config.image.id)),mime:this.config.image.mime};}
}
