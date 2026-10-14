const $ = id => document.getElementById(id);
const state = { images: [], view: 'all', character: '', tag: '', query: '', series: '', folder: '', deleting: false, sort: 'new', selecting: false, selected: new Set(), detailId: '', uploading: false, libraries: [], libraryId: 'default', settings: {}, randomImage: null };
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
const token=document.querySelector('meta[name="ark-token"]').content;
function libraryPath(id=state.libraryId){return `/api/libraries/${id}`;}
function currentLibrary(){return state.libraries.find(l=>l.id===state.libraryId);}
async function api(path,options={}){
 const response=await fetch(path,{...options,headers:{'X-Ark-Token':token,...options.headers}});
 const value=await response.json();
 if(!response.ok){if(response.status===423){clearSensitiveViews();setTimeout(()=>refresh().catch(()=>{}),0);}throw new Error(value.error||'操作失败，请重试。');}
 return value;
}
const patch=(id,data)=>api(`${libraryPath()}/images/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const fileURL=image=>`${libraryPath(image.libraryId)}/images/${image.id}/file`;
function clearSensitiveViews(){state.images=[];state.selected.clear();state.detailId='';$('detail-image').removeAttribute('src');$('edit-form').reset();$('detail').close();stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-caption').textContent='';$('random-dialog').close();render();}
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function groups(field){const result=new Map();for(const image of state.images){if(!image[field])continue;if(!result.has(image[field]))result.set(image[field],[]);result.get(image[field]).push(image);}return [...result].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],'zh'));}
function filtered(){
 const query=state.query.toLocaleLowerCase();
 return state.images.filter(i=>(state.view!=='favorite'||i.favorite)&&(state.view!=='unfiled'||(!i.character&&!i.series&&!i.folder&&!i.tags.length))&&(!state.character||i.character===state.character)&&(!state.folder||(i.folder||'')===state.folder||(i.folder||'').startsWith(state.folder+'/'))&&(!state.series||i.series===state.series)&&(!state.tag||i.tags.includes(state.tag))&&(!query||[i.title,i.filename,i.character,i.series,i.folder||'',i.artist,...i.tags].join(' ').toLocaleLowerCase().includes(query))).sort((a,b)=>state.sort==='name'?a.title.localeCompare(b.title,'zh'):state.sort==='old'?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at));
}
function selectOptions(select,values,selected){select.replaceChildren();select.append(new Option('所有作品',''));for(const value of values)select.append(new Option(value,value));select.value=values.includes(selected)?selected:'';state.series=select.value;}
function render(){
 const library=currentLibrary();const locked=library?.encrypted&&!library.unlocked;
 $('library-select').replaceChildren(...state.libraries.map(l=>new Option(`${l.encrypted?(l.unlocked?'◇ ':'◆ '):''}${l.name}`,l.id)));$('library-select').value=state.libraryId;
 $('lock-library').hidden=!library?.encrypted||!library.unlocked;$('locked-library').hidden=!locked;
 document.querySelectorAll('.upload-trigger').forEach(b=>b.disabled=locked||state.uploading);
 $('select-toggle').disabled=locked||state.deleting;$('storage').hidden=locked;$('folder-trigger').disabled=locked||state.uploading;$('library-select').disabled=state.deleting;

 $('all-count').textContent=state.images.length;$('favorite-count').textContent=state.images.filter(i=>i.favorite).length;$('unfiled-count').textContent=state.images.filter(i=>!i.character&&!i.series&&!i.folder&&!i.tags.length).length;
 const characters=groups('character');$('character-count').textContent=characters.length||'';
 $('character-list').replaceChildren();
 for(const [name,images] of characters){const button=element('button',`character-link${state.character===name?' active':''}`);const img=element('img','character-avatar');img.src=fileURL(images[0]);img.alt='';img.loading='lazy';button.append(img,element('span','',name),element('small','',images.length));button.onclick=()=>changeView('all',name);$('character-list').append(button);}
 if(!characters.length)$('character-list').append(element('p','nav-label','整理图片后，角色会出现在这里。'));
 for(const [field,id] of [['character','characters-options'],['series','series-options']]){$(id).replaceChildren(...groups(field).map(([value])=>new Option(value,value)));}
 selectOptions($('series-filter'),groups('series').map(([n])=>n),state.series);
 const folders=new Set();for(const image of state.images){const parts=(image.folder||'').split('/').filter(Boolean);parts.forEach((_,index)=>folders.add(parts.slice(0,index+1).join('/')));}
 if(state.folder&&!folders.has(state.folder))state.folder='';
 $('folder-filter').replaceChildren(new Option('所有文件夹分类',''),...[...folders].sort((a,b)=>a.localeCompare(b,'zh')).map(folder=>new Option(folder,folder)));$('folder-filter').value=state.folder;

 const titles={all:'全部图片',favorite:'特别喜欢',unfiled:'待整理',characters:'角色收藏墙'};const title=state.character||titles[state.view];
 $('view-title').replaceChildren(document.createTextNode(title),element('span','title-dot','.'));$('crumb').textContent=title;
 $('view-description').textContent=state.character?'属于这个角色的每一份喜欢。':state.view==='characters'?'把喜欢的角色，收藏成自己的图鉴。':state.view==='unfiled'?'不急，慢慢给喜欢的图片找到归属。':'给每一份喜欢，留一个位置。';
 $('storage').textContent=`${state.images.length} 张图片 · ${(state.images.reduce((sum,i)=>sum+i.bytes,0)/1048576).toFixed(1)} MB`;
 document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===state.view&&!state.character));
 const tags=[...new Set(state.images.flatMap(i=>i.tags))].sort((a,b)=>a.localeCompare(b,'zh'));if(state.tag&&!tags.includes(state.tag))state.tag='';
 $('tag-list').replaceChildren();for(const tag of ['',...tags]){if(!tag&&!tags.length)continue;const b=element('button',`tag${state.tag===tag?' active':''}`,tag||'全部标签');b.onclick=()=>{state.tag=tag;render();};$('tag-list').append(b);}
 $('batch-bar').hidden=!state.selecting;$('select-toggle').textContent=state.selecting?'退出批量':'批量整理';$('selected-count').textContent=`已选 ${state.selected.size} 张`;$('batch-delete').textContent=state.deleting?'正在删除…':'删除所选';$('select-all').disabled=state.deleting;$('cancel-select').disabled=state.deleting;$('batch-edit').disabled=!state.selected.size||state.deleting;$('batch-delete').disabled=!state.selected.size||state.deleting;$('select-toggle').disabled=locked||state.deleting||state.view==='characters';
 $('gallery').replaceChildren();const images=filtered();
 if(state.view==='characters'){
  const visible=characters.map(([name])=>[name,images.filter(i=>i.character===name)]).filter(([,items])=>items.length);
  for(const [name,items] of visible){const card=element('article','card role-card');const button=element('button','card-open');const img=element('img','card-image');img.src=fileURL(items.find(i=>i.favorite)||items[0]);img.alt=name;img.loading='lazy';const info=element('div','card-info');info.append(element('h3','',name),element('p','',`${items.length} 张收藏`));button.append(img,info);button.onclick=()=>changeView('all',name);card.append(button);$('gallery').append(card);}
 }else for(const image of images){
  const card=element('article',`card${state.selected.has(image.id)?' selected':''}`);const button=element('button','card-open');const img=element('img','card-image');img.src=fileURL(image);img.alt=image.title;img.loading='lazy';const info=element('div','card-info');info.append(element('h3','',image.title||image.filename),element('p','',[image.folder,image.character,image.series,...image.tags.slice(0,2)].filter(Boolean).join(' · ')||'等待整理'));button.append(img,info);button.onclick=()=>state.selecting?toggleSelected(image.id):openDetail(image.id);card.append(button);
  if(state.selecting){const choose=element('button','select-image',state.selected.has(image.id)?'✓':'○');choose.setAttribute('aria-label',`选择 ${image.title}`);choose.setAttribute('aria-pressed',String(state.selected.has(image.id)));choose.onclick=()=>toggleSelected(image.id);card.append(choose);}
  else{const favorite=element('button','favorite-button',image.favorite?'♥':'♡');favorite.setAttribute('aria-label',image.favorite?'取消特别喜欢':'标记为特别喜欢');favorite.setAttribute('aria-pressed',String(image.favorite));favorite.onclick=async()=>{favorite.disabled=true;try{const updated=await patch(image.id,{favorite:!image.favorite});replaceImage(updated);render();}catch(e){toast(e.message);favorite.disabled=false;}};card.append(favorite);}
  $('gallery').append(card);
 }
 const isEmpty=!$('gallery').childElementCount;$('gallery').hidden=isEmpty||locked;$('empty').hidden=!isEmpty||locked;
 const first=!state.images.length;const noCharacters=state.view==='characters'&&!characters.length;
 $('empty-title').textContent=first?'第一份喜欢，从这里开始':noCharacters?'为图片添加角色，点亮收藏墙':'这里暂时没有图片';
 $('empty-description').textContent=first?'导入喜欢的图片，再用角色、作品和标签慢慢整理。':noCharacters?'打开一张图片，填写角色名称，或通过批量整理一次添加。':'试试其他筛选条件，或导入新的收藏。';
 $('empty').querySelector('.upload-trigger').textContent=first?'＋ 导入第一张图片':'＋ 导入图片';
}
function changeView(view,character=''){state.view=view;state.character=character;state.tag='';state.series='';state.folder='';state.selecting=false;state.selected.clear();render();}
function toggleSelected(id){if(state.deleting)return;state.selected.has(id)?state.selected.delete(id):state.selected.add(id);render();}
function replaceImage(image){state.images=state.images.map(i=>i.id===image.id?image:i);}
async function refresh(){const snapshot=await api('/api/state');applySnapshot(snapshot);const library=currentLibrary();state.images=library?.unlocked?await api(`${libraryPath()}/images`):[];render();}
function applySnapshot(snapshot){state.libraries=snapshot.libraries;state.settings=snapshot.settings;if(!currentLibrary())state.libraryId=state.libraries[0].id;const library=currentLibrary();if(!library.unlocked&&(state.images.length||state.detailId))clearSensitiveViews();const random=state.randomImage;if(random){const lib=state.libraries.find(l=>l.id===random.libraryId);if(!lib||!lib.unlocked||!lib.allowRandom||(lib.encrypted&&!state.settings.allowEncryptedRandom)){stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-caption').textContent='';$('random-error').textContent='图片库已锁定或不再允许展示。';}}}

function openDetail(id){const image=state.images.find(i=>i.id===id);if(!image)return;state.detailId=id;$('detail-image').src=fileURL(image);$('detail-image').alt=image.title;const form=$('edit-form');for(const field of ['title','character','series','folder','artist','source'])form.elements[field].value=image[field]||'';form.elements.tags.value=image.tags.join('，');form.elements.favorite.checked=image.favorite;$('image-info').textContent=`${image.filename} · ${(image.bytes/1048576).toFixed(2)} MB · ${new Date(image.created_at).toLocaleDateString()}`;$('download').href=fileURL(image)+'?download=1';if(!$('detail').open)$('detail').showModal();}
function navigateDetail(delta){const images=filtered();const index=images.findIndex(i=>i.id===state.detailId);if(images.length)openDetail(images[(index+delta+images.length)%images.length].id);}
function splitTags(value){return [...new Set(value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean))];}
$('library-select').onchange=async event=>{const libraryId=event.target.value;clearSensitiveViews();state.libraryId=libraryId;changeView('all');try{await refresh();}catch(e){toast(e.message);}};
$('lock-library').onclick=async()=>{try{applySnapshot(await api(`${libraryPath()}/lock`,{method:'POST'}));clearSensitiveViews();render();}catch(e){toast(e.message);}};
$('lock-all').onclick=async()=>{try{applySnapshot(await api('/api/lock-all',{method:'POST'}));clearSensitiveViews();await refresh();toast('加密库已全部锁定');}catch(e){toast(e.message);}};
$('unlock-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;$('unlock-error').textContent='';try{await api(`${libraryPath()}/unlock`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('unlock-password').value})});$('unlock-password').value='';await refresh();}catch(e){$('unlock-error').textContent=e.message;}finally{button.disabled=false;}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>changeView(b.dataset.view));
$('search').oninput=event=>{state.query=event.target.value;render();};$('folder-filter').onchange=event=>{state.folder=event.target.value;render();};$('series-filter').onchange=event=>{state.series=event.target.value;render();};$('sort').onchange=event=>{state.sort=event.target.value;render();};
$('select-toggle').onclick=()=>{state.selecting=!state.selecting;state.selected.clear();render();};$('cancel-select').onclick=()=>{state.selecting=false;state.selected.clear();render();};$('select-all').onclick=()=>{filtered().forEach(i=>state.selected.add(i.id));render();};
$('batch-edit').onclick=()=>{$('batch-form').reset();$('batch-dialog').showModal();};
$('batch-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target;const base={};if(form.elements.changeCharacter.checked)base.character=form.elements.character.value;if(form.elements.changeSeries.checked)base.series=form.elements.series.value;const addTags=form.elements.changeTags.checked?splitTags(form.elements.tags.value):null;
 if(!Object.keys(base).length&&!addTags){toast('请勾选需要修改的字段。');return;}
 const button=form.querySelector('button');button.disabled=true;let completed=0;
 try{for(const id of [...state.selected]){const image=state.images.find(i=>i.id===id);if(!image)continue;const updated=await patch(id,{...base,...(addTags?{tags:[...new Set([...image.tags,...addTags])]}:{})});replaceImage(updated);state.selected.delete(id);completed++;}$('batch-dialog').close();state.selecting=false;toast(`已整理 ${completed} 张图片`);}catch(e){toast(`已保存 ${completed} 张；${e.message}，剩余图片仍保留选中状态。`);}finally{button.disabled=false;render();}
};
$('edit-form').onsubmit=async event=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');const id=state.detailId;button.disabled=true;try{const values={};for(const field of ['title','character','series','folder','artist','source'])values[field]=form.elements[field].value;values.tags=splitTags(form.elements.tags.value);values.favorite=form.elements.favorite.checked;const updated=await patch(id,values);replaceImage(updated);render();toast('已保存分类');}catch(e){toast(e.message);}finally{button.disabled=false;}};
$('delete').onclick=async()=>{const image=state.images.find(i=>i.id===state.detailId);if(!image||!confirm(`删除「${image.title}」在 Ark 中的图片副本和分类？原始文件夹不受影响，此操作无法撤销。`))return;$('delete').disabled=true;try{await api(`${libraryPath()}/images/${image.id}`,{method:'DELETE'});state.images=state.images.filter(i=>i.id!==image.id);state.selected.delete(image.id);$('detail').close();render();toast('图片已删除');}catch(e){toast(e.message);}finally{$('delete').disabled=false;}};
$('prev').onclick=()=>navigateDetail(-1);$('next').onclick=()=>navigateDetail(1);document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;if($('detail').open){if(event.key==='ArrowLeft')navigateDetail(-1);if(event.key==='ArrowRight')navigateDetail(1);}else if(event.key==='/'){event.preventDefault();$('search').focus();}});
$('export').onclick=()=>{if(!currentLibrary()?.unlocked){toast('请先解锁图片库。');return;}if(currentLibrary().encrypted&&!confirm('将导出未加密的分类信息。确定继续？'))return;const blob=new Blob([JSON.stringify({format:'ark-metadata-v1',exported_at:new Date().toISOString(),images:state.images},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download=`ark-classifications-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('分类记录已导出（不包含图片原文件）');};
document.querySelectorAll('.upload-trigger').forEach(b=>b.onclick=()=>$('file-input').click());
$('folder-trigger').onclick=()=>$('folder-input').click();
$('folder-input').onchange=event=>{upload([...event.target.files],{preserveFolders:true});event.target.value='';};
$('file-input').onchange=event=>{upload([...event.target.files]);event.target.value='';};
async function upload(files,{preserveFolders=false}={}){
 if(state.uploading){toast('正在导入，请等这批完成后再添加。');return;}if(!files.length)return;
 const allFiles=files;files=files.filter(file=>['image/jpeg','image/png','image/gif','image/webp'].includes(file.type)||/\.(jpe?g|png|gif|webp)$/i.test(file.name));const skipped=allFiles.length-files.length;if(!files.length){toast('未找到支持的图片（JPG / PNG / GIF / WebP）');return;}
 const importLibraryId=state.libraryId;state.uploading=true;$('upload-progress').hidden=false;document.querySelectorAll('.upload-trigger').forEach(b=>b.disabled=true);let successes=0;const errors=[];$('folder-trigger').disabled=true;
 try{for(let n=0;n<files.length;n++){const file=files[n];$('upload-progress').textContent=`正在收藏 ${n+1} / ${files.length} · ${file.name}`;
  try{if(file.size>25*1048576)throw new Error('超过 25 MB');const folder=preserveFolders?(file.webkitRelativePath||'').split('/').slice(0,-1).join('/'):'';const image=await api(`${libraryPath(importLibraryId)}/images?filename=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder)}`,{method:'POST',headers:{'Content-Type':file.type},body:file});if(state.libraryId===importLibraryId)state.images.unshift(image);successes++;if(successes%10===0)render();}
  catch(e){errors.push(`${file.name}：${e.message}`);if(!currentLibrary()?.unlocked)break;}
 }}finally{state.uploading=false;render();$('upload-progress').hidden=true;}
 if(errors.length){$('upload-progress').textContent=`已导入 ${successes} 张，跳过 ${skipped} 个非支持文件。失败 ${errors.length} 张：${errors.join('；')}`;$('upload-progress').hidden=false;}else toast(`已导入 ${successes} 张${preserveFolders?'，文件夹分类已保留':''}${skipped?`，跳过 ${skipped} 个非支持文件`:''}。`);
}
let dragDepth=0;document.addEventListener('dragenter',event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();dragDepth++;$('drop-overlay').hidden=false;});document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});document.addEventListener('drop',event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;upload([...event.dataTransfer.files]);});

