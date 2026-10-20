import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { earthToLocal, PhotorealWorld } from '../src/photoreal-world.js';

test('WGS84 local frame maps equatorial origin to zero and preserves east/up/south', () => {
  const matrix = earthToLocal(0, 0);
  assert.ok(new Vector3(6378137, 0, 0).applyMatrix4(matrix).length() < 1e-8);
  assert.deepEqual(new Vector3(6378137, 1, 0).applyMatrix4(matrix).toArray(), [1, 0, 0]);
  assert.deepEqual(new Vector3(6378138, 0, 0).applyMatrix4(matrix).toArray(), [0, 1, 0]);
  assert.deepEqual(new Vector3(6378137, 0, 1).applyMatrix4(matrix).toArray(), [0, 0, -1]);
});

test('local frames remain orthonormal at Istanbul, poles and dateline; altitude points up', () => {
  for (const [lat, lng] of [[40.97, 29.06], [90, 180], [-90, -180], [0, 179.99]]) {
    const matrix = earthToLocal(lat, lng, 123);
    const inverse = matrix.clone().invert();
    const origin = new Vector3().applyMatrix4(inverse);
    assert.ok(origin.clone().applyMatrix4(matrix).length() < 1e-8);
    assert.ok(Math.abs(matrix.determinant() - 1) < 1e-10);
    const lowerFrame = earthToLocal(lat, lng, 122);
    assert.ok(origin.clone().applyMatrix4(lowerFrame).distanceTo(new Vector3(0, 1, 0)) < 1e-8);
  }
});

test('missing key creates no tiles, networking or scene mutations', () => {
  const world = new PhotorealWorld({ add() { assert.fail('No configured provider'); } }, null, null, null, { apiKey: '' });
  assert.equal(world.active, false);
  assert.equal(world.status, 'unconfigured');
  world.update(40.97, 29.06, 1);
  assert.equal(world.sampleGroundHeight(), null);
  world.dispose();
});
