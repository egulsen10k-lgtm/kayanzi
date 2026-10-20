// Procedural sounds: no recordings or third-party audio assets are required.
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.isMuted = false;
    this.masterVolume = 0.4;
    this.sampleRate = 44100;
    this.lastThrottle = 0;
    this.lastGear = null;
    this.profile = 'six';
    this.popCooldown = -Infinity;
    this.hornCooldown = -Infinity;
    this.nodes = new Set();
    this.sources = new Set();
    this.channels = { engine: true, turbo: true, exhaust: true, tires: true, wind: true, horn: true };
  }

  node(node) { this.nodes.add(node); return node; }
  source(node) { this.node(node); this.sources.add(node); return node; }
  gain(value = 0) {
    const gain = this.node(this.ctx.createGain());
    gain.gain.setValueAtTime(value, this.ctx.currentTime);
    return gain;
  }
  filterNode(type, frequency, q = 0.7) {
    const filter = this.node(this.ctx.createBiquadFilter());
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
  }
  setChannelEnabled(channel, enabled) {
    if (!Object.hasOwn(this.channels, channel)) return;
    this.channels[channel] = Boolean(enabled);
    const groups = { engine: ['engineGain'], turbo: ['turboGain'], tires: ['screechGain', 'roadGain'], wind: ['windGain'] };
    if (!enabled && this.ctx) for (const name of groups[channel] || []) {
      this[name]?.gain.cancelScheduledValues(this.ctx.currentTime);
      this[name]?.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }
  setMasterVolume(value) {
    this.masterVolume = clamp(value, 0, 1);
    if (this.ctx) this.masterGain?.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
  }
  toggleMute() {
    this.isMuted = !this.isMuted;
    this.setMasterVolume(this.masterVolume);
    return this.isMuted;
  }
  setSampleRate(rate) {
    const requested = Number(rate);
    if (![22050, 44100, 48000].includes(requested) || requested === this.sampleRate) return;
    const restart = this.initialized;
    this.dispose();
    this.sampleRate = requested;
    if (restart) this.init();
  }
  init(sampleRate = this.sampleRate) {
    if (this.initialized) {
      if (this.ctx.state === 'suspended') this.ctx.resume()?.catch(() => {});
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext({ sampleRate });
      this.sampleRate = this.ctx.sampleRate;
      this.masterGain = this.gain(this.isMuted ? 0 : this.masterVolume);
      // Compressor catches transient peaks without sacrificing quiet cruising.
      this.compressor = this.node(this.ctx.createDynamicsCompressor());
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.engineGain = this.gain(0);
      this.filter = this.filterNode('lowpass', 600);
      this.engineGain.connect(this.filter);
      this.filter.connect(this.masterGain);
      // More harmonics for richer engine: fundamental + 2nd + 3rd + sub-bass
      for (let i = 1; i <= 4; i++) {
        const oscillator = this.source(this.ctx.createOscillator());
        oscillator.type = i === 1 ? 'triangle' : i === 4 ? 'sine' : 'sine';
        const gain = this.gain([0, 0.45, 0.2, 0.12, 0.25][i]); // sub-bass at i=4
        oscillator.connect(gain); gain.connect(this.engineGain); oscillator.start();
        this[`osc${i}`] = oscillator;
      }
      // Slight detune for realistic engine character
      this.osc2?.frequency.setValueAtTime(this.osc2.frequency.value * 1.003, this.ctx.currentTime);
      this.osc3?.frequency.setValueAtTime(this.osc3.frequency.value * 0.997, this.ctx.currentTime);
      const length = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.createTurboSound(); this.createTireScreech(); this.createWindSound();
      this.noiseChannel('road', 'lowpass', 220, 0.7);
      this.initialized = true;
      if (this.ctx.state === 'suspended') this.ctx.resume()?.catch(() => {});
    } catch (error) {
      this.dispose();
      console.warn('AudioContext failed to initialize', error);
    }
  }
  noiseChannel(name, type, frequency, q) {
    const source = this.source(this.ctx.createBufferSource());
    source.buffer = this.noiseBuffer; source.loop = true;
    const filter = this.filterNode(type, frequency, q);
    const gain = this.gain(0);
    source.connect(filter); filter.connect(gain); gain.connect(this.masterGain); source.start();
    this[`${name}Gain`] = gain; this[`${name}Filter`] = filter;
  }
  createTurboSound() { this.noiseChannel('turbo', 'bandpass', 1800, 2); }
  createTireScreech() { this.noiseChannel('screech', 'bandpass', 1600, 2); }
  createWindSound() { this.noiseChannel('wind', 'lowpass', 400, 0.7); }

  // Schedule one-shots in audio time, avoiding timers surviving context restarts.
  burst({ frequency = 90, endFrequency = 35, volume = 0.2, duration = 0.15, noise = false, delay = 0, type = 'sine' } = {}) {
    if (!this.initialized || this.isMuted) return;
    const ctx = this.ctx, start = ctx.currentTime + delay;
    const source = this.source(noise ? ctx.createBufferSource() : ctx.createOscillator());
    if (noise) source.buffer = this.noiseBuffer;
    else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, start);
      source.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }
    const filter = this.filterNode(noise ? 'bandpass' : 'lowpass', noise ? frequency : 1400, 0.8);
    const gain = this.gain(0);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    source.onended = () => {
      this.sources.delete(source);
      for (const node of [source, filter, gain]) { node.disconnect(); this.nodes.delete(node); }
    };
    source.start(start); source.stop(start + duration + 0.02);
  }
  triggerExhaustPop() {
    if (!this.channels.exhaust || this.profile === 'electric') return;
    this.burst({ frequency: 130, volume: 0.22, duration: 0.12 });
    this.burst({ frequency: 210, volume: 0.08, duration: 0.08, delay: 0.075, noise: true });
  }
  triggerBOV() {
    if (this.channels.turbo && this.profile !== 'electric') this.burst({ noise: true, frequency: 2600, volume: 0.13, duration: 0.22 });
  }
  triggerImpact(intensity = 50) {
    const volume = clamp(intensity / 100, 0, 1);
    this.burst({ frequency: 110, endFrequency: 30, volume: volume * 0.5, duration: 0.24 });
    this.burst({ noise: true, frequency: 1100, volume: volume * 0.24, duration: 0.12 });
  }
  triggerHorn() {
    if (!this.initialized || this.isMuted || !this.channels.horn || this.ctx.currentTime - this.hornCooldown < 0.3) return;
    this.hornCooldown = this.ctx.currentTime;
    for (const frequency of [420, 510]) this.burst({ frequency, endFrequency: frequency, volume: 0.15, duration: 0.32, type: 'sawtooth' });
  }

  update(rpm, throttle, speedKmh, isDrifting, options = {}) {
    if (!this.initialized) return;
    const signedSpeed = clamp(speedKmh, -400, 400), speed = Math.abs(signedSpeed);
    rpm = clamp(rpm, 0, 12000); throttle = clamp(throttle, -1, 1);
    const braking = options.brake ?? (throttle < 0 && signedSpeed > 0);
    const load = braking ? 0 : Math.abs(throttle);
    const model = String(options.model || '').toLowerCase();
    const profile = /i4|electric/.test(model) ? 'electric' : /m5|v8/.test(model) ? 'eight' : 'six';
    if (profile !== this.profile) { this.lastThrottle = 0; this.lastGear = null; }
    this.profile = profile;
    const electric = profile === 'electric', now = this.ctx.currentTime;
    if (!electric && this.lastThrottle > 0.5 && load < 0.1 && rpm > 3000 && now - this.popCooldown > 0.65) {
      this.triggerExhaustPop(); this.triggerBOV(); this.popCooldown = now;
    }
    if (!electric && options.gear != null && this.lastGear != null && options.gear !== this.lastGear && speed > 8 && this.channels.engine) {
      this.burst({ frequency: 160, endFrequency: 65, volume: 0.07, duration: 0.07 });
    }
    this.lastGear = options.gear ?? null;
    this.lastThrottle = load;
    // Four-stroke firing rate: RPM / 60 × cylinders / 2.
    const fundamental = electric ? 110 + speed * 7 : Math.max(24, rpm * (profile === 'eight' ? 4 : 3) / 60);
    [this.osc1, this.osc2, this.osc3].forEach((osc, i) => {
      osc.type = electric || i > 0 ? 'sine' : 'triangle';
      osc.frequency.setTargetAtTime(fundamental * (i + 1), now, 0.055);
    });
    this.filter.frequency.setTargetAtTime(electric ? 2800 : 400 + rpm * 0.15 + load * 1200, now, 0.08);
    const engineVolume = electric ? Math.min(0.24, speed / 100) * (0.3 + load * 0.7) : 0.16 + load * 0.3 + rpm / 12000 * 0.1;
    this.engineGain.gain.setTargetAtTime(this.channels.engine ? engineVolume : 0, now, 0.07);
    this.turboGain.gain.setTargetAtTime(this.channels.turbo && !electric ? load * Math.min(1, rpm / 5000) * 0.09 : 0, now, 0.18);
    this.turboFilter.frequency.setTargetAtTime(1200 + rpm * 0.25, now, 0.15);
    const slip = clamp(options.slip ?? (isDrifting ? 0.7 : 0), 0, 1);
    this.screechGain.gain.setTargetAtTime(this.channels.tires ? slip * Math.min(1, speed / 35) * 0.22 : 0, now, 0.07);
    this.roadGain.gain.setTargetAtTime(this.channels.tires ? Math.min(0.2, speed / 700) : 0, now, 0.15);
    this.roadFilter.frequency.setTargetAtTime(120 + speed * 2, now, 0.15);
    this.windGain.gain.setTargetAtTime(this.channels.wind ? Math.min(0.3, (speed / 250) ** 2 * 0.3) : 0, now, 0.2);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 3, now, 0.15);
  }

  dispose() {
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} }
    for (const node of this.nodes) { try { node.disconnect(); } catch {} }
    this.sources.clear(); this.nodes.clear();
    if (this.ctx) { try { this.ctx.close()?.catch(() => {}); } catch {} }
    this.ctx = null; this.initialized = false; this.noiseBuffer = null;
    this.lastThrottle = 0; this.lastGear = null; this.popCooldown = -Infinity; this.hornCooldown = -Infinity;
  }
}
