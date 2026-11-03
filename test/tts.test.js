import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSpeechGenerator } from '../tts.js';

class FakeWorker extends EventEmitter {
  unref() {}
  postMessage(message) { this.message = message; }
  terminate() { this.terminated = true; }
}

test('cancelling prefetch terminates CPU work and frees the worker for a new voice', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'readbook-tts-'));
  try {
    const workers = [];
    const generate = createSpeechGenerator({ createWorker: () => {
      const worker = new FakeWorker(); workers.push(worker); return worker;
    } });
    const controller = new AbortController();
    const first = generate('old page', 'af_heart', 1, dir, controller.signal);
    assert.throws(() => generate('another tab', 'af_heart', 1, dir), error => error.status === 429);
    controller.abort();
    await assert.rejects(first, error => error.name === 'AbortError');
    assert.equal(workers[0].terminated, true);
    assert.equal(workers[0].listenerCount('message'), 0);
    const next = generate('new page', 'bf_emma', 1.2, dir);
    assert.equal(workers.length, 2);
    assert.equal(workers[1].message.voice, 'bf_emma');
    workers[0].emit('message', { audio: new Uint8Array([99]) });
    workers[1].emit('message', { audio: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(await next, Buffer.from([1, 2, 3]));
    const reused = generate('next page', 'bf_emma', 1.2, dir);
    assert.equal(workers.length, 2);
    workers[1].emit('message', { audio: new Uint8Array([4]) });
    await reused;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
