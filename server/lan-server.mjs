import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { sanitizeWorldSnapshot } from '../src/npc-state.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = new Set(['M3 Competition', 'M4 CSL', 'M5 CS', 'i4 M50 (EV)', 'XM Label Red', 'm3', 'm4', 'm5', 'i4']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' };

export function sanitizeState(raw, peerId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (![raw.lat, raw.lng, raw.heading].every(Number.isFinite) || Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180 || Math.abs(raw.heading) > 1e6) return null;
  const bounded = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
  return {
    peerId,
    lat: raw.lat,
    lng: raw.lng,
    heading: ((raw.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI,
    speed: bounded(raw.speed, 0, -500, 500),
    steering: bounded(raw.steering, 0, -1, 1),
    roadHeight: bounded(raw.roadHeight, 0.05, -1000, 10000),
    model: MODELS.has(raw.model) ? raw.model : 'M3 Competition',
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#718ba1',
    drivetrain: ['AWD', 'RWD', 'FWD'].includes(raw.drivetrain) ? raw.drivetrain : 'AWD',
    robot: raw.robot === true
  };
}

export function createLanServer({ port = 3000, host = '0.0.0.0', distDir = resolve(PROJECT_ROOT, 'dist'), maxPlayers = 8, maxRooms = 32, maxConnections = 128, heartbeatMs = 30000, joinTimeoutMs = 10000, maxMessagesPerSecond = 40, allowedOrigins = [], allowedHosts = [] } = {}) {
  const rooms = new Map();
  const root = resolve(distDir);
  let heartbeat;
  let closing = false;
  let listeningPort = port;
  // Reject arbitrary DNS names to prevent a hostile page from rebinding its
  // own origin to a private IP and then reading the local service.
  const localHostnames = new Set(['localhost', hostname().toLowerCase(), ...allowedHosts.map((name) => name.toLowerCase())]);
  const validHost = (request) => {
    try {
      const value = request.headers.host;
      if (typeof value !== 'string' || /[\s/@\\]/.test(value)) return false;
      const parsed = new URL(`http://${value}`);
      const name = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      return isIP(name) !== 0 || localHostnames.has(name);
    } catch { return false; }
  };
  const addresses = () => {
    const ips = new Set(['127.0.0.1']);
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries || []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) ips.add(entry.address);
    }
    return [...ips].map((ip) => `http://${ip}:${listeningPort}/`);
  };
  const respond = (response, status, text, type = 'text/plain; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(text);
  };
  const server = http.createServer(async (request, response) => {
    if (!validHost(request)) return respond(response, 403, 'Use a printed LAN address or localhost.');
    if (!['GET', 'HEAD'].includes(request.method)) return respond(response, 405, 'Method not allowed');
    try {
      const raw = (request.url || '/').split('?')[0];
      const pathname = decodeURIComponent(raw);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) return respond(response, 403, 'Forbidden');
      if (pathname === '/api/multiplayer-info') return respond(response, 200, JSON.stringify({ protocolVersion: 1, addresses: addresses(), maxPlayers }), 'application/json');
      const candidate = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const rel = relative(root, candidate);
      if (rel.startsWith('..') || isAbsolute(rel)) return respond(response, 403, 'Forbidden');
      const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(candidate)]);
      const canonicalRelative = relative(canonicalRoot, canonicalFile);
      if (canonicalRelative.startsWith('..') || isAbsolute(canonicalRelative)) return respond(response, 403, 'Forbidden');
      const info = await stat(canonicalFile);
      if (!info.isFile()) return respond(response, 404, 'Not found');
      response.writeHead(200, { 'Content-Type': MIME[extname(canonicalFile).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(canonicalFile);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) respond(response, error instanceof URIError ? 400 : error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, error.code === 'ENOENT' ? 'Game build not found. Run npm run build before starting the LAN server.' : 'Unable to serve this file');
      else response.destroy();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const safeSend = (socket, value) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) return socket.close(1013, 'Connection is too slow');
    socket.send(JSON.stringify(value));
  };
  const sendError = (socket, code, message) => safeSend(socket, { type: 'error', code, message });
  const broadcast = (room, message, except) => {
    for (const member of rooms.get(room)?.values() || []) if (member.socket !== except) safeSend(member.socket, message);
  };
  const leave = (socket) => {
    const member = socket.member;
    if (!member) return;
    socket.member = null;
    const room = rooms.get(member.room);
    room?.delete(member.id);
    broadcast(member.room, { type: 'peer-leave', id: member.id });
    if (room?.size === 0) rooms.delete(member.room);
    else if (room && room.authorityId === member.id) {
      room.authorityId = room.keys().next().value;
      room.worldSnapshot = null; room.worldSeq = -1;
      broadcast(member.room, { type: 'authority', room: member.room, authorityId: room.authorityId });
    }
  };
  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    let originAllowed = !request.headers.origin;
    if (request.headers.origin) {
      try {
        const origin = new URL(request.headers.origin);
        originAllowed = ['http:', 'https:'].includes(origin.protocol) && (origin.host === request.headers.host || allowedOrigins.includes(origin.origin));
      } catch { originAllowed = false; }
    }
    if (closing || !validHost(request) || pathname !== '/multiplayer' || !originAllowed || wss.clients.size >= maxConnections) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (connection) => wss.emit('connection', connection, request));
  });
  wss.on('connection', (socket) => {
    socket.alive = true;
    socket.rateWindow = Date.now();
    socket.messageCount = 0;
    const joinTimer = setTimeout(() => { if (!socket.member) socket.close(1008, 'Join a room first'); }, joinTimeoutMs);
    joinTimer.unref();
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(joinTimer); leave(socket); });
    socket.on('message', (bytes, binary) => {
      if (Date.now() - socket.rateWindow >= 1000) { socket.rateWindow = Date.now(); socket.messageCount = 0; }
      if (++socket.messageCount > maxMessagesPerSecond) return socket.close(1008, 'Too many updates');
      if (binary) return sendError(socket, 'invalid-message', 'Use JSON text messages.');
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { return sendError(socket, 'invalid-json', 'Message must be valid JSON.'); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return sendError(socket, 'invalid-message', 'Invalid message.');
      if (message.type === 'join') {
        if (socket.member) return sendError(socket, 'already-joined', 'Leave your current room before joining another.');
        const roomId = typeof message.room === 'string' ? message.room.trim().toUpperCase() : '';
        if (!/^[A-Z0-9]{3,24}$/.test(roomId)) return sendError(socket, 'invalid-room', 'Use a room code with 3–24 letters or digits.');
        let room = rooms.get(roomId);
        if (room?.size >= maxPlayers) return sendError(socket, 'room-full', 'This room is full.');
        if (!room && rooms.size >= maxRooms) return sendError(socket, 'server-full', 'Too many active rooms. Try again later.');
        const id = randomUUID();
        const state = message.state == null ? null : sanitizeState(message.state, id);
        if (message.state != null && !state) return sendError(socket, 'invalid-state', 'Driver position is invalid.');
        const name = typeof message.name === 'string' ? message.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Driver' : 'Driver';
        const peers = room ? [...room.values()].map(({ id, name, state }) => ({ id, name, state })) : [];
        const member = { id, name, room: roomId, state, socket };
        if (!room) {
          room = new Map(); room.authorityId = id; room.worldSnapshot = null; room.worldSeq = -1;
          rooms.set(roomId, room);
        }
        room.set(id, member);
        socket.member = member;
        clearTimeout(joinTimer);
        safeSend(socket, { type: 'welcome', id, room: roomId, authorityId: room.authorityId, peers, maxPlayers });
        if (room.worldSnapshot) safeSend(socket, { type: 'world', room: roomId, authorityId: room.authorityId, snapshot: room.worldSnapshot });
        broadcast(roomId, { type: 'peer-join', id, name, state }, socket);
      } else if (message.type === 'state') {
        const member = socket.member;
        if (!member) return sendError(socket, 'not-joined', 'Join a room first.');
        const state = sanitizeState(message.state, member.id);
        if (!state) return sendError(socket, 'invalid-state', 'Driver position is invalid.');
        member.state = state;
        broadcast(member.room, { type: 'state', id: member.id, name: member.name, state }, socket);
      } else if (message.type === 'world') {
        const member = socket.member;
        if (!member) return sendError(socket, 'not-joined', 'Join a room first.');
        const room = rooms.get(member.room);
        if (room?.authorityId !== member.id) return sendError(socket, 'not-authority', 'Only the room host can publish NPC state.');
        if (message.room !== member.room || message.authorityId !== member.id) return sendError(socket, 'invalid-world', 'NPC state does not match this room.');
        const snapshot = sanitizeWorldSnapshot(message.snapshot);
        if (!snapshot) return sendError(socket, 'invalid-world', 'NPC snapshot is invalid.');
        if (snapshot.seq <= room.worldSeq) return;
        room.worldSeq = snapshot.seq; room.worldSnapshot = snapshot;
        broadcast(member.room, { type: 'world', room: member.room, authorityId: member.id, snapshot }, socket);
      } else if (message.type === 'leave') {
        leave(socket);
        socket.close(1000, 'Left room');
      } else sendError(socket, 'unknown-message', 'Unknown message type.');
    });
  });
  return {
    server, wss, rooms, addresses,
    async listen() {
      await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => { server.off('error', fail); done(); });
      });
      listeningPort = server.address().port;
      heartbeat = setInterval(() => {
        for (const socket of wss.clients) {
          if (!socket.alive) { socket.terminate(); continue; }
          socket.alive = false;
          socket.ping();
        }
      }, heartbeatMs);
      heartbeat.unref();
      return server.address();
    },
    async close() {
      closing = true;
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await new Promise((done) => wss.close(done));
      if (server.listening) await new Promise((done) => server.close(done));
      server.closeAllConnections?.();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be a number between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const app = createLanServer({ port });
    app.listen().then(() => {
      console.log('\nBMW Earth Drive · local-network multiplayer');
      for (const address of app.addresses()) console.log(`  ${address}`);
      console.log('\nOpen one of the network addresses on every device on the same Wi-Fi.\nChoose Multiplayer, then create or join the same room. Keep this terminal open.\n');
    }).catch((error) => { console.error(`Unable to start multiplayer: ${error.message}`); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
  }
}
