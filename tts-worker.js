import { parentPort, workerData } from 'node:worker_threads';
import { env, RawAudio } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
env.cacheDir=workerData.cacheDir;
let model;
parentPort.on('message',async({input,voice,speed})=>{
try{
model??=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});
if(!Object.hasOwn(model.voices,voice))throw Error('Unsupported voice');
// Keep each chunk short: Kokoro's tokenizer truncates long inputs.
const chunks=input.match(/[^.!?]+[.!?]*\s*/g)||[input];
const audio=[];let length=0;
for(const sentence of chunks){
const words=sentence.split(/\s+/);let chunk='';
const generate=async()=>{if(!chunk.trim())return;const result=await model.generate(chunk,{voice,speed});audio.push(result.audio);length+=result.audio.length;chunk='';};
for(const word of words){if(chunk.length+word.length>250)await generate();if(word.length>250){for(let i=0;i<word.length;i+=250){chunk=word.slice(i,i+250);await generate();}}else chunk+=word+' ';}
await generate();
}
const samples=new Float32Array(length);let offset=0;for(const a of audio){samples.set(a,offset);offset+=a.length;}
const wav=new RawAudio(samples,24000).toWav();parentPort.postMessage({audio:wav},[wav]);
}catch(e){console.error('Kokoro generation failed:',e.message);parentPort.postMessage({error:'Speech could not be generated. Check model download access and server memory, or try device voices.'});}
});
