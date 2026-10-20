// Use a same-origin endpoint so the browser does not depend on Overpass CORS
// headers (which may be omitted on overload/error responses).
import { overpassEndpoints } from './resource-urls.js';
const OVERPASS_URLS = overpassEndpoints;
const EARTH_RADIUS_METERS = 6371008.8;
const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 5000;
const ROAD_WIDTHS = {
  motorway: 14, motorway_link: 8,
  trunk: 12, trunk_link: 8,
  primary: 10, primary_link: 7,
  secondary: 8, secondary_link: 7,
  tertiary: 7, tertiary_link: 6,
  unclassified: 6, residential: 6, living_street: 5,
  service: 5, track: 4, road: 6
};
const ROAD_CLEARANCE_METERS = 1.1;
const MAX_NETWORK_AGE_MS = 5 * 60 * 1000;

const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESPONSE_CACHE_ENTRIES = 16;
const responseCache = new Map();
const inFlightRequests = new Map();

function validateRequest(lat, lng, radiusMeters) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError('Latitude must be between -90 and 90.');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError('Longitude must be between -180 and 180.');
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters < MIN_RADIUS_METERS || radiusMeters > MAX_RADIUS_METERS) {
    throw new RangeError(`Road search radius must be between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS} meters.`);
  }
}

