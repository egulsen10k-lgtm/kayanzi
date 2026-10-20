import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWorld } from '../src/road-network.js';
import { buildMappedScenery, sceneryTrees } from '../src/mapped-scenery.js';
import { disposeWorldGroup } from '../src/building-world.js';

const polygon = (id, tags, offset = 0) => ({ type: 'way', id, tags, geometry: [
  { lat: offset, lon: 0 }, { lat: offset, lon: 0.001 },
  { lat: offset + 0.001, lon: 0.001 }, { lat: offset + 0.001, lon: 0 }, { lat: offset, lon: 0 }
] });

test('decodes real tree points and closed mapped areas, excludes coastline and multipolygon members', () => {
  const elements = [polygon(1, { leisure: 'park' }), polygon(2, { natural: 'water' }),
    polygon(3, { landuse: 'grass' }), polygon(4, { natural: 'coastline' }),
    polygon(5, { natural: 'water' }), polygon(6, { natural: 'water' }),
    { type: 'relation', tags: { type: 'multipolygon', natural: 'water' }, members: [
      { type: 'way', ref: 5, role: 'outer' }, { type: 'way', ref: 6, role: 'inner' }] },
    { type: 'node', id: 7, lat: 0.0001, lon: 0.0002, tags: { natural: 'tree', height: '9' } },
    { type: 'node', id: 8, lat: 80, lon: 90, tags: { natural: 'tree' } }];
  const network = decodeWorld(elements, 0, 0, 400);
  assert.deepEqual(network.sceneryAreas.map(area => area.kind), ['park', 'water', 'grass']);
  assert.equal(network.trees.length, 1);
  assert.equal(network.trees[0].height, 9);
  assert.equal(network.trees[0].source, 'mapped');
});

test('rejects open, incomplete, invalid and remote area geometry', () => {
  const open = polygon(1, { natural: 'water' }); open.geometry.pop();
  const invalid = polygon(2, { natural: 'water' }); invalid.geometry[1].lat = NaN;
  const network = decodeWorld([open, invalid, polygon(3, { leisure: 'park' }, 50)], 0, 0, 400);
  assert.deepEqual(network.sceneryAreas, []);
});

test('decorative park trees are bounded, deterministic and outside road/building/water clearance', () => {
  const network = { radiusMeters: 100,
    sceneryAreas: [{ kind: 'park', points: [[-90,-90],[90,-90],[90,90],[-90,90],[-90,-90]] },
      { kind: 'water', points: [[40,40],[85,40],[85,85],[40,85],[40,40]] }],
    roads: [{ width: 8, points: [[-100,0],[100,0]] }],
    buildings: [{ points: [[-40,20],[20,20],[20,60],[-40,60],[-40,20]] }],
    trees: [{ point: [0,0], height: 7, source: 'mapped' }, { point: [0,40], height: 7, source: 'mapped' }]
  };
  const trees = sceneryTrees(network, 30);
  assert.ok(trees.length > 5 && trees.length <= 30);
  assert.deepEqual(sceneryTrees(network, 30), trees);
  for (const tree of trees) {
    const [x,y] = tree.point;
    assert.equal(tree.source, 'generated-park-decoration');
    assert.ok(Math.abs(y) >= 7);
    assert.ok(!(x > -43 && x < 23 && y > 17 && y < 63));
    assert.ok(!(x >= 40 && y >= 40 && x <= 85 && y <= 85));
    assert.ok(Math.hypot(x,y) <= 100);
  }
  const group = buildMappedScenery(network);
  assert.equal(group.children.filter(child => child.isInstancedMesh).length, 2);
  assert.ok(group.children.length <= 5);
  for (const mesh of group.children.filter(child => !child.isInstancedMesh)) {
    mesh.geometry.computeBoundingBox();
    assert.ok(mesh.geometry.boundingBox.max.y < 0);
  }
  disposeWorldGroup(group);
});

test('empty map produces no invented scenery', () => {
  assert.equal(buildMappedScenery({}).children.length, 0);
});
