import { ListenSession } from './listen-session.js';
import { createPageSource } from './reading-pages.js';
const $=(s,r=document)=>r.querySelector(s);
const app=$('#app'),modal=$('#modal');
let books=[],book=null,chapterIndex=0,page=0,pages=1,reading=false,query='',filter='all',speaking=false,speechGeneration=0;
let ttsAvailable=false,listenSession=null,pageSource=null;
let prefs={engine:'kokoro',kokoroVoice:'af_heart',theme:'paper',size:20,line:1.8,font:'serif',width:680,rate:1,voice:''};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={book:'▤',plus:'＋',back:'←',next:'→',settings:'Aa',close:'×',play:'▷',pause:'Ⅱ',menu:'☰',edit:'✎'};
function button(label,action,cls='',symbol=''){return `<button class="${cls}" data-action="${action}">${symbol?`<span aria-hidden="true">${symbol}</span> `:''}${label}</button>`;}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
async function api(url,method='GET',data){const r=await fetch('/api'+url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();if(!r.ok){if(r.status===401&&url!=='/login')login();throw Error(b.error||'Request failed');}return b;}
function login(){stopSpeech();reading=false;document.body.className='';app.innerHTML=`<main class="gate"><form id="login"><label class="sr" for="password">Password</label><div class="password-wrap"><input id="password" type="password" name="password" placeholder="Password" autocomplete="current-password" required aria-describedby="login-error"><button aria-label="Unlock" type="submit">→</button></div><p id="login-error" role="alert"></p></form></main>`;$('#login').onsubmit=async e=>{e.preventDefault();const b=$('button',e.target);b.disabled=true;try{await api('/login','POST',{password:$('#password').value});await load();}catch(e){$('#login-error').textContent=e.message;}finally{b.disabled=false;}};}
function cover(b,cls=''){return `<div class="cover ${cls}" style="--hue:${[...b.title].reduce((n,c)=>n+c.charCodeAt(0),0)%100+85}">${b.cover?`<img src="${esc(b.cover)}" alt="Cover of ${esc(b.title)}">`:`<span class="cover-top">THE PERSONAL LIBRARY</span><strong>${esc(b.title)}</strong><span class="cover-bottom">READBOOK · ${icons.book}</span>`}</div>`;}
async function load(){prefs={...prefs,...await api('/preferences')};ttsAvailable=(await api('/tts')).available;books=await api('/books');library();}
function library(){reading=false;stopSpeech();document.body.className='';const visible=books.filter(b=>b.title.toLowerCase().includes(query.toLowerCase())&&(filter!=='reading'||b.chapter_id));const continuing=books.find(b=>b.chapter_id);app.innerHTML=`<div class="shell"><header class="topbar"><a href="/" class="brand">${icons.book} <span>readbook<span class="brand-dot">.</span></span></a><div class="top-actions"><span class="private-label">YOUR PRIVATE SHELF</span>${button('Lock library','logout','quiet')}</div></header><main><div class="eyebrow">A LITTLE SPACE FOR YOUR STORIES</div><div class="title-row"><div><h1>Your library</h1><p class="muted">Somewhere to get lost. Something to come back to.</p></div>${button('New book','new-book','primary',icons.plus)}</div>${continuing&&!query?`<section class="continue"><div class="continue-copy"><span class="eyebrow">RIGHT WHERE YOU LEFT OFF</span><h2>${esc(continuing.title)}</h2><p class="muted">Your next quiet moment is a page away.</p><button class="primary" data-read="${continuing.id}">Continue reading <span aria-hidden="true">→</span></button></div>${cover(continuing,'mini')}</section>`:''}<div class="shelf-toolbar"><div class="tabs"><button class="${filter==='all'?'active':''}" data-filter="all">All books <span>${books.length}</span></button><button class="${filter==='reading'?'active':''}" data-filter="reading">In progress</button></div><label class="search"><span aria-hidden="true">⌕</span><input id="search" placeholder="Find a book" aria-label="Find a book" value="${esc(query)}"></label></div><div class="books">${visible.map(b=>`<button class="book-card" data-book="${b.id}">${cover(b)}<h3>${esc(b.title)}</h3><p>${b.chapters} chapter${b.chapters===1?'':'s'} <span>· ${b.chapter_id?'In progress':'Unread'}</span></p></button>`).join('')}</div>${!visible.length?`<div class="empty"><span class="empty-icon">${icons.book}</span><h2>${books.length?'No books found':'A shelf full of possibilities'}</h2><p class="muted">${books.length?'Try another title.':'Add your first book, bring in a chapter, and settle in.'}</p>${!books.length?button('Add your first book','new-book','primary',icons.plus):''}</div>`:''}</main><footer>MADE FOR SLOWER MOMENTS <span>One page at a time.</span></footer></div>`;
$('#search').oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;library();$('#search').focus();$('#search').setSelectionRange(pos,pos);};}
function show(html){modal.innerHTML=html;modal.showModal();}
function formHead(title){return `<div class="dialog-head"><h2>${title}</h2>${button('Close','close','icon',icons.close)}</div>`;}
function bookForm(existing){show(`<form id="book-form">${formHead(existing?'Edit book':'A new addition')}<label>Title<input name="title" required maxlength="200" value="${esc(existing?.title||'')}" placeholder="Give your book a title"></label><label>Description<textarea name="description" rows="4" maxlength="5000" placeholder="A few words about this book…">${esc(existing?.description||'')}</textarea></label><label>Cover image <span class="muted">PNG, JPEG or WebP · up to 4 MB</span><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="cover-preview">${existing?.cover?'<p class="muted">Current cover will be kept unless replaced or removed.</p>':''}</div><label class="checkbox"><input name="remove" type="checkbox"> Use a typographic cover</label><p class="form-error" role="alert"></p><button class="primary" type="submit">${existing?'Save changes':'Create book'}</button></form>`);$('#book-form').onsubmit=async e=>{e.preventDefault();const f=e.target,submit=$('button[type=submit]',f);submit.disabled=true;try{let image=existing?.cover||'';const file=$('#cover-file').files[0];if(file){if(file.size>4*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP smaller than 4 MB.');image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}if(f.elements.remove.checked)image='';const data={title:f.elements.title.value,description:f.elements.description.value,cover:image};const result=await api(existing?'/books/'+existing.id:'/books',existing?'PUT':'POST',data);modal.close();books=await api('/books');await detail(existing?.id||result.id);toast(existing?'Book updated':'Your book is on the shelf');}catch(e){$('.form-error',f).textContent=e.message;}finally{submit.disabled=false;}};}
async function detail(id){stopSpeech();reading=false;book=await api('/books/'+id);document.body.className='';app.innerHTML=`<div class="shell"><header class="topbar">${button('Library','library','quiet',icons.back)}<span class="brand">readbook.</span>${button('Edit book','edit-book','quiet',icons.edit)}</header><main><section class="book-detail">${cover(book)}<div><div class="eyebrow">FROM YOUR LIBRARY</div><h1>${esc(book.title)}</h1><p class="description">${esc(book.description)||'A story waiting to be read.'}</p><p class="muted">${book.chapters.length} chapters · ${Math.ceil(book.chapters.reduce((n,c)=>n+c.content.split(/\s+/).length,0)/220)} min read</p><div class="actions">${book.chapters.length?button(book.progress?'Continue reading':'Start reading','start','primary',icons.play):''}${button('Add chapter','add-chapter','secondary',icons.plus)}</div></div></section><div class="section-heading"><h2>Chapters</h2><span class="muted">In reading order</span></div><div class="chapter-list">${book.chapters.map((c,i)=>`<div class="chapter-row"><button class="chapter-open" data-chapter="${i}"><span class="chapter-number">${String(i+1).padStart(2,'0')}</span><span>${esc(c.title)}<small>${Math.ceil(c.content.split(/\s+/).length/220)} min read</small></span></button><button class="icon" aria-label="Edit ${esc(c.title)}" data-edit-chapter="${c.id}">✎</button></div>`).join('')||'<div class="empty"><h2>Every story starts somewhere</h2><p class="muted">Upload a TXT or Markdown file to add your first chapter.</p></div>'}</div><div class="danger-zone">${button('Delete book','delete-book','danger')}</div></main></div>`;}
function chapterForm(c){show(`<form id="chapter-form">${formHead(c?'Edit chapter':'Add a chapter')}<label>Chapter title<input name="title" required maxlength="200" value="${esc(c?.title||'')}" placeholder="Chapter title"></label><label>Order<input name="position" type="number" min="1" max="100000" required value="${c?.position||Math.max(0,...book.chapters.map(c=>c.position))+1}"></label><label>${c?'Replace from file':'Upload chapter'}<input id="chapter-file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" ${c?'':'required'}></label><label>Chapter text<textarea name="content" rows="10" ${c?'required':''} placeholder="Your uploaded text will appear here…">${esc(c?.content||'')}</textarea></label><p class="muted">TXT or Markdown · up to 2 MB. Chapters with the same order are sorted by their identifier; use unique orders for a precise sequence.</p><p class="form-error" role="alert"></p><div class="actions"><button class="primary" type="submit">Save chapter</button>${c?`<button class="danger" type="button" data-delete-chapter="${c.id}">Delete chapter</button>`:''}</div></form>`);let format=c?.format||'txt';$('#chapter-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>2000000||! /\.(txt|md|markdown)$/i.test(file.name)){$('.form-error',modal).textContent='Choose a TXT or Markdown file under 2 MB.';e.target.value='';return;}format=/\.(md|markdown)$/i.test(file.name)?'md':'txt';$('#chapter-form').elements.content.value=await file.text();if(!$('#chapter-form').elements.title.value)$('#chapter-form').elements.title.value=file.name.replace(/\.[^.]+$/,'');};$('#chapter-form').onsubmit=async e=>{e.preventDefault();const f=e.target,btn=$('button[type=submit]',f);btn.disabled=true;try{await api(`/books/${book.id}/chapters${c?'/'+c.id:''}`,c?'PUT':'POST',{title:f.elements.title.value,position:Number(f.elements.position.value),content:f.elements.content.value,format});modal.close();await detail(book.id);toast('Chapter saved');}catch(e){$('.form-error',f).textContent=e.message;}finally{btn.disabled=false;}};}
function markdown(content){return content.split(/\n\s*\n/).map(block=>{let s=esc(block);if(/^#{1,6} /.test(s)){const m=s.match(/^(#{1,6}) ([\s\S]*)/);return `<h${m[1].length}>${m[2]}</h${m[1].length}>`;}s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');if(s.startsWith('&gt; '))return `<blockquote>${s.replace(/^&gt; /gm,'')}</blockquote>`;return `<p>${s.replace(/\n/g,'<br>')}</p>`;}).join('');}
function chapterHTML(c){return c.format==='md'?markdown(c.content):c.content.split(/\n\s*\n/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');}
function stopSpeech(){
  speechGeneration++;
  speaking=false;
  listenSession?.stop();listenSession=null;
  pageSource?.dispose();pageSource=null;
  window.speechSynthesis?.cancel();
  const audio=$('#audio-controls audio');
  if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
  const controls=$('#audio-controls');if(controls)controls.hidden=true;
  const status=$('#listen-status');if(status)status.textContent='';
  const b=$('[data-action="speak"]');if(b)b.innerHTML='<span aria-hidden="true">▷</span> Listen';
}
function startReader(index,offset=0){stopSpeech();chapterIndex=index;page=0;reading=true;document.body.className='reader-mode';const c=book.chapters[index];app.innerHTML=`<main class="reader" data-theme="${esc(prefs.theme)}"><header class="reader-header">${button('Back','detail','quiet',icons.back)}<span>${esc(book.title)}</span><div>${button('Chapters','contents','icon',icons.menu)}${button('Appearance','settings','icon','Aa')}</div></header><div class="reading-meta">CHAPTER ${index+1} OF ${book.chapters.length} <span>·</span> ${esc(c.title)}</div><div class="page-window" tabindex="0" aria-label="Book pages"><article class="page-content">${chapterHTML(c)}</article></div><footer class="reader-footer"><div id="audio-controls" hidden><audio controls preload="auto" aria-label="Read-aloud playback"></audio></div><div id="listen-status" role="status" aria-live="polite"></div><div class="reader-tools">${button('Listen','speak','quiet',icons.play)}<span id="page-label" aria-live="polite"></span>${button('Settings','settings','quiet','Aa')}</div><div class="page-controls">${button('Previous page','prev','icon',icons.back)}<input type="range" id="page-range" min="0" max="1" value="0" aria-label="Reading page">${button('Next page','next','icon',icons.next)}</div></footer></main>`;applyPrefs();requestAnimationFrame(()=>paginate(offset));$('#page-range').oninput=e=>{stopSpeech();page=Number(e.target.value);updatePage();};let touchX=0,touchY=0;$('.page-window').ontouchstart=e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY;};$('.page-window').ontouchend=e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)turn(dx<0?1:-1);};}
function applyPrefs(){const r=$('.reader');if(!r)return;r.dataset.theme=['paper','white','night','sage'].includes(prefs.theme)?prefs.theme:'paper';r.style.setProperty('--font-size',Math.min(36,Math.max(14,Number(prefs.size)||20))+'px');r.style.setProperty('--line',Math.min(2.4,Math.max(1.3,Number(prefs.line)||1.8)));r.style.setProperty('--reading-font',prefs.font==='sans'?'Arial, sans-serif':'Georgia, serif');r.style.setProperty('--reading-width',Math.min(900,Math.max(340,Number(prefs.width)||680))+'px');}
function paginate(offset){if(!reading)return;const win=$('.page-window'),content=$('.page-content');const w=win.clientWidth;content.style.columnWidth=w+'px';content.style.height=win.clientHeight+'px';pages=Math.max(1,Math.round((content.scrollWidth+40)/(w+40)));page=Math.min(pages-1,Math.round((offset??page/Math.max(1,pages-1))*(pages-1)));updatePage();}
function updatePage(){if(!reading)return;$('.page-content').style.transform=`translateX(-${page*($('.page-window').clientWidth+40)}px)`;$('#page-label').textContent=`${page+1} / ${pages}`;const range=$('#page-range');range.max=pages-1;range.value=page;$('[data-action="prev"]').disabled=page===0&&chapterIndex===0;$('[data-action="next"]').disabled=page===pages-1&&chapterIndex===book.chapters.length-1;const progress={chapter_id:book.chapters[chapterIndex].id,offset:pages>1?page/(pages-1):0};book.progress=progress;clearTimeout(updatePage.timer);const currentBookId=book.id;updatePage.timer=setTimeout(()=>api('/books/'+currentBookId+'/progress','PUT',progress).catch(e=>toast(e.message)),200);}
function turn(direction){stopSpeech();if(direction>0&&page===pages-1){if(chapterIndex<book.chapters.length-1)startReader(chapterIndex+1);return;}if(direction<0&&page===0){if(chapterIndex>0)startReader(chapterIndex-1,1);return;}page=Math.max(0,Math.min(pages-1,page+direction));updatePage();}
function settings(){const voices=window.speechSynthesis?.getVoices()||[];show(`${formHead('Make yourself comfortable')}<div class="settings"><label>Page colour</label><div class="theme-options">${['paper','white','sage','night'].map(t=>`<button data-theme-choice="${t}" class="swatch ${t} ${prefs.theme===t?'selected':''}" aria-label="${t} theme" aria-pressed="${prefs.theme===t}">${t}</button>`).join('')}</div><label>Text size <output id="size-output">${prefs.size}px</output><input data-pref="size" type="range" min="14" max="36" step="1" value="${prefs.size}"></label><label>Line spacing<input data-pref="line" type="range" min="1.3" max="2.4" step="0.1" value="${prefs.line}"></label><label>Typeface<select data-pref="font"><option value="serif" ${prefs.font==='serif'?'selected':''}>Literary · Georgia</option><option value="sans" ${prefs.font==='sans'?'selected':''}>Clean · Arial</option></select></label><label>Reading width<input data-pref="width" type="range" min="340" max="900" step="20" value="${prefs.width}"></label><hr><label>Read-aloud voice source<select data-pref="engine"><option value="device" ${prefs.engine==='device'?'selected':''}>Device voices</option><option value="kokoro" ${prefs.engine==='kokoro'?'selected':''} ${ttsAvailable?'':'disabled'}>Kokoro · built in ${ttsAvailable?'':'(not configured)'}</option></select></label><label>Kokoro voice<select data-pref="kokoroVoice">${[['af_heart','Heart · US female'],['af_bella','Bella · US female'],['af_sky','Sky · US female'],['am_michael','Michael · US male'],['am_adam','Adam · US male'],['bf_emma','Emma · UK female'],['bf_isabella','Isabella · UK female'],['bm_george','George · UK male'],['bm_fable','Fable · UK male']].map(([id,label])=>`<option value="${id}" ${prefs.kokoroVoice===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Read-aloud speed <output id="rate-output">${prefs.rate}×</output><input data-pref="rate" type="range" min="0.5" max="2" step="0.1" value="${prefs.rate}"></label><label>Device voice<select data-pref="voice"><option value="">Device default</option>${voices.map(v=>`<option value="${esc(v.voiceURI)}" ${v.voiceURI===prefs.voice?'selected':''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label><p class="muted">Kokoro is built into Readbook and generates speech on your private server. The first use downloads the model and can take a few minutes. Device voices use your browser. Voice availability and background playback depend on your device. Keep this page open while listening.</p></div>`);}
let preferenceTimer;
function savePrefs(){clearTimeout(preferenceTimer);preferenceTimer=setTimeout(()=>api('/preferences','PUT',prefs).catch(e=>toast(e.message)),200);}
function showListeningPage(position){
  if(position.chapter!==chapterIndex){
    chapterIndex=position.chapter;
    $('.page-content').innerHTML=chapterHTML(book.chapters[chapterIndex]);
    $('.reading-meta').innerHTML=`CHAPTER ${chapterIndex+1} OF ${book.chapters.length} <span>·</span> ${esc(book.chapters[chapterIndex].title)}`;
    paginate(0);
  }
  page=position.page;
  updatePage();
}
function listeningState(state){
  const b=$('[data-action="speak"]');if(b)b.textContent='Stop listening';
  const status=$('#listen-status');
  if(status)status.textContent=state.loading?'Preparing audio…':`Listen mode · ${state.aheadReady} page${state.aheadReady===1?'':'s'} ready ahead`;
}
function waitForRetry(ms,signal){
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
}
async function generatePageAudio(position,signal){
  if(!position.text)return null;
  // Another tab may still be releasing its worker. Retry busy responses rather
  // than skipping a page or letting speculative generation interrupt playback.
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();
    let response;
    try{
      response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:position.text,voice:prefs.kokoroVoice,speed:Number(prefs.rate)||1}),signal});
    }catch(error){
      if(signal.aborted||attempt>=3)throw error;
      await waitForRetry(1000*(attempt+1),signal);continue;
    }
    if(response.status===429&&attempt<30){await response.body?.cancel();await waitForRetry(1000,signal);continue;}
    if(!response.ok){const data=await response.json();throw Error(data.error||'Could not generate speech.');}
    return response.blob();
  }
}
function playPageAudio(blob,signal){
  if(!blob)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const audio=$('#audio-controls audio');
    const url=URL.createObjectURL(blob);
    let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;
      audio.removeEventListener('ended',ended);audio.removeEventListener('error',failed);
      signal.removeEventListener('abort',aborted);
      audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
      error?reject(error):resolve();
    };
    const ended=()=>finish();
    const failed=()=>finish(Error('Could not play audio. Try device voices.'));
    const aborted=()=>finish(signal.reason);
    audio.addEventListener('ended',ended,{once:true});audio.addEventListener('error',failed,{once:true});
    signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted){aborted();return;}
    audio.src=url;$('#audio-controls').hidden=false;
    audio.play().catch(()=>{if(!signal.aborted)toast('Tap Play in the audio controls to continue listening.');});
  });
}
function speakDevicePage(position,generation){
  if(!speaking||generation!==speechGeneration)return;
  if(!position){stopSpeech();toast('You’ve reached the end of the book.');return;}
  showListeningPage(position);
  const chunks=position.text.match(/[^.!?]+[.!?]*\s*/g)||[];
  let index=0;
  const next=()=>{
    if(!speaking||generation!==speechGeneration)return;
    if(index>=chunks.length){
      const upcoming=pageSource.next(position);
      // Yield between empty pages rather than recursively traversing chapters.
      setTimeout(()=>speakDevicePage(upcoming,generation),0);return;
    }
    const utterance=new SpeechSynthesisUtterance(chunks[index++]);
    utterance.rate=Number(prefs.rate)||1;
    utterance.voice=speechSynthesis.getVoices().find(v=>v.voiceURI===prefs.voice)||null;
    utterance.onend=next;
    utterance.onerror=()=>{if(generation===speechGeneration){stopSpeech();toast('Read-aloud stopped. Try another voice.');}};
    speechSynthesis.speak(utterance);
  };
  $('[data-action="speak"]').textContent='Stop listening';
  $('#listen-status').textContent='Listen mode · device voice';
  next();
}
function speak(){
  if(speaking){stopSpeech();return;}
  if(prefs.engine!=='kokoro'&&!('speechSynthesis' in window)){toast('Device voices are not supported in this browser.');return;}
  try{
    pageSource=createPageSource(book.chapters,$('.reader'),$('.page-window'),chapterHTML);
    const current=pageSource.at(chapterIndex,page);
    speaking=true;const generation=++speechGeneration;
    if(prefs.engine!=='kokoro'){speakDevicePage(current,generation);return;}
    listenSession=new ListenSession({
      nextPage:position=>pageSource.next(position),
      generate:generatePageAudio,
      play:playPageAudio,
      onPage:showListeningPage,
      onState:listeningState,
      onComplete:()=>{stopSpeech();toast('You’ve reached the end of the book.');},
      onError:error=>{stopSpeech();toast(error.message);},
    });
    listenSession.start(current);
  }catch(error){stopSpeech();toast(error.message);}
}
app.addEventListener('click',handleClick);modal.addEventListener('click',handleClick);
async function handleClick(e){const b=e.target.closest('button');if(!b||b.disabled)return;try{if(b.dataset.book){await detail(b.dataset.book);return;}if(b.dataset.read){book=await api('/books/'+b.dataset.read);resume();return;}if(b.dataset.filter){filter=b.dataset.filter;library();return;}if(b.dataset.chapter!==undefined){startReader(Number(b.dataset.chapter));return;}if(b.dataset.editChapter){chapterForm(book.chapters.find(c=>c.id===b.dataset.editChapter));return;}if(b.dataset.deleteChapter){if(confirm('Delete this chapter? This cannot be undone.')){await api(`/books/${book.id}/chapters/${b.dataset.deleteChapter}`,'DELETE',{});modal.close();await detail(book.id);}return;}if(b.dataset.themeChoice){stopSpeech();prefs.theme=b.dataset.themeChoice;applyPrefs();savePrefs();modal.close();settings();return;}switch(b.dataset.action){case'close':modal.close();break;case'new-book':bookForm();break;case'edit-book':bookForm(book);break;case'add-chapter':chapterForm();break;case'library':books=await api('/books');library();break;case'logout':await api('/logout','POST',{});login();break;case'detail':await detail(book.id);break;case'delete-book':if(confirm(`Delete “${book.title}” and all its chapters? This cannot be undone.`)){await api('/books/'+book.id,'DELETE',{});books=await api('/books');library();}break;case'start':resume();break;case'prev':turn(-1);break;case'next':turn(1);break;case'settings':settings();break;case'speak':speak();break;case'contents':show(`${formHead('Chapters')}<div class="contents">${book.chapters.map((c,i)=>`<button data-jump="${i}" class="${i===chapterIndex?'selected':''}">${String(i+1).padStart(2,'0')} <span>${esc(c.title)}</span></button>`).join('')}</div>`);break;}if(b.dataset.jump!==undefined){modal.close();startReader(Number(b.dataset.jump));}}catch(e){toast(e.message);}}
function resume(){if(!book.chapters.length)return;const i=book.chapters.findIndex(c=>c.id===book.progress?.chapter_id);startReader(Math.max(0,i),i>=0?book.progress.offset:0);}
modal.addEventListener('input',e=>{const key=e.target.dataset.pref;if(!key)return;const offset=page/Math.max(1,pages-1);prefs[key]=['font','voice','engine','kokoroVoice'].includes(key)?e.target.value:Number(e.target.value);if(key==='rate')$('#rate-output').textContent=prefs.rate+'×';if(key==='size')$('#size-output').textContent=prefs.size+'px';stopSpeech();applyPrefs();requestAnimationFrame(()=>paginate(offset));savePrefs();});
window.addEventListener('keydown',e=>{if(!reading||modal.open||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='ArrowRight'){e.preventDefault();turn(1);}if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}});
let resizeTimer;window.addEventListener('resize',()=>{if(!reading)return;const offset=page/Math.max(1,pages-1);stopSpeech();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>paginate(offset),100);});
window.addEventListener('pagehide',stopSpeech);
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
api('/session').then(s=>s.authenticated?load():login()).catch(()=>{app.innerHTML='<main class="gate"><p>Could not reach your library. Refresh to try again.</p></main>';});
