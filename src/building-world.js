import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_FOOTPRINT_COORDINATE = 1e7;
const MAX_BUILDING_HEIGHT = 1000;

function validBuilding(building) {
  if (!building || typeof building !== 'object' || Array.isArray(building) || !Array.isArray(building.points)) return null;
  const height = building.height;
  const minHeight = building.minHeight === undefined ? 0 : building.minHeight;
  if (!Number.isFinite(height) || height <= 0 || height > MAX_BUILDING_HEIGHT ||
      !Number.isFinite(minHeight) || minHeight < 0 || minHeight >= height) return null;
  if (building.points.length < 3) return null;

  const points = [];
  for (const point of building.points) {
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > MAX_FOOTPRINT_COORDINATE || Math.abs(point[1]) > MAX_FOOTPRINT_COORDINATE) return null;
    const previous = points.at(-1);
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6) points.push([point[0], point[1]]);
  }
  if (points.length > 1 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) <= 1e-6) points.pop();
  if (points.length < 3) return null;

  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= 1e-6) return null;
  return { points, height, minHeight };
}

function* buildingSteps(network,random=Math.random) {
  const group = new THREE.Group();
  group.name = 'buildings';
  group.userData.windowLighting={totalWindows:0,litWindows:0,litMaterials:[],unlitMaterials:[]};
  // One shared facade texture; windows are lit/shaded surfaces on actual extrusions.
  let texture,windowLightTexture;
  if (typeof document !== 'undefined') {
    const canvas=document.createElement('canvas'); canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#d9d4c9';ctx.fillRect(0,0,128,128);
    ctx.fillStyle='#768a97';ctx.fillRect(20,18,36,64);ctx.fillRect(76,18,36,64);
    ctx.fillStyle='#a5b6bf';ctx.fillRect(22,20,30,4);ctx.fillRect(78,20,30,4);
    ctx.fillStyle='#b4b1a9';ctx.fillRect(0,114,128,5);
    texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.repeat.set(.15,.28);texture.colorSpace=THREE.SRGBColorSpace;
    const lightCanvas=document.createElement('canvas');lightCanvas.width=128;lightCanvas.height=128;
    const lightCtx=lightCanvas.getContext('2d');lightCtx.fillStyle='#000';lightCtx.fillRect(0,0,128,128);
    lightCtx.fillStyle='#fff';lightCtx.fillRect(20,18,36,64);lightCtx.fillRect(76,18,36,64);
    windowLightTexture=new THREE.CanvasTexture(lightCanvas);windowLightTexture.wrapS=windowLightTexture.wrapT=THREE.RepeatWrapping;windowLightTexture.repeat.set(.15,.28);
  }
  const walls = new THREE.MeshStandardMaterial({color:0xe3ddd1,map:texture ?? null,roughness:.9,emissive:0x000000,emissiveIntensity:0});
  const roof = new THREE.MeshStandardMaterial({color:0x656d73,roughness:.95});
  const chunks = new Map();
  let count = 0;
  const buildings = Array.isArray(network?.buildings) ? network.buildings : [];
  for(const building of buildings) {
    if (++count % 32 === 0) yield;
    const valid = validBuilding(building);
    if (!valid) continue;
    const { points, height, minHeight } = valid;
    const shape=new THREE.Shape(points.map(([east,north])=>new THREE.Vector2(east,north)));
    let geometry;
    try {
      geometry=new THREE.ExtrudeGeometry(shape,{depth:height-minHeight,bevelEnabled:false,steps:1});
      const positions = geometry.attributes.position?.array;
      if (!positions || !positions.every(Number.isFinite)) { geometry.dispose(); continue; }
    } catch {
      geometry?.dispose();
      continue;
    }
    geometry.rotateX(-Math.PI/2);
    geometry.translate(0, minHeight, 0);
    if (!geometry.attributes.position.array.every(Number.isFinite)) { geometry.dispose(); continue; }
    geometry.userData.windowLightsLit=random()<.3;
    const floors=Math.max(1,Math.ceil((building.height-(building.minHeight??0))/3));
    geometry.userData.windowCount=floors*4;
    group.userData.windowLighting.totalWindows+=geometry.userData.windowCount;
    if(geometry.userData.windowLightsLit)group.userData.windowLighting.litWindows+=geometry.userData.windowCount;
    const [east,north] = points[0];
    const key = `${Math.floor(east / 100)},${Math.floor(north / 100)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(geometry);
  }
  for (const [key, geometries] of chunks) {
    yield;
    // Keep roof and facade variants batched by spatial chunk.
    const buckets = [[], [], []];
    for (const geometry of geometries) for (const range of geometry.groups) {
      const part = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        part.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(range.start * attribute.itemSize, (range.start + range.count) * attribute.itemSize), attribute.itemSize));
      }
      const materialIndex=range.materialIndex===0?0:(geometry.userData.windowLightsLit?2:1);
      buckets[materialIndex].push(part);
    }
    const chunkMaterials=[roof,walls,new THREE.MeshStandardMaterial({color:0xe3ddd1,map:texture??null,roughness:.9,emissive:0xffe090,emissiveMap:windowLightTexture??null,emissiveIntensity:.9})];
    chunkMaterials[2].userData.windowLightMaterial=true;
    const materials=[],usedMaterials=[];
    for(let i=0;i<buckets.length;i++)if(buckets[i].length){materials.push(mergeGeometries(buckets[i],false));usedMaterials.push(chunkMaterials[i]);}
    const geometry = mergeGeometries(materials, true);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, usedMaterials);
    mesh.name = `building-chunk-${key}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    if(usedMaterials.includes(chunkMaterials[1]))group.userData.windowLighting.unlitMaterials.push(chunkMaterials[1]);
    if(usedMaterials.includes(chunkMaterials[2]))group.userData.windowLighting.litMaterials.push(chunkMaterials[2]);
    for (const old of [...geometries, ...buckets.flat(), ...materials]) old.dispose();
  }
  if(!group.userData.windowLighting.litMaterials.length)windowLightTexture?.dispose();
  if(!group.children.length){walls.dispose();roof.dispose();texture?.dispose();windowLightTexture?.dispose();}
  return group;
}

export function buildBuildings(network,options={}) {
  const steps = buildingSteps(network,options.random??Math.random);
  let next;
  do { next = steps.next(); } while (!next.done);
  return next.value;
}

export async function buildBuildingsAsync(network,options={}) {
  const steps = buildingSteps(network,options.random??Math.random);
  let next = steps.next();
  while (!next.done) {
    if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
    else await new Promise(resolve => setTimeout(resolve, 0));
    next = steps.next();
  }
  return next.value;
}

export function disposeWorldGroup(group) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material]) {
      if(material){materials.add(material);if(material.map)textures.add(material.map);}
    }
  });
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  group.clear();
}
