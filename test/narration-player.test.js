import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {NarrationPlayer,speechBounds} from '../public/narration-player.js';
import {SoundMixer} from '../public/sound-mixer.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Param {
  value=1;calls=[];
  setValueAtTime(value,time){this.value=value;this.calls.push(['set',value,time]);}
  linearRampToValueAtTime(value,time){this.value=value;this.calls.push(['ramp',value,time]);}
  exponentialRampToValueAtTime(value,time){this.value=value;this.calls.push(['exponential',value,time]);}
  setTargetAtTime(value,time){this.value=value;this.calls.push(['target',value,time]);}
  cancelScheduledValues(){}
}
class Node {
  gain=new Param();frequency=new Param();Q=new Param();stops=0;
  connect(node){this.output=node;return node;}
  disconnect(){this.disconnected=true;}
  start(...args){this.startArgs=args;}
  stop(){this.stops++;}
}
class Context {
  currentTime=0;sampleRate=1000;state='running';destination={};sources=[];
  createGain(){return new Node();}
  createBufferSource(){const node=new Node();this.sources.push(node);return node;}
  createBiquadFilter(){return new Node();}
  createOscillator(){return new Node();}
  createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {length,sampleRate:rate,duration:length/rate,numberOfChannels:channels,getChannelData:i=>data[i]};}
  async resume(){this.state='running';}
}
let frame,cancel;
before(()=>{frame=globalThis.requestAnimationFrame;cancel=globalThis.cancelAnimationFrame;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};});
after(()=>{globalThis.requestAnimationFrame=frame;globalThis.cancelAnimationFrame=cancel;});
function player(){const context=new Context();const mixer=new SoundMixer({createContext:()=>context});mixer.getContext();return {context,mixer,player:new NarrationPlayer(mixer)};}
function clip(context,duration=2){return {buffer:context.createBuffer(1,duration*1000,1000),offset:.08,duration};}

test('ready narration clips meet exactly on the audio clock, without overlapping words',async()=>{
  const {context,player:p}=player(),current=clip(context),next=clip(context,3),controller=new AbortController();
  const playing=p.play(current,controller.signal,{}, {ready:Promise.resolve(next)});await tick();
  assert.equal(context.sources.length,2);
  const [first,second]=context.sources;
  assert.equal(second.startArgs[0],first.startArgs[0]+current.duration);
  assert.equal(first.startArgs[1],.08);
  assert.deepEqual(first.output.gain.calls.at(-1),['ramp',0,first.startArgs[0]+current.duration]);
  context.currentTime=first.startArgs[0]+current.duration;first.onended();await playing;
  const playingNext=p.play(next,controller.signal,{});
  assert.equal(context.sources.length,2,'already scheduled clip must not be started twice');
  second.onended();await playingNext;p.stop();
});
test('pause stops scheduled narration while the background bus keeps running; resume preserves position',async()=>{
  const {context,mixer,player:p}=player(),current=clip(context),next=clip(context),controller=new AbortController();
  const playing=p.play(current,controller.signal,{}, {ready:Promise.resolve(next)});await tick();
  context.currentTime=.515;p.pause();
  assert.equal(p.paused,true);assert.ok(Math.abs(p.current.offset-.5)<.001);
  assert.equal(context.state,'running');assert.equal(mixer.background.disconnected,undefined);
  assert.equal(context.sources[1].stops,1,'prefetched clip must not keep playing after Pause');
  await p.resume();
  assert.equal(p.paused,false);assert.equal(context.sources.length,4);
  assert.ok(Math.abs(context.sources[2].startArgs[1]-.58)<.001);
  assert.equal(context.sources[3].startArgs[0],context.sources[2].startArgs[0]+1.5);
  controller.abort();await playing;
  assert.equal(p.slots.size,0);assert.equal(context.sources[3].stops,1);
});
test('silence trimming preserves breathing space and all audible samples',()=>{
  const context=new Context(),buffer=context.createBuffer(1,2000,1000),samples=buffer.getChannelData(0);
  samples.fill(.2,400,1600);
  const bounds=speechBounds(buffer);
  assert.ok(Math.abs(bounds.offset-.32)<.001);
  assert.ok(bounds.offset+bounds.duration>=1.72);
  assert.ok(bounds.offset<.4);
});
test('ambience and voice have independent volume buses and scenes stop on leaving',async()=>{
  const context=new Context(),mixer=new SoundMixer({createContext:()=>context});
  mixer.setVolume('voice',.8);mixer.setVolume('background',.2);
  await mixer.startBackground('rain');
  assert.equal(mixer.playing,true);assert.equal(mixer.voice.gain.value,.8);assert.equal(mixer.background.gain.value,.12);
  mixer.setVolume('background',.5);assert.equal(mixer.voice.gain.value,.8);assert.equal(mixer.background.gain.value,.3);
  const rain=mixer.group;await mixer.startBackground('forest');assert.equal(rain.closed,true);
  const forest=mixer.group;await mixer.startBackground('water');assert.equal(forest.closed,true);
  const water=mixer.group;mixer.stopBackground();assert.equal(water.closed,true);assert.equal(mixer.playing,false);
  for(const buffer of mixer.buffers.values())assert.ok(buffer.getChannelData(0).every(Number.isFinite));
});
test('an ambience start cancelled while audio unlock is pending cannot restart after leaving',async()=>{
  const context=new Context();context.state='suspended';let resume;
  context.resume=()=>new Promise(resolve=>{resume=resolve;});
  const mixer=new SoundMixer({createContext:()=>context});
  const starting=mixer.startBackground('rain');mixer.stopBackground();resume();await starting;
  assert.equal(mixer.playing,false);assert.equal(mixer.group,null);
});

test('seeking replaces scheduled voice sources without losing pause state',async()=>{
  const {context,player:p}=player(),current=clip(context),next=clip(context),controller=new AbortController();
  const playing=p.play(current,controller.signal,{}, {ready:Promise.resolve(next)});await tick();
  p.seek(.7);await tick();
  assert.ok(Math.abs(context.sources[2].startArgs[1]-1.48)<.001);
  p.pause();const count=context.sources.length;p.seek(.2);await tick();
  assert.equal(p.paused,true);assert.equal(context.sources.length,count);assert.equal(p.fraction(),.2);
  controller.abort();await playing;
});
