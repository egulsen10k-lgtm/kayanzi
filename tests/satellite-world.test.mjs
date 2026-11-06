import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mercatorPosition, planImageryTiles, localTilePlacement, SatelliteWorld, MAX_TILE_ATTEMPTS } from '../src/satellite-world.js';
import { animateWheels, geographicOffset, CarVisualizer3D } from '../src/visualizer.js';

test('imagery tiles remain adjacent, north-up and continuous across the date line', () => {
  const plan = planImageryTiles(0, 179.9999);
  assert.equal(plan.length, 50);
  assert.equal(new Set(plan.map(t => t.key)).size, 50);
  const a = plan.find(t => t.layer === 'fine' && t.x === 2 ** t.z - 1);
  const pa = localTilePlacement(a, 0, 179.9999);
  const pb = localTilePlacement({ ...a, x: 0 }, 0, 179.9999);
  assert.ok(Math.abs(pb.x - pa.x - pa.size) < 0.00001);
  const north = localTilePlacement({ ...a, y: a.y - 1 }, 0, 179.9999);
  assert.ok(Math.abs(north.z - pa.z + pa.size) < 0.00001);
  assert.equal(mercatorPosition(90, 0), null);
  assert.deepEqual(planImageryTiles(NaN, 0), []);
  assert.ok(geographicOffset({ lat: 0, lng: 179.999 }, 0, -179.999).east < 250);
});

function waitForSatelliteIdle(world) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (world.active === 0 && world.queue.length === 0) return resolve();
      if (Date.now() - started > 2000) return reject(new Error('satellite loader did not become idle'));
      setTimeout(check, 0);
    };
    check();
  });
}

function satelliteWorld() {
  const scene = new THREE.Scene();
  const target = { dispatchEvent() {} };
  const renderer = { capabilities: { getMaxAnisotropy: () => 1 } };
  return new SatelliteWorld(scene, target, renderer);
}

test('imagery retries each transient tile once and stays within six concurrent loads', async () => {
  const world = satelliteWorld(), calls = new Map(), active = { value: 0, max: 0 };
  const originalFetch = globalThis.fetch, originalBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async (_url, { signal }) => {
    active.value++;
    active.max = Math.max(active.max, active.value);
    await new Promise(resolve => setTimeout(resolve, 0));
    active.value--;
    if (signal.aborted) throw signal.reason ?? new Error('aborted');
    const key = String(_url).split('/').slice(-3).join('/');
    const count = (calls.get(key) ?? 0) + 1;
    calls.set(key, count);
    if (count === 1) return { ok: false, status: 503 };
    return { ok: true, blob: async () => new Blob(['tile']) };
  };
  globalThis.createImageBitmap = async () => ({ close() {} });
  try {
    world.setLocation(0, 0, true);
    await waitForSatelliteIdle(world);
    assert.equal(MAX_TILE_ATTEMPTS, 2);
    assert.equal(calls.size, 50);
    assert.ok([...calls.values()].every(count => count === 2));
    assert.ok(active.max <= 6);
    assert.equal([...world.entries.values()].filter(entry => entry.loaded).length, 50);
  } finally {
    world.dispose();
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalBitmap;
  }
});

test('failed tiles stop after two attempts and late location results are discarded', async () => {
  const world = satelliteWorld(), calls = new Map(), bitmaps = [];
  const originalFetch = globalThis.fetch, originalBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async url => {
    const key = String(url).split('/').slice(-3).join('/');
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return { ok: false, status: 503 };
  };
  globalThis.createImageBitmap = async () => {
    const bitmap = { closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  };
  try {
    world.setLocation(0, 0, true);
    await waitForSatelliteIdle(world);
    assert.ok([...calls.values()].every(count => count === 2));
    assert.ok([...world.entries.values()].every(entry => entry.failed));
    world.setLocation(1, 1, true);
    world.dispose();
    assert.ok(bitmaps.every(bitmap => bitmap.closed));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalBitmap;
  }
});

test('force replans keep shared in-flight tiles and do not strand attempt-two work', async () => {
  const world = satelliteWorld(), gate = {}, originalFetch = globalThis.fetch, originalBitmap = globalThis.createImageBitmap;
  gate.promise = new Promise(resolve => { gate.release = resolve; });
  globalThis.fetch = async () => {
    await gate.promise;
    return { ok: true, blob: async () => new Blob(['tile']) };
  };
  globalThis.createImageBitmap = async () => ({ close() {} });
  try {
    world.setLocation(0, 0, true);
    while (!world.active) await new Promise(resolve => setTimeout(resolve, 0));
    const inFlight = world.queue.find(entry => entry.controller) ?? [...world.entries.values()].find(entry => entry.controller);
    assert.ok(inFlight);
    inFlight.attempts = MAX_TILE_ATTEMPTS;
    world.setLocation(0, 0, true);
    gate.release();
    await waitForSatelliteIdle(world);
    assert.equal(inFlight.loaded, true);
    assert.ok([...world.entries.values()].every(entry => entry.loaded || entry.failed));
    assert.ok(![...world.entries.values()].some(entry => !entry.loaded && !entry.failed && entry.attempts >= MAX_TILE_ATTEMPTS));
  } finally {
    world.dispose();
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalBitmap;
  }
});

test('wheel rolling follows distance at different frame rates and steering stays independent', () => {
  const wheel = () => ({ spinGroup: new THREE.Group(), steeringPivot: new THREE.Group(), radius: 0.36, isFront: true });
  const a = wheel(), b = wheel();
  for (let i = 0; i < 30; i++) animateWheels([a], 36, 0.5, 1 / 30);
  for (let i = 0; i < 60; i++) animateWheels([b], 36, 0.5, 1 / 60);
  assert.ok(Math.abs(a.spinGroup.rotation.x - b.spinGroup.rotation.x) < 1e-10);
  assert.equal(a.steeringPivot.rotation.y, 0.225);
  const before = a.spinGroup.rotation.x;
  animateWheels([a], -3.6, 0, 0.1);
  assert.ok(a.spinGroup.rotation.x < before);
  assert.equal(a.steeringPivot.rotation.y, 0);
});

test('road surfaces cannot be disabled while driving', () => {
  const view = Object.create(CarVisualizer3D.prototype);
  view.roadGroup = new THREE.Group();
  view.setRoadOverlayEnabled(false);
  assert.equal(view.roadOverlayEnabled,true);
  assert.equal(view.roadGroup.visible,true);
});
