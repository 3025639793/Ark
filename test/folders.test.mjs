import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sandbox={};vm.runInNewContext(await readFile(new URL('../public/folders.js',import.meta.url),'utf8'),sandbox);const folders=sandbox.ArkFolders;
const file=(path,type='image/png')=>({name:path.split('/').at(-1),webkitRelativePath:path,type});
test('nested preview includes every parent and counts direct and descendant images',()=>{
 const result=folders.analyze([file('收藏/作品/角色/壁纸/a.png'),file('收藏/作品/角色/b.png'),file('收藏/作品/角色/同人/c.png'),file('收藏/说明.txt','text/plain')]);assert.equal(result.files.length,3);assert.equal(result.skipped,1);
 const role=result.nodes.find(n=>n.path==='收藏/作品/角色');assert.equal(role.depth,3);assert.equal(role.count,3);assert.equal(role.directCount,1);assert.equal(result.nodes.find(n=>n.path==='收藏').count,3);
});
test('role assignments inherit from the nearest selected folder with strict path boundaries',()=>{
 const roles=new Map([['收藏/角色甲','甲'],['收藏/角色甲/特别收藏','特别甲'],['收藏/角色乙','乙']]);
 assert.equal(folders.characterFor('收藏/角色甲/壁纸/横屏',roles),'甲');assert.equal(folders.characterFor('收藏/角色甲',roles),'甲');assert.equal(folders.characterFor('收藏/角色甲/特别收藏/壁纸',roles),'特别甲');assert.equal(folders.characterFor('收藏/角色甲乙/壁纸',roles),'');assert.equal(folders.characterFor('收藏/角色乙/壁纸',roles),'乙');assert.equal(folders.characterFor('收藏',roles),'');assert.equal(folders.characterFor('收藏/角色甲/壁纸',new Map()),'');
});
