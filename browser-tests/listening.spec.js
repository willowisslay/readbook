import { test, expect } from '@playwright/test';

// Deterministic media lets tests finish pages individually, including while
// generation is slow or playback is paused. Real Kokoro is verified separately.
function silentWav(seconds=.1) {
  const bytes=Math.floor(seconds*48000);
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  return buffer;
}
async function openBook(page,{webAudio=false}={}) {
  await page.request.post('/api/login', { data: { password: 'browser-test-password' } });
  await page.request.put('/api/preferences',{data:{ambience:'off',ambienceVolume:.25,voiceVolume:1,engine:'kokoro',kokoroVoice:'af_heart',theme:'paper',size:20,line:1.8,font:'serif',width:680,rate:1,voice:''}});
  const result = await page.request.post('/api/books', { data: { title: 'Listening test', description: '', cover: '' } });
  const { id } = await result.json();
  const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. The evening light settled on the hills. A small path wound through the trees, inviting us to follow it somewhere new. We walked quietly, leaving the noise of the day behind.`);
  const source = paragraphs.join('\n\n');
  await page.request.post(`/api/books/${id}/chapters`, { data: { title: 'A long walk', content: source, format: 'txt', position: 1 } });
  await page.request.post(`/api/books/${id}/chapters`, { data: { title: 'Coming home', content: 'The final chapter. We are home at last.', format: 'txt', position: 2 } });
  await page.addInitScript(({webAudio}) => {
    if(!webAudio){Object.defineProperty(window,'AudioContext',{configurable:true,value:undefined});Object.defineProperty(window,'webkitAudioContext',{configurable:true,value:undefined});}
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.wakeRequests=0;window.wakeReleases=0;
    Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async type=>{
      if(type!=='screen')throw Error('Wrong wake-lock type');
      window.wakeRequests++;
      const sentinel=new EventTarget();
      sentinel.release=async()=>{window.wakeReleases++;sentinel.dispatchEvent(new Event('release'));};
      return sentinel;
    }}});
  },{webAudio});
  await page.goto('/');
  await page.locator(`[data-book="${id}"]`).click();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await expect(page.locator('#page-label')).toContainText('1 /');
  return { id, source };
}
async function mockSpeech(page) {
  const requests = [];
  await page.route('**/api/tts', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'audio/wav', body: silentWav() });
  });
  return requests;
}
async function endPage(page, last = false) {
  const audio = page.locator('#audio-controls audio');
  const previous = await audio.getAttribute('src');
  await audio.evaluate(audio => audio.dispatchEvent(new Event('ended')));
  if (!last) await expect.poll(async () => {
    const current = await audio.getAttribute('src');
    return !!current && current.startsWith('blob:') && current !== previous;
  }).toBe(true);
}
async function speechPlan(page, id, startPage = 0) {
  return page.evaluate(async ({id,startPage}) => {
    const { createSpeechSource } = await import('/reading-pages.js');
    const book = await (await fetch('/api/books/' + id)).json();
    const reader = document.querySelector('.reader');
    const source = createSpeechSource(book.chapters,reader,reader.querySelector('.page-window'),chapter => chapter.content.split(/\n\s*\n/).map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join(''));
    const result=[];
    let current=source.at(0,startPage);
    while(current){result.push(current);current=source.next(current);}
    source.dispose();return result;
  },{id,startPage});
}
function horizon(plan, index = 0) {
  let end = index;
  while(end < plan.length && plan[end].endOrdinal <= plan[index].pageOrdinal + 5)end++;
  return end;
}
async function visibleText(page) {
  return page.evaluate(async () => {
    const { extractPageText } = await import('/reading-pages.js');
    const window = document.querySelector('.page-window');
    const bounds = window.getBoundingClientRect();
    return extractPageText(window.querySelector('article'), bounds.left, bounds.right);
  });
}

test('speech prefetch stays five visual pages ahead and refills as playback advances', async ({ page }) => {
  const {id}=await openBook(page);
  const plan=await speechPlan(page,id);
  const requests=await mockSpeech(page);
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(horizon(plan));
  await expect(page.locator('#listen-status')).toHaveText(/Listen mode · \d+s buffered/);
  expect(requests[0].input).toBe(plan[0].text);
  await expect(page.locator('#page-label')).toContainText('1 /');
  await page.waitForTimeout(200);
  expect(requests).toHaveLength(horizon(plan));
  const nextPage=plan.findIndex(unit=>unit.page>0);
  for(let i=0;i<nextPage;i++)await endPage(page);
  await expect(page.locator('#page-label')).toContainText(`${plan[nextPage].page+1} /`);
  await expect.poll(()=>requests.length).toBe(horizon(plan,nextPage));
  expect(requests[nextPage].input).toBe(plan[nextPage].text);
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
  await expect(page.locator('#listen-status')).toHaveText('Ready to listen');
  await expect(page.locator('.listen-measure')).toHaveCount(0);
  await page.locator('audio').evaluate(audio=>audio.dispatchEvent(new Event('ended')));
  await expect(page.locator('#page-label')).toContainText(`${plan[nextPage].page+1} /`);
});

test('automatically enters the next chapter, saves progress, and stops at the end of the book', async ({ page }) => {
  const { id } = await openBook(page);
  const requests = await mockSpeech(page);
  await page.locator('#page-range').evaluate(input => {
    input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const start=Number(await page.locator('#page-range').inputValue());
  const plan=await speechPlan(page,id,start);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => requests.length).toBe(plan.length);
  await expect(page.locator('#audio-controls audio')).toHaveAttribute('src', /^blob:/);
  const chapterTwo=plan.findIndex(unit=>unit.chapter===1);
  for(let i=0;i<chapterTwo;i++)await endPage(page);
  await expect(page.locator('.reading-meta')).toContainText('CHAPTER 2 OF 2');
  await expect(page.locator('#page-label')).toHaveText('1 / 1');
  expect(requests[chapterTwo].input).toBe('The final chapter. We are home at last.');
  await expect.poll(async () => {
    const book = await (await page.request.get(`/api/books/${id}`)).json();
    return book.progress?.chapter_id;
  }).toBe((await (await page.request.get(`/api/books/${id}`)).json()).chapters[1].id);
  await endPage(page,true);
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
  await expect(page.locator('#toast')).toHaveText('You’ve reached the end of the book.');
  expect(requests).toHaveLength(plan.length);
});

test('font and voice changes discard the old queue and regenerate complete sentence units', async ({ page }) => {
  const {id}=await openBook(page);
  const plan=await speechPlan(page,id);
  const requests=await mockSpeech(page);
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(horizon(plan));
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.locator('[data-pref=size]').fill('28');
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await page.locator('[data-pref=kokoroVoice]').selectOption('bf_emma');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
  const updated=await speechPlan(page,id,Number(await page.locator('#page-range').inputValue()));
  const before=requests.length;
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(before+horizon(updated));
  expect(requests[before].input).toBe(updated[0].text);
  expect(requests[before].voice).toBe('bf_emma');
  // Typography changes page positions, not speech-unit text/cache keys.
  expect(updated.map(unit=>unit.text)).toEqual(plan.map(unit=>unit.text));
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeVisible();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
});

test('a resize clears queued audio before changing page boundaries', async ({ page }) => {
  const {id}=await openBook(page);
  const plan=await speechPlan(page,id);
  const requests=await mockSpeech(page);
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(horizon(plan));
  await page.setViewportSize({width:700,height:390});
  await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeVisible();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
});

test('device voices also continue across pages and chapters', async ({ page }) => {
  await page.addInitScript(() => {
    window.mockSpeechQueue = [];
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [],
      speak: utterance => window.mockSpeechQueue.push(utterance),
      cancel: () => { window.mockSpeechQueue.length = 0; },
    } });
  });
  await openBook(page);
  const requests = await mockSpeech(page);
  await page.locator('#page-range').evaluate(input => {
    input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await page.locator('[data-pref=engine]').selectOption('device');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    window.mockSpeechQueue.shift()?.onend();
    return document.querySelector('.reading-meta').textContent;
  })).toContain('CHAPTER 2 OF 2');
  await expect.poll(() => page.evaluate(() => {
    window.mockSpeechQueue.shift()?.onend();
    return document.querySelector('[data-action=speak]').textContent.trim();
  })).toBe('Listen');
  expect(requests).toHaveLength(0);
});

test('page extraction preserves every word and handles inline emphasis and line breaks', async ({ page }) => {
  const { source } = await openBook(page);
  const extracted = await page.evaluate(async () => {
    const { createPageSource } = await import('/reading-pages.js');
    const response = await fetch('/api/books');
    const books = await response.json();
    const book = await (await fetch('/api/books/' + books[0].id)).json();
    const reader = document.querySelector('.reader');
    const viewport = reader.querySelector('.page-window');
    const measurement = createPageSource(book.chapters, reader, viewport, chapter => chapter.content.split(/\n\s*\n/).map(p => `<p>${p}</p>`).join(''));
    const parts = [];
    let current = measurement.at(0, 0);
    do {
      parts.push(current.text);
      current = current.page + 1 < current.pageCount ? measurement.next(current) : null;
    } while (current);
    measurement.dispose();
    const inline = createPageSource([{ id: 'inline' }], reader, viewport, () => '<p>un<strong>break</strong>able<br>second line</p>');
    const inlineText = inline.at(0, 0).text;
    inline.dispose();
    return { text: parts.join(' ').replace(/\s+/g, ' '), inlineText };
  });
  expect(extracted.text).toBe(source.replace(/\s+/g, ' '));
  expect(extracted.inlineText).toBe('unbreakable\nsecond line');
});

test('sentences cross visual pages intact and page tracking does not restart the audio', async ({ page }) => {
  const {id,source}=await openBook(page);
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.locator('[data-pref=size]').fill('36');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const plan=await speechPlan(page,id);
  expect(plan.map(unit=>unit.text).join(' ').replace(/\s+/g,' ')).toBe((source+' The final chapter. We are home at last.').replace(/\s+/g,' '));
  expect(plan.every(unit=>unit.text.endsWith('.'))).toBe(true);
  const cross=plan.findIndex(unit=>unit.endPage>unit.page);
  expect(cross).toBeGreaterThanOrEqual(0);
  const requests=await mockSpeech(page);
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(horizon(plan));
  await expect(page.locator('audio')).toHaveAttribute('src',/^blob:/);
  for(let i=0;i<cross;i++)await endPage(page);
  const audio=page.locator('audio'),url=await audio.getAttribute('src');
  const marker=plan[cross].pageBreaks[1];
  await audio.evaluate((audio,fraction)=>{
    Object.defineProperty(audio,'duration',{configurable:true,value:10});
    Object.defineProperty(audio,'currentTime',{configurable:true,value:fraction*10+.01});
    audio.dispatchEvent(new Event('timeupdate'));
  },marker.fraction);
  await expect(page.locator('#page-label')).toContainText(`${marker.page+1} /`);
  expect(await audio.getAttribute('src')).toBe(url);
  expect(requests[cross].input).toBe(plan[cross].text);
});

test('startup buffering offers Play now when the first group is ready', async ({ page }) => {
  await openBook(page);
  let requests=0,release;
  const nextReady=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/tts',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    requests++;
    if(requests>1)await nextReady;
    await route.fulfill({contentType:'audio/wav',body:silentWav()}).catch(()=>{});
  });
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play now',exact:true})).toBeVisible();
  await expect(page.locator('#listen-status')).toContainText('Building buffer');
  await expect(page.locator('audio')).not.toHaveAttribute('src',/^blob:/);
  await page.getByRole('button',{name:'Play now',exact:true}).click();
  await expect(page.locator('audio')).toHaveAttribute('src',/^blob:/);
  await expect(page.getByRole('button',{name:'Play now',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
  release();
});

test('Kokoro and device voices narrate cleaned prose while chapters stay unchanged', async ({ page }) => {
  const {id}=await openBook(page);
  const raw=String.raw`She \*whispered\*, \"hello\". An un**break**able promise. [Read me](https://example.com).`;
  const expected='She whispered, "hello". An unbreakable promise. Read me.';
  const book=await(await page.request.get(`/api/books/${id}`)).json();
  await page.request.put(`/api/books/${id}/chapters/${book.chapters[0].id}`,{data:{title:'Formatting',content:raw,format:'txt',position:1}});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.locator('[data-action=start]').click();
  const requests=await mockSpeech(page);
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>requests.length).toBeGreaterThan(0);
  expect(requests[0].input).toBe(expected);
  await expect(page.locator('audio')).toHaveAttribute('src',/^blob:/);
  await expect(page.locator('.page-content').first()).toContainText(raw);
  expect((await(await page.request.get(`/api/books/${id}`)).json()).chapters[0].content).toBe(raw);
  await expect.poll(()=>page.evaluate(()=>window.wakeRequests)).toBe(1);
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.wakeReleases)).toBe(1);
  await page.evaluate(()=>{
    window.spoken=[];
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:utterance=>window.spoken.push(utterance.text),cancel:()=>{}}});
  });
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await page.locator('[data-pref=engine]').selectOption('device');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  expect(await page.evaluate(()=>window.spoken[0])).toBe(expected);
  await expect.poll(()=>page.evaluate(()=>window.wakeRequests)).toBe(2);
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.wakeReleases)).toBe(2);
});

