import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks } from '../public/speech-chunks.js';
import { SpeechCache, speechKey } from '../speech-cache.js';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('packs short sentences without clipping sentences at a display page boundary', () => {
  const text = 'A quiet evening. Dr. Smith looked outside. The road curved towards the mountains, and the trees swayed in the breeze. We kept walking.';
  const chunks = speechChunks(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text);
});
test('oversized sentences prefer clauses, remain bounded, and lose no text', () => {
  const text = 'We walked through the forest, '.repeat(70) + 'until we reached home. The end.';
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.text.length <= 380));
  assert.equal(chunks.map(chunk => chunk.text).join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  for (const chunk of chunks) assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
});
test('speech cache separates voices and speed, survives reopening, and stays bounded', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'readbook-cache-'));
  try {
    const key = speechKey('A full sentence.', 'af_heart', 1);
    assert.notEqual(key, speechKey('A full sentence.', 'bf_emma', 1));
    assert.notEqual(key, speechKey('A full sentence.', 'af_heart', 1.2));
    const cache = new SpeechCache(dir, 10);
    cache.put(key, Buffer.from([1, 2, 3, 4]));
    assert.deepEqual(new SpeechCache(dir, 10).get(key), Buffer.from([1, 2, 3, 4]));
    for (let i = 0; i < 10; i++) cache.put(speechKey('Text ' + i, 'af_heart', 1), Buffer.alloc(4));
    const total = readdirSync(dir).reduce((sum, file) => sum + statSync(path.join(dir, file)).size, 0);
    assert.ok(total <= 10);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('compact speech WAV preserves duration and safely clips PCM samples', async () => {
  const {speechWav}=await import('../audio.js');
  const wav=speechWav(new Float32Array([-2,-1,0,1,2,NaN]),24000);
  assert.equal(wav.toString('ascii',0,4),'RIFF');
  assert.equal(wav.readUInt16LE(20),1);
  assert.equal(wav.readUInt32LE(28),48000);
  assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.length,56);
  assert.deepEqual(Array.from({length:6},(_,i)=>wav.readInt16LE(44+i*2)),[-32768,-32768,0,32767,32767,0]);
  assert.equal((wav.length-44)/wav.readUInt32LE(28),6/24000);
});
