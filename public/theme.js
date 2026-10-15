(()=>{
 const find=id=>document.getElementById(id);
 let config={easterEggs:true,hasImage:false,imageId:''};
 let logoClicks=0,ready=false;const claimed=new Set();
 const whispers=['亮晶晶的喜欢，要好好收起来。','今天的任务：给一份喜欢找到家。','这是宝物，不是奇怪的小零件。','海沫村的灯，总会为小小的发现留着。','收藏配方：一颗星星，三份喜欢。'];
 function apply(value){config=value;for(const id of value.seenEggs||[])claimed.add(id);ready=true;document.documentElement.dataset.easterEggs=value.easterEggs?'on':'off';find('easter-eggs-enabled').checked=value.easterEggs;find('reset-theme-art').hidden=!value.hasImage;find('theme-art').hidden=!value.hasImage;document.documentElement.dataset.themeArt=value.hasImage?'custom':'none';if(value.hasImage)find('theme-art').src=`/api/theme/image?v=${value.imageId}`;else find('theme-art').removeAttribute('src');if(!value.easterEggs)find('village-passport').close();}
 find('choose-theme-art').onclick=()=>find('theme-art-input').click();
 find('theme-art-input').onchange=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const button=find('choose-theme-art');button.disabled=true;
  try{if(file.size>10*1024*1024)throw new Error('主题图片最多 10 MB。');apply(await api('/api/theme/image',{method:'POST',headers:{'Content-Type':file.type},body:file}));find('theme-status').textContent='主题图片已保存，仅在本机使用。';}
  catch(e){find('theme-status').textContent=e.message;}finally{button.disabled=false;}
 };
 find('reset-theme-art').onclick=async()=>{try{apply(await api('/api/theme/image',{method:'DELETE'}));find('theme-status').textContent='主题图片已移除。';}catch(e){find('theme-status').textContent=e.message;}};
 find('easter-eggs-enabled').onchange=async event=>{try{apply(await api('/api/theme',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({easterEggs:event.target.checked})}));find('theme-status').textContent='主题设置已保存。';}catch(e){event.target.checked=config.easterEggs;find('theme-status').textContent=e.message;}};
 async function revealOnce(id,reveal){
  if(!ready||!config.easterEggs||claimed.has(id))return;claimed.add(id);
  try{const value=await api('/api/theme/eggs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});apply(value);if(value.triggered&&config.easterEggs)reveal();}catch{claimed.delete(id);}
 }
 find('melusine-guide').onclick=()=>revealOnce('whisper',()=>{const line=whispers[Math.floor(Math.random()*whispers.length)];find('melusine-guide').querySelector('span').textContent=line;find('village-whisper').textContent=line;});
 find('melusine-logo').onclick=event=>{event.preventDefault();if(!ready||!config.easterEggs||claimed.has('passport'))return;if(++logoClicks>=3){logoClicks=0;revealOnce('passport',()=>find('village-passport').showModal());}};
 api('/api/theme').then(apply).catch(()=>{find('theme-status').textContent='主题设置暂时无法读取，请稍后重试。';});
})();
