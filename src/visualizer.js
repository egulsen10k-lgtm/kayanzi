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
import { createRobotModel } from './robot-runner-view.js';

export function geographicOffset(center, lat, lng, out = { east: 0, north: 0 }) {
  const deltaLng = ((lng - center.lng + 540) % 360) - 180;
  out.east = deltaLng * Math.PI / 180 * 6371008.8 * Math.cos(center.lat * Math.PI / 180);
  out.north = (lat - center.lat) * Math.PI / 180 * 6371008.8;
  return out;
}

export function roadNetworkHasEdges(network) {
  return Array.isArray(network?.edges);
}

export function renderDimensions(container) {
  const width = Number(container?.clientWidth);
  const height = Number(container?.clientHeight);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1,
    height: Number.isFinite(height) && height > 0 ? height : 1
  };
}

export function selectQualityTier({ width = 1024, dpr = 1, mobile = false } = {}) {
  if (mobile || width <= 480 || dpr >= 3) return 'eco';
  if (width > 900 && dpr <= 2) return 'high';
  return 'balanced';
}

export function getQualityCaps(tier = 'balanced') {
  const caps = {
    eco: { sparks: 12, smoke: 20, mud: 24, skids: 60, rain: 500, remoteVoices: 2 },
    balanced: { sparks: 30, smoke: 40, mud: 48, skids: 120, rain: 1000, remoteVoices: 4 },
    high: { sparks: 60, smoke: 80, mud: 80, skids: 200, rain: 2000, remoteVoices: 7 }
  };
  return { ...(caps[tier] || caps.balanced) };
}

export function peerExtrapolationMeters(speedKmh, ageSeconds) {
  const speed = Math.max(-200, Math.min(200, Number.isFinite(speedKmh) ? speedKmh : 0));
  const age = Math.max(0, Math.min(.25, Number.isFinite(ageSeconds) ? ageSeconds : 0));
  return Math.max(-5, Math.min(5, speed / 3.6 * age));
}

export function peerFadeForAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs <= 5000) return 1;
  return Math.max(0, Math.min(1, (7000 - ageMs) / 2000));
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
function indicatorMaterials(group) {
  const result={left:null,right:null};
  group.traverse(object=>{
    if(object.name!=='tail-light'||!object.material)return;
    const side=object.position.x<0?'left':'right';
    object.material=object.material.clone();
    result[side]=object.material;
  });
  return result;
}
function tintIndicator(material,active,baseIntensity) {
  if(!material?.color)return;
  material.userData.indicatorBase??={color:material.color.clone(),emissive:material.emissive?.clone(),intensity:material.emissiveIntensity};
  const base=material.userData.indicatorBase;
  if(active) {
    material.color.set('#ffb52e');material.emissive?.set('#ff8a16');material.emissiveIntensity=2.3;
  } else {
    material.color.copy(base.color);if(base.emissive)material.emissive.copy(base.emissive);
    material.emissiveIntensity=Number.isFinite(baseIntensity)?baseIntensity:base.intensity;
  }
}

export class SkidMarkSystem {
  constructor(scene,capacity=200) {
    this.capacity=Math.max(1,Math.floor(capacity));this.limit=this.capacity;this.cursor=0;this.count=0;this.elapsed=0;
    this.records=Array.from({length:this.capacity},()=>({time:-Infinity}));
    const positions=new Float32Array(this.capacity*12),colors=new Float32Array(this.capacity*16),indices=new Uint32Array(this.capacity*6);
    for(let i=0;i<this.capacity;i++) {
      const v=i*4,k=i*6;indices.set([v,v+1,v+2,v+1,v+3,v+2],k);
      for(let j=0;j<4;j++){const c=(v+j)*4;colors.set([.102,.102,.102,0],c);}
    }
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));this.geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));this.geometry.setIndex(new THREE.BufferAttribute(indices,1));
    this.material=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:1,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,side:THREE.DoubleSide});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='tire-skid-marks';this.mesh.renderOrder=1;this.mesh.frustumCulled=false;scene.add(this.mesh);
  }
  add(x,z,heading,y,time) {
    const slot=this.cursor,index=slot*4,positions=this.geometry.attributes.position.array;
    const dx=Math.sin(heading),dz=-Math.cos(heading),px=dz*.14,pz=-dx*.14;
    const cx=x-dx*1.15,cz=z-dz*1.15,half=dx*.22,halfZ=dz*.22;
    positions.set([cx-px-half,y,cz-pz-halfZ,cx+px-half,y,cz+pz-halfZ,cx-px+half,y,cz-pz+halfZ,cx+px+half,y,cz+pz+halfZ],index*3);
    this.geometry.attributes.position.needsUpdate=true;
    this.records[slot]={time};this.cursor=(slot+1)%this.capacity;this.count=Math.min(this.capacity,this.count+1);
  }
  update(dt,skidding,physics,time=performance.now()/1000) {
    this.elapsed+=Math.max(0,dt);
    const onRoad=Boolean(physics.onRoad)||Number(physics.roadHeight)>0.02;
    if(skidding&&onRoad&&Math.abs(physics.speed)>15) {
      while(this.elapsed>=.04){this.add(this.lastX??0,this.lastZ??0,physics.heading??0,(physics.roadHeight??ROAD_SURFACE_HEIGHT)+.025,time);this.elapsed-=.04;}
    } else this.elapsed=0;
    const alpha=this.geometry.attributes.color.array;
    for(let i=0;i<this.capacity;i++) {
      const record=this.records[i],opacity=record.time===-Infinity?0:Math.max(0,1-(time-record.time)/12)*.55;
      for(let j=0;j<4;j++)alpha[(i*4+j)*4+3]=opacity;
    }
    this.geometry.attributes.color.needsUpdate=true;
  }
  setPosition(x,z){this.lastX=x;this.lastZ=z;}
  setLimit(limit){this.limit=Math.max(1,Math.min(this.capacity,Math.floor(limit)));this.count=Math.min(this.count,this.limit);this.cursor%=this.limit;}
  dispose(){this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
  clear(){this.records=Array.from({length:this.capacity},()=>({time:-Infinity}));this.count=0;this.elapsed=0;this.geometry.attributes.color.array.fill(0);this.geometry.attributes.color.needsUpdate=true;}
}

