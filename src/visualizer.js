import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildRouteRibbon } from './route-ribbon.js';
import { loadWorld } from './world-data.js';
import { buildMappedScenery } from './mapped-scenery.js';
import { buildBuildings, buildBuildingsAsync, disposeWorldGroup } from './building-world.js';
import { buildRoadMeshes, ROAD_SURFACE_HEIGHT } from './road-mesh.js';
import { SatelliteWorld } from './satellite-world.js';
import { PhotorealWorld } from './photoreal-world.js';
import { nearbyCachedWorld, nextWorldLocation } from './world-streaming.js';
import { footprintOnRoad, roadSurfaceAt } from './road-safety.js';
import { buildCoastalWater } from './coastal-water.js';
import { buildBridgePiers } from './bridge-piers.js';
import { projectCoordinate } from './road-network.js';
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
    this.roadGroup.visible = true;
    this.roadGroup.renderOrder = 1;
    this.scene.add(this.roadGroup);
    this.roadCenter = null;
    this.roadTarget = null;
    this.roadRequest = null;
    this.roadLoading = false;
    this.roadOverlayEnabled = true;
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

    this.satellite.group.visible = true;
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
    this.environmentGroup = new THREE.Group();
    this.scene.add(this.environmentGroup);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: 0x778977 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    this.environmentGroup.add(ground);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.ShadowMaterial({ opacity: 0.38 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.012;
    shadow.receiveShadow = true;
    this.environmentGroup.add(shadow);
  }

  setModel(model) {
    const next = createCarModel(model, this.currentColor);
    disposeModel(this.carGroup);
    this.currentModel = model;
    this.carGroup = next.group;
    this.wheels = next.wheels;
    this.bodyMaterials = next.bodyMaterials;
    this.exhaustFlames = next.exhaustFlames;
    this.brakeMaterials = new Set();
    this.carGroup.traverse(object => {
      const material=object.material;
      if(material?.emissive?.getHex() === 0xdc2626) this.brakeMaterials.add(material);
    });
    this.carGroup.position.y = ROAD_SURFACE_HEIGHT;
    this.scene.add(this.carGroup);
  }

  updateColor(color) {
    this.currentColor = color;
    for (const material of this.bodyMaterials) material.color.set(color);
  }

  setCameraMode(mode) {
    if (['chase', 'hood', 'cockpit', 'reverse', 'wide', 'aerial'].includes(mode)) this.cameraMode = mode;
  }

  setRoadOverlayEnabled() {
    // The road is the driving surface, never an optional image overlay.
    this.roadOverlayEnabled = true;
    this.roadGroup.visible = true;
  }

  clearRoads() { disposeWorldGroup(this.roadGroup); }

  setRoads(network, buildings = null) {
    this.clearRoads();
    this.roadCenter = network.center;
    const surfaces = buildRoadMeshes(network);
    if (surfaces.children.length) this.roadGroup.add(...surfaces.children.slice());
    this.roadGroup.add(buildings ?? buildBuildings(network));
    this.roadGroup.add(buildMappedScenery(network));
    this.roadGroup.add(buildCoastalWater(network));
    this.roadGroup.add(buildBridgePiers(network));
    this.waterMeshes = [];
    this.roadGroup.traverse(object => { if(object.userData.animateWater) this.waterMeshes.push(object); });
    if (this.routeData) this.roadGroup.add(buildRouteRibbon(this.routeData, network.center, network));
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

  async loadRoadsAt(lat, lng, streaming = false) {
    if (!streaming) this.lastPosition = { lat, lng };
    if (!streaming && this.satellite?.group.visible) this.satellite.setLocation(lat, lng, true);
    this.roadRequest?.abort();
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
      const cached = nearbyCachedWorld(this.roadCache, lat, lng);
      const cacheKey = cached?.key ?? `${lat},${lng}`;
      const network = cached && Date.now() - cached.savedAt < 300000 ? cached.network
        : await loadWorld({ lat, lng, signal: controller.signal });
      if (controller.signal.aborted) return null;
      this.roadCache.delete(cacheKey);
      if (!network.routeApproximate) this.roadCache.set(cacheKey, { network, savedAt: Date.now() });
      if (this.roadCache.size > 8) this.roadCache.delete(this.roadCache.keys().next().value);
      if (streaming && this.lastPosition && !footprintOnRoad(network,
        projectCoordinate(this.lastPosition.lat, this.lastPosition.lng, network.center), this.lastHeading ?? 0, this.lastRoadHeight ?? ROAD_SURFACE_HEIGHT)) {
        throw new Error('Next district does not cover the car safely; retaining the current roads.');
      }
      const buildings = await buildBuildingsAsync(network);
      if (controller.signal.aborted) { disposeWorldGroup(buildings); return null; }
      if (streaming && !footprintOnRoad(network,
        projectCoordinate(this.lastPosition.lat,this.lastPosition.lng,network.center),this.lastHeading ?? 0, this.lastRoadHeight ?? ROAD_SURFACE_HEIGHT)) {
        disposeWorldGroup(buildings);
        throw new Error('Keeping current district while the car is outside replacement coverage.');
      }
      this.setRoads(network, buildings);
      this.roadTarget = network.center;
      this.roadFailures = 0;
      this.roadRetryAt = 0;
      this.container.dispatchEvent(new CustomEvent('roadstatus', {
        detail: { state: network.roads.length ? 'ready' : 'empty', count: network.roads.length, network }
      }));
      return network;
    } catch (error) {
      if (controller.signal.aborted) return null;
      this.roadFailures = (this.roadFailures ?? 0) + 1;
      this.roadRetryAt = performance.now() + Math.min(30000, 2000 * 2 ** Math.min(this.roadFailures,4));
      this.container.dispatchEvent(new CustomEvent('roadstatus', { detail: { state: 'error', message: error.message } }));
      throw error;
    } finally {
      if (this.roadRequest === controller) this.roadLoading = false;
    }
  }

  setPhotorealPreview(enabled) {
    if (enabled && !import.meta.env?.VITE_GOOGLE_MAPS_API_KEY) return false;
    this.previewActive = enabled;
    this.carGroup.visible = !enabled;
    this.roadGroup.visible = !enabled;
    this.environmentGroup.visible = !enabled;
    this.satellite.group.visible = !enabled;
    this.scene.fog = enabled ? null : new THREE.Fog(0xc4d4df, 100, 650);
    this.camera.far = enabled ? 100000 : 2000;
    this.camera.updateProjectionMatrix();
    if (enabled) {
      this.previewHeading = 0;
      this.camera.position.set(0,1200,500);
      this.photoreal = new PhotorealWorld(this.scene,this.camera,this.renderer,this.container);
    } else {
      this.photoreal?.dispose(); this.photoreal = null;
      this.satellite.setLocation(this.lastPosition.lat,this.lastPosition.lng,true);
    }
    return true;
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
    this.lastHeading = physics.heading;
    this.lastRoadHeight = physics.roadHeight ?? ROAD_SURFACE_HEIGHT;
    if (this.previewActive) {
      this.carGroup.visible = false;
      for (const peer of this.peerCars.values()) peer.group.visible = false;
      this.roadGroup.visible = false;
      const turn = (physics.keys.ArrowRight || physics.keys.KeyD ? 1 : 0) - (physics.keys.ArrowLeft || physics.keys.KeyA ? 1 : 0);
      this.previewHeading += turn * dt * .6;
      const ready = this.photoreal.groundReady;
      const radius = ready ? 110 : 500, height = ready ? 80 : 1200;
      this.camera.position.lerp(new THREE.Vector3(Math.sin(this.previewHeading)*radius,height,Math.cos(this.previewHeading)*radius),1-Math.exp(-2*dt));
      this.camera.lookAt(0,0,0);
      this.photoreal.update(physics.lat,physics.lng,dt);
      this.renderer.render(this.scene,this.camera);
      return;
    }
    const roadHeight = physics.roadHeight ?? ROAD_SURFACE_HEIGHT;
    const underground = roadHeight < -.5;
    this.environmentGroup.visible = !underground;
    this.satellite.group.visible = !underground;
    if (!underground) this.satellite.setLocation(physics.lat, physics.lng);
    this.carGroup.position.y = roadHeight;
    let pitch = 0;
    if (physics.roadNetwork) {
      const point = projectCoordinate(physics.lat,physics.lng,physics.roadNetwork.center);
      const forward=[Math.sin(physics.heading)*1.425,Math.cos(physics.heading)*1.425];
      const front=roadSurfaceAt(physics.roadNetwork,[point[0]+forward[0],point[1]+forward[1]],roadHeight);
      const rear=roadSurfaceAt(physics.roadNetwork,[point[0]-forward[0],point[1]-forward[1]],roadHeight);
      if(front!==null && rear!==null) pitch=Math.atan2(front-rear,2.85);
    }
    this.carGroup.rotation.set(-pitch,Math.PI-physics.heading,0,'YXZ');
    for (const water of this.waterMeshes ?? []) water.userData.animateWater(performance.now()/1000);
    animateWheels(this.wheels, physics.speed, physics.steering, dt);
    for(const material of this.brakeMaterials) material.emissiveIntensity = physics.throttle < 0 || physics.handbrake ? 2.5 : .65;
    for (const flame of this.exhaustFlames) flame.visible = performance.now() < this.flameUntil;
    if (this.roadCenter) {
      const { east, north } = geographicOffset(this.roadCenter, physics.lat, physics.lng);
      this.roadGroup.position.set(-east, 0, north);
    }
    if (this.roadOverlayEnabled && this.roadTarget && !this.roadLoading && performance.now() > (this.roadRetryAt ?? 0) && performance.now() - this.lastRoadRequestAt > 1500) {
      const p = geographicOffset(this.roadTarget, physics.lat, physics.lng);
      if (Math.hypot(p.east, p.north) > 140) {
        const next = nextWorldLocation(physics, physics.heading, physics.speed);
        this.loadRoadsAt(next.lat, next.lng, true).catch(() => {});
      }
    }
    for (const [id, peer] of this.peerCars) {
      if (performance.now() - peer.lastSeen > 10000) { disposeModel(peer.group); this.peerCars.delete(id); continue; }
      const p = geographicOffset(this.lastPosition, peer.state.lat, peer.state.lng);
      peer.group.position.set(p.east, Number.isFinite(peer.state.roadHeight) ? peer.state.roadHeight : ROAD_SURFACE_HEIGHT, -p.north);
      peer.group.rotation.y = Math.PI - peer.state.heading;
      peer.group.visible = Math.hypot(p.east, p.north) < 1000;
    }
    const mobile = this.container.clientWidth < 600;
    let target, lookAt;
    const heading = this.cameraMode === 'aerial' ? 0 : physics.heading;

    if (this.cameraMode === 'aerial') {
      target = new THREE.Vector3(0, 180, 0.01);
      lookAt = new THREE.Vector3(0, 0, 0);
    } else if (this.cameraMode === 'cockpit') {
      target = new THREE.Vector3(-Math.sin(heading)*.15,1.25,Math.cos(heading)*.15);
      lookAt = new THREE.Vector3(Math.sin(heading) * 15, 1.05, -Math.cos(heading) * 15);
    } else if (this.cameraMode === 'hood') {
      target = new THREE.Vector3(Math.sin(heading)*1.2,1.15,-Math.cos(heading)*1.2);
      lookAt = new THREE.Vector3(Math.sin(heading) * 20, 0.75, -Math.cos(heading) * 20);
    } else if (this.cameraMode === 'reverse') {
      const dist = 7.5, ht = 3.2;
      target = new THREE.Vector3(Math.sin(heading) * dist, ht, -Math.cos(heading) * dist);
      lookAt = new THREE.Vector3(-Math.sin(heading) * 2, 0.5, Math.cos(heading) * 2);
    } else {
      const [distance, height, ahead] = this.cameraMode === 'wide' ? [20, 17, 3] : [mobile ? 12 : 9.5, mobile ? 5.5 : 4.3, 3.5];
      const sideOffset = this.cameraMode === 'chase' ? 1.8 : 0;
      target = new THREE.Vector3(-Math.sin(heading) * distance + Math.cos(heading) * sideOffset, height, Math.cos(heading) * distance + Math.sin(heading) * sideOffset);
      lookAt = new THREE.Vector3(Math.sin(heading) * ahead, 0.5, -Math.cos(heading) * ahead);
    }

    if (underground && !['hood','cockpit'].includes(this.cameraMode)) {
      target.set(-Math.sin(heading)*6,2.1,Math.cos(heading)*6);
      lookAt.set(Math.sin(heading)*8,1,-Math.cos(heading)*8);
    }
    target.y += roadHeight;
    lookAt.y += roadHeight;
    this.camera.position.lerp(target, 1 - Math.exp(-6 * dt));
    if (this.cameraMode === 'cockpit' || this.cameraMode === 'hood') {
      this.camera.position.copy(target);
    }
    this.camera.lookAt(lookAt);
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    if (!this.container.clientWidth || !this.container.clientHeight) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }
}
