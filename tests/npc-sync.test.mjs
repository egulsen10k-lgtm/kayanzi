import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NpcSync, serializeNpcs, applyNpcs } from '../src/npc-sync.js';
import { sanitizeWorldSnapshot, NPC_BODY_NAMES } from '../src/npc-state.js';
import { projectCoordinate } from '../src/road-network.js';
import { localToCoordinate } from '../src/road-safety.js';

const point = { lat: 41.1, lng: 29.2 };
const traffic = { id: 't1', type: 'police', seed: 1, ...point, heading: .5, height: .08, speed: 20, opacity: 1, braking: false, alert: true };
const person = { id: 'p0', style: 'casual', ...point, heading: 1, height: .22, state: 'chasing', phase: .8 };
const snapshot = (seq = 0) => ({ v: 1, seq, time: 25, traffic: [{ ...traffic }], people: [{ ...person }], passengers: 0, trunkOpen: 0 });
function fixtures(authority = false) {
  const session = { connected: true, worldAuthorityId: 'host', isWorldAuthority: authority, sent: [], sendWorldSnapshot(value) { this.sent.push(value); } };
  const manager = { root: new THREE.Group(), maxCars: 8, time: 25, cars: [], origin: point, cleared: 0, resets: [], clear() { this.cleared++; this.cars = []; this.origin = null; this.graph = null; }, reset(network, player) { this.resets.push({ network, player, maxCars: this.maxCars }); this.origin = network.center; this.graph = {}; }, playerPoint() { return { x: 0, y: 0 }; }, controls: { update() {}, phase() { return 'green'; }, stopDistance() { return 0; } }, signs: { nearby() { return null; } } };
  const pedestrians = { network: { center: point }, people: [], density: 1, cleared: 0, resets: [], clearNetwork() { this.cleared++; this.people = []; this.network = null; }, reset(network, player, density) { this.resets.push({ network, player, density }); this.network = network; } };
  const view = { group: new THREE.Group(), ragdolls: new Map() };
  const scene = new THREE.Scene();
  const sync = new NpcSync({ session, trafficManager: manager, pedestrians, pedestrianView: view, scene });
  return { sync, session, manager, pedestrians, view, scene };
}

test('world schema rejects oversized, malformed and duplicate data while stripping arbitrary properties', () => {
  const clean = sanitizeWorldSnapshot({ ...snapshot(), extra: 'ignored', traffic: [{ ...traffic, speed: 1e9, evil: true }], people: [{ ...person, arbitrary: true }] });
  assert.equal(clean.extra, undefined); assert.equal(clean.traffic[0].evil, undefined); assert.equal(clean.people[0].arbitrary, undefined);
  assert.equal(clean.traffic[0].speed, 500);
  assert.equal(sanitizeWorldSnapshot({ ...snapshot(), seq: -1 }), null);
  assert.equal(sanitizeWorldSnapshot({ ...snapshot(), traffic: Array(17).fill(traffic) }), null);
  assert.equal(sanitizeWorldSnapshot({ ...snapshot(), people: Array(25).fill(person) }), null);
  assert.equal(sanitizeWorldSnapshot({ ...snapshot(), people: [{ ...person, lat: 100 }] }), null);
  assert.equal(sanitizeWorldSnapshot({ ...snapshot(), traffic: [traffic, traffic] }), null);
  assert.equal(sanitizeWorldSnapshot({ ...snapshot(), people: [{ ...person, state: '<script>' }] }), null);
});

test('authority captures traffic and pedestrians in global coordinates from their separate origins', () => {
  const { sync, manager, pedestrians, session } = fixtures(true);
  const otherCenter = { lat: point.lat + .01, lng: point.lng + .01 };
  manager.origin = point;
  manager.cars = [{ id: 4, type: 'sedan', x: 30, y: 45, heading: .2, speed: 40, roadHeight: .08, opacity: .7 }];
  pedestrians.network = { center: otherCenter };
  pedestrians.people = [{ id: 0, style: 'goth', x: -20, y: 60, heading: .6, state: 'idle', height: .22, phase: 1 }];
  sync.update(.1, point);
  assert.equal(session.sent.length, 1);
  const world = session.sent[0];
  const expectedCar = localToCoordinate([30, 45], point), expectedPerson = localToCoordinate([-20, 60], otherCenter);
  assert.ok(Math.abs(world.traffic[0].lat - expectedCar.lat) < 1e-10);
  assert.ok(Math.abs(world.people[0].lng - expectedPerson.lng) < 1e-10);
  assert.equal(world.traffic[0].id, 't4');
  assert.equal(world.people[0].state, 'idle');
  sync.dispose();
});

