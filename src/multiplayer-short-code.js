import PeerModule from 'peerjs';
import { MultiplayerSession, MAX_PLAYERS, sanitizeName, sanitizeState } from './multiplayer.js';

const DefaultPeer = typeof PeerModule === 'function' ? PeerModule : PeerModule.Peer || PeerModule.default;
const SIGNAL_PREFIX = 'kayanzi-drive-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const identity = () => `driver-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;

export function randomShortCode() {
  const bytes = new Uint8Array(6);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Short room codes require a modern browser. Use the local-server option instead.');
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export function normalizeShortCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Enter the host’s 6-character room code, such as ABC123.');
  return code;
}

/** Adapt PeerJS events to the existing multiplayer protocol; the host remains authoritative. */
function channelFor(connection) {
  const channel = {
    get readyState() { return connection.open ? 'open' : 'connecting'; },
    get bufferedAmount() { return connection.dataChannel?.bufferedAmount || 0; },
    send(raw) { connection.send(raw); },
    close() { connection.close(); },
    onmessage: null, onclose: null
  };
  connection.on('data', (data) => {
    // Our wire protocol is bounded JSON text, never arbitrary deserialised application objects.
    if (typeof data === 'string') channel.onmessage?.({ data });
  });
  connection.on('close', () => channel.onclose?.());
  connection.on('error', () => channel.onclose?.());
  return channel;
}

function errorMessage(error) {
  if (error?.type === 'peer-unavailable') return 'That room is not available. Check the code and ask the host to keep the game open.';
  if (error?.type === 'browser-incompatible') return 'This browser cannot connect directly. Try Chrome, Safari or Firefox, or use the local-server option.';
  return 'The room service could not connect. Check your internet connection, try again, or use Advanced → local server / manual codes.';
}

export class ShortCodeMultiplayerSession extends MultiplayerSession {
  constructor(options = {}) {
    super(options);
    this.PeerClass = options.PeerClass || DefaultPeer;
    this.codeGenerator = options.codeGenerator || randomShortCode;
    this.signalingTimeout = options.signalingTimeout || 15000;
    this.joinTimeout = options.joinTimeout || 25000;
    this.signalingPeer = null;
    this.shortCode = null;
    this.cancelShortConnect = null;
  }

  _failShort(error, generation) {
    if (generation !== this.generation) return;
    this.cancelShortConnect?.(error);
    this.leave();
    this._status('error', error.message);
  }

