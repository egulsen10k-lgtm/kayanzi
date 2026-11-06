import * as THREE from 'three';

// Feet at Y=0, face toward +Z. Geometry-only model: safe in workers and Node.
export function createCasinoDealer() {
  const group = new THREE.Group();
  group.name = 'casino-dealer-elif';
  group.userData.identity = { name: 'Elif', role: 'Dealer', nationality: 'Turkish', adult: true };
  const material = (color, roughness = .65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const skin = material('#d6a783'), ivory = material('#f5f0df'), emerald = material('#154b39');
  const dark = material('#152c29'), hair = material('#30211f'), gold = material('#cfa958', .3, .65);
  const eyes = material('#4c392f', .3), white = material('#f6eee1', .5), lips = material('#ad6864');
  const body = new THREE.Group(); body.name = 'dealer-body'; group.add(body);
  const mesh = (parent, name, geometry, mat, x, y, z) => {
    const node = new THREE.Mesh(geometry, mat); node.name = name; node.position.set(x, y, z);
    node.castShadow = true; node.receiveShadow = true; parent.add(node); return node;
  };
  const box = (parent,name,w,h,d,mat,x,y,z) => mesh(parent,name,new THREE.BoxGeometry(w,h,d),mat,x,y,z);
  const sphere = (parent,name,r,mat,x,y,z,sx=1,sy=1,sz=1) => {
    const node = mesh(parent,name,new THREE.SphereGeometry(r,16,12),mat,x,y,z); node.scale.set(sx,sy,sz);return node;
  };
  const capsule = (parent,name,r,length,mat,x,y,z) => mesh(parent,name,new THREE.CapsuleGeometry(r,length,4,12),mat,x,y,z);

  // Professional tailored trousers and low shoes.
  box(body,'dealer-hips',.29,.16,.19,dark,0,.83,0);
  for(const side of [-1,1]) {
    capsule(body,'dealer-trouser-leg',.061,.57,dark,side*.079,.43,0);
    const shoe=box(body,'dealer-shoe',.115,.085,.23,dark,side*.079,.043,.045);
    sphere(body,'dealer-shoe-toe',.057,dark,side*.079,.046,.15,1,.55,.65);
    shoe.rotation.y=-side*.04;
  }
  const torso = mesh(body,'dealer-ivory-blouse',new THREE.LatheGeometry([
    new THREE.Vector2(.135,-.22),new THREE.Vector2(.145,-.15),new THREE.Vector2(.13,-.04),
    new THREE.Vector2(.16,.10),new THREE.Vector2(.175,.18),new THREE.Vector2(.09,.22)
  ],20),ivory,0,1.12,0);torso.scale.z=.7;
  box(body,'dealer-waistband',.285,.035,.205,emerald,0,.91,.003);
  // Two fitted front panels leave the ivory blouse visible in the centre.
  for(const side of [-1,1]) {
    const panel=box(body,'dealer-waistcoat-panel',.11,.32,.025,emerald,side*.085,1.095,.113);
    panel.rotation.z=-side*.08;
    const lapel=box(body,'dealer-lapel',.032,.17,.028,emerald,side*.068,1.275,.105);lapel.rotation.z=side*.45;
    const collar=box(body,'dealer-collar',.063,.065,.025,ivory,side*.04,1.341,.08);collar.rotation.z=side*.38;
  }
  for(let i=0;i<3;i++)sphere(body,'dealer-gold-button',.009,gold,0,1.02+i*.07,.135,1,1,.45);
  capsule(body,'dealer-neck',.047,.075,skin,0,1.405,.003);
  const head = new THREE.Group();head.name='dealer-head';head.position.set(0,1.55,.012);body.add(head);
  sphere(head,'dealer-face',.128,skin,0,0,0,.82,1.08,.86);
  sphere(head,'dealer-hair-crown',.135,hair,0,.047,-.025,.86,.82,.88);
  sphere(head,'dealer-hair-back',.12,hair,0,-.006,-.063,.9,1.06,.65);
  sphere(head,'dealer-hair-bun',.068,hair,0,.015,-.163,1,.95,.85);
  const part = box(head,'dealer-hair-part',.008,.073,.01,dark,.015,.113,-.004);part.rotation.z=.12;
  for(const side of [-1,1]) {
    sphere(head,'dealer-ear',.025,skin,side*.106,-.006,-.005,.6,1,.65);
    sphere(head,'dealer-eye-white',.022,white,side*.044,.015,.099,1,.48,.34);
    sphere(head,'dealer-iris',.010,eyes,side*.044,.015,.106,.75,1,.35);
    sphere(head,'dealer-pupil',.005,dark,side*.044,.015,.110,.85,1,.4);
    sphere(head,'dealer-eye-highlight',.0025,white,side*.041,.018,.112);
    const brow=box(head,'dealer-eyebrow',.039,.006,.008,hair,side*.045,.044,.096);brow.rotation.z=-side*.10;
    sphere(head,'dealer-cheek',.030,skin,side*.058,-.033,.084,1,.65,.45);
    const earring=mesh(head,'dealer-gold-earring',new THREE.TorusGeometry(.012,.0035,6,14),gold,side*.111,-.036,.001);earring.rotation.y=side*.25;
    const lock=capsule(head,'dealer-side-hair',.019,.090,hair,side*.098,.035,.025);lock.rotation.z=side*.12;
  }
  sphere(head,'dealer-nose',.017,skin,0,-.014,.109,.7,1.15,1);
  const smile=mesh(head,'dealer-smile',new THREE.TorusGeometry(.024,.0035,6,16,Math.PI*.62),lips,0,-.050,.101);
  smile.rotation.z=Math.PI*1.19;
  sphere(head,'dealer-lower-lip',.020,lips,0,-.055,.104,1,.20,.2);

  // Name badge carries the character's identity without cultural caricature.
  const badge=box(body,'dealer-name-badge',.105,.055,.009,gold,-.088,1.19,.133);
  badge.userData.label='Elif · Dealer';
  const badgeInk=material('#183d2c');
  const glyphs={E:['111','100','110','100','111'],L:['100','100','100','100','111'],I:['111','010','010','010','111'],F:['111','100','110','100','100']};
  const pixels=[];let cursor=-.041;
  for(const letter of 'ELIF') {
    glyphs[letter].forEach((row,y)=>[...row].forEach((cell,x)=>{if(cell==='1')pixels.push([cursor+x*.006, .012-y*.006]);}));cursor+=.022;
  }
  const lettering=new THREE.InstancedMesh(new THREE.BoxGeometry(.0045,.0045,.001),badgeInk,pixels.length);
  lettering.name='dealer-badge-lettering';const matrix=new THREE.Matrix4();
  pixels.forEach(([x,y],i)=>{matrix.makeTranslation(x,y,.0055);lettering.setMatrixAt(i,matrix);});lettering.instanceMatrix.needsUpdate=true;badge.add(lettering);
  box(body,'dealer-badge-role',.060,.003,.001,dark,-.088,1.174,.139);

  const arms={};
  for(const side of [-1,1]) {
    const label=side<0?'left':'right';
    const shoulder=new THREE.Group();shoulder.name=`dealer-${label}-shoulder`;shoulder.position.set(side*.19,1.30,0);body.add(shoulder);
    capsule(shoulder,`dealer-${label}-sleeve`,.052,.18,ivory,0,-.12,0);
    const elbow=new THREE.Group();elbow.name=`dealer-${label}-elbow`;elbow.position.y=-.255;shoulder.add(elbow);
    capsule(elbow,`dealer-${label}-forearm`,.039,.18,ivory,0,-.12,0);
    box(elbow,`dealer-${label}-cuff`,.079,.045,.075,ivory,0,-.235,0);
    sphere(elbow,'dealer-cufflink',.006,gold,side*.044,-.233,.008);
    const wrist=new THREE.Group();wrist.name=`dealer-${label}-wrist`;wrist.position.y=-.265;elbow.add(wrist);
    sphere(wrist,'dealer-palm',.040,skin,0,-.028,0,.70,1,.40);
    for(let finger=0;finger<4;finger++)capsule(wrist,'dealer-finger',.0065,.027,skin,(finger-1.5)*.012,-.071-Math.abs(finger-1.5)*-.004,.003);
    const thumb=capsule(wrist,'dealer-thumb',.009,.025,skin,side*.031,-.031,.009);thumb.rotation.z=side*.6;
    arms[label]={shoulder,elbow,wrist};
  }
  group.userData.rig={body,head,arms};
  group.userData.badge='Elif · Dealer';
  animateCasinoDealer(group,{time:0,game:'blackjack',phase:'betting',round:0});
  return group;
}

export function animateCasinoDealer(group,{time=0,game='blackjack',phase='betting',round=0}={}) {
  const rig=group?.userData?.rig;if(!rig)return;
  const t=Number.isFinite(time)?Math.max(0,time)%3600:0;
  const r=Number.isFinite(round)?round%1000:0;
  const active=phase==='playing'||phase==='result';
  const dealing=active&&game!=='roulette';
  const spin=active&&game==='roulette';
  rig.body.position.y=Math.sin(t*1.6)*.003;
  rig.head.rotation.y=Math.sin(t*.47)*.035;
  rig.head.rotation.x=Math.sin(t*.7)*.018;
  const beat=.5+.5*Math.sin(t*3.6+r*.7);
  for(const [name,arm]of Object.entries(rig.arms)) {
    const side=name==='left'?-1:1;
    arm.shoulder.rotation.set(-.13,0,side*.075);
    arm.elbow.rotation.set(-.28,0,0);
    arm.wrist.rotation.set(0,0,0);
    if(dealing){
      const reach=name==='right'?beat:1-beat;
      arm.shoulder.rotation.x=-.42-reach*.54;
      arm.shoulder.rotation.y=side*(.08+reach*.17);
      arm.elbow.rotation.x=-.45-reach*.3;
      arm.wrist.rotation.z=side*.12*reach;
    }else if(spin&&name==='right'){
      arm.shoulder.rotation.set(-1.03,.24+Math.sin(t*2.2)*.20,.12);
      arm.elbow.rotation.x=-.42+Math.cos(t*2.2)*.12;
      arm.wrist.rotation.y=Math.sin(t*2.2)*.32;
    }
  }
}
