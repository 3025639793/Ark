const fs=require('node:fs/promises');
const path=require('node:path');
module.exports.verifyEncryption=async(window,server)=>{
 const store=server.store;const password=' 统一测试🔐密码 ';
 const bytes=await fs.readFile(path.join(__dirname,'../public/mascot.png'));
 let a,b,other;
 await store.serial(async()=>{await store.setupMaster(password);a=await store.import('default',bytes,'fixture-a.png','测试/角色甲',false,'角色甲');other=(await store.create({name:'临时验证库'})).libraries.at(-1).id;b=await store.import(other,bytes,'fixture-b.png','测试/角色乙',false,'角色乙');await store.protect('default',[a.id]);await store.protect(other,[b.id]);store.lockAll();});
 await window.webContents.executeJavaScript(`(async()=>{
  const password=${JSON.stringify(password)};const id=${JSON.stringify(a.id)};
  const wait=async check=>{const until=Date.now()+15000;while(!check()){if(Date.now()>until)throw Error('Native encryption UI timed out');await new Promise(resolve=>setTimeout(resolve,25));}};
  await refresh();changeView('encrypted');await wait(()=>document.querySelectorAll('#gallery .card').length===2);
  if([...document.querySelectorAll('#gallery img')].some(img=>img.hasAttribute('src')))throw Error('Locked aggregate must not request thumbnails');
  openDetail(id);document.getElementById('protection-password').value=password;document.getElementById('protection-form').requestSubmit();
  await wait(()=>document.getElementById('detail').open&&!document.getElementById('protection-dialog').open);
  await wait(()=>document.getElementById('detail-image').naturalWidth>0);
  if([...document.querySelectorAll('#gallery img')].some(img=>img.hasAttribute('src')))throw Error('Single unlock must not expose aggregate thumbnails');
  document.getElementById('view-original').click();if(!document.getElementById('original-viewer').open)throw Error('Encrypted original view did not open');
  const detail=document.getElementById('detail');const closed=new Promise(resolve=>detail.addEventListener('close',resolve,{once:true}));detail.close();await closed;if(document.getElementById('original-viewer').open||document.getElementById('original-image').hasAttribute('src'))throw Error('Closing a single encrypted detail must clear the original view');
  await new Promise(resolve=>setTimeout(resolve,100));
  const locked=await fetch(fileURL({libraryId:'default',id}),{headers:{'X-Ark-Token':token}});if(locked.status!==423)throw Error('Closing single view must revoke file access');
  document.getElementById('encrypted-unlock-all').click();document.getElementById('protection-password').value=password;document.getElementById('protection-form').requestSubmit();
  await wait(()=>!document.getElementById('protection-dialog').open&&[...document.querySelectorAll('#gallery img')].filter(img=>img.hasAttribute('src')).length===2);
  openDetail(id);document.getElementById('view-original').click();
  document.getElementById('encrypted-lock-all').click();await wait(()=>[...document.querySelectorAll('#gallery img')].every(img=>!img.hasAttribute('src')));if(document.getElementById('original-viewer').open||document.getElementById('original-image').hasAttribute('src'))throw Error('Lock-all must clear the original view');
 })()`);
 await store.serial(async()=>{store.lockAll();await store.removeBatch('default',[a.id]);await store.removeBatch(other,[b.id]);store.catalogs.delete(other);store.registry.libraries=store.registry.libraries.filter(l=>l.id!==other);delete store.registry.master;await store.saveRegistry();});
 await window.webContents.executeJavaScript(`(async()=>{changeView('all');await refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
 console.log('Native unified-password, cross-library aggregate, single view and lock-all verified.');
};
