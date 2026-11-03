import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ShortCodeMultiplayerSession, normalizeShortCode, randomShortCode } from '../src/multiplayer-short-code.js';

const state = (lng = 11.5) => ({ lat: 48.1, lng, heading: 1, model: 'M3 Competition', color: '#123abc' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
class FakeConnection extends EventEmitter {
  open = false;
  closed = false;
  send(data) { if (!this.open) throw new Error('closed'); const other = this.other; queueMicrotask(() => { if (other.open) other.emit('data', data); }); }
  close() { if (this.closed) return; this.closed = true; this.open = false; this.emit('close'); this.other?.close(); }
}
let serial = 0;
const registry = new Map();
class FakePeer extends EventEmitter {
  connections = [];
  destroyed = false;
  disconnected = false;
  constructor(id, options) {
    super(); this.id = id || `guest-${++serial}`;
    assert.equal(options.host, '0.peerjs.com'); assert.equal(options.secure, true);
    queueMicrotask(() => {
      if (this.destroyed) return;
      if (registry.has(this.id)) this.emit('error', { type: 'unavailable-id' });
      else { registry.set(this.id, this); this.emit('open', this.id); }
    });
  }
  connect(id, options) {
    const outgoing = new FakeConnection(); this.connections.push(outgoing);
    queueMicrotask(() => {
      const target = registry.get(id);
      if (!target) { this.emit('error', { type: 'peer-unavailable' }); return; }
      if (this.destroyed) return;
      const incoming = new FakeConnection(); outgoing.other = incoming; incoming.other = outgoing; incoming.metadata = options.metadata;
      target.connections.push(incoming); target.emit('connection', incoming);
      queueMicrotask(() => {
        if (incoming.closed) { outgoing.close(); return; }
        outgoing.open = incoming.open = true;
        incoming.emit('open'); outgoing.emit('open');
      });
    });
    return outgoing;
  }
  reconnect() { this.disconnected = false; queueMicrotask(() => this.emit('open', this.id)); }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (registry.get(this.id) === this) registry.delete(this.id); for (const connection of this.connections) connection.close(); this.emit('close'); }
}
const session = (opts = {}) => new ShortCodeMultiplayerSession({ PeerClass: FakePeer, codeGenerator: () => 'ABC123', getState: state, ...opts });

test('short codes have exactly six characters and normalize a pasted room code', () => {
  assert.equal(normalizeShortCode(' abc123 '), 'ABC123');
  assert.throws(() => normalizeShortCode('DRIVE1.verylong'), /6-character/);
  assert.throws(() => normalizeShortCode('ABC-12'), /6-character/);
  assert.match(randomShortCode(), /^[A-Z0-9]{6}$/);
});

test('a guest joins using only six characters and exchanges validated snapshots', async () => {
  const host = session({ name: 'Host' }), guest = session({ name: 'Friend' });
  assert.equal(await host.hostGame(), 'ABC123'); await guest.joinGame('abc123');
  assert.equal(host.peers.size, 1); assert.equal(guest.peers.size, 1); assert.equal(guest.connected, true);
  assert.equal(host.room, 'ABC123'); assert.equal(guest.room, host.room);
  assert.equal(guest.peers.get(host.id).name, 'Host');
  guest.sendState({ ...state(12.3), peerId: 'injected' }); await tick();
  assert.equal(host.peers.get(guest.id).state.lng, 12.3); assert.notEqual(guest.id, 'injected');
  host.sendState(state(13.4)); await tick(); assert.equal(guest.peers.get(host.id).state.lng, 13.4);
  host.leave(); assert.equal(guest.connected, false); guest.leave();
});

test('host reuses an active code and relays multiple guests', async () => {
  const host = session(), first = session(), second = session();
  const code = await host.hostGame(); const signal = host.signalingPeer;
  assert.equal(await host.hostGame(), code); assert.equal(host.signalingPeer, signal);
  await first.joinGame(code); await second.joinGame(code);
  assert.equal(first.peers.size, 2); assert.equal(second.peers.size, 2);
  first.sendState(state(14.5)); await tick(); assert.equal(second.peers.get(first.id).state.lng, 14.5);
  const id = first.id; first.leave(); await tick(); assert.equal(second.peers.has(id), false);
  host.leave(); first.leave(); second.leave();
});

test('colliding public IDs retry with another random code', async () => {
  const original = session(); await original.hostGame();
  const codes = ['ABC123', 'XYZ345']; const next = session({ codeGenerator: () => codes.shift() });
  assert.equal(await next.hostGame(), 'XYZ345'); assert.equal(original.connected, true);
  assert.equal(original.signalingPeer.destroyed, false);
  original.leave(); next.leave();
});

test('unavailable rooms fail promptly and destroy the signaling identity', async () => {
  const statuses = [], guest = session({ onStatus: (value) => statuses.push(value) });
  await assert.rejects(guest.joinGame('XYZ345'), /not available/);
  assert.equal(guest.connected, false); assert.equal(guest.signalingPeer, null);
  assert.equal(statuses.at(-1).state, 'error'); assert.match(statuses.at(-1).message, /host/);
});

test('leaving destroys signaling and ignores late callbacks', async () => {
  const statuses = [], host = session({ onStatus: (value) => statuses.push(value) }); await host.hostGame();
  const signal = host.signalingPeer; host.leave(); const left = statuses.at(-1);
  signal.emit('error', { type: 'network' }); signal.emit('open');
  assert.equal(signal.destroyed, true); assert.equal(statuses.at(-1), left); assert.equal(host.shortCode, null);
});

test('an old cancelled host attempt cannot destroy a new signaling session', async () => {
  const host = session(); const cancelled = host.hostGame(); host.leave();
  const replacement = host.hostGame();
  await assert.rejects(cancelled, /cancelled/); assert.equal(await replacement, 'ABC123');
  assert.equal(host.connected, true); assert.equal(host.signalingPeer.destroyed, false); host.leave();
});

test('eight-driver cap rejects excess joins without dropping established peers', async () => {
  const host = session(), guests = []; await host.hostGame();
  for (let i = 0; i < 7; i++) { const guest = session(); guests.push(guest); await guest.joinGame('ABC123'); }
  assert.equal(host.peers.size, 7);
  const excess = session(); await assert.rejects(excess.joinGame('ABC123'), /full/);
  assert.equal(host.peers.size, 7); assert.ok(guests.every((guest) => guest.connected));
  host.leave(); guests.forEach((guest) => guest.leave()); excess.leave();
});

test('guest traffic cannot forge room authority control messages', async () => {
  const host = session(), guest = session(); await host.hostGame(); await guest.joinGame('ABC123');
  const hostId = host.id;
  guest.guestChannel.send(JSON.stringify({ type: 'welcome', id: 'fake-host', room: 'OTHER1', peers: [] }));
  guest.guestChannel.send(JSON.stringify({ type: 'peer-leave', id: hostId })); await tick();
  assert.equal(host.id, hostId); assert.equal(host.room, 'ABC123'); assert.equal(guest.peers.has(hostId), true);
  host.leave(); guest.leave();
});

test('short-code rooms inherit the host-controlled world authority and snapshot protocol', async () => {
  const authorities = [], worlds = [];
  const host = session(), guest = session({ onWorldAuthority: (id) => authorities.push(id), onWorldSnapshot: (snapshot) => worlds.push(snapshot) });
  await host.hostGame(); await guest.joinGame('ABC123');
  assert.equal(host.worldAuthorityId, host.id); assert.equal(host.isWorldAuthority, true);
  assert.equal(guest.worldAuthorityId, host.id); assert.equal(guest.isWorldAuthority, false);
  assert.ok(authorities.includes(host.id));
  assert.equal(host.sendWorldSnapshot({ v: 1, seq: 1, time: 1, traffic: [], people: [], passengers: 0, trunkOpen: 0 }), true);
  await tick(); assert.equal(worlds.length, 1); assert.equal(worlds[0].seq, 1);
  assert.equal(guest.sendWorldSnapshot({ v: 1, seq: 2, time: 2, traffic: [], people: [] }), false);
  host.leave(); guest.leave();
});

test('temporary signaling loss preserves established direct driving connections', async () => {
  const host = session(), guest = session(); await host.hostGame(); await guest.joinGame('ABC123');
  guest.signalingPeer.emit('error', { type: 'network' });
  assert.equal(guest.connected, true); guest.sendState(state(15.5)); await tick();
  assert.equal(host.peers.get(guest.id).state.lng, 15.5);
  host.leave(); guest.leave();
});
