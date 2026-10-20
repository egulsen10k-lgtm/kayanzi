import * as THREE from 'three';

export const ROAD_SURFACE_HEIGHT = 0.08;
const BASE = -0.035;
const CURB_HEIGHT = 0.22;

function asphaltTexture() {
  // A small repeatable aggregate texture, mapped in meters rather than per road.
  const size = 128, pixels = new Uint8Array(size * size * 4);
  let seed = 173;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 170 + (seed >>> 24) % 65;
    pixels.set([value, value, value, 255], i);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

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

function cleanFragments(raw, elevations = []) {
  const result = [];
  let points = [];
  const flush = () => { if (points.length > 1) result.push(points); points = []; };
  for (const [index, p] of (raw ?? []).entries()) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { flush(); continue; }
    const next = [p[0], -p[1], elevations[index] ?? 0];
    const previous = points.at(-1);
    if (!previous || Math.hypot(next[0] - previous[0], next[1] - previous[1]) > .01) points.push(next);
  }
  flush();
  return result;
}


// Index swept road widths once. The former endpoint-only, all-roads scan missed
// crossings halfway along long ways and was quadratic in city-sized networks.
function streetOverlap(network) {
  const size = 32, cells = new Map();
  for (const road of network?.roads ?? []) {
    if (!Number.isFinite(road.width) || road.width < 2 || road.width > 40) continue;
    for (const points of cleanFragments(road.points, road.elevations)) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], radius = road.width / 2 + .35;
      const segment = { road, a, b, radius };
      for (let x = Math.floor((Math.min(a[0], b[0]) - radius) / size); x <= Math.floor((Math.max(a[0], b[0]) + radius) / size); x++)
        for (let z = Math.floor((Math.min(a[1], b[1]) - radius) / size); z <= Math.floor((Math.max(a[1], b[1]) + radius) / size); z++) {
          const key = x + ',' + z;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(segment);
        }
    }
  }
  return (road, point) => (cells.get(Math.floor(point[0] / size) + ',' + Math.floor(point[2] / size)) ?? []).some(s => {
    if (s.road === road) return false;
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - s.a[0]) * dx + (point[2] - s.a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.abs(point[1] - (s.a[2]+(s.b[2]-s.a[2])*t+ROAD_SURFACE_HEIGHT)) < .5 && Math.hypot(point[0] - s.a[0] - t * dx, point[2] - s.a[1] - t * dz) <= s.radius;
  });
}

const interpolate = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

// Keep runs merged into long quads; sampling only determines their boundaries.
function exposedRuns(a, b, blocked) {
  const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2])));
  const runs = [];
  let start = null;
  for (let i = 0; i < count; i++) {
    const visible = ![i / count, (i + .5) / count, (i + 1) / count].some(t => blocked(interpolate(a, b, t)));
    if (visible && start === null) start = i / count;
    if (!visible && start !== null) { runs.push([start, i / count]); start = null; }
  }
  if (start !== null) runs.push([start, 1]);
  return runs;
}

