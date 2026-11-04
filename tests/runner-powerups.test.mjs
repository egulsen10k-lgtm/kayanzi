import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RunnerGame, POWERUP_ROCKET, POWERUP_WRENCH } from '../src/runner-game.js';
import { createRobotModel, RobotRunnerView } from '../src/robot-runner-view.js';

function gameAtPowerup(type, lives = 3) {
  const game = new RunnerGame(() => .5);
  game.lane = 1;
  game.lives = lives;
  game.powerups = [{ id: 900, type, lane: 1, z: -.1 }];
  return game;
}

test('wrench restores one life up to the three-life cap', () => {
  const game = gameAtPowerup(POWERUP_WRENCH, 2);
  game.update(.05);
  assert.equal(game.lives, 3);
  assert.equal(game.powerups.length, 0);
  const capped = gameAtPowerup(POWERUP_WRENCH, 3);
  capped.update(.05);
  assert.equal(capped.lives, 3);
});

test('rocket powerup starts the three-second speed boost', () => {
  const game = gameAtPowerup(POWERUP_ROCKET);
  game.update(.05);
  assert.ok(game.rocketTimer > 2.9 && game.rocketTimer <= 3);
  const before = game.trucks[0].z;
  game.update(.05);
  assert.ok(game.trucks[0].z - before > 7.2 * .05 * 1.5);
});

test('powerups beyond the near edge are filtered out', () => {
  const game = new RunnerGame(() => .5);
  game.powerups = [{ id: 901, type: POWERUP_WRENCH, lane: 0, z: 18 }];
  game.update(.05);
  assert.equal(game.powerups.length, 0);
});

test('row spawns can place wrench and rocket powerups in open lanes', () => {
  const game = new RunnerGame(() => .5);
  game.powerups = [];
  game.trucks = [];
  game.lowObstacles = [];
  game.roadsters = [];
  const values=[0,.2,.2,0,0,0,0,0];
  game.random=()=>values.shift()??0;
  game.spawnRow(-100);
  assert.deepEqual(new Set(game.powerups.map(item => item.type)), new Set([POWERUP_WRENCH, POWERUP_ROCKET]));
  assert.notEqual(game.powerups[0].lane, game.trucks.at(-1).lane);
  assert.notEqual(game.powerups[1].lane, game.trucks.at(-1).lane);
});

test('runner view renders both powerup shapes and disposes them on reset', () => {
  const view = Object.create(RobotRunnerView.prototype);
  view.trucks = new Map(); view.pickups = new Map(); view.lowObstacles = new Map();
  view.roadsters = new Map(); view.powerups = new Map(); view._warnSprites = []; view.laneMarkers = []; view.buildings = [];
  view.root = new THREE.Group(); view.robot = createRobotModel();
  view.camera = { aspect: 1, position: new THREE.Vector3(), lookAt() {}, updateProjectionMatrix() {} };
  view.renderer = { render() {} }; view.container = { clientWidth: 320, clientHeight: 240 };
  const game = { trucks: [], pickups: [], lowObstacles: [], roadsters: [],
    powerups: [{ id: 1, type: POWERUP_WRENCH, lane: 0, z: -4 }, { id: 2, type: POWERUP_ROCKET, lane: 2, z: -6 }],
    distance: 0, x: 0, y: 0, vy: 0, lane: 1, over: false, invulnerable: 0 };
  view.update(game, .05);
  const wrench = view.powerups.get(1).children[0], rocket = view.powerups.get(2).children[0];
  assert.ok(wrench.geometry instanceof THREE.BoxGeometry);
  assert.deepEqual(wrench.geometry.parameters, { width: .4, height: .4, depth: .4, widthSegments: 1, heightSegments: 1, depthSegments: 1 });
  assert.ok(rocket.geometry instanceof THREE.ConeGeometry);
  assert.equal(rocket.geometry.parameters.radius, .22);
  assert.equal(rocket.geometry.parameters.height, .7);
  const powerupGroups = [...view.powerups.values()];
  view.reset();
  assert.equal(view.powerups.size, 0);
  assert.ok(powerupGroups.every(group => group.parent === null));
});
