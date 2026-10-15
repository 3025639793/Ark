module.exports.verifyFolderPreview=async window=>{
 await window.webContents.executeJavaScript(`(async()=>{
  const paths=['收藏/作品/角色甲/壁纸/横屏/a.png','收藏/作品/角色甲/同人/b.png','收藏/作品/角色乙/头像/c.png'];
  const files=paths.map(path=>{const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],path.split('/').at(-1),{type:'image/png'});Object.defineProperty(file,'webkitRelativePath',{value:path});return file;});
  previewFolders(files);
  const select=path=>{const checkbox=[...document.querySelectorAll('#folder-tree input[type=checkbox]')].find(input=>input.dataset.folder===path);if(!checkbox)throw Error('Missing nested folder in preview');checkbox.click();};
  select('收藏/作品/角色甲');select('收藏/作品/角色乙');
  if(!document.getElementById('folder-preview-summary').textContent.includes('3 张已分配角色'))throw Error('Descendant photos did not inherit parent roles');
  if(!document.getElementById('folder-preview-samples').textContent.includes('a.png → 角色甲'))throw Error('Nested folder was mistaken for the character');
  select('收藏/作品/角色甲/同人');
  if(!document.getElementById('folder-preview-samples').textContent.includes('b.png → 同人'))throw Error('Deeper role assignment did not override its parent');
  select('收藏/作品/角色甲/同人');
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const dialog=document.getElementById('folder-preview-dialog').getBoundingClientRect();const action=document.getElementById('folder-start-import').getBoundingClientRect();
  if(action.bottom>dialog.bottom||action.top<dialog.top)throw Error('Folder preview action is outside the dialog');
  const preview=document.getElementById('folder-preview-dialog');const closed=new Promise(resolve=>preview.addEventListener('close',resolve,{once:true}));preview.close();await closed;
  if(state.images.length||folderPreview!==null)throw Error('Cancelling preview must not import images or retain source files');
 })()`);
 console.log('Native nested folder preview, inherited roles, overrides and cancellation verified.');
};
