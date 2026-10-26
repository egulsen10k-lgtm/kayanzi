import { Pedestrians, seatCapacity } from './pedestrians.js';
import { PedestrianView } from './pedestrian-view.js';
import { TrafficManager } from './traffic.js';
import { bindTiltInput } from './tilt-input.js';
import { bindDrivingInput } from './driving-input.js';
import { bindSteeringWheelInput } from './steering-wheel-input.js';
import { assetUrl } from './resource-urls.js';
import { CarPhysics } from './physics.js';
import { CarAudio } from './audio.js';
import { CarVisualizer3D } from './visualizer.js';
import { WorldMapController } from './map.js';
import { nearestRoadSpawn, footprintOnRoad } from './road-safety.js';
import { projectCoordinate } from './road-network.js';
import { createRouteGuide } from './route-guide.js';
import { setWorldRoute } from './world-data.js';
import { RunnerGame } from './runner-game.js';
import { createRobotModel, RobotRunnerView } from './robot-runner-view.js';
import { animateRobot } from './robot-animation.js';
import { RobotJump } from './robot-jump.js';

document.addEventListener('DOMContentLoaded', () => {
  const peerId = 'driver-' + Math.random().toString(36).substring(2, 8);
  const physics = new CarPhysics(peerId);
  const audio = new CarAudio();
  const canvasContainer = document.getElementById('render-canvas-container');
  const visualizer = new CarVisualizer3D(canvasContainer);
  const pedestrians = new Pedestrians();
  const trafficManager = new TrafficManager(visualizer.trafficGroup ?? visualizer.scene);

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
              pedestrians.clearNetwork();
              trafficManager.clear();
              visualizer.setRoads({ center: network.center, roads: [], barriers: [] });
              roadStatusText.textContent = 'No suitable road · choose another location';
              break;
            }
          }
          physics.setRoadNetwork(network);
          if (pedestrians.network !== network) {
            pedestrians.reset(network, physics, pedestrians.density);
            trafficManager.reset(network, physics);
          }
          document.getElementById('world-detail-status').textContent = network.routeApproximate
            ? 'Offline route approximation · elevations unavailable'
            : '3D streets · bridge/tunnel heights estimated';
          document.getElementById('satellite-status-text').textContent = `3D buildings · ${network.buildings?.length ?? 0} mapped footprints`;
        }
        break;
      case 'empty':
        roadStatusDot.style.background = '#00f0ff';
        physics.setRoadNetwork(null);
        pedestrians.clearNetwork();
        trafficManager.clear();
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

  const songButton=document.getElementById('milli-sarki-btn');
  const song=new Audio(assetUrl('milli-sarki.mp3'));song.preload='none';song.volume=.55;
  const songState=()=>{songButton.setAttribute('aria-pressed',String(!song.paused));songButton.classList.toggle('playing',!song.paused);songButton.textContent=song.paused?'♫ Milli Akanzi Song':'Ⅱ Milli Akanzi Song';};
  songButton.addEventListener('click',async()=>{if(!song.paused){song.pause();songState();return;}try{await song.play();songState();}catch{songButton.textContent='Retry Milli Akanzi Song';}});
  song.addEventListener('ended',songState);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){song.pause();songState();}});
  const densitySelect = document.getElementById('traffic-density');
  const nightToggle = document.getElementById('night-mode');
  const beamsToggle = document.getElementById('high-beams');
  densitySelect?.addEventListener('change', e => {
    const density = Number(e.target.value);
    trafficManager.setDensity(density, physics);
  });
  nightToggle?.addEventListener('change', e => visualizer.setNightMode(e.target.checked));
  beamsToggle?.addEventListener('change', e => visualizer.setHighBeams(e.target.checked));

  startBtn.addEventListener('click', () => {
    audio.init();
    trafficManager.setDensity(Number(densitySelect?.value ?? 1), physics);
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

  // Settings Panel & Driving Style Switching
  const settingsPanel = document.getElementById('settings-panel');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsClose = document.getElementById('settings-close');
  const steeringStyleSelect = document.getElementById('steering-style');
  const showSteeringWheelCheckbox = document.getElementById('show-steering-wheel');

  const steeringWheelInput = bindSteeringWheelInput({ physics });

  const setSettingsOpen = (open) => {
    settingsPanel.hidden = !open;
    settingsToggle.setAttribute('aria-expanded', String(open));
  };
  setSettingsOpen(false);
  settingsToggle?.addEventListener('click', () => setSettingsOpen(settingsPanel.hidden));
  settingsClose?.addEventListener('click', () => setSettingsOpen(false));

  const updateSteeringStyle = () => {
    const style = steeringStyleSelect.value;
    document.getElementById('drive-touch-controls').dataset.mode=style;
    physics.wheelSteering=0;
    if(style!=='tilt') tiltBinding.stop();
    else if(document.getElementById('tilt-toggle').getAttribute('aria-pressed')!=='true')document.getElementById('tilt-toggle').click();
    if (style === 'steering-wheel') {
      if (showSteeringWheelCheckbox.checked) {
        steeringWheelInput.start();
      } else {
        steeringWheelInput.stop();
      }
    } else {
      steeringWheelInput.stop();
    }
  };

  steeringStyleSelect?.addEventListener('change', updateSteeringStyle);
  showSteeringWheelCheckbox?.addEventListener('change', updateSteeringStyle);

  const tiltBinding = bindTiltInput({
    physics,
    button: document.getElementById('tilt-toggle'),
    calibrate: document.getElementById('tilt-calibrate'),
    status: document.getElementById('tilt-status'),
    getOptions: () => ({
      invertSteering: document.getElementById('invert-tilt-steering')?.checked,
      invertThrottle: document.getElementById('invert-tilt-throttle')?.checked
    })
  });

  const driveInput = bindDrivingInput({ physics, buttons: document.querySelectorAll('[data-drive-key]'),
    onHornStart: startHorn, onHornEnd: stopHorn,
    isRobotMode: () => robotMode && !runnerActive,
    onRobotJump: () => robotJump.jump() });

  const dynamicsToggle = document.getElementById('drive-dynamics-toggle');
  const dynamicsPanel = document.getElementById('drive-dynamics-panel');
  const setDynamicsOpen = open => {
    dynamicsPanel.hidden = !open;
    dynamicsToggle.setAttribute('aria-expanded', String(open));
    if (open) setSettingsOpen(false);
  };
  dynamicsToggle.addEventListener('click', () => setDynamicsOpen(dynamicsPanel.hidden));
  document.getElementById('drive-dynamics-close').addEventListener('click', () => setDynamicsOpen(false));
  const bindDynamicsSelect = (id, apply, values) => {
    const select = document.getElementById(id);
    select.addEventListener('change', () => apply(values[select.value]));
  };
  bindDynamicsSelect('drive-mode-select', value => physics.setDriveMode(value),
    {comfort:'Comfort',sport:'Sport','sport-plus':'Sport+'});
  bindDynamicsSelect('brake-feel-select', value => physics.setBrakeMode(value),
    {comfort:'Comfort',sport:'Sport'});
  bindDynamicsSelect('suspension-select', value => physics.setSuspensionMode(value),
    {comfort:'Comfort',sport:'Sport'});
  bindDynamicsSelect('dsc-mode-select', value => physics.setDscMode(value),
    {on:'On',traction:'Traction',off:'Off'});

  const gearButtons = [...document.querySelectorAll('[data-gear]')];
  const gearShiftStatus = document.getElementById('gear-shift-status');
  let gearStatusTimer;
  const syncGearButtons = () => gearButtons.forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.gear === physics.driveGear)));
  if (window.matchMedia('(max-width:800px), (any-pointer:coarse), (max-height:500px) and (orientation:landscape)').matches) {
    physics.setDriveGear('D');
  }
  syncGearButtons();
  gearButtons.forEach(button => button.addEventListener('click', () => {
    if (!physics.setDriveGear(button.dataset.gear)) {
      gearShiftStatus.textContent = 'Slow down to shift';
      gearShiftStatus.hidden = false;
      clearTimeout(gearStatusTimer);
      gearStatusTimer = setTimeout(() => { gearShiftStatus.textContent = ''; gearShiftStatus.hidden = true; }, 2200);
      return;
    }
    gearShiftStatus.textContent = '';
    gearShiftStatus.hidden = true;
    syncGearButtons();
  }));
  settingsToggle.addEventListener('click', () => {
    if (!settingsPanel.hidden) setDynamicsOpen(false);
  });

  const nitroButton = document.getElementById('nitro-button');
  const releaseNitro = () => {
    physics.setNitroActive(false);
    nitroButton.setAttribute('aria-pressed', 'false');
  };
  nitroButton.addEventListener('pointerdown', event => {
    if (nitroButton.disabled) return;
    event.preventDefault();
    nitroButton.setPointerCapture(event.pointerId);
    physics.setNitroActive(true);
    nitroButton.setAttribute('aria-pressed', 'true');
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture'])
    nitroButton.addEventListener(type, releaseNitro);
  window.addEventListener('blur', releaseNitro);

  document.querySelectorAll('[data-model]').forEach((button) => {
    button.addEventListener('click', () => {
      const model = button.getAttribute('data-model');
      const boarded = pedestrians.people.filter(person => person.state === 'boarded');
      physics.setModel(model);
      visualizer.setModel(model);
      pedestrians.passengers = Math.min(boarded.length, Math.max(0, seatCapacity(model) - 1));
      boarded.forEach((person, index) => { person.state = index < pedestrians.passengers ? 'boarded' : 'idle'; });
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

  const mainViewport = document.getElementById('main-viewport');
  const modeStyle = document.createElement('style');
  modeStyle.textContent = `
    #transform-controls{position:absolute;right:12px;top:158px;z-index:18;display:grid;gap:7px;width:146px}
    #transform-controls button,#runner-ui button{border:1px solid #75dce9;border-radius:12px;background:#102634e8;color:white;font:700 12px system-ui;padding:11px 9px;cursor:pointer;box-shadow:0 6px 18px #0007;touch-action:manipulation}
    #transform-controls button[aria-pressed="true"]{background:#136384;border-color:#a5f5ff}
    #transform-controls button[hidden]{display:none}
    #runner-ui[hidden]{display:none}
    #main-viewport.runner-active > :not(#render-canvas-container):not(#runner-ui){display:none!important}
    #runner-ui{position:absolute;inset:0;z-index:30;pointer-events:none;color:white;font-family:system-ui}
    #runner-ui button{pointer-events:auto;min-height:48px}
    .runner-top{display:flex;align-items:start;justify-content:space-between;gap:10px;padding:max(12px,env(safe-area-inset-top)) 12px 0}
    .runner-stats{background:#102634dc;border:1px solid #75dce9;border-radius:12px;padding:10px 13px;font-weight:800;font-size:14px;line-height:1.5}
    .runner-hint{position:absolute;top:24%;left:50%;transform:translateX(-50%);width:min(90vw,390px);text-align:center;background:#102634db;border:1px solid #75dce9;border-radius:14px;padding:14px;font-weight:700;font-size:15px}
    .runner-hint[hidden]{display:none}
    .runner-controls{position:absolute;bottom:calc(20px + env(safe-area-inset-bottom));left:0;right:0;display:flex;justify-content:center;gap:14px;padding:0 12px}
    .runner-controls button{min-width:76px;min-height:68px!important;font-size:17px!important;background:#0c5068e8!important}
    @media(max-width:800px){#transform-controls{top:168px;right:10px;width:112px}#transform-controls button{font-size:11px;padding:8px 5px}.runner-controls button{flex:1;max-width:120px}}
    @media(max-height:500px){#transform-controls{top:108px}.runner-hint{top:17%}.runner-controls{bottom:8px}.runner-controls button{min-height:52px!important}}
  `;
  document.head.appendChild(modeStyle);
  mainViewport.insertAdjacentHTML('beforeend', `
    <div id="transform-controls" role="group" aria-label="Transformers mode">
      <button id="transform-button" type="button" aria-pressed="false">⚙ Transformers · Car</button>
      <button id="runner-entry" type="button" hidden>Truck Run ↗</button>
    </div>
    <div id="runner-ui" hidden>
      <div class="runner-top"><div class="runner-stats" aria-live="polite"><div>TRUCK RUN · ROBOT</div><div id="runner-score">0 m · 0 rescued</div><div id="runner-lives">♥ ♥ ♥</div></div><button id="runner-exit" type="button">↩ Return to world</button></div>
      <div class="runner-hint" id="runner-hint">Jump onto truck roofs and meet the blonde adults.<br>← → change lanes · Space / ↑ jump</div>
      <div class="runner-controls" role="group" aria-label="Truck run controls"><button type="button" data-runner-action="left" aria-label="Move left">←</button><button type="button" data-runner-action="jump" aria-label="Jump">JUMP</button><button type="button" data-runner-action="right" aria-label="Move right">→</button></div>
    </div>`);
  const transformButton=document.getElementById('transform-button');
  const runnerEntry=document.getElementById('runner-entry');
  const runnerUi=document.getElementById('runner-ui');
  const runnerHint=document.getElementById('runner-hint');
  const runnerScore=document.getElementById('runner-score');
  const runnerLives=document.getElementById('runner-lives');
  const worldRobot=createRobotModel(visualizer.currentColor);
  worldRobot.visible=false;
  visualizer.scene.add(worldRobot);
  const robotJump=new RobotJump();
  const spaceButton=document.querySelector('[data-drive-key="Space"]');
  let robotMode=false,runnerActive=false,runnerGame=null,runnerView=null,hintTimer=0;
  const setRobotMode=enabled=>{
    robotMode=enabled;
    robotJump.reset();
    worldRobot.visible=enabled;
    visualizer.carGroup.visible=!enabled;
    transformButton.setAttribute('aria-pressed',String(enabled));
    transformButton.textContent=enabled?'⚙ Transformers · Robot':'⚙ Transformers · Car';
    runnerEntry.hidden=!enabled;
    spaceButton.textContent=enabled?'ZIPLA':'EL FRENİ';
    spaceButton.setAttribute('aria-label',enabled?'Jump robot':'Handbrake');
    physics.speed=0;
    driveInput.clear();
  };
  transformButton.addEventListener('click',()=>{
    if(visualizer.previewActive)return;
    setRobotMode(!robotMode);
  });
  const runnerAction=action=>{
    if(!runnerActive)return;
    if(runnerGame.over){runnerGame.reset();runnerHint.hidden=true;return;}
    if(action==='left')runnerGame.move(-1);
    if(action==='right')runnerGame.move(1);
    if(action==='jump')runnerGame.jump();
  };
  runnerEntry.addEventListener('click',()=>{
    if(!robotMode||visualizer.previewActive)return;
    robotJump.reset();
    driveInput.clear();releaseNitro();stopHorn();physics.speed=0;
    setSidebarOpen(false);setSettingsOpen(false);setDynamicsOpen(false);
    runnerGame=new RunnerGame();
    runnerView??=new RobotRunnerView(visualizer.renderer,canvasContainer,visualizer.currentColor);
    runnerView.reset();
    runnerActive=true;runnerUi.hidden=false;mainViewport.classList.add('runner-active');
    runnerHint.hidden=false;runnerHint.textContent='Jump onto truck roofs and meet the blonde adults. ← → change lanes · Space / ↑ jump';
    hintTimer=3.5;
    audio.update(800,0,0,false,{model:physics.bmwModel,gear:1});
  });
  const exitRunner=()=>{
    runnerActive=false;runnerUi.hidden=true;mainViewport.classList.remove('runner-active');
    robotJump.reset();
    driveInput.clear();lastTime=performance.now();
  };
  document.getElementById('runner-exit').addEventListener('click',exitRunner);
  document.querySelectorAll('[data-runner-action]').forEach(button=>button.addEventListener('pointerdown',event=>{
    event.preventDefault();runnerAction(button.dataset.runnerAction);
  }));
  window.addEventListener('keydown',event=>{
    if(!runnerActive)return;
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();exitRunner();return;}
    const action=event.code==='ArrowLeft'||event.code==='KeyA'?'left':event.code==='ArrowRight'||event.code==='KeyD'?'right':event.code==='Space'||event.code==='ArrowUp'||event.code==='KeyW'?'jump':null;
    if(action){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)runnerAction(action);}
  },true);
  window.addEventListener('keyup',event=>{
    if(runnerActive&&['ArrowLeft','ArrowRight','ArrowUp','KeyA','KeyD','KeyW','Space'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  let swipeStart=null;
  visualizer.renderer.domElement.addEventListener('pointerdown',event=>{if(runnerActive)swipeStart={x:event.clientX,y:event.clientY};});
  visualizer.renderer.domElement.addEventListener('pointerup',event=>{
    if(!runnerActive||!swipeStart)return;
    const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;
    if(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy))runnerAction(dx<0?'left':'right');
    else if(dy< -30)runnerAction('jump');
    swipeStart=null;
  });

  let lastTime = performance.now();
  let syncTimer = 0;
  let routeTimer = 0;

  function gameLoop(currentTime) {
    const dt = Math.min(0.1, (currentTime - lastTime) / 1000);
    lastTime = currentTime;

    if(runnerActive){
      runnerGame.update(dt);
      runnerView.update(runnerGame,dt);
      runnerScore.textContent=`${Math.floor(runnerGame.distance)} m · ${runnerGame.collected} met`;
      runnerLives.textContent='♥ '.repeat(runnerGame.lives).trim()||'No hearts';
      if(runnerGame.over){runnerHint.hidden=false;runnerHint.textContent='Run over · tap a control to restart';}
      else if(hintTimer>0){hintTimer-=dt;if(hintTimer<=0)runnerHint.hidden=true;}
      requestAnimationFrame(gameLoop);
      return;
    }

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
    for (const car of trafficManager.cars) car.group.visible = !visualizer.previewActive;
    if (!visualizer.previewActive) trafficManager.update(dt, physics);
    if (visualizer.highBeams && !visualizer.previewActive) pedestrians.highBeam(physics);
    pedestrianView.update(pedestrians, physics, visualizer.carGroup, visualizer.previewActive);
    const clinging = pedestrians.people.filter(person => person.state === 'clinging').length;
    const occupancy = `Kişi: ${pedestrians.passengers + 1}/${seatCapacity(physics.bmwModel)}${clinging ? ` · Tutunan: ${clinging}` : ' · Sürücü dahil'}`;
    const passengerHud = document.getElementById('hud-passengers');
    if (passengerHud.textContent !== occupancy) passengerHud.textContent = occupancy;
    const passengerStatus = document.getElementById('passenger-status');
    if (passengerStatus.textContent !== pedestrians.message) passengerStatus.textContent = pedestrians.message;
    worldRobot.visible=robotMode&&!visualizer.previewActive;
    if(robotMode)robotJump.update(dt);
    worldRobot.position.set(0,(physics.roadHeight??.08)+robotJump.height,0);
    worldRobot.rotation.y=Math.PI-(physics.heading+(physics.driftAngle??0));
    if(robotMode)animateRobot(worldRobot,{dt,speed:Math.abs(physics.speed)/3.6,grounded:robotJump.height<=0,verticalVelocity:robotJump.velocity,lateral:physics.steering??0});
    visualizer.cameraLift=robotMode?robotJump.height:0;
    visualizer.carGroup.visible=!robotMode;
    visualizer.update(physics, dt);

    const headingDeg = (physics.heading * 180) / Math.PI;
    mapController.updateCarPosition(physics.lat, physics.lng, headingDeg);

    audio.update(physics.rpm, physics.throttle, physics.speed, physics.isDrifting, {model:physics.bmwModel,gear:physics.gear,slip:physics.driftFactor,brake:physics.handbrake || (physics.throttle < 0 && physics.speed > 0)});
    if (physics.nitroEngaged && physics.bmwModel !== 'i4 M50 (EV)') {
      visualizer.triggerExhaustFlames();
    }
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
    hudGear.innerText = physics.driveGear === 'auto' ?
      (physics.bmwModel === 'i4 M50 (EV)' ? 'D' : physics.gear) :
      (physics.driveGear === 'D' && physics.bmwModel !== 'i4 M50 (EV)' ? `D${physics.gear}` : physics.driveGear);
    document.getElementById('hud-drive-mode').textContent = physics.driveMode;
    document.getElementById('hud-dsc').textContent = physics.dscMode;
    const nitroMeter = document.getElementById('hud-nitro-meter');
    const charge = Math.round(physics.nitroCharge * 100);
    nitroMeter.style.background = `linear-gradient(90deg,#58dfff ${charge}%,#364957 ${charge}%)`;
    nitroButton.disabled = physics.nitroDepleted;
    if (nitroButton.disabled) releaseNitro();

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
