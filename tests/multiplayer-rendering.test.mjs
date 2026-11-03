import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { CarVisualizer3D } from '../src/visualizer.js';

test('remote drivers retain their identity while changing models and release scene resources on leave', () => {
  const view = Object.create(CarVisualizer3D.prototype);
  view.scene = new Scene();
  view.peerCars = new Map();
  const state = { peerId: 'guest-one', lat: 48, lng: 11, heading: 0, model: 'M3 Competition', color: '#112233' };
  view.updatePeerCar(state);
  const old = view.peerCars.get(state.peerId);
  assert.equal(old.wheels.length, 4);
  assert.equal(old.group.parent, view.scene);
  let disposed = 0;
  old.group.traverse(object => object.geometry?.addEventListener('dispose', () => disposed++));
  view.updatePeerCar({ ...state, model: 'M4 CSL', color: '#abcdef' });
  const current = view.peerCars.get(state.peerId);
  assert.equal(view.peerCars.size, 1);
  assert.notEqual(old.group, current.group);
  assert.equal(old.group.parent, null);
  assert.ok(disposed > 0);
  assert.equal(current.group.name, 'bmw-m4');
  assert.equal(current.color, '#abcdef');
  view.removePeerCar(state.peerId);
  assert.equal(current.group.parent, null);
  assert.equal(view.peerCars.size, 0);
  view.removePeerCar(state.peerId);
});

test('invalid geographic snapshots do not create or replace a remote vehicle', () => {
  const view = Object.create(CarVisualizer3D.prototype);
  view.scene = new Scene();
  view.peerCars = new Map();
  view.updatePeerCar({ peerId: 'bad', lat: NaN, lng: 11, heading: 0 });
  view.updatePeerCar({ peerId: 'bad', lat: 48, lng: Infinity, heading: 0 });
  assert.equal(view.peerCars.size, 0);
  assert.equal(view.scene.children.length, 0);
});
