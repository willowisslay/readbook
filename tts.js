import { fork } from 'node:child_process';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { SpeechCache, speechKey } from './speech-cache.js';

export function createSpeechGenerator({
  createWorker = cacheDir => {
    // ONNX's native binding cannot reliably reinitialize in a second worker
    // thread. A child process keeps recovery isolated without another service.
    const child = fork(new URL('./tts-worker.js', import.meta.url), [cacheDir], {
      serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.postMessage = message => child.send(message);
    child.terminate = () => child.kill();
    return child;
  },
  timeoutMs = 300000,
  cacheBytes = Math.max(0, Math.min(2048, Number(process.env.TTS_CACHE_MB ?? 256) || 0)) * 1024 * 1024,
} = {}) {
  let worker = null, busy = false;
  const caches = new Map();
  return function generateSpeech(input, voice, speed, dataDir, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!caches.has(dataDir)) caches.set(dataDir, new SpeechCache(path.resolve(dataDir, 'audio-cache'), cacheBytes));
    const cache = caches.get(dataDir), key = speechKey(input, voice, speed);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (busy) throw Object.assign(Error('Speech is busy. Please try again shortly.'), { status: 429 });
    busy = true;
    return new Promise((resolve, reject) => {
      let timer, current;
      const finish = () => {
        clearTimeout(timer);
        current?.removeListener('message', onMessage);
        current?.removeListener('error', onError);
        current?.removeListener('exit', onExit);
        signal?.removeEventListener('abort', onAbort);
        busy = false;
      };
      const fail = error => {
        finish();
        worker = null;
        current?.terminate();
        reject(error);
      };
      const unavailable = message => Object.assign(Error(message), { status: 503 });
      const onMessage = result => {
        if (result.error) { fail(unavailable(result.error)); return; }
        finish();
        if (result.cancelled) return;
        const audio = Buffer.from(result.audio);
        cache.put(key, audio);
        resolve(audio);
      };
      const onError = error => {
        console.error('Kokoro worker failed:', error.message);
        fail(unavailable('Speech engine could not start. Try device voices.'));
      };
      const onExit = () => fail(unavailable('Speech engine stopped. Try device voices.'));
      // Cooperative cancellation preserves the loaded model. Destroying it on
      // every stop or resize makes the next Listen pay the cold-start cost again.
      const onAbort = () => {
        reject(signal.reason);
        current?.postMessage({ type: 'cancel' });
      };
      try {
        if (!worker) {
          const cacheDir = path.resolve(dataDir, 'models');
          mkdirSync(cacheDir, { recursive: true });
          worker = createWorker(cacheDir);
          worker.unref();
        }
        current = worker;
        current.once('message', onMessage);
        current.once('error', onError);
        current.once('exit', onExit);
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => fail(unavailable('Speech took too long. The first model download may need a retry; device voices are also available.')), timeoutMs);
        current.postMessage({ input, voice, speed });
      } catch {
        fail(unavailable('Speech engine could not start. Try device voices.'));
      }
    });
  };
}

export const generateSpeech = createSpeechGenerator();
