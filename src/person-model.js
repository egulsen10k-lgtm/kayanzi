import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PERSON_STYLES = Object.freeze(['casual', 'goth', 'turkish', 'turkish-sunroof']);

const STYLE_PALETTES = {
  casual: { shirt:'#d38a43', trousers:'#273343', skin:'#e4b99a', hair:'#e5bd62', shoes:'#f1eae0', eyes:'#427b83', brows:'#826138', lips:'#bb7774', liner:'#705a51', metal:'#d3a65a', trim:'#f5e7d4' },
  goth: { shirt:'#211f2b', trousers:'#191923', skin:'#dcc1b6', hair:'#15151c', shoes:'#15151b', eyes:'#697d88', brows:'#262029', lips:'#723c59', liner:'#18151d', metal:'#aab1bd', trim:'#554b64' },
  turkish: { shirt:'#aa313a', trousers:'#252c3b', skin:'#c99575', hair:'#34221e', shoes:'#e8d4ba', eyes:'#604633', brows:'#3f2822', lips:'#ae5555', liner:'#3b2a29', metal:'#d4af62', trim:'#e5ba83' },
  'turkish-sunroof': { shirt:'#edebe8', trousers:'#31384b', skin:'#c99575', hair:'#34221e', shoes:'#e8d4ba', eyes:'#604633', brows:'#3f2822', lips:'#ae5555', liner:'#3b2a29', metal:'#d4af62', trim:'#b53647' },
  driver: { shirt:'#d38a43', trousers:'#273343', skin:'#d9af90', hair:'#302824', shoes:'#172027', eyes:'#427b83', brows:'#46352b', lips:'#a8746a', liner:'#604d3f', metal:'#d9af90', trim:'#e5e1d9' },
};

