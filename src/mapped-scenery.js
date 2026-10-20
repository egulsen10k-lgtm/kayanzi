import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

function safeTree(point, network) {
  for (const road of network.roads ?? []) {
    for (let i = 1; i < road.points.length; i++) {
      if (segmentDistance(point, road.points[i - 1], road.points[i]) < road.width / 2 + 3) return false;
    }
  }
  for (const building of network.buildings ?? []) {
    if (inside(point, building.points)) return false;
    for (let i = 1; i < building.points.length; i++) {
      if (segmentDistance(point, building.points[i - 1], building.points[i]) < 3) return false;
    }
  }
  return !(network.sceneryAreas ?? []).some(area => area.kind === 'water' && inside(point, area.points));
}

// Generated park trees are decoration within mapped parks, never claimed as surveyed trees.
export function sceneryTrees(network, limit = 600) {
  const trees = [];
  const radius = Math.min(700, network.radiusMeters ?? 400);
  for (const tree of network.trees ?? []) {
    if (trees.length >= limit) break;
    if (Math.hypot(...tree.point) <= radius && safeTree(tree.point, network)) trees.push(tree);
  }
  for (const area of network.sceneryAreas ?? []) {
    if (area.kind !== 'park' || trees.length >= limit) continue;
    const xs = area.points.map(p => p[0]), ys = area.points.map(p => p[1]);
    const minX = Math.max(-radius, Math.min(...xs)), maxX = Math.min(radius, Math.max(...xs));
    const minY = Math.max(-radius, Math.min(...ys)), maxY = Math.min(radius, Math.max(...ys));
    for (let x = Math.ceil(minX / 22) * 22; x < maxX && trees.length < limit; x += 22) {
      for (let y = Math.ceil(minY / 22) * 22; y < maxY && trees.length < limit; y += 22) {
        const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const variation = seed - Math.floor(seed);
        const point = [x + (variation - 0.5) * 9, y + (0.5 - variation) * 9];
        if (Math.hypot(...point) > radius || !inside(point, area.points) || !safeTree(point, network)) continue;
        if (trees.some(tree => Math.hypot(tree.point[0] - point[0], tree.point[1] - point[1]) < 12)) continue;
        trees.push({ point, height: 5 + variation * 4, source: 'generated-park-decoration' });
      }
    }
  }
  return trees;
}

/** Actual mapped surface outlines, approximate tree shapes. Does not alter collision. */
export function buildMappedScenery(network) {
  const group = new THREE.Group();
  group.name = 'mapped-scenery';
  // Above aerial imagery (-0.025 m), below the actual asphalt and tree bases.
  const styles = { park: { color: 0x64814b, y: -0.012 }, grass: { color: 0x7d925a, y: -0.015 },
    water: { color: 0x428796, y: -0.009 } };
  for (const [kind, style] of Object.entries(styles)) {
    const geometries = [];
    for (const area of (network.sceneryAreas ?? []).filter(area => area.kind === kind).slice(0, 128)) {
      if (area.points.length < 4) continue;
      const shape = new THREE.Shape(area.points.slice(0, -1).map(([east, north]) => new THREE.Vector2(east, north)));
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, style.y, 0);
      geometries.push(geometry);
    }
    if (!geometries.length) continue;
    const merged = mergeGeometries(geometries);
    geometries.forEach(geometry => geometry.dispose());
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: style.color,
      roughness: kind === 'water' ? 0.3 : 1, metalness: kind === 'water' ? 0.15 : 0 }));
    mesh.name = `mapped-${kind}`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const trees = sceneryTrees(network);
  group.userData.mappedTreeCount = trees.filter(tree => tree.source === 'mapped').length;
  group.userData.generatedParkTreeCount = trees.length - group.userData.mappedTreeCount;
  if (!trees.length) return group;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.23, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x65513b, roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), trees.length);
  trunks.name = 'tree-trunks';
  crowns.name = 'tree-crowns';
  const dummy = new THREE.Object3D();
  trees.forEach((tree, index) => {
    const height = Math.min(16, tree.height), [east, north] = tree.point;
    dummy.position.set(east, height * 0.26, -north);
    dummy.scale.set(1, height * 0.52, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = height * 0.7;
    dummy.scale.set(height * 0.27, height * 0.3, height * 0.27);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, new THREE.Color().setHSL(0.27 + (index % 5) * 0.012, 0.28, 0.25 + (index % 4) * 0.018));
  });
  for (const mesh of [trunks, crowns]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
