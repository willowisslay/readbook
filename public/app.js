import { ListenSession } from './listen-session.js';
import { createSpeechSource } from './reading-pages.js';
import { cleanSpeechText, prepareSpeechText } from './speech-text.js';
import { ListeningWakeLock } from './listening-wake-lock.js';
import { icon } from './icons.js';
import { SoundMixer } from './sound-mixer.js';
import { NarrationPlayer } from './narration-player.js';
import { renderChapter, renderMarkdown } from './markdown.js';
import { markdownAction } from './editor-actions.js';
import { applyAppearance, themes, fonts, appearanceDefaults } from './appearance.js';
const $=(s,r=document)=>r.querySelector(s);
const app=$('#app'),modal=$('#modal');
const listeningWakeLock=new ListeningWakeLock({onUnavailable:()=>toast('Your browser couldn’t keep the screen awake. Check your screen timeout setting.')});
let books=[],book=null,chapterIndex=0,page=0,pages=1,reading=false,query='',filter='all',speaking=false,speechGeneration=0;
let ttsAvailable=false,listenSession=null,pageSource=null;
let settingsTab='reading',legacyPaused=false,deviceUtterance=null,lastSpeechState=null,lastTimeline={fraction:0,duration:0},dialogOrigin=null,dialogGeneration=0;
const mixer=new SoundMixer({onChange:()=>{refreshSoundControls();refreshPlaybackControls();}});
const narration=new NarrationPlayer(mixer,{onState:refreshPlaybackControls,onProgress:followNarration});
let prefs={...appearanceDefaults,ambience:'off',ambienceVolume:.25,voiceVolume:1,engine:'kokoro',kokoroVoice:'af_heart',rate:1,voice:''};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons=Object.fromEntries(Object.entries({book:'book-open',plus:'plus',back:'arrow-left',next:'arrow-right',settings:'sliders-horizontal',close:'x',play:'play',pause:'pause',menu:'list',edit:'pencil',trash:'trash',headphones:'headphones',rain:'cloud-rain',forest:'trees',water:'waves-horizontal',volume:'volume-2',mute:'volume-x',search:'search',lock:'lock-keyhole',stop:'square'}).map(([key,name])=>[key,icon(name)]));
function button(label,action,cls='',symbol=''){
  const only=cls.split(' ').includes('icon');
  return `<button type="button" class="${cls}" data-action="${action}" ${only?`aria-label="${label}" title="${label}"`:''}>${symbol||''}<span class="button-label ${only?'sr':''}">${label}</span></button>`;
}
function setButton(button,label,symbol,only=false){
  if(!button)return;
  button.setAttribute('aria-label',label);
  button.innerHTML=(symbol||'')+`<span class="button-label ${only?'sr':''}">${label}</span>`;
}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
async function api(url,method='GET',data){const r=await fetch('/api'+url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();if(!r.ok){if(r.status===401&&url!=='/login')login();throw Error(b.error||'Request failed');}return b;}
function login(){mixer.stopBackground();stopSpeech();reading=false;document.body.className='';app.innerHTML=`<main class="gate"><form id="login"><label class="sr" for="password">Password</label><div class="password-wrap"><input id="password" type="password" name="password" placeholder="Password" autocomplete="current-password" required aria-describedby="login-error"><button aria-label="Unlock" type="submit">${icons.next}</button></div><p id="login-error" role="alert"></p></form></main>`;$('#login').onsubmit=async e=>{e.preventDefault();const b=$('button',e.target);b.disabled=true;try{await api('/login','POST',{password:$('#password').value});await load();}catch(e){$('#login-error').textContent=e.message;}finally{b.disabled=false;}};}
function cover(b,cls=''){return `<div class="cover ${cls}" style="--hue:${[...b.title].reduce((n,c)=>n+c.charCodeAt(0),0)%100+85}">${b.cover?`<img src="${esc(b.cover)}" alt="Cover of ${esc(b.title)}">`:`<span class="cover-top">THE PERSONAL LIBRARY</span><strong>${esc(b.title)}</strong><span class="cover-bottom">READBOOK · ${icons.book}</span>`}</div>`;}
async function load(){prefs={...prefs,...await api('/preferences')};ttsAvailable=(await api('/tts')).available;mixer.setVolume('voice',prefs.voiceVolume);mixer.setVolume('background',prefs.ambienceVolume);books=await api('/books');library();}
function library(){mixer.stopBackground();reading=false;stopSpeech();document.body.className='';const visible=books.filter(b=>b.title.toLowerCase().includes(query.toLowerCase())&&(filter!=='reading'||b.chapter_id));const continuing=books.find(b=>b.chapter_id);app.innerHTML=`<div class="shell"><header class="topbar"><a href="/" class="brand">${icons.book} <span>readbook<span class="brand-dot">.</span></span></a><div class="top-actions">${button('Lock library','logout','quiet',icons.lock)}</div></header><main><div class="title-row"><div><h1>Your library</h1></div>${button('New book','new-book','primary',icons.plus)}</div>${continuing&&!query?`<section class="continue"><div class="continue-copy"><span class="eyebrow">RIGHT WHERE YOU LEFT OFF</span><h2>${esc(continuing.title)}</h2><button class="primary" data-read="${continuing.id}">Continue reading ${icons.next}</button></div>${cover(continuing,'mini')}</section>`:''}<div class="shelf-toolbar"><div class="tabs"><button class="${filter==='all'?'active':''}" data-filter="all">All books <span>${books.length}</span></button><button class="${filter==='reading'?'active':''}" data-filter="reading">In progress</button></div><label class="search">${icons.search}<input id="search" placeholder="Find a book" aria-label="Find a book" value="${esc(query)}"></label></div><div class="books">${visible.map(b=>`<button class="book-card" data-book="${b.id}">${cover(b)}<h3>${esc(b.title)}</h3><p>${b.chapters} chapter${b.chapters===1?'':'s'} <span>· ${b.chapter_id?'In progress':'Unread'}</span></p></button>`).join('')}</div>${!visible.length?`<div class="empty"><span class="empty-icon">${icons.book}</span><h2>${books.length?'No books found':'A shelf full of possibilities'}</h2><p class="muted">${books.length?'Try another title.':'Add your first book, bring in a chapter, and settle in.'}</p>${!books.length?button('Add your first book','new-book','primary',icons.plus):''}</div>`:''}</main></div>`;
$('#search').oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;library();$('#search').focus();$('#search').setSelectionRange(pos,pos);};}
function motion(element,frames,duration=180){
  if(!element?.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve();
  return element.animate(frames,{duration,easing:'cubic-bezier(.2,.8,.2,1)'}).finished.catch(()=>{});
}
function show(html){
  const opened=modal.open;dialogGeneration++;modal.inert=false;modal.removeAttribute('aria-hidden');
  if(!opened)dialogOrigin=document.activeElement;
  modal.getAnimations?.().forEach(animation=>animation.cancel());
  modal.classList.toggle('settings-dialog',html.includes('class="settings-tabs"'));
  modal.classList.toggle('chapter-dialog',html.includes('id="chapter-form"'));
  applyAppearance(modal,reading?prefs:{...prefs,theme:'paper',customColors:false});
  modal.innerHTML=html;
  if(!opened){modal.showModal();void motion(modal,[{opacity:0,transform:'translateY(20px)'},{opacity:1,transform:'translateY(0)'}],220);}
  else void motion($('#settings-panel')||$('.editor-pane'),[{opacity:.35,transform:'translateY(4px)'},{opacity:1,transform:'none'}],140);
}
async function closeModal(){
  if(!modal.open)return;
  const generation=++dialogGeneration;
  if(modal.contains(document.activeElement))document.activeElement.blur();modal.inert=true;modal.setAttribute('aria-hidden','true');
  await motion(modal,[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(12px)'}],140);
  if(generation!==dialogGeneration)return;
  modal.close();modal.inert=false;modal.removeAttribute('aria-hidden');if(dialogOrigin?.isConnected)dialogOrigin.focus();
}
function formHead(title){return `<div class="dialog-head"><h2>${title}</h2>${button('Close','close','icon',icons.close)}</div>`;}
function bookForm(existing){show(`<form id="book-form">${formHead(existing?'Edit book':'A new addition')}<label>Title<input name="title" required maxlength="200" value="${esc(existing?.title||'')}" placeholder="Give your book a title"></label><label>Description<textarea name="description" rows="4" maxlength="5000" placeholder="A few words about this book…">${esc(existing?.description||'')}</textarea></label><label>Cover image <span class="muted">PNG, JPEG or WebP · up to 4 MB</span><input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="cover-preview">${existing?.cover?'<p class="muted">Current cover will be kept unless replaced or removed.</p>':''}</div><label class="checkbox"><input name="remove" type="checkbox"> Use a typographic cover</label><p class="form-error" role="alert"></p><button class="primary" type="submit">${existing?'Save changes':'Create book'}</button></form>`);$('#book-form').onsubmit=async e=>{e.preventDefault();const f=e.target,submit=$('button[type=submit]',f);submit.disabled=true;try{let image=existing?.cover||'';const file=$('#cover-file').files[0];if(file){if(file.size>4*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP smaller than 4 MB.');image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}if(f.elements.remove.checked)image='';const data={title:f.elements.title.value,description:f.elements.description.value,cover:image};const result=await api(existing?'/books/'+existing.id:'/books',existing?'PUT':'POST',data);await closeModal();books=await api('/books');await detail(existing?.id||result.id);toast(existing?'Book updated':'Your book is on the shelf');}catch(e){$('.form-error',f).textContent=e.message;}finally{submit.disabled=false;}};}
async function detail(id){mixer.stopBackground();stopSpeech();reading=false;book=await api('/books/'+id);document.body.className='';app.innerHTML=`<div class="shell book-shell"><header class="topbar">${button('Library','library','quiet',icons.back)}<span class="brand">readbook.</span>${button('Edit book','edit-book','quiet',icons.edit)}</header><main><section class="book-detail">${cover(book)}<div><div class="eyebrow">FROM YOUR LIBRARY</div><h1>${esc(book.title)}</h1><p class="description">${esc(book.description)||'A story waiting to be read.'}</p><p class="muted">${book.chapters.length} chapters · ${Math.ceil(book.chapters.reduce((n,c)=>n+c.content.split(/\s+/).length,0)/220)} min read</p><div class="actions">${book.chapters.length?button(book.progress?'Continue reading':'Start reading','start','primary',icons.play):''}</div></div></section><div class="section-heading"><div><h2>Chapters</h2><span class="muted">In reading order</span></div>${button('Add chapter','add-chapter','secondary',icons.plus)}</div><div class="chapter-list">${book.chapters.map((c,i)=>`<div class="chapter-row"><button class="chapter-open" data-chapter="${i}"><span class="chapter-number">${String(i+1).padStart(2,'0')}</span><span>${esc(c.title)}<small>${Math.ceil(c.content.split(/\s+/).length/220)} min read</small></span></button><button class="icon quiet" aria-label="Edit ${esc(c.title)}" data-edit-chapter="${c.id}">${icons.edit}</button></div>`).join('')||'<div class="empty"><h2>Every story starts somewhere</h2><p class="muted">Paste some text or import a file to add your first chapter.</p></div>'}</div><div class="danger-zone">${button('Delete book','delete-book','danger',icons.trash)}</div></main></div>`;}
function chapterForm(chapter){
  const order=chapter?.position||Math.max(0,...book.chapters.map(item=>item.position))+1;
  show(`<form id="chapter-form">${formHead(chapter?'Edit chapter':'New chapter')}
    <div class="chapter-meta"><label>Chapter title<input name="title" required maxlength="200" value="${esc(chapter?.title||'')}" placeholder="Chapter title"></label><label>Order<input name="position" type="number" min="1" max="100000" required value="${order}"></label></div>
    <div class="editor-options"><div class="editor-tabs" role="tablist" aria-label="Chapter editor"><button type="button" role="tab" data-editor-tab="write" aria-selected="true">Write</button><button type="button" role="tab" data-editor-tab="preview" aria-selected="false">Preview</button></div><label class="format-label"><span class="sr">Chapter format</span><select name="format"><option value="md" ${!chapter||chapter.format==='md'?'selected':''}>Markdown</option><option value="txt" ${chapter?.format==='txt'?'selected':''}>Plain text</option></select></label><button type="button" class="icon quiet" id="import-chapter" aria-label="Import file" title="Import TXT or Markdown">${icon('upload')}</button><input id="chapter-file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" aria-label="Import TXT or Markdown" hidden></div>
    <div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting">${[['bold','Bold','<strong>B</strong>'],['italic','Italic',icon('italic')],['heading','Heading',icon('heading-2')],['list','Bullet list',icon('list')],['ordered','Numbered list',icon('list-ordered')],['quote','Quote',icon('quote')],['link','Link',icon('link-2')],['code','Code',icon('code')]].map(([action,label,symbol])=>`<button type="button" data-format-action="${action}" aria-label="${label}" title="${label}">${symbol}</button>`).join('')}</div>
    <div class="editor-pane"><label class="sr" for="chapter-text">Chapter text</label><textarea id="chapter-text" name="content" required maxlength="2000000" spellcheck="true" placeholder="Paste or write your chapter here…">${esc(chapter?.content||'')}</textarea><div class="markdown-body chapter-preview" id="chapter-preview" role="tabpanel" aria-label="Chapter preview" hidden></div></div>
    <div class="editor-info"><span id="word-count"></span><span>Paste text or import a TXT / MD file</span></div><p class="form-error" role="alert"></p>
    <div class="editor-actions">${chapter?`<button class="icon danger" type="button" aria-label="Delete chapter" data-delete-chapter="${chapter.id}">${icons.trash}</button>`:''}<button class="primary" type="submit">Save chapter</button></div></form>`);
  const form=$('#chapter-form'),textarea=form.elements.content,preview=$('#chapter-preview');form.noValidate=true;
  let tab='write',countTimer;
  const refresh=()=>{
    if(!form.isConnected)return;const value=textarea.value.trim();$('#word-count').textContent=`${value?value.split(/\s+/).length:0} words`;
    if(tab==='preview')preview.innerHTML=value?(form.elements.format.value==='md'?renderMarkdown(textarea.value):renderChapter({format:'txt',content:textarea.value})):'<p class="muted preview-empty">Nothing to preview yet.</p>';
    $('.editor-toolbar').hidden=tab!=='write'||form.elements.format.value!=='md';
  };
  const switchTab=value=>{
    tab=value;textarea.hidden=tab!=='write';preview.hidden=tab!=='preview';
    form.querySelectorAll('[data-editor-tab]').forEach(button=>button.setAttribute('aria-selected',button.dataset.editorTab===tab));
    refresh();if(tab==='write')textarea.focus();
  };
  form.querySelectorAll('[data-editor-tab]').forEach(button=>button.onclick=()=>switchTab(button.dataset.editorTab));
  const format=action=>{
    const result=markdownAction(textarea.value,textarea.selectionStart,textarea.selectionEnd,action);
    textarea.value=result.value;form.elements.format.value='md';switchTab('write');textarea.setSelectionRange(result.start,result.end);refresh();
  };
  const tools=[...form.querySelectorAll('[data-format-action]')];
  tools.forEach((button,index)=>{button.tabIndex=index? -1:0;button.onclick=()=>format(button.dataset.formatAction);});
  $('.editor-toolbar').onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let index=tools.indexOf(event.target);index=event.key==='Home'?0:event.key==='End'?tools.length-1:(index+(event.key==='ArrowRight'?1:tools.length-1))%tools.length;tools.forEach((tool,i)=>tool.tabIndex=i===index?0:-1);tools[index].focus();
  };
  textarea.oninput=()=>{clearTimeout(countTimer);countTimer=setTimeout(refresh,100);};
  textarea.onkeydown=event=>{
    if((event.metaKey||event.ctrlKey)&&['b','i','k'].includes(event.key.toLowerCase())){event.preventDefault();format({b:'bold',i:'italic',k:'link'}[event.key.toLowerCase()]);}
    if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}
  };
  form.elements.format.onchange=refresh;
  $('#import-chapter').onclick=()=>$('#chapter-file').click();
  $('#chapter-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    if(file.size>2000000||! /\.(txt|md|markdown)$/i.test(file.name)){$('.form-error',form).textContent='Choose a TXT or Markdown file under 2 MB.';event.target.value='';return;}
    textarea.value=await file.text();form.elements.format.value=/\.(md|markdown)$/i.test(file.name)?'md':'txt';
    if(!form.elements.title.value)form.elements.title.value=file.name.replace(/\.[^.]+$/,'');switchTab('write');refresh();
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(!form.elements.title.checkValidity()){form.elements.title.reportValidity();return;}if(!form.elements.position.checkValidity()){form.elements.position.reportValidity();return;}if(!textarea.value.trim()){switchTab('write');$('.form-error',form).textContent='Add some chapter text before saving.';textarea.focus();return;}const submit=$('button[type=submit]',form);submit.disabled=true;
    try{if(!textarea.value.trim())throw Error('Add some chapter text before saving.');await api(`/books/${book.id}/chapters${chapter?'/'+chapter.id:''}`,chapter?'PUT':'POST',{title:form.elements.title.value,position:Number(form.elements.position.value),content:textarea.value,format:form.elements.format.value});await closeModal();await detail(book.id);toast('Chapter saved');}
    catch(error){$('.form-error',form).textContent=error.message;}finally{submit.disabled=false;}
  };
  refresh();
}
function chapterHTML(chapter){return renderChapter(chapter);}
function stopSpeech(){
  speechGeneration++;
  speaking=false;lastSpeechState=null;lastTimeline={fraction:0,duration:0};
  narration.stop();legacyPaused=false;deviceUtterance=null;
  listeningWakeLock.setActive(false);
  listenSession?.stop();listenSession=null;
  pageSource?.dispose();pageSource=null;
  window.speechSynthesis?.cancel();
  const audio=$('#audio-controls audio');
  if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
  const controls=$('#audio-controls');if(controls)controls.hidden=true;
  const playNow=$('#listen-start-now');if(playNow)playNow.hidden=true;
  const status=$('#listen-status');if(status)status.textContent='';
  refreshPlaybackControls();
}
function startReader(index,offset=0){
  stopSpeech();chapterIndex=index;page=0;reading=true;document.body.className='reader-mode';
  const c=book.chapters[index];
  app.innerHTML=`<main class="reader" data-theme="${esc(prefs.theme)}">
    <header class="reader-header">${button('Back','detail','icon quiet',icons.back)}<span>${esc(book.title)}</span><div>${button('Chapters','contents','icon quiet',icons.menu)}${button('Appearance','settings','icon quiet',icons.settings)}</div></header>
    <div class="reading-meta">CHAPTER ${index+1} OF ${book.chapters.length} <span>·</span> ${esc(c.title)}</div>
    <div class="page-window" tabindex="0" aria-label="Book pages"><article class="page-content">${chapterHTML(c)}</article></div>
    <footer class="reader-footer">
      <div class="page-controls">${button('Previous page','prev','icon quiet',icons.back)}<button class="page-position" data-action="contents" aria-label="Page position and chapters"><span id="page-label" aria-live="polite"></span></button>${button('Next page','next','icon quiet',icons.next)}</div>
      <div class="audio-dock">${button('Listen','speak','mini-listen',icons.headphones)}<button class="icon quiet sound-shortcut" data-action="audio-panel" aria-label="Background sounds" title="Audio settings">${icons.volume}<span class="sound-indicator" hidden></span></button></div>
      <div id="audio-controls" hidden><audio preload="auto" aria-label="Read-aloud playback" hidden></audio></div><div id="listen-status" class="sr" role="status" aria-live="polite">Ready to listen</div>
    </footer></main>`;
  applyPrefs();refreshSoundControls();refreshPlaybackControls();requestAnimationFrame(()=>paginate(offset));

  let touchX=0,touchY=0;
  $('.page-window').ontouchstart=e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY;};
  $('.page-window').ontouchend=e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)turn(dx<0?1:-1);};
}
function applyPrefs(){applyAppearance($('.reader'),prefs);if(modal.open&&reading)applyAppearance(modal,prefs);}
function animatePage(direction=1){
  if(prefs.motion==='none'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const frames=prefs.motion==='fade'?[{opacity:.55},{opacity:1}]:[{opacity:.55,transform:`translateX(${direction*6}px)`},{opacity:1,transform:'none'}];
  void motion($('.page-window'),frames,180);
}
function paginate(offset){if(!reading)return;const win=$('.page-window'),content=$('.page-content');const w=win.clientWidth;content.style.columnWidth=w+'px';content.style.height=win.clientHeight+'px';pages=Math.max(1,Math.round((content.scrollWidth+40)/(w+40)));page=Math.min(pages-1,Math.round((offset??page/Math.max(1,pages-1))*(pages-1)));updatePage();}
function updatePage(){if(!reading)return;$('.page-content').style.transform=`translateX(-${page*($('.page-window').clientWidth+40)}px)`;$('#page-label').textContent=`${page+1} / ${pages}`;const range=$('#page-range');if(range){range.max=pages-1;range.value=page;const label=$('#jump-page-label');if(label)label.textContent=`${page+1} / ${pages}`;}$('[data-action="prev"]').disabled=page===0&&chapterIndex===0;$('[data-action="next"]').disabled=page===pages-1&&chapterIndex===book.chapters.length-1;const progress={chapter_id:book.chapters[chapterIndex].id,offset:pages>1?page/(pages-1):0};book.progress=progress;clearTimeout(updatePage.timer);const currentBookId=book.id;updatePage.timer=setTimeout(()=>api('/books/'+currentBookId+'/progress','PUT',progress).catch(e=>toast(e.message)),200);}
function turn(direction){stopSpeech();if(direction>0&&page===pages-1){if(chapterIndex<book.chapters.length-1)startReader(chapterIndex+1);return;}if(direction<0&&page===0){if(chapterIndex>0)startReader(chapterIndex-1,1);return;}page=Math.max(0,Math.min(pages-1,page+direction));updatePage();animatePage(direction);}
function settings(tab=settingsTab){
  settingsTab=tab;
  const voices=window.speechSynthesis?.getVoices()||[];
  const readingPanel=`<div class="settings-section appearance-panel"><label>Theme</label><div class="theme-options">${themes.map(theme=>`<button data-theme-choice="${theme}" class="swatch ${theme} ${prefs.theme===theme&&!prefs.customColors?'selected':''}" aria-label="${theme} theme" aria-pressed="${prefs.theme===theme&&!prefs.customColors}"><span class="theme-dot"></span>${theme}${prefs.theme===theme&&!prefs.customColors?icon('check'):''}</button>`).join('')}</div>
    <div class="font-preview" style="font-family:${esc((fonts[prefs.font]||fonts.serif)[1])}">Aa Bb Cc</div><div class="appearance-grid"><label>Typeface<select data-pref="font">${Object.entries(fonts).map(([id,[name]])=>`<option value="${id}" ${prefs.font===id?'selected':''}>${name}</option>`).join('')}</select></label><label>Text size <output id="size-output">${prefs.size}px</output><input data-pref="size" type="range" min="14" max="36" step="1" value="${prefs.size}"></label></div>
    <label>Accent</label><div class="accent-options" role="group" aria-label="Accent colour">${[['','#354f3d','Theme default'],['#346b55','#346b55','Forest'],['#927040','#927040','Amber'],['#436c9e','#436c9e','Blue'],['#775780','#775780','Plum']].map(([value,color,name])=>`<button class="accent-swatch" data-accent-choice="${value}" style="--choice:${color}" aria-label="${name}" aria-pressed="${prefs.accent===value}">${prefs.accent===value?icon('check'):''}</button>`).join('')}</div>
    <details class="appearance-more"><summary>Spacing & layout</summary><label>Line spacing <output id="line-output">${prefs.line}</output><input data-pref="line" type="range" min="1.3" max="2.4" step=".1" value="${prefs.line}"></label><label>Paragraph spacing <output id="paragraphSpace-output">${prefs.paragraphSpace}em</output><input data-pref="paragraphSpace" type="range" min=".25" max="2" step=".05" value="${prefs.paragraphSpace}"></label><label>Letter spacing <output id="letterSpace-output">${prefs.letterSpace}px</output><input data-pref="letterSpace" type="range" min="0" max="1.5" step=".1" value="${prefs.letterSpace}"></label><div class="appearance-grid"><label>Alignment<select data-pref="align"><option value="left" ${prefs.align==='left'?'selected':''}>Left aligned</option><option value="justify" ${prefs.align==='justify'?'selected':''}>Justified</option></select></label><label>Weight<select data-pref="weight">${[[400,'Regular'],[500,'Medium'],[600,'Semibold']].map(([value,label])=>`<option value="${value}" ${Number(prefs.weight)===value?'selected':''}>${label}</option>`).join('')}</select></label></div><label>Reading width<input data-pref="width" type="range" min="340" max="900" step="20" value="${prefs.width}"></label><label>Side margins <output id="gutter-output">${prefs.gutter}px</output><input data-pref="gutter" type="range" min="12" max="36" step="2" value="${prefs.gutter}"></label><label class="checkbox"><input data-pref="hyphens" type="checkbox" ${prefs.hyphens?'checked':''}> Hyphenate long words</label><label>Page animation<select data-pref="motion">${[['slide','Slide'],['fade','Fade'],['none','None']].map(([value,label])=>`<option value="${value}" ${prefs.motion===value?'selected':''}>${label}</option>`).join('')}</select></label></details>
    <details class="appearance-more"><summary>Custom colours</summary><label class="checkbox"><input data-pref="customColors" type="checkbox" ${prefs.customColors?'checked':''}> Use custom page colours</label><div class="appearance-grid color-inputs"><label>Page colour<input data-pref="pageColor" type="color" value="${esc(prefs.pageColor)}"></label><label>Text colour<input data-pref="inkColor" type="color" value="${esc(prefs.inkColor)}"></label></div></details><button class="quiet reset-appearance" data-action="reset-appearance">Reset appearance</button></div>`;
  const voicePanel=`<div class="settings-section">${playerPanel()}<label>Read-aloud voice source<select data-pref="engine"><option value="kokoro" ${prefs.engine==='kokoro'?'selected':''} ${ttsAvailable?'':'disabled'}>Kokoro · natural voices</option><option value="device" ${prefs.engine==='device'?'selected':''}>Device voices</option></select></label>${prefs.engine==='kokoro'?`<label>Kokoro voice<select data-pref="kokoroVoice">${[['af_heart','Heart · US female'],['af_bella','Bella · US female'],['af_sky','Sky · US female'],['am_michael','Michael · US male'],['am_adam','Adam · US male'],['bf_emma','Emma · UK female'],['bf_isabella','Isabella · UK female'],['bm_george','George · UK male'],['bm_fable','Fable · UK male']].map(([id,label])=>`<option value="${id}" ${prefs.kokoroVoice===id?'selected':''}>${label}</option>`).join('')}</select></label>`:`<label>Device voice<select data-pref="voice"><option value="">Device default</option>${voices.map(v=>`<option value="${esc(v.voiceURI)}" ${v.voiceURI===prefs.voice?'selected':''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label>`}<label>Read-aloud speed <output id="rate-output">${prefs.rate}×</output><input data-pref="rate" type="range" min=".5" max="2" step=".1" value="${prefs.rate}"></label><label>Narration volume <output id="voice-volume-output">${Math.round(prefs.voiceVolume*100)}%</output><input data-mixer="voiceVolume" type="range" min="0" max="1" step=".01" value="${prefs.voiceVolume}"></label><p class="muted">Narration follows the story across pages. Keep this page open while listening.</p></div>`;
  const soundPanel=`<div class="settings-section"><div class="sound-options" role="group" aria-label="Background sound">${[['off','None','Quiet reading',icon('circle-off')],['rain','Rain','Soft rainfall',icons.rain],['forest','Forest','Leaves & birds',icons.forest],['water','Water','Flowing stream',icons.water]].map(([id,label,description,symbol])=>`<button data-sound-choice="${id}" class="sound-option ${prefs.ambience===id?'selected':''}" aria-pressed="${prefs.ambience===id}">${symbol}<strong>${label}</strong><small>${description}</small>${prefs.ambience===id?icon('check'):''}</button>`).join('')}</div><div class="sound-playback">${button(mixer.playing?'Pause background':'Play background','toggle-ambience','secondary',mixer.playing?icons.pause:icons.play)}</div><label>Background volume <output id="background-volume-output">${Math.round(prefs.ambienceVolume*100)}%</output><input data-mixer="ambienceVolume" type="range" min="0" max="1" step=".01" value="${prefs.ambienceVolume}"></label><p class="muted">Background sounds can play with narration or on their own. Leaving the book stops them.</p><p class="sound-state" role="status">${mixer.playing?`Playing ${prefs.ambience}`:'Background paused'}</p></div>`;
  show(`${formHead('Reader settings')}<div class="settings-tabs" role="tablist" aria-label="Reading settings">${[['reading','Reading',icon('type')],['voice','Voice',icons.headphones],['sounds','Sounds',icons.volume]].map(([id,label,symbol])=>`<button role="tab" id="tab-${id}" aria-controls="settings-panel" aria-selected="${tab===id}" data-settings-tab="${id}" tabindex="${tab===id?0:-1}">${symbol}${label}</button>`).join('')}</div><div class="settings" id="settings-panel" role="tabpanel" aria-labelledby="tab-${tab}">${tab==='reading'?readingPanel:tab==='voice'?voicePanel:soundPanel}</div>`);
  bindPlayerPanel();
}
let preferenceTimer;
function savePrefs(){clearTimeout(preferenceTimer);preferenceTimer=setTimeout(()=>api('/preferences','PUT',prefs).catch(e=>toast(e.message)),200);}
function showListeningPage(position){
  if(position.chapter!==chapterIndex){
    chapterIndex=position.chapter;
    $('.page-content').innerHTML=chapterHTML(book.chapters[chapterIndex]);
    $('.reading-meta').innerHTML=`CHAPTER ${chapterIndex+1} OF ${book.chapters.length} <span>·</span> ${esc(book.chapters[chapterIndex].title)}`;
    paginate(0);
  }
  const changed=page!==position.page;page=position.page;
  updatePage();if(changed)animatePage(1);
}
function listeningState(state){lastSpeechState=state;refreshPlaybackControls();}
function playerStatus(){return !speaking?'Ready to listen':prefs.engine==='device'?'Listen mode · device voice':lastSpeechState?.loading?'Preparing audio…':lastSpeechState?.startupWaiting?`Building buffer · ${Math.round(lastSpeechState.readySeconds)}s ready`:`Listen mode · ${Math.round(lastSpeechState?.bufferSeconds||0)}s buffered`;}
function playerPanel(){
  return `<div class="expanded-player"><div class="player-caption"><span>Narration</span><span id="player-status">${playerStatus()}</span></div><div class="speech-timeline"><input id="speech-range" type="range" min="0" max="1" step=".001" value="${lastTimeline.fraction}" aria-label="Narration position" ${!speaking||prefs.engine==='device'?'disabled':''}><span id="speech-time">${clock(lastTimeline.fraction*lastTimeline.duration)} / ${clock(lastTimeline.duration)}</span></div><div class="player-actions">${button('Listen','panel-listen','secondary',icons.play)}<button type="button" class="secondary" data-action="pause-narration" aria-label="Pause narration" hidden>${icons.pause}Pause</button><button type="button" class="secondary" id="listen-start-now" data-action="listen-start-now" hidden>${icons.play}Play now</button>${button('Stop listening','stop-listening','icon quiet',icons.stop)}</div></div>`;
}
function bindPlayerPanel(){
  const range=$('#speech-range');if(range)range.oninput=event=>{const fraction=Number(event.target.value);if(narration.current)narration.seek(fraction);else{const audio=$('audio');if(audio.duration)audio.currentTime=fraction*audio.duration;}};
  refreshPlaybackControls();
}
function contents(){
  show(`${formHead('Chapters')}<label class="page-jump">Page <output id="jump-page-label">${page+1} / ${pages}</output><input type="range" id="page-range" min="0" max="${pages-1}" value="${page}" aria-label="Reading page"></label><div class="contents">${book.chapters.map((chapter,index)=>`<button data-jump="${index}" class="${index===chapterIndex?'selected':''}"><span class="chapter-number">${String(index+1).padStart(2,'0')}</span><span>${esc(chapter.title)}</span>${index===chapterIndex?icon('check'):''}</button>`).join('')}</div>`);
  $('#page-range').oninput=event=>{stopSpeech();page=Number(event.target.value);updatePage();};
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
  const input=cleanSpeechText(position.text);
  if(!input)return null;
  // Another tab may still be releasing its worker. Retry busy responses rather
  // than skipping a page or letting speculative generation interrupt playback.
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();
    let response;
    try{
      response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,voice:prefs.kokoroVoice,speed:Number(prefs.rate)||1}),signal});
    }catch(error){
      if(signal.aborted||attempt>=3)throw error;
      await waitForRetry(1000*(attempt+1),signal);continue;
    }
    if(response.status===429&&attempt<30){await response.body?.cancel();await waitForRetry(1000,signal);continue;}
    if(!response.ok){const data=await response.json();throw Error(data.error||'Could not generate speech.');}
    const blob=await response.blob();
    const header=new DataView(await blob.slice(0,44).arrayBuffer());
    const byteRate=header.byteLength>=32?header.getUint32(28,true):0;
    const decoded=await narration.prepare(blob);
    return {blob,duration:byteRate>0?Math.max(0,(blob.size-44)/byteRate):0,...decoded};
  }
}
function playPageAudio(audioData,signal,position,lookAhead){
  if(!audioData)return Promise.resolve();
  if(audioData.buffer&&mixer.context.state==='running')return narration.play(audioData,signal,position,lookAhead);
  const {blob}=audioData;
  const prepared=prepareSpeechText(position.text);
  const pageBreaks=position.pageBreaks?.map(boundary=>{
    const index=prepared.offsets.findIndex(offset=>offset>=boundary.offset);
    return {...boundary,fraction:index<0?1:index/Math.max(1,prepared.text.length)};
  });
  return new Promise((resolve,reject)=>{
    const audio=$('#audio-controls audio');
    const url=URL.createObjectURL(blob);
    let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;
      audio.removeEventListener('ended',ended);audio.removeEventListener('error',failed);audio.removeEventListener('timeupdate',follow);
      signal.removeEventListener('abort',aborted);
      audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
      error?reject(error):resolve();
    };
    const follow=()=>{
      if(!audio.duration||!pageBreaks)return;
      const fraction=audio.currentTime/audio.duration;updateTimeline(fraction,audio.duration);
      const marker=pageBreaks.findLast(boundary=>boundary.fraction<=fraction);
      if(marker&&marker.page!==page)showListeningPage({...position,page:marker.page});
    };
    const ended=()=>finish();
    const failed=()=>finish(Error('Could not play audio. Try device voices.'));
    const aborted=()=>finish(signal.reason);
    audio.addEventListener('timeupdate',follow);audio.addEventListener('ended',ended,{once:true});audio.addEventListener('error',failed,{once:true});
    signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted){aborted();return;}
    audio.src=url;audio.volume=Number(prefs.voiceVolume);$('#audio-controls').hidden=false;legacyPaused=false;refreshPlaybackControls();
    audio.play().catch(()=>{if(!signal.aborted){legacyPaused=true;refreshPlaybackControls();toast('Tap Resume to continue listening.');}});
  });
}
function speakDevicePage(position,generation){
  if(!speaking||generation!==speechGeneration)return;
  if(!position){stopSpeech();toast('You’ve reached the end of the book.');return;}
  showListeningPage(position);
  const prepared=prepareSpeechText(position.text);
  const chunks=prepared.text?[prepared.text]:[];
  let index=0, spoken=0;
  const next=()=>{
    if(!speaking||generation!==speechGeneration)return;
    if(index>=chunks.length){
      const upcoming=pageSource.next(position);
      // Yield between empty pages rather than recursively traversing chapters.
      setTimeout(()=>speakDevicePage(upcoming,generation),0);return;
    }
    const chunk=chunks[index++], start=spoken;
    spoken+=chunk.length;
    const utterance=new SpeechSynthesisUtterance(chunk);deviceUtterance=utterance;utterance.volume=Number(prefs.voiceVolume);
    utterance.onboundary=event=>{
      const marker=position.pageBreaks?.findLast(boundary=>boundary.offset<=(prepared.offsets[start+event.charIndex]??position.text.length));
      if(generation===speechGeneration&&marker&&marker.page!==page)showListeningPage({...position,page:marker.page});
    };
    utterance.rate=Number(prefs.rate)||1;
    utterance.voice=speechSynthesis.getVoices().find(v=>v.voiceURI===prefs.voice)||null;
    utterance.onend=next;
    utterance.onerror=()=>{if(generation===speechGeneration){stopSpeech();toast('Read-aloud stopped. Try another voice.');}};
    speechSynthesis.speak(utterance);
  };
  refreshPlaybackControls();
  $('#listen-status').textContent='Listen mode · device voice';
  next();
}
function speak(){
  if(speaking){if(lastSpeechState?.startupWaiting&&!lastSpeechState.loading)listenSession?.beginPlayback();else if(prefs.engine==='device'||narration.current||$('audio')?.getAttribute('src'))void toggleNarration();else settings('voice');return;}
  if(prefs.engine!=='kokoro'&&!('speechSynthesis' in window)){toast('Device voices are not supported in this browser.');return;}
  try{
    void mixer.unlock().catch(()=>{});
    pageSource=createSpeechSource(book.chapters,$('.reader'),$('.page-window'),chapterHTML);
    const current=pageSource.at(chapterIndex,page);
    if(prefs.ambience!=='off')void mixer.startBackground(prefs.ambience).catch(error=>toast(error.message));
    speaking=true;refreshPlaybackControls();listeningWakeLock.setActive(true);const generation=++speechGeneration;
    if(prefs.engine!=='kokoro'){speakDevicePage(current,generation);return;}
    listenSession=new ListenSession({
      nextPage:position=>pageSource.next(position),
      maxEntries:64,
      startupBufferSeconds:15,
      canPrefetch:(current,next)=>next.endOrdinal<=current.pageOrdinal+5,
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
function clock(seconds){seconds=Math.max(0,Math.floor(seconds||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function updateTimeline(fraction,duration){lastTimeline={fraction,duration};const range=$('#speech-range');if(!range)return;range.disabled=false;range.value=fraction;$('#speech-time').textContent=`${clock(fraction*duration)} / ${clock(duration)}`;}
function followNarration(fraction,duration,position){
  updateTimeline(fraction,duration);
  if(!position.pageBreaks)return;
  const prepared=prepareSpeechText(position.text);
  const marker=position.pageBreaks.findLast(boundary=>{
    const index=prepared.offsets.findIndex(offset=>offset>=boundary.offset);
    return (index<0?1:index/Math.max(1,prepared.text.length))<=fraction;
  });
  if(marker&&marker.page!==page)showListeningPage({...position,page:marker.page});
}
function refreshPlaybackControls(){
  const main=$('[data-action="speak"]');if(!main)return;
  const ready=prefs.engine==='device'||!!narration.current||!!$('audio')?.getAttribute('src');
  const paused=narration.current?(narration.paused||mixer.context.state!=='running'):legacyPaused;
  const waiting=speaking&&lastSpeechState?.startupWaiting&&!lastSpeechState?.loading;
  const label=!speaking?'Listen':waiting?'Play now':!ready?'Preparing audio':paused?'Resume narration':'Pause narration';
  const symbol=!speaking?icons.headphones:waiting?icons.play:!ready?icon('loader-circle'):paused?icons.play:icons.pause;
  main.className=`mini-listen ${speaking?'active':''} ${speaking&&!ready&&!waiting?'loading':''}`;
  setButton(main,label,symbol);$('.audio-dock')?.classList.toggle('is-listening',speaking);
  const status=$('#listen-status');if(status)status.textContent=playerStatus();
  const panelStatus=$('#player-status');if(panelStatus)panelStatus.textContent=playerStatus();
  const pause=$('[data-action="pause-narration"]');if(pause){pause.hidden=!speaking||!ready;pause.disabled=!ready;setButton(pause,paused?'Resume narration':'Pause narration',paused?icons.play:icons.pause);}
  const start=$('[data-action="panel-listen"]');if(start)start.hidden=speaking;
  const stop=$('[data-action="stop-listening"]');if(stop)stop.hidden=!speaking;
  const playNow=$('#listen-start-now');if(playNow)playNow.hidden=!waiting;
  const range=$('#speech-range');if(range){range.disabled=!speaking||prefs.engine==='device'||!ready;if(!speaking){range.value=0;$('#speech-time').textContent='0:00 / 0:00';}}
  refreshSoundControls();
}
function refreshSoundControls(){
  const indicator=$('.sound-indicator');if(indicator)indicator.hidden=!mixer.playing;
  const shortcut=$('.sound-shortcut');if(shortcut){shortcut.setAttribute('aria-label',speaking?'Playback controls':mixer.playing?`Background sounds: ${prefs.ambience} playing`:'Background sounds');const svg=$('.lucide',shortcut);if(svg){const holder=document.createElement('span');holder.innerHTML=speaking?icon('ellipsis'):icons.volume;svg.replaceWith(holder.firstElementChild);}}
}
async function toggleNarration(){
  if(narration.current){if(mixer.context.state!=='running')await mixer.unlock();else if(narration.paused)await narration.resume();else narration.pause();}
  else if(prefs.engine==='device'){if(legacyPaused){speechSynthesis.resume();legacyPaused=false;}else{speechSynthesis.pause();legacyPaused=true;}}
  else{const audio=$('audio');if(!audio?.getAttribute('src'))return;if(legacyPaused){await audio.play();legacyPaused=false;}else{audio.pause();legacyPaused=true;}}
  refreshPlaybackControls();
}
modal.addEventListener('input',e=>{
  const key=e.target.dataset.mixer;if(!key)return;
  prefs[key]=Number(e.target.value);mixer.setVolume(key==='voiceVolume'?'voice':'background',prefs[key]);
  if(key==='voiceVolume'){if(deviceUtterance)deviceUtterance.volume=prefs[key];const audio=$('audio');if(audio)audio.volume=prefs[key];$('#voice-volume-output').textContent=Math.round(prefs[key]*100)+'%';}
  else $('#background-volume-output').textContent=Math.round(prefs[key]*100)+'%';
  savePrefs();
});
modal.addEventListener('keydown',e=>{
  const tab=e.target.closest('[role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const tabs=['reading','voice','sounds'];let index=tabs.indexOf(tab.dataset.settingsTab);
  index=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;settings(tabs[index]);$('#tab-'+tabs[index]).focus();
});
app.addEventListener('click',handleClick);modal.addEventListener('click',handleClick);
async function handleClick(e){const b=e.target.closest('button');if(!b||b.disabled)return;try{if(b.dataset.book){await detail(b.dataset.book);return;}if(b.dataset.read){book=await api('/books/'+b.dataset.read);resume();return;}if(b.dataset.filter){filter=b.dataset.filter;library();return;}if(b.dataset.chapter!==undefined){startReader(Number(b.dataset.chapter));return;}if(b.dataset.editChapter){chapterForm(book.chapters.find(c=>c.id===b.dataset.editChapter));return;}if(b.dataset.deleteChapter){if(confirm('Delete this chapter? This cannot be undone.')){await api(`/books/${book.id}/chapters/${b.dataset.deleteChapter}`,'DELETE',{});await closeModal();await detail(book.id);}return;}if(b.dataset.settingsTab){settings(b.dataset.settingsTab);$('#tab-'+b.dataset.settingsTab).focus();return;}if(b.dataset.soundChoice){prefs.ambience=b.dataset.soundChoice;savePrefs();try{if(prefs.ambience==='off')mixer.stopBackground();else await mixer.startBackground(prefs.ambience);}finally{settings('sounds');}return;}if(b.dataset.accentChoice!==undefined){prefs.accent=b.dataset.accentChoice;applyPrefs();savePrefs();settings('reading');return;}if(b.dataset.themeChoice){stopSpeech();prefs.theme=b.dataset.themeChoice;prefs.customColors=false;applyPrefs();savePrefs();settings('reading');$('[data-theme-choice='+prefs.theme+']').focus();return;}switch(b.dataset.action){case'close':await closeModal();break;case'new-book':bookForm();break;case'edit-book':bookForm(book);break;case'add-chapter':chapterForm();break;case'library':books=await api('/books');library();break;case'logout':await api('/logout','POST',{});login();break;case'detail':await detail(book.id);break;case'delete-book':if(confirm(`Delete “${book.title}” and all its chapters? This cannot be undone.`)){await api('/books/'+book.id,'DELETE',{});books=await api('/books');library();}break;case'start':resume();break;case'prev':turn(-1);break;case'next':turn(1);break;case'settings':settings('reading');break;case'reset-appearance':{const offset=page/Math.max(1,pages-1);stopSpeech();Object.assign(prefs,appearanceDefaults);applyPrefs();requestAnimationFrame(()=>paginate(offset));savePrefs();settings('reading');break;}case'sounds':settings('sounds');break;case'toggle-ambience':if(mixer.playing)mixer.stopBackground();else{if(prefs.ambience==='off')prefs.ambience='rain';await mixer.startBackground(prefs.ambience);savePrefs();}settings('sounds');break;case'pause-narration':await toggleNarration();break;case'speak':speak();break;case'panel-listen':speak();break;case'stop-listening':stopSpeech();break;case'audio-panel':settings(speaking?'voice':'sounds');break;case'listen-start-now':listenSession?.beginPlayback();break;case'contents':contents();break;}if(b.dataset.jump!==undefined){await closeModal();startReader(Number(b.dataset.jump));}}catch(e){toast(e.message);}}
function resume(){if(!book.chapters.length)return;const i=book.chapters.findIndex(c=>c.id===book.progress?.chapter_id);startReader(Math.max(0,i),i>=0?book.progress.offset:0);}
modal.addEventListener('input',event=>{
  const key=event.target.dataset.pref;if(!key)return;
  const offset=page/Math.max(1,pages-1),strings=['font','voice','engine','kokoroVoice','align','motion','pageColor','inkColor'];
  prefs[key]=event.target.type==='checkbox'?event.target.checked:strings.includes(key)?event.target.value:Number(event.target.value);
  if(key==='size')$('#size-output').textContent=prefs.size+'px';if(key==='line')$('#line-output').textContent=prefs.line;if(key==='rate')$('#rate-output').textContent=prefs.rate+'×';
  const output=$('#'+key+'-output');if(output)output.textContent=prefs[key]+(key==='paragraphSpace'?'em':key==='letterSpace'||key==='gutter'?'px':'');
  stopSpeech();applyPrefs();requestAnimationFrame(()=>paginate(offset));savePrefs();
  if(key==='customColors')modal.querySelectorAll('[data-theme-choice]').forEach(button=>{const selected=!prefs.customColors&&button.dataset.themeChoice===prefs.theme;button.setAttribute('aria-pressed',selected);button.classList.toggle('selected',selected);});
  if(key==='font'){const preview=$('.font-preview');if(preview)preview.style.fontFamily=(fonts[prefs.font]||fonts.serif)[1];}
  if(key==='engine'){settings('voice');$('[data-pref=engine]').focus();}
});
modal.addEventListener('cancel',event=>{event.preventDefault();void closeModal();});
window.addEventListener('keydown',e=>{if(!reading||modal.open||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='ArrowRight'){e.preventDefault();turn(1);}if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}});
let resizeTimer;window.addEventListener('resize',()=>{if(!reading)return;const offset=page/Math.max(1,pages-1);stopSpeech();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>paginate(offset),100);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&(speaking||mixer.playing))void mixer.unlock().catch(()=>{});});
window.addEventListener('pagehide',()=>{stopSpeech();mixer.stopBackground();});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)void closeModal();}});
function syncViewport(){document.documentElement.style.setProperty('--viewport-height',(window.visualViewport?.height||window.innerHeight)+'px');}
window.visualViewport?.addEventListener('resize',syncViewport);syncViewport();
api('/session').then(s=>s.authenticated?load():login()).catch(()=>{app.innerHTML='<main class="gate"><p>Could not reach your library. Refresh to try again.</p></main>';});
