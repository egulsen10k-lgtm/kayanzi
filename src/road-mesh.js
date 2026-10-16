import * as THREE from 'three';

export const ROAD_SURFACE_HEIGHT = 0.025;
const BASE = -0.035;
const CURB_HEIGHT = 0.13;

function quad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

// Bounded miters connect neighboring segments without cracks or long spikes.
function offsets(points, distance) {
  const normals = points.slice(1).map((p, i) => {
    const dx = p[0] - points[i][0], dz = p[1] - points[i][1];
    const length = Math.hypot(dx, dz);
    return [-dz / length, dx / length];
  });
  return points.map((p, i) => {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(normals.length - 1, i)];
    let x = before[0] + after[0], z = before[1] + after[1];
    const length = Math.hypot(x, z);
    if (length < 1e-5) { x = after[0]; z = after[1]; }
    else { x /= length; z /= length; }
    const scale = Math.min(distance * 2, distance / Math.max(.5, x * after[0] + z * after[1]));
    return [x * scale, z * scale];
  });
}

function cleanFragments(raw) {
  const result = [];
  let points = [];
  const flush = () => { if (points.length > 1) result.push(points); points = []; };
  for (const p of raw ?? []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { flush(); continue; }
    const next = [p[0], -p[1]];
    const previous = points.at(-1);
    if (!previous || Math.hypot(next[0] - previous[0], next[1] - previous[1]) > .01) points.push(next);
  }
  flush();
  return result;
}

/** Local X=east, Z=south. All children are disposable Meshes, never nested groups. */
export function buildRoadMeshes(network) {
  const group = new THREE.Group();
  group.name = 'road-surfaces';
  const asphalt = [], markings = [], shoulders = [], curbs = [];
  for (const road of network?.roads ?? []) {
    if (!Number.isFinite(road.width) || road.width < 2 || road.width > 40) continue;
    for (const points of cleanFragments(road.points)) {
      const inner = offsets(points, road.width / 2);
      const outer = offsets(points, road.width / 2 + .22);
      const shoulder = offsets(points, road.width / 2 + .65);
      const at = (i, offset, sign, y) => [points[i][0] + offset[i][0] * sign, y, points[i][1] + offset[i][1] * sign];
      // Curbs are appropriate for urban streets, not motorways or dirt tracks.
      const hasCurbs = ['residential', 'living_street', 'service', 'unclassified', 'tertiary', 'secondary', 'primary'].includes(road.highway);
      let travelled = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const j = i + 1;
        quad(asphalt, at(i, inner, 1, ROAD_SURFACE_HEIGHT), at(j, inner, 1, ROAD_SURFACE_HEIGHT), at(j, inner, -1, ROAD_SURFACE_HEIGHT), at(i, inner, -1, ROAD_SURFACE_HEIGHT));
        for (const side of [-1, 1]) {
          quad(asphalt, at(i, inner, side, BASE), at(j, inner, side, BASE), at(j, inner, side, ROAD_SURFACE_HEIGHT), at(i, inner, side, ROAD_SURFACE_HEIGHT));
          quad(shoulders, at(i, inner, side, BASE), at(j, inner, side, BASE), at(j, shoulder, side, BASE), at(i, shoulder, side, BASE));
          if (hasCurbs) {
            quad(curbs, at(i, inner, side, CURB_HEIGHT), at(j, inner, side, CURB_HEIGHT), at(j, outer, side, CURB_HEIGHT), at(i, outer, side, CURB_HEIGHT));
            for (const edge of [inner, outer]) {
              quad(curbs, at(i, edge, side, BASE), at(j, edge, side, BASE), at(j, edge, side, CURB_HEIGHT), at(i, edge, side, CURB_HEIGHT));
            }
          }
        }
        const [ax, az] = points[i], [bx, bz] = points[j];
        const length = Math.hypot(bx - ax, bz - az);
        // Keep the dash phase continuous across OSM geometry vertices.
        if (road.width >= 5 && road.highway !== 'track' && road.highway !== 'living_street') {
          const nx = -(bz - az) / length * .065, nz = (bx - ax) / length * .065;
          for (let start = Math.floor(travelled / 8) * 8; start < travelled + length; start += 8) {
            const from = Math.max(0, start - travelled), to = Math.min(length, start + 3 - travelled);
            if (to <= from) continue;
            const p = (d, sign) => [ax + (bx - ax) * d / length + sign * nx, ROAD_SURFACE_HEIGHT + .004, az + (bz - az) * d / length + sign * nz];
            quad(markings, p(from, 1), p(to, 1), p(to, -1), p(from, -1));
          }
        }
        travelled += length;
      }
      for (const i of [0, points.length - 1]) {
        quad(asphalt, at(i, inner, -1, BASE), at(i, inner, 1, BASE), at(i, inner, 1, ROAD_SURFACE_HEIGHT), at(i, inner, -1, ROAD_SURFACE_HEIGHT));
      }
    }
  }
  for (const [name, vertices, color] of [
    ['asphalt', asphalt, 0x34383d], ['markings', markings, 0xf0eee4],
    ['shoulders', shoulders, 0x78786e], ['curbs', curbs, 0xb7b4ab]
  ]) {
    if (!vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color, roughness: .95, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = name === 'curbs';
    group.add(mesh);
  }
  return group;
}
