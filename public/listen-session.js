// A bounded rolling speech queue. Sentence units use a visual-page horizon;
// generation stays serial so imminent audio always has priority over prefetch.
export class ListenSession {
  constructor({ nextPage, generate, play, onPage, onState, onComplete, onError, canPrefetch = () => true, maxEntries = 6, startupBufferSeconds = 0 }) {
    Object.assign(this, { nextPage, generate, play, onPage, onState, onComplete, onError, canPrefetch, maxEntries, startupBufferSeconds });
    this.entries = [];
    this.controller = new AbortController();
    this.active = false;
    this.pumping = false;
  }

  start(page) {
    this.active = true;
    this.entries.push(this.entry(page));
    void this.run();
  }

  entry(page) {
    let resolve, reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Future pages can fail before playback reaches them. Handle that failure
    // when the page is needed, without an unhandled background rejection.
    ready.catch(() => {});
    return { page, ready, resolve, reject, state: 'queued' };
  }

  fill() {
    while (this.entries.length < this.maxEntries) {
      const next = this.nextPage(this.entries.at(-1).page);
      if (!next || !this.canPrefetch(this.entries[0].page, next)) break;
      this.entries.push(this.entry(next));
    }
    this.notify();
    void this.pump();
  }

  notify() {
    if (!this.active) return;
    this.checkStartup();
    this.onState?.({
      loading: this.entries[0]?.state !== 'ready',
      aheadReady: this.entries.slice(1).filter(entry => entry.state === 'ready').length,
      aheadTotal: this.entries.length - 1,
      bufferSeconds: this.entries.slice(1).reduce((sum, entry) => sum + (entry.state === 'ready' ? entry.duration || 0 : 0), 0),
      readySeconds: this.entries.reduce((sum, entry) => sum + (entry.state === 'ready' ? entry.duration || 0 : 0), 0),
      startupWaiting: !!this.startupWaiting,
    });
  }

  checkStartup() {
    if (!this.startupWaiting) return;
    let seconds = 0;
    for (const entry of this.entries.slice(1)) {
      if (entry.state !== 'ready') break;
      seconds += entry.duration || 0;
    }
    const settled = this.entries.every(entry => ['ready', 'failed'].includes(entry.state));
    if (this.startNow || seconds >= this.startupBufferSeconds || settled || this.entries.some(entry => entry.state === 'failed')) this.allowStartup?.();
  }

  beginPlayback() {
    this.startNow = true;
    this.checkStartup();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active) {
        const entry = this.entries.find(entry => entry.state === 'queued');
        if (!entry) break;
        entry.state = 'generating';
        try {
          const audio = await this.generate(entry.page, this.controller.signal);
          if (!this.active) return;
          entry.state = 'ready';
          entry.duration = audio?.duration || 0;
          entry.resolve(audio);
        } catch (error) {
          if (!this.active) return;
          entry.state = 'failed';
          entry.reject(error);
        }
        this.notify();
      }
    } finally {
      this.pumping = false;
    }
  }

  async run() {
    try {
      this.fill();
      while (this.active && this.entries.length) {
        const entry = this.entries[0];
        this.onPage(entry.page);
        this.notify();
        const audio = await entry.ready;
        if (!this.active) return;
        if (!this.started && this.startupBufferSeconds > 0) {
          this.startupWaiting = true;
          await new Promise(resolve => { this.allowStartup = resolve; this.notify(); });
          this.startupWaiting = false;
          if (!this.active) return;
          this.notify();
        }
        this.started = true;
        await this.play(audio, this.controller.signal, entry.page);
        if (!this.active) return;
        this.entries.shift(); // Release the page just heard before adding another.
        if (!this.entries.length) {
          const next = this.nextPage(entry.page);
          if (next) this.entries.push(this.entry(next));
        }
        if (this.entries.length) this.fill();
      }
      if (this.active) {
        this.stop();
        this.onComplete?.();
      }
    } catch (error) {
      if (!this.active) return;
      this.stop();
      this.onError?.(error);
    }
  }

  stop() {
    this.active = false;
    this.controller.abort();
    this.allowStartup?.();
    for (const entry of this.entries) entry.reject(new DOMException('Stopped', 'AbortError'));
    this.entries.length = 0;
  }
}
