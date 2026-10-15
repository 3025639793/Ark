import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ThemeStore} from '../lib/theme.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('local theme image and easter-egg settings persist; invalid files preserve the existing image',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ark-theme-'));
 try{let theme=new ThemeStore(directory);await theme.init();assert.equal(theme.state().hasImage,false);await theme.setImage(png);const id=theme.state().imageId;await theme.settings({easterEggs:false});
 theme=new ThemeStore(directory);await theme.init();assert.equal(theme.state().easterEggs,false);assert.equal(theme.state().imageId,id);assert.deepEqual((await theme.image()).bytes,png);
 await assert.rejects(theme.setImage(Buffer.from('<svg/>')),e=>e.status===415);assert.equal(theme.state().imageId,id);await assert.rejects(theme.setImage(Buffer.alloc(10*1024*1024+1)),e=>e.status===413);
 await theme.clearImage();assert.equal(theme.state().hasImage,false);await assert.rejects(theme.image(),e=>e.status===404);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('each interaction is claimed once and remains claimed after restart and settings changes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ark-once-'));try{
  let theme=new ThemeStore(directory);await theme.init();assert.equal((await theme.claimEgg('passport')).triggered,true);assert.equal((await theme.claimEgg('passport')).triggered,false);
  await theme.settings({easterEggs:false});assert.equal((await theme.claimEgg('whisper')).triggered,false);await theme.settings({easterEggs:true});assert.equal((await theme.claimEgg('whisper')).triggered,true);
  theme=new ThemeStore(directory);await theme.init();assert.equal((await theme.claimEgg('passport')).triggered,false);assert.equal((await theme.claimEgg('whisper')).triggered,false);await assert.rejects(theme.claimEgg('unknown'),error=>error.status===400);
 }finally{await rm(directory,{recursive:true,force:true});}
});
