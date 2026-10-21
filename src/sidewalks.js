export const SIDEWALK_HEIGHT = 0.22;
export function sidewalkWidth(road) {
  if (road.bridge || road.tunnel || road.elevations?.some(height => Math.abs(height) > .01)) return 0;
  return ['residential', 'living_street', 'service', 'unclassified', 'tertiary', 'secondary', 'primary'].includes(road.highway) ? 1.6 : 0;
}
