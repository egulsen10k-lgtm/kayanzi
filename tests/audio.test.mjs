import test from 'node:test';
import assert from 'node:assert/strict';
import { CarAudio } from '../src/audio.js';

class Param {
  constructor() { this.value = 0; }
  setValueAtTime(value) { assert.ok(Number.isFinite(value) && value >= 0); this.value = value; }
  setTargetAtTime(value) { this.setValueAtTime(value); }
  linearRampToValueAtTime(value) { this.setValueAtTime(value); }
  exponentialRampToValueAtTime(value) { assert.ok(value > 0); this.setValueAtTime(value); }
  cancelScheduledValues() {}
}
class Node {
  constructor() {
    for (const key of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio']) this[key] = new Param();
  }
  setPeriodicWave(wave) { this.wave = wave; this.type = 'custom'; }
  connect() {}
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class Context {
  constructor({ sampleRate }) { this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(); }
  createPeriodicWave(real, imaginary) { return { real, imaginary }; }
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBufferSource() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
function create() {
  globalThis.window = { AudioContext: Context };
  const audio = new CarAudio(); audio.init(); return audio;
}

test('reverse load is audible but braking does not increase engine or turbo load', () => {
  const audio = create();
  audio.update(2400, -0.6, -45, false);
  const reverseVolume = audio.engineGain.gain.value;
  assert.ok(audio.turboGain.gain.value > 0);
  audio.update(2400, -0.6, 45, false);
  assert.ok(audio.engineGain.gain.value < reverseVolume);
  assert.equal(audio.turboGain.gain.value, 0);
  audio.update(2400, -0.6, -45, false, { brake: true });
  assert.equal(audio.turboGain.gain.value, 0);
  audio.update(NaN, Infinity, -Infinity, true, { slip: NaN });
  audio.dispose();
});

test('engine profiles follow cylinder firing frequency and electric has no combustion transients', () => {
  const audio = create();
  audio.update(3000, 1, 60, false, { model: 'BMW M3 Competition', gear: 2 });
  assert.equal(audio.osc1.frequency.value, 150);
  audio.update(3000, 1, 60, false, { model: 'BMW M5 Competition', gear: 2 });
  assert.equal(audio.osc1.frequency.value, 200);
  audio.update(5000, 1, 60, false, { model: 'BMW i4 M50', gear: 1 });
  assert.equal(audio.turboGain.gain.value, 0);
  const sources = audio.sources.size;
  audio.update(5000, 0, 60, false, { model: 'BMW i4 M50', gear: 2 });
  audio.triggerExhaustPop(); audio.triggerBOV();
  assert.equal(audio.sources.size, sources);
  audio.dispose();
});

test('gear changes and throttle lift create bounded transients, completed nodes disconnect', () => {
  const audio = create();
  audio.update(4000, 1, 50, false, { gear: 2 });
  const steady = audio.sources.size;
  audio.update(4000, 1, 50, false, { gear: 3 });
  assert.equal(audio.sources.size, steady + 1);
  const shot = [...audio.sources].at(-1);
  shot.onended();
  assert.ok(shot.disconnected);
  assert.equal(audio.sources.size, steady);
  audio.update(4000, 0, 50, false, { gear: 3 });
  assert.equal(audio.sources.size, steady + 3);
  audio.update(4000, 1, 50, false, { gear: 3 });
  audio.update(4000, 0, 50, false, { gear: 3 });
  assert.equal(audio.sources.size, steady + 3, 'cooldown prevents repeated lift crackles');
  audio.dispose();
});

test('mute restores chosen volume, including edits while muted and context restart', () => {
  const audio = create();
  audio.setMasterVolume(0.23); audio.toggleMute();
  assert.equal(audio.masterGain.gain.value, 0);
  audio.setMasterVolume(0.17); audio.setSampleRate(48000);
  assert.equal(audio.masterGain.gain.value, 0);
  audio.toggleMute();
  assert.equal(audio.masterGain.gain.value, 0.17);
  audio.dispose();
});

test('rate changes and dispose stop sources, release nodes, and close old contexts', () => {
  const audio = create(); audio.triggerExhaustPop();
  const previous = audio.ctx, sources = [...audio.sources], nodes = [...audio.nodes];
  audio.setSampleRate(22050);
  assert.equal(previous.state, 'closed');
  assert.ok(sources.every(source => source.stopped && source.onended === null));
  assert.ok(nodes.every(node => node.disconnected));
  assert.equal(audio.ctx.sampleRate, 22050);
  const current = audio.ctx;
  audio.dispose(); audio.dispose();
  assert.equal(current.state, 'closed');
  assert.equal(audio.sources.size, 0); assert.equal(audio.nodes.size, 0);
  audio.init(); assert.equal(audio.initialized, true); audio.dispose();
});

test('horn exists, respects channel/mute, and repeated key events are rate-limited', () => {
  const audio = create(), steady = audio.sources.size;
  audio.setChannelEnabled('horn', false); audio.triggerHorn();
  assert.equal(audio.sources.size, steady);
  audio.setChannelEnabled('horn', true); audio.toggleMute(); audio.triggerHorn();
  assert.equal(audio.sources.size, steady);
  audio.toggleMute(); audio.triggerHorn(); audio.triggerHorn();
  assert.equal(audio.sources.size, steady + 2);
  audio.dispose();
});

test('held horn remains active until released', () => {
  const audio = create(), steady = audio.sources.size;
  audio.startHorn();
  assert.equal(audio.sources.size, steady + 2);
  audio.startHorn();
  assert.equal(audio.sources.size, steady + 2);
  audio.stopHorn();
  assert.equal(audio.sources.size, steady);
  audio.dispose();
});

test('road and wind noise depend on speed magnitude and tire noise requires actual slip', () => {
  const audio = create();
  audio.update(800, 0, 80, false);
  const road = audio.roadGain.gain.value, wind = audio.windGain.gain.value;
  assert.ok(road > 0 && wind > 0); assert.equal(audio.screechGain.gain.value, 0);
  audio.update(800, 0, -80, false);
  assert.equal(audio.roadGain.gain.value, road); assert.equal(audio.windGain.gain.value, wind);
  audio.update(800, 0, -80, false, { slip: 0.5 });
  assert.ok(audio.screechGain.gain.value > 0);
  audio.setChannelEnabled('tires', false);
  assert.equal(audio.roadGain.gain.value, 0); assert.equal(audio.screechGain.gain.value, 0);
  audio.update(800, 0, 0, false);
  assert.equal(audio.windGain.gain.value, 0);
  audio.dispose();
});


test('combustion is harmonic-rich and every layer follows RPM, including crankshaft bass', () => {
  const audio = create();
  audio.update(900, 0, 0, false, { model: 'M3', gear: 1 });
  assert.equal(audio.osc1.type, 'custom');
  assert.ok(audio.osc1.wave.imaginary.slice(2).filter(value => value > 0).length > 20);
  const bassIdle = audio.osc4.frequency.value;
  audio.update(6000, 1, 90, false, { model: 'M3', gear: 1 });
  assert.equal(audio.osc4.frequency.value, 100);
  assert.ok(audio.osc4.frequency.value > bassIdle);
  assert.equal(audio.osc3.frequency.value, 150);
  audio.update(6000, 1, 90, false, { model: 'i4', gear: 1 });
  assert.equal(audio.osc1.type, 'sine');
  assert.equal(audio.intakeGain.gain.value, 0);
  audio.dispose();
});

test('load opens intake and exhaust timbre and shifts briefly interrupt engine torque sound', () => {
  const audio = create();
  audio.update(4000, 0, 60, false, { gear: 2 });
  const quietIntake = audio.intakeGain.gain.value, closedFilter = audio.filter.frequency.value;
  audio.update(4000, 1, 60, false, { gear: 2 });
  const loadedVolume = audio.engineGain.gain.value;
  assert.ok(audio.intakeGain.gain.value > quietIntake);
  assert.ok(audio.filter.frequency.value > closedFilter);
  audio.update(4000, 1, 60, false, { gear: 3 });
  assert.ok(audio.engineGain.gain.value < loadedVolume * 0.5);
  audio.ctx.currentTime += 0.2;
  audio.update(4000, 1, 60, false, { gear: 3 });
  assert.equal(audio.engineGain.gain.value, loadedVolume);
  audio.setChannelEnabled('engine', false);
  audio.update(6000, 1, 90, false);
  assert.equal(audio.engineGain.gain.value, 0);
  audio.dispose();
});
