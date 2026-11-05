import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerSession, sanitizeState, sanitizeName, encodeConnectionCode, decodeConnectionCode, lanSocketUrl } from '../src/multiplayer.js';

const state = (lng = 11.5) => ({ lat: 48.1, lng, heading: 2, speed: 20, model: 'M3 Competition', color: '#123abc' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class Channel {
  readyState = 'connecting'; bufferedAmount = 0;
  send(data) { if (this.readyState !== 'open') throw new Error('not open'); const other = this.other; queueMicrotask(() => { if (other.readyState === 'open') other.onmessage?.({ data }); }); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.onclose?.(); if (this.other?.readyState !== 'closed') this.other?.close(); }
}
let pcSequence = 0;
const offers = new Map();
class FakeRTC {
  constructor(configuration) { assert.deepEqual(configuration, { iceServers: [] }); this.key = ++pcSequence; this.iceGatheringState = 'complete'; this.connectionState = 'new'; }
  createDataChannel() { return this.channel = new Channel(); }
  async createOffer() { offers.set(this.key, this); return { type: 'offer', sdp: `v=0\r\na=offer:${this.key}` }; }
  async createAnswer() { return { type: 'answer', sdp: `v=0\r\na=answer:${this.host.key}` }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) {
    if (d.type === 'offer') {
      this.host = offers.get(Number(d.sdp.split(':')[1])); this.host.guest = this;
      this.channel = new Channel(); this.channel.other = this.host.channel; this.host.channel.other = this.channel;
      this.ondatachannel?.({ channel: this.channel });
    } else {
      this.channel.readyState = this.guest.channel.readyState = 'open';
      this.connectionState = this.guest.connectionState = 'connected';
      queueMicrotask(() => { this.channel.onopen?.(); this.guest.channel.onopen?.(); });
    }
  }
  close() { if (this.connectionState === 'closed') return; this.connectionState = 'closed'; this.channel?.close(); this.onconnectionstatechange?.(); }
  addEventListener() {}
  removeEventListener() {}
}
const makeSession = (overrides = {}) => new MultiplayerSession({ getState: state, RTCPeerConnectionClass: FakeRTC, ...overrides });
async function pair(host, guest) { const offer = await host.createOffer(); const answer = await guest.acceptOffer(offer); await host.acceptAnswer(answer); await tick(); }

test('snapshot validation rejects invalid positions and discards untrusted properties', () => {
  assert.equal(sanitizeState({ ...state(), lat: NaN }, 'trusted'), null);
  assert.equal(sanitizeState({ ...state(), lng: 181 }, 'trusted'), null);
  assert.equal(sanitizeState({ ...state(), heading: Infinity }, 'trusted'), null);
  const clean = sanitizeState({ ...state(), peerId: 'spoof', speed: 1e20, model: '<script>', color: 'red', arbitrary: true }, 'trusted');
  assert.equal(clean.peerId, 'trusted'); assert.equal(clean.speed, 500); assert.equal(clean.model, 'M3 Competition'); assert.equal(clean.color, '#718ba1'); assert.equal(clean.arbitrary, undefined);
  assert.equal(sanitizeState({ ...state(), robot: true }, 'trusted').robot, true);
  assert.equal(sanitizeState({ ...state(), robot: 'true' }, 'trusted').robot, false);
  assert.equal(sanitizeName('<Guest>\n'), 'Guest');
});

test('connection codes preserve UTF8 and reject damaged, expired and wrong-type invitations', () => {
  const packet = { v: 1, type: 'offer', offerId: 'offer-1', hostId: 'host-1', room: 'room-1', created: Date.now(), description: { type: 'offer', sdp: 'v=0\r\na=name:İstanbul' } };
  const code = encodeConnectionCode(packet);
  assert.deepEqual(decodeConnectionCode(code, 'offer'), packet);
  assert.throws(() => decodeConnectionCode(code, 'answer'), /Invalid or expired/);
  assert.throws(() => decodeConnectionCode(code, 'offer', packet.created + 120001), /expired/);
  assert.throws(() => decodeConnectionCode('bad', 'offer'), /complete/);
  assert.throws(() => decodeConnectionCode('DRIVE1.' + 'a'.repeat(100001), 'offer'), /complete/);
});

test('LAN addresses target the room endpoint and reject credentials', () => {
  assert.equal(lanSocketUrl('http://192.168.1.10:3000/game?x=1'), 'ws://192.168.1.10:3000/multiplayer');
  assert.equal(lanSocketUrl('https://game.example'), 'wss://game.example/multiplayer');
  assert.throws(() => lanSocketUrl('file:///etc/passwd'), /local game address/);
  assert.throws(() => lanSocketUrl('http://user:pass@localhost'), /local game address/);
});

test('WebRTC host and guest exchange snapshots with assigned identities and clean up on host leave', async () => {
  const received = [], removed = [];
  const host = makeSession({ name: 'Host', onPeerState: (s) => received.push(s) });
  const guest = makeSession({ name: 'Guest', onPeerLeave: (id) => removed.push(id) });
  await pair(host, guest);
  assert.equal(host.peers.size, 1); assert.equal(guest.peers.size, 1);
  assert.equal(guest.connected, true); assert.equal(host.connected, true);
  assert.equal(guest.peers.get(host.id).name, 'Host');
  guest.sendState({ ...state(12.5), peerId: 'spoofed' }); await tick();
  assert.equal(received.at(-1).peerId, guest.id); assert.equal(received.at(-1).lng, 12.5);
  host.sendState(state(13.5)); await tick(); assert.equal(guest.peers.get(host.id).state.lng, 13.5);
  const hostId = host.id; host.leave(); await tick();
  assert.equal(guest.connected, false); assert.equal(guest.peers.size, 0); assert.ok(removed.includes(hostId));
});

test('direct WebRTC peers measure bounded latency and clear ping timers on leave',async()=>{
  const samples=[];
  const host=makeSession({onLatency:sample=>samples.push(sample)}),guest=makeSession();
  await pair(host,guest);
  assert.equal(host.pingPeer(guest.id),true);
  await tick();
  assert.ok(Number.isFinite(host.latencyMs)&&host.latencyMs>=0&&host.latencyMs<=60000);
  assert.ok(samples.some(sample=>Number.isFinite(sample.latencyMs)));
  host.leave();guest.leave();
  assert.equal(host.pingRecords.size,0);
  assert.equal(host.latencyMs,null);
});

test('peer snapshots with duplicate or out-of-order sequence are ignored',()=>{
  const received=[],session=makeSession({onPeerState:value=>received.push(value)});
  session.id='self';
  session._upsert('remote','Remote',state(12),4);
  session._upsert('remote','Remote',state(13),3);
  assert.equal(received.length,1);
  assert.equal(session.peers.get('remote').state.lng,12);
});

test('host relays multiple guests while rejecting guest-injected peer control messages', async () => {
  const host = makeSession(), first = makeSession({ name: 'One' }), second = makeSession({ name: 'Two' });
  await pair(host, first); await pair(host, second);
  assert.equal(host.peers.size, 2); assert.equal(first.peers.size, 2); assert.equal(second.peers.size, 2);
  first.sendState(state(14.5)); await tick(); assert.equal(second.peers.get(first.id).state.lng, 14.5);
  first.guestChannel.send(JSON.stringify({ type: 'peer-leave', id: second.id }));
  first.guestChannel.send(JSON.stringify({ type: 'welcome', id: 'fake', room: 'fake', peers: [] }));
  await tick(); assert.equal(host.peers.size, 2); assert.equal(second.peers.size, 2);
  const firstId = first.id; first.leave(); await tick();
  assert.equal(second.peers.has(firstId), false); assert.equal(host.peers.has(firstId), false);
  host.leave(); second.leave();
});

test('new invitations invalidate old replies without dropping existing guests', async () => {
  const host = makeSession(), existing = makeSession(); await pair(host, existing);
  const staleGuest = makeSession(); const oldOffer = await host.createOffer(); const oldAnswer = await staleGuest.acceptOffer(oldOffer);
  const freshOffer = await host.createOffer();
  await assert.rejects(host.acceptAnswer(oldAnswer), /does not match/);
  assert.equal(host.peers.size, 1); assert.equal(existing.connected, true);
  const freshGuest = makeSession(); await host.acceptAnswer(await freshGuest.acceptOffer(freshOffer)); await tick();
  assert.equal(host.peers.size, 2);
  staleGuest.leave(); host.leave(); existing.leave(); freshGuest.leave();
});

test('unsupported WebRTC and invalid room codes fail with actionable errors', async () => {
  const session = makeSession({ RTCPeerConnectionClass: null });
  await assert.rejects(session.createOffer(), /WebRTC/); assert.equal(session.connected, false);
  await assert.rejects(session.connectLan({ url: 'http://localhost', room: '!' }), /Room codes/);
});

class FakeSocket {
  static instances = [];
  readyState = 0; bufferedAmount = 0; sent = [];
  constructor(url) { this.url = url; FakeSocket.instances.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

test('LAN reconnect discards stale socket updates and removes previous peer state', async () => {
  const removed = [], statuses = [];
  const session = makeSession({ WebSocketClass: FakeSocket, onPeerLeave: (id) => removed.push(id), onStatus: (s) => statuses.push(s) });
  const firstConnect = session.connectLan({ url: 'http://localhost:3000', room: 'one' });
  const first = FakeSocket.instances.at(-1); first.open(); assert.equal(first.sent[0].room, 'ONE');
  first.message({ type: 'welcome', id: 'self-1', room: 'ONE', peers: [{ id: 'other', name: 'Other', state: state() }] }); await firstConnect;
  assert.equal(session.peers.size, 1);
  const staleHandler = first.onmessage;
  const secondConnect = session.connectLan({ url: 'http://localhost:3000', room: 'two' });
  const second = FakeSocket.instances.at(-1); second.open(); second.message({ type: 'welcome', id: 'self-2', room: 'TWO', peers: [] }); await secondConnect;
  staleHandler({ data: JSON.stringify({ type: 'peer-join', id: 'ghost', state: state() }) });
  assert.equal(session.peers.size, 0); assert.ok(removed.includes('other')); assert.equal(session.id, 'self-2');
  session.leave(); assert.equal(session.connected, false); assert.equal(statuses.at(-1).state, 'offline');
});

test('eight-driver limit is enforced without evicting existing guests', async () => {
  const host = makeSession(), guests = [];
  for (let i = 0; i < 7; i++) { const guest = makeSession(); guests.push(guest); await pair(host, guest); }
  assert.equal(host.peers.size, 7);
  await assert.rejects(host.createOffer(), /8 drivers/);
  assert.equal(host.peers.size, 7); assert.ok(guests.every((g) => g.connected));
  host.leave(); guests.forEach((g) => g.leave());
});

test('leaving during asynchronous pairing cannot return a stale reply', async () => {
  const host = makeSession(), guest = makeSession();
  const offer = await host.createOffer();
  const reply = guest.acceptOffer(offer);
  guest.leave();
  await assert.rejects(reply, /cancelled/);
  assert.equal(guest.connected, false); host.leave();
});

test('fatal LAN refusal closes the socket and retains its actionable error status', async () => {
  const statuses = [];
  const session = makeSession({ WebSocketClass: FakeSocket, onStatus: (status) => statuses.push(status) });
  const joining = session.connectLan({ url: 'http://localhost', room: 'FULL' });
  const socket = FakeSocket.instances.at(-1); socket.open(); socket.message({ type: 'error', message: 'Room is full.' });
  await assert.rejects(joining, /Room is full/);
  assert.equal(socket.readyState, 3); assert.equal(session.socket, null); assert.equal(session.connected, false);
  assert.equal(statuses.at(-1).state, 'error'); assert.equal(statuses.at(-1).message, 'Room is full.');
});

test('synchronous WebSocket construction failures clean up joining state', async () => {
  class ForbiddenSocket { constructor() { throw new Error('blocked'); } }
  const statuses = [], session = makeSession({ WebSocketClass: ForbiddenSocket, onStatus: (status) => statuses.push(status) });
  await assert.rejects(session.connectLan({ url: 'http://localhost', room: 'ABC' }), /browser permissions/);
  assert.equal(session.connected, false); assert.equal(session.socket, null); assert.equal(statuses.at(-1).state, 'error');
});

test('host disconnects an abusive guest while preserving other peers', async () => {
  const host = makeSession(), first = makeSession(), second = makeSession();
  await pair(host, first); await pair(host, second);
  const abusiveId = first.id;
  for (let i = 0; i < 45; i++) first.sendState(state());
  await tick();
  assert.equal(first.connected, false); assert.equal(host.peers.has(abusiveId), false); assert.equal(second.connected, true);
  host.leave(); first.leave(); second.leave();
});

test('unexpected duplicate welcome cannot replace an established session identity', async () => {
  const session = makeSession({ WebSocketClass: FakeSocket });
  const joining = session.connectLan({ url: 'http://localhost', room: 'ABC' });
  const socket = FakeSocket.instances.at(-1); socket.open(); socket.message({ type: 'welcome', id: 'real', room: 'ABC', peers: [] }); await joining;
  socket.message({ type: 'welcome', id: 'replacement', room: 'ABC', peers: [{ id: 'ghost', state: state() }] });
  assert.equal(session.id, 'real'); assert.equal(session.peers.size, 0); session.leave();
});

test('a delayed answer acceptance cannot overwrite a replacement session status', async () => {
  let finishAnswer;
  const deferred = new Promise((resolve) => { finishAnswer = resolve; });
  class DelayedAnswerRTC extends FakeRTC {
    async setRemoteDescription(description) {
      await super.setRemoteDescription(description);
      if (description.type === 'answer') await deferred;
    }
  }
  const statuses = [], host = makeSession({ RTCPeerConnectionClass: DelayedAnswerRTC, onStatus: (status) => statuses.push(status) });
  const guest = makeSession();
  const offer = await host.createOffer(), answer = await guest.acceptOffer(offer);
  const accepting = host.acceptAnswer(answer);
  host.leave();
  const replacementOffer = await host.createOffer();
  const replacementStatus = statuses.at(-1);
  finishAnswer();
  await assert.rejects(accepting, /cancelled/);
  assert.equal(statuses.at(-1), replacementStatus);
  assert.equal(host.pending.offerId, decodeConnectionCode(replacementOffer, 'offer').offerId);
  host.leave(); guest.leave();
});

test('a delayed offer creation cannot publish a status after leaving', async () => {
  let finishOffer;
  class DelayedOfferRTC extends FakeRTC {
    async createOffer() {
      const offer = await super.createOffer();
      await new Promise((resolve) => { finishOffer = resolve; });
      return offer;
    }
  }
  const statuses = [], host = makeSession({ RTCPeerConnectionClass: DelayedOfferRTC, onStatus: (status) => statuses.push(status) });
  const creating = host.createOffer();
  await tick(); host.leave(); const leftStatus = statuses.at(-1); finishOffer();
  await assert.rejects(creating, /cancelled/);
  assert.equal(statuses.at(-1), leftStatus); assert.equal(host.pending, null); assert.equal(host.channels.size, 0);
});

const worldSnapshot = (seq = 0) => ({ v: 1, seq, time: 10, traffic: [], people: [], passengers: 0, trunkOpen: 0 });

test('WebRTC only the host publishes shared NPC snapshots and late joiners receive the cached world', async () => {
  const seen = [], host = makeSession(), first = makeSession({ onWorldSnapshot: value => seen.push(value) });
  await pair(host, first);
  assert.equal(host.isWorldAuthority, true); assert.equal(first.isWorldAuthority, false);
  assert.equal(first.worldAuthorityId, host.id);
  assert.equal(host.sendWorldSnapshot(worldSnapshot(1)), true); await tick();
  assert.equal(seen.at(-1).seq, 1);
  assert.equal(first.sendWorldSnapshot(worldSnapshot(2)), false);
  first.guestChannel.send(JSON.stringify({ type: 'world', room: host.room, authorityId: host.id, snapshot: worldSnapshot(200) }));
  await tick(); assert.equal(host.latestWorldSnapshot.seq, 1);
  const secondSeen = [], second = makeSession({ onWorldSnapshot: value => secondSeen.push(value) });
  await pair(host, second); assert.equal(secondSeen.at(-1).seq, 1);
  host.sendWorldSnapshot(worldSnapshot(3)); await tick();
  assert.equal(seen.at(-1).seq, 3); assert.equal(secondSeen.at(-1).seq, 3);
  host.leave(); first.leave(); second.leave();
});

test('LAN world packets require server authority and matching room, reject stale data and reset after migration', async () => {
  const seen = [], authority = [], session = makeSession({ WebSocketClass: FakeSocket, onWorldSnapshot: snapshot => seen.push(snapshot), onWorldAuthority: id => authority.push(id) });
  const joining = session.connectLan({ url: 'http://localhost', room: 'ABC' });
  const socket = FakeSocket.instances.at(-1); socket.open();
  socket.message({ type: 'welcome', id: 'self', room: 'ABC', authorityId: 'host', peers: [] }); await joining;
  const packet = { type: 'world', room: 'ABC', authorityId: 'host', snapshot: worldSnapshot(9) };
  socket.message(packet); assert.equal(seen.length, 1);
  socket.message({ ...packet, room: 'OTHER' }); socket.message({ ...packet, authorityId: 'spoof' }); socket.message(packet);
  socket.message({ ...packet, snapshot: { ...worldSnapshot(10), people: Array(25).fill({}) } });
  assert.equal(seen.length, 1);
  socket.message({ type: 'authority', room: 'OTHER', authorityId: 'self' }); assert.equal(session.isWorldAuthority, false);
  socket.message({ type: 'authority', room: 'ABC', authorityId: 'new-host' });
  socket.message({ ...packet, authorityId: 'host', snapshot: worldSnapshot(99) }); assert.equal(seen.length, 1);
  socket.message({ ...packet, authorityId: 'new-host', snapshot: worldSnapshot(0) }); assert.equal(seen.at(-1).seq, 0);
  socket.message({ type: 'authority', room: 'ABC', authorityId: 'self' }); assert.equal(session.isWorldAuthority, true);
  assert.equal(session.sendWorldSnapshot(worldSnapshot(0)), true);
  assert.equal(socket.sent.at(-1).authorityId, 'self');
  session.leave(); assert.equal(session.worldAuthorityId, null); assert.equal(authority.at(-1), null);
});

test('frozen NPC callback aliases publish once per player tick and preserve solo/host authority getters', async () => {
  let captures = 0;
  const received = [];
  const host = makeSession({ getNpcs: () => worldSnapshot(captures++) });
  const guest = makeSession({ onNpcs: value => received.push(value) });
  assert.equal(host.npcAuthority, true); assert.equal(host.host, false);
  await pair(host, guest);
  assert.equal(host.host, true); assert.equal(host.npcAuthority, true); assert.equal(guest.npcAuthority, false);
  host.sendState(state()); await tick();
  assert.equal(captures, 1); assert.equal(received.length, 1); assert.equal(received[0].seq, 0);
  guest.sendState(state()); await tick(); assert.equal(captures, 1);
  host.leave(); guest.leave(); assert.equal(guest.npcAuthority, true); assert.equal(host.host, false);
});
