import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import path from 'node:path';

export function speechKey(input, voice, speed) {
  return createHash('sha256').update(JSON.stringify(['kokoro-q8-sentences-v1', input, voice, speed])).digest('hex');
}

// A bounded, private disk cache. Stable sentence units can be reused after
// a font change, revisiting a book, or redeploying the container.
export class SpeechCache {
  constructor(directory, maxBytes = 256 * 1024 * 1024) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    if (maxBytes > 0) mkdirSync(directory, { recursive: true });
  }
  get(key) {
    if (this.maxBytes <= 0) return null;
    try {
      const file = path.join(this.directory, key + '.wav');
      const audio = readFileSync(file);
      const now = new Date();
      utimesSync(file, now, now);
      return audio;
    } catch { return null; }
  }
  put(key, audio) {
    if (this.maxBytes <= 0 || audio.length > this.maxBytes) return;
    try {
      const file = path.join(this.directory, key + '.wav');
      writeFileSync(file + '.tmp', audio, { mode: 0o600 });
      renameSync(file + '.tmp', file);
      const files = readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.wav$/.test(name)).map(name => {
        const file = path.join(this.directory, name), stat = statSync(file);
        return { file, size: stat.size, modified: stat.mtimeMs };
      }).sort((a, b) => a.modified - b.modified);
      let total = files.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of files) {
        if (total <= this.maxBytes) break;
        unlinkSync(entry.file); total -= entry.size;
      }
    } catch (error) { console.warn('Speech cache unavailable:', error.message); }
  }
}
