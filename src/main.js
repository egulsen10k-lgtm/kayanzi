import {nearbyCasino} from './casino-locations.js';
import { CasinoRoom } from './katlayanzi-room.js';
import { mountKatlayanzi } from './katlayanzi-ui.js';
import { Pedestrians, seatCapacity } from './pedestrians.js';
import { PedestrianView } from './pedestrian-view.js';
import { TrafficManager } from './traffic.js';
import { bindTiltInput } from './tilt-input.js';
import { bindDrivingInput, GamepadInput, updateWithGamepad } from './driving-input.js';
import { PauseState } from './pause-state.js';
import { bindSteeringWheelInput } from './steering-wheel-input.js';
import { assetUrl } from './resource-urls.js';
import { CarPhysics } from './physics.js';
import { CarAudio } from './audio.js';
import { CarVisualizer3D, roadNetworkHasEdges } from './visualizer.js';
import { WorldMapController } from './map.js';
import { nearestRoadSpawn, footprintOnRoad } from './road-safety.js';
import { projectCoordinate } from './road-network.js';
import { createRouteGuide } from './route-guide.js';
import { setWorldRoute } from './world-data.js';
import { RunnerGame } from './runner-game.js';
import { createRobotModel, RobotRunnerView } from './robot-runner-view.js';
import { animateRobot } from './robot-animation.js';
import { RobotJump } from './robot-jump.js';
import { ShortCodeMultiplayerSession } from './multiplayer-short-code.js';
import { mountMultiplayerUI, mountPlayerCountChip } from './multiplayer-ui.js';
import { NpcSync, serializeNpcs, applyNpcs } from './npc-sync.js';

