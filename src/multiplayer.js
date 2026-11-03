// Transport-independent driving snapshots. No remote input is executed as game code.
export const MAX_PLAYERS = 8;
export const CONNECTION_CODE_TTL = 120000;
const MAX_CODE_LENGTH = 100000;
const MAX_PACKET_LENGTH = 16384;
const MODELS = new Set(['M3 Competition', 'M4 CSL', 'M5 CS', 'i4 M50 (EV)', 'XM Label Red']);
const noop = () => {};
const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export const sanitizeName = (name) => String(name || 'Driver').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24) || 'Driver';

export function sanitizeState(raw, id) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.lat) || Math.abs(raw.lat) > 90 ||
      !Number.isFinite(raw.lng) || Math.abs(raw.lng) > 180 || !Number.isFinite(raw.heading)) return null;
  const number = (key, min, max, fallback = 0) => Number.isFinite(raw[key]) ? Math.max(min, Math.min(max, raw[key])) : fallback;
  return {
    peerId: id, lat: raw.lat, lng: raw.lng,
    heading: ((raw.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    speed: number('speed', -500, 500), steering: number('steering', -1, 1),
    roadHeight: number('roadHeight', -1000, 10000, .08),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#718ba1',
    model: MODELS.has(raw.model) ? raw.model : 'M3 Competition',
    drivetrain: ['RWD', 'AWD', 'FWD'].includes(raw.drivetrain) ? raw.drivetrain : 'RWD'
  };
}

export function encodeConnectionCode(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `DRIVE1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function decodeConnectionCode(code, expectedType, now = Date.now()) {
  const clean = String(code || '').trim();
  if (clean.length > MAX_CODE_LENGTH || !/^DRIVE1\.[a-zA-Z0-9_-]+$/.test(clean)) throw new Error('Paste the complete DRIVE1 connection code.');
  let data;
  try {
    const binary = atob(clean.slice(7).replace(/-/g, '+').replace(/_/g, '/'));
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch { throw new Error('This connection code is damaged. Copy it again.'); }
  if (data?.v !== 1 || data.type !== expectedType || !validId(data.offerId) ||
      !Number.isFinite(data.created) || now - data.created > CONNECTION_CODE_TTL || data.created > now + 30000 ||
      data.description?.type !== expectedType || typeof data.description.sdp !== 'string' ||
      data.description.sdp.length > 60000 || !data.description.sdp.startsWith('v=0')) {
    throw new Error(`Invalid or expired ${expectedType} code. Ask the host for a fresh invitation.`);
  }
  if (expectedType === 'offer' && (!validId(data.hostId) || !validId(data.room))) throw new Error('Invalid host invitation.');
  return data;
}

export function lanSocketUrl(url) {
  const parsed = new URL(url, globalThis.location?.href || 'http://localhost:3000/');
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use a local game address such as http://192.168.1.20:3000.');
  parsed.protocol = ['https:', 'wss:'].includes(parsed.protocol) ? 'wss:' : 'ws:';
  parsed.pathname = '/multiplayer'; parsed.search = ''; parsed.hash = '';
  if (globalThis.location?.protocol === 'https:' && parsed.protocol === 'ws:') throw new Error('Open the local game address in your browser to join this LAN server, or use connection codes here.');
  return parsed.href;
}

export class MultiplayerSession {
  constructor({ getState = () => null, onPeerState = noop, onPeerLeave = noop, onStatus = noop, onPeers = noop,
    name = 'Driver', WebSocketClass = globalThis.WebSocket, RTCPeerConnectionClass = globalThis.RTCPeerConnection } = {}) {
    Object.assign(this, { getState, onPeerState, onPeerLeave, onStatus, onPeers, WebSocketClass, RTCPeerConnectionClass });
    this.name = sanitizeName(name);
    this.peers = new Map(); this.channels = new Map();
    this.connected = false; this.transport = null; this.room = null; this.id = null;
    this.generation = 0; this.pending = null; this.role = null; this.socket = null;
  }

  _status(state, message) { this.onStatus({ state, message, transport: this.transport, room: this.room, id: this.id }); }
  _peers() { this.onPeers([...this.peers.values()]); }
  _upsert(id, name, state) {
    if (!validId(id) || id === this.id || (!this.peers.has(id) && this.peers.size >= MAX_PLAYERS - 1)) return;
    const sanitized = sanitizeState(state, id);
    const peer = { id, name: sanitizeName(name), state: sanitized || this.peers.get(id)?.state || null };
    this.peers.set(id, peer);
    if (sanitized) this.onPeerState({ ...sanitized, name: peer.name });
    this._peers();
  }
  _remove(id) { if (this.peers.delete(id)) { this.onPeerLeave(id); this._peers(); } }
  _packet(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_PACKET_LENGTH) return null;
    try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch { return null; }
  }
  _send(channel, message) {
    if (!channel || !['open', 1].includes(channel.readyState) || channel.bufferedAmount > 65536) return false;
    try { channel.send(JSON.stringify(message)); return true; } catch { return false; }
  }
  _remoteMessage(message) {
    if (!message) return;
    if (message.type === 'error') { this._status('error', String(message.message || 'Connection refused.').slice(0, 200)); return; }
    if (message.type === 'welcome') {
      if (this.connected) return;
      if (!validId(message.id) || !validId(message.room) || !Array.isArray(message.peers) || message.peers.length > MAX_PLAYERS - 1) return;
      this.id = message.id; this.room = message.room; this.connected = true;
      for (const peer of message.peers) this._upsert(peer.id, peer.name, peer.state);
      this._status('connected', `Connected · ${this.peers.size + 1} drivers`);
      this._peers();
    } else if (this.connected && (message.type === 'state' || message.type === 'peer-join')) {
      this._upsert(message.id, message.name, message.state);
    } else if (this.connected && message.type === 'peer-leave') this._remove(message.id);
  }

  connectLan({ url, room, name = this.name }) {
    const socketUrl = lanSocketUrl(url);
    room = String(room || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,24}$/.test(room)) return Promise.reject(new Error('Room codes use 3–24 letters or numbers.'));
    if (!this.WebSocketClass) return Promise.reject(new Error('This browser does not support WebSocket multiplayer.'));
    this.leave(); this.transport = 'lan'; this.room = room; this.name = sanitizeName(name);
    const generation = this.generation;
    this._status('connecting', 'Connecting to the local room…');
    return new Promise((resolve, reject) => {
      let settled = false, timeout;
      const settle = (error) => { if (settled) return; settled = true; clearTimeout(timeout); error ? reject(error) : resolve(); };
      const fail = (error) => {
        if (generation !== this.generation) return;
        settle(error); this.leave(); this._status('error', error.message);
      };
      let socket;
      try { socket = this.socket = new this.WebSocketClass(socketUrl); }
      catch { fail(new Error('Cannot open the LAN connection. Check the address and browser permissions.')); return; }
      timeout = setTimeout(() => fail(new Error('LAN server did not respond. Check its address and that both devices use the same network.')), 12000);
      this.cancelConnect = () => settle(new Error('Connection cancelled.'));
      socket.onopen = () => { if (generation === this.generation) this._send(socket, { type: 'join', room, name: this.name, state: sanitizeState(this.getState(), this.id) }); };
      socket.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        const message = this._packet(data);
        if (message?.type === 'error' && !this.connected) { fail(new Error(String(message.message || 'Connection refused.').slice(0, 200))); return; }
        this._remoteMessage(message);
        if (this.connected) settle();
      };
      socket.onerror = () => fail(new Error('Cannot reach the LAN server. Check the address, firewall and Wi-Fi.'));
      socket.onclose = () => {
        if (generation !== this.generation) return;
        if (!this.connected) { fail(new Error('The LAN connection closed before joining. Check the room and server address.')); return; }
        this.leave(); this._status('offline', 'Disconnected from the local room. Rejoin to reconnect.');
      };
    });
  }

  _rtc() {
    if (!this.RTCPeerConnectionClass) throw new Error('Connection codes require a browser with WebRTC. Open the published HTTPS game in Chrome, Safari or Firefox.');
    return new this.RTCPeerConnectionClass({ iceServers: [] });
  }
  _gather(pc, generation) {
    if (generation !== this.generation || pc.connectionState === 'closed') return Promise.reject(new Error('Invitation cancelled.'));
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error) => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('connectionstatechange', check); error ? reject(error) : resolve(); };
      const check = () => {
        if (generation !== this.generation || pc.connectionState === 'closed') finish(new Error('Invitation cancelled.'));
        else if (pc.iceGatheringState === 'complete') finish();
      };
      pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('connectionstatechange', check);
      timer = setTimeout(() => finish(new Error('Could not gather a local connection address. Try another browser or the LAN server option.')), 12000);
      check();
    });
  }
  _cancelPending() {
    if (!this.pending) return;
    const pending = this.pending; this.pending = null;
    clearTimeout(pending.timer);
    if (!pending.joined) this.channels.delete(pending.id);
    if (!pending.joined) { pending.pc.close(); try { pending.channel?.close(); } catch {} }
  }
  _broadcast(message, exceptId) {
    for (const [id, peer] of this.channels) if (peer.joined && id !== exceptId) this._send(peer.channel, message);
  }
  _dropHostPeer(id, generation) {
    if (generation !== this.generation) return;
    const peer = this.channels.get(id);
    if (!peer) return;
    this.channels.delete(id); clearTimeout(peer.timer);
    if (this.pending === peer) this.pending = null;
    this._remove(id);
    this._broadcast({ type: 'peer-leave', id });
    try { peer.channel.close(); peer.pc.close(); } catch {}
  }
  _wireHost(peer, generation) {
    const channel = peer.channel;
    channel.onmessage = ({ data }) => {
      if (generation !== this.generation || this.channels.get(peer.id) !== peer) return;
      const now = Date.now();
      if (!peer.rateStart || now - peer.rateStart >= 1000) { peer.rateStart = now; peer.rateCount = 0; }
      if (++peer.rateCount > 40) { this._dropHostPeer(peer.id, generation); return; }
      const message = this._packet(data);
      if (!message) return;
      // A guest is allowed to publish only its own name and driving snapshot.
      if (message.type === 'join' && !peer.joined) {
        if (this.peers.size >= MAX_PLAYERS - 1) { this._send(channel, { type: 'error', message: 'This room is full.' }); this._dropHostPeer(peer.id, generation); return; }
        peer.joined = true; peer.name = sanitizeName(message.name); clearTimeout(peer.timer);
        if (this.pending === peer) this.pending = null;
        const host = { id: this.id, name: this.name, state: sanitizeState(this.getState(), this.id) };
        this._send(channel, { type: 'welcome', id: peer.id, room: this.room, maxPlayers: MAX_PLAYERS, peers: [host, ...this.peers.values()] });
        this._upsert(peer.id, peer.name, message.state);
        this._broadcast({ type: 'peer-join', id: peer.id, name: peer.name, state: sanitizeState(message.state, peer.id) }, peer.id);
        this._status('connected', `Hosting · ${this.peers.size + 1} drivers`);
      } else if (message.type === 'state' && peer.joined) {
        const state = sanitizeState(message.state, peer.id);
        if (!state) return;
        this._upsert(peer.id, peer.name, state);
        this._broadcast({ type: 'state', id: peer.id, name: peer.name, state }, peer.id);
      } else if (message.type === 'leave') this._dropHostPeer(peer.id, generation);
    };
    channel.onclose = () => this._dropHostPeer(peer.id, generation);
    peer.pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(peer.pc.connectionState)) this._dropHostPeer(peer.id, generation);
    };
  }

  async createOffer({ name = this.name } = {}) {
    if (!this.RTCPeerConnectionClass) throw new Error('Connection codes require WebRTC. Open the published HTTPS game in Chrome, Safari or Firefox.');
    if (this.transport !== 'webrtc' || this.role !== 'host') {
      this.leave(); this.transport = 'webrtc'; this.role = 'host'; this.name = sanitizeName(name);
      this.id = makeId('host'); this.room = makeId('room'); this.connected = true;
    }
    if (this.peers.size >= MAX_PLAYERS - 1) throw new Error('This room already has 8 drivers.');
    this._cancelPending();
    const generation = this.generation;
    const pc = this._rtc();
    const peer = { id: makeId('driver'), offerId: makeId('offer'), created: Date.now(), pc, channel: pc.createDataChannel('drive'), joined: false };
    this.pending = peer; this.channels.set(peer.id, peer); this._wireHost(peer, generation);
    peer.timer = setTimeout(() => {
      if (this.pending !== peer) return;
      this._dropHostPeer(peer.id, generation);
      this._status('connected', 'Invitation expired. Create a fresh invitation for your friend.');
    }, CONNECTION_CODE_TTL);
    peer.timer.unref?.();
    this._status('connecting', 'Preparing an invitation for one friend…');
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await this._gather(pc, generation);
      if (this.pending !== peer) throw new Error('Invitation cancelled.');
      this._status('connecting', 'Send this invitation to your friend, then paste their reply.');
      return encodeConnectionCode({ v: 1, type: 'offer', offerId: peer.offerId, hostId: this.id, room: this.room, created: peer.created, description: { type: 'offer', sdp: pc.localDescription.sdp } });
    } catch (error) { this._dropHostPeer(peer.id, generation); throw error; }
  }

  async acceptOffer(code, { name = this.name } = {}) {
    const offer = decodeConnectionCode(code, 'offer');
    this.leave(); this.transport = 'webrtc'; this.role = 'guest'; this.room = offer.room; this.name = sanitizeName(name);
    const generation = this.generation;
    const pc = this.guestPc = this._rtc();
    this._status('connecting', 'Preparing your reply…');
    const timer = this.guestTimer = setTimeout(() => {
      if (generation === this.generation && !this.connected) { this.leave(); this._status('error', 'Pairing timed out. Ask for a fresh invitation and keep both devices on the same Wi-Fi.'); }
    }, CONNECTION_CODE_TTL);
    timer.unref?.();
    pc.ondatachannel = ({ channel }) => {
      if (generation !== this.generation) { channel.close(); return; }
      this.guestChannel = channel;
      channel.onopen = () => { if (generation === this.generation) this._send(channel, { type: 'join', name: this.name, state: sanitizeState(this.getState(), this.id) }); };
      channel.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        this._remoteMessage(this._packet(data));
        if (this.connected) clearTimeout(timer);
      };
      channel.onclose = () => { if (generation === this.generation) { this.leave(); this._status('offline', 'The host left the room.'); } };
    };
    pc.onconnectionstatechange = () => {
      if (generation === this.generation && ['failed', 'closed'].includes(pc.connectionState)) { this.leave(); this._status('error', 'Connection lost. Check that both devices are on the same Wi-Fi, then pair again.'); }
    };
    try {
      await pc.setRemoteDescription(offer.description);
      await pc.setLocalDescription(await pc.createAnswer());
      await this._gather(pc, generation);
      if (generation !== this.generation) throw new Error('Invitation cancelled.');
      this._status('connecting', 'Send this reply to the host. Keep this page open.');
      return encodeConnectionCode({ v: 1, type: 'answer', offerId: offer.offerId, created: offer.created, description: { type: 'answer', sdp: pc.localDescription.sdp } });
    } catch (error) { if (generation === this.generation) this.leave(); throw error; }
  }

  async acceptAnswer(code) {
    const answer = decodeConnectionCode(code, 'answer');
    const pending = this.pending;
    if (this.role !== 'host' || !pending || answer.offerId !== pending.offerId) throw new Error('This reply does not match the current invitation. Create a fresh invitation and try again.');
    const generation = this.generation;
    await pending.pc.setRemoteDescription(answer.description);
    if (generation !== this.generation || this.role !== 'host' || this.channels.get(pending.id) !== pending ||
        (this.pending !== pending && !pending.joined)) throw new Error('Invitation cancelled.');
    if (pending.joined) this._status('connected', `Hosting · ${this.peers.size + 1} drivers`);
    else this._status('connecting', 'Connecting to your friend…');
  }

  sendState(raw) {
    if (!this.connected) return;
    const state = sanitizeState(raw, this.id);
    if (!state) return;
    if (this.transport === 'lan') this._send(this.socket, { type: 'state', state });
    else if (this.role === 'host') this._broadcast({ type: 'state', id: this.id, name: this.name, state });
    else this._send(this.guestChannel, { type: 'state', state });
  }

  leave() {
    this.generation++;
    this.cancelConnect?.(); this.cancelConnect = null;
    this._cancelPending(); clearTimeout(this.guestTimer);
    const socket = this.socket; this.socket = null;
    if (socket) { this._send(socket, { type: 'leave' }); socket.onclose = null; socket.close(); }
    for (const peer of this.channels.values()) { clearTimeout(peer.timer); peer.channel.onclose = null; peer.pc.onconnectionstatechange = null; try { peer.channel.close(); peer.pc.close(); } catch {} }
    this.channels.clear();
    if (this.guestChannel) { this.guestChannel.onclose = null; try { this.guestChannel.close(); } catch {} this.guestChannel = null; }
    if (this.guestPc) { this.guestPc.onconnectionstatechange = null; this.guestPc.close(); this.guestPc = null; }
    for (const id of this.peers.keys()) this.onPeerLeave(id);
    this.peers.clear(); this.connected = false; this.id = null; this.room = null; this.role = null;
    this._peers(); this._status('offline', 'Solo drive');
  }
}
