import * as THREE from 'three';

export const MAX_IMAGERY_LATITUDE = 85.05112878;
export const EARTH_CIRCUMFERENCE = 40075016.68557849;
export const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
export const MAX_TILE_ATTEMPTS = 2;

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

export const MAX_GROUND_OPENINGS=32;
export function createGroundOcclusion(){return {count:{value:0},segments:{value:Array.from({length:MAX_GROUND_OPENINGS},()=>new THREE.Vector4())},radii:{value:new Float32Array(MAX_GROUND_OPENINGS)},offset:{value:new THREE.Vector2()}};}
export function configureGroundOcclusion(material,state){
  material.side=THREE.DoubleSide;material.depthTest=true;material.depthWrite=true;
  material.onBeforeCompile=shader=>{
    shader.uniforms.terrainCutCount=state.count;shader.uniforms.terrainCuts=state.segments;shader.uniforms.terrainRadii=state.radii;shader.uniforms.terrainOffset=state.offset;
    shader.vertexShader='varying vec2 vTerrainXZ;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvTerrainXZ=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader='varying vec2 vTerrainXZ;\nuniform int terrainCutCount;\nuniform vec4 terrainCuts[32];\nuniform float terrainRadii[32];\nuniform vec2 terrainOffset;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      vec2 terrainPoint=vTerrainXZ-terrainOffset;
      for(int cut=0;cut<32;cut++){
        if(cut>=terrainCutCount)break;
        vec2 a=terrainCuts[cut].xy,b=terrainCuts[cut].zw,d=b-a;
        float t=dot(terrainPoint-a,d)/max(dot(d,d),0.0001);
        if(t>=0.0&&t<=1.0&&distance(terrainPoint,a+t*d)<terrainRadii[cut])discard;
      }`);
  };
  material.customProgramCacheKey=()=> 'ground-depressed-road-openings-v1';
  return material;
}
export function selectGroundOpenings(openings,point,max=MAX_GROUND_OPENINGS){
  if(!Array.isArray(openings)||!point||!point.every(Number.isFinite))return [];
  return openings.filter(c=>Array.isArray(c)&&c.length===5&&c.every(Number.isFinite)&&c[4]>0&&c[4]<=21).map(c=>{
    const dx=c[2]-c[0],dz=c[3]-c[1],t=Math.max(0,Math.min(1,((point[0]-c[0])*dx+(point[1]-c[1])*dz)/Math.max(.0001,dx*dx+dz*dz)));
    return {cut:c,distance:Math.hypot(point[0]-c[0]-t*dx,point[1]-c[1]-t*dz)};
  }).filter(c=>c.distance<220).sort((a,b)=>a.distance-b.distance).slice(0,Math.max(0,Math.min(MAX_GROUND_OPENINGS,Number.isFinite(max)?Math.floor(max):MAX_GROUND_OPENINGS))).map(c=>c.cut);
}
export function updateGroundOcclusion(state,openings,offset){
  const safe=(Array.isArray(openings)?openings:[]).filter(c=>Array.isArray(c)&&c.length===5&&c.every(Number.isFinite)&&c[4]>0&&c[4]<=21).slice(0,MAX_GROUND_OPENINGS);
  state.count.value=safe.length;for(let i=0;i<safe.length;i++){state.segments.value[i].set(...safe[i].slice(0,4));state.radii.value[i]=safe[i][4];}
  state.offset.value.set(Number.isFinite(offset?.x)?offset.x:0,Number.isFinite(offset?.z)?offset.z:0);
}

export class SatelliteWorld {
  constructor(scene, eventTarget, renderer,groundOcclusion=createGroundOcclusion()) {
    this.groundOcclusion=groundOcclusion;
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
    const previousWanted = this.wanted;
    this.wanted = new Set(tiles.map((tile) => tile.key));
    for (const entry of this.entries.values()) {
      entry.mesh.visible = this.wanted.has(entry.key) && entry.loaded;
      if (!this.wanted.has(entry.key)) entry.controller?.abort('location-change');
    }
    this.queue = [];
    for (const tile of tiles) {
      let entry = this.entries.get(tile.key);
      if (!entry) {
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.rotateX(-Math.PI / 2);
        const material = configureGroundOcclusion(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),this.groundOcclusion);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        this.group.add(mesh);
        entry = { ...tile, mesh, loaded: false, controller: null, used: Date.now(), failed: false, attempts: 0 };
        this.entries.set(tile.key, entry);
      }
      entry.used = Date.now();
      const newlyWanted = !previousWanted.has(tile.key);
      if (newlyWanted || (force && !entry.controller)) { entry.failed = false; entry.attempts = 0; }
      if (!entry.loaded && !entry.controller && !entry.failed && !this.queue.includes(entry)) this.queue.push(entry);
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
      if (!this.wanted.has(entry.key) || entry.loaded || entry.controller || entry.attempts >= MAX_TILE_ATTEMPTS) continue;
      this.active++;
      entry.controller = new AbortController();
      entry.attempts++;
      this.load(entry).finally(() => {
        this.active--;
        entry.controller = null;
        if (this.disposed) return;
        if (this.wanted.has(entry.key) && !entry.loaded && !entry.failed && entry.attempts < MAX_TILE_ATTEMPTS && !this.queue.includes(entry)) this.queue.push(entry);
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
      if (controller.signal.aborted || this.disposed || !this.wanted.has(entry.key) || !this.entries.has(entry.key)) {
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
      entry.failed = this.wanted.has(entry.key) && controller.signal.reason !== 'location-change' && entry.attempts >= MAX_TILE_ATTEMPTS;
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
