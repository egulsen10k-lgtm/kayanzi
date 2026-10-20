import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original procedural interpretations, not manufacturer CAD or licensed BMW assets.
// All geometry is local: model changes never download or overlay unrelated cars.
export function createCarModel(rawModelType = 'm3', colorHex = '#1c3fa8') {
  const label = String(rawModelType || 'm3').toLowerCase();
  const modelType = /i4|ev|m50/.test(label) ? 'i4' : /m4|csl/.test(label) ? 'm4' : /m5|\bcs\b/.test(label) ? 'm5' : 'm3';
  const group = new THREE.Group();
  group.name = `bmw-${modelType}`;
  group.userData.modelSource = 'original-procedural';

  // --- Procedural Fallback Body (always present) ---
  const profiles = {
    m3: { length: 4.79, width: 1.90, height: 1.43, wheelbase: 2.86, roofRear: -.72, roofFront: .52 },
    m4: { length: 4.79, width: 1.89, height: 1.36, wheelbase: 2.86, roofRear: -.82, roofFront: .37 },
    m5: { length: 4.98, width: 1.90, height: 1.47, wheelbase: 2.98, roofRear: -.82, roofFront: .57 },
    i4: { length: 4.78, width: 1.85, height: 1.44, wheelbase: 2.86, roofRear: -1.0, roofFront: .42 }
  };
  const p = profiles[modelType], half = p.length / 2;
  const paint = new THREE.MeshPhysicalMaterial({ color: colorHex, metalness: .65, roughness: .24, clearcoat: 1, clearcoatRoughness: .12 });
  const black = new THREE.MeshStandardMaterial({ color: '#101217', roughness: .32, metalness: .5 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#17191c', roughness: .93 });
  const silver = new THREE.MeshStandardMaterial({ color: '#aeb6c2', metalness: .88, roughness: .26 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#243943', metalness: .3, roughness: .12, clearcoat: 1 });
  const red = new THREE.MeshStandardMaterial({ color: '#820e17', emissive: 0xdc2626, emissiveIntensity: .65 });
  const white = new THREE.MeshStandardMaterial({ color: '#e5f4ff', emissive: '#afddff', emissiveIntensity: 1.5 });
  const caliper = new THREE.MeshStandardMaterial({ color: modelType === 'm5' ? '#d6a84c' : '#2261bc', metalness: .4, roughness: .4 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: .95, roughness: .1 });
  const carbon = new THREE.MeshStandardMaterial({color: '#1a1a1a', roughness: 0.5, metalness: 0.6});
  const amber = new THREE.MeshStandardMaterial({ color: '#ffb300', metalness: .2, roughness: .3, emissive: '#ffb300', emissiveIntensity: .3 });
  const wheels = [], exhaustFlames = [];
  const bodyMaterials = [paint];

  function mesh(geometry, material, name, x = 0, y = 0, z = 0, parent = group) {
    const part = new THREE.Mesh(geometry, material);
    part.name = name; part.position.set(x, y, z); part.castShadow = true; part.receiveShadow = true;
    parent.add(part); return part;
  }
  function box(name, w, h, d, material, x, y, z, radius = .02, parent = group) {
    return mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material, name, x, y, z, parent);
  }
  // Lofted body rings form sloped hood, flared shoulders and a tapered nose/tail.
  function loft(name, rings, material) {
    const vertices = [], indices = [];
    for (const [z, width, low, high] of rings) {
      vertices.push(-width, low, z, width, low, z, width, high, z, -width, high, z);
    }
    for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < 4; j++) {
      const a = r * 4 + j, b = r * 4 + (j + 1) % 4, c = b + 4, d = a + 4;
      indices.push(a, b, c, a, c, d);
    }
    indices.push(0, 2, 1, 0, 3, 2);
    const last = (rings.length - 1) * 4;
    indices.push(last, last + 1, last + 2, last, last + 2, last + 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    return mesh(geo, material, name);
  }
  loft('sculpted-body', [
    [-half, p.width * .43, .32, .70], [-half + .24, p.width * .49, .30, .83],
    [-1.35, p.width * .5, .31, .91], [-.5, p.width * .48, .31, .9],
    [.85, p.width * .48, .31, .88], [1.45, p.width * .5, .32, .82], [half, p.width * .44, .36, .69]
  ], paint);
  // Tapered cabin: narrower roof and inclined front/rear glass instead of a box.
  const cabin = new THREE.BufferGeometry();
  cabin.setAttribute('position', new THREE.Float32BufferAttribute([
    -.83,.83,-1.5, .83,.83,-1.5, .83,.83,1.04, -.83,.83,1.04,
    -.67,p.height,p.roofRear, .67,p.height,p.roofRear, .67,p.height,p.roofFront, -.67,p.height,p.roofFront
  ], 3));
  cabin.setIndex([0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7, 4,5,6,4,6,7]);
  for (let i = 0; i < cabin.index.count; i += 3) {
    const b = cabin.index.array[i + 1]; cabin.index.array[i + 1] = cabin.index.array[i + 2]; cabin.index.array[i + 2] = b;
  }
  cabin.computeVertexNormals();
  mesh(cabin, glass, 'glazed-cabin');
  box('roof', 1.39, .055, p.roofFront - p.roofRear + .1, modelType === 'm4' ? black : paint, 0, p.height + .015, (p.roofRear + p.roofFront) / 2);
  function strut(name, from, to, radius, material) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    const part = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material, name);
    part.position.copy(a.add(b).multiplyScalar(.5)); part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
  }
  for (const side of [-1, 1]) {
    strut('A-pillar', [side*.84,.84,1.04], [side*.68,p.height,p.roofFront], .037, paint);
    strut('C-pillar', [side*.84,.84,-1.5], [side*.68,p.height,p.roofRear], .065, paint);
    strut('B-pillar', [side*.84,.86,-.23], [side*.68,p.height,-.23], .033, black);
    box('side-skirt', .08, .11, 2.05, black, side*p.width*.5, .31, 0);
    box('mirror-stalk', .2, .045, .06, black, side*.91, .98, .65);
    box('mirror', .21, .115, .25, paint, side*1.02, 1.01, .64, .05);
    for (const z of modelType === 'm4' ? [.05] : [.28,-.83]) box('door-handle', .025,.035,.15, silver,side*p.width*.485,.83,z);
    // Thin sill seams and wheel arches keep the body readable from the chase camera.
    for (const z of [-p.wheelbase/2,p.wheelbase/2]) {
      const arch = mesh(new THREE.TorusGeometry(.405,.028,8,32,Math.PI), paint,'wheel-arch',side*(p.width*.5+.012),.37,z);
      arch.rotation.y = Math.PI / 2;
    }
    box('front-intake', .35,.17,.055,black,side*.64,.42,half-.02);
    box('headlamp-housing', .49,.13,.07,black,side*.65,.68,half-.01);
    for(const offset of [-.13,.1]) {
      const lamp=box('LED-running-light',.13,.025,.08,white,side*.65+offset,.68,half+.025);
      lamp.rotation.z = side*.13;
    }
    box('tail-light', .64,.075,.055,red,side*.58,.73,-half-.01);
    box('tail-light-lower', .035,.11,.05,red,side*.87,.69,-half-.02);
  }
  const wideKidney = modelType === 'm5';
  for (const side of [-1, 1]) {
    box('kidney-surround',wideKidney?.40:.29,wideKidney?.25:.43,.065,silver,side*(wideKidney?.22:.17),wideKidney?.60:.52,half+.01,.055);
    box('kidney-grille',wideKidney?.35:.24,wideKidney?.20:.38,.075,black,side*(wideKidney?.22:.17),wideKidney?.60:.52,half+.03,.04);
    for(let i=-1;i<=1;i++)box('grille-slat',.012,wideKidney?.17:.34,.02,modelType==='i4'?caliper:silver,side*(wideKidney?.22:.17)+i*.065,wideKidney?.60:.52,half+.075);
  }
  box('front-splitter',p.width*.92,.045,.18,black,0,.29,half-.02);
  box('rear-diffuser',1.45,.17,.11,black,0,.31,-half);
  box('rear-lip',1.56,.045,.15,modelType==='m4'?black:paint,0,.86,-half+.18);
  for(const z of [half+.065,-half-.065]) {
    const badge = mesh(new THREE.CircleGeometry(.055,24),silver,'roundel',0,.77,z);
    if(z<0) badge.rotation.y=Math.PI;
    for(let i=0;i<4;i++) {
      const sector = new THREE.Mesh(new THREE.CircleGeometry(.043,8,i*Math.PI/2,Math.PI/2),i%2?white:caliper);
      sector.position.z=.002; badge.add(sector);
    }
  }
  const radius=.355, wheelWidth=.24;
  for (const side of [-1,1]) for(const front of [true,false]) {
    const pivot = new THREE.Group(); pivot.position.set(side*(p.width/2-.06),radius,(front?1:-1)*p.wheelbase/2); group.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const tire = mesh(new THREE.TorusGeometry(radius-.065,.065,12,40),rubber,'tire',0,0,0,spin); tire.rotation.y=Math.PI/2; tire.scale.z=wheelWidth/.13;
    const face=side*(wheelWidth/2+.004);
    const rim=mesh(new THREE.TorusGeometry(.252,.018,8,32),silver,'rim',face,0,0,spin);rim.rotation.y=Math.PI/2;
    const disc=mesh(new THREE.CylinderGeometry(.218,.218,.018,32),silver,'brake-disc',side*.07,0,0,pivot);disc.rotation.z=Math.PI/2;
    box('brake-caliper',.06,.17,.09,caliper,side*.09,.05,-.17,.02,pivot);
    const hub=mesh(new THREE.CylinderGeometry(.065,.065,.035,16),black,'hub',face,0,0,spin);hub.rotation.z=Math.PI/2;
    for(let i=0;i<5;i++)for(const split of [-1,1]) {
      const angle=i*Math.PI*2/5+split*.10;
      const spoke=box('split-spoke',.025,.20,.022,silver,face,Math.cos(angle)*.15,Math.sin(angle)*.15,.006,spin);spoke.rotation.x=angle;
    }
    wheels.push({steeringPivot:pivot,spinGroup:spin,radius,isFront:front});
  }
  if(modelType!=='i4')for(const side of [-1,1])for(const offset of [-.07,.07]) {
    const x=side*.61+offset;
    const pipe=mesh(new THREE.CylinderGeometry(.048,.048,.16,16,true),silver,'exhaust-pipe',x,.27,-half-.03);pipe.rotation.x=Math.PI/2;
    const flame=mesh(new THREE.ConeGeometry(.037,.25,10),new THREE.MeshBasicMaterial({color:'#ff742b',transparent:true,opacity:.85}),'exhaust-flame',x,.27,-half-.20);
    flame.rotation.x=-Math.PI/2;flame.visible=false;exhaustFlames.push(flame);
  }

  // --- Car Geometry Enhancements ---
  // Hood lines (M3/M4 style)
  const hoodLineGeo = new THREE.PlaneGeometry(1.45, 0.015);
  const hoodLineMat = new THREE.MeshStandardMaterial({color: 0x000000, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.4});
  const hoodLine = mesh(hoodLineGeo, hoodLineMat, 'hood-line', 0, .66, half * 0.65);

  // Side vents (M Performance style)
  for (const side of [-1, 1]) {
    const ventGeo = new THREE.BoxGeometry(0.35, 0.025, 0.055);
    const vent = box(`side-vent-${side}`, 0.35, 0.025, 0.055, black, side*.85, .66, half - .12);
    // Add vertical slats to vent
    for(let i=-1; i<=1; i+=0.5) {
       box(`vent-slat-${side}-${i}`, 0.025, 0.02, 0.06, black, side*.85 + (i*0.08), .665, half - .12);
    }
  }

  // Fog lamps (front bumper)
  if (modelType !== 'i4') {
    const fogLampGeo = new THREE.CircleGeometry(0.038, 16);
    const fogLampMat = new THREE.MeshStandardMaterial({color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 0.5});
    for (const side of [-1, 1]) {
      mesh(fogLampGeo, fogLampMat, `fog-lamp-${side}`, side*.62, .37, half - .05);
    }
  }

  // Windshield wiper
  const wiperArmGeo = new THREE.BoxGeometry(0.025, 0.025, 0.65);
  const wiperArm = box('wiper-arm', 0.025, 0.025, 0.65, black, .42, 1.05, .45);
  wiperArm.rotation.z = 0.2;
  wiperArm.rotation.y = -0.1;

  // M5 Rear Spoiler (High Downforce Wing)
  if (modelType === 'm5') {
    const wingSupportGeo = new THREE.BoxGeometry(0.08, 0.25, 0.12);
    const wingSupport = box('wing-support-l', 0.08, 0.25, 0.12, black, .65, 1.15, -half + .38);
    const wingSupportR = box('wing-support-r', 0.08, 0.25, 0.12, black, -.65, 1.15, -half + .38);

    const wingGeo = new THREE.BoxGeometry(1.65, 0.04, 0.22);
    const wing = box('rear-wing', 1.65, 0.04, 0.22, paint, 0, 1.32, -half + .38, 0.03);

    // Endplates
    const plateGeo = new THREE.BoxGeometry(0.04, 0.28, 0.25);
    box('wing-plate-l', 0.04, 0.28, 0.25, carbon, 0.84, 1.22, -half + .38, 0.02);
    box('wing-plate-r', 0.04, 0.28, 0.25, black, -0.84, 1.22, -half + .38, 0.02);
  }

  return {group, wheels, bodyMaterials, exhaustFlames};
}
