import { Pedestrians, seatCapacity } from './pedestrians.js';
import { PedestrianView } from './pedestrian-view.js';
import { bindTiltInput } from './tilt-input.js';
import { bindDrivingInput } from './driving-input.js';
import { assetUrl } from './resource-urls.js';
import { CarPhysics } from './physics.js';
import { CarAudio } from './audio.js';
import { CarVisualizer3D } from './visualizer.js';
import { WorldMapController } from './map.js';
import { nearestRoadSpawn, footprintOnRoad } from './road-safety.js';
import { projectCoordinate } from './road-network.js';
import { createRouteGuide } from './route-guide.js';
import { setWorldRoute } from './world-data.js';

document.addEventListener('DOMContentLoaded', () => {
  const peerId = 'driver-' + Math.random().toString(36).substring(2, 8);
  const physics = new CarPhysics(peerId);
  const audio = new CarAudio();
  const canvasContainer = document.getElementById('render-canvas-container');
  const visualizer = new CarVisualizer3D(canvasContainer);
  const pedestrians = new Pedestrians();
  const pedestrianView = new PedestrianView(visualizer.scene);
  const startHorn = () => {
    audio.startHorn();
    if (!visualizer.previewActive) pedestrians.horn(physics);
  };
  const stopHorn = () => audio.stopHorn();
  let routeGuide = null;
  let routeGeneration = 0;
  function endRoute() {
    routeGeneration++;
    routeGuide = null;
    setWorldRoute(null);
    visualizer.routeData = null;
    visualizer.roadCache.clear();
    mapController.setRoute(null);
    document.getElementById('akanzi-hud').hidden = true;
    document.getElementById('akanzi-end').hidden = true;
    const button=document.getElementById('akanzi-start');button.disabled=false;button.textContent='Drive Akanzi';
    const oldRibbon=visualizer.roadGroup.getObjectByName('akanzi-route');
    if(oldRibbon){oldRibbon.geometry.dispose();oldRibbon.material.dispose();oldRibbon.removeFromParent();}
  }
  const mapController = new WorldMapController('leaflet-map', (lat, lng) => {
    endRoute();
    physics.teleport(lat, lng);
    mapController.teleport(lat, lng);
    document.getElementById('hud-location-name').innerText = 'Custom World Coordinate';
    document.getElementById('hud-coords').innerText = `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;
    visualizer.loadRoadsAt(lat, lng).catch(() => {});
  });

  canvasContainer.addEventListener('scenerystatus', ({ detail }) => {
    const status = document.getElementById('imagery-status-text');
    status.textContent = detail.state === 'ready' ? 'Real aerial imagery · Esri' :
      detail.state === 'loading' ? 'Loading aerial imagery…' : 'Aerial imagery unavailable · 3D roads remain active';
  });

  // Road status indicator & retry handling
  const roadStatusDot = document.getElementById('road-status-dot');
  const roadStatusText = document.getElementById('road-status-text');

  canvasContainer.addEventListener('roadstatus', (e) => {
    const detail = e.detail || {};
    if (!roadStatusDot || !roadStatusText) return;

    roadStatusText.replaceChildren();
    roadStatusText.title = '';
    switch (detail.state) {
      case 'disabled':
        roadStatusDot.style.background = '#718096';
        roadStatusText.textContent = 'Road driving enabled';
        break;
      case 'loading':
        roadStatusDot.style.background = '#eab308';
        roadStatusText.textContent = physics.roadNetwork ? 'Loading next district…' : 'Loading roads · car held safely';
        break;
      case 'ready':
        roadStatusDot.style.background = '#22c55e';
        roadStatusText.textContent = `3D roads ready · ${detail.count || 0} streets${detail.network?.bundled ? " · local" : ""}`;
        if (detail.network) {
          const network = detail.network;
          const point = projectCoordinate(physics.lat, physics.lng, network.center);
          const needsSpawn = !physics.roadNetwork || !point || !footprintOnRoad(network, point, physics.heading, physics.roadHeight);
          if (needsSpawn) {
            const spawn = nearestRoadSpawn(network, physics.lat, physics.lng);
            if (spawn) {
              physics.teleport(spawn.lat, spawn.lng);
              physics.heading = spawn.heading;
              physics.roadHeight = spawn.roadHeight;
              mapController.teleport(spawn.lat, spawn.lng);
              if (spawn.name) document.getElementById('hud-location-name').textContent = spawn.name;
            } else {
              physics.setRoadNetwork(null);
              roadStatusText.textContent = 'No suitable road · choose another location';
              break;
            }
          }
          physics.setRoadNetwork(network);
          document.getElementById('world-detail-status').textContent = network.routeApproximate
            ? 'Offline route approximation · elevations unavailable'
            : '3D streets · bridge/tunnel heights estimated';
          document.getElementById('satellite-status-text').textContent = `3D buildings · ${network.buildings?.length ?? 0} mapped footprints`;
        }
        break;
      case 'empty':
        roadStatusDot.style.background = '#00f0ff';
        physics.setRoadNetwork(null);
        roadStatusText.textContent = 'No mapped roads · choose another location';
        break;
      case 'error': {
        roadStatusDot.style.background = '#ff3366';
        roadStatusText.textContent = physics.roadNetwork ? 'Next district unavailable · staying on loaded roads' : 'Roads unavailable · car held safely';
        roadStatusText.title = detail.message || 'The map service could not be reached. Retry or return to Munich.';
        const retryBtn = document.createElement('button');
        retryBtn.id = 'retry-roads-btn';
        retryBtn.type = 'button';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          visualizer.loadRoadsAt(physics.lat, physics.lng).catch(() => {});
        });
        roadStatusText.append(' ', retryBtn);
        break;
      }
    }
  });

  document.getElementById('reset-road-btn')?.addEventListener('click', () => {
    const network = physics.roadNetwork;
    if (!network) { visualizer.loadRoadsAt(physics.lat, physics.lng).catch(() => {}); return; }
    const spawn = nearestRoadSpawn(network, physics.lat, physics.lng);
    if (!spawn) return;
    physics.teleport(spawn.lat,spawn.lng);
    physics.heading=spawn.heading;
    physics.roadHeight=spawn.roadHeight;
    if(routeGuide) {
      const coords=routeGuide.data.coordinates;
      let best=Infinity;
      for(let i=1;i<coords.length;i++) {
        const a=projectCoordinate(coords[i-1][1],coords[i-1][0],spawn),b=projectCoordinate(coords[i][1],coords[i][0],spawn);
        const distance=Math.hypot(...a)+Math.hypot(...b);
        if(distance<best){best=distance;physics.heading=Math.atan2(b[0]-a[0],b[1]-a[1]);}
      }
    }
    physics.setRoadNetwork(network);
    mapController.teleport(spawn.lat,spawn.lng);
  });

  // Simulated peer broadcasting (LocalStorage BroadcastChannel for working together with other browser tabs/drivers)
  const syncChannel = new BroadcastChannel('bmw_earth_drive_multiplayer');
  syncChannel.onmessage = (event) => {
    const peerState = event.data;
    if (peerState && peerState.peerId !== peerId) {
      visualizer.updatePeerCar(peerState);
      mapController.updatePeerPosition(peerState);
    }
  };

  // Ignition Start Overlay & Real Road Network Loading
  const startOverlay = document.getElementById('start-overlay');
  const startBtn = document.getElementById('start-simulation-btn');

  startBtn.addEventListener('click', () => {
    audio.init();
    audio.triggerExhaustPop();
    startOverlay.style.opacity = '0';
    setTimeout(() => {
      startOverlay.style.display = 'none';
    }, 500);

    // Refresh imagery status even if its first event preceded the listener.
    visualizer.loadRoadsAt(physics.lat, physics.lng).catch(() => {});
  });

  const previewButton = document.getElementById('photoreal-toggle');
  const previewMessage = document.getElementById('photoreal-message');
  const previewAttribution = document.getElementById('photoreal-attribution');
  const hasPhotorealKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
  previewButton.disabled = !hasPhotorealKey;
  previewMessage.textContent = hasPhotorealKey ? 'Photographic 3D coverage varies by location.' : 'Needs a Google Map Tiles API key. See README setup. Current driving scenery uses mapped geometry and aerial imagery.';
  canvasContainer.addEventListener('photorealstatus', ({detail}) => {
    if (!visualizer.previewActive) return;
    previewMessage.textContent = detail.message;
    previewAttribution.textContent = `${detail.attribution} · Preview — driving paused`;
  });
  previewButton.addEventListener('click', () => {
    const enabled = !visualizer.previewActive;
    if (!visualizer.setPhotorealPreview(enabled)) return;
    physics.speed = 0; physics.keys = {}; physics.throttle = 0;
    previewButton.textContent = enabled ? 'Return to driving' : 'Open 3D preview';
    previewButton.setAttribute('aria-pressed',String(enabled));
    previewAttribution.hidden = !enabled;
    document.getElementById('imagery-attribution').hidden = enabled;
    previewMessage.textContent = enabled ? 'Loading photographic 3D preview…' : 'Driving resumed. Photographic preview is closed.';
  });

  const sidebar = document.getElementById('control-sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const studioClose = document.getElementById('studio-close');
  const setSidebarOpen = (open) => {
    if (!open && sidebar.contains(document.activeElement)) sidebarToggle.focus({ preventScroll: true });
    sidebar.inert = !open;
    sidebar.classList.toggle('open', open);
    sidebar.classList.toggle('collapsed', !open);
    sidebarToggle.setAttribute('aria-expanded', String(open));
  };
  setSidebarOpen(false);
  sidebarToggle.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
  studioClose?.addEventListener('click', () => {
    setSidebarOpen(false);
    sidebarToggle.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('open')) {
      setSidebarOpen(false);
      sidebarToggle.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (sidebar.classList.contains('open') && !sidebar.contains(event.target) && !sidebarToggle.contains(event.target)) {
      setSidebarOpen(false);
    }
  });

  document.getElementById('akanzi-start').addEventListener('click', async () => {
    const button=document.getElementById('akanzi-start');
    const message=document.getElementById('akanzi-message');
    const generation=++routeGeneration;
    button.disabled=true;button.textContent='Loading Akanzi…';message.textContent='';
    try {
      const [route,startData]=await Promise.all([assetUrl('data/akanzi-route.json'),assetUrl('data/akanzi-start.json')].map(async url=>{
        const response=await fetch(url);if(!response.ok)throw new Error('Route download failed');return response.json();
      }));
      if(generation!==routeGeneration)return;
      setWorldRoute(route,startData);visualizer.roadCache.clear();visualizer.routeData=route;routeGuide=createRouteGuide(route);
      mapController.setRoute(route);
      document.getElementById('akanzi-hud').hidden=false;
      document.getElementById('akanzi-end').hidden=false;
      const start=route.stops[0];
      physics.teleport(start.lat,start.lng);
      mapController.teleport(start.lat,start.lng);
      document.getElementById('hud-location-name').textContent='Akanzi · Bağdat Caddesi';
      await visualizer.loadRoadsAt(start.lat,start.lng);
      if(generation!==routeGeneration)return;
      // Follow the planned direction, rather than the arbitrary direction of an OSM way.
      const next=route.coordinates[1];
      const offset=projectCoordinate(next[1],next[0],start);
      physics.heading=Math.atan2(offset[0],offset[1]);
      button.textContent='Restart Akanzi';button.disabled=false;
      setSidebarOpen(false);
    } catch(error) {
      if(generation!==routeGeneration)return;
      endRoute();message.textContent='Akanzi could not load. Please try again.';
    }
  });
  document.getElementById('akanzi-end').addEventListener('click',()=>{
    endRoute();physics.setRoadNetwork(null);physics.speed=0;
    visualizer.loadRoadsAt(physics.lat,physics.lng).catch(()=>{});
  });

  bindTiltInput({ physics, button: document.getElementById('tilt-toggle'),
    calibrate: document.getElementById('tilt-calibrate'), status: document.getElementById('tilt-status') });

  bindDrivingInput({ physics, buttons: document.querySelectorAll('[data-drive-key]'),
    onHornStart: startHorn, onHornEnd: stopHorn });

  document.querySelectorAll('[data-model]').forEach((button) => {
    button.addEventListener('click', () => {
      const model = button.getAttribute('data-model');
      physics.setModel(model);
      visualizer.setModel(model);
      document.querySelectorAll('[data-model]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  document.querySelectorAll('[data-camera-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-camera-mode');
      visualizer.setCameraMode(mode);
      document.querySelectorAll('[data-camera-mode]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  document.getElementById('road-overlay-toggle')?.addEventListener('change', (event) => {
    visualizer.setRoadOverlayEnabled(event.currentTarget.checked);
  });

  const teleportForm = document.getElementById('teleport-form');
  const teleportError = document.getElementById('teleport-error');
  teleportForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const lat = Number(document.getElementById('teleport-lat').value);
    const lng = Number(document.getElementById('teleport-lng').value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      teleportError.textContent = 'Enter a latitude from −90 to 90 and longitude from −180 to 180.';
      return;
    }
    endRoute();
    if (!physics.teleport(lat, lng)) {
      teleportError.textContent = 'Those coordinates could not be used.';
      return;
    }
    teleportError.textContent = '';
    mapController.teleport(lat, lng);
    document.getElementById('hud-location-name').textContent = 'Custom World Coordinate';
    document.getElementById('hud-coords').textContent = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    visualizer.loadRoadsAt(lat, lng).catch(() => {});
  });

  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      const colorHex = e.target.getAttribute('data-color');
      physics.setColor(colorHex);
      visualizer.updateColor(colorHex);
    });
  });

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      physics.setHandling(e.target.getAttribute('data-mode'));
    });
  });

  document.querySelectorAll('.teleport-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const lat = parseFloat(item.getAttribute('data-lat'));
      const lng = parseFloat(item.getAttribute('data-lng'));
      const name = item.getAttribute('data-name');
      endRoute();

      physics.teleport(lat, lng);
      mapController.teleport(lat, lng);

      document.getElementById('hud-location-name').innerText = name;
      document.getElementById('hud-coords').innerText = `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;
      audio.triggerExhaustPop();
      visualizer.loadRoadsAt(lat, lng).catch(() => {});
    });
  });

  const audioToggleBtn = document.getElementById('audio-toggle-btn');
  audioToggleBtn.addEventListener('click', () => {
    const isMuted = audio.toggleMute();
    audioToggleBtn.innerText = isMuted ? 'Unmute' : 'Mute';
    audioToggleBtn.classList.toggle('active', isMuted);
  });

  for (const hornButton of [document.getElementById('horn-btn'), document.getElementById('mobile-horn')]) {
    hornButton.addEventListener('pointerdown', event => { event.preventDefault(); hornButton.setPointerCapture(event.pointerId); startHorn(); });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) hornButton.addEventListener(eventName, stopHorn);
  }

  document.getElementById('exhaust-pop-btn').addEventListener('click', () => {
    audio.triggerExhaustPop();
    visualizer.triggerExhaustFlames();
  });

  // Audio Channels Toggle and Drag-and-Drop Ordering
  document.querySelectorAll('[data-channel-toggle]').forEach(input => {
    input.addEventListener('change', (e) => {
      const channel = e.target.getAttribute('data-channel-toggle');
      audio.setChannelEnabled(channel, e.target.checked);
    });
  });

  const channelList = document.getElementById('audio-channel-list');
  if (channelList) {
    let draggedItem = null;

    channelList.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.channel-item');
      if (item) {
        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    channelList.addEventListener('dragend', (e) => {
      const item = e.target.closest('.channel-item');
      if (item) {
        item.classList.remove('dragging');
      }
      draggedItem = null;
    });

    channelList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const afterElement = getDragAfterElement(channelList, e.clientY);
      if (draggedItem) {
        if (afterElement == null) {
          channelList.appendChild(draggedItem);
        } else {
          channelList.insertBefore(draggedItem, afterElement);
        }
      }
    });
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.channel-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // Audio Sample Rate Selection & Master Volume
  const sampleRateSelect = document.getElementById('sample-rate-select');
  if (sampleRateSelect) {
    sampleRateSelect.addEventListener('change', (e) => {
      audio.setSampleRate(e.target.value);
    });
  }

  const volumeSlider = document.getElementById('master-volume-slider');
  const volumeValueLabel = document.getElementById('master-volume-value');
  if (volumeSlider && volumeValueLabel) {
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      volumeValueLabel.innerText = `${vol}%`;
      audio.setMasterVolume(vol / 100);
    });
  }

  // HUD Preferences (km/h vs mph, minimap toggle, trail toggle)
  let speedUnit = 'kmh';
  document.querySelectorAll('[data-speed-unit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-speed-unit]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      speedUnit = e.target.getAttribute('data-speed-unit');
      const unitEl = document.querySelector('.speedometer-val span:last-child');
      if (unitEl) {
        unitEl.innerText = speedUnit === 'mph' ? 'mph' : 'km/h';
      }
    });
  });

  const minimapToggle = document.getElementById('minimap-toggle');
  const mapContainer = document.getElementById('map-container');
  if (minimapToggle && mapContainer) {
    minimapToggle.addEventListener('change', (e) => {
      mapContainer.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const trailToggle = document.getElementById('trail-toggle');
  if (trailToggle) {
    trailToggle.addEventListener('change', (e) => {
      if (mapController.trackLine) {
        if (!e.target.checked) {
          mapController.trackLine.remove();
        } else {
          mapController.trackLine.addTo(mapController.map);
        }
      }
    });
  }

  const hudSpeed = document.getElementById('hud-speed');
  const hudRpm = document.getElementById('hud-rpm');
  const hudGear = document.getElementById('hud-gear');
  const hudRpmBar = document.getElementById('hud-rpm-bar');

  let lastTime = performance.now();
  let syncTimer = 0;
  let routeTimer = 0;

  function gameLoop(currentTime) {
    const dt = Math.min(0.1, (currentTime - lastTime) / 1000);
    lastTime = currentTime;

    if (!visualizer.previewActive) physics.update(dt);
    if (physics.impactEvent && physics.impactEvent.timestamp) {
      audio.triggerImpact(physics.impactEvent.speed);
      physics.impactEvent = null;
    }
    routeTimer += dt;
    if (routeGuide && routeTimer > .2) {
      routeTimer=0;
      const guidance=routeGuide.update(physics.lat,physics.lng);
      document.getElementById('akanzi-progress').textContent=guidance.complete?'Akanzi complete · Pendik Sahil':`Akanzi · ${(guidance.remaining/1000).toFixed(1)} km remaining`;
      document.getElementById('akanzi-next').textContent=guidance.complete?'You drove the full coastal route.':`Next: ${guidance.nextStop}`;
      document.getElementById('akanzi-instruction').textContent=guidance.instruction;
    }
    if (!visualizer.previewActive) pedestrians.update(physics, dt);
    pedestrianView.update(pedestrians, physics, visualizer.carGroup, visualizer.previewActive);
    const clinging = pedestrians.people.filter(person => person.state === 'clinging').length;
    const occupancy = `Kişi: ${pedestrians.passengers + 1}/${seatCapacity(physics.bmwModel)}${clinging ? ` · Tutunan: ${clinging}` : ' · Sürücü dahil'}`;
    const passengerHud = document.getElementById('hud-passengers');
    if (passengerHud.textContent !== occupancy) passengerHud.textContent = occupancy;
    const passengerStatus = document.getElementById('passenger-status');
    if (passengerStatus.textContent !== pedestrians.message) passengerStatus.textContent = pedestrians.message;
    visualizer.update(physics, dt);

    const headingDeg = (physics.heading * 180) / Math.PI;
    mapController.updateCarPosition(physics.lat, physics.lng, headingDeg);

    audio.update(physics.rpm, physics.throttle, physics.speed, physics.isDrifting, {model:physics.bmwModel,gear:physics.gear,brake:physics.handbrake || (physics.throttle < 0 && physics.speed > 0)});
    if (audio.lastThrottle > 0.5 && physics.throttle < 0.1 && physics.rpm > 3000) {
      visualizer.triggerExhaustFlames();
    }

    const speedRaw = Math.abs(physics.speed);
    const displaySpeed = speedUnit === 'mph' ? Math.round(speedRaw * 0.621371) : Math.round(speedRaw);
    hudSpeed.innerText = displaySpeed;
    document.getElementById('hud-coords').textContent = `${physics.lat.toFixed(5)}°, ${physics.lng.toFixed(5)}°`;
    const hint = document.getElementById('road-driving-hint');
    if (hint) hint.textContent = physics.roadBlocked && physics.roadNetwork ? 'Road edge · reverse or reset in Studio' : '';
    const boundary = document.getElementById('road-boundary-status');
    if (boundary) boundary.textContent = physics.roadBlocked ? (physics.roadNetwork ? 'Road edge · brake / reverse or reset' : 'Waiting for drivable roads') : 'Road boundaries active';
    hudRpm.innerText = Math.round(physics.rpm);
    hudGear.innerText = physics.bmwModel === 'i4 M50 (EV)' ? 'D' : physics.gear;

    const rpmPercent = Math.min(100, (physics.rpm / 8500) * 100);
    hudRpmBar.style.width = `${rpmPercent}%`;

    // Broadcast position to other open tabs/drivers every 100ms
    syncTimer += dt;
    if (syncTimer > 0.1) {
      syncTimer = 0;
      syncChannel.postMessage(physics.serializeState());
    }

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
});
