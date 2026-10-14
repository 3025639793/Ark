const $ = id => document.getElementById(id);
const state = { images: [], view: 'all', character: '', tag: '', query: '', series: '', sort: 'new', selecting: false, selected: new Set(), detailId: '', uploading: false };
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function locked(){state.images=[];state.selected.clear();state.detailId='';document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('app').hidden=true;$('login').hidden=false;$('password').value='';$('password').focus();}
async function api(path,options={}){
 const response=await fetch(path,options);
 const value=await response.json();
 if(!response.ok){if(response.status===401&&path!=='/api/login')locked();throw new Error(value.error||'操作失败，请重试。');}
 return value;
}
const patch = (id,data)=>api(`/api/images/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const fileURL = image=>`/api/images/${image.id}/file`;
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function groups(field){const result=new Map();for(const image of state.images){if(!image[field])continue;if(!result.has(image[field]))result.set(image[field],[]);result.get(image[field]).push(image);}return [...result].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],'zh'));}
function filtered(){
 const query=state.query.toLocaleLowerCase();
 return state.images.filter(i=>(state.view!=='favorite'||i.favorite)&&(state.view!=='unfiled'||(!i.character&&!i.series&&!i.tags.length))&&(!state.character||i.character===state.character)&&(!state.series||i.series===state.series)&&(!state.tag||i.tags.includes(state.tag))&&(!query||[i.title,i.filename,i.character,i.series,i.artist,...i.tags].join(' ').toLocaleLowerCase().includes(query))).sort((a,b)=>state.sort==='name'?a.title.localeCompare(b.title,'zh'):state.sort==='old'?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at));
}
function selectOptions(select,values,selected){select.replaceChildren();select.append(new Option('所有作品',''));for(const value of values)select.append(new Option(value,value));select.value=values.includes(selected)?selected:'';state.series=select.value;}
function render(){
 $('all-count').textContent=state.images.length;$('favorite-count').textContent=state.images.filter(i=>i.favorite).length;$('unfiled-count').textContent=state.images.filter(i=>!i.character&&!i.series&&!i.tags.length).length;
 const characters=groups('character');$('character-count').textContent=characters.length||'';
 $('character-list').replaceChildren();
 for(const [name,images] of characters){const button=element('button',`character-link${state.character===name?' active':''}`);const img=element('img','character-avatar');img.src=fileURL(images[0]);img.alt='';img.loading='lazy';button.append(img,element('span','',name),element('small','',images.length));button.onclick=()=>changeView('all',name);$('character-list').append(button);}
 if(!characters.length)$('character-list').append(element('p','nav-label','整理图片后，角色会出现在这里。'));
 for(const [field,id] of [['character','characters-options'],['series','series-options']]){$(id).replaceChildren(...groups(field).map(([value])=>new Option(value,value)));}
 selectOptions($('series-filter'),groups('series').map(([n])=>n),state.series);
 const titles={all:'全部图片',favorite:'特别喜欢',unfiled:'待整理',characters:'角色收藏墙'};const title=state.character||titles[state.view];
 $('view-title').replaceChildren(document.createTextNode(title),element('span','title-dot','.'));$('crumb').textContent=title;
 $('view-description').textContent=state.character?'属于这个角色的每一份喜欢。':state.view==='characters'?'把喜欢的角色，收藏成自己的图鉴。':state.view==='unfiled'?'不急，慢慢给喜欢的图片找到归属。':'给每一份喜欢，留一个位置。';
 $('storage').textContent=`${state.images.length} 张图片 · ${(state.images.reduce((sum,i)=>sum+i.bytes,0)/1048576).toFixed(1)} MB`;
 document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===state.view&&!state.character));
 const tags=[...new Set(state.images.flatMap(i=>i.tags))].sort((a,b)=>a.localeCompare(b,'zh'));if(state.tag&&!tags.includes(state.tag))state.tag='';
 $('tag-list').replaceChildren();for(const tag of ['',...tags]){if(!tag&&!tags.length)continue;const b=element('button',`tag${state.tag===tag?' active':''}`,tag||'全部标签');b.onclick=()=>{state.tag=tag;render();};$('tag-list').append(b);}
 $('batch-bar').hidden=!state.selecting;$('select-toggle').textContent=state.selecting?'退出批量':'批量整理';$('selected-count').textContent=`已选 ${state.selected.size} 张`;$('batch-edit').disabled=!state.selected.size;$('select-toggle').disabled=state.view==='characters';
 $('gallery').replaceChildren();const images=filtered();
 if(state.view==='characters'){
  const visible=characters.map(([name])=>[name,images.filter(i=>i.character===name)]).filter(([,items])=>items.length);
  for(const [name,items] of visible){const card=element('article','card role-card');const button=element('button','card-open');const img=element('img','card-image');img.src=fileURL(items.find(i=>i.favorite)||items[0]);img.alt=name;img.loading='lazy';const info=element('div','card-info');info.append(element('h3','',name),element('p','',`${items.length} 张收藏`));button.append(img,info);button.onclick=()=>changeView('all',name);card.append(button);$('gallery').append(card);}
 }else for(const image of images){
  const card=element('article',`card${state.selected.has(image.id)?' selected':''}`);const button=element('button','card-open');const img=element('img','card-image');img.src=fileURL(image);img.alt=image.title;img.loading='lazy';const info=element('div','card-info');info.append(element('h3','',image.title||image.filename),element('p','',[image.character,image.series,...image.tags.slice(0,2)].filter(Boolean).join(' · ')||'等待整理'));button.append(img,info);button.onclick=()=>state.selecting?toggleSelected(image.id):openDetail(image.id);card.append(button);
  if(state.selecting){const choose=element('button','select-image',state.selected.has(image.id)?'✓':'○');choose.setAttribute('aria-label',`选择 ${image.title}`);choose.setAttribute('aria-pressed',String(state.selected.has(image.id)));choose.onclick=()=>toggleSelected(image.id);card.append(choose);}
  else{const favorite=element('button','favorite-button',image.favorite?'♥':'♡');favorite.setAttribute('aria-label',image.favorite?'取消特别喜欢':'标记为特别喜欢');favorite.setAttribute('aria-pressed',String(image.favorite));favorite.onclick=async()=>{favorite.disabled=true;try{const updated=await patch(image.id,{favorite:!image.favorite});replaceImage(updated);render();}catch(e){toast(e.message);favorite.disabled=false;}};card.append(favorite);}
  $('gallery').append(card);
 }
 const isEmpty=!$('gallery').childElementCount;$('gallery').hidden=isEmpty;$('empty').hidden=!isEmpty;
 const first=!state.images.length;const noCharacters=state.view==='characters'&&!characters.length;
 $('empty-title').textContent=first?'第一份喜欢，从这里开始':noCharacters?'为图片添加角色，点亮收藏墙':'这里暂时没有图片';
 $('empty-description').textContent=first?'上传喜欢的图片，再用角色、作品和标签慢慢整理。':noCharacters?'打开一张图片，填写角色名称，或通过批量整理一次添加。':'试试其他筛选条件，或上传新的收藏。';
 $('empty').querySelector('.upload-trigger').textContent=first?'＋ 上传第一张图片':'＋ 上传图片';
}
function changeView(view,character=''){state.view=view;state.character=character;state.tag='';state.series='';state.selecting=false;state.selected.clear();render();}
function toggleSelected(id){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);render();}
function replaceImage(image){state.images=state.images.map(i=>i.id===image.id?image:i);}
async function refresh(){state.images=await api('/api/images');$('login').hidden=true;$('app').hidden=false;render();}
function openDetail(id){const image=state.images.find(i=>i.id===id);if(!image)return;state.detailId=id;$('detail-image').src=fileURL(image);$('detail-image').alt=image.title;const form=$('edit-form');for(const field of ['title','character','series','artist','source'])form.elements[field].value=image[field];form.elements.tags.value=image.tags.join('，');form.elements.favorite.checked=image.favorite;$('image-info').textContent=`${image.filename} · ${(image.bytes/1048576).toFixed(2)} MB · ${new Date(image.created_at).toLocaleDateString()}`;$('download').href=fileURL(image)+'?download=1';if(!$('detail').open)$('detail').showModal();}
function navigateDetail(delta){const images=filtered();const index=images.findIndex(i=>i.id===state.detailId);if(images.length)openDetail(images[(index+delta+images.length)%images.length].id);}
function splitTags(value){return [...new Set(value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean))];}
$('login-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;$('login-error').textContent='';try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});$('password').value='';await refresh();}catch(e){$('login-error').textContent=e.message;}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});locked();}catch(e){toast(e.message);}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>changeView(b.dataset.view));
$('search').oninput=event=>{state.query=event.target.value;render();};$('series-filter').onchange=event=>{state.series=event.target.value;render();};$('sort').onchange=event=>{state.sort=event.target.value;render();};
$('select-toggle').onclick=()=>{state.selecting=!state.selecting;state.selected.clear();render();};$('cancel-select').onclick=()=>{state.selecting=false;state.selected.clear();render();};$('select-all').onclick=()=>{filtered().forEach(i=>state.selected.add(i.id));render();};
$('batch-edit').onclick=()=>{$('batch-form').reset();$('batch-dialog').showModal();};
$('batch-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target;const base={};if(form.elements.changeCharacter.checked)base.character=form.elements.character.value;if(form.elements.changeSeries.checked)base.series=form.elements.series.value;const addTags=form.elements.changeTags.checked?splitTags(form.elements.tags.value):null;
 if(!Object.keys(base).length&&!addTags){toast('请勾选需要修改的字段。');return;}
 const button=form.querySelector('button');button.disabled=true;let completed=0;
 try{for(const id of [...state.selected]){const image=state.images.find(i=>i.id===id);if(!image)continue;const updated=await patch(id,{...base,...(addTags?{tags:[...new Set([...image.tags,...addTags])]}:{})});replaceImage(updated);state.selected.delete(id);completed++;}$('batch-dialog').close();state.selecting=false;toast(`已整理 ${completed} 张图片`);}catch(e){toast(`已保存 ${completed} 张；${e.message}，剩余图片仍保留选中状态。`);}finally{button.disabled=false;render();}
};
$('edit-form').onsubmit=async event=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');const id=state.detailId;button.disabled=true;try{const values={};for(const field of ['title','character','series','artist','source'])values[field]=form.elements[field].value;values.tags=splitTags(form.elements.tags.value);values.favorite=form.elements.favorite.checked;const updated=await patch(id,values);replaceImage(updated);render();toast('已保存分类');}catch(e){toast(e.message);}finally{button.disabled=false;}};
$('delete').onclick=async()=>{const image=state.images.find(i=>i.id===state.detailId);if(!image||!confirm(`删除「${image.title}」和原图？此操作无法撤销。`))return;$('delete').disabled=true;try{await api(`/api/images/${image.id}`,{method:'DELETE'});state.images=state.images.filter(i=>i.id!==image.id);state.selected.delete(image.id);$('detail').close();render();toast('图片已删除');}catch(e){toast(e.message);}finally{$('delete').disabled=false;}};
$('prev').onclick=()=>navigateDetail(-1);$('next').onclick=()=>navigateDetail(1);document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;if($('detail').open){if(event.key==='ArrowLeft')navigateDetail(-1);if(event.key==='ArrowRight')navigateDetail(1);}else if(event.key==='/'&&!$('app').hidden){event.preventDefault();$('search').focus();}});
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({format:'ark-metadata-v1',exported_at:new Date().toISOString(),images:state.images},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download=`ark-classifications-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('分类记录已导出（不包含图片原文件）');};
document.querySelectorAll('.upload-trigger').forEach(b=>b.onclick=()=>$('file-input').click());
$('file-input').onchange=event=>{upload([...event.target.files]);event.target.value='';};
async function upload(files){
 if(state.uploading){toast('正在上传，请等这批完成后再添加。');return;}if(!files.length||$('app').hidden)return;
 state.uploading=true;$('upload-progress').hidden=false;document.querySelectorAll('.upload-trigger').forEach(b=>b.disabled=true);let successes=0;const errors=[];
 try{for(let n=0;n<files.length;n++){const file=files[n];$('upload-progress').textContent=`正在收藏 ${n+1} / ${files.length} · ${file.name}`;
  try{if(file.size>25*1048576)throw new Error('超过 25 MB');if(!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type))throw new Error('不支持的图片格式');const image=await api(`/api/images?filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':file.type},body:file});state.images.unshift(image);successes++;render();}
  catch(e){errors.push(`${file.name}：${e.message}`);if($('app').hidden)break;}
 }}finally{state.uploading=false;document.querySelectorAll('.upload-trigger').forEach(b=>b.disabled=false);$('upload-progress').hidden=true;}
 if(errors.length){$('upload-progress').textContent=`已上传 ${successes} 张。失败 ${errors.length} 张：${errors.join('；')}`;$('upload-progress').hidden=false;}else toast(`已收藏 ${successes} 张图片，去给它们添上角色吧。`);
}
let dragDepth=0;document.addEventListener('dragenter',event=>{if($('app').hidden||!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();dragDepth++;$('drop-overlay').hidden=false;});document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});document.addEventListener('drop',event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;upload([...event.dataTransfer.files]);});
refresh().catch(e=>{if(!$('login').hidden)return;locked();$('login-error').textContent=e.message;});
