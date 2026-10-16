const {fixturePng}=require('./image-fixture.cjs');
exports.verifyStarter=async window=>{
 const image=fixturePng(32,32).toString('base64');
 const personalId=await window.webContents.executeJavaScript(`(async()=>{
  const $=id=>document.getElementById(id),until=Date.now()+20000;
  const wait=async condition=>{while(!condition()){if(Date.now()>until)throw Error('Starter collection UI timed out');await new Promise(resolve=>setTimeout(resolve,50));}};
  await refresh();if(!state.starterImages.available||state.starterImages.count!==20||state.images.length!==20)throw Error('A new profile must contain the bundled starter images');
  const body=Uint8Array.from(atob(${JSON.stringify(image)}),char=>char.charCodeAt(0));const personal=await api('/api/libraries/default/images?filename=personal-starter-test.png',{method:'POST',headers:{'Content-Type':'image/png'},body});await refresh();
  $('settings-trigger').click();if($('starter-images-settings').hidden)throw Error('Starter settings must be discoverable');
  const original=window.confirm;try{
   window.confirm=()=>false;$('remove-starter-images').click();if(state.starterImages.count!==20)throw Error('Cancelled starter removal must preserve images');
   window.confirm=()=>true;$('remove-starter-images').click();if(!$('remove-starter-images').disabled)throw Error('Starter removal must prevent double submission');
   await wait(()=>!state.processing&&state.starterImages.count===0);await refresh();
   if(state.images.length!==1||state.images[0].id!==personal.id||$('gallery').children.length!==1)throw Error('Starter cleanup must retain the personal image and update the gallery');
   $('add-starter-images').click();await wait(()=>!state.processing&&state.starterImages.count===20);if(state.images.length!==21)throw Error('Explicit starter re-add must preserve the personal image');
   $('remove-starter-images').click();await wait(()=>!state.processing&&state.starterImages.count===0);if(state.images.length!==1||state.images[0].id!==personal.id)throw Error('Repeated cleanup must remain scoped');
  }finally{window.confirm=original;$('settings-dialog').close();}
  return personal.id;
 })()`);
 console.log('Native bundled starter gallery, confirmation, personal-photo retention, scoped cleanup and manual re-add verified.');return personalId;
};