// Forward is +Z. Standing people use a ground-level origin; seated people use
// their hip as the origin so the same figure fits different vehicle cabins.
export function createPerson({ color, seated = false, female = true, style = 'casual' } = {}) {
  const person = new THREE.Group();
  person.name = 'person';
  const selectedStyle = female && STYLE_PALETTES[style] && style !== 'driver' ? style : female ? 'casual' : 'driver';
  const palette = { ...STYLE_PALETTES[selectedStyle], ...(color ? { shirt: color } : {}) };
  const mat = (key, roughness = .9) => new THREE.MeshStandardMaterial({ color:palette[key], roughness });
  const shirt = mat('shirt'), trousers = mat('trousers', 1), skin = mat('skin');
  const hair = mat('hair', 1), shoes = mat('shoes', .85), eyes = mat('eyes', .6);
  const brows = mat('brows'), lips = mat('lips'), liner = mat('liner');
  const metal = mat('metal', .4), trim = mat('trim');
  const softBox = (x,y,z) => new RoundedBoxGeometry(x,y,z,2,Math.min(.035,x/4,y/4,z/4));
  function part(name, geometry, material, x, y, z, parent = person) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const hipY = seated ? 0 : .86;
  const torsoY = hipY + (seated ? .25 : .27);
  const torso = part('shirt', new THREE.LatheGeometry([
    new THREE.Vector2(.15, -.24), new THREE.Vector2(.17, -.17),
    new THREE.Vector2(.135, -.04), new THREE.Vector2(.18, .15),
    new THREE.Vector2(.155, .23), new THREE.Vector2(.07, .25)
  ], 12), shirt, 0, torsoY, 0);
  torso.scale.z = .7;
  if (seated) torso.scale.y = .88;
  part('hips', softBox(.34, .18, .24), trousers, 0, hipY, 0);
  part('belt', softBox(.35,.045,.25), trim, 0, hipY+.075, 0);
  part('neck', new THREE.CylinderGeometry(.065, .065, .12, 6), skin, 0, hipY + .49, 0);
  const headY = hipY + (seated ? .61 : .66);
  const head = part('head', new THREE.SphereGeometry(.16, 12, 10), skin, 0, headY, .015);
  head.scale.set(.85, 1.06, .9);
  if (female) {
    const cap=part('blonde-crown', new THREE.SphereGeometry(.172,12,8,0,Math.PI*2,0,Math.PI*.52),hair,0,headY+.025,-.01);
    cap.scale.set(.9,1.05,1);
    const backHair=part('long-blonde-hair',softBox(.28,.38,.12),hair,0,headY-.08,-.125);
    if(selectedStyle==='goth') backHair.scale.y=1.25;
    if(selectedStyle.startsWith('turkish')) backHair.scale.set(1.1,1.14,1);
    const fringe=part('fringe',softBox(.22,.055,.06),hair,0,headY+.118,.105);
    fringe.rotation.z=selectedStyle==='goth' ? -.19 : .12;
    for (const side of [-1,1]) {
      const lock=part('face-framing-hair',new THREE.SphereGeometry(1,8,8),hair,side*.135,headY-.06,-.005);
      lock.scale.set(selectedStyle.startsWith('turkish') ? .056 : .043,selectedStyle==='goth' ? .27 : .23,.065);
      lock.rotation.z=side*(selectedStyle.startsWith('turkish') ? .23 : .12);
      const hoop=part('earring',new THREE.TorusGeometry(.024,.005,4,8),metal,side*.148,headY-.09,.055);
      hoop.rotation.y=side*.45;
    }
  } else part('hair',softBox(.29,.10,.28),hair,0,headY+.16,-.015);
  part('nose',new THREE.SphereGeometry(.026,6,6),skin,0,headY-.018,.166);
  part('smile',softBox(.058,.012,.014),lips,0,headY-.072,.154);
  for (const side of [-1, 1]) {
    part('eye',new THREE.SphereGeometry(.019,8,6),eyes,side*.052,headY+.022,.155);
    part('eyeliner',softBox(.053,.009,.014),liner,side*.052,headY+.041,.156);
    part('eyebrow',softBox(.041,.009,.012),brows,side*.052,headY+.061,.15);
  }
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? 'left-arm' : 'right-arm';
    arm.position.set(side * .235, hipY + .43, 0);
    person.add(arm);
    part('sleeve', softBox(.13, .25, .15), shirt, 0, -.10, 0, arm);
    part('forearm', softBox(.10, .24, .11), skin, 0, -.32, 0, arm);
    part('hand', softBox(.11, .12, .12), skin, 0, -.47, 0, arm);
    part('cuff', softBox(.125,.033,.145), trim, 0, -.20, 0, arm);
    if (seated) arm.rotation.x = -.9;
    arms.push(arm);
    const leg = new THREE.Group();
    leg.name = side < 0 ? 'left-leg' : 'right-leg';
    leg.position.set(side * .095, hipY, 0);
    person.add(leg);
    if (seated) {
      part('thigh', softBox(.145, .16, .38), trousers, 0, -.025, .17, leg);
      part('shin', softBox(.13, .38, .14), trousers, 0, -.23, .33, leg);
      part('shoe', softBox(.15, .09, .25), shoes, 0, -.43, .39, leg);
    } else {
      part('leg', softBox(.145, .75, .16), trousers, 0, -.40, 0, leg);
      part('shoe', softBox(.16, .10, .28), shoes, 0, -.81, .055, leg);
    }
    legs.push(leg);
  }
  person.userData.arms = arms;
  person.userData.legs = legs;
  person.userData.seated = seated;
  person.userData.style = selectedStyle;
  person.userData.palette = Object.freeze(palette);
  const partColors = {};
  person.traverse(object => { if (object.isMesh) partColors[object.name] = `#${object.material.color.getHexString()}`; });
  person.userData.partColors = Object.freeze(partColors);
  person.userData.appearance = female ? selectedStyle==='casual' ? 'adult-blonde-woman' : `adult-${selectedStyle}-woman` : 'adult-driver';
  return person;
}
