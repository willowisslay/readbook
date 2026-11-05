import { test, expect } from '@playwright/test';
import { appearanceDefaults } from '../public/appearance.js';

async function seed(page,{long=false}={}){
  await page.request.post('/api/login',{data:{password:'browser-test-password'}});
  await page.request.put('/api/preferences',{data:{...appearanceDefaults,engine:'kokoro',kokoroVoice:'af_heart',rate:1,ambience:'off',voiceVolume:1,ambienceVolume:.25}});
  const {id}=await(await page.request.post('/api/books',{data:{title:'Offline story',description:'A book for the train.',cover:''}})).json();
  const text=long?Array.from({length:25},(_,index)=>`## Part ${index+1}\n\nThe **forest** was quiet. We followed a small path beneath the trees, listening to the birds and the gentle stream nearby.`).join('\n\n'):'# A quiet beginning\n\nThe **forest** was quiet. We followed the path home.';
  await page.request.post(`/api/books/${id}/chapters`,{data:{title:'The forest',content:text,format:'md',position:1}});
  await page.request.post(`/api/books/${id}/chapters`,{data:{title:'Home',content:'The journey ends here. We are home at last.',format:'txt',position:2}});
  await page.goto('/');
  await page.locator(`[data-book="${id}"]`).click();
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  return id;
}
async function close(page){await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('dialog')).not.toBeVisible();}
async function download(page){await page.getByRole('button',{name:'Offline options',exact:true}).click();await page.getByRole('button',{name:'Download book',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh book download',exact:true})).toBeVisible();}
function wav(){const buffer=Buffer.alloc(4844);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(24000,24);buffer.writeUInt32LE(48000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(4800,40);return buffer;}

test('downloaded books launch offline, retain Markdown and progress, and sync on reconnect',async({page,context})=>{
  const id=await seed(page,{long:true});await download(page);await close(page);
  await context.setOffline(true);await page.reload();
  await page.locator(`[data-book="${id}"]`).click();
  await page.getByRole('button',{name:'Start reading',exact:true}).click();
  await expect(page.locator('.page-content strong').first()).toHaveText('forest');
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.locator('#page-label')).toContainText('2 /');
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('button',{name:'night theme',exact:true}).click();await close(page);
  await expect.poll(()=>page.evaluate(async()=>{const store=await import('/offline-store.js');return (await store.pending()).some(([key,value])=>key.startsWith('progress:')&&value.value.offset>0);})).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','night');
  await page.locator(`[data-book="${id}"]`).click();await page.getByRole('button',{name:'Continue reading',exact:true}).click();
  await expect(page.locator('#page-label')).toContainText('2 /');
  await context.setOffline(false);
  await expect.poll(async()=>{const value=await(await page.request.get('/api/books/'+id)).json();return value.progress?.offset||0;}).toBeGreaterThan(0);
  await expect.poll(async()=>{const value=await(await page.request.get('/api/preferences')).json();return value.theme;}).toBe('night');
  const cachePaths=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())result.push(new URL(req.url).pathname);return result;});
  expect(cachePaths).toContain('/');expect(cachePaths.some(path=>path.startsWith('/api/'))).toBe(false);
});

