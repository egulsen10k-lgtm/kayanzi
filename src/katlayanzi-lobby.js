export const CASINO_BOUNDS = Object.freeze({ minX: -13, maxX: 13, minZ: -10, maxZ: 12 });
export const CASINO_TABLES = Object.freeze([
  { id: 'blackjack', x: -6, z: -3, label: '21 · Blackjack', playable: true },
  { id: 'roulette', x: 6, z: -3, label: 'Rulet', playable: true },
  { id: 'poker', x: 0, z: 6, label: 'Poker', playable: true },
  { id: 'decor-left', x: -9, z: 6, label: 'Özel masa · Dekor', playable: false },
  { id: 'decor-right', x: 9, z: 6, label: 'Özel masa · Dekor', playable: false },
].map(Object.freeze));

export function sanitizeLobbyPose(raw) {
  if (!raw || ![raw.x, raw.z, raw.heading].every(Number.isFinite)) return null;
  return {
    x: Math.max(CASINO_BOUNDS.minX, Math.min(CASINO_BOUNDS.maxX, raw.x)),
    z: Math.max(CASINO_BOUNDS.minZ, Math.min(CASINO_BOUNDS.maxZ, raw.z)),
    heading: Math.atan2(Math.sin(raw.heading), Math.cos(raw.heading)),
  };
}

export function constrainLobbyPosition(raw, previous = { x: 0, z: 10, heading: 0 }) {
  const pose = sanitizeLobbyPose(raw);
  if (!pose) return null;
  // Swept movement prevents tunnelling through the decorative and playable tables.
  const dx = pose.x - previous.x, dz = pose.z - previous.z;
  const steps = Math.min(100, Math.max(1, Math.ceil(Math.hypot(dx, dz) / .25)));
  let x = previous.x, z = previous.z;
  for (let step = 1; step <= steps; step++) {
    let nx = previous.x + dx * step / steps, nz = previous.z + dz * step / steps;
    if (CASINO_TABLES.some(table => Math.hypot(nx - table.x, nz - table.z) < 2.3)) break;
    x = nx; z = nz;
  }
  return { x, z, heading: pose.heading };
}

export function nearbyLobbyTable(pose) {
  if (!pose || ![pose.x, pose.z].every(Number.isFinite)) return null;
  let closest = null, distance = 4.5;
  for (const table of CASINO_TABLES) {
    const next = Math.hypot(pose.x - table.x, pose.z - table.z);
    if (table.playable && next <= distance) { closest = table; distance = next; }
  }
  return closest;
}

export function sanitizeLobbySnapshot(raw) {
  if (!raw || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.players) || raw.players.length > 8) return null;
  const ids = new Set(), players = [];
  for (const player of raw.players) {
    const pose = sanitizeLobbyPose(player);
    if (!pose || typeof player.id !== 'string' || !player.id || player.id.length > 80 || ids.has(player.id) ||
      (player.tableId !== null && !CASINO_TABLES.some(table => table.playable && table.id === player.tableId))) return null;
    ids.add(player.id);
    players.push({ id: player.id, name: String(player.name || 'Driver').slice(0, 24), ...pose, tableId: player.tableId });
  }
  return { revision: raw.revision, players };
}
