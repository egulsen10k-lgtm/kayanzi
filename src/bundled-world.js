import { distanceMeters } from './world-streaming.js';

import { assetUrl } from './resource-urls.js';
const BASE = assetUrl('data/akanzi-world/');
export function containsCoordinate(bbox, lat, lng, margin = 0) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const latitudeMargin = margin / 111195;
  const longitudeMargin = latitudeMargin / Math.max(.05, Math.cos(lat * Math.PI / 180));
  return lng >= bbox[0] + longitudeMargin && lng <= bbox[2] - longitudeMargin &&
    lat >= bbox[1] + latitudeMargin && lat <= bbox[3] - latitudeMargin;
}

function nearPatch(patch, lat, lng, radius) {
  const [west,south,east,north] = patch.bbox;
  return distanceMeters({lat,lng}, {lat:Math.max(south,Math.min(north,lat)),lng:Math.max(west,Math.min(east,lng))}) <= radius;
}

// Only raw nearby patches are retained. No service key or external API is needed.
export function createBundledWorldLoader({fetchImpl = (...args) => fetch(...args), maxEntries = 8} = {}) {
  const cache = new Map();
  let manifest = null, retryManifestAt = 0;
  return async function loadBundledWorld(lat,lng,signal) {
    if (signal?.aborted) throw signal.reason;
    if (!manifest) {
      if (Date.now() < retryManifestAt) return null;
      try {
        const response = await fetchImpl(`${BASE}manifest.json`,{signal});
        if (!response.ok) throw new Error('Bundled manifest unavailable');
        const data = await response.json();
        if (data.version !== 1 || !Array.isArray(data.patches)) throw new Error('Invalid bundled manifest');
        manifest = {...data, patches:data.patches.filter(p =>
          typeof p.file === 'string' && /^[a-z0-9_-]+\.json$/i.test(p.file) &&
          Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every(Number.isFinite) &&
          p.bbox[0] < p.bbox[2] && p.bbox[1] < p.bbox[3])};
      } catch(error) {
        if (signal?.aborted) throw error;
        retryManifestAt = Date.now() + 60000;
        return null;
      }
    }
    if (!manifest.patches.some(p => containsCoordinate(p.bbox,lat,lng,40))) return null;
    const selected = manifest.patches.filter(p => nearPatch(p,lat,lng,350));
    const elements = new Map();
    for (const patch of selected) {
      if (signal?.aborted) throw signal.reason;
      let data = cache.get(patch.file);
      if (!data) {
        const response = await fetchImpl(BASE + patch.file,{signal});
        if (!response.ok) throw new Error('Bundled district unavailable');
        data = await response.json();
        if (!Array.isArray(data.elements)) throw new Error('Invalid bundled district');
      }
      cache.delete(patch.file); cache.set(patch.file,data);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      for (const element of data.elements) {
        const key = `${element.type}/${element.id}`;
        const previous = elements.get(key);
        // A way repeated across patches may have a more complete node list.
        if (!previous || (element.geometry?.length ?? 0) > (previous.geometry?.length ?? 0)) elements.set(key,element);
      }
    }
    if (signal?.aborted) throw signal.reason;
    return {elements:[...elements.values()],radiusMeters:350,source:'Bundled OpenStreetMap · Akanzi',bundled:true};
  };
}
export const loadBundledWorld = createBundledWorldLoader();
