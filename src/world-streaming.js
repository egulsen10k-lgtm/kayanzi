const RADIUS = 6371008.8;

export function distanceMeters(a, b) {
  const longitude = ((b.lng - a.lng + 540) % 360) - 180;
  return Math.hypot((b.lat - a.lat) * Math.PI / 180 * RADIUS,
    longitude * Math.PI / 180 * RADIUS * Math.cos((a.lat + b.lat) * Math.PI / 360));
}

export function nearbyCachedWorld(cache, lat, lng, now = Date.now()) {
  let result = null, best = 80;
  for (const [key, entry] of cache) {
    if (now - entry.savedAt >= 300000) continue;
    const distance = distanceMeters(entry.network.center, {lat, lng});
    if (distance <= best) { best = distance; result = {key, ...entry}; }
  }
  return result;
}

// Request the district ahead before the current 350m patch runs out.
// Backward travel streams behind the car, not in the direction of its bonnet.
export function nextWorldLocation(position, heading, speed) {
  const distance = Math.min(100, Math.abs(speed) / 3.6 * 4) * Math.sign(speed);
  const angle = distance / RADIUS, latitude = position.lat * Math.PI / 180;
  const nextLat = Math.asin(Math.sin(latitude) * Math.cos(angle) + Math.cos(latitude) * Math.sin(angle) * Math.cos(heading));
  const delta = Math.atan2(Math.sin(heading) * Math.sin(angle) * Math.cos(latitude), Math.cos(angle) - Math.sin(latitude) * Math.sin(nextLat));
  return {lat:nextLat * 180 / Math.PI, lng:((position.lng + delta * 180 / Math.PI + 540) % 360) - 180};
}
