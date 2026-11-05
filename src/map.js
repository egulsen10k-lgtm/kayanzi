import L from 'leaflet';

export class WorldMapController {
  constructor(mapContainerId, onLocationSelect) {
    this.mapContainerId = mapContainerId;
    this.onLocationSelect = onLocationSelect;
    this.map = null;
    this.carMarker = null;
    this.trackLine = null;
    this.trackCoords = [];
    this.followCar = true;
    this.peerMarkers = new Map();
    this.minimapZoom = 1.0;
    this.minimapBaseZoom = 16;
    this.minimapDirty = false;
    this.fuelStations = [];
    this.fuelPinMarkers = [];

    this.initMap();
  }

  initMap() {
    this.clearPeerPositions();
    const initialLat = 48.1764;
    const initialLng = 11.5583;

    this.map = L.map(this.mapContainerId, {
      center: [initialLat, initialLng],
      zoom: 16,
      zoomSnap: 0.1,
      zoomControl: true,
      attributionControl: true
    });

    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: 'Imagery &copy; Esri, Vantor, Earthstar Geographics, GIS User Community'
    }).addTo(this.map);
    L.control.layers({ Satellite: satellite, Streets: streets }, {}, { position: 'topleft' }).addTo(this.map);

    const carIcon = L.divIcon({
      className: 'bmw-map-marker',
      html: `
        <div style="
          width: 28px;
          height: 28px;
          background: #0066b1;
          border: 3px solid #ffffff;
          box-shadow: 0 0 15px #00f0ff, 0 0 5px #000;
          border-radius: 50%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div id="marker-arrow" style="
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 12px solid #ff3366;
            position: absolute;
            top: -10px;
          "></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    this.carMarker = L.marker([initialLat, initialLng], { icon: carIcon }).addTo(this.map);

    this.trackLine = L.polyline([], {
      color: '#00f0ff',
      weight: 4,
      opacity: 0.8,
      smoothFactor: 1
    }).addTo(this.map);

    const container = document.getElementById(this.mapContainerId).parentElement;
    const toolbar = document.createElement('div');
    toolbar.className = 'map-toolbar';
    const button = (label, action) => {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = label;
      el.addEventListener('click', action); toolbar.append(el); return el;
    };
    this.expandButton = button('Expand map', () => {
      const expanded = container.classList.toggle('map-expanded');
      this.selectLocation = false;
      this.pickButton.setAttribute('aria-pressed', 'false');
      this.expandButton.textContent = expanded ? 'Close map' : 'Expand map';
      this.expandButton.setAttribute('aria-expanded', String(expanded));
    });
    button('Follow car', () => {
      this.followCar = true;
      this.map.panTo(this.carMarker.getLatLng(), { animate: false });
    });
    this.pickButton = button('Choose destination', () => {
      this.selectLocation = !this.selectLocation;
      this.pickButton.setAttribute('aria-pressed', String(this.selectLocation));
    });
    container.append(toolbar);
    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
    this.resizeObserver.observe(container);

    this.map.on('dragstart', () => {
      this.followCar = false;
    });

    this.map.on('click', (e) => {
      if (!this.selectLocation) return;
      this.selectLocation = false;
      this.pickButton.setAttribute('aria-pressed', 'false');
      this.followCar = true;
      if (this.onLocationSelect) {
        this.onLocationSelect(e.latlng.lat, e.latlng.lng);
      }
    });
  }

  setRoute(route) {
    if (this.routeLayer) this.map.removeLayer(this.routeLayer);
    this.routeLayer = null;
    if (!route) return;
    this.routeLayer = L.featureGroup([
      L.polyline(route.coordinates.map(([lng,lat])=>[lat,lng]),{color:'#19e4ed',weight:5,opacity:.95}),
      ...route.stops.map(stop=>L.circleMarker([stop.lat,stop.lng],{radius:4,color:'#ffffff',fillColor:'#08a7b4',fillOpacity:1}).bindTooltip(stop.name))
    ]).addTo(this.map);
  }

  updatePeerPosition(peerState) {
    const id=typeof peerState?.peerId==='string'?peerState.peerId.trim():'';
    if (!this.map || !id || id.length>64 || !Number.isFinite(peerState.lat) || !Number.isFinite(peerState.lng) || Math.abs(peerState.lat)>90 || Math.abs(peerState.lng)>180) return false;
    let marker = this.peerMarkers.get(id);
    if (!marker) {
      const peerIcon = L.divIcon({
        className: 'peer-car-marker',
        html: `
          <div style="
            width: 22px;
            height: 22px;
            background: ${/^#[0-9a-f]{6}$/i.test(peerState.color) ? peerState.color : '#22c55e'};
            border: 2px solid #fff;
            border-radius: 50%;
            box-shadow: 0 0 10px #22c55e;
          "></div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      marker = L.marker([peerState.lat, peerState.lng], { icon: peerIcon }).addTo(this.map);
      const label = document.createElement('span');
      label.textContent = `Driver: ${String(peerState.name ?? id).slice(0,64)}`;
      marker.bindTooltip(label, { permanent: false, direction: 'top' });
      this.peerMarkers.set(id, marker);
    } else {
      marker.setLatLng([peerState.lat, peerState.lng]);
    }
    return true;
  }

  removePeerPosition(id) {
    const key=typeof id==='string'?id.trim():'';
    if (!key) return false;
    const marker = this.peerMarkers.get(key);
    if (!marker) return false;
    marker.remove?.();
    this.map?.removeLayer?.(marker);
    this.peerMarkers.delete(key);
    return true;
  }

  clearPeerPositions() {
    for(const id of [...this.peerMarkers.keys()]) this.removePeerPosition(id);
    this.peerMarkers.clear();
  }

  setMinimapZoom(z) {
    const value=Number(z);
    if(Number.isFinite(value))this.minimapZoom=Math.max(.5,Math.min(3,value));
    this.minimapDirty=true;
    return this.minimapZoom;
  }

  addFuelStations(roadNetwork) {
    if (!roadNetwork?.elements) { this.fuelStations = []; return; }
    const stations = [];
    for (const el of roadNetwork.elements) {
      if (el.type !== 'node' || !el.lat || !el.lng) continue;
      const tags = el.tags ?? {};
      const name = String(tags.name ?? '').toLowerCase();
      if (tags.amenity === 'fuel' || name.includes('petrol') || name.includes('benzin') || name.includes('gas station')) {
        stations.push({ lat: el.lat, lng: el.lng, name: tags.name ?? 'Fuel' });
      }
    }
    this.fuelStations = stations;
  }

  _updateFuelPins(carLat, carLng, fuelFraction) {
    if (!this.map) return;
    // Remove existing pins
    for (const m of this.fuelPinMarkers) this.map.removeLayer(m);
    this.fuelPinMarkers = [];
    if (fuelFraction >= 0.20 || this.fuelStations.length === 0) return;
    // Sort by distance, take nearest 3
    const R = 111195;
    const scaleX = R * Math.cos(carLat * Math.PI / 180);
    const sorted = this.fuelStations
      .map(s => ({ ...s, dist: Math.hypot((s.lng - carLng) * scaleX, (s.lat - carLat) * R) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
    for (const s of sorted) {
      const km = (s.dist / 1000).toFixed(1);
      const icon = L.divIcon({
        className: '',
        html: `<div style="text-align:center;font-size:18px;line-height:1">⛽<div style="font:700 10px system-ui;color:#22cc55;background:#102634cc;border-radius:6px;padding:1px 4px;margin-top:1px">${km} km</div></div>`,
        iconAnchor: [14, 8]
      });
      const m = L.marker([s.lat, s.lng], { icon, interactive: false });
      m.addTo(this.map);
      this.fuelPinMarkers.push(m);
    }
  }

  updateCarPosition(lat, lng, headingDeg, fuelFraction) {
    if (!this.map || !this.carMarker) return;
    const now = performance.now();
    if (this.lastMapUpdate && now - this.lastMapUpdate < 100) return;
    this.lastMapUpdate = now;

    const latLng = [lat, lng];
    this.carMarker.setLatLng(latLng);

    if(this.minimapDirty) {
      this.map.setZoom(this.minimapBaseZoom+Math.log2(this.minimapZoom),{animate:false});
      this.minimapDirty=false;
    }

    const arrow = document.getElementById('marker-arrow');
    if (arrow) {
      arrow.style.transform = `rotate(${headingDeg}deg)`;
    }

    if (this.followCar) {
      this.map.panTo(latLng, { animate: false });
    }

    const previous = this.trackCoords.at(-1);
    if (previous && L.latLng(previous).distanceTo(latLng) < 1) return;
    this.trackCoords.push(latLng);
    if (this.trackCoords.length > 250) {
      this.trackCoords.shift();
    }
    this.trackLine.setLatLngs(this.trackCoords);
    if (Number.isFinite(fuelFraction)) this._updateFuelPins(lat, lng, fuelFraction);
  }

  teleport(lat, lng, zoom = 16) {
    this.followCar = true;
    this.selectLocation = false;
    this.trackCoords = [];
    this.trackLine.setLatLngs([]);
    this.minimapBaseZoom=Number.isFinite(zoom)?zoom:this.minimapBaseZoom;
    this.map.setView([lat, lng], this.minimapBaseZoom+Math.log2(this.minimapZoom), {animate:false});
    this.minimapDirty=false;
    this.carMarker.setLatLng([lat, lng]);
  }
}
