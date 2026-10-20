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

    this.initMap();
  }

  initMap() {
    const initialLat = 48.1764;
    const initialLng = 11.5583;

    this.map = L.map(this.mapContainerId, {
      center: [initialLat, initialLng],
      zoom: 16,
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

    this.map.on('mousedown touchstart', () => {
      this.followCar = false;
    });

    this.map.on('click', (e) => {
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
    if (!this.map) return;
    let marker = this.peerMarkers.get(peerState.peerId);
    if (!marker) {
      const peerIcon = L.divIcon({
        className: 'peer-car-marker',
        html: `
          <div style="
            width: 22px;
            height: 22px;
            background: ${peerState.color || '#22c55e'};
            border: 2px solid #fff;
            border-radius: 50%;
            box-shadow: 0 0 10px #22c55e;
          "></div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      marker = L.marker([peerState.lat, peerState.lng], { icon: peerIcon }).addTo(this.map);
      marker.bindTooltip(`Driver: ${peerState.peerId}`, { permanent: false, direction: 'top' });
      this.peerMarkers.set(peerState.peerId, marker);
    } else {
      marker.setLatLng([peerState.lat, peerState.lng]);
    }
  }

  updateCarPosition(lat, lng, headingDeg) {
    if (!this.map || !this.carMarker) return;
    const now = performance.now();
    if (this.lastMapUpdate && now - this.lastMapUpdate < 100) return;
    this.lastMapUpdate = now;

    const latLng = [lat, lng];
    this.carMarker.setLatLng(latLng);

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
  }

  teleport(lat, lng, zoom = 16) {
    this.followCar = true;
    this.trackCoords = [];
    this.trackLine.setLatLngs([]);
    this.map.setView([lat, lng], zoom);
    this.carMarker.setLatLng([lat, lng]);
  }
}