  _openSignal(id, generation) {
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const settle = (error, peer) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (this.cancelShortConnect === cancel) this.cancelShortConnect = null;
        error ? reject(error) : resolve(peer);
      };
      const cancel = (error = new Error('Connection cancelled.')) => settle(error);
      this.cancelShortConnect = cancel;
      let peer;
      try {
        // PeerServer Cloud handles discovery only. Driving snapshots use WebRTC data channels.
        peer = this.signalingPeer = new this.PeerClass(id, {
          host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0,
          config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });
      } catch (cause) { settle(new Error(errorMessage(cause))); return; }
      timer = setTimeout(() => settle(new Error(errorMessage())), this.signalingTimeout);
      timer.unref?.();
      peer.on('open', () => {
        if (generation !== this.generation || this.signalingPeer !== peer) { peer.destroy(); settle(new Error('Connection cancelled.')); return; }
        if (settled && this.connected) this._status('connected', this.role === 'host' ? `Hosting · room ${this.shortCode}` : 'Connected · room service restored');
        settle(null, peer);
      });
      peer.on('connection', (connection) => {
        if (generation !== this.generation || this.role !== 'host') { connection.close(); return; }
        this._acceptShortGuest(connection, generation);
      });
      peer.on('error', (cause) => {
        if (generation !== this.generation || this.signalingPeer !== peer) return;
        const error = new Error(errorMessage(cause)); error.type = cause?.type;
        if (!settled) { settle(error); return; }
        if (this.connected && (this.role === 'host' || ['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected', 'unavailable-id'].includes(cause?.type)) && cause?.type !== 'browser-incompatible') {
          this._status('connected', 'Room service unavailable. Connected drivers can keep driving; new friends may need Advanced → local server.');
        } else this._failShort(error, generation);
      });
      peer.on('disconnected', () => {
        if (generation !== this.generation || this.signalingPeer !== peer) return;
        if (!settled) { settle(new Error(errorMessage())); return; }
        if (this.connected) this._status('connected', 'Room service disconnected. Existing drivers can keep driving. Trying to reconnect…');
        try { if (!peer.destroyed) peer.reconnect(); } catch { /* Existing direct connections remain usable. */ }
      });
      peer.on('close', () => {
        if (generation !== this.generation || this.signalingPeer !== peer) return;
        if (!settled) { settle(new Error(errorMessage())); return; }
        this._failShort(new Error('The room connection closed. Host or join again to reconnect.'), generation);
      });
    });
  }

  _acceptShortGuest(connection, generation) {
    if (this.channels.size >= MAX_PLAYERS - 1 || connection.metadata?.protocolVersion !== 1) { connection.close(); return; }
    const channel = channelFor(connection);
    const pc = { connectionState: 'connecting', onconnectionstatechange: null, close: () => connection.close() };
    const peer = { id: identity(), pc, channel, joined: false };
    this.channels.set(peer.id, peer);
    this._wireHost(peer, generation);
    peer.timer = setTimeout(() => this._dropHostPeer(peer.id, generation), this.joinTimeout);
    peer.timer.unref?.();
    connection.on('open', () => { pc.connectionState = 'connected'; });
  }

  async hostGame({ name = this.name } = {}) {
    if (this.transport === 'short-code' && this.role === 'host' && this.connected && this.signalingPeer && !this.signalingPeer.destroyed && !this.signalingPeer.disconnected) return this.shortCode;
    this.leave(); this.transport = 'short-code'; this.role = 'host'; this.name = sanitizeName(name);
    const generation = this.generation;
    this._status('connecting', 'Creating a short room code…');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = normalizeShortCode(this.codeGenerator());
        try {
          await this._openSignal(`${SIGNAL_PREFIX}${code}`, generation);
          if (generation !== this.generation) throw new Error('Connection cancelled.');
          this.shortCode = this.room = code; this.id = `host-${code}`; this.connected = true;
          this._setWorldAuthority?.(this.id);
          this._status('connected', `Hosting · room ${code} · share this code with friends`);
          this._peers();
          return code;
        } catch (error) {
          if (generation !== this.generation) throw error;
          const oldPeer = this.signalingPeer; this.signalingPeer = null; oldPeer?.destroy();
          if (generation !== this.generation || error.type !== 'unavailable-id' || attempt === 3) throw error;
        }
      }
    } catch (error) { this._failShort(error, generation); throw error; }
  }

  async joinGame(rawCode, { name = this.name } = {}) {
    const code = normalizeShortCode(rawCode);
    this.leave(); this.transport = 'short-code'; this.role = 'guest'; this.name = sanitizeName(name); this.shortCode = this.room = code;
    const generation = this.generation;
    this._status('connecting', `Joining room ${code}…`);
    try {
      const peer = await this._openSignal(undefined, generation);
      if (generation !== this.generation) throw new Error('Connection cancelled.');
      await new Promise((resolve, reject) => {
        let settled = false, timer;
        const settle = (error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (this.cancelShortConnect === cancel) this.cancelShortConnect = null;
          error ? reject(error) : resolve();
        };
        const cancel = (error = new Error('Connection cancelled.')) => settle(error);
        this.cancelShortConnect = cancel;
        let connection;
        try { connection = peer.connect(`${SIGNAL_PREFIX}${code}`, { label: 'kayanzi-drive', serialization: 'json', reliable: false, metadata: { protocolVersion: 1 } }); }
        catch (cause) { settle(new Error(errorMessage(cause))); return; }
        const channel = this.guestChannel = channelFor(connection);
        this.guestPc = { onconnectionstatechange: null, close: () => connection.close() };
        timer = setTimeout(() => settle(new Error('Could not join this room. Check the code, keep both games open, and try the same Wi-Fi or Advanced → local server.')), this.joinTimeout);
        timer.unref?.();
        connection.on('open', () => {
          if (generation !== this.generation) { connection.close(); return; }
          this._send(channel, { type: 'join', name: this.name, state: sanitizeState(this.getState(), this.id) });
        });
        channel.onmessage = ({ data }) => {
          if (generation !== this.generation) return;
          const message = this._packet(data);
          if (message?.type === 'error') { settle(new Error(String(message.message || 'This room cannot accept more drivers.'))); return; }
          this._remoteMessage(message);
          if (this.connected) settle();
        };
        channel.onclose = () => {
          if (generation !== this.generation) return;
          if (!this.connected) { settle(new Error('This room is full or no longer available. Check with the host and try again.')); return; }
          this.leave(); this._status('offline', 'The host left the room. Enter a room code to reconnect.');
        };
        connection.on('error', () => {
          if (generation !== this.generation) return;
          if (!this.connected) settle(new Error('Direct connection failed. Try the same Wi-Fi or Advanced → local server.'));
        });
      });
      if (generation !== this.generation || !this.connected) throw new Error('Connection cancelled.');
    } catch (error) { this._failShort(error, generation); throw error; }
  }

  leave() {
    this.cancelShortConnect?.(); this.cancelShortConnect = null;
    const peer = this.signalingPeer; this.signalingPeer = null; this.shortCode = null;
    super.leave();
    peer?.destroy();
  }
}
