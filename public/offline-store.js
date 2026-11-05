// Only explicitly downloaded books and narration are retained. API responses
// never enter the service-worker cache.
const DATABASE='readbook-offline', VERSION=1;
let connection;
function database(){
  if(!globalThis.indexedDB)return Promise.reject(Error('Offline storage is unavailable in this browser.'));
  return connection ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,VERSION);
    request.onupgradeneeded=()=>{for(const name of ['books','state','audio'])request.result.createObjectStore(name);};
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=null;};resolve(request.result);};
    request.onerror=()=>{connection=null;reject(request.error);};
  });
}
async function transaction(names,mode,work){
  const db=await database();return new Promise((resolve,reject)=>{
    const tx=db.transaction(names,mode);let result;
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Storage operation was interrupted.'));
    try{result=work(tx);}catch(error){tx.abort();reject(error);}
  });
}
async function get(store,key){let request;await transaction([store],'readonly',tx=>{request=tx.objectStore(store).get(key);});return request.result;}
async function put(store,key,value){await transaction([store],'readwrite',tx=>tx.objectStore(store).put(value,key));return value;}
async function entries(store){let keys,values;await transaction([store],'readonly',tx=>{keys=tx.objectStore(store).getAllKeys();values=tx.objectStore(store).getAll();});return keys.result.map((key,index)=>[key,values.result[index]]);}
async function keys(store){let request;await transaction([store],'readonly',tx=>{request=tx.objectStore(store).getAllKeys();});return request.result;}
export const localState={get:key=>get('state',key),set:(key,value)=>put('state',key,value)};
export async function downloadedBooks(){return (await entries('books')).map(([,value])=>value);}
export async function downloadedBook(id){const book=await get('books',id);if(!book)return null;const progress=await get('state','progress:'+id);return {...book,progress:progress?.value||book.progress};}
export async function saveBook(book){
  const old=await get('books',book.id);
  if(old){for(const chapter of old.chapters){const next=book.chapters.find(item=>item.id===chapter.id);if(!next||next.content!==chapter.content||next.format!==chapter.format)await removeNarration(book.id,chapter.id);}}
  await transaction(['books','state'],'readwrite',tx=>{tx.objectStore('books').put({...book,downloadedAt:Date.now()},book.id);tx.objectStore('state').put(true,'unlocked');const store=tx.objectStore('state'),key='progress:'+book.id,request=store.get(key);request.onsuccess=()=>{if(!request.result?.version){if(book.progress)store.put({value:book.progress},key);else store.delete(key);}};});
}
export async function removeBook(id){
  await removeNarration(id);await transaction(['books','state'],'readwrite',tx=>{tx.objectStore('books').delete(id);tx.objectStore('state').delete('progress:'+id);});
}
export async function clearPrivateData(){await transaction(['books','state','audio'],'readwrite',tx=>{for(const name of ['books','state','audio'])tx.objectStore(name).clear();});}
export async function savePending(key,value){return put('state',key,{value,version:crypto.randomUUID()});}
export async function pending(){return (await entries('state')).filter(([key,value])=>value?.version&&(key==='preferences'||key.startsWith('progress:')));}
export async function acknowledge(key,version){
  const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),request=store.get(key);request.onsuccess=()=>{if(request.result?.version===version)store.put({value:request.result.value},key);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
export async function localPreferences(){return (await get('state','preferences'))?.value;}
export async function audioKey(bookId,chapterId,input,voice,speed){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return `${bookId}/${chapterId}/${voice}/${speed}/`+[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function savedAudio(key){return get('audio',key);}
export async function saveAudio(key,blob){return put('audio',key,blob);}
export async function narrationStatus(bookId,chapterId){return get('state',`audio:${bookId}/${chapterId}`);}
export async function saveNarrationStatus(bookId,chapterId,value){return put('state',`audio:${bookId}/${chapterId}`,value);}
export async function removeNarration(bookId,chapterId){
  const prefix=bookId+'/'+(chapterId?chapterId+'/':'');
  const audio=(await keys('audio')).filter(key=>key.startsWith(prefix));
  const statuses=(await entries('state')).filter(([key])=>key.startsWith('audio:'+bookId+'/')&&(!chapterId||key==='audio:'+bookId+'/'+chapterId));
  await transaction(['audio','state'],'readwrite',tx=>{for(const key of audio)tx.objectStore('audio').delete(key);for(const [key] of statuses)tx.objectStore('state').delete(key);});
}
export async function storageSummary(){const books=await downloadedBooks();const statuses=(await entries('state')).filter(([key])=>key.startsWith('audio:'));return {books:books.length,chapters:books.reduce((sum,book)=>sum+book.chapters.length,0),audioBytes:statuses.reduce((sum,[,status])=>sum+(status.bytes||0),0),...(await navigator.storage?.estimate?.()||{})};}
