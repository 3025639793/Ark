const fs=require('node:fs/promises');
const path=require('node:path');
const {fixturePng}=require('./image-fixture.cjs');
module.exports.verifyEncryption=async(window,server)=>{
 const store=server.store;const password=' 统一测试🔐密码 ';
 const bytes=fixturePng(320,240,(x)=>x<160?[235,55,45,255]:[40,60,225,255]);const otherBytes=fixturePng(240,320,(_,y)=>y<160?[40,210,70,255]:[235,195,30,255]);
 let a,b,other;
 await store.serial(async()=>{await store.setupMaster(password);a=await store.import('default',bytes,'fixture-a.png','测试/角色甲',false,'角色甲');other=(await store.create({name:'临时验证库'})).libraries.at(-1).id;b=await store.import(other,otherBytes,'fixture-b.png','测试/角色乙',false,'角色乙');await store.edit('default',a.id,{favorite:true,tags:['测试标签']});await store.protect('default',[a.id],undefined,{[a.id]:Buffer.alloc(192,100).toString('base64')});await store.protect(other,[b.id]);store.lockAll();});
 await window.webContents.executeJavaScript(`(async()=>{
  const password=${JSON.stringify(password)};const id=${JSON.stringify(a.id)};
  const wait=async check=>{const until=Date.now()+15000;while(!check()){if(Date.now()>until)throw Error('Native encryption UI timed out');await new Promise(resolve=>setTimeout(resolve,25));}};
  await refresh();changeView('encrypted');await wait(()=>document.querySelectorAll('#gallery .card').length===2);
  if([...document.querySelectorAll('#gallery .card-image')].some(img=>(img.getAttribute('src')||'').endsWith('/file')))throw Error('Locked aggregate must not request thumbnails');
  changeView('all');await refresh();
  for(const view of ['all','favorite','unfiled','characters']){changeView(view);if(document.querySelectorAll('#gallery .card').length||document.querySelectorAll('#character-list .character-link').length||document.getElementById('all-count').textContent!=='0')throw Error('Locked photos must be absent from every normal gallery, role and count');}
  changeView('encrypted');await refresh();
  const lockedNodes=[...document.querySelectorAll('#gallery .card-image')];
  openDetail(id);document.getElementById('protection-password').value=password;document.getElementById('protection-form').requestSubmit();
  await wait(()=>document.getElementById('detail').open&&!document.getElementById('protection-dialog').open);
  await wait(()=>document.getElementById('detail-image').naturalWidth>0);
  await wait(()=>state.encryptedImages.find(image=>image.id===id)?.previewVersion===2);await wait(()=>document.querySelectorAll('#gallery .locked-preview').length===1);
  if([...document.querySelectorAll('#gallery .card-image')].some(img=>(img.getAttribute('src')||'').endsWith('/file')))throw Error('Single unlock must not expose aggregate originals');
  if(lockedNodes.some(node=>!node.isConnected))throw Error('Single decrypt and preview generation must retain existing cards');
  document.getElementById('view-original').click();if(!document.getElementById('original-viewer').open)throw Error('Encrypted original view did not open');
  const detail=document.getElementById('detail');const closed=new Promise(resolve=>detail.addEventListener('close',resolve,{once:true}));detail.close();await closed;if(document.getElementById('original-viewer').open||document.getElementById('original-image').hasAttribute('src'))throw Error('Closing a single encrypted detail must clear the original view');
  await new Promise(resolve=>setTimeout(resolve,100));
  const locked=await fetch(fileURL({libraryId:'default',id}),{headers:{'X-Ark-Token':token}});if(locked.status!==423)throw Error('Closing single view must revoke file access');
  document.getElementById('encrypted-unlock-all').click();document.getElementById('protection-password').value=password;document.getElementById('protection-form').requestSubmit();
  await wait(()=>!document.getElementById('protection-dialog').open&&[...document.querySelectorAll('#gallery .card-image')].filter(img=>img.hasAttribute('src')).length===2);
  await wait(()=>state.encryptedImages.every(image=>image.previewVersion===2));
  const originalNodes=[...document.querySelectorAll('#gallery .card-image')];await Promise.all(originalNodes.map(image=>image.decode()));
  const resourceCount=()=>performance.getEntriesByType('resource').filter(entry=>entry.name.endsWith('/file')).length;const before=resourceCount();
  for(const order of ['name','old','random','new']){document.getElementById('sort').value=order;document.getElementById('sort').dispatchEvent(new Event('change'));if(order==='random'){const ordered=[...document.getElementById('gallery').children];render();if(ordered.some((card,index)=>document.getElementById('gallery').children[index]!==card))throw Error('Random sorting must remain stable during rendering');}}
  await refresh();await new Promise(resolve=>setTimeout(resolve,150));
  if(originalNodes.some(node=>!node.isConnected)||resourceCount()!==before)throw Error('Sorting and refreshing must retain decoded image elements without reloading originals');
  openDetail(id);document.getElementById('view-original').click();
  document.getElementById('encrypted-lock-all').click();await wait(()=>[...document.querySelectorAll('#gallery .card-image')].every(img=>!(img.getAttribute('src')||'').endsWith('/file')));if(document.getElementById('original-viewer').open||document.getElementById('original-image').hasAttribute('src'))throw Error('Lock-all must clear the original view');
  await wait(()=>document.querySelectorAll('#gallery .locked-preview').length===2);
  const previews=[...document.querySelectorAll('#gallery .locked-preview')];await Promise.all(previews.map(image=>image.decode()));
  const samples=previews.map(image=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,pixels:[...ctx.getImageData(0,0,canvas.width,canvas.height).data]};});
  if(samples.some(sample=>Math.max(sample.width,sample.height)!==64)||samples[0].width===samples[1].width)throw Error('Blurred thumbnails must preserve each original aspect ratio');
  if(samples[0].pixels.join(',')===samples[1].pixels.join(','))throw Error('Different images must produce different blurred covers');
  for(const sample of samples){const colours=new Set();for(let n=0;n<sample.pixels.length;n+=4)colours.add(sample.pixels.slice(n,n+3).join(','));if(colours.size<10)throw Error('Blurred thumbnail must retain original composition and soft colour transitions');}
  const stable=previews.slice();render();if(stable.some(image=>!image.isConnected))throw Error('Locked preview refresh must preserve image elements');
  await api('/api/unlock-matching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,scope:'session'})});const single=await postOperation('unlock-image',{id,password,scope:'single'},'default');await refresh();openDetail(id,single.image);navigateDetail(1);const nextId=state.detailId;
  await new Promise(resolve=>setTimeout(resolve,250));if(nextId===id||!document.getElementById('detail').open||state.detailId!==nextId)throw Error('Releasing a previous single-image grant must not close the newly opened detail');document.getElementById('detail').close();await api('/api/lock-all',{method:'POST'});await refresh();
  const cards=[...document.querySelectorAll('#gallery .card')],frames=cards.map(card=>card.querySelector('.photo-media'));const heights=frames.map(frame=>frame.getBoundingClientRect().height);
  const nativeDecode=HTMLImageElement.prototype.decode;let releaseDecode;let gate=new Promise(resolve=>{releaseDecode=resolve;});
  HTMLImageElement.prototype.decode=function(){const decoded=nativeDecode.call(this);return this.matches('#gallery .card-image')?Promise.all([decoded,gate]).then(()=>{}):decoded;};
  try{
   await api('/api/unlock-matching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,scope:'session'})});await refresh();
   await wait(()=>frames.every(frame=>frame.querySelector('.card-image').naturalWidth>0));
   if(cards.some(card=>!card.isConnected)||frames.some((frame,index)=>Math.abs(frame.getBoundingClientRect().height-heights[index])>1))throw Error('Unlocking must retain card identity and reserved image dimensions');
   if(frames.some(frame=>frame.classList.contains('media-ready')||!frame.querySelector('.card-preview').hasAttribute('src')))throw Error('Blurred covers must stay visible while original decoding is delayed');
   render();if(frames.some(frame=>frame.classList.contains('media-ready')))throw Error('Background rendering must not reveal undecoded originals');
   releaseDecode();await wait(()=>frames.every(frame=>frame.classList.contains('media-ready')));
   if(frames.some((frame,index)=>Math.abs(frame.getBoundingClientRect().height-heights[index])>1))throw Error('Decode completion must not move surrounding cards');
   await api('/api/lock-all',{method:'POST'});await refresh();
   if(frames.some(frame=>frame.classList.contains('media-ready')||frame.querySelector('.card-image').hasAttribute('src')))throw Error('Locking must immediately clear the original layer');
   gate=new Promise(resolve=>{releaseDecode=resolve;});await api('/api/unlock-matching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,scope:'session'})});await refresh();await wait(()=>frames.every(frame=>frame.querySelector('.card-image').naturalWidth>0));
   await api('/api/lock-all',{method:'POST'});await refresh();releaseDecode();await new Promise(resolve=>setTimeout(resolve,100));
   if(cards.some(card=>!card.isConnected)||frames.some(frame=>frame.classList.contains('media-ready')||frame.querySelector('.card-image').hasAttribute('src')))throw Error('A late decode must not reveal a newly locked original');
  }finally{releaseDecode();HTMLImageElement.prototype.decode=nativeDecode;}
  await api('/api/unlock-matching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,scope:'session'})});await refresh();changeView('all');await refresh();
  if(state.images.length!==1||state.images[0].id!==id||state.images[0].character!=='角色甲'||state.images[0].folder!=='测试/角色甲')throw Error('Temporary unlock must restore original location and role');
  changeView('favorite');if(document.querySelectorAll('#gallery .card').length!==1)throw Error('Temporary unlock must restore favorites');changeView('characters');if(document.querySelectorAll('#gallery .role-card').length!==1)throw Error('Temporary unlock must restore role wall');
  await api('/api/lock-all',{method:'POST'});await refresh();if(document.querySelectorAll('#gallery .card').length||document.querySelectorAll('#character-list .character-link').length)throw Error('Relocking must hide restored photos from normal locations');
  changeView('encrypted');await refresh();if(document.querySelectorAll('#gallery .locked-preview').length!==2)throw Error('Relocked photos must remain accessible in the encrypted collection');
  const seal=document.querySelector('.encryption-overlay');await seal.decode();if(!seal.naturalWidth)throw Error('Transparent encryption seal did not load');const frame=seal.parentElement.getBoundingClientRect(),bounds=seal.getBoundingClientRect();if(bounds.width>=frame.width*.8||bounds.height>=frame.height*.8)throw Error('Seal must leave the blurred preview visible around it');
 })()`);
 const screenshot=await window.webContents.capturePage();await fs.mkdir('release',{recursive:true});await fs.writeFile('release/encrypted-covers.png',screenshot.toPNG());
 await store.serial(async()=>{store.lockAll();await store.removeBatch('default',[a.id]);await store.removeBatch(other,[b.id]);store.catalogs.delete(other);store.registry.libraries=store.registry.libraries.filter(l=>l.id!==other);delete store.registry.master;await store.saveRegistry();});
 await window.webContents.executeJavaScript(`(async()=>{changeView('all');await refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
 console.log('Native unified-password, cross-library aggregate, single view and lock-all verified.');
};