test('followers render the same authoritative entities from differing local map origins without simulating local spawns', () => {
  const a = fixtures(), b = fixtures();
  const playerA = { lat: point.lat - .001, lng: point.lng - .001, roadNetwork: { center: { lat: 40, lng: 28 }, roads: [] } };
  const playerB = { lat: point.lat + .002, lng: point.lng + .002, roadNetwork: { center: { lat: 42, lng: 30 }, roads: [] } };
  assert.equal(a.sync.applySnapshot(snapshot()), true); assert.equal(b.sync.applySnapshot(snapshot()), true);
  a.sync.update(.1, playerA); b.sync.update(.1, playerB);
  for (const [entry, player] of [[a, playerA], [b, playerB]]) {
    assert.equal(entry.manager.cars.length, 0);
    assert.equal(entry.manager.resets[0].maxCars, 0);
    assert.equal(entry.manager.maxCars, 8);
    assert.equal(entry.view.group.visible, false);
    assert.equal(entry.sync.traffic.size, 1); assert.equal(entry.sync.people.size, 1);
    const [east, north] = projectCoordinate(point.lat, point.lng, player);
    const replica = entry.sync.traffic.get('t1').group;
    assert.ok(Math.abs(replica.position.x - east) < 1e-5);
    assert.ok(Math.abs(replica.position.z + north) < 1e-5);
  }
  a.sync.dispose(); b.sync.dispose();
});

test('followers reject old snapshots, remove despawned actors and reset on authority migration', () => {
  const { sync, session } = fixtures();
  sync.applySnapshot(snapshot(9));
  assert.equal(sync.applySnapshot(snapshot(8)), false);
  assert.equal(sync.traffic.size, 1);
  sync.applySnapshot({ ...snapshot(10), traffic: [], people: [] });
  assert.equal(sync.traffic.size, 0); assert.equal(sync.people.size, 0);
  session.worldAuthorityId = 'new-host';
  assert.equal(sync.applySnapshot(snapshot(0)), true);
  assert.equal(sync.traffic.size, 1);
  sync.dispose();
});

test('leaving multiplayer or becoming authority removes replicas and restores local simulation once', () => {
  const { sync, session, manager, pedestrians } = fixtures();
  const player = { ...point, roadNetwork: { center: point, roads: [] } };
  sync.applySnapshot(snapshot()); sync.update(.1, player);
  session.isWorldAuthority = true; session.worldAuthorityId = 'self';
  sync.syncRole(player);
  assert.equal(sync.traffic.size, 0); assert.equal(sync.people.size, 0);
  assert.equal(manager.resets.at(-1).maxCars, 8); assert.equal(pedestrians.resets.length, 1);
  const resets = manager.resets.length;
  sync.syncRole(player); assert.equal(manager.resets.length, resets);
  session.connected = false; session.worldAuthorityId = null;
  sync.syncRole(player);
  assert.equal(manager.resets.length, resets);
  sync.dispose();
});

test('authoritative articulated ragdoll poses render without running independent follower ragdoll physics', () => {
  const { sync } = fixtures();
  const bodies = Object.fromEntries(NPC_BODY_NAMES.map(name => [name, [0, name === 'head' ? 1.6 : 1, 0, 0, 0, 0, 1]]));
  const world = { ...snapshot(), people: [{ ...person, state: 'ragdoll', ragdoll: { ...point, height: .08, bodies } }] };
  assert.equal(sync.applySnapshot(world), true);
  sync.update(.1, point);
  const replica = sync.people.get('p0');
  assert.ok(replica.bindings.length > 0);
  assert.ok(replica.bindings.every(binding => binding.mesh.matrixAutoUpdate === false));
  assert.ok(replica.bindings.every(binding => binding.mesh.matrix.elements.every(Number.isFinite)));
  assert.equal(sanitizeWorldSnapshot({ ...world, people: [{ ...world.people[0], ragdoll: { ...point, bodies: { torso: [0, 0, 0] } } }] }), null);
  sync.dispose();
});


test('frozen serialization aliases target the registered managers and avoid a second authority send loop', () => {
  const a = fixtures(true), follower = fixtures();
  a.session.getNpcs = () => serializeNpcs({ pedestrians: a.pedestrians, traffic: a.manager });
  const clean = a.session.getNpcs();
  assert.equal(clean.v, 1); assert.equal(clean.seq, 0);
  a.sync.update(.1, point); assert.equal(a.session.sent.length, 0);
  assert.equal(applyNpcs(snapshot(), { pedestrians: follower.pedestrians, traffic: follower.manager }), true);
  assert.equal(follower.sync.traffic.size, 1);
  assert.equal(serializeNpcs({ traffic: {} }), null);
  assert.equal(applyNpcs(snapshot(), { traffic: {} }), false);
  a.sync.dispose(); follower.sync.dispose();
  assert.equal(serializeNpcs({ traffic: a.manager }), null);
});
