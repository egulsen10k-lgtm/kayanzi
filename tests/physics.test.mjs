import test from 'node:test';
import assert from 'node:assert/strict';
import { CarPhysics } from '../src/physics.js';

const unconstrainedCar = () => { const car = new CarPhysics(); car.roadConstrained = false; return car; };

const advance = (car, seconds) => {
  for (let frame = 0; frame < seconds * 60; frame++) car.update(1 / 60);
};

test('accelerating moves the car north and respects its speed limit', () => {
  const car = unconstrainedCar();
  const start = car.lat;
  car.keys.KeyW = true;
  advance(car, 60);
  assert.ok(car.lat > start);
  assert.ok(car.speed > 0 && car.speed <= car.maxSpeed);
});

test('releasing the accelerator lets the car coast to a stop', () => {
  const car = unconstrainedCar();
  car.keys.KeyW = true;
  advance(car, 3);
  car.keys.KeyW = false;
  advance(car, 30);
  assert.ok(Math.abs(car.speed) < 0.1, `still moving at ${car.speed} km/h`);
});

test('handbrake slows the car even while accelerator is held', () => {
  const car = unconstrainedCar();
  car.keys.KeyW = true;
  advance(car, 5);
  const before = car.speed;
  car.keys.Space = true;
  advance(car, 2);
  assert.ok(car.speed < before, `${before} -> ${car.speed} km/h`);
});

test('teleport resets momentum and controls', () => {
  const car = unconstrainedCar();
  car.keys.KeyW = true;
  car.keys.KeyD = true;
  advance(car, 3);
  car.teleport(35.6762, 139.6503);
  advance(car, 1);
  assert.equal(car.speed, 0);
  assert.equal(car.lat, 35.6762);
  assert.equal(car.lng, 139.6503);
});

test('crossing the antimeridian wraps longitude', () => {
  const car = unconstrainedCar();
  car.teleport(0, 179.999999);
  car.heading = Math.PI / 2;
  car.speed = 100;
  advance(car, 1);
  assert.ok(car.lng >= -180 && car.lng <= 180, `longitude ${car.lng}`);
  assert.ok(car.lng < 0);
});

test('pole crossing keeps geographic coordinates finite and valid', () => {
  const car = unconstrainedCar();
  car.teleport(89.999999, 10);
  car.speed = 100;
  advance(car, 2);
  assert.ok(Number.isFinite(car.lat) && Math.abs(car.lat) <= 90);
  assert.ok(Number.isFinite(car.lng) && Math.abs(car.lng) <= 180);
});

test('invalid frame durations do not corrupt state', () => {
  for (const dt of [NaN, Infinity, -1]) {
    const car = unconstrainedCar();
    car.keys.KeyW = true;
    car.update(dt);
    assert.ok(Number.isFinite(car.speed) && car.speed >= 0);
    assert.ok(Number.isFinite(car.lat));
    assert.ok(Number.isFinite(car.lng));
  }
});

test('reverse travels backwards without exceeding the reverse speed limit', () => {
  const car = unconstrainedCar();
  const start = car.lat;
  car.keys.KeyS = true;
  advance(car, 30);
  assert.ok(car.lat < start);
  assert.ok(car.speed < 0 && car.speed >= -45);
  assert.ok(car.rpm >= 800);
});

test('invalid teleport leaves the current location unchanged', () => {
  const car = unconstrainedCar();
  const before = [car.lat, car.lng];
  for (const [lat, lng] of [[NaN, 10], [30, Infinity], [91, 0]]) {
    assert.equal(car.teleport(lat, lng), false);
    assert.deepEqual([car.lat, car.lng], before);
  }
});

test('eastward movement at the exact pole completes with finite coordinates', () => {
  const car = unconstrainedCar();
  car.teleport(90, 0);
  car.heading = Math.PI / 2;
  car.keys.KeyW = true;
  advance(car, 1);
  assert.ok(Number.isFinite(car.lat) && Math.abs(car.lat) <= 90);
  assert.ok(Number.isFinite(car.lng) && Math.abs(car.lng) <= 180);
});

test('starting reverse never produces negative engine RPM', () => {
  const car = unconstrainedCar();
  car.keys.KeyS = true;
  car.update(1 / 60);
  assert.ok(car.rpm >= 800);
});

