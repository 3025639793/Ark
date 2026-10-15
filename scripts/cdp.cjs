const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.connect=async(port,timeout=30000)=>{
 const until=Date.now()+timeout;let target;
 while(Date.now()<until){try{const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=targets.find(item=>item.type==='page'&&item.url.startsWith('http://127.0.0.1:'));if(target)break;}catch{}await delay(100);}
 if(!target)throw Error('Installed application did not expose its local album page');
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const value=JSON.parse(event.data);const request=pending.get(value.id);if(!request)return;pending.delete(value.id);clearTimeout(request.timer);value.error?request.reject(Error(value.error.message)):request.resolve(value.result);});
 socket.addEventListener('close',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Application debugger closed'));}pending.clear();});
 const client={async evaluate(expression){const result=await new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Application evaluation timed out'));},20000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;},close(){socket.close();}};
 // The page target appears before its first navigation finishes. Poll without an
 // outstanding promise in the old document so navigation cannot destroy it.
 while(Date.now()<until){
  try{if(await client.evaluate("document.readyState==='complete' && !!document.querySelector('#library-select')?.options.length"))return client;}
  catch(error){if(!/Execution context was destroyed|Cannot find context/.test(error.message)){client.close();throw error;}}
  await delay(50);
 }
 client.close();throw Error('Installed album did not finish initializing');
};