function projectInternal(lat, lng, centerLat, centerLng) {
  const phi = centerLat * Math.PI / 180;
  const lambda = centerLng * Math.PI / 180;
  const pointPhi = lat * Math.PI / 180;
  const pointLambda = lng * Math.PI / 180;
  const deltaLambda = ((pointLambda - lambda + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const cosC = Math.max(-1, Math.min(1,
    Math.sin(phi) * Math.sin(pointPhi) + Math.cos(phi) * Math.cos(pointPhi) * Math.cos(deltaLambda)
  ));
  const c = Math.acos(cosC);
  if (c < 1e-12) return [0, 0];

  const k = c / Math.sin(c);
  return [
    EARTH_RADIUS_METERS * k * Math.cos(pointPhi) * Math.sin(deltaLambda),
    EARTH_RADIUS_METERS * k * (Math.cos(phi) * Math.sin(pointPhi) - Math.sin(phi) * Math.cos(pointPhi) * Math.cos(deltaLambda))
  ];
}

function clipSegments(points, radius) {
  const fragments = [];
  let fragment = [];
  const radiusSquared = radius * radius;
  const append = (point) => {
    const last = fragment[fragment.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.01) fragment.push(point);
  };
  const flush = () => {
    if (fragment.length > 1) fragments.push(fragment);
    fragment = [];
  };

  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const a = dx * dx + dy * dy;
    if (a === 0) continue;

    const b = 2 * (start[0] * dx + start[1] * dy);
    const c = start[0] * start[0] + start[1] * start[1] - radiusSquared;
    const discriminant = b * b - 4 * a * c;
    let t0 = 0;
    let t1 = 1;
    if (discriminant < 0) {
      if (c > 0 || end[0] * end[0] + end[1] * end[1] > radiusSquared) {
        flush();
        continue;
      }
    } else {
      const root = Math.sqrt(discriminant);
      t0 = Math.max(0, (-b - root) / (2 * a));
      t1 = Math.min(1, (-b + root) / (2 * a));
      if (t0 > t1) {
        flush();
        continue;
      }
    }

    const clippedStart = [start[0] + dx * t0, start[1] + dy * t0];
    const clippedEnd = [start[0] + dx * t1, start[1] + dy * t1];
    const last = fragment[fragment.length - 1];
    if (last && Math.hypot(last[0] - clippedStart[0], last[1] - clippedStart[1]) > 0.02) flush();
    append(clippedStart);
    append(clippedEnd);
    if (t1 < 1) flush();
  }
  flush();
  return fragments;
}

function roadWidth(tags) {
  const match = typeof tags.width === 'string' && tags.width.trim().match(/^([\d.]+)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (match) {
    const value = Number(match[1]);
    const meters = /^(ft|feet|')$/i.test(match[2] ?? '') ? value * 0.3048 : value;
    if (Number.isFinite(meters) && meters >= 2.5 && meters <= 30) return meters;
  }
  const lanes = Number.parseFloat(tags.lanes);
  if (Number.isFinite(lanes) && lanes >= 1 && lanes <= 8) return Math.max(3.5, Math.min(24, lanes * 3.2));
  return ROAD_WIDTHS[tags.highway] ?? 6;
}

function decodeWays(elements, lat, lng, radiusMeters, predicate, createWay) {
  const ways = [];
  for (const element of elements) {
    if (element.type !== 'way' || !element.tags || !predicate(element.tags) || !Array.isArray(element.geometry)) continue;
    const segments = [];
    let points = [];
    for (const point of element.geometry) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
        if (points.length > 1) segments.push(points);
        points = [];
        continue;
      }
      points.push(projectInternal(point.lat, point.lon, lat, lng));
    }
    if (points.length > 1) segments.push(points);
    segments.flatMap((segment) => clipSegments(segment, radiusMeters)).forEach((fragment, index) => {
      ways.push(createWay(element, fragment, index));
    });
  }
  return ways;
}

// A layer number is ordering, not elevation: inventing layer * height would create
// vertical steps at ramps. Until vehicles support elevation, keep unsupported
// grade-separated ways out of BOTH rendering and the collision network.
export function isGroundRoad(tags = {}) {
  const active = value => value != null && !['', 'no', 'false', '0'].includes(String(value).toLowerCase());
  return Boolean(ROAD_WIDTHS[tags.highway]) && Number(tags.layer ?? 0) === 0 &&
    !active(tags.bridge) && !active(tags.tunnel) &&
    tags.location !== 'underground' && tags.location !== 'overground';
}

function omittedGradeSeparatedRoads(elements) {
  return elements.filter(e => e.type === 'way' && ROAD_WIDTHS[e.tags?.highway] && !isGroundRoad(e.tags)).length;
}

function decodeRoads(elements, lat, lng, radiusMeters) {
  const active = value => value != null && !['', 'no', 'false', '0'].includes(String(value).toLowerCase());
  const roads = decodeWays(elements, lat, lng, radiusMeters,
    tags => Boolean(ROAD_WIDTHS[tags.highway]), (element, points, index) => {
      const bridge = active(element.tags.bridge), tunnel = active(element.tags.tunnel) || element.tags.location === 'underground';
      const layer = Number(element.tags.layer) || (bridge ? 1 : tunnel && element.tags.tunnel !== 'building_passage' ? -1 : 0);
      return { id: `way/${element.id}/${index}`, name: typeof element.tags.name === 'string' ? element.tags.name.slice(0, 200) : '',
        highway: element.tags.highway, width: roadWidth(element.tags), points, bridge, tunnel, layer };
    });
  // Layer is ordering, not a surveyed height. Give structures approximate clearance
  // and connect only shared geometry vertices, never spatial crossings.
  const key = p => p.map(v => v.toFixed(3)).join(',');
  const nodes = new Map(), privateKeys = new WeakMap();
  const node = p => { const k = privateKeys.get(p) ?? key(p); if (!nodes.has(k)) nodes.set(k, { edges: [], height: 0 }); return nodes.get(k); };
  for (const road of roads) {
    const dense = [road.points[0]];
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i-1], b = road.points[i], n = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1])/10));
      for (let j = 1; j <= n; j++) {
        const p = [a[0]+(b[0]-a[0])*j/n, a[1]+(b[1]-a[1])*j/n];
        if (j < n) privateKeys.set(p, `${road.id}:${i}:${j}`);
        dense.push(p);
      }
    }
    road.points = dense;
    if (road.layer) continue;
    for (let i = 1; i < dense.length; i++) {
      const a = node(dense[i-1]), b = node(dense[i]), d = Math.hypot(dense[i][0]-dense[i-1][0], dense[i][1]-dense[i-1][1]);
      a.edges.push([b,d]); b.edges.push([a,d]);
    }
  }
  const queue = [];
  for (const road of roads) if (road.layer) {
    for (const p of [road.points[0], road.points.at(-1)]) {
      const n = nodes.get(key(p)); if (!n) continue;
      const h = Math.max(-20, Math.min(20, road.layer*5));
      if (Math.abs(h) > Math.abs(n.height)) { n.height = h; queue.push(n); }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (const [other, distance] of n.edges) {
      const h = Math.sign(n.height)*Math.max(0, Math.abs(n.height)-distance*.08);
      if (Math.abs(h) > Math.abs(other.height)+.0001) { other.height = h; queue.push(other); }
    }
  }
  for (const road of roads) road.elevations = road.points.map(p => road.layer ? Math.max(-20, Math.min(20, road.layer*5)) : node(p).height);
  // Sampling is needed only to shape the ramp. Remove collinear samples from
  // flat/constant-grade sections before uploading meshes and collision indexes.
  for (const road of roads) {
    const points=[], elevations=[];
    for(let i=0;i<road.points.length;i++) {
      if(i>0 && i<road.points.length-1 && privateKeys.has(road.points[i])) {
        const a=road.points[i-1], b=road.points[i], c=road.points[i+1];
        const ab=Math.hypot(b[0]-a[0],b[1]-a[1]), bc=Math.hypot(c[0]-b[0],c[1]-b[1]);
        if(Math.abs((road.elevations[i]-road.elevations[i-1])/ab-(road.elevations[i+1]-road.elevations[i])/bc)<1e-7) continue;
      }
      points.push(road.points[i]); elevations.push(road.elevations[i]);
    }
    road.points=points; road.elevations=elevations;
  }
  return roads;
}

