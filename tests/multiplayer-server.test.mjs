import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createLanServer, sanitizeState } from '../server/lan-server.mjs';

const state = { lat: 41.01, lng: 29.02, heading: 0.4, speed: 42, steering: 0.2, roadHeight: 0.05, model: 'M4 CSL', color: '#abcdef', peerId: 'spoof' };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'bmw-lan-'));
  const distDir = join(directory, 'dist');
  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Game</title>');
  const app = createLanServer({ port: 0, host: '127.0.0.1', distDir, ...options });
  await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, url, directory, distDir };
}

async function connect(url, options) {
  const socket = new WebSocket(url.replace('http:', 'ws:') + '/multiplayer', options);
  const backlog = [];
  const waiting = [];
  socket.on('message', (bytes) => {
    const data = JSON.parse(bytes);
    const index = waiting.findIndex(({ type }) => type === data.type);
    if (index >= 0) waiting.splice(index, 1)[0].resolve(data);
    else backlog.push(data);
  });
  socket.next = (type) => {
    const index = backlog.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2500);
      waiting.push({ type, resolve: (data) => { clearTimeout(timer); resolve(data); } });
    });
  };
  socket.sendJson = (data) => socket.send(JSON.stringify(data));
  await once(socket, 'open');
  return socket;
}

async function joinRoom(socket, room, name = 'Driver') {
  socket.sendJson({ type: 'join', room, name, state });
  return socket.next('welcome');
}

test('LAN rooms relay identity-safe positions, list peers, isolate rooms and remove departing peers', async (t) => {
  const { app, url } = await fixture(t);
  const first = await connect(url);
  const second = await connect(url);
  const outsider = await connect(url);
  const a = await joinRoom(first, 'drive123', 'Alice');
  const b = await joinRoom(second, 'DRIVE123', 'Bob');
  await joinRoom(outsider, 'OTHER123', 'Other');
  assert.equal(a.room, 'DRIVE123');
  assert.equal(a.peers.length, 0);
  assert.equal(b.peers.length, 1);
  assert.equal(b.peers[0].id, a.id);
  assert.equal(b.peers[0].state.peerId, a.id);
  assert.equal((await first.next('peer-join')).id, b.id);
  first.sendJson({ type: 'state', id: b.id, state: { ...state, lat: 42, peerId: b.id, color: '<script>', model: 'not-a-model', ignored: 'secret' } });
  const update = await second.next('state');
  assert.equal(update.id, a.id);
  assert.equal(update.state.peerId, a.id);
  assert.equal(update.state.lat, 42);
  assert.equal(update.state.color, '#718ba1');
  assert.equal(update.state.model, 'M3 Competition');
  assert.equal(update.state.ignored, undefined);
  assert.equal(app.rooms.get('OTHER123').size, 1);
  let outsiderUpdates = 0;
  outsider.on('message', () => outsiderUpdates++);
  first.sendJson({ type: 'state', state: { ...state, lat: 43 } });
  await second.next('state');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(outsiderUpdates, 0);
  first.sendJson({ type: 'leave' });
  assert.equal((await second.next('peer-leave')).id, a.id);
  assert.equal(app.rooms.get('DRIVE123').size, 1);
});

test('malformed messages and invalid state are rejected without disrupting valid clients', async (t) => {
  const { url } = await fixture(t);
  const socket = await connect(url);
  socket.send('{invalid json');
  assert.equal((await socket.next('error')).code, 'invalid-json');
  socket.sendJson({ type: 'state', state });
  assert.equal((await socket.next('error')).code, 'not-joined');
  socket.sendJson({ type: 'join', room: '../BAD' });
  assert.equal((await socket.next('error')).code, 'invalid-room');
  socket.sendJson({ type: 'join', room: 'ROOM', state: { ...state, lat: 91 } });
  assert.equal((await socket.next('error')).code, 'invalid-state');
  const joined = await joinRoom(socket, 'ROOM', 'A\u0000lice');
  assert.ok(joined.id);
  socket.sendJson({ type: 'state', state: { ...state, heading: null } });
  assert.equal((await socket.next('error')).code, 'invalid-state');
  socket.sendJson({ type: 'join', room: 'ROOM' });
  assert.equal((await socket.next('error')).code, 'already-joined');
  const second = await connect(url);
  const b = await joinRoom(second, 'ROOM');
  assert.equal(b.peers[0].name, 'Alice');
});

