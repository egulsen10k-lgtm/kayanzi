import { Matrix4, Raycaster, Vector3 } from 'three';

// WGS84 Earth-centred coordinates, transformed to the game's east/up/south frame.
export function earthToLocal(lat, lng, altitude = 0) {
  const phi = lat * Math.PI / 180, lambda = lng * Math.PI / 180;
  const s = Math.sin(phi), c = Math.cos(phi), sl = Math.sin(lambda), cl = Math.cos(lambda);
  const a = 6378137, eccentricitySquared = 6.69437999014e-3;
  const n = a / Math.sqrt(1 - eccentricitySquared * s * s);
  const origin = new Vector3((n + altitude) * c * cl, (n + altitude) * c * sl,
    (n * (1 - eccentricitySquared) + altitude) * s);
  const east = new Vector3(-sl, cl, 0);
  const up = new Vector3(c * cl, c * sl, s);
  const south = new Vector3(s * cl, s * sl, -c);
  return new Matrix4().set(
    east.x, east.y, east.z, -east.dot(origin),
    up.x, up.y, up.z, -up.dot(origin),
    south.x, south.y, south.z, -south.dot(origin),
    0, 0, 0, 1);
}

/** Photographic 3D preview only: reconstructed surfaces are not road collision data. */
export class PhotorealWorld {
  constructor(scene, camera, renderer, eventTarget, options = {}) {
    this.active = false;
    this.ready = false;
    this.groundReady = false;
    this.groundAltitude = 0;
    this.status = 'unconfigured';
    this.eventTarget = eventTarget;
    this.camera = camera;
    this.renderer = renderer;
    this.elapsed = 0;
    this.sampleElapsed = 0;
    this.lastStatus = '';
    this.apiKey = options.apiKey ?? import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ?? '';
    if (!this.apiKey.trim()) return;
    this.active = true;
    this.initialization = this.initialize(scene).catch(() => {
      this.emit('error', 'The photographic 3D renderer could not initialize.');
    });
  }

  async initialize(scene) {
    const [{ TilesRenderer, GoogleCloudAuthPlugin }, { GLTFLoader }, { DRACOLoader }] = await Promise.all([
      import('3d-tiles-renderer'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js')
    ]);
    if (!this.active) return;
    const tiles = this.tiles = new TilesRenderer();
    const auth = new GoogleCloudAuthPlugin({ apiToken: this.apiKey, useRecommendedSettings: false });
    // The older compatible renderer logs fetch errors; never include credential-bearing URLs.
    const fetchData = auth.fetchData.bind(auth);
    auth.fetchData = async (url, fetchOptions) => {
      try {
        const response = await fetchData(url, fetchOptions);
        if (!response.ok) throw new Error(`3D imagery request failed (HTTP ${response.status}).`);
        return response;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        this.emit('error', '3D imagery could not load. Check the Maps Tile API key, billing and coverage.');
        throw new Error('Photographic 3D imagery request failed.');
      }
    };
    tiles.registerPlugin(auth);
    tiles.errorTarget = 12;
    tiles.downloadQueue.maxJobs = 4;
    tiles.parseQueue.maxJobs = 2;
    Object.assign(tiles.lruCache, { minSize: 100, maxSize: 200,
      minBytesSize: 96 * 1024 * 1024, maxBytesSize: 160 * 1024 * 1024 });
    tiles.loadSiblings = false;
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(`${import.meta.env?.BASE_URL ?? '/'}draco/`);
    this.draco.setWorkerLimit(2);
    const loader = new GLTFLoader(tiles.manager);
    loader.setDRACOLoader(this.draco);
    tiles.manager.addHandler(/\.(gltf|glb)(\?|$)/i, loader);
    this.group = tiles.group;
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    tiles.setCamera(this.camera);
    this.raycaster = new Raycaster();
    this.raycaster.firstHitOnly = true;
    this.active = true;
    this.emit('loading', 'Loading photographic 3D preview…');
  }

  emit(state, message = '') {
    if (!this.active) return;
    this.status = state;
    const attribution = this.tiles?.getAttributions().filter(item => item.type === 'string')
      .map(item => item.value).filter(Boolean).join(' · ') || '';
    const detail = { state, message, ready: this.ready, groundReady: this.groundReady,
      attribution: attribution ? `Google Maps · ${attribution}` : 'Google Maps' };
    const serialized = JSON.stringify(detail);
    if (serialized === this.lastStatus) return;
    this.lastStatus = serialized;
    this.eventTarget?.dispatchEvent(new CustomEvent('photorealstatus', { detail }));
  }

  update(lat, lng, dt = 0) {
    if (!this.active || !this.tiles) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (this.location && (Math.abs(lat - this.location.lat) > 0.02 || Math.abs(lng - this.location.lng) > 0.02)) {
      this.groundAltitude = 0;
      this.groundReady = false;
      this.ready = false;
      this.elapsed = 0;
    }
    this.location = { lat, lng };
    this.group.matrix.copy(earthToLocal(lat, lng, this.groundAltitude));
    this.group.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
    this.elapsed += Math.min(dt, 0.25);
    this.sampleElapsed += Math.min(dt, 0.25);
    if (this.sampleElapsed >= 0.25) {
      this.sampleElapsed = 0;
      const height = this.sampleGroundHeight();
      if (height !== null) {
        this.groundAltitude += this.groundReady ? Math.max(-2, Math.min(2, height)) : height;
        this.groundReady = true;
        this.ready = true;
        this.group.matrix.copy(earthToLocal(lat, lng, this.groundAltitude));
        this.group.updateMatrixWorld(true);
        this.emit('ready', 'Photographic 3D preview · driving paused');
      } else if (this.elapsed > 45 && !this.groundReady && this.status !== 'error') {
        this.emit('error', 'No 3D surface loaded here. Coverage or network may be unavailable.');
      } else if (this.ready) this.emit('ready', 'Photographic 3D preview · driving paused');
    }
  }

  // Highest reconstructed visible surface can be a roof/tree. Preview anchor only.
  sampleGroundHeight(x = 0, z = 0) {
    if (!this.tiles || !this.tiles.visibleTiles.size) return null;
    this.raycaster.set(new Vector3(x, 10000, z), new Vector3(0, -1, 0));
    this.raycaster.far = 20000;
    const hit = this.raycaster.intersectObject(this.group, true)[0];
    return hit && Number.isFinite(hit.point.y) ? hit.point.y : null;
  }

  dispose() {
    this.active = false;
    this.ready = false;
    this.group?.removeFromParent();
    this.tiles?.dispose();
    this.draco?.dispose();
    this.status = 'disposed';
  }
}