function decodeBarriers(elements, lat, lng, radiusMeters) {
  return decodeWays(elements, lat, lng, radiusMeters,
    (tags) => ['guard_rail', 'jersey_barrier'].includes(tags.barrier), (element, points, index) => ({
      id: `way/${element.id}/${index}`,
      type: element.tags.barrier,
      points
    }));
}

export function projectCoordinate(lat, lng, center) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
      !Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)) return null;
  return projectInternal(lat, lng, center.lat, center.lng);
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - dx * t, point[1] - start[1] - dy * t);
}

function isRoadPoint(network, point) {
  if (Math.hypot(point[0], point[1]) > network.radiusMeters - 0.5) return false;
  return network.roads.some((road) => {
    const halfWidth = Number.isFinite(road.width) ? road.width / 2 - ROAD_CLEARANCE_METERS : 0;
    if (halfWidth <= 0) return false;
    for (let i = 1; i < road.points.length; i++) {
      if (distanceToSegment(point, road.points[i - 1], road.points[i]) <= halfWidth) return true;
    }
    return false;
  });
}

/** Return the safely drivable fraction of a short local movement, or zero without fresh map coverage. */
export function roadPathProgress(network, start, end, now = Date.now()) {
  if (!network || !Array.isArray(network.roads) || network.roads.length === 0 ||
      !Number.isFinite(network.radiusMeters) || !Number.isFinite(network.fetchedAt) ||
      now - network.fetchedAt < 0 || now - network.fetchedAt > MAX_NETWORK_AGE_MS) return 0;
  const from = projectCoordinate(start.lat, start.lng, network.center);
  const to = projectCoordinate(end.lat, end.lng, network.center);
  if (!from || !to || !isRoadPoint(network, from)) return 0;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(length / 0.5));
  let safeFraction = 0;
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    const point = [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
    if (!isRoadPoint(network, point)) {
      let low = safeFraction, high = fraction;
      for (let iteration = 0; iteration < 12; iteration++) {
        const middle = (low + high) / 2;
        const candidate = [from[0] + (to[0] - from[0]) * middle, from[1] + (to[1] - from[1]) * middle];
        if (isRoadPoint(network, candidate)) low = middle;
        else high = middle;
      }
      return low;
    }
    safeFraction = fraction;
  }
  return 1;
}

function abortReason(signal) {
  if (signal?.reason) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function cloneNetwork(network) {
  return {
    ...network,
    center: { ...network.center },
    roads: network.roads.map((road) => ({
      ...road,
      points: road.points.map((point) => [...point]),
      elevations: road.elevations?.slice()
    })),
    barriers: (network.barriers ?? []).map((barrier) => ({
      ...barrier,
      points: barrier.points.map((point) => [...point])
    }))
  };
}

function getCachedNetwork(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt >= RESPONSE_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry);
  return cloneNetwork(entry.network);
}

