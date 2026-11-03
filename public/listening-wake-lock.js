export class ListeningWakeLock {
  constructor({ navigator = globalThis.navigator, document = globalThis.document, onUnavailable = () => {} } = {}) {
    Object.assign(this, { navigator, document, onUnavailable });
    this.active = false;
    this.generation = 0;
    this.visibility = () => {
      this.generation++;
      if (document.visibilityState === 'visible') void this.acquire();
      else void this.release();
    };
    document.addEventListener('visibilitychange', this.visibility);
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.generation++;
    if (active) { this.notified = false; void this.acquire(); }
    else void this.release();
  }

  notice() {
    if (this.notified || !this.active) return;
    this.notified = true;
    this.onUnavailable();
  }

  async acquire() {
    if (!this.active || this.document.visibilityState !== 'visible' || this.sentinel || this.pending) return;
    if (!this.navigator?.wakeLock?.request) { this.notice(); return; }
    const generation = this.generation;
    this.pending = true;
    try {
      const sentinel = await this.navigator.wakeLock.request('screen');
      if (!this.active || generation !== this.generation || this.document.visibilityState !== 'visible') {
        await sentinel.release();
        return;
      }
      if (sentinel.released) { this.notice(); return; }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel !== sentinel) return;
        this.sentinel = null;
        if (this.document.visibilityState === 'visible') this.notice();
      }, { once: true });
    } catch {
      if (generation === this.generation && this.document.visibilityState === 'visible') this.notice();
    } finally {
      this.pending = false;
      // Listen can be stopped and restarted while the browser grants a request.
      if (this.active && generation !== this.generation) void this.acquire();
    }
  }

  async release() {
    const sentinel = this.sentinel;
    this.sentinel = null;
    try { await sentinel?.release(); } catch { /* Browsers may already release it when hidden. */ }
  }
}
