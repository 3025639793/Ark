import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const password = 'ark-integration-test-password';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function launch(data){
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',ARK_PASSWORD:password,ARK_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 const url=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('startup timeout '+errors)),10000);child.stdout.on('data',chunk=>{const match=/端口 (\d+)/.exec(chunk.toString());if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});child.on('exit',()=>{clearTimeout(timeout);reject(new Error(errors));});});
 return {child,url,async stop(){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}};
}
async function login(url){const response=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
test('private image lifecycle, validation, metadata and restart persistence',async()=>{
 const data=await mkdtemp(join(tmpdir(),'ark-test-'));let server;
 try{
 server=await launch(data);let {url}=server;
 assert.equal((await fetch(url+'/')).status,200);
 assert.equal((await fetch(url+'/api/images')).status,401);
 assert.equal((await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({password:'wrong'})})).status,401);
 let cookie=await login(url);
 const request=(path,options={})=>fetch(url+path,{...options,headers:{cookie,...options.headers}});
 const rejected=await request('/api/images?filename=evil.svg',{method:'POST',body:'<svg><script>alert(1)</script></svg>'});assert.equal(rejected.status,415);
 const uploaded=await request('/api/images?filename=portrait.png',{method:'POST',body:png});assert.equal(uploaded.status,201);const image=await uploaded.json();
 assert.equal((await fetch(url+`/api/images/${image.id}/file`)).status,401);
 const content=await request(`/api/images/${image.id}/file`);assert.equal(content.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await content.arrayBuffer()),png);
 const changed=await request(`/api/images/${image.id}`,{method:'PATCH',body:JSON.stringify({character:'芙莉莲',series:'葬送的芙莉莲',tags:['壁纸','冬天','壁纸'],favorite:true,artist:'画师',source:'https://example.com/art'})});assert.equal(changed.status,200);assert.deepEqual((await changed.json()).tags,['壁纸','冬天']);
 const invalid=await request(`/api/images/${image.id}`,{method:'PATCH',body:JSON.stringify({source:'javascript:alert(1)'})});assert.equal(invalid.status,400);
 const crossOrigin=await request(`/api/images/${image.id}`,{method:'DELETE',headers:{Origin:'https://other.example'}});assert.equal(crossOrigin.status,403);
 const badPayload=await request(`/api/images/${image.id}`,{method:'PATCH',body:'null'});assert.equal(badPayload.status,400);
 const oversized=await request('/api/images',{method:'POST',body:Buffer.alloc(25*1024*1024+1)});assert.equal(oversized.status,413);
 assert.equal((await request('/api/images/../../server.mjs/file')).status,404);
 await server.stop();server=await launch(data);url=server.url;
 // Existing sessions and files both survive a server restart.
 const rows=await (await request('/api/images')).json();assert.equal(rows.length,1);assert.equal(rows[0].character,'芙莉莲');assert.equal(rows[0].favorite,true);
 assert.deepEqual(Buffer.from(await (await request(`/api/images/${image.id}/file`)).arrayBuffer()),png);
 assert.equal((await request(`/api/images/${image.id}`,{method:'DELETE'})).status,200);
 assert.equal((await request(`/api/images/${image.id}/file`)).status,404);
 assert.deepEqual(await (await request('/api/images')).json(),[]);
 assert.equal((await request('/api/logout',{method:'POST'})).status,200);assert.equal((await request('/api/images')).status,401);
 }finally{if(server&&!server.child.killed)await server.stop();await rm(data,{recursive:true,force:true});}
});
