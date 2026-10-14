import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const data = resolve(process.env.ARK_DATA_DIR || join(root, 'data'));
const password = process.env.ARK_PASSWORD;
if (!password || password.length < 12) throw new Error('请设置 ARK_PASSWORD，至少 12 个字符。');
const passwordSalt = randomBytes(32);
const expectedPassword = scryptSync(password, passwordSalt, 32);
const maxBytes = 25 * 1024 * 1024;
mkdirSync(join(data, 'images'), { recursive: true });
const db = new DatabaseSync(join(data, 'ark.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS images (
 id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
 title TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
 tags TEXT NOT NULL DEFAULT '[]', artist TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
 favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
const hash = value => createHash('sha256').update(value).digest('hex');
const loginAttempts = new Map();
const securityHeaders = {
 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
 'Cache-Control': 'no-store',
};
function json(res, status, body) {
 res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
 res.end(JSON.stringify(body));
}
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
async function body(req, limit = 32 * 1024) {
 if (Number(req.headers['content-length']) > limit) fail(413, '文件太大，单张最多 25 MB。');
 let size = 0; const chunks = [];
 for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, '上传内容超出限制。'); chunks.push(chunk); }
 return Buffer.concat(chunks);
}
async function parseJSON(req) { try { return JSON.parse((await body(req)).toString()); } catch (e) { if(e.status) throw e; fail(400, '请求格式有误。'); } }
function session(req) {
 const token = /(?:^|;\s*)ark_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
 if (!token) return false;
 return !!db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash(token), Date.now());
}
function cookie(req, token, age) {
 // Secure cookies require HTTPS; set ARK_SECURE_COOKIE=1 on the hosted server.
 return `ark_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.ARK_SECURE_COOKIE === '1' ? '; Secure' : ''}`;
}
function metadata(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '分类信息格式有误。');
 const fields = ['title', 'character', 'series', 'artist', 'source']; const result = {};
 for (const field of fields) if (Object.hasOwn(input, field)) {
  if (typeof input[field] !== 'string' || input[field].length > (field === 'source' ? 2000 : 200)) fail(400, '文字内容过长或格式有误。');
  result[field] = input[field].trim();
 }
 if (result.source) { try { const u = new URL(result.source); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); } catch { fail(400, '来源链接须以 http:// 或 https:// 开头。'); } }
 if (Object.hasOwn(input, 'tags')) {
  if (!Array.isArray(input.tags) || input.tags.length > 30 || input.tags.some(t => typeof t !== 'string' || t.length > 50)) fail(400, '标签最多 30 个，每个最多 50 字。');
  result.tags = JSON.stringify([...new Set(input.tags.map(t=>t.trim()).filter(Boolean))]);
 }
 if (Object.hasOwn(input, 'favorite')) { if (typeof input.favorite !== 'boolean') fail(400, '收藏状态格式有误。'); result.favorite = Number(input.favorite); }
 return result;
}
function imageType(b) {
 if (b.length >= 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
 if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
 if (b.length >= 6 && ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString())) return 'image/gif';
 if (b.length >= 12 && b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') return 'image/webp';
 return null;
}
const normalize = row => ({ ...row, tags: JSON.parse(row.tags), favorite: !!row.favorite });
const assets = new Map(['/index.html','/app.js','/style.css'].map(path => [path, readFileSync(join(root,'public',path.slice(1)))]));
const server = http.createServer(async (req, res) => {
 try {
  const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
  if (!['GET','HEAD'].includes(req.method)) {
   // Reject cross-origin browser writes without trusting forwarded host headers.
   if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '无法接受其他网站的请求。');
   if (req.headers.origin) { let host; try { host = new URL(req.headers.origin).host; } catch { fail(403,'请求来源无效。'); } if (host !== req.headers.host) fail(403,'请求来源无效。'); }
  }
  if (req.method === 'POST' && path === '/api/login') {
   const ip = req.socket.remoteAddress; const now = Date.now();
   for (const [key, value] of loginAttempts) if (value.until < now) loginAttempts.delete(key);
   const attempt = loginAttempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
   if (attempt.count >= 10) fail(429,'尝试次数过多，请 15 分钟后重试。');
   const input = await parseJSON(req);
   if (typeof input?.password !== 'string' || input.password.length > 1024) fail(400,'密码格式有误。');
   const actual = scryptSync(input.password, passwordSalt, 32);
   if (!timingSafeEqual(actual, expectedPassword)) { attempt.count++; loginAttempts.set(ip, attempt); fail(401,'密码不正确。'); }
   loginAttempts.delete(ip); db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
   const token = randomBytes(32).toString('hex');
   db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash(token), now + 7*86400000);
   res.setHeader('Set-Cookie',cookie(req, token, 7*86400)); return json(res,200,{ok:true});
  }
  if (path.startsWith('/api/')) {
   if (!session(req)) fail(401,'请先解锁你的方舟。');
   if (req.method === 'GET' && path === '/api/images') return json(res,200,db.prepare('SELECT * FROM images ORDER BY created_at DESC, id DESC').all().map(normalize));
   if (req.method === 'POST' && path === '/api/logout') {
    const token = /ark_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
    if(token) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
    res.setHeader('Set-Cookie',cookie(req,'',0)); return json(res,200,{ok:true});
   }
   if (req.method === 'POST' && path === '/api/images') {
    const bytes = await body(req,maxBytes); const mime = imageType(bytes);
    if (!mime) fail(415,'支持 JPG、PNG、GIF 和 WebP 图片。');
    const filename = (url.searchParams.get('filename') || '未命名图片').slice(0,200);
    const id = randomUUID(); await writeFile(join(data,'images',id),bytes,{flag:'wx'});
    try { db.prepare('INSERT INTO images (id,filename,mime,bytes,title,created_at) VALUES (?,?,?,?,?,?)').run(id,filename,mime,bytes.length,filename.replace(/\.[^.]+$/,''),new Date().toISOString()); }
    catch(e) { await unlink(join(data,'images',id)); throw e; }
    return json(res,201,normalize(db.prepare('SELECT * FROM images WHERE id=?').get(id)));
   }
   const match = /^\/api\/images\/([a-f0-9-]{36})(\/file)?$/.exec(path);
   if (match) {
    const id = match[1]; const row = db.prepare('SELECT * FROM images WHERE id=?').get(id); if(!row) fail(404,'图片不存在。');
    if (req.method === 'GET' && match[2]) {
     const bytes = await readFile(join(data,'images',id));
     res.writeHead(200,{...securityHeaders,'Content-Type':row.mime,'Content-Length':bytes.length,...(url.searchParams.has('download') ? {'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/'/g,'%27')}`} : {})}); return res.end(bytes);
    }
    if (req.method === 'PATCH' && !match[2]) {
     const values = metadata(await parseJSON(req)); const keys = Object.keys(values);
     if(keys.length) db.prepare(`UPDATE images SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k=>values[k]),id);
     return json(res,200,normalize(db.prepare('SELECT * FROM images WHERE id=?').get(id)));
    }
    if (req.method === 'DELETE' && !match[2]) {
     // Remove the DB entry first. A failed file cleanup leaves an orphan, never a broken visible entry.
     db.prepare('DELETE FROM images WHERE id=?').run(id);
     await unlink(join(data,'images',id)).catch(e=>{ if(e.code !== 'ENOENT') console.error('图片文件清理失败：',id); });
     return json(res,200,{ok:true});
    }
   }
   fail(404,'接口不存在。');
  }
  const asset = path === '/' ? '/index.html' : path;
  if (['GET','HEAD'].includes(req.method) && assets.has(asset)) {
   res.writeHead(200,{...securityHeaders,'Content-Type':asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'});
   return res.end(req.method === 'HEAD' ? undefined : assets.get(asset));
  }
  fail(404,'页面不存在。');
 } catch(e) { if (!e.status) console.error(e); if (!res.headersSent) json(res,e.status || 500,{error:e.status ? e.message : '服务器暂时无法完成操作，请重试。'}); else res.end(); }
});
server.requestTimeout = 120000;
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',()=>console.log(`Ark 已启动，端口 ${server.address().port}`));
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
