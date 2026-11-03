import { env, StyleTextToSpeech2Model, AutoTokenizer } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { speechChunks } from './public/speech-chunks.js';
import { speechWav } from './audio.js';
env.cacheDir = process.argv[2];
process.once('disconnect', () => process.exit(0));
let model, cancelled = false;

function threadCount() {
  const configured = Number(process.env.TTS_THREADS);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 32) return configured;
  let available = availableParallelism();
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/).map(Number);
    if (quota > 0 && period > 0) available = Math.min(available, Math.max(1, Math.floor(quota / period)));
  } catch {}
  // Small inference jobs can slow dramatically when ONNX oversubscribes a
  // container's CPU quota. Start conservatively; allow explicit tuning.
  return Math.max(1, Math.min(2, available));
}
async function loadModel() {
  const id = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const [network, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(id, {
      dtype: 'q8', device: 'cpu',
      session_options: { intraOpNumThreads: threadCount(), interOpNumThreads: 1 },
    }),
    AutoTokenizer.from_pretrained(id),
  ]);
  const tts = new KokoroTTS(network, tokenizer);
  // kokoro-js normally truncates long phoneme input silently. Detect overflow
  // before inference, then split only when the model truly cannot fit it.
  tts.tokenizer = (text, options) => {
    const tokens = tokenizer(text, { ...options, truncation: false });
    if (tokens.input_ids.dims.at(-1) > 512) {
      throw Object.assign(Error('Speech unit exceeds model context'), { code: 'SPEECH_TOO_LONG' });
    }
    return tokens;
  };
  return tts;
}
process.on('message', async message => {
  if (message.type === 'cancel') { cancelled = true; return; }
  const { input, voice, speed } = message;
  cancelled = false;
  try {
    model ??= await loadModel();
    if (!Object.hasOwn(model.voices, voice)) throw Error('Unsupported voice');
    const audio = [];
    let length = 0;
    async function generate(text) {
      if (cancelled || !text.trim()) return;
      try {
        const result = await model.generate(text, { voice, speed });
        if (cancelled) return;
        audio.push(result.audio); length += result.audio.length;
      } catch (error) {
        if (error.code !== 'SPEECH_TOO_LONG' || text.length < 2) throw error;
        let split = text.lastIndexOf(' ', Math.floor(text.length / 2));
        if (split <= 0) split = Math.floor(text.length / 2);
        await generate(text.slice(0, split));
        await generate(text.slice(split));
      }
    }
    // Pack short sentences into a single inference call instead of restarting
    // the model for every period. Ordinary sentence boundaries remain intact.
    for (const chunk of speechChunks(input)) await generate(chunk.text);
    if (cancelled) { process.send({ cancelled: true }); return; }
    const samples = new Float32Array(length);
    let offset = 0;
    for (const part of audio) { samples.set(part, offset); offset += part.length; }
    process.send({ audio: speechWav(samples) });
  } catch (error) {
    console.error('Kokoro generation failed:', error.message);
    process.send({ error: 'Speech could not be generated. Check model download access and server memory, or try device voices.' });
  }
});
