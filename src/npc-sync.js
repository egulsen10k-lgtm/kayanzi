import * as THREE from 'three';
import { projectCoordinate } from './road-network.js';
import { localToCoordinate } from './road-safety.js';
import { createTrafficVehicle, disposeTrafficObject } from './traffic-vehicle.js';
import { createPerson } from './person-model.js';
import { MAX_SHARED_TRAFFIC, MAX_SHARED_PEOPLE, NPC_BODY_NAMES, sanitizeWorldSnapshot } from './npc-state.js';

const BIND_CENTERS = { torso: [0, 1.09, 0], head: [0, 1.52, .015], leftArm: [-.235, 1.04, 0], rightArm: [.235, 1.04, 0], leftLeg: [-.095, .43, 0], rightLeg: [.095, .43, 0] };
const HEAD_PARTS = new Set(['head', 'nose', 'smile', 'eye', 'eyebrow', 'eyeliner', 'earring', 'fringe', 'blonde-crown', 'long-blonde-hair', 'face-framing-hair', 'hair', 'neck', 'scarf-crown', 'scarf-back', 'scarf-side']);
const snapshotCoordinate = (x, y, origin) => localToCoordinate([x, y], origin);
const finite = Number.isFinite;
const syncByTraffic = new WeakMap();

// Compatibility entry points for the page's frozen multiplayer integration.
export function serializeNpcs({ pedestrians, traffic } = {}) {
  const sync = traffic && syncByTraffic.get(traffic);
  if (!sync || (pedestrians && sync.pedestrians !== pedestrians)) return null;
  return sync.captureSnapshot();
}
export function applyNpcs(snapshot, { pedestrians, traffic } = {}) {
  const sync = traffic && syncByTraffic.get(traffic);
  if (!sync || (pedestrians && sync.pedestrians !== pedestrians)) return false;
  return sync.applySnapshot(snapshot);
}
function bindPerson(model) {
  model.updateMatrixWorld(true);
  const bindings = [];
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    let name = HEAD_PARTS.has(mesh.name) ? 'head' : 'torso';
    for (let parent = mesh; parent && parent !== model; parent = parent.parent) {
      if (parent.name === 'left-arm') name = 'leftArm';
      if (parent.name === 'right-arm') name = 'rightArm';
      if (parent.name === 'left-leg') name = 'leftLeg';
      if (parent.name === 'right-leg') name = 'rightLeg';
    }
    bindings.push({ mesh, name, matrix: mesh.matrixWorld.clone() });
  });
  return bindings;
}
function interpolate(display, target, dt) {
  const blend = 1 - Math.exp(-dt * 16);
  const [east, north] = projectCoordinate(target.lat, target.lng, display);
  const t = Math.hypot(east, north) > 80 ? 1 : blend;
  display.lat += (target.lat - display.lat) * t;
  display.lng += (target.lng - display.lng) * t;
  display.heading += Math.atan2(Math.sin(target.heading - display.heading), Math.cos(target.heading - display.heading)) * t;
  display.height += (target.height - display.height) * t;
}