/** Local X=east, Z=south. All children are disposable Meshes, never nested groups. */
export function buildRoadMeshes(network) {
  const group = new THREE.Group();
  group.name = 'road-surfaces';
  const asphalt = [], markings = [], shoulders = [], curbs = [], structures = [];
  const overlaps = streetOverlap(network);
  for (const road of network?.roads ?? []) {
    if (!Number.isFinite(road.width) || road.width < 2 || road.width > 40) continue;
    for (const points of cleanFragments(road.points, road.elevations)) {
      const inner = offsets(points, road.width / 2);
      const outer = offsets(points, road.width / 2 + .22);
      const shoulder = offsets(points, road.width / 2 + .65);
      const at = (i, offset, sign, y) => [points[i][0] + offset[i][0] * sign, y + points[i][2], points[i][1] + offset[i][1] * sign];
      // Curbs are appropriate for urban streets, not motorways or dirt tracks.
      const hasCurbs = ['residential', 'living_street', 'service', 'unclassified', 'tertiary', 'secondary', 'primary'].includes(road.highway);
      // Rounded node pads match the road union used by collision checks.
      for (const [x,z,height] of points) {
        const radius=road.width/2;
        for(let k=0;k<24;k++) {
          const a=k*Math.PI/12,b=(k+1)*Math.PI/12;
          asphalt.push(x,height+ROAD_SURFACE_HEIGHT,z,x+Math.cos(b)*radius,height+ROAD_SURFACE_HEIGHT,z+Math.sin(b)*radius,x+Math.cos(a)*radius,height+ROAD_SURFACE_HEIGHT,z+Math.sin(a)*radius);
        }
      }
      let travelled = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const j = i + 1;
        quad(asphalt, at(i, inner, 1, ROAD_SURFACE_HEIGHT), at(j, inner, 1, ROAD_SURFACE_HEIGHT), at(j, inner, -1, ROAD_SURFACE_HEIGHT), at(i, inner, -1, ROAD_SURFACE_HEIGHT));
        for (const side of [-1, 1]) {
          quad(asphalt, at(i, inner, side, BASE), at(j, inner, side, BASE), at(j, inner, side, ROAD_SURFACE_HEIGHT), at(i, inner, side, ROAD_SURFACE_HEIGHT));
          quad(shoulders, at(i, inner, side, .005), at(j, inner, side, .005), at(j, shoulder, side, .005), at(i, shoulder, side, .005));
          if (hasCurbs) {
            const a = at(i, inner, side, CURB_HEIGHT), b = at(j, inner, side, CURB_HEIGHT);
            for (const [from, to] of exposedRuns(a, b, point => overlaps(road, point))) {
              const section = (edge, y, t) => interpolate(at(i, edge, side, y), at(j, edge, side, y), t);
              quad(curbs, section(inner, CURB_HEIGHT, from), section(inner, CURB_HEIGHT, to), section(outer, CURB_HEIGHT, to), section(outer, CURB_HEIGHT, from));
              for (const edge of [inner, outer]) {
                quad(curbs, section(edge, BASE, from), section(edge, BASE, to), section(edge, CURB_HEIGHT, to), section(edge, CURB_HEIGHT, from));
              }
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
            const p = (d, sign) => [ax + (bx - ax) * d / length + sign * nx, ROAD_SURFACE_HEIGHT + .004 + points[i][2] + (points[j][2]-points[i][2])*d/length, az + (bz - az) * d / length + sign * nz];
            // No lane dashes painted across another street's junction.
            if (![from, (from + to) / 2, to].some(d => overlaps(road, p(d, 0))))
              quad(markings, p(from, 1), p(to, 1), p(to, -1), p(from, -1));
          }
        }
        if (road.bridge || road.tunnel) {
          // Continuous structural walls sit outside the driveable deck; tunnels
          // retain a 4m internal clearance. Portals stay open at each endpoint.
          const wallTop = road.tunnel ? 4.2 : 1.1;
          for (const side of [-1,1]) {
            quad(structures, at(i,outer,side,BASE), at(j,outer,side,BASE), at(j,outer,side,wallTop), at(i,outer,side,wallTop));
          }
          if (road.tunnel) quad(structures, at(i,outer,1,4.2), at(j,outer,1,4.2), at(j,outer,-1,4.2), at(i,outer,-1,4.2));
          else {
            quad(structures, at(i,outer,1,-.45), at(j,outer,1,-.45), at(j,outer,-1,-.45), at(i,outer,-1,-.45));
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
    ['structures', structures, 0x8c9296], ['shoulders', shoulders, 0x78786e], ['curbs', curbs, 0xb7b4ab]
  ]) {
    if (!vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color, roughness: .95, side: THREE.DoubleSide });
    if (name === 'asphalt') {
      const uv = [];
      for (let i = 0; i < vertices.length; i += 3) uv.push(vertices[i] / 3, vertices[i + 2] / 3);
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      material.map = asphaltTexture();
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = ['curbs','structures','asphalt'].includes(name);
    group.add(mesh);
  }
  return group;
}
