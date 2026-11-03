import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export function createSpeechGenerator({
  createWorker = cacheDir => new Worker(new URL('./tts-worker.js', import.meta.url), { workerData: { cacheDir } }),
  timeoutMs = 300000,
} = {}) {
  let worker = null, busy = false;
  return function generateSpeech(input, voice, speed, dataDir, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
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
        resolve(Buffer.from(result.audio));
      };
      const onError = error => {
        console.error('Kokoro worker failed:', error.message);
        fail(unavailable('Speech engine could not start. Try device voices.'));
      };
      const onExit = () => fail(unavailable('Speech engine stopped. Try device voices.'));
      // Aborting a speculative request must also stop CPU work, otherwise a new
      // voice/layout can be blocked behind audio the reader no longer needs.
      const onAbort = () => fail(signal.reason);
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
