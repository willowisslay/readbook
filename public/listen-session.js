// A rolling window of the current page plus, at most, five future pages.
// Generation is serial: the page being heard always gets priority over prefetch.
export class ListenSession {
  constructor({ nextPage, generate, play, onPage, onState, onComplete, onError }) {
    Object.assign(this, { nextPage, generate, play, onPage, onState, onComplete, onError });
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
    while (this.entries.length < 6) {
      const next = this.nextPage(this.entries.at(-1).page);
      if (!next) break;
      this.entries.push(this.entry(next));
    }
    this.notify();
    void this.pump();
  }

  notify() {
    if (!this.active) return;
    this.onState?.({
      loading: this.entries[0]?.state !== 'ready',
      aheadReady: this.entries.slice(1).filter(entry => entry.state === 'ready').length,
      aheadTotal: this.entries.length - 1,
    });
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
        await this.play(audio, this.controller.signal);
        if (!this.active) return;
        this.entries.shift(); // Release the page just heard before adding another.
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
    for (const entry of this.entries) entry.reject(new DOMException('Stopped', 'AbortError'));
    this.entries.length = 0;
  }
}