test('room capacity is enforced and slots become available after disconnect', async (t) => {
  const { app, url } = await fixture(t, { maxPlayers: 2 });
  const a = await connect(url);
  const b = await connect(url);
  const c = await connect(url);
  await joinRoom(a, 'ROOM');
  await joinRoom(b, 'ROOM');
  c.sendJson({ type: 'join', room: 'ROOM', state });
  assert.equal((await c.next('error')).code, 'room-full');
  a.close();
  await b.next('peer-leave');
  assert.equal(app.rooms.get('ROOM').size, 1);
  const welcome = await joinRoom(c, 'ROOM');
  assert.equal(welcome.peers.length, 1);
});

test('slow or idle unjoined sockets are closed and update floods are bounded', async (t) => {
  const { url } = await fixture(t, { joinTimeoutMs: 80, maxMessagesPerSecond: 3 });
  const idle = await connect(url);
  const [idleCode] = await once(idle, 'close');
  assert.equal(idleCode, 1008);
  const flood = await connect(url);
  await joinRoom(flood, 'ROOM');
  const closed = once(flood, 'close');
  for (let i = 0; i < 6; i++) flood.sendJson({ type: 'state', state });
  assert.equal((await closed)[0], 1008);
});

test('static serving blocks traversal and symlinks, exposes LAN addresses and rejects foreign origins', async (t) => {
  const { app, url, directory, distDir } = await fixture(t);
  await writeFile(join(directory, 'private.txt'), 'not public');
  await symlink(join(directory, 'private.txt'), join(distDir, 'private.txt'));
  assert.match(await (await fetch(url)).text(), /<title>Game/);
  assert.equal((await fetch(url + '/private.txt')).status, 403);
  const request = (path) => new Promise((resolve, reject) => {
    http.get(url + path, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(await request('/%2e%2e/private.txt'), 403);
  assert.equal(await request('/%zz'), 400);
  const rebound = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(rebound, 403);
  const info = await (await fetch(url + '/api/multiplayer-info')).json();
  assert.equal(info.protocolVersion, 1);
  assert.equal(info.maxPlayers, 8);
  assert.ok(info.addresses.includes(url + '/'));
  const rejected = new WebSocket(url.replace('http:', 'ws:') + '/multiplayer', { origin: 'https://evil.example' });
  const [error] = await once(rejected, 'error');
  assert.match(error.message, /403/);
  const accepted = await connect(url, { origin: url });
  assert.equal(accepted.readyState, WebSocket.OPEN);
  assert.equal(app.rooms.size, 0);
});

test('state schema preserves bounded car data and never carries arbitrary fields', () => {
  assert.equal(sanitizeState({ ...state, lng: Infinity }, 'real'), null);
  assert.equal(sanitizeState({ ...state, heading: '1' }, 'real'), null);
  const clean = sanitizeState({ ...state, speed: 1e9, steering: -100, roadHeight: 1e9, drivetrain: 'X', constructor: 'bad' }, 'real');
  assert.equal(clean.peerId, 'real');
  assert.equal(clean.speed, 500);
  assert.equal(clean.steering, -1);
  assert.equal(clean.roadHeight, 10000);
  assert.equal(clean.drivetrain, 'AWD');
  assert.equal(sanitizeState({ ...state, robot: true }, 'real').robot, true);
  assert.equal(sanitizeState({ ...state, robot: 1 }, 'real').robot, false);
  assert.equal(Object.hasOwn(clean, 'constructor'), false);
});

const world = (seq = 0) => ({
  v: 1, seq, time: 12,
  traffic: [{ id: 't0', type: 'sedan', seed: 0, lat: 41.01, lng: 29.02, heading: 0, height: .08, speed: 25, opacity: 1 }],
  people: [{ id: 'p0', style: 'casual', lat: 41.01, lng: 29.02, heading: 0, height: .22, state: 'chasing', phase: 1 }], passengers: 0, trunkOpen: 0
});

test('LAN NPC authority relays validated world snapshots, caches for late joiners and rejects guest injection', async (t) => {
  const { app, url } = await fixture(t);
  const a = await connect(url), b = await connect(url), outside = await connect(url);
  const host = await joinRoom(a, 'WORLD'), guest = await joinRoom(b, 'WORLD');
  const elsewhere = await joinRoom(outside, 'ELSEWHERE');
  assert.equal(host.authorityId, host.id); assert.equal(guest.authorityId, host.id);
  assert.equal(elsewhere.authorityId, elsewhere.id);
  a.sendJson({ type: 'world', room: 'WORLD', authorityId: host.id, snapshot: { ...world(3), arbitrary: 'removed' } });
  const received = await b.next('world');
  assert.equal(received.authorityId, host.id); assert.equal(received.room, 'WORLD');
  assert.equal(received.snapshot.people[0].state, 'chasing'); assert.equal(received.snapshot.arbitrary, undefined);
  assert.equal(app.rooms.get('ELSEWHERE').worldSnapshot, null);
  b.sendJson({ type: 'world', room: 'WORLD', authorityId: host.id, snapshot: world(500) });
  assert.equal((await b.next('error')).code, 'not-authority');
  assert.equal(app.rooms.get('WORLD').worldSeq, 3);
  a.sendJson({ type: 'world', room: 'ELSEWHERE', authorityId: host.id, snapshot: world(4) });
  assert.equal((await a.next('error')).code, 'invalid-world');
  a.sendJson({ type: 'world', room: 'WORLD', authorityId: host.id, snapshot: { ...world(4), people: Array(25).fill(world().people[0]) } });
  assert.equal((await a.next('error')).code, 'invalid-world');
  a.sendJson({ type: 'world', room: 'WORLD', authorityId: host.id, snapshot: world(2) });
  a.sendJson({ type: 'world', room: 'WORLD', authorityId: host.id, snapshot: world(5) });
  assert.equal((await b.next('world')).snapshot.seq, 5);
  const c = await connect(url), late = await joinRoom(c, 'WORLD');
  assert.equal(late.authorityId, host.id);
  assert.equal((await c.next('world')).snapshot.seq, 5);
});

test('LAN host departure elects one authority and resets sequence state without accepting old-host snapshots', async (t) => {
  const { app, url } = await fixture(t);
  const a = await connect(url), b = await connect(url), c = await connect(url);
  const host = await joinRoom(a, 'MIGRATE'), successor = await joinRoom(b, 'MIGRATE');
  await joinRoom(c, 'MIGRATE');
  a.sendJson({ type: 'world', room: 'MIGRATE', authorityId: host.id, snapshot: world(100) });
  await b.next('world'); await c.next('world');
  a.close();
  const elected = await b.next('authority');
  assert.equal(elected.authorityId, successor.id); assert.equal(elected.room, 'MIGRATE');
  assert.equal((await c.next('authority')).authorityId, successor.id);
  assert.equal(app.rooms.get('MIGRATE').worldSnapshot, null);
  assert.equal(app.rooms.get('MIGRATE').worldSeq, -1);
  b.sendJson({ type: 'world', room: 'MIGRATE', authorityId: host.id, snapshot: world(101) });
  assert.equal((await b.next('error')).code, 'invalid-world');
  b.sendJson({ type: 'world', room: 'MIGRATE', authorityId: successor.id, snapshot: world(0) });
  const next = await c.next('world');
  assert.equal(next.authorityId, successor.id); assert.equal(next.snapshot.seq, 0);
  assert.equal(app.rooms.get('MIGRATE').worldSeq, 0);
});

test('LAN relays a bounded full NPC scene larger than a driver-state packet', async (t) => {
  const { url } = await fixture(t);
  const a = await connect(url), b = await connect(url);
  const host = await joinRoom(a, 'FULLWORLD'); await joinRoom(b, 'FULLWORLD');
  const snapshot = world(1);
  snapshot.traffic = Array.from({ length: 16 }, (_, index) => ({ ...world().traffic[0], id: `t${index}`, seed: index }));
  snapshot.people = Array.from({ length: 24 }, (_, index) => ({ ...world().people[0], id: `p${index}` }));
  const packet = { type: 'world', room: 'FULLWORLD', authorityId: host.id, snapshot };
  assert.ok(JSON.stringify(packet).length > 4096);
  a.sendJson(packet);
  const received = await b.next('world');
  assert.equal(received.snapshot.traffic.length, 16); assert.equal(received.snapshot.people.length, 24);
});
