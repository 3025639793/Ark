// Runs inside the native preview window, using temporary fixture data only.
const verifyNavigation = async window => {
 const run=code=>window.webContents.executeJavaScript(code);
 await run(`(() => {
  const roles = Array.from({length:100},(_,n)=>({id:String(n),libraryId:'default',filename:'fixture.png',title:'测试图片',mime:'image/png',bytes:1024*1024,created_at:'2026-01-01T00:00:00.000Z',character:'测试角色 '+n,series:'',folder:'',tags:[],favorite:false,artist:'',source:''}));
  // Use opaque placeholders so no nonexistent fixture image is requested.
  roles.forEach(image=>{image.locked=true;image.protected=true;});
  state.images=roles;changeView('all');
  const list=document.querySelector('#character-list');list.scrollTop=200;
  document.querySelector('#characters-trigger').click();
  if(document.querySelectorAll('.role-card').length!==100)throw Error('Role heading did not open the wall');
  document.querySelector('.role-card .card-open').click();
  if(document.querySelectorAll('.card').length!==1||document.querySelector('#select-toggle').disabled)throw Error('Role detail must show its photos and allow batch editing');
  if(document.querySelector('#view-back').hidden)throw Error('Role detail needs a return button');
  document.querySelector('#view-back').click();
  if(document.querySelectorAll('.role-card').length!==100)throw Error('Return did not restore the wall');
  document.querySelector('#breadcrumbs button').click();
  if(state.view!=='all'||state.character)throw Error('Breadcrumb did not return to all photos');
 })()`);
 for(const [width,height,zoom] of [[1280,900,1],[1280,900,1.5],[800,600,1],[800,600,1.25],[420,850,1]]){
  window.webContents.setZoomFactor(zoom);window.setSize(width,height);
  await run(`(async()=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const rect=id=>document.getElementById(id).getBoundingClientRect();
   function check(){const description=rect('view-description'),storage=rect('storage'),heading=document.querySelector('.heading').getBoundingClientRect();if(storage.top<description.bottom+4||storage.bottom>heading.bottom)throw Error('Header description and statistics overlap or leave the header');}
   changeView('all');check();
   changeView('characters','一个很长的角色名称 Long Character Name 用来验证自动换行');check();
   const trigger=rect('characters-trigger');if(trigger.width<=0||trigger.height<=0)throw Error('Role entry must remain visible at every viewport');
   document.querySelector('#view-back').click();check();
   // Cover the optional custom-art layout as well as the default header.
   document.documentElement.dataset.themeArt='custom';const art=document.getElementById('theme-art');art.hidden=false;art.src='/mascot.png';
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));check();
   art.hidden=true;art.removeAttribute('src');document.documentElement.dataset.themeArt='none';
  })()`);
 }
 window.webContents.setZoomFactor(1);window.setSize(1280,900);
 await run(`state.images=[];changeView('all');new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 console.log('Native role navigation and header layout verified at five window/zoom combinations.');
};
module.exports={verifyNavigation};
