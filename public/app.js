const $ = id => document.getElementById(id);
const state = { starterImages:{available:false,total:0,count:0,error:''}, starterBusy:'', starterMessage:'', images: [], view: 'all', character: '', tag: '', query: '', series: '', folder: '', deleting: false, backingUp:false, processing:false, visibleLimit:120, sort: 'new', selecting: false, selected: new Set(), detailId: '', detailLibraryId:'', libraryImages:[], encryptedImages:[], lockedLibraries:[], masterPassword:{}, uploading: false, libraries: [], libraryId: 'default', settings: {}, randomImage: null };
let toastTimer;
let refreshSequence=0,refreshInFlight=0;
const latestPreviews=new Map();
let updateState=null;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
const token=document.querySelector('meta[name="ark-token"]').content;
function libraryPath(id=state.libraryId){return `/api/libraries/${id}`;}
function currentLibrary(){return state.libraries.find(l=>l.id===state.libraryId);}
async function api(path,options={}){
 if(options.method&&options.method!=='GET'&&!path.endsWith('/preview')&&!path.endsWith('/lock-image')&&!path.startsWith('/api/theme'))refreshSequence++;
 const response=await fetch(path,{...options,headers:{'X-Ark-Token':token,...options.headers}});
 const value=await response.json();
 if(!response.ok){if(response.status===423){clearSensitiveViews();setTimeout(()=>refresh().catch(()=>{}),0);}throw new Error(value.error||'操作失败，请重试。');}
 return value;
}
const imageLibrary=id=>state.images.find(i=>i.id===id)?.libraryId||(state.detailId===id&&state.detailLibraryId)||state.libraryId;
const patch=(id,data)=>api(`${libraryPath(imageLibrary(id))}/images/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const fileURL=image=>`${libraryPath(image.libraryId)}/images/${image.id}/file`;
function clearSensitiveViews(preserveOrdinary=true){
 closeOriginalView();if(state.detailId)releaseSingle(state.detailId);
 const sanitise=image=>{if(!preserveOrdinary)return null;const lib=state.libraries.find(lib=>lib.id===image.libraryId);if(lib?.encrypted)return null;if(!image.protected&&!image.encrypted)return image;if(!image.protected)return null;
  return {id:image.id,libraryId:image.libraryId,libraryName:image.libraryName,protected:true,encrypted:true,locked:true,hasPreview:image.hasPreview,previewVersion:image.previewVersion,previewWidth:image.previewWidth,previewHeight:image.previewHeight,legacy:image.legacy,title:'已加密 · 输入密码查看',filename:'加密图片',character:image.character,series:image.series,folder:image.folder,tags:[],favorite:false,bytes:image.bytes,created_at:image.created_at};};
 for(const key of ['libraryImages','encryptedImages','images'])state[key]=state[key].map(sanitise).filter(Boolean);state.lockedLibraries=[];state.selected.clear();state.detailId='';$('detail-image').removeAttribute('src');$('edit-form').reset();$('detail').close();stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-caption').textContent='';$('random-dialog').close();render();
}
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function setImageSource(image,src){if(src){if(image.getAttribute('src')!==src)image.src=src;}else if(image.hasAttribute('src'))image.removeAttribute('src');}
function reconcileChildren(parent,nodes){
 const wanted=new Set(nodes);for(const child of [...parent.children])if(!wanted.has(child)){for(const image of child.querySelectorAll('img'))image.removeAttribute('src');child.remove();}
 nodes.forEach((node,index)=>{if(parent.children[index]!==node){if(parent.moveBefore&&node.parentNode===parent)parent.moveBefore(node,parent.children[index]||null);else parent.insertBefore(node,parent.children[index]||null);}});
}
async function revealPhoto(frame,image){
 const src=image.getAttribute('src');if(!src)return;
 try{await image.decode?.();}catch{return;}
 if(!frame.isConnected||frame.dataset.locked==='true'||image.getAttribute('src')!==src||!image.naturalWidth)return;
 if(!frame.dataset.ratio){frame.style.aspectRatio=`${image.naturalWidth} / ${image.naturalHeight}`;frame.dataset.ratio='loaded';}
 frame.classList.add('media-ready');
}
function resetVisible(){state.visibleLimit=120;}
function replaceEverywhere(image){
 for(const key of ['images','libraryImages','encryptedImages'])state[key]=state[key].map(previous=>{
  if(previous.id!==image.id)return previous;
  if((key==='encryptedImages'||key==='images'&&state.view==='encrypted')&&previous.locked&&image.protected)return {...previous,character:image.character,series:image.series,folder:image.folder};
  return {...previous,...image};
 });
}
function removeEverywhere(ids){
 const removed=new Set(ids);for(const key of ['images','libraryImages','encryptedImages'])state[key]=state[key].filter(image=>!removed.has(image.id));for(const id of ids){state.selected.delete(id);latestPreviews.delete(id);randomRanks.delete(id);}
}
function groups(field,source=state.images){const result=new Map();for(const image of source){if(!image[field])continue;if(!result.has(image[field]))result.set(image[field],[]);result.get(image[field]).push(image);}return [...result].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],'zh'));}
let randomRanks=new Map();
function shuffleOrder(){
 const ids=state.images.map(image=>image.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}randomRanks=new Map(ids.map((id,index)=>[id,index]));
}
function randomRank(image){if(!randomRanks.has(image.id))randomRanks.set(image.id,Math.random()*(randomRanks.size+1));return randomRanks.get(image.id);}
function filtered(){
 const query=state.query.toLocaleLowerCase();
 return state.images.filter(i=>(state.view==='encrypted'||!i.locked)&&(state.view!=='favorite'||i.favorite)&&(state.view!=='unfiled'||(!i.character&&!i.series&&!i.folder&&!i.tags.length))&&(!state.character||i.character===state.character)&&(!state.folder||(i.folder||'')===state.folder||(i.folder||'').startsWith(state.folder+'/'))&&(!state.series||i.series===state.series)&&(!state.tag||i.tags.includes(state.tag))&&(!query||[i.title,i.filename,i.character,i.series,i.folder||'',i.artist,...i.tags].join(' ').toLocaleLowerCase().includes(query))).sort((a,b)=>{
  if(state.sort==='random')return randomRank(a)-randomRank(b);
  return (state.sort==='new'?(Number(!!(a.protected||a.encrypted))-Number(!!(b.protected||b.encrypted))):0)||(state.sort==='name'?a.title.localeCompare(b.title,'zh'):state.sort==='old'?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at));
 });
}
function selectOptions(select,values,selected){select.replaceChildren();select.append(new Option('所有作品',''));for(const value of values)select.append(new Option(value,value));select.value=values.includes(selected)?selected:'';state.series=select.value;}
function render(){
 state.libraryImages=state.libraryImages.filter(image=>!image.locked);if(state.view!=='encrypted')state.images=state.images.filter(image=>!image.locked);
 renderUpdate();renderStarterImages();
 const busy=state.uploading||state.deleting||state.backingUp||state.processing;
 for(const id of ['new-library','folder-trigger','select-toggle','lock-all','backup-data'])$(id).disabled=busy;
 const library=currentLibrary();const encryptedView=state.view==='encrypted';const locked=!encryptedView&&library?.encrypted&&!library.unlocked;const characterWall=state.view==='characters'&&!state.character;
 $('library-select').replaceChildren(...state.libraries.map(l=>new Option(`${l.encrypted?(l.unlocked?'◇ ':'◆ '):''}${l.name}`,l.id)));$('library-select').value=state.libraryId;
 $('lock-library').hidden=!library?.encrypted||!library.unlocked;$('locked-library').hidden=!locked;
 document.querySelectorAll('.upload-trigger').forEach(b=>b.disabled=locked||state.uploading||encryptedView);
 $('select-toggle').disabled=locked||state.deleting;$('storage').hidden=locked;$('folder-trigger').disabled=locked||state.uploading||encryptedView;$('library-select').disabled=state.deleting||state.uploading;$('lock-library').disabled=state.uploading;$('lock-all').disabled=state.uploading;$('delete-character').hidden=!state.character;$('delete-character').disabled=state.uploading;$('batch-protect').disabled=!state.selected.size||state.uploading;

 const baseImages=encryptedView?state.libraryImages:state.images;$('all-count').textContent=baseImages.length;$('favorite-count').textContent=baseImages.filter(i=>i.favorite).length;$('unfiled-count').textContent=baseImages.filter(i=>!i.character&&!i.series&&!i.folder&&!i.tags.length).length;
 const characters=groups('character',baseImages);$('character-count').textContent=characters.length||'';
 const characterScroll=$('character-list').scrollTop;const oldCharacters=new Map([...$('character-list').children].map(node=>[node.dataset.key,node]));const characterNodes=[];
 for(const [name,images] of characters){let button=oldCharacters.get(name);if(!button){button=element('button','character-link');button.dataset.key=name;const img=element('img','character-avatar');img.alt='';img.loading='lazy';button.append(img,element('span'),element('small'));}
  button.className=`character-link${state.character===name?' active':''}`;button.title=name;if(state.character===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');const cover=images.find(image=>!image.locked);setImageSource(button.querySelector('img'),cover?fileURL(cover):null);button.querySelector('span').textContent=name;button.querySelector('small').textContent=images.length;button.onclick=()=>changeView('characters',name);characterNodes.push(button);
 }
 if(!characters.length){let empty=oldCharacters.get('empty');if(!empty){empty=element('p','nav-label','整理图片后，角色会出现在这里。');empty.dataset.key='empty';}characterNodes.push(empty);}
 reconcileChildren($('character-list'),characterNodes);$('character-list').scrollTop=characterScroll;
 for(const [field,id] of [['character','characters-options'],['series','series-options']]){$(id).replaceChildren(...groups(field).map(([value])=>new Option(value,value)));}
 selectOptions($('series-filter'),groups('series').map(([n])=>n),state.series);
 const folders=new Set();for(const image of state.images){const parts=(image.folder||'').split('/').filter(Boolean);parts.forEach((_,index)=>folders.add(parts.slice(0,index+1).join('/')));}
 if(state.folder&&!folders.has(state.folder))state.folder='';
 $('folder-filter').replaceChildren(new Option('所有文件夹分类',''),...[...folders].sort((a,b)=>a.localeCompare(b,'zh')).map(folder=>new Option(folder,folder)));$('folder-filter').value=state.folder;

 const images=filtered();$('reshuffle').hidden=state.sort!=='random';
 const titles={all:'全部图片',favorite:'特别喜欢',unfiled:'待整理',characters:'角色收藏墙',encrypted:'加密库'};const title=state.character||titles[state.view];
 $('view-title').replaceChildren(document.createTextNode(title),element('span','title-dot','.'));renderBreadcrumb(title);$('view-back').hidden=state.view!=='characters';$('view-back').textContent=state.character?'← 返回角色收藏墙':'← 返回全部图片';
 $('view-description').textContent=encryptedView?'所有加密图片集中查看，原来的位置和分类不变。':state.character?'属于这个角色的每一份喜欢。':state.view==='characters'?'把喜欢的角色，收藏成自己的图鉴。':state.view==='unfiled'?'不急，慢慢给喜欢的图片找到归属。':'给每一份喜欢，留一个位置。';
 const summaryImages=characterWall?images.filter(i=>i.character):images;$('storage').textContent=`${characterWall?`${new Set(summaryImages.map(i=>i.character)).size} 个角色 · `:''}${summaryImages.length} 张图片 · ${(summaryImages.reduce((sum,i)=>sum+i.bytes,0)/1048576).toFixed(1)} MB`;
 if(encryptedView&&state.lockedLibraries.length)$('storage').textContent+=` · ${state.lockedLibraries.length} 个旧库待解锁`;
 document.querySelectorAll('[data-view]').forEach(e=>{const active=e.dataset.view===state.view;e.classList.toggle('active',active);if(active&&!state.character)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
 const tags=[...new Set(state.images.flatMap(i=>i.tags))].sort((a,b)=>a.localeCompare(b,'zh'));if(state.tag&&!tags.includes(state.tag))state.tag='';
 $('tag-list').replaceChildren();for(const tag of ['',...tags]){if(!tag&&!tags.length)continue;const b=element('button',`tag${state.tag===tag?' active':''}`,tag||'全部标签');b.onclick=()=>{state.tag=tag;resetVisible();render();};$('tag-list').append(b);}
 $('batch-bar').hidden=!state.selecting||encryptedView;$('select-toggle').textContent=state.selecting?'退出批量':'批量整理';$('selected-count').textContent=`已选 ${state.selected.size} 张`;$('batch-delete').textContent=state.deleting?'正在删除…':'删除所选';$('select-all').disabled=state.deleting;$('cancel-select').disabled=state.deleting;$('batch-edit').disabled=!state.selected.size||state.deleting;$('batch-delete').disabled=!state.selected.size||state.deleting;$('select-toggle').disabled=locked||state.deleting||characterWall||encryptedView;
 renderEncryptedTools();renderPreviewStatus();const previousCards=new Map([...$('gallery').children].map(card=>[card.dataset.key,card]));const cards=[];
 if(characterWall){
  const grouped=new Map();for(const image of images){if(!image.character)continue;if(!grouped.has(image.character))grouped.set(image.character,[]);grouped.get(image.character).push(image);}const visible=characters.filter(([name])=>grouped.has(name)).map(([name])=>[name,grouped.get(name)]).slice(0,state.visibleLimit);
  for(const [name,items] of visible){const key=`role:${state.libraryId}:${name}`;let card=previousCards.get(key);if(!card){card=element('article','card role-card');card.dataset.key=key;const button=element('button','card-open'),img=element('img','card-image'),info=element('div','card-info');img.loading='lazy';info.append(element('h3'),element('p'));button.append(img,info);button.onclick=()=>changeView('characters',name);card.append(button);}
   const cover=items.find(i=>!i.locked&&i.favorite)||items.find(i=>!i.locked);setImageSource(card.querySelector('img'),cover?fileURL(cover):null);card.querySelector('img').alt=name;card.querySelector('h3').textContent=name;card.querySelector('p').textContent=`${items.length} 张收藏`;cards.push(card);
  }
 }else for(const image of images.slice(0,state.visibleLimit)){
  const key=`photo:${image.libraryId}:${image.id}`;let card=previousCards.get(key);
  if(!card){card=element('article','card');card.dataset.key=key;const button=element('button','card-open'),frame=element('span','photo-media'),img=element('img','card-image'),preview=element('img','card-preview'),info=element('div','card-info'),overlay=element('img','encryption-overlay');
   img.loading='lazy';img.decoding='async';preview.loading='lazy';preview.alt='';overlay.src='/encryption-overlay.png';overlay.alt='';overlay.setAttribute('aria-hidden','true');frame.append(img,preview,overlay,element('span','locked-hint'));info.append(element('h3'),element('p'));button.append(frame,info);card.append(button);
   img.onload=()=>revealPhoto(frame,img);img.onerror=()=>{frame.classList.remove('media-ready');frame.querySelector('.locked-hint').textContent=frame.dataset.locked==='true'?'点击输入密码':'图片暂时无法加载，点击重试';};
  }
  card.classList.toggle('selected',state.selected.has(image.id));const button=card.querySelector('.card-open'),img=card.querySelector('.card-image'),frame=card.querySelector('.photo-media'),preview=card.querySelector('.card-preview');
  frame.dataset.locked=String(!!image.locked);frame.classList.toggle('locked-cover',!!image.locked);img.alt=image.locked?'':image.title;
  if(image.previewWidth&&image.previewHeight){frame.style.aspectRatio=`${image.previewWidth} / ${image.previewHeight}`;frame.dataset.ratio='known';}
  preview.className=`card-preview${image.locked&&image.hasPreview?' locked-preview':''}`;setImageSource(preview,image.hasPreview?fileURL(image).replace(/file$/,'preview')+`?v=${image.previewVersion||1}`:null);
  const src=image.locked?null:fileURL(image);if(image.locked||img.getAttribute('src')!==src)frame.classList.remove('media-ready');setImageSource(img,src);
  frame.querySelector('.encryption-overlay').hidden=!image.locked&&!image.hasPreview;
  frame.querySelector('.locked-hint').textContent=image.locked?(image.hasPreview?'点击输入密码':'封面待生成 · 点击解锁'):'正在加载图片…';
  card.querySelector('h3').textContent=image.title||image.filename;card.querySelector('.card-info p').textContent=[encryptedView?image.libraryName:'',image.folder,image.character,image.series,...image.tags.slice(0,2)].filter(Boolean).join(' · ')||'等待整理';button.onclick=()=>state.selecting?toggleSelected(image.id):openDetail(image.id);
  let choose=card.querySelector('.select-image'),favorite=card.querySelector('.favorite-button');
  if(state.selecting){favorite?.remove();if(!choose){choose=element('button','select-image');card.append(choose);}choose.textContent=state.selected.has(image.id)?'✓':'○';choose.setAttribute('aria-label',`选择 ${image.title}`);choose.setAttribute('aria-pressed',String(state.selected.has(image.id)));choose.onclick=()=>toggleSelected(image.id);}
  else{choose?.remove();if(image.locked)favorite?.remove();else{if(!favorite){favorite=element('button','favorite-button');card.append(favorite);}favorite.textContent=image.favorite?'♥':'♡';favorite.setAttribute('aria-label',image.favorite?'取消特别喜欢':'标记为特别喜欢');favorite.setAttribute('aria-pressed',String(image.favorite));favorite.onclick=async()=>{favorite.disabled=true;try{const updated=await patch(image.id,{favorite:!image.favorite});replaceImage(updated);render();}catch(e){toast(e.message);}finally{favorite.disabled=false;}};}}
  cards.push(card);
 }
 reconcileChildren($('gallery'),cards);const totalCards=characterWall?new Set(images.filter(image=>image.character).map(image=>image.character)).size:images.length;$('gallery-more').hidden=cards.length>=totalCards||locked;$('gallery-page-status').textContent=totalCards>120?`已显示 ${cards.length} / ${totalCards}`:'';
 if(state.backingUp||state.processing){for(const id of ['library-select','folder-trigger','select-toggle','lock-all','lock-library','encrypted-unlock-all','encrypted-lock-all','delete-character'])$(id).disabled=true;document.querySelectorAll('.upload-trigger').forEach(button=>button.disabled=true);}
 const isEmpty=!$('gallery').childElementCount;$('gallery').hidden=isEmpty||locked;$('empty').hidden=!isEmpty||locked;
 const first=!state.images.length&&!state.encryptedImages.length&&!encryptedView;const noCharacters=state.view==='characters'&&!characters.length;
 $('empty-title').textContent=encryptedView?'加密内容会集中显示在这里':first?'第一份喜欢，从这里开始':noCharacters?'为图片添加角色，点亮收藏墙':'这里暂时没有图片';
 $('empty-description').textContent=encryptedView?'在原来的图片页面点击“加密图片”；旧整库加密请先使用上方入口解锁。':first?'导入喜欢的图片，再用角色、作品和标签慢慢整理。':noCharacters?'打开一张图片，填写角色名称，或通过批量整理一次添加。':'试试其他筛选条件，或导入新的收藏。';
 $('empty').querySelector('.upload-trigger').hidden=encryptedView;$('empty').querySelector('.upload-trigger').textContent=first?'＋ 导入第一张图片':'＋ 导入图片';
}
function renderBreadcrumb(title){
 const container=$('breadcrumbs');container.replaceChildren();
 function link(label,view){const button=element('button','breadcrumb-link',label);button.onclick=()=>changeView(view);container.append(button);}
 function separator(){const span=element('span','breadcrumb-separator','/');span.setAttribute('aria-hidden','true');container.append(span);}
 if(state.view==='all'&&!state.character){const label=element('span','','全部图片');label.setAttribute('aria-current','page');container.append(label);return;}
 link('全部图片','all');separator();
 if(state.character){link('角色收藏墙','characters');separator();}
 const current=element('span','breadcrumb-current',title);current.setAttribute('aria-current','page');container.append(current);
}
function changeView(view,character=''){resetVisible();const crossesEncrypted=(state.view==='encrypted')!==(view==='encrypted');if(crossesEncrypted){clearSensitiveViews(false);}state.query='';$('search').value='';state.view=view;state.character=character;state.tag='';state.series='';state.folder='';state.selecting=false;state.selected.clear();render();if(crossesEncrypted)refresh().catch(e=>toast(e.message));}
function toggleSelected(id){if(state.deleting)return;state.selected.has(id)?state.selected.delete(id):state.selected.add(id);render();}
function replaceImage(image){replaceEverywhere(image);}
async function refresh({poll=false}={}){
 if(poll&&refreshInFlight)return;refreshInFlight++;try{
 const request=++refreshSequence,libraryId=state.libraryId,view=state.view;const current=()=>request===refreshSequence&&libraryId===state.libraryId;
 const snapshot=await api('/api/state');if(!current())return;
 const unchanged=JSON.stringify(snapshot.libraries)===JSON.stringify(state.libraries)&&snapshot.lockRevision===state.lockRevision&&JSON.stringify(snapshot.masterPassword||{})===JSON.stringify(state.masterPassword);
 applySnapshot(snapshot);if(poll&&unchanged&&state.images.length)return;
 const [rows,collection]=await Promise.all([snapshot.libraries.find(lib=>lib.id===libraryId)?.unlocked?api(`${libraryPath(libraryId)}/images`):Promise.resolve([]),api('/api/encrypted')]);
 if(!current())return;for(const image of [...rows,...collection.images]){const latest=latestPreviews.get(image.id);if(image.protected&&latest&&(image.previewVersion||0)<latest.previewVersion)Object.assign(image,latest);}state.libraryImages=rows;state.encryptedImages=collection.images;state.lockedLibraries=collection.lockedLibraries;state.images=state.view==='encrypted'?collection.images:rows;render();queueEncryptedPreviews();
 }finally{refreshInFlight--;}
}
function applySnapshot(snapshot){if(snapshot.starterImages)state.starterImages=snapshot.starterImages;if(snapshot.libraries.some(lib=>!lib.unlocked&&state.libraries.find(previous=>previous.id===lib.id)?.unlocked))clearSensitiveViews();if(state.lockRevision!==undefined&&state.lockRevision!==snapshot.lockRevision)clearSensitiveViews();state.lockRevision=snapshot.lockRevision;state.libraries=snapshot.libraries;state.settings=snapshot.settings;state.masterPassword=snapshot.masterPassword||{};if(!currentLibrary())state.libraryId=state.libraries[0].id;const library=currentLibrary();if(state.view!=='encrypted'&&!library.unlocked&&(state.images.length||state.detailId))clearSensitiveViews();const random=state.randomImage;if(random){const lib=state.libraries.find(l=>l.id===random.libraryId);if(!lib||!lib.unlocked||!lib.allowRandom||(random.encrypted&&!state.settings.allowEncryptedRandom)){stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-caption').textContent='';$('random-error').textContent='图片库已锁定或不再允许展示。';}}}

function openDetail(id,unlockedImage){closeOriginalView();const image=unlockedImage||state.images.find(i=>i.id===id);if(!image)return;if(image.locked){showProtection('unlock',[id],image.libraryId);return;}if(state.detailId&&state.detailId!==id)releaseSingle(state.detailId);state.detailId=id;state.detailLibraryId=image.libraryId;$('protect-image').hidden=!!image.protected||!!state.libraries.find(l=>l.id===image.libraryId)?.encrypted;$('unprotect-image').hidden=!image.protected;for(const input of $('edit-form').elements)input.disabled=false;setImageSource($('detail-image'),fileURL(image));$('detail-image').alt=image.title;const form=$('edit-form');for(const field of ['title','character','series','folder','artist','source'])form.elements[field].value=image[field]||'';form.elements.tags.value=image.tags.join('，');form.elements.favorite.checked=image.favorite;$('image-info').textContent=`${image.filename} · ${(image.bytes/1048576).toFixed(2)} MB · ${new Date(image.created_at).toLocaleDateString()}`;$('download').href=fileURL(image)+'?download=1';if(!$('detail').open)$('detail').showModal();}
function navigateDetail(delta){const images=filtered();const index=images.findIndex(i=>i.id===state.detailId);if(images.length)openDetail(images[(index+delta+images.length)%images.length].id);}
function splitTags(value){return [...new Set(value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean))];}
$('library-select').onchange=async event=>{const libraryId=event.target.value;clearSensitiveViews(false);state.libraryId=libraryId;changeView('all');try{await refresh();}catch(e){toast(e.message);}};
$('lock-library').onclick=async()=>{try{applySnapshot(await api(`${libraryPath()}/lock`,{method:'POST'}));clearSensitiveViews();render();}catch(e){toast(e.message);}};
$('lock-all').onclick=async()=>{try{applySnapshot(await api('/api/lock-all',{method:'POST'}));clearSensitiveViews();await refresh();toast('加密库已全部锁定');}catch(e){toast(e.message);}};
$('unlock-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;$('unlock-error').textContent='';try{await api(`${libraryPath()}/unlock`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('unlock-password').value,legacyPassword:$('unlock-legacy-password').value||undefined})});$('unlock-password').value='';$('unlock-legacy-password').value='';await refresh();}catch(e){$('unlock-error').textContent=e.message;}finally{button.disabled=false;}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>changeView(b.dataset.view));
$('view-back').onclick=()=>changeView(state.character?'characters':'all');
$('search').oninput=event=>{state.query=event.target.value;resetVisible();render();};$('folder-filter').onchange=event=>{state.folder=event.target.value;resetVisible();render();};$('series-filter').onchange=event=>{state.series=event.target.value;resetVisible();render();};$('sort').onchange=event=>{state.sort=event.target.value;resetVisible();if(state.sort==='random')shuffleOrder();render();};
$('select-toggle').onclick=()=>{state.selecting=!state.selecting;state.selected.clear();render();};$('cancel-select').onclick=()=>{state.selecting=false;state.selected.clear();render();};$('gallery-more').onclick=()=>{state.visibleLimit+=120;render();};$('reshuffle').onclick=()=>{shuffleOrder();resetVisible();render();};
$('select-all').onclick=()=>{filtered().forEach(i=>state.selected.add(i.id));render();};
$('batch-edit').onclick=()=>{$('batch-form').reset();$('batch-dialog').showModal();};
$('batch-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target;const base={};if(form.elements.changeCharacter.checked)base.character=form.elements.character.value;if(form.elements.changeSeries.checked)base.series=form.elements.series.value;const addTags=form.elements.changeTags.checked?splitTags(form.elements.tags.value):null;
 if(!Object.keys(base).length&&!addTags){toast('请勾选需要修改的字段。');return;}
 const button=form.querySelector('button');button.disabled=true;let completed=0;
 try{for(const id of [...state.selected]){const image=state.images.find(i=>i.id===id);if(!image)continue;const updated=await patch(id,{...base,...(addTags?{tags:[...new Set([...image.tags,...addTags])]}:{})});replaceImage(updated);state.selected.delete(id);completed++;}$('batch-dialog').close();state.selecting=false;toast(`已整理 ${completed} 张图片`);}catch(e){toast(`已保存 ${completed} 张；${e.message}，剩余图片仍保留选中状态。`);}finally{button.disabled=false;render();}
};
$('edit-form').onsubmit=async event=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');const id=state.detailId;button.disabled=true;try{const values={};for(const field of ['title','character','series','folder','artist','source'])values[field]=form.elements[field].value;values.tags=splitTags(form.elements.tags.value);values.favorite=form.elements.favorite.checked;const updated=await patch(id,values);replaceImage(updated);render();toast('已保存分类');}catch(e){toast(e.message);}finally{button.disabled=false;}};
$('delete').onclick=async()=>{const image=state.images.find(i=>i.id===state.detailId);if(!image||!confirm(`删除「${image.title}」在 Ark 中的图片副本和分类？原始文件夹不受影响，此操作无法撤销。`))return;$('delete').disabled=true;try{await api(`${libraryPath(image.libraryId)}/images/${image.id}`,{method:'DELETE'});removeEverywhere([image.id]);if(state.randomImage?.id===image.id)$('random-dialog').close();$('detail').close();await refresh();toast('图片已删除');}catch(e){toast(e.message);}finally{$('delete').disabled=false;}};
$('prev').onclick=()=>navigateDetail(-1);$('next').onclick=()=>navigateDetail(1);document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.addEventListener('keydown',event=>{if($('original-viewer').open)return;const dialog=event.target.closest?.('dialog');if(dialog&&dialog.id!=='detail')return;if(!dialog&&document.querySelector('dialog[open]'))return;if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;if($('detail').open){if(event.key==='ArrowLeft'){event.preventDefault();navigateDetail(-1);}if(event.key==='ArrowRight'){event.preventDefault();navigateDetail(1);}}else if(event.key==='/'){event.preventDefault();$('search').focus();}});
$('export').onclick=()=>{if(state.view==='encrypted'){toast('请回到原图片库导出分类。');return;}if(!currentLibrary()?.unlocked){toast('请先解锁图片库。');return;}if((currentLibrary().encrypted||state.images.some(i=>i.protected&&!i.locked))&&!confirm('将导出未加密的分类信息。确定继续？'))return;const blob=new Blob([JSON.stringify({format:'ark-metadata-v1',exported_at:new Date().toISOString(),images:state.images},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download=`ark-classifications-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('分类记录已导出（不包含图片原文件）');};
document.querySelectorAll('.upload-trigger').forEach(b=>b.onclick=()=>$('file-input').click());
$('folder-trigger').onclick=()=>$('folder-input').click();
$('folder-input').onchange=event=>{previewFolders([...event.target.files]);event.target.value='';};
$('file-input').onchange=event=>{upload([...event.target.files]);event.target.value='';};
async function upload(files,{preserveFolders=false,roles=new Map(),libraryId=state.libraryId,updateDuplicates=false}={}){
 if(state.uploading||state.processing||state.backingUp){toast('正在处理图片，请等这批完成后再添加。');return;}if(!files.length)return;
 const allFiles=files;files=files.filter(ArkFolders.isImage);const skipped=allFiles.length-files.length;if(!files.length){toast('未找到支持的图片（JPG / PNG / GIF / WebP）');return;}
 const importLibraryId=libraryId;state.uploading=true;$('upload-progress').hidden=false;document.querySelectorAll('.upload-trigger').forEach(b=>b.disabled=true);let successes=0,duplicates=0,corrected=0;const errors=[];$('folder-trigger').disabled=true;render();
 try{await api('/api/import-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true})});for(let n=0;n<files.length;n++){const file=files[n];$('upload-progress').textContent=`正在收藏 ${n+1} / ${files.length} · ${file.name}`;
  try{if(file.size>25*1048576)throw new Error('超过 25 MB');const folder=preserveFolders?ArkFolders.folderOf(file):'';const character=preserveFolders?ArkFolders.characterFor(folder,roles):'';const image=await api(`${libraryPath(importLibraryId)}/images?filename=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder)}&character=${encodeURIComponent(character)}&updateDuplicateCharacter=${updateDuplicates}`,{method:'POST',headers:{'Content-Type':file.type},body:file});if(image.duplicate){duplicates++;if(image.updated){corrected++;if(state.libraryId===importLibraryId)replaceImage(image.image);}continue;}if(state.libraryId===importLibraryId)state.images.unshift(image);successes++;if(successes%10===0)render();}
  catch(e){errors.push(`${file.name}：${e.message}`);if(!currentLibrary()?.unlocked)break;}
 }}catch(e){errors.push(e.message);}finally{await api('/api/import-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false})}).catch(e=>toast(e.message));state.uploading=false;await refresh().catch(()=>{});render();$('upload-progress').hidden=true;}
 if(errors.length){$('upload-progress').textContent=`已导入 ${successes} 张，跳过 ${duplicates} 张重复图片${corrected?`（已更正 ${corrected} 张的角色）`:''}，跳过 ${skipped} 个非支持文件。失败 ${errors.length} 张：${errors.slice(0,5).join('；')}${errors.length>5?'；其余失败项可重新导入重试':''}`;$('upload-progress').hidden=false;}else toast(`已导入 ${successes} 张，跳过 ${duplicates} 张重复图片${corrected?`（已更正 ${corrected} 张的角色）`:''}${preserveFolders?'，文件夹分类已保留':''}${skipped?`，跳过 ${skipped} 个非支持文件`:''}。`);
}
let dragDepth=0;document.addEventListener('dragenter',event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();dragDepth++;$('drop-overlay').hidden=false;});document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});document.addEventListener('drop',event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;upload([...event.dataTransfer.files]);});

