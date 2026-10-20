// Vite rewrites module assets, but runtime fetch paths also need the Pages prefix.
export function assetUrl(path, base = import.meta.env?.BASE_URL ?? '/') {
  return `${base.endsWith('/') ? base : base + '/'}${path.replace(/^\/+/, '')}`;
}
export const mapApiBase = import.meta.env?.PROD ? 'https://api.openstreetmap.org/api/0.6' : '/api/osm';
export const overpassEndpoints = import.meta.env?.PROD
  ? ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter']
  : ['/api/overpass','/api/overpass/private','/api/overpass/vk'];