document.addEventListener('DOMContentLoaded', () => {
  const peerId = 'driver-' + Math.random().toString(36).substring(2, 8);
  const physics = new CarPhysics(peerId);
  const audio = new CarAudio();
  physics.onPeerImpact = ({ relativeSpeed = 0 } = {}) => audio.triggerImpact(Math.min(100, Math.max(8, relativeSpeed * 3.6)));
  const canvasContainer = document.getElementById('render-canvas-container');
  const visualizer = new CarVisualizer3D(canvasContainer);
  audio.setRemoteVoiceCap?.(visualizer.remoteVoiceCap);
  const pedestrians = new Pedestrians();
  const trafficManager = new TrafficManager(visualizer.trafficGroup ?? visualizer.scene, {camera:visualizer.camera});
  let npcSync;

  const pedestrianView = new PedestrianView(visualizer.scene);
  const startHorn = () => {
    audio.startHorn();
    if (!visualizer.previewActive && !npcSync?.isFollower) pedestrians.horn(physics);
  };
  const stopHorn = () => audio.stopHorn();
  let routeGuide = null;
  let routeGeneration = 0;
  let routeCompletionShown=false;
  let trafficHornCooldown=0;
  function endRoute() {
    routeGeneration++;
    routeGuide = null;
    setWorldRoute(null);
    visualizer.routeData = null;
    visualizer.roadCache.clear();
    mapController.setRoute(null);
    document.getElementById('akanzi-hud').hidden = true;
    document.getElementById('akanzi-end').hidden = true;
    document.getElementById('akanzi-completion').hidden=true;routeCompletionShown=false;
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

  const driveStatusBanner = document.getElementById('drive-status-banner');
  let driveStatusTimer;
  const showDriveStatus = message => {
    if (!driveStatusBanner || !message) return;
    driveStatusBanner.textContent = message;
    driveStatusBanner.hidden = false;
    clearTimeout(driveStatusTimer);
    driveStatusTimer = setTimeout(() => { driveStatusBanner.hidden = true; }, 3200);
  };

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
        showDriveStatus(physics.roadNetwork ? 'Loading the next mapped district…' : 'Loading mapped roads…');
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
          mapController.addFuelStations(network);
          if (!npcSync?.isFollower && pedestrians.network !== network) {
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
        showDriveStatus(detail.message || 'Road data unavailable · retrying safely');
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

  let casinoRoom;
  let casinoOpen = false;
  let multiplayerUI;
  let multiplayerPanelOpen = false;
  let mobileMenuOpen = false;
  window.addEventListener('multiplayerpanelchange', ({ detail }) => {
    multiplayerPanelOpen = Boolean(detail?.open);
  });
  const multiplayer = new ShortCodeMultiplayerSession({
    getState: () => ({ ...physics.serializeState(), robot: robotMode }),
    onPeerState: (state) => {
      visualizer.updatePeerCar(state);
      mapController.updatePeerPosition(state);
    },
    onPeerLeave: (id) => {
      visualizer.removePeerCar(id);
      mapController.removePeerPosition(id);
    },
    onStatus: (status) => multiplayerUI?.updateStatus(status),
    onCasino: packet => casinoRoom?.receive(packet),
    onLatency: latency => multiplayerUI?.updateLatency(latency),
    onPeers: (peers) => multiplayerUI?.updatePeers(peers),
    getNpcs: () => serializeNpcs({ pedestrians, traffic: trafficManager }),
    onNpcs: (snapshot) => applyNpcs(snapshot, { pedestrians, traffic: trafficManager }),
    onWorldAuthority: () => npcSync?.syncRole(physics),
    onChat: ({ name, text }) => showChatBubble(name, text)
  });
  npcSync = new NpcSync({ session: multiplayer, trafficManager, pedestrians, pedestrianView, scene: visualizer.scene });
  multiplayerUI = mountMultiplayerUI({
    session: multiplayer,
    getState: () => ({ ...physics.serializeState(), robot: robotMode }),
    onJoinPeer: (state) => {
      if (!state || !Number.isFinite(state.lat) || !Number.isFinite(state.lng)) return;
      endRoute();
      physics.teleport(state.lat, state.lng);
      physics.heading = state.heading;
      physics.roadHeight = state.roadHeight ?? 0;
      mapController.teleport(state.lat, state.lng);
      document.getElementById('hud-location-name').textContent = 'Meeting another driver';
      visualizer.loadRoadsAt(state.lat, state.lng).catch(() => {});
    }
  });
  const playerCountChip = mountPlayerCountChip(
    document.getElementById('hud-player-count'), multiplayer
  );
  window.addEventListener('pagehide', () => {
    playerCountChip.destroy();
    multiplayer.leave();
  });

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
  const pedestrianDensityInput=document.getElementById('pedestrian-density');
  const pedestrianDensityValue=document.getElementById('pedestrian-density-value');
  let savedPedDensity=null;try{const rawPedDensity=localStorage.getItem('bmw-ped-density');if(rawPedDensity!==null)savedPedDensity=Number(rawPedDensity);}catch{}
  const initialPedDensity=Number.isFinite(savedPedDensity)&&savedPedDensity>=0&&savedPedDensity<=2?savedPedDensity:1;
  pedestrians.setDensity(initialPedDensity);
  if(pedestrianDensityInput)pedestrianDensityInput.value=String(initialPedDensity);
  if(pedestrianDensityValue)pedestrianDensityValue.value=initialPedDensity.toFixed(2);
  pedestrianDensityInput?.addEventListener('input',event=>{
    const value=pedestrians.setDensity(Number(event.target.value));
    if(pedestrianDensityValue)pedestrianDensityValue.value=value.toFixed(2);
    try{localStorage.setItem('bmw-ped-density',String(value));}catch{}
  });
  const nightToggle = document.getElementById('night-mode');
  const beamsToggle = document.getElementById('high-beams');
  densitySelect?.addEventListener('change', e => {
    if (npcSync.isFollower) return;
    const density = Number(e.target.value);
    trafficManager.setDensity(density, physics);
  });
  nightToggle?.addEventListener('change', e => visualizer.setNightMode(e.target.checked));
  beamsToggle?.addEventListener('change', e => visualizer.setHighBeams(e.target.checked));

  // Weather cycle button
  let _weatherIndex = 0;
  const _weatherStates = ['clear', 'rain', 'fog'];
  const _weatherLabels = ['☀ Clear', '🌧 Rain', '🌫 Fog'];
  const weatherBtn = document.getElementById('weather-cycle-btn');
  const applyWeather = () => {
    const type = _weatherStates[_weatherIndex];
    visualizer.setWeather(type);
    physics.setWeatherGrip(visualizer.weatherGrip);
    if (weatherBtn) weatherBtn.textContent = _weatherLabels[_weatherIndex];
  };
  weatherBtn?.addEventListener('click', () => { _weatherIndex = (_weatherIndex + 1) % _weatherStates.length; applyWeather(); });

  // Time-of-day cycle button
  let autoDay = false;
  let gameHour = 14;
  const _timeStates = ['day', 'night', 'auto'];
  let _timeIndex = 0;
  const timeBtn = document.getElementById('time-cycle-btn');
  const applyTime = () => {
    if (_timeStates[_timeIndex] === 'day') { autoDay = false; gameHour = 12; visualizer.setTimeOfDay(12); if (timeBtn) timeBtn.textContent = '☀ Day'; }
    else if (_timeStates[_timeIndex] === 'night') { autoDay = false; gameHour = 22; visualizer.setTimeOfDay(22); if (timeBtn) timeBtn.textContent = '🌙 Night'; }
    else { autoDay = true; if (timeBtn) timeBtn.textContent = '⏱ Auto'; }
  };
  timeBtn?.addEventListener('click', () => { _timeIndex = (_timeIndex + 1) % _timeStates.length; applyTime(); });

  // Camera cycle button
  const _cameraModes = ['chase', 'hood', 'cockpit', 'reverse', 'wide', 'aerial', 'cinematic', 'bonnet'];
  const _cameraLabels = ['📷 Chase', '📷 Hood', '📷 Cockpit', '📷 Reverse', '📷 Wide', '📷 Aerial', '📷 Cinematic', '📷 Bonnet'];
  let _cameraIndex = 0;
  const camCycleBtn = document.getElementById('camera-cycle-btn');
  const cycleCamera = direction => {
    _cameraIndex = (_cameraIndex + direction + _cameraModes.length) % _cameraModes.length;
    visualizer.setCameraMode(_cameraModes[_cameraIndex]);
    if (camCycleBtn) camCycleBtn.textContent = _cameraLabels[_cameraIndex];
    document.querySelectorAll('[data-camera-mode]').forEach(button=>{
      const selected=button.dataset.cameraMode===_cameraModes[_cameraIndex];
      button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
    });
  };
  camCycleBtn?.addEventListener('click', () => cycleCamera(1));
  const controllerStatus=document.getElementById('controller-status');
  let controllerStatusTimer=0;
  const gamepadInput=new GamepadInput({
    onConnectionChange:connected=>{
      clearTimeout(controllerStatusTimer);
      controllerStatus.hidden=!connected;
      if(connected)controllerStatusTimer=setTimeout(()=>{controllerStatus.hidden=true;},3000);
    },
    onHornStart:()=>{if(!runnerActive)startHorn();},
    onHornEnd:()=>stopHorn(),
    onCameraCycle:direction=>{if(!runnerActive)cycleCamera(direction);}
  });
  let gamepadState=gamepadInput.state;

  const onboardingHint = document.getElementById('onboarding-hint');
  const onboardingText = document.getElementById('onboarding-hint-text');
  const onboardingNext = document.getElementById('onboarding-hint-next');
  const onboardingDismiss = document.getElementById('onboarding-hint-dismiss');
  const onboardingSteps = ['Accelerate with W or ↑, or use the gas pedal.', 'Steer with A/D or ←/→ and follow the road.', 'Press Shift or N for nitro; Space uses the handbrake.'];
  let onboardingIndex = 0;
  let onboardingDismissed = false;
  try { onboardingDismissed = localStorage.getItem('bmw-onboarding-dismissed') === '1'; } catch {}
  const showOnboarding = () => {
    if (onboardingDismissed || visualizer.previewActive || runnerActive || !onboardingHint) return;
    onboardingText.textContent = onboardingSteps[onboardingIndex];
    onboardingNext.textContent = onboardingIndex === onboardingSteps.length - 1 ? 'Done' : 'Next';
    onboardingHint.hidden = false;
  };
  const hideOnboarding = persist => {
    onboardingHint.hidden = true;
    if (persist) { onboardingDismissed = true; try { localStorage.setItem('bmw-onboarding-dismissed', '1'); } catch {} }
  };
  onboardingNext?.addEventListener('click', () => {
    if (onboardingIndex >= onboardingSteps.length - 1) hideOnboarding(true);
    else { onboardingIndex++; showOnboarding(); }
  });
  onboardingDismiss?.addEventListener('click', () => hideOnboarding(true));

  startBtn.addEventListener('click', () => {
    audio.init();
    if (!npcSync.isFollower) trafficManager.setDensity(Number(densitySelect?.value ?? 1), physics);
    audio.triggerExhaustPop();
    startOverlay.style.opacity = '0';
    setTimeout(() => {
      startOverlay.style.display = 'none';
      showOnboarding();
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
    if (!enabled) visualizer.introActive = false;
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
      routeTimer=0;
      routeCompletionShown=false;document.getElementById('akanzi-completion').hidden=true;
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
  document.getElementById('akanzi-drive-again').addEventListener('click',async()=>{
    if(!routeGuide?.restart){document.getElementById('akanzi-completion').hidden=true;document.getElementById('akanzi-start').click();return;}
    const guide=routeGuide,start=guide.data.stops[0];guide.restart();routeTimer=0;routeCompletionShown=false;
    document.getElementById('akanzi-completion').hidden=true;
    physics.teleport(start.lat,start.lng);mapController.teleport(start.lat,start.lng);
    const next=guide.data.coordinates[1],offset=projectCoordinate(next[1],next[0],start);
    physics.heading=Math.atan2(offset[0],offset[1]);
    document.getElementById('akanzi-progress').textContent='Akanzi · Ready';
    document.getElementById('akanzi-next').textContent=`Next: ${guide.data.stops[1]?.name??'Pendik Sahil'}`;
    await visualizer.loadRoadsAt(start.lat,start.lng).catch(()=>{});
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
    {normal:'Normal',sport:'Sport','sport-plus':'Sport+'});
  bindDynamicsSelect('brake-feel-select', value => physics.setBrakeMode(value),
    {comfort:'Comfort',sport:'Sport'});
  bindDynamicsSelect('suspension-select', value => physics.setSuspensionMode(value),
    {comfort:'Comfort',sport:'Sport'});
  bindDynamicsSelect('dsc-mode-select', value => physics.setDscMode(value),
    {on:'On',traction:'Traction',off:'Off'});
  const driveModeSelect = document.getElementById('drive-mode-select');
  const dscModeSelect = document.getElementById('dsc-mode-select');
  const driveModeButtons = [...document.querySelectorAll('[data-drive-mode]')];
  const mobileDscButton = document.getElementById('mobile-dsc-button');
  const syncDynamicsButtons = () => {
    driveModeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.driveMode === driveModeSelect.value)));
    const label = dscModeSelect.selectedOptions[0].textContent;
    mobileDscButton.textContent = `DSC ${label.toUpperCase()}`;
    mobileDscButton.setAttribute('aria-label', `Stability control ${label}; tap to change`);
    mobileDscButton.setAttribute('aria-pressed', String(dscModeSelect.value !== 'off'));
  };
  driveModeSelect.addEventListener('change', syncDynamicsButtons);
  dscModeSelect.addEventListener('change', syncDynamicsButtons);
  driveModeButtons.forEach(button => button.addEventListener('click', () => {
    driveModeSelect.value = button.dataset.driveMode;
    driveModeSelect.dispatchEvent(new Event('change', { bubbles:true }));
  }));
  mobileDscButton.addEventListener('click', () => {
    const modes = ['on', 'traction', 'off'];
    dscModeSelect.value = modes[(modes.indexOf(dscModeSelect.value) + 1) % modes.length];
    dscModeSelect.dispatchEvent(new Event('change', { bubbles:true }));
  });
  syncDynamicsButtons();

  const gearButtons = [...document.querySelectorAll('[data-gear]')];
  const gearShiftStatus = document.getElementById('gear-shift-status');
  const transmissionSelect = document.getElementById('transmission-select');
  const transmissionStatus = document.getElementById('transmission-status');
  let gearStatusTimer;
  const syncGearButtons = () => {
    gearButtons.forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.gear === physics.driveGear)));
    transmissionSelect.value = physics.driveGear;
  };
  syncGearButtons();
  const selectGear = gear => {
    clearTimeout(gearStatusTimer);
    if (!physics.setDriveGear(gear)) {
      gearShiftStatus.textContent = 'Slow down to shift';
      gearShiftStatus.hidden = false;
      transmissionStatus.textContent = 'Slow down to shift';
      gearStatusTimer = setTimeout(() => {
        gearShiftStatus.textContent = '';
        gearShiftStatus.hidden = true;
        transmissionStatus.textContent = '';
      }, 2200);
      syncGearButtons();
      return;
    }
    gearShiftStatus.textContent = '';
    gearShiftStatus.hidden = true;
    transmissionStatus.textContent = '';
    syncGearButtons();
  };
  gearButtons.forEach(button => button.addEventListener('click', () => selectGear(button.dataset.gear)));
  transmissionSelect.addEventListener('change', () => selectGear(transmissionSelect.value));
  const refuelButton=document.getElementById('refuel-button');
  refuelButton.addEventListener('click',()=>physics.energy.refuel(physics.speed));
  settingsToggle.addEventListener('click', () => {
    if (!settingsPanel.hidden) setDynamicsOpen(false);
  });

  const nitroButton = document.getElementById('nitro-button');
  const nitroSources = new Set();
  const syncNitro = () => {
    const active = nitroSources.size > 0 && !nitroButton.disabled;
    if (active) physics.activateNitro();
    else physics.setNitroActive(false);
    nitroButton.setAttribute('aria-pressed', String(active && physics.nitroActive));
  };
  const releaseNitro = () => {
    nitroSources.clear();
    syncNitro();
  };
  nitroButton.addEventListener('pointerdown', event => {
    if (nitroButton.disabled) return;
    event.preventDefault();
    nitroButton.setPointerCapture(event.pointerId);
    nitroSources.add(`pointer-${event.pointerId}`);
    syncNitro();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture'])
    nitroButton.addEventListener(type, event => {
      nitroSources.delete(`pointer-${event.pointerId}`);
      syncNitro();
    });
  window.addEventListener('keydown', event => {
    if (event.code === 'KeyN') {
      const active = document.activeElement;
      if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) return;
      event.preventDefault();
      physics.activateNitro();
      return;
    }
    if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') return;
    const active = document.activeElement;
    if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) return;
    event.preventDefault();
    nitroSources.add(event.code);
    syncNitro();
  });
  window.addEventListener('keyup', event => {
    if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') return;
    nitroSources.delete(event.code);
    syncNitro();
  });
  window.addEventListener('blur', releaseNitro);
  window.addEventListener('multiplayerpanelchange', ({ detail }) => {
    multiplayerPanelOpen = Boolean(detail?.open);
    driveInput.clear();
    releaseNitro();
    physics.throttle = 0;
    if (multiplayerPanelOpen) physics.speed = 0;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseNitro(); });

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

  const qualitySelect = document.getElementById('quality-tier');
  const performanceStatus = document.getElementById('performance-status');
  const cameraShakeToggle = document.getElementById('camera-shake-toggle');
  const applyQuality = tier => {
    const selected = visualizer.setQualityTier(tier);
    audio.setRemoteVoiceCap?.(visualizer.remoteVoiceCap);
    if (qualitySelect && qualitySelect.value !== selected) qualitySelect.value = selected;
    if (performanceStatus) {
      performanceStatus.textContent = `Graphics: ${selected[0].toUpperCase()}${selected.slice(1)}`;
      performanceStatus.hidden = false;
      clearTimeout(applyQuality.timer);
      applyQuality.timer = setTimeout(() => { performanceStatus.hidden = true; }, 1800);
    }
  };
  qualitySelect?.addEventListener('change', event => applyQuality(event.currentTarget.value));
  cameraShakeToggle?.addEventListener('change', event => visualizer.setCameraShakeEnabled(event.currentTarget.checked));

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
  document.getElementById('minimap-zoom-in')?.addEventListener('click', () => {
    mapController.setMinimapZoom(mapController.minimapZoom + .5);
  });
  document.getElementById('minimap-zoom-out')?.addEventListener('click', () => {
    mapController.setMinimapZoom(mapController.minimapZoom - .5);
  });

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
  const drivingAssist = document.getElementById('hud-driving-assist');
  let assistTickCooldown = 0;

  const driftToast = document.createElement('div');
  driftToast.id = 'drift-toast';
  Object.assign(driftToast.style, {
    position:'absolute', bottom:'88px', left:'50%', transform:'translateX(-50%)',
    background:'#102634dc', border:'1px solid #75dce9', borderRadius:'12px',
    color:'white', font:'700 13px system-ui', padding:'8px 18px',
    pointerEvents:'none', zIndex:'25', opacity:'0', transition:'opacity .25s'
  });
  driftToast.setAttribute('role','status');driftToast.setAttribute('aria-live','polite');
  document.getElementById('main-viewport')?.appendChild(driftToast);
  let driftToastTimer = 0;

  const stopToast = document.createElement('div');
  stopToast.id = 'stop-toast';
  stopToast.setAttribute('role', 'status');
  stopToast.setAttribute('aria-live', 'polite');
  Object.assign(stopToast.style, {
    position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'#102634ee', border:'1px solid #75dce9', borderRadius:'16px',
    color:'white', font:'700 16px system-ui', padding:'12px 28px',
    pointerEvents:'none', zIndex:'26', opacity:'0', transition:'opacity .3s',
    textAlign:'center', whiteSpace:'nowrap', boxShadow:'0 8px 24px #0009'
  });
  document.getElementById('main-viewport')?.appendChild(stopToast);
  let stopToastTimer = 0;

  const chatBubbles = [];
  function showChatBubble(name, text) {
    const bubble = document.createElement('div');
    bubble.textContent = `${String(name || 'Driver').slice(0,24)}: ${String(text).slice(0,60)}`;
    Object.assign(bubble.style, { position:'absolute', top:`${72 + chatBubbles.length * 42}px`, right:'14px', zIndex:'26', background:'#102634dc', border:'1px solid #75dce9', borderRadius:'12px', color:'white', font:'700 12px system-ui', padding:'8px 12px', maxWidth:'260px' });
    bubble.setAttribute('role','status');
    bubble.setAttribute('aria-live','polite');
    document.getElementById('main-viewport')?.appendChild(bubble);
    chatBubbles.push(bubble);
    while (chatBubbles.length > 3) chatBubbles.shift()?.remove();
    setTimeout(() => { bubble.remove(); const index=chatBubbles.indexOf(bubble); if(index>=0) chatBubbles.splice(index,1); }, 4000);
  }
  const boardToast = document.createElement('div');
  Object.assign(boardToast.style, { position:'absolute', top:'72px', left:'50%', transform:'translateX(-50%)', zIndex:'25', background:'#102634dc', border:'1px solid #75dce9', borderRadius:'12px', color:'white', font:'700 13px system-ui', padding:'8px 16px', opacity:'0', transition:'opacity .25s', pointerEvents:'none' });
  boardToast.setAttribute('role','status');
  boardToast.setAttribute('aria-live','polite');
  document.getElementById('main-viewport')?.appendChild(boardToast);
  let boardToastTimer = 0;

  const mainViewport = document.getElementById('main-viewport');
  const modeStyle = document.createElement('style');
  modeStyle.textContent = `
    #transform-controls{position:absolute;right:12px;top:158px;z-index:18;display:grid;gap:7px;width:146px}
    #transform-controls button,#runner-ui button{border:1px solid #75dce9;border-radius:12px;background:#102634e8;color:white;font:700 12px system-ui;padding:11px 9px;cursor:pointer;box-shadow:0 6px 18px #0007;touch-action:manipulation}
    #transform-controls button[aria-pressed="true"]{background:#136384;border-color:#a5f5ff}
    #transform-controls button[hidden]{display:none}
    #runner-ui[hidden]{display:none}
    #main-viewport.runner-active > :not(#render-canvas-container):not(#runner-ui):not(#mobile-drive-menu):not(#mobile-drive-menu-toggle){display:none!important}
    #runner-ui{position:absolute;inset:0;z-index:30;pointer-events:none;color:white;font-family:system-ui}
    #runner-ui button{pointer-events:auto;min-height:48px}
    .runner-top{display:flex;align-items:start;justify-content:space-between;gap:10px;padding:max(12px,env(safe-area-inset-top)) 12px 0}
    .runner-stats{background:#102634dc;border:1px solid #75dce9;border-radius:12px;padding:10px 13px;font-weight:800;font-size:14px;line-height:1.5}
    .runner-hint{position:absolute;top:24%;left:50%;transform:translateX(-50%);width:min(90vw,390px);text-align:center;background:#102634db;border:1px solid #75dce9;border-radius:14px;padding:14px;font-weight:700;font-size:15px}
    .runner-hint[hidden]{display:none}
    .runner-controls{position:absolute;bottom:calc(20px + env(safe-area-inset-bottom));left:0;right:0;display:flex;justify-content:center;gap:14px;padding:0 12px}
    .runner-controls button{min-width:76px;min-height:68px!important;font-size:17px!important;background:#0c5068e8!important}
    .runner-trick-toast{position:absolute;left:50%;bottom:calc(112px + env(safe-area-inset-bottom));transform:translateX(-50%);padding:10px 18px;border:1px solid #75dce9;border-radius:12px;background:#102634dc;color:white;font:800 15px system-ui;box-shadow:0 8px 24px #0007;opacity:0;transition:opacity .2s}
    .runner-trick-toast[hidden]{display:none}
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
      <div id="runner-trick-toast" class="runner-trick-toast" role="status" aria-live="polite" hidden></div>
      <div class="runner-controls" role="group" aria-label="Truck run controls"><button type="button" data-runner-action="left" aria-label="Move left">←</button><button type="button" data-runner-action="jump" aria-label="Jump">JUMP</button><button type="button" data-runner-action="right" aria-label="Move right">→</button></div>
    </div>`);
  const transformButton=document.getElementById('transform-button');
  const runnerEntry=document.getElementById('runner-entry');
  const runnerUi=document.getElementById('runner-ui');
  const runnerHint=document.getElementById('runner-hint');
  const runnerScore=document.getElementById('runner-score');
  const runnerLives=document.getElementById('runner-lives');
  const runnerTrickToast=document.getElementById('runner-trick-toast');
  const worldRobot=createRobotModel(visualizer.currentColor);
  worldRobot.visible=false;
  visualizer.scene.add(worldRobot);
  const robotJump=new RobotJump();
  const spaceButton=document.querySelector('[data-drive-key="Space"]');
  let robotMode=false,runnerActive=false,runnerGame=null,runnerView=null,hintTimer=0,runnerTrickToastTimer=0;
  const hudGearChip=document.getElementById('hud-gear-chip');
  let lastHudGearKey=null;
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
    if(!runnerActive || multiplayerPanelOpen || mobileMenuOpen || casinoOpen)return;
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
    runnerActive=true;runnerUi.hidden=false;mainViewport.classList.add('runner-active');hudGearChip.hidden=true;pauseToggle.hidden=true;hideOnboarding(false);
    runnerHint.hidden=false;runnerHint.textContent='Jump onto truck roofs and meet the blonde adults. ← → change lanes · Space / ↑ jump';
    hintTimer=3.5;
    audio.update(800,0,0,false,{model:physics.bmwModel,gear:1});
  });
  const exitRunner=()=>{
    runnerActive=false;runnerUi.hidden=true;mainViewport.classList.remove('runner-active');pauseToggle.hidden=false;showOnboarding();
    hudGearChip.hidden=false;
    robotJump.reset();
    driveInput.clear();lastTime=performance.now();
    visualizer.introActive=false;
  };
  document.getElementById('runner-exit').addEventListener('click',exitRunner);
  const pauseOverlay=document.getElementById('pause-overlay');
  const pauseToggle=document.getElementById('pause-toggle');
  const pauseResume=document.getElementById('pause-resume');
  const pauseState=new PauseState(paused=>{
    pauseOverlay.hidden=!paused;
    pauseOverlay.inert=!paused;
    pauseToggle.setAttribute('aria-pressed',String(paused));
    pauseToggle.setAttribute('aria-label',paused?'Resume driving':'Pause driving');
    pauseToggle.textContent=paused?'▶ Resume':'Ⅱ Pause';
    if(paused){
      driveInput.clear();releaseNitro();stopHorn();
      const now=audio.ctx?.currentTime??0;
      audio.engineGain?.gain.setTargetAtTime(0,now,.04);
      for(const voice of audio.remoteVoices.values())voice.gain.gain.setTargetAtTime(0,now,.04);
      pauseResume.focus();
    }else{
      syncTimer=0;lastTime=performance.now();
      multiplayer.sendState({...physics.serializeState(),robot:robotMode});
      pauseToggle.focus();
    }
  });
  const resumeWorld=()=>pauseState.set(false);
  pauseToggle.addEventListener('click',()=>{if(!runnerActive)pauseState.toggle();});
  pauseResume.addEventListener('click',resumeWorld);
  document.getElementById('pause-reset-road').addEventListener('click',()=>{
    document.getElementById('reset-road-btn')?.click();
    resumeWorld();
  });
  document.getElementById('pause-exit-menu').addEventListener('click',()=>{
    resumeWorld();
    driveInput.clear();physics.speed=0;
    multiplayer.sendState({...physics.serializeState(),robot:robotMode});
    startOverlay.style.display='flex';startOverlay.style.opacity='1';
  });
  window.addEventListener('keydown',event=>{
    const active = document.activeElement;
    const typing = active && (['INPUT','TEXTAREA','SELECT'].includes(active.tagName) || active.isContentEditable);
    if(event.code!=='Escape'||runnerActive||typing||multiplayerPanelOpen||casinoOpen)return;
    event.preventDefault();event.stopImmediatePropagation();pauseState.toggle();
  },true);
  document.querySelectorAll('[data-runner-action]').forEach(button=>button.addEventListener('pointerdown',event=>{
    event.preventDefault();runnerAction(button.dataset.runnerAction);
  }));
  window.addEventListener('keydown',event=>{
    if(!runnerActive || multiplayerPanelOpen || mobileMenuOpen || casinoOpen)return;
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();exitRunner();return;}
    const action=event.code==='ArrowLeft'||event.code==='KeyA'?'left':event.code==='ArrowRight'||event.code==='KeyD'?'right':event.code==='Space'||event.code==='ArrowUp'||event.code==='KeyW'?'jump':null;
    if(action){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)runnerAction(action);}
  },true);
  window.addEventListener('keyup',event=>{
    if(runnerActive&&!multiplayerPanelOpen&&!mobileMenuOpen&&!casinoOpen&&['ArrowLeft','ArrowRight','ArrowUp','KeyA','KeyD','KeyW','Space'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  let swipeStart=null;
  visualizer.renderer.domElement.addEventListener('pointerdown',event=>{if(runnerActive)swipeStart={x:event.clientX,y:event.clientY};});
  visualizer.renderer.domElement.addEventListener('pointerup',event=>{
    if(!runnerActive||!swipeStart)return;
    const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;
    if(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy)){
      runnerAction(dx<0?'left':'right');runnerGame?.trickInput(dx<0?'flip':'spin');
    }
    else if(dy< -30)runnerAction('jump');
    swipeStart=null;
  });

  // Reuse the actual controls in a thumb-reachable sheet, retaining their state
  // and listeners when switching between phone, tablet and desktop layouts.
  const mobileLayout = matchMedia('(max-width:900px), (any-pointer:coarse)');
  const mobileMenu = document.getElementById('mobile-drive-menu');
  const mobileMenuToggle = document.getElementById('mobile-drive-menu-toggle');
  const mobileMenuClose = document.getElementById('mobile-drive-menu-close');
  const mobileActions = document.getElementById('mobile-drive-actions');
  const mobileStatus = document.getElementById('mobile-drive-status');
  const locationCard = document.querySelector('.hud-overlay > .hud-card:nth-child(3)');
  const mobileControls = [sidebarToggle, dynamicsToggle, settingsToggle, songButton,
    document.getElementById('multiplayer-toggle'), document.getElementById('transform-controls')];
  const mobilePlacements = [...mobileControls, locationCard, nitroButton].filter(Boolean).map(element => {
    const anchor = document.createComment(`desktop position: ${element.id || 'location status'}`);
    element.before(anchor);
    return {element, anchor};
  });
  const desktopSettingsLabel = settingsToggle.textContent;
  const setMobileMenuOpen = (open, restoreFocus = true) => {
    mobileMenuOpen = Boolean(open && mobileLayout.matches);
    mobileMenu.hidden = !mobileMenuOpen;
    mobileMenuToggle.setAttribute('aria-expanded', String(mobileMenuOpen));
    driveInput.clear(); releaseNitro();
    if (mobileMenuOpen) {
      setSidebarOpen(false); setSettingsOpen(false); setDynamicsOpen(false);
      physics.speed = 0; physics.throttle = 0;
      mobileMenuClose.focus();
    } else if (restoreFocus && mobileMenu.contains(document.activeElement)) mobileMenuToggle.focus();
  };
  const applyMobileLayout = () => {
    setMobileMenuOpen(false);
    if (mobileLayout.matches) {
      for (const control of mobileControls) if (control) mobileActions.append(control);
      if (locationCard) mobileStatus.append(locationCard);
      mainViewport.append(nitroButton);
      settingsToggle.textContent = 'Controls';
    } else {
      for (const {element, anchor} of mobilePlacements) anchor.after(element);
      settingsToggle.textContent = desktopSettingsLabel;
    }
    requestAnimationFrame(() => mapController.map?.invalidateSize());
  };
  mobileMenuToggle.addEventListener('click', () => setMobileMenuOpen(!mobileMenuOpen));
  mobileMenuClose.addEventListener('click', () => setMobileMenuOpen(false));
  mobileMenu.addEventListener('click', event => { if (event.target === mobileMenu) setMobileMenuOpen(false); });
  mobileActions.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || [songButton, transformButton].includes(target)) return;
    setMobileMenuOpen(false, false);
    const closeTarget = target === sidebarToggle ? studioClose : target === dynamicsToggle ? document.getElementById('drive-dynamics-close') : target === settingsToggle ? settingsClose : null;
    closeTarget?.focus();
  });
  mobileMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setMobileMenuOpen(false); }
    if (event.key === 'Tab') {
      const controls = [...mobileMenu.querySelectorAll('button,a,input,select')].filter(element => !element.disabled && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    event.stopPropagation();
  });
  mobileMenu.addEventListener('keyup', event => event.stopPropagation());
  for (const closeButton of [studioClose, settingsClose, document.getElementById('drive-dynamics-close')]) {
    closeButton?.addEventListener('click', () => { if (mobileLayout.matches) mobileMenuToggle.focus(); });
  }
  window.addEventListener('multiplayerpanelchange', ({detail}) => {
    if (!detail?.open && mobileLayout.matches) mobileMenuToggle.focus();
  });
  mobileLayout.addEventListener('change', applyMobileLayout);
  applyMobileLayout();

  casinoRoom = new CasinoRoom({ session: multiplayer });
  const casinoAccess=()=>{
    if(runnerActive||visualizer.previewActive||!physics.roadNetwork?.center)return {allowed:false,distance:Infinity};
    return nearbyCasino(visualizer.casinoLocations,projectCoordinate(physics.lat,physics.lng,physics.roadNetwork.center),physics.roadHeight);
  };
  const casinoUI=mountKatlayanzi({ room: casinoRoom,canEnter:()=>casinoAccess().allowed });
  let casinoAccessTimer=0;
  window.addEventListener('katlayanzichange', ({detail}) => {
    casinoOpen = Boolean(detail?.open);
    driveInput.clear(); releaseNitro(); stopHorn();
    physics.speed = 0;
    const now=audio.ctx?.currentTime??0;
    audio.engineGain?.gain.setTargetAtTime(0,now,.04);
    for(const voice of audio.remoteVoices.values())voice.gain.gain.setTargetAtTime(0,now,.04);
    multiplayer.sendState({...physics.serializeState(),robot:robotMode});
  });
  window.addEventListener('keydown', event => {
    if(casinoOpen && ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyH','Space'].includes(event.code) &&
      !['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName) &&
      !(event.code==='Space' && event.target?.tagName==='BUTTON')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  },true);

  let lastTime = performance.now();
  let syncTimer = 0;
  let routeTimer = 0;
  let crowdScanTimer=1;
  let mapUpdateTimer = 0;
  let instrumentTimer = 0;
  let speedCamFlash = 0;
  let tickets = 0;
  let sparkSpawnTimer = 0;
  const speedCamBanner = document.createElement('div');
  Object.assign(speedCamBanner.style, {
    position:'fixed', top:'18px', left:'50%', transform:'translateX(-50%)',
    background:'#b00020', color:'#fff', fontWeight:'bold', fontSize:'15px',
    padding:'8px 20px', borderRadius:'6px', zIndex:'27', pointerEvents:'none',
    display:'none', whiteSpace:'nowrap'
  });
  speedCamBanner.setAttribute('role','alert');
  document.body.appendChild(speedCamBanner);
  const ticketChip = document.createElement('div');
  Object.assign(ticketChip.style, {
    position:'fixed', top:'18px', right:'80px',
    background:'rgba(0,0,0,.55)', color:'#fff', fontSize:'12px',
    padding:'4px 9px', borderRadius:'10px', zIndex:'27', pointerEvents:'none',
    display:'none'
  });
  document.body.appendChild(ticketChip);
  ticketChip.setAttribute('role','status');ticketChip.setAttribute('aria-live','polite');

  const stadiumDistance=()=>{
    const network=physics.roadNetwork;if(!network?.center)return 120;
    const point=projectCoordinate(physics.lat,physics.lng,network.center);if(!point)return 120;
    let nearest=120;
    for(const area of network.sceneryAreas??[]) {
      if(area.tags?.leisure!=='stadium'&&area.tags?.amenity!=='stadium')continue;
      const points=area.points??[];if(points.length<3)continue;
      let inside=false,min=Infinity;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const [xi,yi]=points[i],[xj,yj]=points[j];
        if((yi>point[1])!==(yj>point[1])&&point[0]<(xj-xi)*(point[1]-yi)/(yj-yi||1e-9)+xi)inside=!inside;
        const dx=xj-xi,dy=yj-yi,t=Math.max(0,Math.min(1,((point[0]-xi)*dx+(point[1]-yi)*dy)/(dx*dx+dy*dy||1)));
        min=Math.min(min,Math.hypot(point[0]-xi-dx*t,point[1]-yi-dy*t));
      }
      nearest=Math.min(nearest,inside?0:min);
      if(nearest===0)break;
    }
    return nearest;
  };

  function gameLoop(currentTime) {
    const dt = Math.min(0.1, (currentTime - lastTime) / 1000);
    lastTime = currentTime;
    casinoAccessTimer-=dt;
    if(casinoAccessTimer<=0){casinoAccessTimer=.2;casinoUI.setNearby(casinoAccess());}
    if(casinoOpen){requestAnimationFrame(gameLoop);return;}
    if(pauseState.shouldSkipFrame(runnerActive)){requestAnimationFrame(gameLoop);return;}
    gamepadState=gamepadInput.poll();
    crowdScanTimer-=dt;
    if(crowdScanTimer<=0){crowdScanTimer=1;audio.setCrowdProximity(stadiumDistance());}
    npcSync.syncRole(physics);
    audio.updateRemotePeers?.([...visualizer.peerCars].map(([peerId, peer]) => ({ ...peer.state, peerId })), { lat: physics.lat, lng: physics.lng });

    syncTimer += dt;
    if (syncTimer > 0.1) {
      syncTimer = 0;
      multiplayer.sendState({ ...physics.serializeState(), robot: robotMode });
    }

    if(runnerActive){
      npcSync.update(dt, physics, {hidden:true});
      if (!multiplayerPanelOpen && !mobileMenuOpen) runnerGame.update(dt);
      runnerView.update(runnerGame,dt);
      const runnerBest = (() => { try { return Number(localStorage.getItem('bmw-runner-best')) || 0; } catch { return 0; } })();
      const runnerDist = Math.floor(runnerGame.distance);
      if (!runnerGame.over && runnerDist > runnerBest) { try { localStorage.setItem('bmw-runner-best', runnerDist); } catch {} }
      const bestLabel = runnerBest > 0 ? ` 🏆 BEST: ${runnerBest}m` : '';
      const comboEvent=runnerGame.comboChangeEvent;runnerGame.comboChangeEvent=null;
      const displayedCombo=comboEvent?.combo??runnerGame.combo;
      const comboLabel=displayedCombo>1?` · ×${displayedCombo} COMBO`:'';
      runnerScore.textContent=`LVL ${runnerGame.level} · ${runnerDist} m${comboLabel} · ${runnerGame.collected} met${bestLabel}`;
      const trickEvent=runnerGame.trickEvent;runnerGame.trickEvent=null;
      if(trickEvent){runnerTrickToast.textContent=`✨ TRICK +${trickEvent.bonus}pts`;runnerTrickToast.hidden=false;runnerTrickToast.style.opacity='1';runnerTrickToastTimer=1.6;}
      if(runnerTrickToastTimer>0){runnerTrickToastTimer-=dt;if(runnerTrickToastTimer<=0){runnerTrickToast.style.opacity='0';setTimeout(()=>{if(runnerTrickToast.style.opacity==='0')runnerTrickToast.hidden=true;},220);}}
      runnerLives.textContent='♥ '.repeat(runnerGame.lives).trim()||'No hearts';
      if(runnerGame.over){runnerHint.hidden=false;runnerHint.textContent='Run over · tap a control to restart';}
      else if(hintTimer>0){hintTimer-=dt;if(hintTimer<=0)runnerHint.hidden=true;}
      requestAnimationFrame(gameLoop);
      return;
    }

    physics.setPeerCars?.([...visualizer.peerCars].map(([peerId, peer]) => ({ ...peer.state, peerId })));
    if (!visualizer.previewActive && !multiplayerPanelOpen && !mobileMenuOpen) updateWithGamepad(physics,gamepadState,()=>physics.update(dt));
    if (physics.impactEvent && physics.impactEvent.timestamp) {
      audio.triggerImpact(physics.impactEvent.speed);
      visualizer.triggerImpact(physics.impactEvent.speed);
      physics.impactEvent = null;
    }
    if (physics.driftEndEvent) {
      const { score, combo } = physics.driftEndEvent;
      physics.driftEndEvent = null;
      let bestCombo = 0; try { bestCombo = Number(localStorage.getItem('bmw-drift-best')) || 0; } catch {}
      const beaten = combo > bestCombo;
      if (beaten) { try { localStorage.setItem('bmw-drift-best', combo); } catch {} }
      driftToast.textContent = `+${score} pts · combo ×${combo}${beaten ? ' 🏆 BEST!' : ''}`;
      driftToast.style.opacity = '1';
      driftToastTimer = 1.5;
    }
    if (driftToastTimer > 0) {
      driftToastTimer -= dt;
      if (driftToastTimer <= 0) driftToast.style.opacity = '0';
    }
    if (pedestrians.boardEvent) {
      const { count } = pedestrians.boardEvent;
      pedestrians.boardEvent = null;
      boardToast.textContent = `🎉 +1 passenger · ${count} aboard`;
      boardToast.style.opacity = '1';
      boardToastTimer = 1.5;
      audio.burst({ frequency: 880, volume: 0.12, duration: 0.08 });
      audio.burst({ frequency: 1100, volume: 0.08, duration: 0.06, delay: 0.09 });
    }
    if (boardToastTimer > 0) {
      boardToastTimer -= dt;
      if (boardToastTimer <= 0) boardToast.style.opacity = '0';
    }
    // Speed-camera radar checks and drift sparks.
    const roadSigns = trafficManager.signs;
    const radars = roadSigns?.getRadars?.() ?? [];
    const carPoint = physics.roadNetwork?.center ? projectCoordinate(physics.lat, physics.lng, physics.roadNetwork.center) : null;
    const speedLimit = carPoint && roadNetworkHasEdges(physics.roadNetwork) && roadSigns?.getNearestLimit
      ? roadSigns.getNearestLimit({ x: carPoint[0], y: carPoint[1], heading: physics.heading, roadHeight: physics.roadHeight, currentEdge: physics.currentEdge, roadNetwork: physics.roadNetwork })
      : 50;
    const nearRadar = carPoint && radars.some(r => Math.hypot(carPoint[0] - r.x, carPoint[1] - r.y) <= 30);
    if (nearRadar && Math.abs(physics.speed) > speedLimit * 1.15 && speedCamFlash <= 0) {
      speedCamFlash = 1.5;
      tickets++;
      ticketChip.textContent = `🎫 ${tickets}`;
      ticketChip.style.display = 'block';
    }
    if (speedCamFlash > 0) {
      speedCamFlash -= dt;
      speedCamBanner.textContent = `📷 SPEED CAMERA — ${Math.round(Math.abs(physics.speed))} km/h in ${Math.round(speedLimit)} zone`;
      speedCamBanner.style.display = 'block';
      speedCamBanner.style.opacity = Math.floor(speedCamFlash * 8) % 2 === 0 ? '1' : '0';
      if (speedCamFlash <= 0) speedCamBanner.style.display = 'none';
    }
    if (physics.handbrake && Math.abs(physics.speed) > 20 && physics.isDrifting) {
      sparkSpawnTimer -= dt;
      if (sparkSpawnTimer <= 0) {
        sparkSpawnTimer = .06;
        visualizer.spawnSparks(visualizer.carGroup.position, 3);
      }
    } else sparkSpawnTimer = 0;
    // Auto day/night clock
    if (autoDay && !visualizer.previewActive) {
      gameHour = (gameHour + dt * (24 / 600)) % 24;
      visualizer.setTimeOfDay(gameHour);
    }
    routeTimer += dt;
    if (routeGuide && routeTimer > .2) {
      const routeDelta=routeTimer;
      routeTimer=0;
      const guidance=routeGuide.update(physics.lat,physics.lng,Math.abs(physics.speed)/3.6,routeDelta);
      const eta=guidance.etaSeconds<90?`${Math.round(guidance.etaSeconds)} s`:`${Math.round(guidance.etaSeconds/60)} min`;
      document.getElementById('akanzi-progress').textContent=guidance.complete?'Akanzi complete · Pendik Sahil':`Akanzi · ${(guidance.remaining/1000).toFixed(1)} km · ETA ${eta}`;
      document.getElementById('akanzi-next').textContent=guidance.complete?'You drove the full coastal route.':`Next: ${guidance.nextStop}`;
      document.getElementById('akanzi-instruction').textContent=guidance.instruction;
      if(guidance.complete&&!routeCompletionShown) {
        routeCompletionShown=true;
        const elapsed=Math.max(0,Math.floor(guidance.elapsedSeconds));
        const minutes=Math.floor(elapsed/60),seconds=String(elapsed%60).padStart(2,'0');
        document.getElementById('akanzi-completion-distance').textContent=`${(routeGuide.data.distance/1000).toFixed(1)} km`;
        document.getElementById('akanzi-completion-time').textContent=`${minutes}:${seconds}`;
        document.getElementById('akanzi-completion-stops').textContent=String(guidance.stopsVisited);
        document.getElementById('akanzi-completion').hidden=false;
        document.getElementById('akanzi-drive-again').focus();
      }
      const stopEvt=routeGuide.stopEvent;
      if(stopEvt){
        routeGuide.stopEvent=null;
        stopToast.textContent=`📍 ${stopEvt.name} · stop ${stopEvt.number} of ${stopEvt.total}`;
        stopToast.style.opacity='1';
        stopToastTimer=2;
        audio.burst?.({frequency:660,volume:0.15,duration:0.12});
        setTimeout(()=>audio.burst?.({frequency:880,volume:0.1,duration:0.1}),130);
      }
    }
    if(stopToastTimer>0){stopToastTimer-=dt;if(stopToastTimer<=0)stopToast.style.opacity='0';}
    if (!visualizer.previewActive && multiplayer.npcAuthority) pedestrians.update(physics, dt, physics.speed);
    trafficManager.root.visible = !visualizer.previewActive && !npcSync.isFollower;
    if (!visualizer.previewActive && multiplayer.npcAuthority) trafficManager.update(dt, physics);
    trafficHornCooldown=Math.max(0,trafficHornCooldown-dt);
    if(!visualizer.previewActive&&multiplayer.npcAuthority&&trafficHornCooldown<=0&&trafficManager.origin) {
      const playerPoint=trafficManager.playerPoint(physics);
      for(const vehicle of trafficManager.cars)if(vehicle.honkEvent&&Math.hypot(vehicle.x-playerPoint.x,vehicle.y-playerPoint.y)<20&&Math.abs(vehicle.roadHeight-playerPoint.roadHeight)<1) {
        if(audio.remoteHorn())trafficHornCooldown=.8;
        break;
      }
    }
    assistTickCooldown = Math.max(0, assistTickCooldown - dt);
    if (drivingAssist) {
      const labels = [];
      if (physics.absActive) labels.push('ABS ACTIVE');
      if (physics.tractionControlActive) labels.push('TRACTION CONTROL');
      drivingAssist.replaceChildren(...labels.map(label => {
        const chip = document.createElement('span');
        chip.textContent = label;
        return chip;
      }));
      drivingAssist.hidden = labels.length === 0;
    }
    if (physics.assistFeedbackEvent && assistTickCooldown <= 0) {
      physics.assistFeedbackEvent = null;
      audio.burst({ frequency: 740, endFrequency: 520, volume: 0.035, duration: 0.045, type: 'square' });
      assistTickCooldown = 0.35;
    } else if (physics.assistFeedbackEvent) {
      physics.assistFeedbackEvent = null;
    }
    const trafficStatus=document.getElementById('traffic-status');
    const drivingStatus=physics.energy.remaining<=0?`${physics.energy.electric?'Battery':'Fuel'} empty · Refill in Setup`:trafficManager.status;
    if(trafficStatus.textContent!==drivingStatus)trafficStatus.textContent=drivingStatus;
    instrumentTimer+=dt;
    if(instrumentTimer>=.15) {
      instrumentTimer=0;
      if (densitySelect) {
        densitySelect.disabled = npcSync.isFollower;
        densitySelect.title = npcSync.isFollower ? 'NPC density is controlled by the room host' : '';
      }
      if(pedestrianDensityInput){pedestrianDensityInput.disabled=npcSync.isFollower;pedestrianDensityInput.title=npcSync.isFollower?'Pedestrian density is controlled by the room host':'';}
      const info=trafficManager.roadInfo,limit=document.getElementById('hud-speed-limit');
      limit.textContent=info?Math.round(info.limit):'—';limit.dataset.speeding=String(info&&Math.abs(physics.speed)>info.limit+1);
      const navigation=document.getElementById('hud-navigation');
      navigation.textContent=info?.directions.length?`${Math.ceil(info.remaining)} m · ${info.directions.map(d=>`${d.arrow} ${d.name}`).join(' · ')}`:info?.name?`↑ ${info.name}`:'';
      navigation.title=navigation.textContent;
      const signal=document.getElementById('hud-signal');signal.hidden=!info?.signal||info.remaining>100;
      if(!signal.hidden){signal.textContent=`${info.signal.toUpperCase()} · ${Math.ceil(info.signalDistance??info.remaining)} m`;signal.style.color={red:'#ff968c',amber:'#ffd37d',green:'#8de2a6'}[info.signal];}
      const energy=physics.energy,percent=Math.ceil(energy.percent);
      document.getElementById('hud-fuel').textContent=`${energy.electric?'Battery':'Fuel'} ${percent}%`;
      document.getElementById('hud-economy').textContent=energy.readout(physics.speed);
      document.getElementById('hud-fuel-meter').value=energy.percent;
      document.getElementById('energy-details').textContent=`${energy.remaining.toFixed(1)} / ${energy.capacity} ${energy.electric?'kWh':'L'} · Range ~${Math.round(energy.rangeKm)} km`;
      document.getElementById('energy-average').textContent=energy.average===null?'Average economy appears after driving 50 m.':`Trip ${(energy.distanceKm).toFixed(1)} km · Average ${energy.average.toFixed(1)} ${energy.electric?'kWh':'L'}/100 km`;
      refuelButton.disabled=Math.abs(physics.speed)>1;
      refuelButton.textContent=refuelButton.disabled?'Stop to refuel / charge':energy.electric?'Charge battery':'Refill tank';
      // Low fuel/charge warning banner
      const fuelWarning = document.getElementById('fuel-warning-banner');
      if (fuelWarning && !visualizer.previewActive && !runnerActive) {
        const ratio = energy.remaining / energy.capacity;
        if (ratio < 0.12) {
          const pct = Math.ceil(ratio * 100);
          fuelWarning.textContent = energy.electric ? `🔋 LOW CHARGE — ${pct}%` : `⛽ LOW FUEL — ${pct}%`;
          fuelWarning.hidden = false;
        } else {
          fuelWarning.hidden = true;
        }
      }
    }
    if (visualizer.highBeams && !visualizer.previewActive && !npcSync.isFollower) pedestrians.highBeam(physics);
    if (!npcSync.isFollower) pedestrianView.update(pedestrians, physics, visualizer.carGroup, visualizer.previewActive, dt);
    npcSync.update(dt, physics, {hidden:visualizer.previewActive});
    const clinging = pedestrians.people.filter(person => person.state === 'clinging').length;
    const trunkPassengers=pedestrians.people.filter(person=>person.state==='trunk-rider').length;
    const occupancy = `Kişi: ${pedestrians.passengers + 1}/${seatCapacity(physics.bmwModel)}${trunkPassengers?` · Bagaj: ${trunkPassengers}/2`:''}${clinging ? ` · Tutunan: ${clinging}` : ' · Sürücü dahil'}`;
    const passengerHud = document.getElementById('hud-passengers');
    if (passengerHud.textContent !== occupancy) passengerHud.textContent = occupancy;
    const passengerStatus = document.getElementById('passenger-status');
    const crowdMessage = npcSync.isFollower ? 'Shared NPCs · crowd interactions follow the host' : pedestrians.message;
    if (passengerStatus.textContent !== crowdMessage) passengerStatus.textContent = crowdMessage;
    worldRobot.visible=robotMode&&!visualizer.previewActive;
    if(robotMode)robotJump.update(dt);
    worldRobot.position.set(0,(physics.roadHeight??.08)+robotJump.height,0);
    worldRobot.rotation.y=Math.PI-(physics.heading+(physics.driftAngle??0));
    if(robotMode)animateRobot(worldRobot,{dt,speed:Math.abs(physics.speed)/3.6,grounded:robotJump.height<=0,verticalVelocity:robotJump.velocity,lateral:physics.steering??0});
    visualizer.cameraLift=robotMode?robotJump.height:0;
    visualizer.carGroup.visible=!robotMode;
    visualizer.update(physics, dt);

    const headingDeg = (physics.heading * 180) / Math.PI;
    mapUpdateTimer+=dt;
    if(mapUpdateTimer>=.1){mapUpdateTimer=0;mapController.updateCarPosition(physics.lat, physics.lng, headingDeg, physics.energy.remaining/physics.energy.capacity);}

    audio.update(physics.rpm, physics.throttle, physics.speed, physics.isDrifting, {model:physics.bmwModel,gear:physics.gear,slip:physics.driftFactor,brake:physics.handbrake || (physics.throttle < 0 && physics.speed > 0),dt,motion:physics.speed>2});
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
    const gearDisplay=physics.driveGear==='P'?'P':physics.driveGear==='R'||physics.gear<0?'R':physics.driveGear==='N'||(physics.driveGear==='auto'&&Math.abs(physics.speed)<.1)?'N':String(Math.max(1,Math.min(8,Math.round(physics.gear||1))));
    if(gearDisplay!==lastHudGearKey){
      lastHudGearKey=gearDisplay;
      for(const character of hudGearChip.querySelectorAll('[data-gear]'))character.classList.toggle('active',character.dataset.gear===gearDisplay);
      hudGear.innerText=gearDisplay;hudGearChip.setAttribute('aria-label',`Current gear ${gearDisplay}`);
    }
    document.getElementById('hud-drive-mode').textContent = physics.driveMode;
    document.getElementById('hud-dsc').textContent = physics.dscMode;
    const nitroMeter = document.getElementById('hud-nitro-meter');
    const charge = Math.round(physics.nitroCharge * 100);
    nitroMeter.style.background = `linear-gradient(90deg,#58dfff ${charge}%,#364957 ${charge}%)`;
    nitroButton.disabled = physics.nitroDepleted;
    if (nitroButton.disabled) releaseNitro();

    const rpmPercent = Math.min(100, (physics.rpm / 8500) * 100);
    hudRpmBar.style.width = `${rpmPercent}%`;

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
});