test('wake lock is reacquired on return and denial does not interrupt narration', async ({ page }) => {
  await openBook(page);await mockSpeech(page);
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.wakeRequests)).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>window.wakeReleases)).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>window.wakeRequests)).toBe(2);
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.wakeReleases)).toBe(2);
  await page.evaluate(()=>{navigator.wakeLock.request=async()=>{window.wakeRequests++;throw new DOMException('Denied','NotAllowedError');};});
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect(page.locator('audio')).toHaveAttribute('src',/^blob:/);
  await expect(page.locator('#toast')).toContainText('couldn’t keep the screen awake');
  await expect.poll(()=>page.evaluate(()=>window.wakeRequests)).toBe(3);
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
});

test('the reader uses Lucide icons and one settings entry with keyboard-accessible tabs',async({page})=>{
  await openBook(page);
  await expect(page.getByRole('button',{name:'Appearance',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
  await expect(page.locator('.reader button .lucide').first()).toBeVisible();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Reading',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Reading',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Voice',exact:true})).toBeFocused();
  await expect(page.locator('[data-pref=kokoroVoice]')).toBeVisible();
  await expect(page.locator('[data-pref=voice]')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Sounds',exact:true})).toBeFocused();
  await expect(page.getByRole('group',{name:'Background sound'})).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.screenshot({path:'/workspace/readbook-refined-mobile.png'});
});

test('real Web Audio schedules narration ahead, keeps ambience during pause, and saves independent volumes',async({page})=>{
  await page.addInitScript(()=>{
    const Context=window.AudioContext||window.webkitAudioContext;
    window.audioStarts=[];window.audioGains=[];window.audioContexts=[];
    window.AudioContext=class extends Context{
      constructor(...args){super(...args);window.audioContexts.push(this);}
      createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args)=>{window.audioStarts.push({args,loop:source.loop});start(...args);};return source;}
      createGain(){const gain=super.createGain();window.audioGains.push(gain);return gain;}
    };
  });
  const {id}=await openBook(page,{webAudio:true});
  await page.route('**/api/tts',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}await route.fulfill({contentType:'audio/wav',body:silentWav(4)});});
  await page.getByRole('button',{name:'Background sounds',exact:true}).click();
  await page.getByRole('button',{name:/^Rain Soft rainfall/}).click();
  await expect(page.locator('.sound-state')).toHaveText('Playing rain');
  await page.locator('[data-mixer=ambienceVolume]').fill('0.2');
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await page.locator('[data-mixer=voiceVolume]').fill('0.6');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause narration',exact:true})).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>window.audioStarts.filter(source=>!source.loop&&source.args.length===3).length)).toBeGreaterThanOrEqual(2);
  const starts=await page.evaluate(()=>window.audioStarts.filter(source=>!source.loop&&source.args.length===3).slice(0,2).map(source=>source.args));
  expect(starts[1][0]).toBeCloseTo(starts[0][0]+starts[0][2],4);
  await page.getByRole('button',{name:'Pause narration',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume narration',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.audioContexts[0].state)).toBe('running');
  await expect(page.locator('.sound-indicator')).toBeVisible();
  await expect.poll(async()=>{const p=await(await page.request.get('/api/preferences')).json();return [p.ambience,p.ambienceVolume,p.voiceVolume];}).toEqual(['rain',.2,.6]);
  const volumes=await page.evaluate(()=>window.audioGains.slice(0,2).map(gain=>gain.gain.value));
  expect(volumes[0]).toBeCloseTo(.6,1);expect(volumes[1]).toBeCloseTo(.12,1);
  await page.getByRole('button',{name:'Resume narration',exact:true}).click();
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
  await expect(page.locator('.sound-indicator')).toBeVisible();
  await page.getByRole('button',{name:/^Background sounds/}).click();
  await page.getByRole('button',{name:/^Forest Leaves/}).click();
  await expect(page.locator('.sound-state')).toHaveText('Playing forest');
  await page.getByRole('button',{name:/^Water Flowing/}).click();
  await expect(page.locator('.sound-state')).toHaveText('Playing water');
  await page.screenshot({path:'/workspace/readbook-sounds-mobile.png'});
  await page.getByRole('button',{name:'Pause background',exact:true}).click();
  await expect(page.locator('.sound-state')).toHaveText('Background paused');
  await page.getByRole('button',{name:'Play background',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Continue reading',exact:true}).click();
  await expect(page.locator('.sound-indicator')).toBeHidden();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your library',exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'/workspace/readbook-refined-desktop.png'});
});

test('background sound fallback is clear and does not break native narration',async({page})=>{
  await openBook(page);const requests=await mockSpeech(page);
  await page.getByRole('button',{name:'Background sounds',exact:true}).click();
  await page.getByRole('button',{name:/^Rain Soft rainfall/}).click();
  await expect(page.locator('#toast')).toContainText('Background sounds aren’t supported');
  await expect(page.locator('.sound-state')).toHaveText('Background paused');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Listen',exact:true}).click();
  await expect(page.locator('audio')).toHaveAttribute('src',/^blob:/);
  await expect.poll(()=>requests.length).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Pause narration',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume narration',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Resume narration',exact:true}).click();
  await page.getByRole('button',{name:'Stop listening',exact:true}).click();
});

test('reading settings fit a narrow phone and retain night-theme contrast',async({page})=>{
  await openBook(page);
  await page.setViewportSize({width:320,height:740});
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('button',{name:'night theme',exact:true}).click();
  await expect(page.locator('dialog')).toHaveAttribute('data-theme','night');
  const bounds=await page.locator('dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);
  await page.getByRole('tab',{name:'Voice',exact:true}).click();
  await expect(page.locator('[data-pref=kokoroVoice]')).toBeVisible();
  expect(await page.evaluate(()=>document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth)).toBe(true);
  await page.screenshot({path:'/workspace/readbook-night-mobile.png'});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.reader')).toHaveAttribute('data-theme','night');
});