test('saved Kokoro narration plays offline across chapters with no server generation',async({page,context})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,'AudioContext',{configurable:true,value:undefined});Object.defineProperty(window,'webkitAudioContext',{configurable:true,value:undefined});HTMLMediaElement.prototype.play=function(){return Promise.resolve();};});
  let requests=0;
  await page.route('**/api/tts',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}requests++;await route.fulfill({contentType:'audio/wav',body:wav()});});
  const id=await seed(page);await download(page);
  await page.getByRole('button',{name:'Download chapter audio',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use saved voice & speed',exact:true})).toBeVisible();
  await page.locator('#offline-chapter').selectOption({label:'Home'});
  await page.getByRole('button',{name:'Download chapter audio',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use saved voice & speed',exact:true})).toBeVisible();
  expect(requests).toBe(2);await close(page);
  await context.setOffline(true);await page.reload();
  await page.locator(`[data-book="${id}"]`).click();await page.getByRole('button',{name:'Start reading',exact:true}).click();
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  const audio=page.locator('#audio-controls audio');await expect(audio).toHaveAttribute('src',/^blob:/);
  await audio.evaluate(element=>element.dispatchEvent(new Event('ended')));
  await expect(page.locator('.reading-meta')).toContainText('Home');
  await expect(audio).toHaveAttribute('src',/^blob:/);
  await audio.evaluate(element=>element.dispatchEvent(new Event('ended')));
  await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeVisible();expect(requests).toBe(2);
});

test('the whole site uses the saved theme and exposes install and fullscreen options',async({page})=>{
  await seed(page);await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'App settings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Install Readbook',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Appearance & audio',exact:true}).click();
  await page.getByRole('button',{name:'black theme',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','black');
  expect(await page.locator('body').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(8, 8, 8)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#080808');
  await close(page);await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','black');
  const manifest=await(await page.request.get('/manifest.webmanifest')).json();expect(manifest.display).toBe('standalone');expect(manifest.start_url).toBe('/');
  for(const image of manifest.icons){const result=await page.request.get(image.src);expect(result.ok()).toBe(true);expect(result.headers()['content-type']).toBe('image/png');}
});

test('locking offline erases private downloads and prevents reopening with the server cookie',async({page,context})=>{
  const id=await seed(page);await download(page);await close(page);
  await page.getByRole('button',{name:'Library',exact:true}).click();await context.setOffline(true);
  await page.getByRole('button',{name:'Lock library',exact:true}).click();await expect(page.locator('#password')).toBeVisible();
  expect(await page.evaluate(async()=>{const store=await import('/offline-store.js');return (await store.downloadedBooks()).length;})).toBe(0);
  await page.reload();await expect(page.locator('#password')).toBeVisible();
  await context.setOffline(false);await page.reload();await expect(page.locator('#password')).toBeVisible();
  await page.locator('#password').fill('browser-test-password');await page.getByRole('button',{name:'Unlock',exact:true}).click();
  await expect(page.locator(`[data-book="${id}"]`)).toBeVisible();
});

test('a failed online password check cannot expose saved books via offline fallback',async({page,context})=>{
  await seed(page);await download(page);await close(page);
  await page.request.post('/api/logout',{data:{}});await page.reload();await expect(page.locator('#password')).toBeVisible();
  await context.setOffline(true);await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(0);
});

test('interrupted narration resumes saved parts and refreshing changed chapters invalidates old audio',async({page})=>{
  const requests=[];let failOnce=true;
  await page.route('**/api/tts',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    requests.push(route.request().postDataJSON().input);
    if(requests.length===2&&failOnce){failOnce=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary generation failure'})});return;}
    await route.fulfill({contentType:'audio/wav',body:wav()});
  });
  const id=await seed(page,{long:true});
  await download(page);await page.getByRole('button',{name:'Download chapter audio',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume audio download',exact:true})).toBeVisible();
  expect(requests.length).toBe(2);
  await page.getByRole('button',{name:'Resume audio download',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use saved voice & speed',exact:true})).toBeVisible();
  const first=requests[0];expect(requests.filter(input=>input===first)).toHaveLength(1);
  const before=await(await page.request.get('/api/books/'+id)).json(),chapter=before.chapters[0];
  await page.request.put(`/api/books/${id}/chapters/${chapter.id}`,{data:{...chapter,content:'A completely revised chapter. The old recording must be removed.'}});
  await page.getByRole('button',{name:'Refresh book download',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use saved voice & speed',exact:true})).not.toBeVisible();
  const result=await page.evaluate(async({id,chapterId})=>{const store=await import('/offline-store.js');const summary=await store.storageSummary();return {status:await store.narrationStatus(id,chapterId),bytes:summary.audioBytes};},{id,chapterId:chapter.id});
  expect(result.status).toBeUndefined();expect(result.bytes).toBe(0);
});
