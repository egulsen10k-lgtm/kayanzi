// Procedural sounds: no recordings or third-party audio assets are required.
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const peerDistance = (a, b) => {
  const radians = Math.PI / 180;
  const meanLat = (a.lat + b.lat) * 0.5 * radians;
  const east = (b.lng - a.lng) * radians * 6371008.8 * Math.cos(meanLat);
  const north = (b.lat - a.lat) * radians * 6371008.8;
  return Math.hypot(east, north);
};

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
    this.waveProfile = null;
    this.shiftUntil = -Infinity;
    this.popCooldown = -Infinity;
    this.backfireCooldown = -Infinity;
    this.hornCooldown = -Infinity;
    this.remoteHornCooldown=-Infinity;
    this.idleTimer=2+Math.random()*2;
    this.idleThumpTimer=.7;
    this.idleDetuneTimer=0;
    this.idleDetuneOsc=null;
    this.idleActive=false;
    this.crowdProximity=120;
    this.hornVoice = null;
    this.remoteVoices = new Map();
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
    if (channel === 'horn' && !enabled) this.stopHorn();
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
      // A short combustion pressure pulse has a broad harmonic spectrum. Use
      // band-limited periodic waves (browser handles Nyquist) instead of beeps.
      this.combustionWaves = {};
      for (const profile of ['six', 'eight']) {
        const real = new Float32Array(33), imaginary = new Float32Array(33);
        for (let harmonic = 1; harmonic < real.length; harmonic++) {
          const decay = profile === 'eight' ? 0.19 : 0.25;
          imaginary[harmonic] = Math.exp(-harmonic * decay) / Math.sqrt(harmonic);
          real[harmonic] = imaginary[harmonic] * 0.28;
        }
        this.combustionWaves[profile] = this.ctx.createPeriodicWave(real, imaginary);
      }
      this.engineLayers = [];
      for (let i = 1; i <= 4; i++) {
        const oscillator = this.source(this.ctx.createOscillator());
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(40, this.ctx.currentTime);
        const gain = this.gain(0);
        oscillator.connect(gain); gain.connect(this.engineGain); oscillator.start();
        this.engineLayers.push(gain);
        this[`osc${i}`] = oscillator;
      }
      const length = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.createTurboSound(); this.createTireScreech(); this.createWindSound();
      this.noiseChannel('road', 'lowpass', 220, 0.7);
      this.noiseChannel('intake', 'bandpass', 700, 0.9, this.engineGain);
      this.createCrowdAmbience();
      this.initialized = true;
      this.setCrowdProximity(this.crowdProximity);
      if (this.ctx.state === 'suspended') this.ctx.resume()?.catch(() => {});
    } catch (error) {
      this.dispose();
      console.warn('AudioContext failed to initialize', error);
    }
  }
  noiseChannel(name, type, frequency, q, destination = this.masterGain) {
    const source = this.source(this.ctx.createBufferSource());
    source.buffer = this.noiseBuffer; source.loop = true;
    const filter = this.filterNode(type, frequency, q);
    const gain = this.gain(0);
    source.connect(filter); filter.connect(gain); gain.connect(destination); source.start();
    this[`${name}Gain`] = gain; this[`${name}Filter`] = filter;
  }
  createTurboSound() { this.noiseChannel('turbo', 'bandpass', 1800, 2); }
  createTireScreech() { this.noiseChannel('screech', 'bandpass', 1600, 2); }
  createWindSound() { this.noiseChannel('wind', 'lowpass', 400, 0.7); }
  createCrowdAmbience() {
    this.crowdSource=this.source(this.ctx.createBufferSource());this.crowdSource.buffer=this.noiseBuffer;this.crowdSource.loop=true;
    this.crowdFilter=this.filterNode('bandpass',800,2);this.crowdGain=this.gain(0);this.crowdModDepth=this.gain(0);
    this.crowdSource.connect(this.crowdFilter);this.crowdFilter.connect(this.crowdGain);this.crowdGain.connect(this.masterGain);
    this.crowdLfo=this.source(this.ctx.createOscillator());this.crowdLfo.type='sine';this.crowdLfo.frequency.setValueAtTime(.3,this.ctx.currentTime);
    this.crowdLfo.connect(this.crowdModDepth);this.crowdModDepth.connect(this.crowdGain.gain);this.crowdSource.start();this.crowdLfo.start();
  }
  setCrowdProximity(distance) {
    this.crowdProximity=clamp(distance,0,120);
    if(!this.initialized||!this.crowdGain)return this.crowdProximity;
    const mix=1-this.crowdProximity/120,now=this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(.07*mix,now,.35);
    this.crowdModDepth.gain.setTargetAtTime(.028*mix,now,.35);
    return this.crowdProximity;
  }

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
  remoteHorn() {
    if(!this.initialized||this.isMuted||!this.channels.horn||this.ctx.currentTime-this.remoteHornCooldown<.8)return false;
    this.remoteHornCooldown=this.ctx.currentTime;
    this.burst({frequency:380,endFrequency:380,volume:.14,duration:.18,type:'sawtooth'});
    return true;
  }
  startHorn() {
    if (!this.initialized || this.isMuted || !this.channels.horn || this.hornVoice) return;
    const filter = this.filterNode('lowpass', 1450, .7);
    const gain = this.gain(.0001);
    const sources = [420, 510].map(frequency => {
      const source = this.source(this.ctx.createOscillator());
      source.type = 'sawtooth';
      source.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      source.connect(filter); source.start();
      return source;
    });
    filter.connect(gain); gain.connect(this.masterGain);
    gain.gain.linearRampToValueAtTime(.15, this.ctx.currentTime + .025);
    this.hornVoice = { sources, filter, gain };
  }
  stopHorn() {
    const horn = this.hornVoice;
    if (!horn) return;
    this.hornVoice = null;
    horn.gain.gain.cancelScheduledValues(this.ctx?.currentTime ?? 0);
    horn.gain.gain.setValueAtTime(.0001, this.ctx?.currentTime ?? 0);
    for (const source of horn.sources) {
      source.onended = null;
      try { source.stop(); } catch {}
      source.disconnect(); this.sources.delete(source); this.nodes.delete(source);
    }
    horn.filter.disconnect(); horn.gain.disconnect();
    this.nodes.delete(horn.filter); this.nodes.delete(horn.gain);
  }

  removeRemoteVoice(id) {
    const voice = this.remoteVoices.get(id);
    if (!voice) return;
    voice.oscillator.onended = null;
    try { voice.oscillator.stop(); } catch {}
    for (const node of [voice.oscillator, voice.gain]) {
      try { node.disconnect(); } catch {}
      this.sources.delete(node); this.nodes.delete(node);
    }
    this.remoteVoices.delete(id);
  }

  updateRemotePeers(peers, localPosition) {
    const local = localPosition && Number.isFinite(localPosition.lat) && Number.isFinite(localPosition.lng)
      ? { lat: localPosition.lat, lng: localPosition.lng } : null;
    const nearby = (Array.isArray(peers) ? peers : [])
      .filter(peer => peer && typeof peer.peerId === 'string' && peer.peerId.length > 0 &&
        Number.isFinite(peer.lat) && Math.abs(peer.lat) <= 90 && Number.isFinite(peer.lng) && Math.abs(peer.lng) <= 180)
      .map(peer => ({ ...peer, distance: local ? peerDistance(local, peer) : Infinity }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 7);
    const active = new Set(nearby.map(peer => peer.peerId));
    for (const id of this.remoteVoices.keys()) if (!active.has(id)) this.removeRemoteVoice(id);
    if (!this.initialized || !local) return;
    const now = this.ctx.currentTime;
    for (const peer of nearby) {
      let voice = this.remoteVoices.get(peer.peerId);
      if (!voice) {
        const oscillator = this.source(this.ctx.createOscillator());
        const profile = /i4|electric/i.test(String(peer.model || '')) ? 'electric' : /m5|v8/i.test(String(peer.model || '')) ? 'eight' : 'six';
        if (profile === 'electric') oscillator.type = 'sine';
        else oscillator.setPeriodicWave(this.combustionWaves[profile]);
        const gain = this.gain(0);
        oscillator.connect(gain); gain.connect(this.masterGain); oscillator.start();
        voice = { oscillator, gain };
        this.remoteVoices.set(peer.peerId, voice);
      }
      const speed = clamp(Math.abs(peer.speed), 0, 400);
      const frequency = /i4|electric/i.test(String(peer.model || '')) ? 80 + speed * 2.5 : 24 + speed * 0.55;
      const distanceGain = peer.distance >= 120 ? 0 : (1 - peer.distance / 120) ** 1.6;
      const speedGain = 0.35 + Math.min(1, speed / 180) * 0.65;
      const volume = this.channels.engine && !this.isMuted ? 0.055 * distanceGain * speedGain : 0;
      voice.oscillator.frequency.setTargetAtTime(frequency, now, 0.08);
      voice.gain.gain.setTargetAtTime(volume, now, 0.12);
    }
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
    const dt=clamp(options.dt??0,0,.25);
    const idling=!electric&&rpm>0&&speed<2&&this.channels.engine&&options.motion!==true;
    if(idling&&!this.idleActive){this.idleActive=true;this.idleTimer=2+Math.random()*2;this.idleThumpTimer=.7;}
    if(!idling&&this.idleActive){
      this.idleActive=false;this.idleTimer=2+Math.random()*2;this.idleThumpTimer=.7;
      this.idleDetuneOsc?.detune?.setTargetAtTime(0,now,.04);this.idleDetuneOsc=null;this.idleDetuneTimer=0;
    }
    if(idling&&dt>0){
      this.idleTimer-=dt;this.idleThumpTimer-=dt;
      if(this.idleThumpTimer<=0){this.burst({frequency:28,volume:.04,duration:.18,type:'sine'});this.idleThumpTimer+=.7;}
      if(this.idleDetuneOsc){
        this.idleDetuneTimer-=dt;
        if(this.idleDetuneTimer<=0){this.idleDetuneOsc.detune?.setTargetAtTime(0,now,.04);this.idleDetuneOsc=null;}
      }
      if(this.idleTimer<=0&&!this.idleDetuneOsc){
        this.idleDetuneOsc=[this.osc1,this.osc2,this.osc3,this.osc4][Math.floor(Math.random()*4)];
        this.idleDetuneOsc.detune?.setTargetAtTime((Math.random()<.5?-1:1)*50,now,.04);
        this.idleDetuneTimer=.3;this.idleTimer=2+Math.random()*2;
      }
    }
    if (!electric && this.lastThrottle > 0.5 && load < 0.1 && rpm > 3000 && now - this.popCooldown > 0.65) {
      this.triggerExhaustPop(); this.triggerBOV(); this.popCooldown = now;
    }
    if (!electric && this.lastThrottle > 0.7 && throttle < 0.2 && speed > 60 && now - this.backfireCooldown >= 0.6) {
      const count = 1 + Math.floor(Math.random() * 3);
      for (let index = 0; index < count; index++) {
        this.burst({
          frequency: 90 + Math.random() * 60,
          endFrequency: 30,
          volume: 0.18,
          duration: 0.06 + Math.random() * 0.04,
          noise: true,
          delay: Math.random() * 0.12
        });
      }
      this.backfireCooldown = now;
    }
    if (!electric && options.gear != null && this.lastGear != null && options.gear !== this.lastGear && speed > 8 && this.channels.engine) {
      this.shiftUntil = now + 0.12;
      this.burst({ frequency: 160, endFrequency: 65, volume: 0.07, duration: 0.07 });
    }
    this.lastGear = options.gear ?? null;
    this.lastThrottle = load;
    // Four-stroke firing rate: RPM / 60 × cylinders / 2.
    const fundamental = electric ? 110 + speed * 7 : Math.max(24, rpm * (profile === 'eight' ? 4 : 3) / 60);
    if (this.waveProfile !== profile) {
      this.osc1.type = 'sine';
      this.osc2.type = 'sine';
      if (!electric) {
        this.osc1.setPeriodicWave(this.combustionWaves[profile]);
        this.osc2.setPeriodicWave(this.combustionWaves[profile]);
      }
      this.waveProfile = profile;
      this.shiftUntil = -Infinity;
    }
    // The bottom layer follows crankshaft RPM; never leave a fixed 440 Hz drone.
    const frequencies = electric
      ? [fundamental, fundamental * 2, fundamental * 0.5, fundamental * 3]
      : [fundamental, fundamental * 2.003, fundamental * 0.5, Math.max(12, rpm / 60)];
    [this.osc1, this.osc2, this.osc3, this.osc4].forEach((osc, i) => {
      osc.frequency.setTargetAtTime(frequencies[i], now, 0.045);
    });
    const layerVolumes = electric ? [0.32, 0.06, 0.015, 0.025]
      : [0.50, 0.035 + load * 0.09, profile === 'eight' ? 0.18 : 0.09, 0.08];
    this.engineLayers.forEach((gain, i) => gain.gain.setTargetAtTime(layerVolumes[i], now, 0.06));
    this.filter.frequency.setTargetAtTime(electric ? 4200 : 420 + rpm * 0.19 + load * 1600, now, 0.08);
    // Intake air adds a soft mechanical rasp under load, sharing engine mute.
    this.intakeGain.gain.setTargetAtTime(electric ? 0 : 0.025 + load * 0.18, now, 0.09);
    this.intakeFilter.frequency.setTargetAtTime(400 + rpm * 0.14 + load * 450, now, 0.09);
    const idleAmount = Math.max(0, 1 - rpm / 1800) * (1 - load);
    const idleVariation = 1 + idleAmount * (Math.sin(now * 19) * 0.045 + Math.sin(now * 31.7) * 0.025);
    const shiftEnvelope = now < this.shiftUntil ? 0.38 : 1;
    const engineVolume = electric ? Math.min(0.24, speed / 100) * (0.3 + load * 0.7)
      : (0.18 + load * 0.38 + rpm / 12000 * 0.08) * idleVariation * shiftEnvelope;
    this.engineGain.gain.setTargetAtTime(this.channels.engine ? engineVolume : 0, now, 0.025);
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
    this.stopHorn();
    this.remoteVoices.clear();
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} }
    for (const node of this.nodes) { try { node.disconnect(); } catch {} }
    this.sources.clear(); this.nodes.clear();
    if (this.ctx) { try { this.ctx.close()?.catch(() => {}); } catch {} }
    this.ctx = null; this.initialized = false; this.noiseBuffer = null;
    this.crowdSource=null;this.crowdLfo=null;this.crowdFilter=null;this.crowdGain=null;this.crowdModDepth=null;
    this.waveProfile = null; this.shiftUntil = -Infinity;
    this.lastThrottle = 0; this.lastGear = null; this.popCooldown = -Infinity; this.hornCooldown = -Infinity; this.remoteHornCooldown=-Infinity;this.hornVoice = null;
  }
}