export class MudSystem {
  constructor(scene,capacity=80,random=Math.random) {
    this.capacity=capacity;this.limit=capacity;this.random=random;this.cursor=0;this.count=0;this.elapsed=0;
    this.particles=Array.from({length:capacity},()=>({active:false,age:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,returning:false,roadFadeRemaining:.35}));
    const positions=new Float32Array(capacity*12),colors=new Float32Array(capacity*16),indices=new Uint32Array(capacity*6);
    for(let i=0;i<capacity;i++){const v=i*4,k=i*6;indices.set([v,v+1,v+2,v+1,v+3,v+2],k);for(let j=0;j<4;j++)colors.set([1,1,1,0],(v+j)*4);}
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));this.geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));this.geometry.setIndex(new THREE.BufferAttribute(indices,1));
    this.material=new THREE.MeshBasicMaterial({color:'#5c3d1e',vertexColors:true,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='wheel-mud-splatter';this.mesh.frustumCulled=false;this.mesh.renderOrder=2;scene.add(this.mesh);
  }
  spawn(x,y,z,side) {
    const p=this.particles[this.cursor];if(!p.active)this.count++;
    const lateral=(this.random()*.8+.25)*side;
    Object.assign(p,{active:true,x,y,z,vx:lateral+(this.random()-.5)*.25,vy:.45+this.random()*.75,vz:(this.random()-.5)*.8,age:0,returning:false,roadFadeRemaining:.35});
    this.cursor=(this.cursor+1)%this.capacity;
  }
  update(dt,physics) {
    dt=Math.max(0,Number.isFinite(dt)?dt:0);
    const offRoad=!physics.onRoad;
    if(offRoad&&Math.abs(physics.speed)>10) {
      this.elapsed+=dt;
      const heading=physics.heading??0,fx=Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=Math.sin(heading);
      while(this.elapsed>=.05){
        this.elapsed-=.05;
        for(const side of [-1,1])for(const frontBack of [-1,1]) {
          const x=rx*side*.85+fx*frontBack*1.8,z=rz*side*.85+fz*frontBack*1.8;
          this.spawn(x,(physics.roadHeight??ROAD_SURFACE_HEIGHT)+.14,z,side);
          this.spawn(x,(physics.roadHeight??ROAD_SURFACE_HEIGHT)+.14,z,side);
        }
      }
    } else this.elapsed=0;
    const positions=this.geometry.attributes.position.array,colors=this.geometry.attributes.color.array;
    for(let i=0;i<this.capacity;i++) {
      const p=this.particles[i],offset=i*12;
      if(p.active){
        if(!offRoad&&!p.returning){p.returning=true;p.roadFadeRemaining=.35;}
        p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=1.7*dt;
        if(p.returning)p.roadFadeRemaining=Math.max(0,p.roadFadeRemaining-dt);
      }
      const a=p.active?Math.min(Math.max(0,1-p.age/1.4),p.returning?p.roadFadeRemaining/.35:1):0,half=.11;
      positions.set([p.x-half,p.y,p.z-half,p.x+half,p.y,p.z-half,p.x-half,p.y,p.z+half,p.x+half,p.y,p.z+half],offset);
      for(let j=0;j<4;j++)colors[(i*4+j)*4+3]=a;
      if(p.active&&(p.age>=1.4||(p.returning&&p.roadFadeRemaining<=0))){p.active=false;this.count--;}
    }
    this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.color.needsUpdate=true;
  }
  dispose(){this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
  clear(){for(const particle of this.particles)particle.active=false;this.count=0;this.elapsed=0;this.geometry.attributes.color.array.fill(0);this.geometry.attributes.color.needsUpdate=true;}
}

export class SpeedometerOverlay {
  constructor(container) {
    this.canvas=document.createElement('canvas');this.canvas.width=120;this.canvas.height=120;this.canvas.hidden=true;this.canvas.setAttribute('aria-hidden','true');
    Object.assign(this.canvas.style,{position:'absolute',right:'18px',bottom:'18px',width:'120px',height:'120px',pointerEvents:'none',zIndex:'20'});
    container.appendChild(this.canvas);this.context=this.canvas.getContext('2d');this.needleSpeed=0;this.needleAngle=this.startAngle;this.maxSpeed=280;
  }
  get startAngle(){return Math.PI*5/6;}
  get sweep(){return Math.PI*7/6;}
  update(speedKmh,dt,visible=true) {
    this.canvas.hidden=!visible;if(!visible)return;
    const target=Math.max(0,Math.min(this.maxSpeed,Number.isFinite(speedKmh)?speedKmh:0));
    this.needleSpeed+=(target-this.needleSpeed)*Math.min(1,Math.max(0,dt)*8);
    this.needleAngle=this.startAngle+(this.needleSpeed/this.maxSpeed)*this.sweep;
    const ctx=this.context;ctx.clearRect(0,0,120,120);ctx.save();
    ctx.fillStyle='rgba(5,12,19,.84)';ctx.beginPath();ctx.arc(60,60,58,0,Math.PI*2);ctx.fill();
    ctx.lineWidth=7;ctx.lineCap='round';ctx.strokeStyle='rgba(140,238,245,.28)';ctx.beginPath();ctx.arc(60,60,46,this.startAngle,this.startAngle+this.sweep);ctx.stroke();
    ctx.strokeStyle='#8ceef5';ctx.lineWidth=2;ctx.beginPath();ctx.arc(60,60,46,this.startAngle,this.needleAngle);ctx.stroke();
    const nx=60+Math.cos(this.needleAngle)*38,ny=60+Math.sin(this.needleAngle)*38;ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(60,60);ctx.lineTo(nx,ny);ctx.stroke();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(60,60,4,0,Math.PI*2);ctx.fill();
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.font='700 22px system-ui';ctx.fillText(String(Math.round(this.needleSpeed)),60,74);
    ctx.fillStyle='#aebdc7';ctx.font='600 8px system-ui';ctx.fillText('km/h',60,91);ctx.restore();
  }
  dispose(){this.canvas.remove();}
}

export class CarVisualizer3D {
  constructor(container) {
    this.container = container;
    this.reducedMotionQuery=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')??null;
    this.reducedMotion=Boolean(this.reducedMotionQuery?.matches);
    this.reducedMotionChange=event=>{this.reducedMotion=Boolean(event.matches);};
    this.reducedMotionQuery?.addEventListener?.('change',this.reducedMotionChange);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc4d4df);
    this.scene.fog = new THREE.Fog(0xc4d4df, 100, 650);
    const dimensions = renderDimensions(container);
    this.camera = new THREE.PerspectiveCamera(48, dimensions.width / dimensions.height, 0.1, 2000);
    const mobile=window.matchMedia('(max-width:800px), (pointer:coarse)').matches;
    this.mobile = mobile;
    this.qualityTier = mobile ? 'balanced' : 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.setQualityTier(selectQualityTier({width:dimensions.width,dpr:globalThis.devicePixelRatio||1,mobile}), { mobile });
    this.renderer.setSize(dimensions.width, dimensions.height);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);
    this.speedometerOverlay=new SpeedometerOverlay(container);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();

    this.peerCars = new Map();
    this.peerLabels = new Map();
    this.skidMarks=new SkidMarkSystem(this.scene,this.particleCaps.skids);
    this.mudSystem=new MudSystem(this.scene,this.particleCaps.mud);
    this.roadGroup = new THREE.Group();
    this.trafficGroup = new THREE.Group();
    this.scene.add(this.trafficGroup);
    this.traffic = [];
    this.nightMode = false;
    this.windowFlickerTimer=8;this.windowFlickerRestoreTimer=0;this.windowFlickerMaterial=null;
    this.highBeams = false;
    this.trafficDensity = 1;
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
    this.cameraRoll=0;
    this.cameraShakeEnabled = true;
    this.cameraShake = 0;
    this.cameraShakeTime = 0;
    this.lastPosition = { lat: 48.1764, lng: 11.5583 };
    this.introActive = true;
    this.introT = 0;
    this.flameUntil = 0;
    this.damageLevel = 0;
    this.smokeParticles = [];
    this.sparkParticles = [];
    this.setupLighting();
    this.setupEnvironment();
    this.setModel(this.currentModel);
    this.camera.position.set(8, 7, 12);
    this.satellite = new SatelliteWorld(this.scene, container, this.renderer);

    this.satellite.group.visible = true;
    this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
    this.resizeObserver.observe(container);
    this.onWindowResize();
  }

  setupLighting() {
    this.hemiLight = new THREE.HemisphereLight(0xeaf3ff, 0x6d7262, 1.4);
    this.scene.add(this.hemiLight);
    const sun = new THREE.DirectionalLight(0xfff5df, 2.5);
    sun.position.set(-20, 35, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 70 });
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.015;
    this.sunLight = sun;
    this.scene.add(sun);
    // Forward beams target the mapped road surface, not just the horizon.
    this.headlights = [
      new THREE.SpotLight(0xfff4d6, 0, 95, Math.PI / 7, .5, 1.25),
      new THREE.SpotLight(0xfff4d6, 0, 95, Math.PI / 7, .5, 1.25)
    ];
    this.headlights.forEach((light, i) => {
      light.position.set(i ? -.62 : .62, .7, 2.3);
      light.target.position.set(i ? -.72 : .72, .05, 42);
      light.castShadow = false;
      this.carGroup?.add(light, light.target);
    });
  }

  setNightMode(enabled) {
    this.nightMode = Boolean(enabled); const night = this.nightMode;
    this.scene.background.set(night ? 0x071225 : 0xc4d4df);
    if (this.scene.fog) this.scene.fog.color.set(night ? 0x071225 : 0xc4d4df);
    this.hemiLight.intensity = night ? .12 : 1.4; this.sunLight.intensity = night ? .08 : 2.5;
    this.setBuildingNightMode(night);
    this.setHighBeams(this.highBeams);
  }

  setBuildingNightMode(enabled) {
    this.roadGroup?.traverse(object=>{
      for(const material of Array.isArray(object.material)?object.material:[object.material])
        if(material?.userData?.windowLightMaterial)material.emissiveIntensity=enabled?0.9:0;
    });
    if(!enabled&&this.windowFlickerMaterial){this.windowFlickerMaterial.emissiveIntensity=0;this.windowFlickerMaterial=null;this.windowFlickerRestoreTimer=0;}
  }

  updateBuildingFlicker(dt) {
    if(!this.nightMode){this.windowFlickerTimer=8;return;}
    if(this.windowFlickerMaterial){
      this.windowFlickerRestoreTimer-=dt;
      if(this.windowFlickerRestoreTimer<=0){this.windowFlickerMaterial.emissiveIntensity=.9;this.windowFlickerMaterial=null;}
    }
    this.windowFlickerTimer-=dt;
    if(this.windowFlickerTimer>0)return;
    this.windowFlickerTimer=8;
    const lit=[];this.roadGroup?.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material])if(material?.userData?.windowLightMaterial)lit.push(material);});
    if(!lit.length)return;
    this.windowFlickerMaterial=lit[Math.floor(Math.random()*lit.length)];this.windowFlickerMaterial.emissiveIntensity=0;this.windowFlickerRestoreTimer=.18;
  }

  setWeather(type) {
    // Remove existing rain particles
    if (this._rainMesh) { this.scene.remove(this._rainMesh); this._rainMesh.geometry.dispose(); this._rainMesh.material.dispose(); this._rainMesh = null; }
    this._weatherType = type;
    if(type==='rain'&&this.reducedMotion){this.weatherGrip=.75;if(this.scene.fog){this.scene.fog.near=80;this.scene.fog.far=300;this.scene.fog.color.set(0x8097a8);}return;}
    if (type === 'rain' && !this.reducedMotion) {
      const count = this.particleCaps?.rain ?? 2000;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * 80;
        positions[i * 3 + 1] = Math.random() * 38 - 8;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this._rainMesh = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8ab4d4, size: 0.12, transparent: true, opacity: 0.55 }));
      this._rainMesh.name = 'rain-particles';
      this.scene.add(this._rainMesh);
      if (this.scene.fog) { this.scene.fog.near = 80; this.scene.fog.far = 300; this.scene.fog.color.set(0x8097a8); }
      this.weatherGrip = 0.75;
    } else if (type === 'fog') {
      if (this.scene.fog) { this.scene.fog.near = 30; this.scene.fog.far = 180; this.scene.fog.color.set(0xc0c8d0); }
      this.weatherGrip = 1.0;
    } else {
      // clear
      if (this.scene.fog) { this.scene.fog.near = 100; this.scene.fog.far = 650; }
      this.setNightMode(this.nightMode); // restore fog color
      this.weatherGrip = 1.0;
    }
  }

  setTimeOfDay(hours) {
    const isNight = hours < 6 || hours >= 20;
    this.setNightMode(isNight);
    const t = Math.max(0, Math.min(1, (hours - 6) / 14));
    this.sunLight.position.set(-Math.cos(t * Math.PI), Math.sin(t * Math.PI) * 35, 16);
    if (isNight) this.sunLight.intensity = 0.06;
  }

  setHighBeams(enabled) {
    this.highBeams = Boolean(enabled);
    const intensity = this.nightMode ? (this.highBeams ? 14 : 5.5) : (this.highBeams ? 1.5 : 0);
    this.headlights?.forEach(light => { light.intensity = intensity; });
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
    this.headlights?.forEach((light, i) => { light.position.set(i ? -.62 : .62, .7, 2.3); light.target.position.set(i ? -.62 : .62, .2, 35); this.carGroup.add(light, light.target); });
    this.setHighBeams(this.highBeams);
  }

  updateColor(color) {
    this.currentColor = color;
    for (const material of this.bodyMaterials) material.color.set(color);
  }

  setQualityTier(tier = 'balanced', { mobile = this.mobile } = {}) {
    const next = ['eco', 'balanced', 'high'].includes(tier) ? tier : 'balanced';
    const caps = mobile ? { eco: 1, balanced: 1.25, high: 1.5 } : { eco: 1, balanced: 1.5, high: 2 };
    this.qualityTier = next;
    this.particleCaps=getQualityCaps(next);
    this.remoteVoiceCap=this.particleCaps.remoteVoices;
    this.skidMarks?.setLimit(this.particleCaps.skids);
    if(this.skidMarks&&this.skidMarks.capacity!==this.particleCaps.skids){this.skidMarks.dispose();this.skidMarks=new SkidMarkSystem(this.scene,this.particleCaps.skids);}
    if(this.mudSystem&&this.mudSystem.capacity!==this.particleCaps.mud){this.mudSystem.dispose?.();this.mudSystem=new MudSystem(this.scene,this.particleCaps.mud);}
    if(this.mudSystem)this.mudSystem.limit=this.particleCaps.mud;
    this.sparkCap=this.particleCaps.sparks;
    this.smokeCap=this.particleCaps.smoke;
    if(this.smokeParticles?.length>this.smokeCap){for(const item of this.smokeParticles.splice(0,this.smokeParticles.length-this.smokeCap)){item.mesh.geometry.dispose();item.mesh.material.dispose();this.scene.remove(item.mesh);}}
    if(this._weatherType==='rain'&&!this.reducedMotion)this.setWeather('rain');
    if(this.sparkParticles?.length>this.sparkCap){for(const item of this.sparkParticles.splice(0,this.sparkParticles.length-this.sparkCap)){item.mesh.geometry.dispose();item.mesh.material.dispose();this.scene.remove(item.mesh);}}
    const devicePixelRatio = globalThis.devicePixelRatio || globalThis.window?.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, caps[next]));
    this.renderer.shadowMap.enabled = !mobile && next !== 'eco';
    this.trafficDensity = next === 'eco' ? .55 : next === 'balanced' ? .8 : 1;
    return next;
  }

  setCameraMode(mode) {
    if (['chase', 'hood', 'cockpit', 'reverse', 'wide', 'aerial', 'cinematic', 'bonnet'].includes(mode)) {
      this.cameraMode = mode;
      if (mode === 'cinematic') this.cinematicAngle = this.cinematicAngle ?? 0;
    }
  }

  updateCameraRoll(physics,dt) {
    const enabled=['chase','wide'].includes(this.cameraMode);
    if(this.reducedMotion){this.cameraRoll=0;return 0;}
    const drifting=enabled&&physics.handbrake&&physics.speed>20&&physics.isDrifting;
    const target=drifting?Math.max(-.08,Math.min(.08,(physics.driftDirection??0)*.06)):0;
    this.cameraRoll=Math.max(-.08,Math.min(.08,this.cameraRoll+(target-this.cameraRoll)*Math.min(1,Math.max(0,dt)*5)));
    return enabled?this.cameraRoll:0;
  }

  applyCameraRoll(physics,dt) {
    // Roll around the camera's viewing axis without overwriting lookAt's Euler angles.
    this.camera.rotateZ(this.updateCameraRoll(physics,dt));
  }

  setRoadOverlayEnabled() {
    // The road is the driving surface, never an optional image overlay.
    this.roadOverlayEnabled = true;
    this.roadGroup.visible = true;
  }

  clearRoads() { disposeWorldGroup(this.roadGroup); }

  setRoads(network, buildings = null) {
    this.clearRoads();
    // TrafficManager owns persistent vehicles and junction props across district loads.
    this.roadNetwork = network;
    this.roadCenter = network.center;

    const surfaces = buildRoadMeshes(network);
    if (surfaces.children.length) this.roadGroup.add(...surfaces.children.slice());
    this.roadGroup.add(buildings ?? buildBuildings(network));
    this.setBuildingNightMode(this.nightMode);
    this.roadGroup.add(buildMappedScenery(network));
    this.roadGroup.add(buildCoastalWater(network));
    this.roadGroup.add(buildBridgePiers(network));
    this.waterMeshes = [];
    this.roadGroup.traverse(object => { if(object.userData.animateWater) this.waterMeshes.push(object); });
    if (this.routeData) this.roadGroup.add(buildRouteRibbon(this.routeData, network.center, network));
    // Render only mapped safety barriers; these are visual detail, never map bounds.
    if (network.barriers?.length) {
      const barrierGroup = new THREE.Group();
      barrierGroup.name = 'road-guardrails';
      const material = new THREE.LineBasicMaterial({ color: 0x737b80 });
      for (const barrier of network.barriers) {
        for (let i = 1; i < barrier.points.length; i++) {
          const [ax, an] = barrier.points[i - 1], [bx, bn] = barrier.points[i];
          if (Math.hypot(bx - ax, bn - an) < .01) continue;
          const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(ax, barrier.type === 'jersey_barrier' ? .72 : .58, -an),
            new THREE.Vector3(bx, barrier.type === 'jersey_barrier' ? .72 : .58, -bn)
          ]);
          barrierGroup.add(new THREE.Line(geometry, material));
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
    this.container.dispatchEvent(new CustomEvent('roadstatus', {
      detail: { state: 'loading', preserveRoadNetwork: streaming }
    }));
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
      // Make mapped roads driveable before yielding through optional city geometry.
      this.setRoads(network, new THREE.Group());
      this.roadTarget = network.center;
      this.roadFailures = 0;
      this.roadRetryAt = 0;
      this.container.dispatchEvent(new CustomEvent('roadstatus', {
        detail: { state: network.roads.length ? 'ready' : 'empty', count: network.roads.length, network }
      }));
      const buildings = await buildBuildingsAsync(network);
      if (controller.signal.aborted || this.roadNetwork !== network) {
        disposeWorldGroup(buildings);
        return null;
      }
      this.roadGroup.add(buildings);
      this.setBuildingNightMode(this.nightMode);
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
    this.scene.fog = enabled ? null : new THREE.Fog(this.nightMode ? 0x071225 : 0xc4d4df, 100, 650);
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

  spawnSparks(position, count = 18) {
    count=Math.min(Math.max(0,count),Math.max(0,(this.sparkCap??60)-(this.sparkParticles?.length??0)));
    if(this.reducedMotion)return;
    if (!this.sparkParticles) this.sparkParticles = [];
    const MAX_SPARKS = 60;
    for (let i = 0; i < count; i++) {
      if (this.sparkParticles.length >= MAX_SPARKS) {
        const oldest = this.sparkParticles.shift();
        oldest.mesh.geometry.dispose(); oldest.mesh.material.dispose();
        this.scene.remove(oldest.mesh);
      }
      const angle = (Math.random() - 0.5) * (Math.PI / 1.5); // ±60°
      const speed = 3 + Math.random() * 5;
      const hue = 20 + Math.floor(Math.random() * 30);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
      const mat = new THREE.PointsMaterial({ size: 0.08, color: new THREE.Color(`hsl(${hue},100%,55%)`), transparent: true, opacity: 1, depthWrite: false });
      const mesh = new THREE.Points(geo, mat);
      mesh.position.set(position.x, position.y + 0.2, position.z);
      this.scene.add(mesh);
      this.sparkParticles.push({ mesh, vx: Math.sin(angle) * speed, vy: Math.random() * 1.5, vz: -Math.abs(Math.cos(angle)) * speed, age: 0, lifetime: 0.6 });
    }
  }

  setCameraShakeEnabled(enabled) {
    this.cameraShakeEnabled = Boolean(enabled);
    if (!this.cameraShakeEnabled) this.cameraShake = 0;
  }

  triggerImpact(speed) {
    this.damageLevel = Math.min(1, this.damageLevel + speed / 400);
    if (!this.reducedMotion && this.cameraShakeEnabled) {
      this.cameraShake = Math.min(1, this.cameraShake + Math.min(0.45, Math.max(0, speed) / 500));
      this.cameraShakeTime = 0;
    }
    if(this.reducedMotion)return;
    const count = Math.min(6 + Math.floor(speed / 25),Math.max(0,(this.smokeCap??80)-(this.smokeParticles?.length??0)));
    const carPos = this.carGroup.position;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array(60);
      for (let j = 0; j < 60; j++) verts[j] = (Math.random() - .5) * 1.2;
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const mat = new THREE.PointsMaterial({ size: 0.35, transparent: true, opacity: 0.6, color: 0xaaaaaa, depthWrite: false });
      const puff = new THREE.Points(geo, mat);
      puff.position.set(carPos.x + (Math.random() - .5) * 1.5, carPos.y + .5, carPos.z + (Math.random() - .5) * 1.5);
      this.scene.add(puff);
      this.smokeParticles.push({ mesh: puff, age: 0, lifetime: 2 });
    }
  }

  resetDamage() {
    for (const p of this.smokeParticles) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this.smokeParticles = [];
    this.damageLevel = 0;
  }

  updatePeerCar(state) {
    if (!state || !Number.isFinite(state.lat) || !Number.isFinite(state.lng) || !Number.isFinite(state.heading)) return;
    let peer = this.peerCars.get(state.peerId);
    if(peer&&Number.isSafeInteger(state.sequence)&&Number.isSafeInteger(peer.sequence)&&state.sequence<=peer.sequence)return;
    const robot = state.robot === true;
    if (peer && (peer.robot !== robot || peer.model !== state.model || peer.color !== state.color)) {
      this.removePeerCar(state.peerId);
      peer = null;
    }
    if (!peer) {
      if (this.peerCars.size >= 8) return;
      const color = /^#[0-9a-f]{6}$/i.test(state.color) ? state.color : '#718ba1';
      const model = robot ? { group: createRobotModel(color), wheels: [] } : createCarModel(state.model, color);
      if (robot) model.group.scale.set(.9, .52, 3.4);
      peer = { peerId:state.peerId, group: model.group, wheels: model.wheels ?? [], indicatorLamps: robot?{}:indicatorMaterials(model.group), model: state.model, color: state.color, robot, displayed: { ...state }, predicted:{lat:state.lat,lng:state.lng}, displacement:{east:0,north:0}, relative:{east:0,north:0}, fadeMaterials:[] };
      model.group.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){material.transparent=true;peer.fadeMaterials.push({material,opacity:material.opacity??1});}});
      this.scene.add(peer.group);
      this.peerCars.set(state.peerId, peer);
    }
    peer.state = state;
    peer.sequence=Number.isSafeInteger(state.sequence)?state.sequence:peer.sequence;
    peer.lastSeen = performance.now();
    const name=String(state.name??state.displayName??state.peerId).slice(0,12);
    if(peer.labelName!==name&&typeof document!=='undefined'&&document.createElement) {
      if(peer.label){peer.group.remove(peer.label);peer.label.material.map?.dispose();peer.label.material.dispose();}
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=56;const ctx=canvas.getContext('2d');
      ctx.fillStyle='rgba(9,17,26,.72)';ctx.beginPath();ctx.roundRect(4,5,248,46,18);ctx.fill();
      ctx.font='600 14px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.fillText(name,128,28,230);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.position.set(0,2.4,0);sprite.scale.set(2.3,.5,1);peer.group.add(sprite);peer.label=sprite;peer.labelName=name;
      peer.fadeMaterials.push({material:sprite.material,opacity:sprite.material.opacity});
      this.peerLabels.set(state.peerId,{name,texture,sprite});
    }
  }

  removePeerCar(id) {
    const peer = this.peerCars.get(id);
    if(peer?.label?.material){peer.label.material.map?.dispose();peer.label.material.dispose();}
    if (peer) disposeModel(peer.group);
    this.peerCars.delete(id);
    this.peerLabels?.delete(id);
  }

  updateTrafficIndicators(time=performance.now()) {
    const flashOn=Math.floor(time/350)%2===0;
    for(const peer of this.peerCars.values()) {
      const side=peer.state?.indicatorSide;
      const active=flashOn&&['left','right'].includes(side)&&(!Number.isFinite(peer.state.indicatorUntil)||time<peer.state.indicatorUntil);
      tintIndicator(peer.indicatorLamps?.left,active&&side==='left');
      tintIndicator(peer.indicatorLamps?.right,active&&side==='right');
    }
    this.trafficGroup?.traverse(object=>{
      const lamps=object.userData?.indicatorLamps;
      if(!lamps)return;
      const side=object.userData.indicatorSide;
      const active=flashOn&&['left','right'].includes(side);
      tintIndicator(lamps.left,active&&side==='left',object.userData.indicatorBaseIntensity);
      tintIndicator(lamps.right,active&&side==='right',object.userData.indicatorBaseIntensity);
    });
  }

  update(physics, dt = 1 / 60) {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.updateBuildingFlicker(dt);
    this.lastPosition = { lat: physics.lat, lng: physics.lng };
    this.lastHeading = physics.heading;
    this.lastRoadHeight = physics.roadHeight ?? ROAD_SURFACE_HEIGHT;
    if (this.previewActive) {
      this.speedometerOverlay?.update(physics.speed,dt,false);
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
    const skidPosition=geographicOffset(this.lastPosition,physics.lat,physics.lng);this.skidMarks.setPosition(skidPosition.east,-skidPosition.north);
    if(this.reducedMotion){this.skidMarks.clear();this.mudSystem.clear();}
    else{this.skidMarks.update(dt,(physics.isDrifting||physics.handbrake)&&Math.abs(physics.speed)>15,physics);this.mudSystem.update(dt,physics);}
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
    this.carGroup.rotation.set(-pitch,Math.PI-(physics.heading + (physics.driftAngle ?? 0)),0,'YXZ');
    for (const water of this.waterMeshes ?? []) water.userData.animateWater(performance.now()/1000);
    if(this.reducedMotion&&this._rainMesh){this.scene.remove(this._rainMesh);this._rainMesh.geometry.dispose();this._rainMesh.material.dispose();this._rainMesh=null;}
    if(this.reducedMotion){
      for(const particles of [this.smokeParticles,this.sparkParticles])for(const particle of particles??[]){particle.mesh.geometry.dispose();particle.mesh.material.dispose();this.scene.remove(particle.mesh);}
      this.smokeParticles.length=0;this.sparkParticles.length=0;
    }
    if (this._rainMesh) {
      const pos = this._rainMesh.geometry.attributes.position;
      const tilt = Math.max(-0.4, Math.min(0.4, (physics.speed ?? 0) / 200));
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, pos.getY(i) - (physics.speed ?? 0) * dt * 6 * 0.05 - dt * 6);
        pos.setZ(i, pos.getZ(i) + tilt * dt * 6);
        if (pos.getY(i) < -8) { pos.setY(i, pos.getY(i) + 38); pos.setZ(i, (Math.random() - 0.5) * 80); }
      }
      pos.needsUpdate = true;
    }
    animateWheels(this.wheels, physics.speed, physics.steering, dt);
    for(const material of this.brakeMaterials) material.emissiveIntensity = physics.throttle < 0 || physics.handbrake ? 2.5 : .65;
    for (const flame of this.exhaustFlames) flame.visible = performance.now() < this.flameUntil;
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.age += dt;
      p.mesh.material.opacity = 0.6 * Math.max(0, 1 - p.age / p.lifetime);
      p.mesh.position.y += dt * 0.8;
      if (p.age >= p.lifetime) {
        p.mesh.geometry.dispose(); p.mesh.material.dispose();
        this.scene.remove(p.mesh);
        this.smokeParticles.splice(i, 1);
      }
    }
    for (let i = (this.sparkParticles ?? []).length - 1; i >= 0; i--) {
      const s = this.sparkParticles[i];
      s.age += dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.vy -= 4 * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.material.opacity = Math.max(0, 1 - s.age / s.lifetime);
      if (s.age >= s.lifetime) {
        s.mesh.geometry.dispose(); s.mesh.material.dispose();
        this.scene.remove(s.mesh);
        this.sparkParticles.splice(i, 1);
      }
    }
    if (this.roadCenter) {
      const { east, north } = geographicOffset(this.roadCenter, physics.lat, physics.lng);
      this.roadGroup.position.set(-east, 0, north);
      this.trafficGroup.position.copy(this.roadGroup.position);
    }
    if (this.roadOverlayEnabled && this.roadTarget && !this.roadLoading && performance.now() > (this.roadRetryAt ?? 0) && performance.now() - this.lastRoadRequestAt > 1500) {
      const p = geographicOffset(this.roadTarget, physics.lat, physics.lng);
      if (Math.hypot(p.east, p.north) > 140) {
        const next = nextWorldLocation(physics, physics.heading, physics.speed);
        this.loadRoadsAt(next.lat, next.lng, true).catch(() => {});
      }
    }
    const peerNow=performance.now();
    for (const peer of this.peerCars.values()) {
      const age=peerNow-peer.lastSeen;
      if (age >= 7000) { this.removePeerCar(peer.peerId); continue; }
      const fade=peerFadeForAge(age);
      for(const record of peer.fadeMaterials??[])record.material.opacity=record.opacity*fade;
      const blend = 1 - Math.exp(-dt * 14);
      const display = peer.displayed;
      const extrapolation=peerExtrapolationMeters(peer.state.speed??0,age/1000);
      const angle=peer.state.heading??0,cosLat=Math.max(.01,Math.cos(peer.state.lat*Math.PI/180));
      peer.predicted.lat=peer.state.lat+Math.cos(angle)*extrapolation/111195;
      peer.predicted.lng=peer.state.lng+Math.sin(angle)*extrapolation/(111195*cosLat);
      const displacement = geographicOffset(display, peer.predicted.lat, peer.predicted.lng,peer.displacement);
      const snap = Math.hypot(displacement.east, displacement.north) > 100;
      display.lat += (peer.predicted.lat - display.lat) * (snap ? 1 : blend);
      display.lng += (peer.predicted.lng - display.lng) * (snap ? 1 : blend);
      const headingAngle = Math.atan2(Math.sin(peer.state.heading - display.heading), Math.cos(peer.state.heading - display.heading));
      display.heading += headingAngle * (snap ? 1 : blend);
      const p = geographicOffset(this.lastPosition, display.lat, display.lng,peer.relative);
      peer.group.position.set(p.east, Number.isFinite(peer.state.roadHeight) ? peer.state.roadHeight : ROAD_SURFACE_HEIGHT, -p.north);
      peer.group.rotation.y = Math.PI - display.heading;
      animateWheels(peer.wheels, peer.state.speed ?? 0, peer.state.steering ?? 0, dt);
      peer.group.visible = Math.hypot(p.east, p.north) < 1000;
      if(peer.label)peer.label.visible=peer.group.visible;
    }
    const mobile = this.container.clientWidth < 800 || Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches);
    let target, lookAt;
    const heading = this.cameraMode === 'aerial' ? 0 : physics.heading;

    if (this.cameraMode === 'aerial') {
      target = new THREE.Vector3(0, 180, 0.01);
      lookAt = new THREE.Vector3(0, 0, 0);
    } else if (this.cameraMode === 'cinematic') {
      this.cinematicAngle = (this.cinematicAngle ?? 0) + dt * (Math.PI * 2 / 20);
      const cx = Math.cos(this.cinematicAngle) * 18, cz = Math.sin(this.cinematicAngle) * 18;
      target = new THREE.Vector3(cx, 6, cz);
      lookAt = new THREE.Vector3(0, 0, 0);
    } else if (this.cameraMode === 'bonnet') {
      target = new THREE.Vector3(-Math.sin(heading)*2.1, 0.85, Math.cos(heading)*2.1);
      lookAt = new THREE.Vector3(Math.sin(heading)*12, 0.7, -Math.cos(heading)*12);
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
    const cameraLift=Math.max(0,Math.min(2,Number(this.cameraLift)||0));
    target.y += roadHeight + cameraLift*.7;
    lookAt.y += roadHeight + cameraLift*.9;

    if(this.reducedMotion){this.introActive=false;this.camera.position.copy(target);}
    else if (this.introActive) {
      this.introT = Math.min(1, this.introT + dt / 4);
      const t = this.introT;
      const ease = t * t * (3 - 2 * t);
      const introPos = new THREE.Vector3(0, 12 + roadHeight, 28);
      this.camera.position.lerpVectors(introPos, target, ease);
      if (this.introT >= 1) this.introActive = false;
    } else {
      this.camera.position.lerp(target, 1 - Math.exp(-6 * dt));
      if (this.cameraMode === 'cockpit' || this.cameraMode === 'hood') {
        this.camera.position.copy(target);
      }
    }
    if (this.cameraShake > 0 && this.cameraShakeEnabled && !this.reducedMotion) {
      this.cameraShakeTime += dt;
      const fade = Math.max(0, 1 - this.cameraShakeTime / 0.28);
      const amount = this.cameraShake * fade;
      const frequency = 42;
      this.camera.position.x += Math.sin(this.cameraShakeTime * frequency) * amount * 0.12;
      this.camera.position.y += Math.cos(this.cameraShakeTime * frequency * .83) * amount * 0.08;
      this.cameraShake *= Math.max(0, 1 - dt * 7);
    }
    this.camera.lookAt(lookAt);
    this.applyCameraRoll(physics,dt);
    this.speedometerOverlay?.update(physics.speed,dt,['cockpit','hood','bonnet'].includes(this.cameraMode));
    this.updateTrafficIndicators(performance.now());
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    const dimensions = renderDimensions(this.container);
    this.camera.aspect = dimensions.width / dimensions.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(dimensions.width, dimensions.height);
  }
}