/** Authority simulates once; followers render only snapshots, independently of their loaded road district. */
export class NpcSync {
  constructor({ session, trafficManager, pedestrians, pedestrianView, scene, trafficFactory = createTrafficVehicle, personFactory = createPerson } = {}) {
    Object.assign(this, { session, trafficManager, pedestrians, pedestrianView, trafficFactory, personFactory });
    this.group = new THREE.Group(); this.group.name = 'shared-npc-replicas';
    scene?.add(this.group);
    this.traffic = new Map(); this.people = new Map();
    this.seq = 0; this.clock = 0; this.time = 0; this.snapshot = null;
    this.authorityId = null; this.follower = false; this.staticNetwork = null;
    if (trafficManager) syncByTraffic.set(trafficManager, this);
  }
  get isFollower() { return Boolean(this.session?.connected && !this.session.isWorldAuthority); }
  syncRole(player) {
    const next = this.isFollower;
    const authority = this.session?.worldAuthorityId ?? null;
    if (this.follower !== next || this.authorityId !== authority) {
      const restoreLocal = this.follower && !next;
      this.clearReplicas(); this.snapshot = null; this.clock = 0; this.seq = 0;
      this.staticNetwork = null;
      this.follower = next; this.authorityId = authority;
      if (next) {
        this.trafficManager?.clear();
        this.pedestrians?.clearNetwork();
      } else if (restoreLocal && player?.roadNetwork) {
        this.trafficManager?.reset(player.roadNetwork, player);
        this.pedestrians?.reset(player.roadNetwork, player, this.pedestrians.density);
      }
    }
    if (this.trafficManager?.root) this.trafficManager.root.visible = !next;
    if (this.pedestrianView?.group) this.pedestrianView.group.visible = !next;
    this.group.visible = next;
    return next;
  }
  captureSnapshot() {
    const traffic = [], people = [];
    const manager = this.trafficManager, pedestrians = this.pedestrians;
    if (manager?.origin) for (const car of (manager.cars || []).slice(0, MAX_SHARED_TRAFFIC)) {
      if (![car.x, car.y, car.heading].every(finite)) continue;
      traffic.push({ id: `t${car.id}`, type: car.type, seed: car.id, ...snapshotCoordinate(car.x, car.y, manager.origin), heading: car.heading, height: car.roadHeight, speed: car.speed, braking: car.braking, opacity: car.opacity, alert: car.alertUntil > manager.time });
    }
    if (pedestrians?.network?.center) for (const [index, person] of (pedestrians.people || []).slice(0, MAX_SHARED_PEOPLE).entries()) {
      if (![person.x, person.y, person.heading ?? 0].every(finite)) continue;
      const ragdoll = this.pedestrianView?.ragdolls?.get(person);
      let bodyPose = null;
      if (person.state === 'ragdoll' && ragdoll) {
        const bodies = {};
        for (const name of NPC_BODY_NAMES) {
          const body = ragdoll.physics.bodies[name];
          bodies[name] = [body.position.x, body.position.y, body.position.z, body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w];
        }
        bodyPose = { ...snapshotCoordinate(ragdoll.origin.x, ragdoll.origin.y, pedestrians.network.center), height: ragdoll.origin.height, bodies };
      }
      people.push({ id: `p${index}`, style: person.style || 'casual', ...snapshotCoordinate(person.x, person.y, pedestrians.network.center), height: person.height, heading: person.heading || 0, state: person.state, phase: person.phase, trunkProgress: person.trunkProgress, recoveryTime: person.recoveryTime, ragdoll: bodyPose });
    }
    return sanitizeWorldSnapshot({ v: 1, seq: this.seq++, time: manager?.time ?? this.time, traffic, people, passengers: pedestrians?.passengers, trunkOpen: pedestrians?.trunkOpen });
  }
  applySnapshot(raw) {
    if (!this.isFollower) return false;
    const snapshot = sanitizeWorldSnapshot(raw);
    if (!snapshot) return false;
    // Role transitions must be applied before caching the first snapshot.
    this.syncRole();
    if (this.snapshot && snapshot.seq <= this.snapshot.seq) return false;
    this.snapshot = snapshot;
    this.reconcile(snapshot.traffic, this.traffic, entity => {
      const model = this.trafficFactory(entity.type, entity.seed);
      model.group.userData.npcType = entity.type;
      return { ...model, display: { ...entity }, target: entity };
    }, (model, entity) => model.type !== entity.type || model.seed !== entity.seed);
    this.reconcile(snapshot.people, this.people, entity => {
      const model = this.personFactory({ style: entity.style });
      return { group: model, bindings: bindPerson(model), style: entity.style, display: { ...entity }, target: entity };
    }, (model, entity) => model.style !== entity.style);
    return true;
  }
  reconcile(entities, store, create, changed) {
    const ids = new Set();
    for (const entity of entities) {
      ids.add(entity.id);
      let model = store.get(entity.id);
      if (model && changed(model, entity)) { disposeTrafficObject(model.group); store.delete(entity.id); model = null; }
      if (!model) { model = create(entity); model.seed = entity.seed; this.group.add(model.group); store.set(entity.id, model); }
      model.target = entity;
    }
    for (const [id, model] of store) if (!ids.has(id)) { disposeTrafficObject(model.group); store.delete(id); }
  }
  update(dt, player, { hidden = false } = {}) {
    dt = Math.max(0, Math.min(.1, Number(dt) || 0));
    this.time += dt;
    this.syncRole(player);
    if (!this.follower) {
      this.group.visible = false;
      if (this.trafficManager?.root && hidden) this.trafficManager.root.visible = false;
      if (this.pedestrianView?.group && hidden) this.pedestrianView.group.visible = false;
      if (this.session?.isWorldAuthority && typeof this.session.getNpcs !== 'function') {
        this.clock += dt;
        if (this.clock >= .1) { this.clock = 0; const snapshot = this.captureSnapshot(); if (snapshot) this.session.sendWorldSnapshot(snapshot); }
      }
      return;
    }
    this.group.visible = !hidden;
    const manager = this.trafficManager;
    if (manager && player?.roadNetwork && (this.staticNetwork !== player.roadNetwork || manager.network !== player.roadNetwork || !manager.graph)) {
      const density = manager.maxCars;
      manager.maxCars = 0;
      try { manager.reset(player.roadNetwork, player); this.staticNetwork = player.roadNetwork; }
      finally { manager.maxCars = density; }
    }
    if (manager?.root) manager.root.visible = !hidden;
    if (manager?.origin && manager.graph && player) {
      const point = manager.playerPoint(player), time = this.snapshot?.time ?? 0;
      manager.controls.update(time, point);
      manager.roadInfo = manager.signs.nearby(manager.graph, point);
      if (manager.roadInfo) {
        const edge = manager.roadInfo.signalEdge ?? manager.roadInfo.edge;
        manager.roadInfo.signal = manager.controls.phase(edge, time);
        manager.roadInfo.signalDistance = Math.max(0, manager.roadInfo.remaining - (edge ? manager.controls.stopDistance(edge) : 0));
      }
    }
    for (const model of this.traffic.values()) {
      const target = model.target;
      interpolate(model.display, target, dt);
      const [x, y] = projectCoordinate(model.display.lat, model.display.lng, player);
      model.group.position.set(x, model.display.height, -y);
      model.group.rotation.y = Math.PI - model.display.heading;
      for (const wheel of model.wheels || []) wheel.rotation.x += target.speed / 3.6 * dt / .32;
      for (const lamp of model.brakeLamps || []) lamp.emissiveIntensity = target.braking ? 2 : .25;
      (model.beacons || []).forEach((lamp, i) => { lamp.emissiveIntensity = target.alert && Math.floor((this.snapshot?.time || 0) * 5 + i) % 2 === 0 ? 3 : .15; });
      model.group.traverse(part => { if (part.material) { part.material.opacity = target.opacity; part.material.transparent = target.opacity < 1; part.material.depthWrite = target.opacity > .9; } });
      model.group.visible = Math.hypot(x, y) < 1800;
    }
    for (const model of this.people.values()) this.renderPerson(model, dt, player);
  }
  renderPerson(model, dt, player) {
    const target = model.target, group = model.group;
    group.visible = !['boarded', 'trunk-rider'].includes(target.state);
    if (!group.visible) return;
    if (target.state === 'ragdoll' && target.ragdoll) {
      group.position.set(0, 0, 0); group.rotation.set(0, 0, 0); group.scale.set(1, 1, 1);
      const [x, y] = projectCoordinate(target.ragdoll.lat, target.ragdoll.lng, player);
      const origin = new THREE.Matrix4().makeTranslation(x, target.ragdoll.height, -y);
      for (const { mesh, name, matrix } of model.bindings) {
        const body = target.ragdoll.bodies[name], center = BIND_CENTERS[name];
        const transform = new THREE.Matrix4().compose(new THREE.Vector3(...body.slice(0, 3)), new THREE.Quaternion(...body.slice(3)), new THREE.Vector3(1, 1, 1));
        transform.premultiply(origin).multiply(new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2])).multiply(matrix);
        mesh.matrixAutoUpdate = false;
        // Mesh stays nested in limbs: convert the authoritative world transform into its parent's local frame.
        group.updateMatrixWorld(true);
        const parentInverse = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
        mesh.matrix.copy(parentInverse.multiply(transform));
      }
      return;
    }
    for (const binding of model.bindings) binding.mesh.matrixAutoUpdate = true;
    interpolate(model.display, target, dt);
    const [x, y] = projectCoordinate(model.display.lat, model.display.lng, player);
    group.position.set(x, model.display.height, -y); group.rotation.set(0, Math.PI - model.display.heading, 0);
    const entering = target.state === 'trunk-entering', holding = target.state === 'clinging';
    group.scale.set(1, entering ? 1 - target.trunkProgress * .5 : 1, 1);
    const swing = ['idle', 'chasing', 'trunk-approach'].includes(target.state) ? Math.sin(target.phase) * (target.state === 'idle' ? .3 : .65) : 0;
    group.rotation.x = holding ? -.18 : target.state === 'recovering' ? (1 - Math.min(1, target.recoveryTime / 1.2)) * 1.3 : entering ? -.5 : 0;
    for (const [index, limb] of (group.userData.legs || []).entries()) limb.rotation.x = entering ? -target.trunkProgress * .9 : holding ? index ? -.42 : -.25 : swing * (index % 2 ? 1 : -1);
    for (const [index, limb] of (group.userData.arms || []).entries()) limb.rotation.x = entering ? -1.3 : holding ? -1.32 + (index ? -.12 : .12) : swing * (index % 2 ? -1 : 1);
    group.visible = Math.hypot(x, y) < 1800;
  }
  clearReplicas() {
    for (const model of [...this.traffic.values(), ...this.people.values()]) disposeTrafficObject(model.group);
    this.traffic.clear(); this.people.clear();
  }
  dispose() {
    this.clearReplicas(); this.group.removeFromParent();
    if (this.trafficManager && syncByTraffic.get(this.trafficManager) === this) syncByTraffic.delete(this.trafficManager);
  }
}
