import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListeningWakeLock } from '../public/listening-wake-lock.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Document extends EventTarget { visibilityState='visible'; }
class Sentinel extends EventTarget {
  releases=0;
  async release(){this.releases++;this.dispatchEvent(new Event('release'));}
}
function setup(request){
  const document=new Document(),sentinels=[];
  let notices=0;
  const lock=new ListeningWakeLock({document,navigator:{wakeLock:{request:request|| (async type=>{assert.equal(type,'screen');const s=new Sentinel();sentinels.push(s);return s;})}},onUnavailable:()=>notices++});
  return {lock,document,sentinels,notices:()=>notices};
}
test('holds the screen during listening, reacquires after returning, and releases on stop',async()=>{
  const {lock,document,sentinels}=setup();
  lock.setActive(true);await tick();assert.equal(sentinels.length,1);
  lock.setActive(true);await tick();assert.equal(sentinels.length,1);
  document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));await tick();
  assert.equal(sentinels[0].releases,1);
  document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await tick();
  assert.equal(sentinels.length,2);
  lock.setActive(false);await tick();assert.equal(sentinels[1].releases,1);
  document.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(sentinels.length,2);
});
test('a wake lock granted after Stop is released rather than leaked',async()=>{
  let grant;const pending=new Promise(resolve=>grant=resolve);
  const {lock}=setup(()=>pending);
  lock.setActive(true);lock.setActive(false);
  const sentinel=new Sentinel();grant(sentinel);await tick();
  assert.equal(sentinel.releases,1);assert.equal(lock.sentinel,null);
});
test('permission refusal is handled without stopping speech or repeatedly requesting',async()=>{
  let requests=0;
  const state=setup(async()=>{requests++;throw Error('NotAllowedError');});
  state.lock.setActive(true);await tick();state.lock.setActive(true);await tick();
  assert.equal(requests,1);assert.equal(state.lock.active,true);assert.equal(state.notices(),1);
  state.lock.setActive(false);
});

test('stop and restart while a grant is pending obtains a fresh lock',async()=>{
  let grant;
  const old=new Sentinel(),fresh=new Sentinel();
  let requests=0;
  const state=setup(()=>++requests===1?new Promise(resolve=>grant=resolve):Promise.resolve(fresh));
  state.lock.setActive(true);state.lock.setActive(false);state.lock.setActive(true);
  grant(old);await tick();await tick();
  assert.equal(old.releases,1);assert.equal(state.lock.sentinel,fresh);
  state.lock.setActive(false);await tick();assert.equal(fresh.releases,1);
});

test('returning while a browser grant is pending retries instead of leaving the screen unlocked',async()=>{
  let grant,requests=0;
  const stale=new Sentinel(),fresh=new Sentinel();
  const state=setup(()=>++requests===1?new Promise(resolve=>grant=resolve):Promise.resolve(fresh));
  state.lock.setActive(true);
  state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));
  state.document.visibilityState='visible';state.document.dispatchEvent(new Event('visibilitychange'));
  grant(stale);await tick();await tick();
  assert.equal(stale.releases,1);assert.equal(state.lock.sentinel,fresh);
  state.lock.setActive(false);
});
