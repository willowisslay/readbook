import http from 'node:http';
import { generateSpeech } from './tts.js';
import { cleanSpeechText } from './public/speech-text.js';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const password=process.env.APP_PASSWORD;
if(!password || password.length<12) throw new Error('Set APP_PASSWORD to at least 12 characters.');
const dir=process.env.DATA_DIR||'./data'; mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'readbook.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover TEXT NOT NULL DEFAULT '',updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chapters(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,format TEXT NOT NULL DEFAULT 'txt',position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS progress(book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,chapter_id TEXT,offset REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS preferences(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);`);
const assets=new Map(['index.html','app.js','listen-session.js','reading-pages.js','speech-chunks.js','speech-text.js','listening-wake-lock.js','icons.js','sound-mixer.js','narration-player.js','markdown.js','appearance.js','editor-actions.js','vendor/marked.js','vendor/purify.js','style.css','icon.svg','offline-store.js','pwa.js','sw.js','manifest.webmanifest','icons/app-192.png','icons/app-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'].map(f=>['/'+(f==='index.html'?'':f),readFileSync(new URL('./public/'+f,import.meta.url))]));
const types={'/':'text/html','/app.js':'text/javascript','/listen-session.js':'text/javascript','/reading-pages.js':'text/javascript','/speech-chunks.js':'text/javascript','/speech-text.js':'text/javascript','/listening-wake-lock.js':'text/javascript','/icons.js':'text/javascript','/sound-mixer.js':'text/javascript','/narration-player.js':'text/javascript','/markdown.js':'text/javascript','/appearance.js':'text/javascript','/editor-actions.js':'text/javascript','/vendor/marked.js':'text/javascript','/vendor/purify.js':'text/javascript','/style.css':'text/css','/icon.svg':'image/svg+xml'};
Object.assign(types,{'/offline-store.js':'text/javascript','/pwa.js':'text/javascript','/sw.js':'text/javascript','/manifest.webmanifest':'application/manifest+json','/icons/app-192.png':'image/png','/icons/app-512.png':'image/png','/icons/maskable-512.png':'image/png','/icons/apple-touch-icon.png':'image/png'});
const hash=s=>createHash('sha256').update(s).digest(); const attempts=new Map();
const id=()=>randomBytes(16).toString('hex');
function text(v,max,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Object.assign(new Error('Please check the fields and upload sizes.'),{status:400});return v.trim();}
async function body(req){let data='';for await(const c of req){data+=c;if(Buffer.byteLength(data)>9*1024*1024)throw Object.assign(new Error('Upload must be smaller than 9 MB.'),{status:413});}try{return JSON.parse(data||'{}')}catch{throw Object.assign(new Error('Invalid request.'),{status:400})}}
function cover(v){v=text(v||'',7000000);if(v&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))throw Object.assign(new Error('Use a PNG, JPEG or WebP cover.'),{status:400});return v;}
const server=http.createServer(async(req,res)=>{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('Cache-Control','no-store');
const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
try{
const url=new URL(req.url,'http://localhost'), p=url.pathname;
if(req.method==='GET'&&assets.has(p)){if(p==='/sw.js')res.setHeader('Service-Worker-Allowed','/');res.writeHead(200,{'Content-Type':types[p]});res.end(assets.get(p));return;}
if(p==='/health'){send(200,{ok:true});return;}
if(!p.startsWith('/api/')){send(404,{error:'Not found'});return;}
if(!['GET','HEAD'].includes(req.method)){
const origin=req.headers.origin; const host=req.headers.host;
if(origin&&new URL(origin).host!==host){send(403,{error:'Invalid origin'});return;}
if(req.headers['content-type']?.split(';')[0]!=='application/json'){send(415,{error:'JSON required'});return;}
}
const raw=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('readbook='))?.slice(9)||'';
const session=db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(hash(raw).toString('hex'),Date.now());
if(p==='/api/session'&&req.method==='GET'){send(200,{authenticated:!!session});return;}
if(p==='/api/login'&&req.method==='POST'){
const key=req.socket.remoteAddress; const now=Date.now(); const a=attempts.get(key)||{count:0,until:now+900000}; if(now>a.until){a.count=0;a.until=now+900000;} if(a.count>=10){send(429,{error:'Too many attempts. Try again in 15 minutes.'});return;}a.count++;attempts.set(key,a);
const b=await body(req);if(typeof b.password!=='string'||!timingSafeEqual(hash(b.password),hash(password))){send(401,{error:'That password doesn’t match.'});return;}
attempts.delete(key);db.prepare('DELETE FROM sessions WHERE expires<?').run(now);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token).toString('hex'),now+30*86400000);
res.setHeader('Set-Cookie',`readbook=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE==='false'?'':'; Secure'}`);send(200,{ok:true});return;
}
if(!session){send(401,{error:'Please unlock your library.'});return;}
if(p==='/api/tts'&&req.method==='GET'){send(200,{available:process.env.TTS_ENABLED!=='false',builtin:true});return;}
if(p==='/api/tts'&&req.method==='POST'){
if(process.env.TTS_ENABLED==='false'){send(503,{error:'Built-in speech is disabled. Choose device voices.'});return;}
const b=await body(req),input=cleanSpeechText(text(b.input,6000,true)),voice=text(b.voice||'af_heart',80,true);
if(!input){send(400,{error:'No readable text to speak.'});return;}
if(!/^[ab][fm]_[a-z0-9_]+$/.test(voice)||!Number.isFinite(b.speed)||b.speed<0.5||b.speed>2){send(400,{error:'Invalid voice or speed'});return;}
const controller=new AbortController();
const disconnected=()=>{if(!res.writableEnded)controller.abort();};
res.once('close',disconnected);
let audio;
try{audio=await generateSpeech(input,voice,b.speed,dir,controller.signal);}
finally{res.removeListener('close',disconnected);}
if(res.destroyed)return;
res.writeHead(200,{'Content-Type':'audio/wav'});res.end(audio);return;
}
if(p==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);res.setHeader('Set-Cookie','readbook=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send(200,{ok:true});return;}
if(p==='/api/books'&&req.method==='GET'){send(200,db.prepare('SELECT b.*, (SELECT count(*) FROM chapters WHERE book_id=b.id) AS chapters,p.chapter_id,p.offset FROM books b LEFT JOIN progress p ON p.book_id=b.id ORDER BY updated DESC').all());return;}
if(p==='/api/books'&&req.method==='POST'){const b=await body(req),bid=id();db.prepare('INSERT INTO books VALUES(?,?,?,?,?)').run(bid,text(b.title,200,true),text(b.description||'',5000),cover(b.cover),Date.now());send(201,{id:bid});return;}
const bm=p.match(/^\/api\/books\/([a-f0-9]+)$/);
if(bm){const book=db.prepare('SELECT * FROM books WHERE id=?').get(bm[1]);if(!book){send(404,{error:'Book not found'});return;}
if(req.method==='GET'){send(200,{...book,chapters:db.prepare('SELECT * FROM chapters WHERE book_id=? ORDER BY position,id').all(book.id),progress:db.prepare('SELECT * FROM progress WHERE book_id=?').get(book.id)});return;}
if(req.method==='PUT'){const b=await body(req);db.prepare('UPDATE books SET title=?,description=?,cover=?,updated=? WHERE id=?').run(text(b.title,200,true),text(b.description||'',5000),cover(b.cover),Date.now(),book.id);send(200,{ok:true});return;}
if(req.method==='DELETE'){db.prepare('DELETE FROM books WHERE id=?').run(book.id);send(200,{ok:true});return;}}
const cm=p.match(/^\/api\/books\/([a-f0-9]+)\/chapters(?:\/([a-f0-9]+))?$/);
if(cm){if(!db.prepare('SELECT id FROM books WHERE id=?').get(cm[1])){send(404,{error:'Book not found'});return;}
if(cm[2]&&!db.prepare('SELECT id FROM chapters WHERE id=? AND book_id=?').get(cm[2],cm[1])){send(404,{error:'Chapter not found'});return;}
if(req.method==='DELETE'&&cm[2]){db.prepare('DELETE FROM chapters WHERE id=? AND book_id=?').run(cm[2],cm[1]);send(200,{ok:true});return;}
if((req.method==='POST'&&!cm[2])||(req.method==='PUT'&&cm[2])){const b=await body(req);const title=text(b.title,200,true),content=text(b.content,2000000,true),format=b.format==='md'?'md':'txt';if(!Number.isSafeInteger(b.position)||b.position<1||b.position>100000)throw Object.assign(new Error('Chapter order must be a positive whole number.'),{status:400});
if(cm[2])db.prepare('UPDATE chapters SET title=?,content=?,format=?,position=? WHERE id=? AND book_id=?').run(title,content,format,b.position,cm[2],cm[1]);else db.prepare('INSERT INTO chapters VALUES(?,?,?,?,?,?)').run(id(),cm[1],title,content,format,b.position);
db.prepare('UPDATE books SET updated=? WHERE id=?').run(Date.now(),cm[1]);send(200,{ok:true});return;}}
const pm=p.match(/^\/api\/books\/([a-f0-9]+)\/progress$/);
if(pm&&req.method==='PUT'){const b=await body(req);if(!db.prepare('SELECT id FROM chapters WHERE id=? AND book_id=?').get(b.chapter_id,pm[1])||!Number.isFinite(b.offset)||b.offset<0||b.offset>1){send(400,{error:'Invalid reading position'});return;}db.prepare('INSERT INTO progress VALUES(?,?,?) ON CONFLICT(book_id) DO UPDATE SET chapter_id=excluded.chapter_id,offset=excluded.offset').run(pm[1],b.chapter_id,b.offset);send(200,{ok:true});return;}
if(p==='/api/preferences'){if(req.method==='GET'){send(200,JSON.parse(db.prepare('SELECT value FROM preferences WHERE id=1').get()?.value||'{}'));return;}if(req.method==='PUT'){const b=await body(req);if(JSON.stringify(b).length>4000){send(400,{error:'Preferences too large'});return;}db.prepare('INSERT INTO preferences VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(b));send(200,{ok:true});return;}}
send(404,{error:'Not found'});
}catch(e){if(res.destroyed)return;if(!e.status)console.error(e);send(e.status||500,{error:e.status?e.message:'Something went wrong. Please try again.'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Readbook listening on port '+(process.env.PORT||3000)));
