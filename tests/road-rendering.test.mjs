import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarVisualizer3D } from '../src/visualizer.js';

test('real-road centerlines become drivable-width ground surfaces', () => {
  const view = Object.create(CarVisualizer3D.prototype);
  view.roadGroup = new THREE.Group();
  view.setRoads({ center: { lat: 0, lng: 0 }, roads: [
    { width: 6, points: [[0, 0], [0, 100]], highway: 'residential' }
  ] });
  const surface = view.roadGroup.getObjectByName('asphalt');
  surface.geometry.computeBoundingBox();
  assert.equal(surface.geometry.boundingBox.min.x, -3);
  assert.equal(surface.geometry.boundingBox.max.x, 3);
  assert.equal(surface.geometry.boundingBox.min.z, -103);
  assert.equal(surface.geometry.boundingBox.max.z, 3);
  assert.ok(view.roadGroup.getObjectByName('curbs').geometry.attributes.position.count > 0);
  const oldGeometry = surface.geometry;
  let disposed = false;
  oldGeometry.addEventListener('dispose', () => { disposed = true; });
  view.setRoads({ center: { lat: 10, lng: 10 }, roads: [] });
  assert.ok(disposed, 'old geographic patch must release GPU geometry');
  assert.deepEqual(view.roadCenter, { lat: 10, lng: 10 });
});

test('returning to a recently loaded destination reuses road data', async () => {
  const view = Object.create(CarVisualizer3D.prototype);
  view.roadGroup = new THREE.Group();
  view.roadCache = new Map();
  view.container = new EventTarget();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ elements: [] }) };
  };
  try {
    await view.loadRoadsAt(48, 11);
    await view.loadRoadsAt(35, 139);
    await view.loadRoadsAt(48, 11);
    assert.equal(requests, 2);
    assert.deepEqual(view.roadCenter, {lat:48,lng:11});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streaming cannot replace safe current roads with an uncovered district', async () => {
  const view=Object.create(CarVisualizer3D.prototype);
  view.roadGroup=new THREE.Group(); view.roadCache=new Map();view.container=new EventTarget();
  const old={center:{lat:0,lng:0},roads:[{width:8,highway:'residential',points:[[0,-50],[0,50]]}]};
  view.setRoads(old);view.lastPosition={lat:0,lng:0};view.lastHeading=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({elements:[]})});
  try {
    await assert.rejects(view.loadRoadsAt(.001,0,true),/cover the car safely/);
    assert.deepEqual(view.roadCenter,old.center);
    assert.ok(view.roadGroup.getObjectByName('asphalt'));
    assert.ok(view.roadRetryAt>performance.now());
  } finally {globalThis.fetch=originalFetch;}
});
