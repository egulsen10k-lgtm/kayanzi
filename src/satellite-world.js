import * as THREE from 'three';

export const MAX_IMAGERY_LATITUDE = 85.05112878;
export const EARTH_CIRCUMFERENCE = 40075016.68557849;
export const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

export function mercatorPosition(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > MAX_IMAGERY_LATITUDE) return null;
  const phi = lat * Math.PI / 180;
  return { x: ((lng + 180) / 360 % 1 + 1) % 1, y: (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 };
}

export function localTilePlacement(tile, lat, lng) {
  const center = mercatorPosition(lat, lng);
  if (!center) return null;
  const n = 2 ** tile.z;
  const scale = EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180);
  const dx = (((tile.x + 0.5) / n - center.x + 0.5) % 1 + 1) % 1 - 0.5;
  return { x: dx * scale, z: ((tile.y + 0.5) / n - center.y) * scale, size: scale / n };
}

// Fine tiles around the car, with a lower-resolution ring beneath for the horizon.
// Latitude-dependent zoom keeps fine tiles roughly 50 physical meters wide.
export function planImageryTiles(lat, lng) {
  const position = mercatorPosition(lat, lng);
  if (!position) return [];
  const zoom = Math.max(12, Math.min(19, Math.round(Math.log2(EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / 55))));
  const tiles = [];
  for (const [z, radius, layer] of [[zoom - 3, 2, 'coarse'], [zoom, 2, 'fine']]) {
    const n = 2 ** z;
    const cx = Math.floor(position.x * n);
    const cy = Math.min(n - 1, Math.max(0, Math.floor(position.y * n)));
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const y = cy + dy;
        if (y < 0 || y >= n) continue;
        const x = ((cx + dx) % n + n) % n;
        tiles.push({ x, y, z, layer, key: `${z}/${y}/${x}`, priority: Math.hypot(dx, dy) + (layer === 'coarse' ? -0.25 : 0) });
      }
    }
  }
  return tiles.sort((a, b) => a.priority - b.priority);
}

export class SatelliteWorld {
  constructor(scene, eventTarget, renderer) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.eventTarget = eventTarget;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.entries = new Map();
    this.wanted = new Set();
    this.queue = [];
    this.active = 0;
    this.signature = '';
    this.lastStatus = '';
    this.disposed = false;
  }

  setLocation(lat, lng, force = false) {
    this.lat = lat;
    this.lng = lng;
    // Reposition every frame; replan only after moving about a meter.
    const movementKey = `${Math.round(lat * 100000)},${Math.round(lng * 100000)}`;
    if (!force && movementKey === this.movementKey) {
      this.positionTiles();
      return;
    }
    this.movementKey = movementKey;
    if (force) this.lastStatus = '';
    const tiles = planImageryTiles(lat, lng);
    const signature = tiles.map((tile) => tile.key).join(',');
    if (signature === this.signature && !force) {
      this.positionTiles();
      return;
    }
    this.signature = signature;
    this.wanted = new Set(tiles.map((tile) => tile.key));
    for (const [key, entry] of this.entries) {
      entry.mesh.visible = this.wanted.has(key) && entry.loaded;
      if (!this.wanted.has(key)) entry.controller?.abort('location-change');
    }
    this.queue = [];
    for (const tile of tiles) {
      let entry = this.entries.get(tile.key);
      if (!entry) {
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        this.group.add(mesh);
        entry = { ...tile, mesh, loaded: false, controller: null, used: Date.now(), failed: false };
        this.entries.set(tile.key, entry);
      }
      entry.used = Date.now();
      if (force) entry.failed = false;
      if (!entry.loaded && !entry.controller && !entry.failed) this.queue.push(entry);
    }
    this.positionTiles();
    this.prune();
    this.emitStatus();
    this.pump();
  }

  positionTiles() {
    for (const key of this.wanted) {
      const entry = this.entries.get(key);
      const p = localTilePlacement(entry, this.lat, this.lng);
      if (!p) continue;
      entry.mesh.position.set(p.x, entry.layer === 'fine' ? -0.025 : -0.045, p.z);
      entry.mesh.scale.set(p.size, 1, p.size);
      entry.mesh.visible = entry.loaded;
    }
  }

  emitStatus() {
    let loaded = 0;
    let pending = 0;
    for (const key of this.wanted) {
      const entry = this.entries.get(key);
      if (entry.loaded) loaded++;
      else if (!entry.failed) pending++;
    }
    const state = loaded ? 'ready' : pending ? 'loading' : 'error';
    const signature = `${state}:${loaded}:${this.wanted.size}`;
    if (signature === this.lastStatus) return;
    this.lastStatus = signature;
    this.eventTarget.dispatchEvent(new CustomEvent('scenerystatus', {
      detail: { state, loaded, total: this.wanted.size, message: this.wanted.size ? 'Imagery could not be reached. Retry the location.' : 'Satellite imagery is unavailable near the poles.' }
    }));
  }

  pump() {
    while (!this.disposed && this.active < 6 && this.queue.length) {
      const entry = this.queue.shift();
      if (!this.wanted.has(entry.key) || entry.loaded || entry.controller) continue;
      this.active++;
      entry.controller = new AbortController();
      this.load(entry).finally(() => {
        this.active--;
        entry.controller = null;
        if (this.disposed) return;
        if (this.wanted.has(entry.key) && !entry.loaded && !entry.failed) this.queue.push(entry);
        this.emitStatus();
        this.prune();
        this.pump();
      });
    }
  }

  async load(entry) {
    const controller = entry.controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${IMAGERY_URL}/${entry.key}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Imagery HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      if (controller.signal.aborted || this.disposed || !this.entries.has(entry.key)) {
        bitmap.close();
        return;
      }
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      entry.mesh.material.map = texture;
      entry.mesh.material.needsUpdate = true;
      entry.loaded = true;
      entry.failed = false;
      entry.mesh.visible = this.wanted.has(entry.key);
    } catch {
      entry.failed = this.wanted.has(entry.key) && controller.signal.reason !== 'location-change';
    } finally {
      clearTimeout(timeout);
    }
  }

  prune() {
    const stale = [...this.entries.values()].filter((entry) => !this.wanted.has(entry.key) && !entry.controller).sort((a, b) => a.used - b.used);
    while (this.entries.size > 90 && stale.length) this.release(stale.shift());
  }

  release(entry) {
    entry.controller?.abort();
    entry.mesh.material.map?.image?.close?.();
    entry.mesh.material.map?.dispose();
    entry.mesh.material.dispose();
    entry.mesh.geometry.dispose();
    this.group.remove(entry.mesh);
    this.entries.delete(entry.key);
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    for (const entry of [...this.entries.values()]) this.release(entry);
    this.group.removeFromParent();
  }
}
