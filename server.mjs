import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlbumStore, fail } from './lib/store.mjs';
import { ThemeStore } from './lib/theme.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const headers={
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function json(res,status,value){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req,limit=32768){if(Number(req.headers['content-length'])>limit)fail(413,'导入文件太大，单张最多 25 MB。');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'请求内容超出限制。');chunks.push(chunk);}return Buffer.concat(chunks);}
async function input(req){try{const value=JSON.parse((await body(req)).toString());if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'请求格式有误。');return value;}catch(e){if(e.status)throw e;fail(400,'请求格式有误。');}}
function equal(value,token){return typeof value==='string'&&value.length===token.length&&timingSafeEqual(Buffer.from(value),Buffer.from(token));}
export async function startLocalApp({dataDir=process.env.ARK_DATA_DIR||join(root,'data'),port=Number(process.env.PORT||0)}={}){
 const store=new AlbumStore(resolve(dataDir));await store.init();const theme=new ThemeStore(resolve(dataDir));await theme.init();const token=randomBytes(32).toString('hex');
 const assets=new Map(await Promise.all(['index.html','folders.js','app.js','style.css','theme.css','theme.js','mascot.svg','mascot.png'].map(async file=>['/'+file,await readFile(join(root,'public',file)).catch(error=>{if(file==='mascot.png'&&error.code==='ENOENT')return readFile(join(root,'public','mascot.svg'));throw error;})])));
 const attempts=new Map();
 const server=http.createServer(async(req,res)=>{
  try{
   const host=req.headers.host;const origin=`http://127.0.0.1:${server.address().port}`;
   if(host!==`127.0.0.1:${server.address().port}`&&host!==`localhost:${server.address().port}`)fail(403,'仅允许从本机访问。');
   if(req.headers['sec-fetch-site']==='cross-site')fail(403,'不接受其他网站的请求。');
   if(req.headers.origin&&![origin,origin.replace('127.0.0.1','localhost')].includes(req.headers.origin))fail(403,'请求来源无效。');
   const url=new URL(req.url,origin);const path=url.pathname;
   if(!path.startsWith('/api/')){
    const asset=path==='/'?'/index.html':path;if(!['GET','HEAD'].includes(req.method)||!assets.has(asset))fail(404,'页面不存在。');
    let bytes=assets.get(asset);if(asset==='/index.html'){bytes=Buffer.from(bytes.toString().replace('<!--LOCAL_TOKEN-->',`<meta name="ark-token" content="${token}">`));res.setHeader('Set-Cookie',`ark_local=${token}; HttpOnly; SameSite=Strict; Path=/`);}
    res.writeHead(200,{...headers,'Content-Type':asset.endsWith('.js')?'text/javascript; charset=utf-8':asset.endsWith('.css')?'text/css; charset=utf-8':asset.endsWith('.svg')?'image/svg+xml':asset.endsWith('.png')?(bytes[0]===137?'image/png':'image/svg+xml'):'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:bytes);
   }
   const isFile=path==='/api/theme/image'||/^\/api\/libraries\/[^/]+\/images\/[^/]+\/file$/.test(path);
   const cookie=/(?:^|;\s*)ark_local=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
   if(!equal(req.headers['x-ark-token'],token)&&!(req.method==='GET'&&isFile&&equal(cookie,token)))fail(403,'本地访问令牌无效，请重新打开相册。');
   await store.serial(async()=>{
    if(path==='/api/theme'&&req.method==='GET')return json(res,200,theme.state());
    if(path==='/api/theme'&&req.method==='PATCH')return json(res,200,await theme.settings(await input(req)));
    if(path==='/api/theme/image'){
     if(req.method==='POST')return json(res,200,await theme.setImage(await body(req,10*1024*1024)));
     if(req.method==='DELETE')return json(res,200,await theme.clearImage());
     if(req.method==='GET'){const {bytes,mime}=await theme.image();res.writeHead(200,{...headers,'Content-Type':mime,'Content-Length':bytes.length});return res.end(bytes);}
    }
    if(path==='/api/import-session'&&req.method==='POST'){const value=await input(req);store.activeImport=value.active===true;if(!store.activeImport&&store.pendingLock){store.pendingLock=false;store.lockAll();}return json(res,200,{ok:true});}
    const operation=/^\/api\/libraries\/(default|[a-f0-9-]{36})\/(protect|unlock-image|lock-image|unprotect|delete-character)$/.exec(path);
    if(operation&&req.method==='POST'){
     const v=await input(req);const id=operation[1];let result;
     switch(operation[2]){
      case 'protect':result=await store.protect(id,v.ids,v.password);break;
      case 'unlock-image':{const now=Date.now();const attempt=attempts.get('images')||{count:0,until:now+60000};if(attempt.until<=now){attempt.count=0;attempt.until=now+60000;}if(attempt.count>=5)fail(429,'请一分钟后再尝试密码。');try{result=await store.unlockImages(id,v.id,v.password,v.scope);attempts.delete('images');}catch(e){if(e.status===401){attempt.count++;attempts.set('images',attempt);}throw e;}break;}
      case 'lock-image':store.lockImage(v.id);result={ok:true};break;
      case 'unprotect':result=await store.unprotect(id,v.id);break;
      case 'delete-character':result=await store.deleteCharacter(id,v.name);break;
     }return json(res,200,result);
    }
    if(path==='/api/state'&&req.method==='GET')return json(res,200,store.state());
    if(path==='/api/settings'&&req.method==='PATCH')return json(res,200,await store.settings(await input(req)));
    if(path==='/api/random'&&req.method==='POST')return json(res,200,store.random(await input(req)));
    if(path==='/api/lock-all'&&req.method==='POST'){store.lockAll();return json(res,200,store.state());}
    if(path==='/api/libraries'&&req.method==='POST')return json(res,201,await store.create(await input(req)));
    const batch=/^\/api\/libraries\/(default|[a-f0-9-]{36})\/images\/batch-delete$/.exec(path);
    if(batch&&req.method==='POST'){const value=await input(req);return json(res,200,await store.removeBatch(batch[1],value.ids));}
    const match=/^\/api\/libraries\/(default|[a-f0-9-]{36})(?:\/(unlock|lock|random|images)(?:\/([a-f0-9-]{36})(\/file)?)?)?$/.exec(path);
    if(!match)fail(404,'接口不存在。');const [,id,action,imageId,file]=match;store.library(id);
    if(action==='unlock'&&req.method==='POST'){
     const now=Date.now();const attempt=attempts.get(id)||{count:0,until:now+60000};if(attempt.until<=now){attempt.count=0;attempt.until=now+60000;}if(attempt.count>=5)fail(429,'尝试次数过多，请一分钟后重试。');
     const value=await input(req);try{const result=await store.unlock(id,value?.password);attempts.delete(id);return json(res,200,result);}catch(e){if(e.status===401){attempt.count++;attempts.set(id,attempt);}throw e;}
    }
    if(action==='lock'&&req.method==='POST'){if(store.library(id).encrypted)store.lock(id);return json(res,200,store.state());}
    if(action==='random'&&req.method==='PATCH'){const value=await input(req);return json(res,200,await store.allowRandom(id,value?.allowRandom));}
    if(action==='images'&&!imageId){
     if(req.method==='GET')return json(res,200,store.list(id));
     if(req.method==='POST'){store.access(id);const bytes=await body(req,25*1024*1024);return json(res,201,await store.import(id,bytes,url.searchParams.get('filename')||'未命名图片',url.searchParams.get('folder')||'',url.searchParams.get('inferCharacter')==='true',url.searchParams.has('character')?url.searchParams.get('character'):undefined,url.searchParams.get('updateDuplicateCharacter')==='true'));}
    }
    if(action==='images'&&imageId){
     if(file&&req.method==='GET'){const {image,bytes}=await store.file(id,imageId);res.writeHead(200,{...headers,'Content-Type':image.mime,'Content-Length':bytes.length,...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(image.filename).replace(/'/g,'%27')}`}:{})});return res.end(bytes);}
     if(!file&&req.method==='PATCH')return json(res,200,await store.edit(id,imageId,await input(req)));
     if(!file&&req.method==='DELETE'){await store.remove(id,imageId);return json(res,200,{ok:true});}
    }
    fail(404,'接口不存在。');
   });
  }catch(e){if(!e.status)console.error(e.message);if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'无法完成操作，请检查本地数据目录和磁盘空间。'});else res.end();}
 });
 server.requestTimeout=120000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const timer=setInterval(()=>store.serial(()=>store.expire()),10000);timer.unref();
 return {url:`http://127.0.0.1:${server.address().port}`,store,async close(){clearInterval(timer);await store.serial(()=>store.lockAll());await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await startLocalApp();console.log(`Ark 本地相册：${app.url}`);
 const close=async()=>{await app.close();process.exit(0);};process.on('SIGTERM',close);process.on('SIGINT',close);
}
