import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarModel } from '../src/car-model.js';

test('creates procedural BMW model with required parts and contracts', () => {
  const car = createCarModel('m3', '#2563eb');

  assert.ok(car.group, 'should have a THREE.Group root');
  assert.equal(car.wheels.length, 4, 'should have exactly 4 wheels');
  assert.ok(car.bodyMaterials.length > 0, 'should expose body materials for color updates');
  assert.ok(Array.isArray(car.exhaustFlames), 'should have exhaust flames array');

  // Verify wheel structure
  for (const wheel of car.wheels) {
    assert.ok(wheel.steeringPivot, 'wheel must have steeringPivot');
    assert.ok(wheel.spinGroup, 'wheel must have spinGroup');
    assert.equal(typeof wheel.radius, 'number', 'wheel must have a numeric radius');
    assert.equal(typeof wheel.isFront, 'boolean', 'wheel must specify isFront');
  }

  // Verify color update works on body materials
  car.bodyMaterials[0].color.set('#dc2626');
  assert.equal('#' + car.bodyMaterials[0].color.getHexString(), '#dc2626');
});

test('supports distinct model silhouettes and full UI names (M3 Competition, M4 CSL, M5 CS, i4 M50 (EV))', () => {
  const m3Comp = createCarModel('M3 Competition', '#ffffff');
  const m4Csl = createCarModel('M4 CSL', '#000000');
  const m5Cs = createCarModel('M5 CS', '#112233');
  const i4Ev = createCarModel('i4 M50 (EV)', '#00ffcc');

  assert.equal(m3Comp.group.name, 'bmw-m3');
  assert.equal(m4Csl.group.name, 'bmw-m4');
  assert.equal(m5Cs.group.name, 'bmw-m5');
  assert.equal(i4Ev.group.name, 'bmw-i4');

  assert.equal(m3Comp.wheels.length, 4);
  assert.equal(m4Csl.wheels.length, 4);
  assert.equal(m5Cs.wheels.length, 4);
  assert.equal(i4Ev.wheels.length, 4);

  // EV should not have exhaust flames, ICE cars should
  assert.equal(i4Ev.exhaustFlames.length, 0);
  assert.ok(m3Comp.exhaustFlames.length > 0);
  assert.ok(m4Csl.exhaustFlames.length > 0);
  assert.ok(m5Cs.exhaustFlames.length > 0);
});

test('each car has a visible cabin, kidney grilles, lights and stable finite geometry', () => {
  for (const model of ['m3', 'm4', 'm5', 'i4']) {
    const { group, bodyMaterials, wheels } = createCarModel(model);
    for (const name of ['glazed-cabin', 'roof', 'kidney-grille', 'headlamp-housing', 'tail-light', 'brake-caliper']) {
      assert.ok(group.getObjectByName(name), `${model} has ${name}`);
    }
    assert.equal(group.userData.modelSource, 'original-procedural');
    assert.equal(bodyMaterials.length, 1, 'paint updates must not recolor windows, wheels or lights');
    group.traverse(part => {
      if (!part.isMesh) return;
      assert.ok([...part.geometry.attributes.position.array].every(Number.isFinite));
    });
    for (const wheel of wheels) {
      assert.equal(wheel.spinGroup.parent, wheel.steeringPivot);
      assert.equal(wheel.steeringPivot.getObjectByName('brake-caliper').parent, wheel.steeringPivot, 'calipers must not rotate with rim');
    }
    const cabin = group.getObjectByName('glazed-cabin');
    const normals = cabin.geometry.attributes.normal;
    assert.ok(normals.getZ(0) < 0, 'rear glass faces out toward rear');
  }
});
