const {fixturePng}=require('./image-fixture.cjs');
module.exports.verifyOriginal=async(window,server)=>{
 const photos=[];
 await server.store.serial(async()=>{for(const [width,height] of [[4200,280],[280,4200]])photos.push({...(await server.store.import('default',fixturePng(width,height),'native-layout.png')),width,height});});
 const run=code=>window.webContents.executeJavaScript(code);
 await run(`refresh()`);
 for(const [width,height,zoom] of [[1280,900,1],[800,600,1],[800,600,1.25]]){
  window.webContents.setZoomFactor(zoom);window.setSize(width,height);
  for(const photo of photos)await run(`(async()=>{
   openDetail(${JSON.stringify(photo.id)});
   const deadline=Date.now()+10000;while(document.getElementById('detail-image').naturalWidth!==${photo.width}){if(Date.now()>deadline)throw Error('Native image did not decode');await new Promise(resolve=>setTimeout(resolve,20));}
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const image=document.getElementById('detail-image').getBoundingClientRect();
   for(const id of ['prev','next']){const button=document.getElementById(id),rect=button.getBoundingClientRect();const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);if(hit!==button&&!button.contains(hit))throw Error('Image navigation button is obscured');if(id==='prev'?rect.right>image.left:rect.left<image.right)throw Error('Image must leave space for navigation controls');}
   document.getElementById('view-original').click();
   while(document.getElementById('original-image').naturalWidth!==${photo.width}){if(Date.now()>deadline)throw Error('Original image did not decode');await new Promise(resolve=>setTimeout(resolve,20));}
   document.getElementById('original-actual').click();const original=document.getElementById('original-image');if(parseFloat(original.style.width)!==${photo.width}||parseFloat(original.style.height)!==${photo.height})throw Error('100% view must use intrinsic image dimensions');
   document.getElementById('original-zoom-in').click();if(parseFloat(original.style.width)<=${photo.width})throw Error('Original zoom did not enlarge the image');
   document.getElementById('original-fit').click();const viewport=document.getElementById('original-viewport');if(parseFloat(original.style.width)>viewport.clientWidth||parseFloat(original.style.height)>viewport.clientHeight)throw Error('Fit view must fit the viewport');
   const viewer=document.getElementById('original-viewer');const closed=new Promise(resolve=>viewer.addEventListener('close',resolve,{once:true}));viewer.close();await closed;
   if(!document.getElementById('detail').open||original.hasAttribute('src'))throw Error('Returning from original must retain detail and clear the original source');
  })()`);
 }
 window.webContents.setZoomFactor(1);window.setSize(1280,900);
 await run(`(async()=>{const detail=document.getElementById('detail');const closed=new Promise(resolve=>detail.addEventListener('close',resolve,{once:true}));detail.close();await closed;})()`);
 await server.store.serial(()=>server.store.removeBatch('default',photos.map(p=>p.id)));await run(`refresh()`);
 console.log('Native wide/tall image controls and full-resolution zoom verified across three window/zoom combinations.');
};
