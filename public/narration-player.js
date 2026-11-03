// Keep a little genuine breathing room; trim only excessive, near-silent edges.
// Never overlap spoken words. Clips join on the audio clock with 8 ms edge ramps.
export function speechBounds(buffer) {
  const length = buffer.length, rate = buffer.sampleRate;
  let first = 0, last = length - 1;
  const audible = index => {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      if (Math.abs(buffer.getChannelData(channel)[index]) > .0001) return true;
    }
    return false;
  };
  const limit = Math.min(Math.floor(rate * .45), Math.floor(length / 4));
  while (first < limit && !audible(first)) first++;
  while (last > length - 1 - limit && !audible(last)) last--;
  const offset = Math.max(0, first / rate - .08);
  const end = Math.min(buffer.duration, (last + 1) / rate + .12);
  return { offset, duration: Math.max(.01, end - offset) };
}

export class NarrationPlayer {
  constructor(mixer, { onProgress = () => {}, onState = () => {} } = {}) {
    Object.assign(this, { mixer, onProgress, onState });
    this.slots = new Map(); this.paused = false;
  }

  async prepare(blob) {
    const context = this.mixer.context;
    if (!context) return null;
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return { buffer, ...speechBounds(buffer) };
  }

  makeSlot(data) {
    let resolve;
    const done = new Promise(yes => { resolve = yes; });
    const slot = { data, offset: 0, done, resolve, epoch: 0 };
    this.slots.set(data, slot);
    return slot;
  }

  schedule(slot, when) {
    const context = this.mixer.context, source = context.createBufferSource(), gain = context.createGain();
    const epoch = ++slot.epoch, duration = Math.max(.001, slot.data.duration - slot.offset);
    source.buffer = slot.data.buffer;
    source.connect(gain); gain.connect(this.mixer.voice);
    const fade = Math.min(.008, duration / 4);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + fade);
    gain.gain.setValueAtTime(1, when + duration - fade);
    gain.gain.linearRampToValueAtTime(0, when + duration);
    slot.source = source; slot.gain = gain; slot.when = when; slot.end = when + duration;
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      if (slot.epoch !== epoch || slot.cancelled) return;
      slot.finished = true; slot.resolve();
    };
    source.start(when, slot.data.offset + slot.offset, duration);
  }

  prequeue(slot) {
    if (!slot.nextData?.buffer || this.paused || slot.finished || slot.cancelled || this.slots.has(slot.nextData)) return;
    const next = this.makeSlot(slot.nextData);
    this.schedule(next, Math.max(this.mixer.context.currentTime + .005, slot.end));
  }

  async play(data, signal, position, lookAhead) {
    if (signal.aborted) return;
    const slot = this.slots.get(data) || this.makeSlot(data);
    this.current = slot; this.position = position; this.paused = false;
    if (!slot.source && !slot.finished) this.schedule(slot, this.mixer.context.currentTime + .015);
    const aborted = () => this.stop();
    signal.addEventListener('abort', aborted, { once: true });
    // Decode happens during generation/prefetch. Schedule the next ready clip
    // before this one ends, rather than waiting for an HTML media ended event.
    lookAhead?.ready.then(next => {
      if (!signal.aborted && !slot.cancelled) { slot.nextData = next; this.prequeue(slot); }
    }).catch(() => {});
    this.onState();
    const update = () => {
      if (this.current !== slot || slot.cancelled) return;
      const now=this.mixer.context.currentTime;
      if(slot.lastProgress===undefined||now-slot.lastProgress>=.1){this.onProgress(this.fraction(),slot.data.duration,position);slot.lastProgress=now;}
      this.frame = requestAnimationFrame(update);
    };
    update();
    await slot.done;
    cancelAnimationFrame(this.frame);
    signal.removeEventListener('abort', aborted);
    this.slots.delete(data);
    if (this.current === slot) this.current = null;
  }

  fraction() {
    const slot = this.current;
    if (!slot) return 0;
    const elapsed = this.paused ? slot.offset : slot.offset + Math.max(0, this.mixer.context.currentTime - slot.when);
    return Math.min(1, elapsed / slot.data.duration);
  }

  halt(slot) {
    slot.epoch++;
    if (slot.source) { slot.source.onended = null; try { slot.source.stop(); } catch {} slot.source.disconnect(); }
    slot.gain?.disconnect(); slot.source = null;
  }

  pause() {
    if (!this.current || this.paused) return;
    this.current.offset = this.fraction() * this.current.data.duration;
    this.paused = true;
    for (const [data, slot] of this.slots) {
      this.halt(slot);
      if (slot !== this.current) { slot.cancelled = true; slot.resolve(); this.slots.delete(data); }
    }
    this.onState();
  }

  async resume() {
    if (!this.current || !this.paused) return;
    await this.mixer.unlock();
    if (!this.current) return;
    this.paused = false;
    this.schedule(this.current, this.mixer.context.currentTime + .015);
    this.prequeue(this.current); this.onState();
  }

  seek(fraction) {
    if (!this.current) return;
    const paused = this.paused;
    this.pause();
    this.current.offset = Math.max(0, Math.min(.999, fraction)) * this.current.data.duration;
    if (!paused) void this.resume();
  }

  stop() {
    cancelAnimationFrame(this.frame);
    for (const slot of this.slots.values()) {
      slot.cancelled = true; this.halt(slot); slot.resolve();
    }
    this.slots.clear(); this.current = null; this.paused = false; this.onState();
  }
}
