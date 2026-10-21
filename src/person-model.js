import * as THREE from 'three';

// Forward is +Z. Standing people use a ground-level origin; seated people use
// their hip as the origin so the same figure fits different vehicle cabins.
export function createPerson({ color = '#d38a43', seated = false } = {}) {
  const person = new THREE.Group();
  person.name = 'person';
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: .9 });
  const trousers = new THREE.MeshStandardMaterial({ color: '#273343', roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: '#d6a07b', roughness: .9 });
  const hair = new THREE.MeshStandardMaterial({ color: '#302824', roughness: 1 });
  const shoes = new THREE.MeshStandardMaterial({ color: '#172027', roughness: .85 });
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
  part('shirt', new THREE.BoxGeometry(.38, seated ? .43 : .49, .23), shirt, 0, torsoY, 0);
  part('hips', new THREE.BoxGeometry(.31, .16, .22), trousers, 0, hipY, 0);
  part('neck', new THREE.CylinderGeometry(.065, .065, .12, 6), skin, 0, hipY + .49, 0);
  const headY = hipY + (seated ? .61 : .66);
  const head = part('head', new THREE.IcosahedronGeometry(.17, 1), skin, 0, headY, .015);
  head.scale.set(.85, 1.06, .9);
  part('hair', new THREE.BoxGeometry(.29, .10, .28), hair, 0, headY + .16, -.015);
  for (const side of [-1, 1]) {
    part('eye', new THREE.BoxGeometry(.025, .025, .018), hair, side * .055, headY + .015, .157);
  }
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? 'left-arm' : 'right-arm';
    arm.position.set(side * .235, hipY + .43, 0);
    person.add(arm);
    part('sleeve', new THREE.BoxGeometry(.13, .25, .15), shirt, 0, -.10, 0, arm);
    part('forearm', new THREE.BoxGeometry(.10, .24, .11), skin, 0, -.32, 0, arm);
    part('hand', new THREE.BoxGeometry(.11, .12, .12), skin, 0, -.47, 0, arm);
    if (seated) arm.rotation.x = -.9;
    arms.push(arm);
    const leg = new THREE.Group();
    leg.name = side < 0 ? 'left-leg' : 'right-leg';
    leg.position.set(side * .095, hipY, 0);
    person.add(leg);
    if (seated) {
      part('thigh', new THREE.BoxGeometry(.145, .16, .38), trousers, 0, -.025, .17, leg);
      part('shin', new THREE.BoxGeometry(.13, .38, .14), trousers, 0, -.23, .33, leg);
      part('shoe', new THREE.BoxGeometry(.15, .09, .25), shoes, 0, -.43, .39, leg);
    } else {
      part('leg', new THREE.BoxGeometry(.145, .75, .16), trousers, 0, -.40, 0, leg);
      part('shoe', new THREE.BoxGeometry(.16, .10, .28), shoes, 0, -.81, .055, leg);
    }
    legs.push(leg);
  }
  person.userData.arms = arms;
  person.userData.legs = legs;
  person.userData.seated = seated;
  return person;
}