function cacheNetwork(key, network) {
  responseCache.delete(key);
  responseCache.set(key, { network: cloneNetwork(network), savedAt: Date.now() });
  if (responseCache.size > MAX_RESPONSE_CACHE_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

async function requestRoads({ lat, lng, radiusMeters, signal, fetchImpl }) {
  const query = `[out:json][timeout:10];(way(around:${radiusMeters},${lat},${lng})["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track|road)$"];way(around:${radiusMeters},${lat},${lng})["barrier"~"^(guard_rail|jersey_barrier)$"];);out body geom;`;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Road data request timed out.')), 40000);

  try {
    let lastError;
    for (const endpoint of OVERPASS_URLS) {
      const attemptController = new AbortController();
      const abortAttempt = () => attemptController.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', abortAttempt, { once: true });
      const attemptTimeout = setTimeout(
        () => attemptController.abort(new Error('Road data mirror timed out.')),
        12000
      );
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }),
          signal: attemptController.signal
        });
        if (!response.ok) throw new Error(`Road data service returned HTTP ${response.status}.`);
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Road data response must be a JSON object.');
        }
        if (typeof data.remark === 'string' && data.remark) throw new Error(data.remark.slice(0, 300));
        if (!Array.isArray(data.elements)) throw new Error('Road data response is missing its elements.');

        return {
          center: { lat, lng },
          radiusMeters,
          fetchedAt: Date.now(),
          roads: decodeRoads(data.elements, lat, lng, radiusMeters),
          omittedGradeSeparatedRoads: 0,
          barriers: decodeBarriers(data.elements, lat, lng, radiusMeters)
        };
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason ?? error;
        lastError = error;
      } finally {
        clearTimeout(attemptTimeout);
        controller.signal.removeEventListener('abort', abortAttempt);
      }
    }
    throw lastError ?? new Error('Road data service is unavailable.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

function waitForRoadRequest(request, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  request.waiters++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      request.waiters--;
      if (request.waiters === 0 && !request.settled) {
        if (inFlightRequests.get(request.key) === request) inFlightRequests.delete(request.key);
        request.controller.abort(new Error('No road-data request consumers remain.'));
      }
      callback(value);
    };
    const onAbort = () => settle(reject, abortReason(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    request.promise.then(
      (network) => settle(resolve, cloneNetwork(network)),
      (error) => settle(reject, error)
    );
  });
}

/** Load a bounded set of nearby drivable OSM ways as local-meter line geometry. */
export async function loadRoads(options = {}) {
  const { lat, lng, radiusMeters = 1200, signal } = options;
  const hasInjectedFetch = Object.prototype.hasOwnProperty.call(options, 'fetchImpl');
  const fetchImpl = hasInjectedFetch ? options.fetchImpl : globalThis.fetch;
  validateRequest(lat, lng, radiusMeters);
  if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch-compatible function is required.');
  if (signal?.aborted) throw abortReason(signal);

  // Custom fetch functions are commonly used by callers/tests and must remain isolated.
  if (hasInjectedFetch) {
    return requestRoads({ lat, lng, radiusMeters, signal, fetchImpl });
  }

  const key = `${lat},${lng},${radiusMeters}`;
  const cached = getCachedNetwork(key);
  if (cached) return cached;

  let request = inFlightRequests.get(key);
  if (!request) {
    const controller = new AbortController();
    request = { key, controller, waiters: 0, settled: false, promise: null };
    request.promise = requestRoads({ lat, lng, radiusMeters, signal: controller.signal, fetchImpl })
      .then((network) => {
        cacheNetwork(key, network);
        return network;
      })
      .finally(() => {
        request.settled = true;
        if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
      });
    inFlightRequests.set(key, request);
  }

  return waitForRoadRequest(request, signal);
}