$('new-library').onclick=()=>{$('new-library-form').reset();for(const field of ['password','confirm'])$('new-library-form').elements[field].required=false;$('new-password-fields').hidden=true;$('new-library-error').textContent='';$('new-library-dialog').showModal();};
$('new-library-form').elements.encrypted.onchange=event=>{const enabled=event.target.checked;$('new-password-fields').hidden=!enabled;const needsPassword=enabled&&!state.masterPassword.ready;$('new-password-fields').hidden=!needsPassword;$('new-confirm-label').hidden=!!state.masterPassword.configured;$('new-library-form').elements.password.required=needsPassword;$('new-library-form').elements.confirm.required=needsPassword&&!state.masterPassword.configured;};
$('new-library-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target;const encrypted=form.elements.encrypted.checked;const password=form.elements.password.value;$('new-library-error').textContent='';
 if(encrypted&&!state.masterPassword.configured&&password!==form.elements.confirm.value){$('new-library-error').textContent='两次密码不一致。';return;}
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{const snapshot=await api('/api/libraries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.elements.name.value,encrypted,...(encrypted&&password?{password}:{})})});state.libraryId=snapshot.libraries.at(-1).id;applySnapshot(snapshot);form.reset();$('new-library-dialog').close();changeView('all');await refresh();toast(encrypted?'加密库已创建，图片和分类将加密保存':'图片库已创建');}catch(e){$('new-library-error').textContent=e.message;}finally{button.disabled=false;}
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
let randomTimer=null,randomBusy=false,randomRequest=0;
function stopRandom(){clearInterval(randomTimer);randomTimer=null;$('random-play').textContent='自动播放';}
async function nextRandom(){
 if(randomBusy)return;const request=++randomRequest;randomBusy=true;$('random-next').disabled=true;
 try{const image=await api('/api/random',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({libraryId:$('random-scope').value||undefined,previousId:state.randomImage?.id})});if(request!==randomRequest||!$('random-dialog').open)return;state.randomImage=image;$('random-image').src=fileURL(image);$('random-image').alt=image.title;$('random-caption').textContent=`${image.title} · ${image.libraryName}${image.encrypted?' · 加密库':''}`;$('random-error').textContent='';}
 catch(e){if(request!==randomRequest)return;stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-caption').textContent='';$('random-error').textContent=e.message;}
 finally{if(request===randomRequest){randomBusy=false;$('random-next').disabled=false;}}
}
$('random-trigger').onclick=()=>{$('random-scope').replaceChildren(new Option('所有允许展示的库',''),...state.libraries.map(l=>new Option(l.name,l.id)));$('random-dialog').showModal();nextRandom();};
$('random-next').onclick=nextRandom;$('random-scope').onchange=()=>{randomRequest++;randomBusy=false;state.randomImage=null;$('random-image').removeAttribute('src');nextRandom();};
function playRandom(){stopRandom();randomTimer=setInterval(nextRandom,Number($('random-interval').value)*1000);$('random-play').textContent='暂停';}
$('random-play').onclick=()=>randomTimer?stopRandom():playRandom();$('random-interval').onchange=()=>{if(randomTimer)playRandom();};
$('random-dialog').addEventListener('close',()=>{randomRequest++;randomBusy=false;$('random-next').disabled=false;stopRandom();state.randomImage=null;$('random-image').removeAttribute('src');$('random-image').alt='';$('random-caption').textContent='';});
if(window.arkDesktop){$('open-folder').hidden=false;$('open-folder').onclick=()=>window.arkDesktop.openDataFolder();window.arkDesktop.onLibrariesLocked(()=>{clearSensitiveViews();refresh().catch(e=>toast(e.message));});}
setInterval(()=>refresh({poll:true}).catch(()=>{}),5000);
refresh().catch(e=>toast(e.message));
$('batch-delete').onclick=async()=>{
 const ids=[...state.selected];const libraryId=state.libraryId;if(!ids.length||state.deleting)return;
 if(!confirm(`确定删除所选的 ${ids.length} 张图片吗？\n将删除 Ark 库中的图片副本和分类记录，原始文件夹不受影响。此操作无法撤销。`))return;
 state.deleting=true;render();let deleted=0,cleanupFailures=0;
 try{for(let offset=0;offset<ids.length;offset+=500){const result=await api(`${libraryPath(libraryId)}/images/batch-delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids.slice(offset,offset+500)})});deleted+=result.deletedIds.length;cleanupFailures+=result.cleanupFailures;
  if(state.libraryId===libraryId){const removed=new Set(result.deletedIds);removeEverywhere(result.deletedIds);if(removed.has(state.detailId)){$('detail').close();$('detail-image').removeAttribute('src');state.detailId='';}}
  if(state.randomImage?.libraryId===libraryId&&result.deletedIds.includes(state.randomImage.id)){$('random-dialog').close();}
 }state.selecting=false;toast(`已删除 ${deleted} 张图片${cleanupFailures?`；${cleanupFailures} 个库文件清理失败，请检查数据目录权限`:''}`);
 }catch(e){toast(`已删除 ${deleted} 张；${e.message}。未删除的图片仍保留选中状态。`);}finally{state.deleting=false;await refresh().catch(()=>{});render();}
};
function renderUpdate(value=updateState){
 if(!value)return;updateState=value;$('update-panel').hidden=false;$('app-version').textContent=`v${value.currentVersion}`;$('update-message').textContent=value.message;
 const busy=state.uploading||state.deleting||state.backingUp||state.processing;
 $('check-update').disabled=['unsupported','checking','downloading','ready','installing'].includes(value.status);
 $('download-update').hidden=value.status!=='available';$('download-update').disabled=busy;
 $('install-update').hidden=value.status!=='ready';$('install-update').disabled=busy;
 $('update-progress').hidden=value.status!=='downloading';$('update-progress').value=value.progress;
 $('update-banner').hidden=!['available','downloading','ready','installing'].includes(value.status);
 $('update-banner-text').textContent=value.status==='downloading'?`正在下载更新 ${Math.round(value.progress)}%`:value.message;
 $('update-banner-action').textContent=value.status==='ready'?'查看并安装':'查看更新';
}
if(window.arkDesktop?.getUpdateState){
 window.arkDesktop.onUpdateState(renderUpdate);window.arkDesktop.getUpdateState().then(renderUpdate).catch(()=>{});
 $('update-banner-action').onclick=()=>{renderSettings();$('settings-dialog').showModal();};
 $('check-update').onclick=()=>window.arkDesktop.checkForUpdates().then(renderUpdate).catch(()=>toast('无法检查更新，请稍后重试。'));
 $('download-update').onclick=()=>{if(state.uploading||state.deleting||state.backingUp||state.processing){toast('请等导入、删除或备份完成后再下载更新。');return;}window.arkDesktop.downloadUpdate().then(renderUpdate).catch(()=>toast('下载失败，请重试。'));};
 $('install-update').onclick=()=>{if(state.uploading||state.deleting||state.backingUp||state.processing){toast('请等导入、删除或备份完成后再安装。');return;}if(!confirm('现在重启并安装更新吗？本地图片库会保留，加密库将锁定。'))return;window.arkDesktop.installUpdate().then(renderUpdate).catch(()=>toast('无法安装更新，请重试。'));};
}

let protectionMode='',protectionIds=[],protectionLibraryId='',protectionBusy=false;
const postOperation=(action,data,libraryId=state.libraryId)=>api(`${libraryPath(libraryId)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function showProtection(mode,ids=[],libraryId){
 if(protectionBusy){toast('正在处理加密操作，请稍候。');return;}protectionMode=mode;protectionIds=ids;protectionLibraryId=libraryId||(ids[0]?imageLibrary(ids[0]):state.libraryId);const image=state.images.find(i=>i.id===ids[0]);const configured=state.masterPassword.configured;const setup=mode==='setup'||(mode==='encrypt'&&!configured);const cached=mode==='encrypt'&&configured&&state.masterPassword.ready;
 $('protection-form').reset();for(const id of ['protection-password','protection-confirm','protection-legacy-password'])$(id).type='password';$('protection-error').textContent='';$('password-caps-warning').textContent='';
 $('protection-title').textContent=setup?'设置统一密码':mode==='encrypt'?`加密 ${ids.length} 张图片`:mode==='all'?'解锁全部加密内容':mode==='library'?'解锁旧加密库':'临时查看加密图片';
 $('protection-help').textContent=setup?'只需设置一次，之后新加密的图片都使用这个密码。密码无法找回。':mode==='encrypt'?'使用已设置的统一密码加密，原来的角色和文件夹分类保留。':configured?'输入统一密码临时查看，不会解除加密。旧版内容原密码不同时，可在下方填写，验证后接入统一密码。':'首次输入旧内容的正确原密码后，将使用它作为统一密码。';
 $('protection-password-caption').textContent=configured?'统一密码':setup?'统一密码（至少 8 个字符）':'原密码（验证后作为统一密码）';
 $('protection-password-label').hidden=cached;$('protection-password').required=!cached;$('protection-password').minLength=setup?8:0;
 $('protection-confirm-label').hidden=!setup;$('protection-confirm').required=setup;
 $('protection-scope-label').hidden=setup||mode==='encrypt';const single=$('protection-scope').querySelector('option[value="single"]');single.disabled=mode==='all'||mode==='library';single.hidden=single.disabled;$('protection-scope').value=single.disabled?'session':'single';
 $('protection-legacy-label').hidden=!configured||!(mode==='library'||mode==='all'||image?.legacy);$('protection-show-label').hidden=cached;
 $('protection-dialog').showModal();
}
$('protect-image').onclick=()=>showProtection('encrypt',[state.detailId],state.detailLibraryId);
$('batch-protect').onclick=()=>showProtection('encrypt',[...state.selected]);
$('protection-form').onsubmit=async event=>{
 event.preventDefault();if(protectionBusy)return;protectionBusy=true;const button=event.target.querySelector('button[type=submit]');for(const b of $('protection-dialog').querySelectorAll('button'))b.disabled=true;button.textContent='正在处理…';const mode=protectionMode;const ids=[...protectionIds];const libraryId=protectionLibraryId;const password=$('protection-password').value;const legacyPassword=$('protection-legacy-password').value||undefined;const scope=$('protection-scope').value;
 try{
  if(mode==='setup'||(mode==='encrypt'&&!state.masterPassword.configured)){if(password!==$('protection-confirm').value)throw Error('两次密码不一致。');applySnapshot(await api('/api/master-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})}));}
  let result;
  if(mode==='encrypt'){
   const remaining=ids.filter(id=>!state.images.find(image=>image.id===id)?.protected);let completed=0;state.processing=true;render();$('upload-progress').hidden=false;
   try{
    await api('/api/import-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true})});
    for(let offset=0;offset<remaining.length;){const chunk=remaining.slice(offset,offset+(offset===0?10:50)),previews={};
     for(const id of chunk){$('upload-progress').textContent=`正在加密 ${completed+1} / ${remaining.length}`;const preview=await captureEncryptedPreview({id,libraryId});if(preview)previews[id]=preview;}
     const protectedRows=await postOperation('protect',{ids:chunk,previews,...(offset===0&&password?{password}:{})},libraryId);completed+=chunk.length;offset+=chunk.length;protectionIds=remaining.slice(offset);chunk.forEach(id=>state.selected.delete(id));if(state.libraryId===libraryId){state.libraryImages=protectedRows;if(state.view!=='encrypted')state.images=protectedRows;render();}button.textContent=`正在加密 ${completed} / ${remaining.length}`;
    }
    $('detail').close();state.selecting=false;toast(completed?`已加密 ${completed} 张图片`:'所选图片已加密');
   }catch(error){throw Error(`已完成 ${completed} 张；${error.message}`);}finally{await api('/api/import-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false})}).catch(()=>{});state.processing=false;$('upload-progress').hidden=true;await refresh();render();}
  }
  else if(mode==='unlock'){result=await postOperation('unlock-image',{id:ids[0],password,scope,legacyPassword},libraryId);await refresh();openDetail(ids[0],result.image);toast(`已临时解锁 ${result.count} 张图片`);}
  else if(mode==='all'){result=await api('/api/unlock-matching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,scope,legacyPassword})});await refresh();toast(`已解锁 ${result.count} 张${result.remaining||result.lockedLibraries?'；旧版未匹配内容仍保持锁定':''}${result.issues.length?'；部分加密数据需要检查备份':''}`);}
  else if(mode==='library'){await api(`${libraryPath(libraryId)}/unlock`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,scope,legacyPassword})});await refresh();toast('旧加密库已临时解锁');}
  else{await refresh();toast('统一密码已设置，后续加密使用同一个密码');}
  $('protection-dialog').close();
 }catch(e){$('protection-error').textContent=e.message;await refresh().catch(()=>{});}finally{protectionBusy=false;button.textContent='确认';for(const b of $('protection-dialog').querySelectorAll('button'))b.disabled=false;}
};
$('protection-dialog').addEventListener('cancel',event=>{if(protectionBusy)event.preventDefault();});
$('protection-dialog').addEventListener('close',()=>{if(!$('protection-dialog').open){$('protection-form').reset();for(const id of ['protection-password','protection-confirm','protection-legacy-password'])$(id).type='password';}});
async function releaseSingle(id,libraryId=state.detailLibraryId||imageLibrary(id)){try{const result=await postOperation('lock-image',{id},libraryId);if(result.changed)await refresh();}catch{}}
$('detail').addEventListener('close',()=>{if(!$('detail').open){closeOriginalView();if(state.detailId)releaseSingle(state.detailId,state.detailLibraryId);state.detailId='';state.detailLibraryId='';$('detail-image').removeAttribute('src');$('download').removeAttribute('href');$('edit-form').reset();}});
$('unprotect-image').onclick=async()=>{if(!confirm('解除这张图片的加密？之后无需密码即可查看。'))return;try{await postOperation('unprotect',{id:state.detailId},state.detailLibraryId);$('detail').close();await refresh();toast('已解除图片加密');}catch(e){toast(e.message);}};
$('protection-show-password').onchange=event=>{for(const id of ['protection-password','protection-confirm','protection-legacy-password'])$(id).type=event.target.checked?'text':'password';};
$('unlock-show-password').onchange=event=>{$('unlock-password').type=event.target.checked?'text':'password';};
$('protection-password').onkeyup=event=>{$('password-caps-warning').textContent=event.getModifierState?.('CapsLock')?'大写锁定已开启。':'';};
function renderEncryptedTools(){
 const active=state.view==='encrypted';$('encrypted-lock-all').disabled=state.uploading||state.deleting;$('encrypted-unlock-all').disabled=state.uploading||state.deleting;$('encrypted-tools').hidden=!active;$('encrypted-count').textContent=String(state.encryptedImages.length||'');$('encrypted-legacy-libraries').hidden=!active||!state.lockedLibraries.length;$('encrypted-legacy-libraries').replaceChildren();
 $('encrypted-unlock-all').textContent=state.masterPassword.configured?'解锁全部':'设置统一密码';$('master-password-status').textContent=state.masterPassword.configured?'已设置统一密码；后续新加密内容都使用同一个密码。':'尚未设置统一密码。先设置一次，之后无需逐张设置。';
 for(const lib of state.lockedLibraries){const card=element('article','encrypted-library-card');card.append(element('h3','',lib.name),element('p','muted small','旧版整库加密 · 解锁前隐藏图片和分类'));const button=element('button','secondary','解锁此库');button.disabled=state.uploading||state.deleting;button.onclick=()=>showProtection('library',[],lib.id);card.append(button);$('encrypted-legacy-libraries').append(card);}
}
$('encrypted-unlock-all').onclick=()=>showProtection(state.masterPassword.configured?'all':'setup');
$('encrypted-lock-all').onclick=()=>$('lock-all').click();
$('delete-character').onclick=async()=>{if(!state.character||!confirm(`删除角色分类「${state.character}」？图片会保留，仅清除角色归属。`))return;try{await postOperation('delete-character',{name:state.character});changeView('characters');await refresh();toast('角色分类已删除，图片已保留');}catch(e){toast(e.message);}};
window.addEventListener('beforeunload',event=>{if(state.uploading||state.backingUp||state.processing){event.preventDefault();event.returnValue='正在导入，请等待完成。';}});

let folderPreview=null;
function previewFolders(files){
 if(state.uploading){toast('请等待当前导入完成。');return;}const analysis=ArkFolders.analyze(files);if(!analysis.files.length){toast('未找到支持的图片（JPG / PNG / GIF / WebP）');return;}
 folderPreview={...analysis,allFiles:files,libraryId:state.libraryId,roles:new Map(),controls:new Map()};
 $('folder-preview-info').textContent=`目标库：${currentLibrary()?.name||''} · ${analysis.files.length} 张图片 · ${analysis.nodes.length} 个文件夹 · 跳过 ${analysis.skipped} 个非支持文件`;
 $('folder-update-duplicates').checked=false;$('folder-preview-error').textContent='';
 const depth=$('folder-role-depth');depth.replaceChildren(new Option('手动选择文件夹','custom'),...Array.from({length:Math.max(0,...analysis.nodes.map(n=>n.depth))},(_,i)=>new Option(`勾选第 ${i+1} 层（所选根目录为第 1 层）`,String(i+1))));
 const parents=new Set(analysis.nodes.map(n=>n.parent));const containers=new Map([['',$('folder-tree')]]);$('folder-tree').replaceChildren();
 // Sorting by depth guarantees each parent exists, regardless of its name.
 for(const node of [...analysis.nodes].sort((a,b)=>a.depth-b.depth||a.path.localeCompare(b.path,'zh'))){
  const branch=element('div','folder-branch');const row=element('div','folder-tree-row');const children=element('div','folder-children');const toggle=element('button','folder-toggle','▾');toggle.type='button';toggle.setAttribute('aria-label',`折叠 ${node.name}`);toggle.setAttribute('aria-expanded','true');toggle.onclick=()=>{children.hidden=!children.hidden;toggle.textContent=children.hidden?'▸':'▾';toggle.setAttribute('aria-expanded',String(!children.hidden));toggle.setAttribute('aria-label',`${children.hidden?'展开':'折叠'} ${node.name}`);};
  const hasChildren=parents.has(node.path);toggle.hidden=!hasChildren;
  const label=element('label','folder-node-label');const checkbox=element('input');checkbox.type='checkbox';checkbox.dataset.folder=node.path;checkbox.setAttribute('aria-label',`将 ${node.path} 作为角色分类`);const name=element('span','folder-node-name',node.name);name.title=node.path;label.append(checkbox,name);
  const count=element('small','muted',`${node.count} 张（本层 ${node.directCount}）`);const roleName=element('input','folder-role-name');roleName.type='text';roleName.maxLength=200;roleName.value=node.name.slice(0,200);roleName.hidden=true;roleName.setAttribute('aria-label',`${node.path} 的角色名称`);roleName.placeholder='角色名称';
  checkbox.onchange=()=>{roleName.hidden=!checkbox.checked;if(checkbox.checked)folderPreview.roles.set(node.path,roleName.value);else folderPreview.roles.delete(node.path);depth.value='custom';renderFolderPreview();};roleName.oninput=()=>{if(checkbox.checked)folderPreview.roles.set(node.path,roleName.value);renderFolderPreview();};
  folderPreview.controls.set(node.path,{checkbox,roleName});row.append(toggle,label,count,roleName);branch.append(row,children);containers.get(node.parent).append(branch);containers.set(node.path,children);
 }
 renderFolderPreview();$('folder-preview-dialog').showModal();
}
function renderFolderPreview(){
 if(!folderPreview)return;const {files,roles}=folderPreview;let assigned=0;const names=new Set();for(const file of files){const name=ArkFolders.characterFor(ArkFolders.folderOf(file),roles);if(name){assigned++;names.add(name);}}
 const invalid=[...roles.values()].some(name=>!name.trim()||name.length>200);$('folder-start-import').disabled=invalid;$('folder-preview-error').textContent=invalid?'勾选的文件夹需要填写角色名称（最多 200 字）。':'';
 $('folder-preview-summary').textContent=`${names.size} 个角色 · ${assigned} 张已分配角色 · ${files.length-assigned} 张仅保留目录分类。`;
 $('folder-start-import').textContent=roles.size?'按预览开始导入':'仅保留目录导入';
 $('folder-preview-samples').replaceChildren(element('p','muted small','分类示例（最多显示 8 张）：'));
 for(const file of files.slice(0,8)){const folder=ArkFolders.folderOf(file);$('folder-preview-samples').append(element('p','small',`${folder?folder+'/':''}${file.name} → ${ArkFolders.characterFor(folder,roles)||'不设置角色'}`));}
}
$('folder-clear-roles').onclick=()=>{if(!folderPreview)return;folderPreview.roles.clear();for(const {checkbox,roleName} of folderPreview.controls.values()){checkbox.checked=false;roleName.hidden=true;}$('folder-role-depth').value='custom';renderFolderPreview();};
$('folder-role-depth').onchange=event=>{if(!folderPreview||event.target.value==='custom')return;const depth=Number(event.target.value);folderPreview.roles.clear();for(const node of folderPreview.nodes){const {checkbox,roleName}=folderPreview.controls.get(node.path);checkbox.checked=node.depth===depth;roleName.hidden=!checkbox.checked;if(checkbox.checked)folderPreview.roles.set(node.path,roleName.value);}renderFolderPreview();};
$('folder-start-import').onclick=async()=>{
 if(!folderPreview||$('folder-start-import').disabled)return;const pending=folderPreview;if(!state.libraries.find(l=>l.id===pending.libraryId)?.unlocked){$('folder-preview-error').textContent='目标图片库已锁定，请取消预览、解锁后重新选择文件夹。';return;}const roles=new Map([...pending.roles].map(([path,name])=>[path,name.trim()]));const updateDuplicates=$('folder-update-duplicates').checked;
 $('folder-preview-dialog').close();await upload(pending.allFiles,{preserveFolders:true,roles,libraryId:pending.libraryId,updateDuplicates});
};
$('folder-preview-dialog').addEventListener('close',()=>{folderPreview=null;$('folder-tree').replaceChildren();$('folder-preview-samples').replaceChildren();});

let originalScale=1,originalMode='fit',originalDrag=null;
function closeOriginalView(){
 $('original-viewer').close();$('original-image').removeAttribute('src');$('original-image').alt='';$('original-image').hidden=true;$('original-image').style.width='';$('original-image').style.height='';$('original-caption').textContent='';$('original-info').textContent='';originalDrag=null;$('original-viewport').classList.remove('dragging');
}
function originalZoom(scale,mode='manual',point){
 const image=$('original-image'),viewport=$('original-viewport'),canvas=$('original-canvas');if(!$('original-viewer').open||!image.naturalWidth)return;
 const anchor=point||{x:viewport.clientWidth/2,y:viewport.clientHeight/2};const x=(viewport.scrollLeft+anchor.x)/Math.max(1,canvas.scrollWidth),y=(viewport.scrollTop+anchor.y)/Math.max(1,canvas.scrollHeight);
 originalMode=mode;originalScale=mode==='fit'?Math.min(1,Math.max(1,viewport.clientWidth-32)/image.naturalWidth,Math.max(1,viewport.clientHeight-32)/image.naturalHeight):Math.min(16,Math.max(.01,scale));
 image.style.width=`${image.naturalWidth*originalScale}px`;image.style.height=`${image.naturalHeight*originalScale}px`;
 viewport.scrollLeft=x*canvas.scrollWidth-anchor.x;viewport.scrollTop=y*canvas.scrollHeight-anchor.y;
 $('original-zoom').textContent=`${Math.round(originalScale*100)}%`;$('original-info').textContent=`${image.naturalWidth} × ${image.naturalHeight} 像素 · ${mode==='fit'?'适应窗口':'拖动或滚动查看'} · Ctrl + 滚轮缩放 · Esc 返回详情`;
 $('original-zoom-out').disabled=originalScale<=.01;$('original-zoom-in').disabled=originalScale>=16;
}
function openOriginalView(){
 if(!$('detail').open||!state.detailId||!$('detail-image').hasAttribute('src'))return;
 closeOriginalView();originalMode='fit';originalScale=1;$('original-caption').textContent=$('detail-image').alt||'原图';$('original-info').textContent='正在加载原图…';$('original-image').hidden=true;$('original-image').alt=$('detail-image').alt;
 $('original-viewer').showModal();$('original-image').src=$('detail-image').getAttribute('src');$('original-viewport').scrollLeft=0;$('original-viewport').scrollTop=0;$('original-viewport').focus();
}
$('view-original').onclick=openOriginalView;$('detail-image').onclick=openOriginalView;
$('original-image').onload=()=>{if($('original-viewer').open){$('original-image').hidden=false;originalZoom(1,'fit');}};
$('original-image').onerror=()=>{if(!$('original-viewer').open)return;$('original-image').hidden=true;$('original-info').textContent='无法读取原图，图片可能已锁定或文件缺失。请返回详情重试。';};
$('original-fit').onclick=()=>originalZoom(1,'fit');$('original-actual').onclick=()=>originalZoom(1);$('original-zoom-in').onclick=()=>originalZoom(originalScale*1.25);$('original-zoom-out').onclick=()=>originalZoom(originalScale/1.25);
$('original-viewer').addEventListener('close',()=>{if(!$('original-viewer').open){$('original-image').removeAttribute('src');$('original-image').alt='';$('original-image').hidden=true;$('original-image').style.width='';$('original-image').style.height='';$('original-caption').textContent='';$('original-info').textContent='';originalDrag=null;$('original-viewport').classList.remove('dragging');}});
$('original-viewport').addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();originalZoom(originalScale*(event.deltaY<0?1.15:1/1.15),'manual',{x:event.clientX-rect.left,y:event.clientY-rect.top});},{passive:false});
$('original-viewport').addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0)return;originalDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop};event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.classList.add('dragging');event.preventDefault();});
$('original-viewport').addEventListener('pointermove',event=>{if(!originalDrag||event.pointerId!==originalDrag.id)return;event.currentTarget.scrollLeft=originalDrag.left+originalDrag.x-event.clientX;event.currentTarget.scrollTop=originalDrag.top+originalDrag.y-event.clientY;});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('original-viewport').addEventListener(name,()=>{originalDrag=null;$('original-viewport').classList.remove('dragging');});
window.addEventListener('resize',()=>{if($('original-viewer').open&&originalMode==='fit')originalZoom(1,'fit');});

// Persist each photo's blurred thumbnail, retaining its composition and aspect ratio.
async function captureEncryptedPreview(image,loaded){
 if(typeof CanvasRenderingContext2D==='undefined')return null;
 let timer;
 try{
  const source=loaded||new Image();if(!loaded){source.src=fileURL(image);await Promise.race([source.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Preview timeout')),10000);})]);}
  const ratio=64/Math.max(source.naturalWidth,source.naturalHeight);const width=Math.max(1,Math.round(source.naturalWidth*ratio)),height=Math.max(1,Math.round(source.naturalHeight*ratio));
  const scaled=document.createElement('canvas');scaled.width=width;scaled.height=height;const raw=scaled.getContext('2d');raw.fillStyle='#6d6078';raw.fillRect(0,0,width,height);raw.drawImage(source,0,0,width,height);
  // Extend the edges before blurring so the thumbnail never gains a uniform border.
  const pad=12,padded=document.createElement('canvas');padded.width=width+pad*2;padded.height=height+pad*2;const edges=padded.getContext('2d');
  edges.drawImage(scaled,0,0,1,height,0,pad,pad,height);edges.drawImage(scaled,width-1,0,1,height,width+pad,pad,pad,height);edges.drawImage(scaled,0,0,width,1,pad,0,width,pad);edges.drawImage(scaled,0,height-1,width,1,pad,height+pad,width,pad);
  for(const [x,y] of [[0,0],[width-1,0],[0,height-1],[width-1,height-1]])edges.drawImage(scaled,x,y,1,1,x?width+pad:0,y?height+pad:0,pad,pad);
  edges.drawImage(scaled,pad,pad);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.filter='blur(3px)';context.drawImage(padded,-pad,-pad);
  const rgba=context.getImageData(0,0,width,height).data;let rgb='';for(let n=0;n<rgba.length;n+=4)rgb+=String.fromCharCode(rgba[n],rgba[n+1],rgba[n+2]);return {version:2,width,height,pixels:btoa(rgb)};
 }catch{return null;}finally{clearTimeout(timer);}
}
const pendingPreviews=new Set(),previewErrors=new Set();
async function saveEncryptedPreview(image,loaded){
 if(!image?.protected||image.previewVersion===2||pendingPreviews.has(image.id))return;
 pendingPreviews.add(image.id);renderPreviewStatus();const revision=state.lockRevision;
 try{const preview=await captureEncryptedPreview(image,loaded);if(revision!==state.lockRevision)return;if(!preview){previewErrors.add(image.id);return;}await postOperation('preview',{id:image.id,preview},image.libraryId);latestPreviews.set(image.id,{hasPreview:true,previewVersion:2,previewWidth:preview.width,previewHeight:preview.height});previewErrors.delete(image.id);for(const source of [state.images,state.libraryImages,state.encryptedImages]){const row=source.find(row=>row.id===image.id);if(row){row.hasPreview=true;row.previewVersion=2;row.previewWidth=preview.width;row.previewHeight=preview.height;}}if(revision===state.lockRevision&&state.images.some(row=>row.id===image.id&&row.locked))render();}catch{if(revision===state.lockRevision)previewErrors.add(image.id);}finally{pendingPreviews.delete(image.id);renderPreviewStatus();}
}
let previewQueueRunning=false;
async function queueEncryptedPreviews(){
 if(previewQueueRunning||typeof CanvasRenderingContext2D==='undefined')return;previewQueueRunning=true;const revision=state.lockRevision;
 try{for(const image of state.encryptedImages.filter(image=>image.protected&&!image.locked&&image.previewVersion!==2)){if(revision!==state.lockRevision)break;await saveEncryptedPreview(image);}}finally{previewQueueRunning=false;}
}
$('detail-image').addEventListener('load',()=>{const image=state.encryptedImages.find(image=>image.id===state.detailId)||state.images.find(image=>image.id===state.detailId);saveEncryptedPreview(image,$('detail-image'));});

function renderPreviewStatus(){
 const status=$('encrypted-preview-status');if(!status)return;const needing=state.encryptedImages.filter(image=>image.protected&&image.previewVersion!==2);const unlocked=needing.some(image=>!image.locked);
 const failed=needing.filter(image=>previewErrors.has(image.id)).length;if(failed&&!pendingPreviews.size){status.textContent=`${failed} 张封面生成失败，请重新解锁后重试；其余待更新 ${needing.length-failed} 张。`;return;}
 status.textContent=needing.length?(pendingPreviews.size||unlocked?`正在按原图生成模糊封面，还剩 ${needing.length} 张；完成后可锁定全部。`:`${needing.length} 张模糊封面待生成或更新。点击「解锁全部」输入密码，完成后再锁定。`):'模糊封面已就绪，每张封面来自对应图片。';
}

if(window.arkDesktop?.backupData){
 $('backup-data').hidden=false;$('backup-data').onclick=async()=>{
  if(state.uploading||state.deleting||state.backingUp||state.processing)return;state.backingUp=true;render();$('backup-status').textContent='请选择备份保存位置…';
  try{const result=await window.arkDesktop.backupData();$('backup-status').textContent=result.cancelled?'已取消备份。':`备份完成：${result.directory}${result.skippedLinks?'（已跳过符号链接）':''}`;}
  catch(error){$('backup-status').textContent=`备份未完成：${error.message}`;}finally{state.backingUp=false;await refresh().catch(()=>{});render();}
 };
}else $('backup-status').textContent='退出软件后，复制完整数据文件夹即可备份。';

function renderStarterImages(){
 const pack=state.starterImages,busy=state.uploading||state.deleting||state.backingUp||state.processing;
 $('starter-images-settings').hidden=!pack.available&&!pack.count&&!pack.error;
 $('add-starter-images').hidden=!pack.available||pack.count>0;$('add-starter-images').disabled=busy;
 $('remove-starter-images').hidden=!pack.count;$('remove-starter-images').disabled=busy;
 $('starter-images-status').textContent=state.starterBusy||state.starterMessage||pack.error||(pack.count?`还剩 ${pack.count} 张初始图片。`:'尚未添加初始图片，可按需添加。');
}
async function changeStarterImages(method){
 if(state.uploading||state.deleting||state.backingUp||state.processing)return;
 if(method==='DELETE'&&!confirm(`删除 ${state.starterImages.count} 张初始图片？你自己导入的图片会保留，删除后不会自动添加。`))return;
 state.processing=true;state.starterMessage='';state.starterBusy=method==='DELETE'?'正在删除初始图片…':'正在添加初始图片…';render();
 try{const result=await api('/api/starter-images',{method});
  if(method==='DELETE'){removeEverywhere(result.deletedIds);if(result.deletedIds.includes(state.detailId)){$('detail').close();closeOriginalView();}if(result.deletedIds.includes(state.randomImage?.id))$('random-dialog').close();state.starterMessage=`已删除 ${result.deletedIds.length} 张初始图片。${result.cleanupFailures?'部分文件清理失败，请检查数据目录权限。':''}`;}
  else state.starterMessage=`已添加 ${result.added} 张初始图片${result.skipped?`，跳过 ${result.skipped} 张已有图片`:''}。`;
 }catch(error){state.starterMessage=error.message;}
 finally{await refresh().catch(()=>{});state.processing=false;state.starterBusy='';render();}
}
$('add-starter-images').onclick=()=>changeStarterImages('POST');
$('remove-starter-images').onclick=()=>changeStarterImages('DELETE');
