const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

// One audio context, two independent buses. Nature ambience is synthesized on
// the device: no external audio requests, sample downloads, or API credentials.
export class SoundMixer {
  constructor({ createContext, onChange = () => {} } = {}) {
    this.createContext = createContext || (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      return Context ? new Context() : null;
    });
    this.onChange = onChange;
    this.voiceVolume = 1;
    this.backgroundVolume = .25;
    this.buffers = new Map();
    this.scene = 'off';
    this.requestGeneration = 0;
    this.playing = false;
  }

  getContext() {
    if (this.context) return this.context;
    const context = this.createContext();
    if (!context) return null;
    this.context = context;
    context.addEventListener?.('statechange', () => this.onChange());
    this.voice = context.createGain();
    this.background = context.createGain();
    this.voice.gain.value = this.voiceVolume;
    this.background.gain.value = this.backgroundVolume * .6;
    // A gentle safety limiter keeps a loud ambience/voice mix from clipping.
    let output = context.destination;
    if (context.createDynamicsCompressor) {
      output = context.createDynamicsCompressor();
      output.threshold.value = -3; output.knee.value = 6; output.ratio.value = 12;
      output.attack.value = .003; output.release.value = .1;
      output.connect(context.destination);
    }
    this.voice.connect(output);
    this.background.connect(output);
    return context;
  }

  async unlock() {
    const context = this.getContext();
    if (context?.state === 'suspended') await context.resume();
    return context;
  }

  setVolume(bus, value) {
    value = clamp(value);
    if (bus === 'voice') this.voiceVolume = value;
    else this.backgroundVolume = value;
    const node = bus === 'voice' ? this.voice : this.background;
    if (node) node.gain.setTargetAtTime(value * (bus === 'voice' ? 1 : .6), this.context.currentTime, .06);
  }

  noise(kind) {
    if (this.buffers.has(kind)) return this.buffers.get(kind);
    const context = this.context;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 16), context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0, pink0 = 0, pink1 = 0, pink2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'brown') {
        brown = (brown + .02 * white) / 1.02;
        data[i] = brown * 3.5;
      } else {
        pink0 = .99765 * pink0 + white * .099046;
        pink1 = .963 * pink1 + white * .2965164;
        pink2 = .57 * pink2 + white * 1.0526913;
        data[i] = (pink0 + pink1 + pink2 + white * .1848) * .05;
      }
      // Tiny ramps prevent a discontinuity where the noise loop wraps.
      const edge = Math.min(1, i / 480, (data.length - 1 - i) / 480);
      data[i] *= edge;
    }
    this.buffers.set(kind, buffer);
    return buffer;
  }

  async startBackground(scene) {
    if (!['rain', 'forest', 'water'].includes(scene)) { this.stopBackground(); return; }
    const generation = ++this.requestGeneration;
    const context = await this.unlock();
    if (generation !== this.requestGeneration) return;
    if (!context) throw Error('Background sounds aren’t supported in this browser.');
    if (this.playing && this.scene === scene) return;
    this.retire(this.group);
    const group = { gain: context.createGain(), nodes: new Set(), timers: new Set(), closed: false };
    group.gain.gain.setValueAtTime(0, context.currentTime);
    group.gain.gain.linearRampToValueAtTime(.85, context.currentTime + 1);
    group.gain.connect(this.background);
    const noise = (kind, type, frequency, volume) => {
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
      source.buffer = this.noise(kind); source.loop = true;
      filter.type = type; filter.frequency.value = frequency; filter.Q.value = .5;
      gain.gain.value = volume;
      source.connect(filter); filter.connect(gain); gain.connect(group.gain);
      source.start(0, Math.random() * 8);
      [source, filter, gain].forEach(node => group.nodes.add(node));
      return { gain, filter };
    };
    const modulate = (parameter, frequency, depth) => {
      const oscillator = context.createOscillator(), amount = context.createGain();
      oscillator.frequency.value = frequency; amount.gain.value = depth;
      oscillator.connect(amount); amount.connect(parameter); oscillator.start();
      [oscillator, amount].forEach(node => group.nodes.add(node));
    };
    const later = (callback, ms) => {
      const timer = setTimeout(() => { group.timers.delete(timer); callback(); }, ms);
      group.timers.add(timer);
    };
    const chirp = () => {
      if (group.closed) return;
      const time = context.currentTime + .02, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine';
      const pitch = 1600 + Math.random() * 1700;
      oscillator.frequency.setValueAtTime(pitch * .65, time);
      oscillator.frequency.exponentialRampToValueAtTime(pitch, time + .08);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * .82, time + .19);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(.10, time + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, time + .26);
      oscillator.connect(gain); gain.connect(group.gain);
      oscillator.start(time); oscillator.stop(time + .28);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); group.nodes.delete(oscillator); group.nodes.delete(gain); };
      [oscillator, gain].forEach(node => group.nodes.add(node));
      later(chirp, 1600 + Math.random() * 3800);
    };
    if (scene === 'rain') {
      const rain = noise('pink', 'highpass', 900, 1.6);
      noise('brown', 'lowpass', 500, .55);
      modulate(rain.gain.gain, .14, .12);
    } else if (scene === 'forest') {
      const wind = noise('brown', 'lowpass', 950, .8);
      modulate(wind.gain.gain, .09, .25);
      later(chirp, 700);
    } else {
      const stream = noise('brown', 'bandpass', 750, 2.5);
      noise('pink', 'lowpass', 2300, .55);
      modulate(stream.filter.frequency, .23, 300);
      modulate(stream.gain.gain, .36, .3);
    }
    this.group = group; this.scene = scene; this.playing = true; this.onChange();
  }

  retire(group) {
    if (!group || group.closed) return;
    group.closed = true;
    group.timers.forEach(clearTimeout);
    const time = this.context.currentTime;
    if(group.gain.gain.cancelAndHoldAtTime)group.gain.gain.cancelAndHoldAtTime(time);
    else{group.gain.gain.cancelScheduledValues(time);group.gain.gain.setValueAtTime(group.gain.gain.value,time);}
    group.gain.gain.linearRampToValueAtTime(0, time + .35);
    setTimeout(() => {
      for (const node of group.nodes) {
        try { node.stop?.(); } catch { /* One-shot birds may already have ended. */ }
        node.disconnect();
      }
      group.gain.disconnect();
    }, 400);
  }

  stopBackground() {
    this.requestGeneration++;
    this.retire(this.group); this.group = null; this.playing = false; this.onChange();
  }
}