test('left steering turns west and right steering turns east from north', () => {
  const left = unconstrainedCar();
  left.speed = 36;
  left.keys.KeyA = true;
  advance(left, 1);

  const right = unconstrainedCar();
  right.speed = 36;
  right.keys.KeyD = true;
  advance(right, 1);

  assert.ok(left.heading > Math.PI,
    `left turn should head west, got ${left.heading}`);
  assert.ok(right.heading < Math.PI,
    `right turn should head east, got ${right.heading}`);
});

test('brake stops forward travel before engaging reverse after a pause', () => {
  const car = unconstrainedCar();
  car.speed = 2;
  car.keys.KeyS = true;
  car.update(0.1);
  assert.equal(car.speed, 0);
  car.update(0.1);
  assert.equal(car.speed, 0);
  advance(car, 1);
  assert.ok(car.speed < 0);
});

test('stationary steering does not rotate the chassis and reverse steering reverses yaw', () => {
  const parked = unconstrainedCar();
  parked.keys.KeyA = true;
  advance(parked, 1);
  assert.equal(parked.heading, 0);
  const reverse = unconstrainedCar();
  reverse.speed = -15;
  reverse.keys = { KeyA: true, KeyS: true };
  advance(reverse, 0.5);
  assert.ok(reverse.heading > 0 && reverse.heading < Math.PI);
});

test('highway cornering cannot exceed the tire grip acceleration', () => {
  const car = unconstrainedCar();
  car.speed = 180;
  car.steering = -1;
  car.keys = { KeyD: true, KeyW: true };
  const before = car.speed / 3.6;
  car.update(0.1);
  assert.ok(car.heading / 0.1 * before <= 8.8 + 0.01);
});

test('arcade drift builds a slide pose, holds with counter-steer, then settles', () => {
  const car = unconstrainedCar();
  car.setHandling('Drift');
  assert.equal(car.drivetrain, 'RWD');
  car.speed = 65;
  car.keys = { KeyW: true, KeyA: true };
  advance(car, 1);
  assert.equal(car.isDrifting, true);
  assert.ok(car.driftFactor > .08);
  assert.ok(car.driftAngle > .05, `expected lateral slip, got ${car.driftAngle}`);
  const slipBeforeCounterSteer = car.driftFactor;
  car.keys = { KeyW: true, KeyD: true };
  advance(car, .5);
  assert.ok(car.driftFactor > .08 && car.driftFactor >= slipBeforeCounterSteer * .45, 'counter-steering should sustain the slide');
  car.keys = {};
  advance(car, .7);
  assert.ok(car.driftFactor < slipBeforeCounterSteer, 'releasing the controls should settle the slide');
});

test('Sport+ supports power-oversteer without changing the road travel direction', () => {
  const car = unconstrainedCar();
  car.speed = 65;
  car.keys = { KeyW: true, KeyA: true };
  advance(car, 1);
  assert.equal(car.handlingMode, 'Sport+');
  assert.ok(car.isDrifting && car.driftAngle > .05);
});

test('RWD handbrake initiates a drift without an unrealistic full stop', () => {
  const car = unconstrainedCar();
  car.setHandling('Drift');
  car.speed = 45;
  car.keys = { Space: true, KeyA: true };
  advance(car, .5);
  assert.equal(car.isDrifting, true);
  assert.ok(car.speed > 35, `rear handbrake stopped too aggressively: ${car.speed}`);
});

test('steering and acceleration give consistent results at 30, 60, and 120 fps', () => {
  const simulate = fps => {
    const car = unconstrainedCar();
    car.keys = { KeyW: true, KeyD: true };
    for (let i = 0; i < fps * 4; i++) car.update(1 / fps);
    return car;
  };
  const baseline = simulate(120);
  for (const fps of [30, 60]) {
    const car = simulate(fps);
    assert.ok(Math.abs(car.speed - baseline.speed) < 1e-8);
    assert.ok(Math.abs(car.heading - baseline.heading) < 1e-8);
    assert.ok(Math.abs(car.lat - baseline.lat) < 1e-9);
    assert.ok(Math.abs(car.lng - baseline.lng) < 1e-9);
  }
});

test('impact cooldown expires even while car remains stopped', () => {
  const car = unconstrainedCar();
  car.impactCooldown = 0.1;
  car.impactEvent = { speed: 20 };
  car.update(0.1);
  assert.equal(car.impactEvent, null);
});
