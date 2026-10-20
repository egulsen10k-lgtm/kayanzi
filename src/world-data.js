import { assetUrl, mapApiBase } from './resource-urls.js';
import { decodeWorld, loadRoads } from './road-network.js';
import { decodeWorldAsync } from './world-decoder.js';
import { loadBundledWorld, containsCoordinate } from './bundled-world.js';

let activeRoute = null;
let routeStartData = null;
export function setWorldRoute(route, startData = null) { activeRoute = route; routeStartData = startData; }

function withRoute(network, route, allowApproximation = false) {
  if (!route) return network;
  if (!allowApproximation || network.roads.length) return {...network, routeName:route.name, routeApproximate:false};
  const corridor = decodeWorld(route.elements, network.center.lat, network.center.lng, 30000);
  // Use mapped street geometry whenever available. The offline corridor is an
  // explicitly labelled approximation, never overlaid on the mapped streets.
  return {...network, roads:corridor.roads, radiusMeters:30000, routeName:route.name, routeApproximate:true};
}

// A real OSM starter district is bundled, so Munich remains driveable offline.
export async function loadWorld({lat,lng,signal}) {
  const route = activeRoute;
  if (route) {
    try {
      const bundled = await loadBundledWorld(lat,lng,signal);
      if (bundled) {
        const network = await decodeWorldAsync(bundled.elements,lat,lng,bundled.radiusMeters,signal);
        network.source = bundled.source; network.bundled = true;
        return withRoute(network,route);
      }
    } catch(error) { if (signal?.aborted) throw error; }
  }
  // The starter dataset only covers this rectangle, not a 1.8km circle.
  if (route && routeStartData && containsCoordinate([29.055,40.960,29.085,40.975],lat,lng,100)) {
    return withRoute(await decodeWorldAsync(routeStartData.elements,lat,lng,500,signal),route);
  }
  const starter = Math.hypot((lat-48.1764)*111195, (lng-11.5583)*74150) < 70;
  const radiusMeters = starter ? 450 : 350;
  const deltaLat = radiusMeters / 111195;
  const deltaLng = deltaLat / Math.max(.05,Math.cos(lat*Math.PI/180));
  const west = Math.max(-180,lng-deltaLng), east = Math.min(180,lng+deltaLng);
  const south = Math.max(-89.9,lat-deltaLat), north = Math.min(89.9,lat+deltaLat);
  const url = starter ? assetUrl('data/munich.json') : `${mapApiBase}/map.json?bbox=${west},${south},${east},${north}`;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(()=>controller.abort(),20000);
  try {
    const response = await fetch(url,{signal:controller.signal});
    if (!response.ok) throw new Error(`Map service HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.elements)) throw new Error('Invalid map data');
    const network = await decodeWorldAsync(data.elements,lat,lng,radiusMeters,signal);
    network.source = starter ? 'Bundled OpenStreetMap district' : 'OpenStreetMap';
    return withRoute(network,route);
  } catch(error) {
    if (signal?.aborted) throw error;
    if (route) return withRoute({center:{lat,lng},radiusMeters,roads:[],buildings:[],barriers:[],fetchedAt:Date.now(),source:'Bundled Akanzi corridor'},route,true);
    return await loadRoads({lat,lng,radiusMeters,signal});
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
}
