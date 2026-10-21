import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Forward is +Z. Standing people use a ground-level origin; seated people use
// their hip as the origin so the same figure fits different vehicle cabins.
export function createPerson({ color = '#d38a43', seated = false, female = true } = {}) {
  const person = new THREE.Group();
  person.name = 'person';
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: .9 });
  const trousers = new THREE.MeshStandardMaterial({ color: '#273343', roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e4b99a', roughness: .9 });
  const hair = new THREE.MeshStandardMaterial({ color: female ? '#e5bd62' : '#302824', roughness: 1 });
  const shoes = new THREE.MeshStandardMaterial({ color: female ? '#f1eae0' : '#172027', roughness: .85 });
  const eyes = new THREE.MeshStandardMaterial({ color: '#427b83', roughness: .6 });
  const brows = new THREE.MeshStandardMaterial({ color: '#826138', roughness: .9 });
  const lips = new THREE.MeshStandardMaterial({ color: '#bb7774', roughness: .9 });
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
  part('neck', new THREE.CylinderGeometry(.065, .065, .12, 6), skin, 0, hipY + .49, 0);
  const headY = hipY + (seated ? .61 : .66);
  const head = part('head', new THREE.SphereGeometry(.16, 12, 10), skin, 0, headY, .015);
  head.scale.set(.85, 1.06, .9);
if (female) {
    const cap=part('blonde-crown', new THREE.SphereGeometry(.172,12,8,0,Math.PI*2,0,Math.PI*.52),hair,0,headY+.025,-.01);
    cap.scale.set(.9,1.05,1);
    part('long-blonde-hair',softBox(.28,.38,.12),hair,0,headY-.08,-.125);
    for (const side of [-1,1]) {
      const lock=part('face-framing-hair',new THREE.SphereGeometry(1,8,8),hair,side*.135,headY-.06,-.005);
      lock.scale.set(.043,.23,.065);lock.rotation.z=side*.12;
    }
  } else part('hair',softBox(.29,.10,.28),hair,0,headY+.16,-.015);
  part('nose',new THREE.SphereGeometry(.026,6,6),skin,0,headY-.018,.166);
  part('smile',softBox(.058,.012,.014),lips,0,headY-.072,.154);
  for (const side of [-1, 1]) {
    part('eye',new THREE.SphereGeometry(.019,8,6),eyes,side*.052,headY+.022,.155);
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
  person.userData.appearance = female ? 'adult-blonde-woman' : 'adult-driver';
  return person;
}