/** Decode OSM map data and Overpass geometry into one shared driving/rendering model. */
export function decodeWorld(elements, lat, lng, radiusMeters = 400) {
  const nodes = new Map(elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const ways = elements.filter(e => e.type === 'way').map(e => ({...e,
    geometry: e.geometry ?? (e.nodes ?? []).map(id => { const n = nodes.get(id); return {lat:n?.lat, lon:n?.lon}; })
  }));
  const buildings = [];
  const coastlines = decodeWays(ways, lat, lng, radiusMeters, tags => tags.natural === 'coastline', (element, points, index) => ({id: `coast/${element.id}/${index}`, points}));
  // Multipolygon boundaries cannot be filled independently: inner rings are holes.
  // Leave these out until polygon assembly is supported, even if an outer way has tags.
  const relationWays = new Set(elements.filter(e => e.type === 'relation' && e.tags?.type === 'multipolygon')
    .flatMap(e => (e.members ?? []).filter(m => m.type === 'way').map(m => m.ref)));
  const sceneryAreas = [];
  const trees = [];
  for (const node of nodes.values()) {
    if (node.tags?.natural !== 'tree' || !Number.isFinite(node.lat) || !Number.isFinite(node.lon) ||
      Math.abs(node.lat) > 90 || Math.abs(node.lon) > 180) continue;
    const point = projectInternal(node.lat, node.lon, lat, lng);
    if (Math.hypot(...point) > radiusMeters) continue;
    const height = Number.parseFloat(node.tags.height);
    trees.push({ id: node.id, point, height: Number.isFinite(height) ? Math.max(2, Math.min(30, height)) : 7,
      estimatedHeight: !Number.isFinite(height), source: 'mapped' });
  }
  for (const way of ways) {
    const tags = way.tags ?? {};
    const kind = tags.natural === 'water' || ['reservoir', 'basin'].includes(tags.landuse) || tags.waterway === 'riverbank'
      ? 'water' : tags.leisure === 'park' || tags.landuse === 'recreation_ground' ? 'park'
      : ['grass', 'meadow', 'village_green'].includes(tags.landuse) || tags.natural === 'grassland' ? 'grass' : null;
    if (!kind || relationWays.has(way.id) || tags.area === 'no' || way.geometry.length < 4 || way.geometry.length > 4096) continue;
    if (!way.geometry.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) continue;
    const first = way.geometry[0], last = way.geometry.at(-1);
    if (first.lat !== last.lat || first.lon !== last.lon) continue;
    const points = way.geometry.map(p => projectInternal(p.lat, p.lon, lat, lng));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    if (Math.min(...xs) > radiusMeters || Math.max(...xs) < -radiusMeters ||
      Math.min(...ys) > radiusMeters || Math.max(...ys) < -radiusMeters) continue;
    sceneryAreas.push({ id: way.id, kind, points, source: 'mapped' });
  }
  // building=roof marks a roof-only structure (e.g. a canopy) with no volume;
  // skip it so it never reads as a solid building. Only extrude real footprints.
  for (const way of ways) {
    const buildingTag = way.tags?.building;
    if (way.tags?.location === 'underground' || Number(way.tags?.layer) < 0) continue;
    if (!buildingTag || buildingTag === 'no' || buildingTag === 'roof' || way.geometry.length < 4) continue;
    if (way.tags?.natural === 'yes' || !way.geometry.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))) continue;
    const points = way.geometry.map(p => projectInternal(p.lat,p.lon,lat,lng));
    if (Math.hypot(points[0][0]-points.at(-1)[0], points[0][1]-points.at(-1)[1]) > 1) continue;
    if (!points.some(p => Math.hypot(...p) < radiusMeters + 150)) continue;
    const taggedHeight = Number.parseFloat(way.tags.height);
    const levels = Number.parseFloat(way.tags['building:levels']);
    const height = Number.isFinite(taggedHeight) ? taggedHeight : Number.isFinite(levels) ? levels * 3.2 : 10;
    const minHeight = Math.max(0, Number.parseFloat(way.tags.min_height) || Number.parseFloat(way.tags['building:min_level'])*3.2 || 0);
    buildings.push({id:way.id, points, minHeight, height:Math.max(3,Math.min(180,height)), estimated:!Number.isFinite(taggedHeight) && !Number.isFinite(levels), source:'mapped'});
  }
  return {center:{lat,lng}, radiusMeters, fetchedAt:Date.now(), roads:decodeRoads(ways,lat,lng,radiusMeters), omittedGradeSeparatedRoads:0, barriers:decodeBarriers(ways,lat,lng,radiusMeters), buildings, sceneryAreas, trees, coastlines};
}
