import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JSDOM,VirtualConsole} from 'jsdom';
import {startLocalApp} from '../server.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function waitUntil(fn){const deadline=Date.now()+10000;while(!fn()){if(Date.now()>deadline)throw Error('UI condition timed out');await new Promise(resolve=>setTimeout(resolve,20));}}
test('album UI imports, edits, creates a vault and removes displayed images on lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ark-ui-'));let app,dom;const errors=[];
 try{
  app=await startLocalApp({dataDir:dir});const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
  dom=await JSDOM.fromURL(app.url,{resources:'usable',runScripts:'dangerously',virtualConsole:console,beforeParse(window){
   window.fetch=(url,options={})=>fetch(new URL(url,window.location.href),options);
   window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
   window.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new window.Event('close'));};
   window.confirm=()=>true;
  }});
  const w=dom.window;const $=id=>w.document.getElementById(id);await waitUntil(()=>$('library-select').options.length===1);
  await w.upload([new File([png],'portrait.png',{type:'image/png'})]);assert.equal($('gallery').querySelectorAll('.card').length,1);
  $('gallery').querySelector('.card-open').click();assert.equal($('detail').open,true);const edit=$('edit-form');edit.elements.character.value='芙莉莲';edit.elements.tags.value='壁纸，冬天';edit.dispatchEvent(new w.Event('submit',{cancelable:true}));
  await waitUntil(()=>$('character-list').textContent.includes('芙莉莲'));$('detail').close();
  $('random-trigger').click();await waitUntil(()=>$('random-image').hasAttribute('src'));assert.match($('random-caption').textContent,/portrait/);$('random-dialog').close();
  $('new-library').click();const form=$('new-library-form');form.elements.name.value='私密角色';form.elements.encrypted.checked=true;form.elements.encrypted.dispatchEvent(new w.Event('change'));form.elements.password.value='ui-test-password';form.elements.confirm.value='ui-test-password';
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));await waitUntil(()=>$('library-select').options.length===2&&!$('new-library-dialog').open);await waitUntil(()=>$('gallery').querySelectorAll('.card').length===0);
  await w.upload([new File([png],'secret.png',{type:'image/png'})]);assert.equal($('gallery').querySelectorAll('.card').length,1);
  $('lock-library').click();await waitUntil(()=>!$('locked-library').hidden);assert.equal($('gallery').querySelectorAll('.card').length,0);assert.equal($('detail-image').hasAttribute('src'),false);
  $('unlock-password').value='ui-test-password';$('unlock-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await waitUntil(()=>$('locked-library').hidden&&$('gallery').querySelectorAll('.card').length===1);
  const selectedVault=$('library-select').value;$('library-select').value='default';$('library-select').dispatchEvent(new w.Event('change'));await waitUntil(()=>$('gallery').textContent.includes('portrait'));assert.equal($('library-select').value,'default');$('library-select').value=selectedVault;$('library-select').dispatchEvent(new w.Event('change'));await waitUntil(()=>$('gallery').textContent.includes('secret'));assert.equal($('library-select').value,selectedVault);
  $('settings-trigger').click();$('allow-encrypted').checked=true;const vaultCheckbox=$('random-libraries').querySelectorAll('input')[1];vaultCheckbox.checked=true;$('settings-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await waitUntil(()=>!$('settings-dialog').open);
  $('random-trigger').click();const vaultId=$('library-select').value;$('random-scope').value=vaultId;await waitUntil(()=>$('random-next').disabled===false);$('random-scope').dispatchEvent(new w.Event('change'));await waitUntil(()=>$('random-caption').textContent.includes('加密库'));
  $('lock-all').click();await waitUntil(()=>!$('random-dialog').open);assert.equal($('random-image').hasAttribute('src'),false);assert.equal($('random-caption').textContent,'');
  assert.deepEqual(errors,[]);
 }finally{dom?.window.close();await app?.close();await rm(dir,{recursive:true,force:true});}
});
