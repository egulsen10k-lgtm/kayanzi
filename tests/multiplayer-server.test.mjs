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
  assert.equal(Object.hasOwn(clean, 'constructor'), false);
});
