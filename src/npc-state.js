// Shared wire validation: this file deliberately has no DOM, Three.js or game-state dependencies.
export const MAX_SHARED_TRAFFIC = 16;
export const MAX_SHARED_PEOPLE = 24;
export const NPC_BODY_NAMES = ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const TYPES = new Set(['sedan', 'police', 'van', 'firetruck', 'ambulance', 'bus']);
const STYLES = new Set(['casual', 'goth', 'turkish', 'turkish-headscarf']);
const STATES = new Set(['idle', 'chasing', 'clinging', 'boarded', 'ragdoll', 'recovering', 'trunk-approach', 'trunk-entering', 'trunk-rider']);
const finite = Number.isFinite;
const bounded = (value, low, high, fallback = low) => finite(value) ? Math.max(low, Math.min(high, value)) : fallback;
const angle = value => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const coordinate = value => value && finite(value.lat) && Math.abs(value.lat) <= 90 && finite(value.lng) && Math.abs(value.lng) <= 180;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
function pose(value) {
  if (!coordinate(value) || !finite(value.heading) || !validId(value.id)) return null;
  return { id: value.id, lat: value.lat, lng: value.lng, heading: angle(value.heading), height: bounded(value.height, -1000, 10000) };
}
function ragdoll(value) {
  if (!coordinate(value) || !value.bodies || typeof value.bodies !== 'object') return null;
  const bodies = {};
  for (const name of NPC_BODY_NAMES) {
    const source = value.bodies[name];
    if (!Array.isArray(source) || source.length !== 7 || !source.every(finite)) return null;
    const length = Math.hypot(...source.slice(3));
    if (!finite(length) || length < .01) return null;
    bodies[name] = [...source.slice(0, 3).map(v => bounded(v, -1000, 1000)), ...source.slice(3).map(v => v / length)];
  }
  return { lat: value.lat, lng: value.lng, height: bounded(value.height, -1000, 10000), bodies };
}
export function sanitizeWorldSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Number.isSafeInteger(raw.seq) || raw.seq < 0 ||
      !finite(raw.time) || !Array.isArray(raw.traffic) || raw.traffic.length > MAX_SHARED_TRAFFIC ||
      !Array.isArray(raw.people) || raw.people.length > MAX_SHARED_PEOPLE) return null;
  const traffic = [], people = [], ids = new Set();
  for (const value of raw.traffic) {
    const clean = pose(value);
    if (!clean || ids.has(clean.id) || !TYPES.has(value.type)) return null;
    ids.add(clean.id);
    traffic.push({ ...clean, type: value.type, seed: Math.round(bounded(value.seed, 0, 1e6)), speed: bounded(value.speed, -500, 500, 0), braking: value.braking === true, opacity: bounded(value.opacity, 0, 1, 1), alert: value.alert === true });
  }
  ids.clear();
  for (const value of raw.people) {
    const clean = pose(value);
    if (!clean || ids.has(clean.id) || !STYLES.has(value.style) || !STATES.has(value.state)) return null;
    ids.add(clean.id);
    const bodyPose = value.ragdoll == null ? null : ragdoll(value.ragdoll);
    if (value.ragdoll != null && !bodyPose) return null;
    people.push({ ...clean, style: value.style, state: value.state, phase: bounded(value.phase, 0, 1e9), trunkProgress: bounded(value.trunkProgress, 0, 1), recoveryTime: bounded(value.recoveryTime, 0, 10), ragdoll: bodyPose });
  }
  return { v: 1, seq: raw.seq, time: bounded(raw.time, 0, 1e9), traffic, people, passengers: Math.round(bounded(raw.passengers, 0, 4)), trunkOpen: bounded(raw.trunkOpen, 0, 1) };
}
