import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mercatorPosition, planImageryTiles, localTilePlacement } from '../src/satellite-world.js';
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
