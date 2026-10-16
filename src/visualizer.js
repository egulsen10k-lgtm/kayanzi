import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadRoads } from './road-network.js';
import { buildRoadMeshes } from './road-mesh.js';
import { SatelliteWorld } from './satellite-world.js';
import { createCarModel } from './car-model.js';

export function geographicOffset(center, lat, lng) {
  const deltaLng = ((lng - center.lng + 540) % 360) - 180;
  return {
    east: deltaLng * Math.PI / 180 * 6371008.8 * Math.cos(center.lat * Math.PI / 180),
    north: (lat - center.lat) * Math.PI / 180 * 6371008.8
  };
}

export function animateWheels(wheels, speedKmh, steering, dt) {
  for (const wheel of wheels) {
    wheel.spinGroup.rotation.x = (wheel.spinGroup.rotation.x + speedKmh / 3.6 * dt / wheel.radius) % (Math.PI * 2);
    wheel.steeringPivot.rotation.y = wheel.isFront ? steering * 0.45 : 0;
  }
}

function disposeModel(group) {
  const geometries = new Set();
  const materials = new Set();
  group?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group?.removeFromParent();
}

export class CarVisualizer3D {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc4d4df);
    this.scene.fog = new THREE.Fog(0xc4d4df, 100, 650);
    this.camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 2000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();

    this.peerCars = new Map();
    this.roadGroup = new THREE.Group();
    this.roadGroup.visible = false;
    this.scene.add(this.roadGroup);
    this.roadCenter = null;
    this.roadTarget = null;
    this.roadRequest = null;
    this.roadLoading = false;
    this.roadOverlayEnabled = false;
    this.lastRoadRequestAt = 0;
    this.roadCache = new Map();
    this.currentColor = '#1c3fa8';
    this.currentModel = 'M3 Competition';
    this.cameraMode = 'chase';
    this.lastPosition = { lat: 48.1764, lng: 11.5583 };
    this.flameUntil = 0;
    this.setupLighting();
    this.setupEnvironment();
    this.setModel(this.currentModel);
    this.camera.position.set(8, 7, 12);
    this.satellite = new SatelliteWorld(this.scene, container, this.renderer);
    this.satellite.setLocation(this.lastPosition.lat, this.lastPosition.lng);
    this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
    this.resizeObserver.observe(container);
  }

  setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x6d7262, 1.4));
    const sun = new THREE.DirectionalLight(0xfff5df, 2.5);
    sun.position.set(-20, 35, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 70 });
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.015;
    this.scene.add(sun);
  }

  setupEnvironment() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: 0x47534b }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    this.scene.add(ground);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.ShadowMaterial({ opacity: 0.38 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.012;
    shadow.receiveShadow = true;
    this.scene.add(shadow);
  }

  setModel(model) {
    const next = createCarModel(model, this.currentColor);
    disposeModel(this.carGroup);
    this.currentModel = model;
    this.carGroup = next.group;
    this.wheels = next.wheels;
    this.bodyMaterials = next.bodyMaterials;
    this.exhaustFlames = next.exhaustFlames;
    this.scene.add(this.carGroup);
  }

  updateColor(color) {
    this.currentColor = color;
    for (const material of this.bodyMaterials) material.color.set(color);
  }

  setCameraMode(mode) {
    if (['chase', 'wide', 'aerial'].includes(mode)) this.cameraMode = mode;
  }

  setRoadOverlayEnabled(enabled) {
    this.roadOverlayEnabled = Boolean(enabled);
    this.roadGroup.visible = Boolean(enabled);
    if (!enabled) this.roadRequest?.abort();
    this.loadRoadsAt(this.lastPosition.lat, this.lastPosition.lng).catch(() => {});
  }

  clearRoads() {
    for (const mesh of [...this.roadGroup.children]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.roadGroup.remove(mesh);
    }
  }

  setRoads(network) {
    this.clearRoads();
    this.roadCenter = network.center;
    const surfaces = buildRoadMeshes(network);
    this.roadGroup.add(...surfaces.children.slice());
    // Render barriers if present
    if (network.barriers?.length) {
      const barrierGroup = new THREE.Group();
      for (const barrier of network.barriers) {
        for (let i = 1; i < barrier.points.length; i++) {
          const [ax, an] = barrier.points[i - 1], [bx, bn] = barrier.points[i];
          const az = -an, bz = -bn;
          const length = Math.hypot(bx - ax, bz - az);
          if (length < 0.01) continue;
          const geometry = new THREE.BufferGeometry();
          const points = [];
          for (let d = 0; d < length; d += 0.5) {
            const fraction = d / length;
            const px = ax + (bx - ax) * fraction;
            const pz = az + (bz - az) * fraction;
            points.push(px, 0.01, pz, px, 0.02, pz);
          }
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
          const material = new THREE.LineBasicMaterial({ color: 0xff3366 });
          const mesh = new THREE.LineSegments(geometry, material);
          mesh.position.set(-bx, 0, -bn);
          barrierGroup.add(mesh);
        }
      }
      this.roadGroup.add(barrierGroup);
    }
  }

  async loadRoadsAt(lat, lng) {
    this.lastPosition = { lat, lng };
    this.satellite?.setLocation(lat, lng, true);
    this.roadRequest?.abort();
    if (this.roadOverlayEnabled === false) {
      this.container.dispatchEvent(new CustomEvent('roadstatus', { detail: { state: 'disabled' } }));
      return null;
    }
    const controller = new AbortController();
    this.roadRequest = controller;
    this.roadLoading = true;
    this.lastRoadRequestAt = performance.now();
    this.roadTarget = { lat, lng };
    if (this.roadCenter) {
      const offset = geographicOffset(this.roadCenter, lat, lng);
      if (Math.hypot(offset.east, offset.north) > 1200) this.clearRoads();
    }
    this.container.dispatchEvent(new CustomEvent('roadstatus', { detail: { state: 'loading' } }));
    try {
      const cacheKey = `${lat},${lng}`;
      const cached = this.roadCache.get(cacheKey);
      const network = cached && Date.now() - cached.savedAt < 300000 ? cached.network
        : await loadRoads({ lat, lng, radiusMeters: 800, signal: controller.signal });
      if (controller.signal.aborted) return null;
      this.roadCache.delete(cacheKey);
      this.roadCache.set(cacheKey, { network, savedAt: Date.now() });
      if (this.roadCache.size > 8) this.roadCache.delete(this.roadCache.keys().next().value);
      this.setRoads(network);
      this.container.dispatchEvent(new CustomEvent('roadstatus', {
        detail: { state: network.roads.length ? 'ready' : 'empty', count: network.roads.length }
      }));
      return network;
    } catch (error) {
      if (controller.signal.aborted) return null;
      this.container.dispatchEvent(new CustomEvent('roadstatus', { detail: { state: 'error', message: error.message } }));
      throw error;
    } finally {
      if (this.roadRequest === controller) this.roadLoading = false;
    }
  }

  triggerExhaustFlames() { this.flameUntil = performance.now() + 140; }

  updatePeerCar(state) {
    if (!state || !Number.isFinite(state.lat) || !Number.isFinite(state.lng) || !Number.isFinite(state.heading)) return;
    let peer = this.peerCars.get(state.peerId);
    if (!peer) {
      if (this.peerCars.size >= 8) return;
      const model = createCarModel(state.model, /^#[0-9a-f]{6}$/i.test(state.color) ? state.color : '#718ba1');
      peer = { group: model.group };
      this.scene.add(peer.group);
      this.peerCars.set(state.peerId, peer);
    }
    peer.state = state;
    peer.lastSeen = performance.now();
  }

  update(physics, dt = 1 / 60) {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.lastPosition = { lat: physics.lat, lng: physics.lng };
    this.satellite.setLocation(physics.lat, physics.lng);
    this.carGroup.rotation.y = Math.PI - physics.heading;
    animateWheels(this.wheels, physics.speed, physics.steering, dt);
    for (const flame of this.exhaustFlames) flame.visible = performance.now() < this.flameUntil;
    if (this.roadCenter) {
      const { east, north } = geographicOffset(this.roadCenter, physics.lat, physics.lng);
      this.roadGroup.position.set(-east, 0, north);
    }
    if (this.roadOverlayEnabled && this.roadTarget && !this.roadLoading && performance.now() - this.lastRoadRequestAt > 60000) {
      const p = geographicOffset(this.roadTarget, physics.lat, physics.lng);
      if (Math.hypot(p.east, p.north) > 400) this.loadRoadsAt(physics.lat, physics.lng).catch(() => {});
    }
    for (const [id, peer] of this.peerCars) {
      if (performance.now() - peer.lastSeen > 10000) { disposeModel(peer.group); this.peerCars.delete(id); continue; }
      const p = geographicOffset(this.lastPosition, peer.state.lat, peer.state.lng);
      peer.group.position.set(p.east, 0, -p.north);
      peer.group.rotation.y = Math.PI - peer.state.heading;
      peer.group.visible = Math.hypot(p.east, p.north) < 1000;
    }
    const mobile = this.container.clientWidth < 600;
    const settings = this.cameraMode === 'aerial' ? [0.01, 180, 0]
      : this.cameraMode === 'wide' ? [20, 17, 3] : [mobile ? 14 : 10.5, mobile ? 9 : 6, 2.5];
    const [distance, height, ahead] = settings;
    const heading = this.cameraMode === 'aerial' ? 0 : physics.heading;
    const target = new THREE.Vector3(-Math.sin(heading) * distance, height, Math.cos(heading) * distance);
    this.camera.position.lerp(target, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(Math.sin(heading) * ahead, 0.5, -Math.cos(heading) * ahead);
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    if (!this.container.clientWidth || !this.container.clientHeight) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }
}
