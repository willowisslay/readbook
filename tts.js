import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
let worker=null,busy=false;
export function generateSpeech(input,voice,speed,dataDir){
if(busy)throw Object.assign(Error('Speech is busy. Please try again shortly.'),{status:429});
busy=true;
return new Promise((resolve,reject)=>{
let timer;
const finish=()=>{clearTimeout(timer);worker?.removeListener('message',onMessage);worker?.removeListener('error',onError);worker?.removeListener('exit',onExit);busy=false;};
const fail=message=>{const current=worker;finish();worker=null;current?.terminate();reject(Object.assign(Error(message),{status:503}));};
const onMessage=result=>{if(result.error){fail(result.error);return;}finish();resolve(Buffer.from(result.audio));};
const onError=e=>{console.error('Kokoro worker failed:',e.message);fail('Speech engine could not start. Try device voices.');};
const onExit=()=>fail('Speech engine stopped. Try device voices.');
try{
if(!worker){const cacheDir=path.resolve(dataDir,'models');mkdirSync(cacheDir,{recursive:true});worker=new Worker(new URL('./tts-worker.js',import.meta.url),{workerData:{cacheDir}});worker.unref();}
worker.once('message',onMessage);worker.once('error',onError);worker.once('exit',onExit);
timer=setTimeout(()=>fail('Speech took too long. The first model download may need a retry; device voices are also available.'),300000);
worker.postMessage({input,voice,speed});
}catch{fail('Speech engine could not start. Try device voices.');}
});
}
