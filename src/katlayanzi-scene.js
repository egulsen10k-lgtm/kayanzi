import * as THREE from 'three';
import { createRobotModel } from './robot-runner-view.js';
import { createCasinoDealer, animateCasinoDealer } from './katlayanzi-dealer.js';

const PALETTE=['#2d70a6','#b24b45','#5b8c65','#8a65a2','#d09742','#43908f','#a5a9bc','#c36e96'];
const SEAT_ANGLES=[.14,.38,.62,.86,1.12,1.32,1.68,1.88].map(n=>n*Math.PI);
const WHEEL_ORDER=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const mat=(color,metalness=0,roughness=.6)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
function mesh(parent,name,geometry,material,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,material);m.name=name;m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
const box=(parent,name,w,h,d,material,x,y,z)=>mesh(parent,name,new THREE.BoxGeometry(w,h,d),material,x,y,z);
function releaseTree(root,disposeTextures=false){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){materials.add(m);if(disposeTextures&&m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.removeFromParent();}
export function casinoSeatPosition(slot){const angle=SEAT_ANGLES[Math.max(0,Math.min(7,slot))];return {x:Math.cos(angle)*4.15,z:Math.sin(angle)*2.85,heading:Math.atan2(-Math.cos(angle)*4.15,-Math.sin(angle)*2.85)};}
// This renderer receives a private room view: a null card always remains a back.
export function casinoCardKey(card){return card&&/^(A|[2-9]|10|J|Q|K)$/.test(card.rank)&&['♠','♥','♦','♣'].includes(card.suit)?`${card.rank}${card.suit}`:'back';}
function cardTexture(cache,key){
  if(cache.has(key))return cache.get(key);
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=176;const c=canvas.getContext('2d');if(!c)return null;
  c.fillStyle=key==='back'?'#174d3c':'#fff9e8';c.fillRect(0,0,128,176);c.strokeStyle='#c7a15b';c.lineWidth=7;c.strokeRect(6,6,116,164);
  if(key==='back'){c.strokeStyle='#89ab88';c.lineWidth=1;for(let x=-176;x<304;x+=12){c.beginPath();c.moveTo(x,0);c.lineTo(x+176,176);c.stroke();}c.fillStyle='#e4c37c';c.font='bold 46px Georgia';c.textAlign='center';c.fillText('♠',64,105);}
  else {const suit=key.at(-1),rank=key.slice(0,-1);c.fillStyle=['♥','♦'].includes(suit)?'#ad3038':'#153229';c.font='bold 30px Georgia';c.textAlign='left';c.fillText(rank,14,37);c.font='48px Georgia';c.textAlign='center';c.fillText(suit,64,111);c.save();c.translate(128,176);c.rotate(Math.PI);c.font='bold 24px Georgia';c.textAlign='left';c.fillText(rank,14,31);c.restore();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;cache.set(key,texture);return texture;
}
function labelTexture(text){if(typeof document==='undefined')return null;const canvas=document.createElement('canvas');canvas.width=256;canvas.height=56;const c=canvas.getContext('2d');if(!c)return null;c.fillStyle='#0b241ee8';c.fillRect(0,0,256,56);c.strokeStyle='#d1b36d';c.strokeRect(1,1,254,54);c.font='600 23px system-ui';c.fillStyle='#fff0c9';c.textAlign='center';c.textBaseline='middle';c.fillText(String(text).slice(0,20),128,28);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;}
function makeLabel(text){const texture=labelTexture(text);if(!texture)return null;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.scale.set(1.45,.32,1);sprite.position.y=2.45;sprite.name='casino-player-name';return sprite;}
function chair(root,slot,wood,velvet,brass){const p=casinoSeatPosition(slot),g=new THREE.Group();g.name=`casino-chair-${slot}`;g.position.set(p.x,0,p.z);g.rotation.y=p.heading;root.add(g);box(g,'chair-seat',1.15,.18,.95,velvet,0,.7,0);box(g,'chair-back',1.14,1.22,.16,wood,0,1.18,-.48);box(g,'chair-back-cushion',.94,1.03,.12,velvet,0,1.2,-.37);for(const x of [-.43,.43])for(const z of [-.33,.33])box(g,'chair-leg',.085,.65,.085,brass,x,.34,z);return g;}
function makeWheel(parent){const g=new THREE.Group();g.name='casino-roulette-wheel';g.position.set(.6,1.46,0);parent.add(g);const wood=mat('#513222',.12,.3),gold=mat('#d1aa57',.8,.24);mesh(g,'roulette-bowl',new THREE.CylinderGeometry(.9,.78,.12,64),wood);const track=mesh(g,'roulette-brass-rim',new THREE.TorusGeometry(.84,.045,8,64),gold,0,.09,0);track.rotation.x=Math.PI/2;const rotor=new THREE.Group();rotor.name='roulette-rotor';g.add(rotor);WHEEL_ORDER.forEach((number,i)=>{const a=i*Math.PI*2/37;const sector=new THREE.CircleGeometry(.7,3,a,Math.PI*2/37-.009);sector.rotateX(-Math.PI/2);const m=mesh(rotor,`roulette-pocket-${number}`,sector,mat(number===0?'#206b4d':RED.has(number)?'#a82c35':'#142925'),0,.087,0);m.userData.number=number;});mesh(g,'roulette-spindle',new THREE.CylinderGeometry(.09,.22,.38,24),gold,0,.23,0);mesh(g,'roulette-ball',new THREE.SphereGeometry(.045,12,8),mat('#fff6dd',.3,.2),.75,.13,0);g.userData.rotor=rotor;return g;}

export function buildCasinoLounge(){
  const root=new THREE.Group();root.name='katlayanzi-3d-lounge';
  const wood=mat('#402b21',.12,.4),gold=mat('#c5a25b',.72,.26),felt=mat('#155b3f',0,.9),velvet=mat('#1d4138',0,.92),stone=mat('#c3b89b',.08,.8);
  box(root,'lounge-floor',19,.16,15,stone,0,-.1,0);
  for(let x=-8;x<=8;x+=2)box(root,'floor-inlay',.025,.008,14,gold,x,0,0);
  box(root,'back-wall',19,1.1,.2,mat('#b3a88d'),0,.5,-6.5);
  const glass=new THREE.MeshPhysicalMaterial({color:'#b7dfdf',transparent:true,opacity:.16,metalness:.15,roughness:.08,side:THREE.DoubleSide,depthWrite:false});
  for(const x of [-7,-3.5,0,3.5,7])box(root,'sunroof-column',.12,7.2,.12,gold,x,3.5,-6.3);
  for(const z of [-6.3,-3,0,3.5]){box(root,'sunroof-frame',14.2,.12,.12,gold,0,7.1,z);if(z<3.5)box(root,'glass-sunroof',14,.03,2.85,glass,0,7.12,z+1.5);}
  for(const x of [-7,0,7])box(root,'sunroof-crossbeam',.13,.14,10,gold,x,7.08,-1.45);
  for(const x of [-7,7]){box(root,'side-column',.18,7.2,.18,gold,x,3.5,3.5);box(root,'window-glass',.04,5.5,9,glass,x,3.5,-1.3);}
  for(const x of [-5.8,5.8]){const planter=mesh(root,'planter',new THREE.CylinderGeometry(.55,.38,.9,20),wood,x,.45,-4.8);for(let i=0;i<7;i++){const leaf=mesh(root,'palm-leaf',new THREE.SphereGeometry(.5,8,5),mat('#31583c'),x+Math.sin(i)*.34,1.5+(i%3)*.27,-4.8+Math.cos(i)*.25);leaf.scale.set(.35,1.4,.5);leaf.rotation.z=Math.sin(i)*.6;}planter.castShadow=true;}
  const base=mesh(root,'table-pedestal',new THREE.CylinderGeometry(.72,1.05,1.04,32),wood,0,.54,0);base.scale.x=1.5;
  const rim=mesh(root,'oval-wood-table',new THREE.CylinderGeometry(1,1,.22,96),wood,0,1.18,0);rim.scale.set(3.72,1,2.12);
  const top=mesh(root,'oval-emerald-felt',new THREE.CylinderGeometry(1,1,.035,96),felt,0,1.31,0);top.scale.set(3.46,1,1.86);
  const rail=mesh(root,'padded-table-rail',new THREE.TorusGeometry(1,.06,12,96),velvet,0,1.34,0);rail.scale.set(3.58,1.99,1);rail.rotation.x=Math.PI/2;
  const stripe=mesh(root,'brass-table-inlay',new THREE.TorusGeometry(1,.008,6,96),gold,0,1.337,0);stripe.scale.set(3.30,1.72,1);stripe.rotation.x=Math.PI/2;
  for(let slot=0;slot<8;slot++)chair(root,slot,wood,velvet,gold);
  const cards=new THREE.Group();cards.name='casino-table-cards';root.add(cards);
  const dealer=createCasinoDealer();dealer.name='casino-dealer';dealer.position.set(0,0,-2.65);dealer.scale.setScalar(1.3);dealer.rotation.y=0;root.add(dealer);
  const wheel=makeWheel(root);wheel.visible=false;
  root.traverse(object=>{if(object.material===glass){object.castShadow=false;object.receiveShadow=false;}});
  root.userData={players:new Map(),cards,textureCache:new Map(),dealer,wheel,signature:'',round:null,dealtAt:0,spinFrom:0,spinTo:0,spinStarted:0};
  return root;
}

export function updateCasinoLounge(root,raw={}){
  raw=raw&&typeof raw==='object'?raw:{};
  const seen=new Set();
  const players=(Array.isArray(raw.players)?raw.players:[]).filter(p=>p&&typeof p.id==='string'&&p.id&&!seen.has(p.id)&&(seen.add(p.id),true)).slice(0,8);
  const data=root.userData,ids=new Set(players.map(p=>p.id));
  for(const [id,record]of data.players)if(!ids.has(id)){releaseTree(record.group,true);data.players.delete(id);}
  const occupied=new Set([...data.players.values()].map(p=>p.slot));
  for(const player of players){
    let record=data.players.get(player.id);
    if(!record){let slot=0;while(occupied.has(slot))slot++;occupied.add(slot);const p=casinoSeatPosition(slot),group=new THREE.Group();group.name=`casino-player-${player.id}`;group.userData.peerId=player.id;group.position.set(p.x,0,p.z);group.rotation.y=p.heading;root.add(group);const robot=createRobotModel(PALETTE[slot]);robot.scale.setScalar(.78);const rig=robot.userData.rig;rig.motion.position.y=-.25;rig.torso.rotation.x=.10;for(const side of ['left','right']){rig[`${side}Leg`].rotation.x=-1.45;rig[`${side}Knee`].rotation.x=1.45;rig[`${side}Arm`].rotation.x=-.65;rig[`${side}Elbow`].rotation.x=-1.1;}group.add(robot);const ring=mesh(group,'seat-indicator',new THREE.TorusGeometry(.63,.027,6,40),mat('#cbb374',.6),0,.03,0);ring.rotation.x=-Math.PI/2;record={slot,group,robot,ring,name:null,label:null};data.players.set(player.id,record);}
    record.group.userData.isLocal=player.id===raw.meId;record.group.userData.isTurn=player.id===raw.turnId;
    const color=player.id===raw.turnId?'#ffe18b':player.id===raw.meId?'#67d9d2':'#766a49';record.ring.material.color.set(color);record.ring.material.emissive.set(color);record.ring.material.emissiveIntensity=player.id===raw.turnId?.55:.14;
    const name=String(player.name||'Driver').slice(0,20)+(player.id===raw.meId?' · You':'');if(name!==record.name){if(record.label)releaseTree(record.label,true);record.label=makeLabel(name);if(record.label)record.group.add(record.label);record.name=name;}
  }
  const signature=JSON.stringify([raw.game,raw.round,raw.phase,players.map(p=>[p.id,p.bet,p.hand]),raw.dealer,raw.roulette]);if(signature===data.signature)return;data.signature=signature;
  if(data.round!==raw.round){data.round=raw.round;data.dealtAt=globalThis.performance?.now?.()??0;}
  const priorCards=new Set(data.cards.children.filter(c=>c.userData.cardKey).map(c=>c.name+':'+c.userData.cardKey));
  for(const child of [...data.cards.children])releaseTree(child);
  const addHand=(hand,x,z,heading,owner)=>{if(!Array.isArray(hand))return;hand.slice(0,24).forEach((card,i)=>{const key=casinoCardKey(card),material=new THREE.MeshStandardMaterial({map:cardTexture(data.textureCache,key),color:key==='back'?'#a8c2a5':'#fff2d0',roughness:.7,side:THREE.DoubleSide});const c=mesh(data.cards,`casino-card-${owner}-${i}`,new THREE.PlaneGeometry(.30,.43),material);c.rotation.set(-Math.PI/2,0,-heading);const offset=(i-(Math.min(hand.length,24)-1)/2)*.23;c.position.set(x+Math.cos(heading)*offset,1.345+i*.0007,z-Math.sin(heading)*offset);c.userData.cardKey=key;c.userData.ownerId=owner;c.userData.dealTarget=c.position.clone();c.userData.dealStarted=(globalThis.performance?.now?.()??0)+(priorCards.has(c.name+':'+key)?-1000:i*70);});};
  players.forEach(player=>{const seat=data.players.get(player.id),a=SEAT_ANGLES[seat.slot],x=Math.cos(a)*2.5,z=Math.sin(a)*1.33;addHand(player.hand,x,z,seat.group.rotation.y,player.id);const stack=new THREE.Group();stack.name=`casino-chips-${player.id}`;const count=player.bet?Math.min(8,Math.max(1,Math.ceil(player.bet/25))):2;for(let i=0;i<count;i++)mesh(stack,'chip',new THREE.CylinderGeometry(.105,.105,.035,16),mat(i%2?'#e6c782':PALETTE[seat.slot],.12),x+.5,1.35+i*.038,z);data.cards.add(stack);});
  addHand(raw.dealer,0,-.9,Math.PI,'dealer');
  data.wheel.visible=raw.game==='roulette';
  if(raw.roulette&&Number.isInteger(raw.roulette.number)&&data.lastNumber!==`${raw.round}:${raw.roulette.number}`){data.lastNumber=`${raw.round}:${raw.roulette.number}`;data.spinFrom=data.wheel.userData.rotor.rotation.y;const target=-(WHEEL_ORDER.indexOf(raw.roulette.number)+.5)*Math.PI*2/37;data.spinTo=data.spinFrom+Math.PI*6+((target-data.spinFrom)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);data.spinStarted=globalThis.performance?.now?.()??0;}
  data.view={game:raw.game,phase:raw.phase,round:raw.round};
}

export class KatlayanziScene {
  constructor({container,reducedMotion=false}={}){
    this.container=container;this.reducedMotion=reducedMotion;this.active=false;this.disposed=false;this.frame=null;this.renderer=null;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#a8b9ad');this.scene.fog=new THREE.Fog('#a8b9ad',22,48);
    this.scene.add(new THREE.HemisphereLight('#fff9e4','#3d584c',2));const sun=new THREE.DirectionalLight('#ffe4b6',3.2);sun.position.set(-5,12,6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.05;this.scene.add(sun);const fill=new THREE.PointLight('#d5f4ed',35,25);fill.position.set(3,5,-3);this.scene.add(fill);
    this.camera=new THREE.PerspectiveCamera(35,1,.1,80);this.lounge=buildCasinoLounge();this.scene.add(this.lounge);
    try{if(!container||typeof document==='undefined')return;this.renderer=new THREE.WebGLRenderer({antialias:container.clientWidth>600,alpha:false,powerPreference:'low-power'});this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;this.renderer.shadowMap.enabled=container.clientWidth>600;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.domElement.setAttribute('aria-label','3D Katlayanzi table with seated robot players and a dealer');this.renderer.domElement.setAttribute('role','img');this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;';container.append(this.renderer.domElement);this.resize();if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);}}
    catch{this.observer?.disconnect();this.renderer?.domElement.remove();this.renderer?.dispose();this.renderer=null;if(container&&typeof document!=='undefined'){this.fallback=document.createElement('p');this.fallback.textContent='3D view unavailable on this device. All table controls remain available below.';this.fallback.style.cssText='padding:24px;color:#e8d6a1;text-align:center';container.append(this.fallback);}}
  }
  resize(){if(!this.renderer||this.disposed)return;const width=Math.max(1,this.container?.clientWidth||1),height=Math.max(1,this.container?.clientHeight||1);this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,width<600?1:1.5));this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.position.set(5.8,5.1,8);if(this.camera.aspect<1.5)this.camera.position.set(8.4,6.8,11.8);this.camera.lookAt(0,1.1,0);this.camera.updateProjectionMatrix();if(this.active)this._render(globalThis.performance?.now?.()??0);}
  update(view){if(this.disposed)return;this.view=view;updateCasinoLounge(this.lounge,view);if(this.active)this._render(globalThis.performance?.now?.()??0);}
  _render(now){if(!this.renderer||this.disposed)return;const data=this.lounge.userData;for(const card of data.cards.children){const target=card.userData.dealTarget;if(!target)continue;const t=this.reducedMotion?1:Math.min(1,Math.max(0,(now-card.userData.dealStarted)/550));card.position.set(THREE.MathUtils.lerp(0,target.x,t),THREE.MathUtils.lerp(1.65,target.y,t),THREE.MathUtils.lerp(-1.4,target.z,t));}const duration=this.reducedMotion?0:2800,t=duration?Math.min(1,Math.max(0,(now-data.spinStarted)/duration)):1;data.wheel.userData.rotor.rotation.y=THREE.MathUtils.lerp(data.spinFrom,data.spinTo,1-(1-t)**3);animateCasinoDealer(data.dealer,{time:this.reducedMotion?0:now/1000,...data.view});if(!this.reducedMotion)for(const record of data.players.values()){record.robot.userData.rig.head.rotation.y=Math.sin(now*.0006+record.slot)*.07;}this.renderer.render(this.scene,this.camera);}
  setActive(active){if(this.disposed)return;this.active=Boolean(active);if(this.frame!==null){globalThis.cancelAnimationFrame?.(this.frame);this.frame=null;}if(!this.active||!this.renderer)return;this.resize();if(this.reducedMotion){this._render(0);return;}const loop=now=>{if(!this.active||this.disposed)return;if(!this.lastFrame||now-this.lastFrame>1000/(this.container.clientWidth<600?30:60)){this.lastFrame=now;this._render(now);}this.frame=globalThis.requestAnimationFrame?.(loop)??null;};if(typeof requestAnimationFrame==='function')this.frame=requestAnimationFrame(loop);else this._render(0);}
  dispose(){if(this.disposed)return;this.setActive(false);this.disposed=true;this.observer?.disconnect();const textures=new Set(this.lounge.userData.textureCache.values());this.lounge.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material])if(material?.map)textures.add(material.map);});releaseTree(this.lounge);textures.forEach(t=>t.dispose());this.lounge.userData.textureCache.clear();this.lounge.clear();this.scene.traverse(object=>object.shadow?.dispose?.());this.renderer?.dispose();this.renderer?.forceContextLoss();this.renderer?.domElement.remove();this.fallback?.remove();this.renderer=null;}
}
