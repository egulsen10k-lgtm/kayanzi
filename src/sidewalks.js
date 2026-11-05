export const SIDEWALK_HEIGHT = 0.22;

const URBAN_HIGHWAYS = new Set([
  'residential', 'living_street', 'service', 'unclassified',
  'tertiary', 'secondary', 'primary'
]);

export function sidewalkWidth(road) {
  if (!road || typeof road !== 'object' || Array.isArray(road)) return 0;
  if (road.bridge || road.tunnel || !URBAN_HIGHWAYS.has(road.highway)) return 0;
  if (!Number.isFinite(road.width) || road.width < 2 || road.width > 40) return 0;
  if (!Array.isArray(road.points) || road.points.length < 2 || road.points.some(point =>
    !Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return 0;

  if (road.elevations !== undefined) {
    if (!Array.isArray(road.elevations) || road.elevations.length !== road.points.length ||
        road.elevations.some(height => !Number.isFinite(height))) return 0;
    if (road.elevations.some(height => Math.abs(height) > .01)) return 0;
  }

  return 1.6;
}
