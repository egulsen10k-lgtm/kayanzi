/** Reproducible, resumable OSM scenery download. Run: node scripts/download-akanzi-world.mjs
 * Optional --limit=N downloads at most N missing patches this run.
 * Requests are sequential, at least 1.2s apart; any HTTP error stops the run.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'public/data/akanzi-world');
const route = JSON.parse(await fs.readFile(path.join(root, 'public/data/akanzi-route.json'), 'utf8'));
const radiusMeters = 400, spacingMeters = 450, maxBytes = 15 * 1024 * 1024;
const limitArgument = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArgument ? Number(limitArgument.split('=')[1]) : Infinity;
if (!(limit > 0)) throw new Error('--limit must be positive');
const earthRadius = 6371008.8, radians = Math.PI / 180;
const distance = (a, b) => {
  const dlat = (b[1] - a[1]) * radians, dlng = (b[0] - a[0]) * radians;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dlng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
};
const coordinates = route.coordinates;
const lengths = coordinates.slice(1).map((p, i) => distance(coordinates[i], p));
const totalLength = lengths.reduce((a, b) => a + b, 0);
const centers = [];
let segment = 0, segmentStart = 0;
for (let progress = 0; progress < totalLength + spacingMeters; progress += spacingMeters) {
  const target = Math.min(progress, totalLength);
  while (segment < lengths.length - 1 && segmentStart + lengths[segment] < target) segmentStart += lengths[segment++];
  const t = lengths[segment] ? (target - segmentStart) / lengths[segment] : 0;
  const [lng, lat] = coordinates[segment].map((v, i) => v + (coordinates[segment + 1][i] - v) * t);
  const dy = radiusMeters / earthRadius / radians, dx = dy / Math.cos(lat * radians);
  centers.push({ id: `patch-${String(centers.length).padStart(3, '0')}`, center: { lat, lng }, distance: target,
    bbox: [lng - dx, lat - dy, lng + dx, lat + dy].map(n => Number(n.toFixed(7))) });
  if (target === totalLength) break;
}

function compact(data) {
  const nodes = new Map(data.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const ways = new Map();
  for (const way of data.elements) {
    if (way.type !== 'way' || !way.tags) continue;
    if (!['highway', 'building', 'building:part', 'landuse', 'natural', 'water', 'waterway', 'leisure', 'barrier', 'railway', 'amenity', 'man_made'].some(key => key in way.tags)) continue;
    const geometry = (way.nodes ?? []).map(id => nodes.get(id)).map(n => n && ({ lat: n.lat, lon: n.lon }));
    // Never connect across missing nodes or turn incomplete areas into false polygons.
    if (geometry.length < 2 || geometry.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) continue;
    ways.set(way.id, { type: 'way', id: way.id, tags: way.tags, geometry });
  }
  return [...ways.values(), ...data.elements.filter(e => e.type === 'node' && e.tags?.natural === 'tree').map(e => ({type:'node', id:e.id, lat:e.lat, lon:e.lon, tags:e.tags}))];
}

await fs.mkdir(directory, { recursive: true });
const patches = [];
let bytes = 0, downloaded = 0;
const manifest = () => ({ version: 1, name: 'Akanzi mapped world', route: '/data/akanzi-route.json',
  copyright: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright',
  license: 'https://opendatacommons.org/licenses/odbl/1-0/', source: 'https://api.openstreetmap.org/api/0.6/map.json',
  radiusMeters, spacingMeters, routeDistanceMeters: totalLength, plannedPatches: centers.length,
  complete: patches.length === centers.length, bytes, generated: new Date().toISOString(),
  coverageNote: 'Bboxes describe queried coverage. Overlapping ways are duplicated across patches so each patch loads independently; consumers merging patches should deduplicate way IDs. Geometry is real OSM map data; heights and surface details may be absent. Multipolygon relations are not reconstructed.', patches });
const saveManifest = () => fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest(), null, 2) + '\n');
try {
  for (const patch of centers) {
    const filename = `${patch.id}.json`, destination = path.join(directory, filename);
    let content;
    try { content = await fs.readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!content) {
      if (downloaded >= limit) break;
      if (downloaded) await new Promise(resolve => setTimeout(resolve, 1200));
      const source = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${patch.bbox.join(',')}`;
      console.log(`Downloading ${patch.id} (${patches.length + 1}/${centers.length})`);
      const response = await fetch(source, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'AkanziDrivingWorld/1.0 (local educational map scenery download)', Accept: 'application/json' } });
      if (!response.ok) throw new Error(`OSM returned ${response.status}; stopped without retries.`);
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error('Invalid OSM response');
      content = JSON.stringify({ ...patch, source, downloaded: new Date().toISOString(),
        copyright: 'OpenStreetMap contributors', license: 'https://opendatacommons.org/licenses/odbl/1-0/', elements: compact(data) });
      if (bytes + Buffer.byteLength(content) > maxBytes) throw new Error('15 MiB compact payload cap reached; no more downloads.');
      await fs.writeFile(destination, content);
      downloaded++;
    }
    const data = JSON.parse(content);
    if (JSON.stringify(data.bbox) !== JSON.stringify(patch.bbox)) throw new Error(`Cached ${filename} has incompatible coverage; remove it explicitly before refreshing.`);
    const size = Buffer.byteLength(content);
    bytes += size;
    patches.push({ ...patch, file: filename, url: `/data/akanzi-world/${filename}`, bytes: size, ways: data.elements.filter(e => e.type === 'way').length, elements: data.elements.length, downloaded: data.downloaded });
    await saveManifest();
    console.log(`${patch.id}: ${data.elements.length} elements, ${(size / 1024).toFixed(0)} KiB; total ${(bytes / 1048576).toFixed(2)} MiB`);
  }
} finally { await saveManifest(); }
console.log(`Saved ${patches.length}/${centers.length} patches (${(bytes / 1048576).toFixed(2)} MiB).`);
