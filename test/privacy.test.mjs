import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
test('public documentation uses generic wording for local folders',async()=>{
 const documents=['README.md','.github/release-notes.md','WINDOWS-开始使用.txt'];
 const absoluteLocalPath=/(?:^|[\s`"'(])(?:[a-z]:\\|\/(?:Users|home)\/[^/\s]+)/im;
 for(const document of documents){
  const text=await readFile(new URL('../'+document,import.meta.url),'utf8');
  // Do not echo document contents into public CI logs if validation fails.
  if(absoluteLocalPath.test(text))throw new Error(`${document}: replace machine-specific absolute paths with generic local-folder wording.`);
 }
});