$('new-library').onclick=()=>{$('new-library-form').reset();for(const field of ['password','confirm'])$('new-library-form').elements[field].required=false;$('new-password-fields').hidden=true;$('new-library-error').textContent='';$('new-library-dialog').showModal();};
$('new-library-form').elements.encrypted.onchange=event=>{const enabled=event.target.checked;$('new-password-fields').hidden=!enabled;for(const field of ['password','confirm'])$('new-library-form').elements[field].required=enabled;};
$('new-library-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target;const encrypted=form.elements.encrypted.checked;const password=form.elements.password.value;$('new-library-error').textContent='';
 if(encrypted&&password!==form.elements.confirm.value){$('new-library-error').textContent='两次密码不一致。';return;}
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{const snapshot=await api('/api/libraries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.elements.name.value,encrypted,...(encrypted?{password}:{})})});state.libraryId=snapshot.libraries.at(-1).id;applySnapshot(snapshot);form.reset();$('new-library-dialog').close();changeView('all');await refresh();toast(encrypted?'加密库已创建，图片和分类将加密保存':'图片库已创建');}catch(e){$('new-library-error').textContent=e.message;}finally{button.disabled=false;}
};
$('new-library-dialog').addEventListener('close',()=>$('new-library-form').reset());
function renderSettings(){
 $('allow-encrypted').checked=state.settings.allowEncryptedRandom;$('idle-lock').value=String(state.settings.idleLockMinutes);$('random-libraries').replaceChildren(element('p','muted small','选择参与随机展示的图片库：'));
 for(const lib of state.libraries){const label=element('label','checkbox-label');const input=element('input');input.type='checkbox';input.checked=lib.allowRandom;input.dataset.library=lib.id;label.append(input,document.createTextNode(lib.name),element('small','',lib.encrypted?'加密库':'普通库'));$('random-libraries').append(label);}
}
$('settings-trigger').onclick=()=>{renderSettings();$('settings-dialog').showModal();};
$('settings-form').onsubmit=async event=>{
 event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;
 try{for(const checkbox of $('random-libraries').querySelectorAll('input')){const lib=state.libraries.find(l=>l.id===checkbox.dataset.library);if(lib.allowRandom!==checkbox.checked)applySnapshot(await api(`${libraryPath(lib.id)}/random`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({allowRandom:checkbox.checked})}));}
  applySnapshot(await api('/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({allowEncryptedRandom:$('allow-encrypted').checked,idleLockMinutes:Number($('idle-lock').value)})}));$('settings-dialog').close();toast('设置已保存');render();
 }catch(e){toast(e.message);}finally{button.disabled=false;}
};
let randomTimer=null,randomBusy=false;
function stopRandom(){clearInterval(randomTimer);randomTimer=null;$('random-play').textContent='自动播放';}
async function nextRandom(){
 if(randomBusy)return;randomBusy=true;$('random-next').disabled=true;
 try{const image=await api('/api/random',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({libraryId:$('random-scope').value||undefined,previousId:state.randomImage?.id})});if(!$('random-dialog').open)return;state.randomImage=image;$('random-image').src=fileURL(image);$('random-image').alt=image.title;$('random-caption').textContent=`${image.title} · ${image.libraryName}${image.encrypted?' · 加密库':''}`;$('random-error').textContent='';}
 catch(e){stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-caption').textContent='';$('random-error').textContent=e.message;}
 finally{randomBusy=false;$('random-next').disabled=false;}
}
$('random-trigger').onclick=()=>{$('random-scope').replaceChildren(new Option('所有允许展示的库',''),...state.libraries.map(l=>new Option(l.name,l.id)));$('random-dialog').showModal();nextRandom();};
$('random-next').onclick=nextRandom;$('random-scope').onchange=()=>{state.randomImage=null;nextRandom();};
function playRandom(){stopRandom();randomTimer=setInterval(nextRandom,Number($('random-interval').value)*1000);$('random-play').textContent='暂停';}
$('random-play').onclick=()=>randomTimer?stopRandom():playRandom();$('random-interval').onchange=()=>{if(randomTimer)playRandom();};
$('random-dialog').addEventListener('close',()=>{stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-image').alt='';$('random-caption').textContent='';});
if(window.arkDesktop){$('open-folder').hidden=false;$('open-folder').onclick=()=>window.arkDesktop.openDataFolder();window.arkDesktop.onLibrariesLocked(()=>refresh().catch(e=>toast(e.message)));}
setInterval(async()=>{try{const snapshot=await api('/api/state');const before=JSON.stringify(state.libraries);applySnapshot(snapshot);if(before!==JSON.stringify(state.libraries))render();}catch{}},5000);
refresh().catch(e=>toast(e.message));
$('batch-delete').onclick=async()=>{
 const ids=[...state.selected];const libraryId=state.libraryId;if(!ids.length||state.deleting)return;
 if(!confirm(`确定删除所选的 ${ids.length} 张图片吗？\n将删除 Ark 库中的图片副本和分类记录，原始文件夹不受影响。此操作无法撤销。`))return;
 state.deleting=true;render();let deleted=0,cleanupFailures=0;
 try{for(let offset=0;offset<ids.length;offset+=500){const result=await api(`${libraryPath(libraryId)}/images/batch-delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids.slice(offset,offset+500)})});deleted+=result.deletedIds.length;cleanupFailures+=result.cleanupFailures;
  if(state.libraryId===libraryId){const removed=new Set(result.deletedIds);state.images=state.images.filter(image=>!removed.has(image.id));result.deletedIds.forEach(id=>state.selected.delete(id));if(removed.has(state.detailId)){$('detail').close();$('detail-image').removeAttribute('src');state.detailId='';}}
  if(state.randomImage?.libraryId===libraryId&&result.deletedIds.includes(state.randomImage.id)){$('random-dialog').close();}
 }state.selecting=false;toast(`已删除 ${deleted} 张图片${cleanupFailures?`；${cleanupFailures} 个库文件清理失败，请检查数据目录权限`:''}`);
 }catch(e){toast(`已删除 ${deleted} 张；${e.message}。未删除的图片仍保留选中状态。`);}finally{state.deleting=false;render();}
};
