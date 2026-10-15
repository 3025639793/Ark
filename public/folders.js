// Pure helpers shared by the preview and the import operation.
(() => {
 const isImage=file=>['image/jpeg','image/png','image/gif','image/webp'].includes(file.type)||/\.(jpe?g|png|gif|webp)$/i.test(file.name);
 const folderOf=file=>(file.webkitRelativePath||'').replace(/\\/g,'/').split('/').slice(0,-1).filter(Boolean).join('/');
 function analyze(files){
  const supported=files.filter(isImage);const nodes=new Map();
  for(const file of supported){const parts=folderOf(file).split('/').filter(Boolean);for(let i=0;i<parts.length;i++){const path=parts.slice(0,i+1).join('/');if(!nodes.has(path))nodes.set(path,{path,name:parts[i],depth:i+1,parent:parts.slice(0,i).join('/'),count:0,directCount:0});const node=nodes.get(path);node.count++;if(i===parts.length-1)node.directCount++;}}
  return {files:supported,skipped:files.length-supported.length,nodes:[...nodes.values()].sort((a,b)=>a.path.localeCompare(b.path,'zh'))};
 }
 function characterFor(folder,roles){
  const parts=folder.split('/').filter(Boolean);for(let depth=parts.length;depth>0;depth--){const path=parts.slice(0,depth).join('/');if(roles.has(path))return roles.get(path).trim();}return '';
 }
 globalThis.ArkFolders=Object.freeze({isImage,folderOf,analyze,characterFor});
})();
