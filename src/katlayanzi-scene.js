import * as THREE from 'three';
import { createRobotModel } from './robot-runner-view.js';
import { createCasinoDealer, animateCasinoDealer } from './katlayanzi-dealer.js';
import { CASINO_TABLES } from './katlayanzi-lobby.js';

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
  for(const child of root.children)child.userData.loungeArchitecture=true;
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

const DEFAULT_HALL_TABLES=CASINO_TABLES;
function hallTables(tables){return (Array.isArray(tables)?tables:DEFAULT_HALL_TABLES).filter(t=>t&&typeof t.id==='string'&&Number.isFinite(t.x)&&Number.isFinite(t.z)&&Math.abs(t.x)<=11&&t.z>=-8&&t.z<=9).slice(0,8);}
export function moveCasinoWalker(position,input,dt,tables=DEFAULT_HALL_TABLES){
  const x=Number.isFinite(position?.x)?position.x:0,z=Number.isFinite(position?.z)?position.z:10;
  const ix=Number.isFinite(input?.x)?THREE.MathUtils.clamp(input.x,-1,1):0,iz=Number.isFinite(input?.z)?THREE.MathUtils.clamp(input.z,-1,1):0;
  const length=Math.max(1,Math.hypot(ix,iz)),step=3.2*THREE.MathUtils.clamp(Number.isFinite(dt)?dt:0,0,.1);
  const result={x:THREE.MathUtils.clamp(x+ix/length*step,-13,13),z:THREE.MathUtils.clamp(z+iz/length*step,-10,12),heading:Number.isFinite(position?.heading)?position.heading:0};
  for(const table of hallTables(tables)){const dx=result.x-table.x,dz=result.z-table.z,d=Math.hypot(dx,dz);if(d<2.65){const nx=d>1e-5?dx/d:0,nz=d>1e-5?dz/d:1;result.x=table.x+nx*2.65;result.z=table.z+nz*2.65;}}
  if(ix||iz)result.heading=Math.atan2(ix,iz);
  return result;
}
export function nearestCasinoTable(position,tables=DEFAULT_HALL_TABLES){
  if(!Number.isFinite(position?.x)||!Number.isFinite(position?.z))return null;
  let best=null,distance=4.5;
  for(const table of hallTables(tables)){const d=Math.hypot(position.x-table.x,position.z-table.z);if(table.playable===true&&d<=distance){distance=d;best=table;}}
  return best;
}
export function buildCasinoHall(tables=DEFAULT_HALL_TABLES){
  const root=new THREE.Group();root.name='katlayanzi-walkable-hall';
  const stone=mat('#b4aa91',.1,.7),dark=mat('#143c35'),gold=mat('#c8a45a',.65,.3),wood=mat('#35231c',.15,.4),felt=mat('#146b4c');
  box(root,'hall-floor',29,.2,26,stone,0,-.13,1);
  box(root,'hall-carpet',7,.018,24,dark,0,-.015,1);
  for(const x of [-3.5,3.5])box(root,'carpet-gold-border',.045,.02,24,gold,x,.001,1);
  box(root,'hall-back-wall',29,7,.25,dark,0,3.4,-11.5);
  for(const x of [-14.4,14.4])box(root,'hall-side-wall',.25,7,26,dark,x,3.4,1);
  for(const x of [-14,-7,0,7,14]){box(root,'hall-roof-beam',.14,.18,26,gold,x,7,1);for(const z of [-11,...(Math.abs(x)===14?[12]:[])])box(root,'hall-column',.24,7,.24,gold,x,3.4,z);}
  const glass=new THREE.MeshPhysicalMaterial({color:'#b7dfdf',transparent:true,opacity:.11,roughness:.1,side:THREE.DoubleSide,depthWrite:false});
  for(let z=-10;z<12;z+=4){box(root,'hall-sunroof-frame',29,.15,.15,gold,0,7,z);box(root,'hall-glass-sunroof',28.7,.025,3.85,glass,0,7.1,z+2);}
  const welcome=makeLabel('KATLAYANZI');if(welcome){welcome.name='hall-welcome-sign';welcome.scale.set(8,1.8,1);welcome.position.set(0,4.8,-11.2);root.add(welcome);}
  const wallPanel=mat('#203d35'),lamp=mat('#e4c578',.4,.35);lamp.emissive.set('#e4b968');lamp.emissiveIntensity=.55;
  for(const x of [-11,-6,0,6,11]){box(root,'hall-wall-panel',3.4,3.8,.12,wallPanel,x,2.6,-11.30);box(root,'hall-wall-light',.13,1.4,.13,lamp,x,3,-11.18);}
  const ambientGuests=[];
  const validTables=hallTables(tables);
  for(const table of validTables){
    const group=new THREE.Group();group.name=`hall-table-${table.id}`;group.position.set(table.x,0,table.z);group.userData={tableId:table.id,playable:table.playable===true};root.add(group);
    mesh(group,'table-pedestal',new THREE.CylinderGeometry(.5,.8,1.1,16),wood,0,.55,0);
    mesh(group,'table-wood-rim',new THREE.CylinderGeometry(2.1,2.1,.2,40),wood,0,1.18,0);
    mesh(group,'table-felt',new THREE.CylinderGeometry(1.96,1.96,.035,40),table.playable?felt:dark,0,1.30,0);
    const stripe=mesh(group,'table-gold-edge',new THREE.TorusGeometry(1.98,.025,6,40),gold,0,1.33,0);stripe.rotation.x=Math.PI/2;
    const label=makeLabel(table.label||table.id);if(label){label.name='hall-table-label';label.position.set(0,3.05,0);label.scale.set(3.25,.72,1);group.add(label);}
    for(let i=0;i<4;i++){const a=i*Math.PI/2,chair=new THREE.Group();chair.name='hall-chair';chair.position.set(Math.sin(a)*2.6,0,Math.cos(a)*2.6);chair.rotation.y=a;group.add(chair);box(chair,'chair-seat',.8,.15,.7,dark,0,.62,0);box(chair,'chair-back',.8,.85,.12,wood,0,1,-.3);for(const x of [-.29,.29])for(const z of [-.2,.2])box(chair,'chair-leg',.06,.6,.06,gold,x,.3,z);}
    if(table.id==='roulette'){const wheel=makeWheel(group);wheel.scale.setScalar(.85);wheel.position.set(0,1.4,0);}
    else {for(let i=0;i<5;i++){const card=mesh(group,'display-card',new THREE.PlaneGeometry(.24,.34),mat('#f7e9c9'),-.6+i*.3,1.325,0);card.rotation.x=-Math.PI/2;}}
    if(table.playable){const dealer=createCasinoDealer();dealer.name=`hall-dealer-${table.id}`;dealer.position.set(0,0,-2.4);dealer.scale.setScalar(.9);group.add(dealer);}
    else for(let seat=0;seat<3;seat++){
      const a=seat*Math.PI/2,guest=new THREE.Group();guest.name=`ambient-guest-${table.id}-${seat}`;
      guest.userData={ambient:true,tableId:table.id};guest.position.set(Math.sin(a)*2.6,0,Math.cos(a)*2.6);guest.rotation.y=a+Math.PI;
      const robot=createRobotModel(PALETTE[(ambientGuests.length+2)%PALETTE.length]);robot.scale.setScalar(.70);guest.add(robot);group.add(guest);
      const rig=robot.userData.rig;rig.motion.position.y=-.25;rig.torso.rotation.x=.1;
      for(const side of ['left','right']){rig[`${side}Leg`].rotation.x=-1.45;rig[`${side}Knee`].rotation.x=1.45;rig[`${side}Arm`].rotation.x=-.65;rig[`${side}Elbow`].rotation.x=-1.1;}
      ambientGuests.push({group:guest,robot,phase:ambientGuests.length*.9});
      const chips=mesh(group,'ambient-chip-stack',new THREE.CylinderGeometry(.12,.12,.12,12),gold,Math.sin(a)*1.4,1.38,Math.cos(a)*1.4);chips.userData.ambient=true;
    }
  }
  root.userData={players:new Map(),tables:validTables,ambientGuests};return root;
}
export function updateCasinoHall(root,lobby={},now){
  if(!Number.isFinite(now))now=typeof globalThis.performance?.now==='function'?globalThis.performance.now():0;
  const data=root.userData,seen=new Set(),players=(Array.isArray(lobby?.players)?lobby.players:[]).filter(p=>p&&typeof p.id==='string'&&!seen.has(p.id)&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&(seen.add(p.id),true)).slice(0,8);
  for(const [id,record]of data.players)if(!seen.has(id)){releaseTree(record.group,true);data.players.delete(id);}
  players.forEach((p,index)=>{
    let record=data.players.get(p.id);const isNew=!record;if(!record){const group=new THREE.Group();group.name=`hall-player-${p.id}`;group.userData.peerId=p.id;const robot=createRobotModel(PALETTE[index]);robot.scale.setScalar(.72);group.add(robot);root.add(group);record={group,robot,name:null,label:null};data.players.set(p.id,record);}
    const table=data.tables.find(t=>t.id===p.tableId),sitting=Boolean(table);
    let x=p.x,z=p.z,heading=Number.isFinite(p.heading)?p.heading:0;
    if(sitting){const seat=players.filter(other=>other.tableId===p.tableId).findIndex(other=>other.id===p.id),a=(seat%8)/8*Math.PI*2;x=table.x+Math.sin(a)*2.65;z=table.z+Math.cos(a)*2.65;heading=a+Math.PI;}
    const target={x:THREE.MathUtils.clamp(x,-13,13),z:THREE.MathUtils.clamp(z,-10,12),heading},isLocal=p.id===lobby.meId;
    const distance=record.target?Math.hypot(target.x-record.target.x,target.z-record.target.z):0;
    const snap=isNew||isLocal||sitting||record.sitting!==sitting||distance>6;
    if(snap){record.group.position.set(target.x,0,target.z);record.group.rotation.y=heading;record.movingUntil=0;}
    else if(distance>.015)record.movingUntil=now+250;
    record.target=target;record.group.userData.isLocal=isLocal;record.group.userData.tableId=p.tableId??null;record.sitting=sitting;
    const rig=record.robot.userData.rig;rig.motion.position.y=sitting?-.24:0;for(const side of ['left','right']){rig[`${side}Leg`].rotation.x=sitting?-1.45:0;rig[`${side}Knee`].rotation.x=sitting?1.45:0;rig[`${side}Arm`].rotation.x=sitting?-.65:0;rig[`${side}Elbow`].rotation.x=sitting?-1.1:0;}
    const name=String(p.name||'Driver').slice(0,20)+(p.id===lobby.meId?' · Sen':'');if(record.name!==name){if(record.label)releaseTree(record.label,true);record.label=makeLabel(name);if(record.label)record.group.add(record.label);record.name=name;}
  });
}

export function animateCasinoHall(root,dt,now,reducedMotion=false){
  for(const guest of root.userData.ambientGuests??[])guest.robot.userData.rig.head.rotation.y=reducedMotion?0:Math.sin(now*.00055+guest.phase)*.11;
  const alpha=1-Math.exp(-12*THREE.MathUtils.clamp(Number.isFinite(dt)?dt:0,0,.1));
  for(const record of root.userData.players.values()){
    if(record.group.userData.isLocal||record.sitting||!record.target)continue;
    const target=record.target,position=record.group.position;
    position.x+=(target.x-position.x)*alpha;position.z+=(target.z-position.z)*alpha;
    const angle=target.heading-record.group.rotation.y;
    record.group.rotation.y+=Math.atan2(Math.sin(angle),Math.cos(angle))*alpha;
    const cycle=!reducedMotion&&now<record.movingUntil?Math.sin(now*.012)*.55:0,rig=record.robot.userData.rig;
    rig.leftLeg.rotation.x=cycle;rig.rightLeg.rotation.x=-cycle;rig.leftArm.rotation.x=-cycle*.6;rig.rightArm.rotation.x=cycle*.6;
  }
}

export class KatlayanziScene {
  constructor({container,reducedMotion=false,onMove,onTable}={}){
    this.container=container;this.reducedMotion=reducedMotion;this.onMove=onMove;this.onTable=onTable;this.walking=false;this.moveInput={x:0,z:0};this.localPosition={x:0,z:10,heading:Math.PI};this.lastMoveSent=-Infinity;this.lastStep=null;this.active=false;this.disposed=false;this.frame=null;this.renderer=null;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#a8b9ad');this.scene.fog=new THREE.Fog('#a8b9ad',22,48);
    this.scene.add(new THREE.HemisphereLight('#fff9e4','#3d584c',2));const sun=new THREE.DirectionalLight('#ffe4b6',3.2);sun.position.set(-5,12,6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.05;this.scene.add(sun);const fill=new THREE.PointLight('#d5f4ed',35,25);fill.position.set(3,5,-3);this.scene.add(fill);
    this.camera=new THREE.PerspectiveCamera(35,1,.1,80);this.lounge=buildCasinoLounge();this.scene.add(this.lounge);this.hall=buildCasinoHall();this.hall.visible=false;this.scene.add(this.hall);
    try{if(!container||typeof document==='undefined')return;this.renderer=new THREE.WebGLRenderer({antialias:container.clientWidth>600,alpha:false,powerPreference:'low-power'});this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;this.renderer.shadowMap.enabled=container.clientWidth>600;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.domElement.setAttribute('aria-label','3D Katlayanzi table with seated robot players and a dealer');this.renderer.domElement.setAttribute('role','img');this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;';container.append(this.renderer.domElement);this.resize();if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);}}
    catch{this.observer?.disconnect();this.renderer?.domElement.remove();this.renderer?.dispose();this.renderer=null;if(container&&typeof document!=='undefined'){this.fallback=document.createElement('p');this.fallback.textContent='3D view unavailable on this device. All table controls remain available below.';this.fallback.style.cssText='padding:24px;color:#e8d6a1;text-align:center';container.append(this.fallback);}}
  }
  resize(){if(!this.renderer||this.disposed)return;const width=Math.max(1,this.container?.clientWidth||1),height=Math.max(1,this.container?.clientHeight||1);this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,width<600?1:1.5));this.renderer.setSize(width,height,false);this.camera.aspect=width/height;if(this.walking)this._walkCamera();else {this._seatedCamera();}this.camera.updateProjectionMatrix();if(this.active)this._render(globalThis.performance?.now?.()??0);}
  update(view){if(this.disposed)return;this.view=view;this._updateTableView();this._syncPresentation();if(this.active)this._render(globalThis.performance?.now?.()??0);}
  _updateTableView(){if(!this.view)return;let view=this.view;if(this.lobby){const seated=new Set((Array.isArray(this.lobby.players)?this.lobby.players:[]).filter(p=>p?.tableId===view.game).map(p=>p.id));view={...view,players:(Array.isArray(view.players)?view.players:[]).filter(p=>seated.has(p?.id))};}updateCasinoLounge(this.lounge,view);}
  setLobby(lobby){if(this.disposed)return;this.lobby=lobby||{};const me=this.lobby.players?.find(p=>p.id===this.lobby.meId);if(me&&Number.isFinite(me.x)&&Number.isFinite(me.z)){if(this.localIdentity!==me.id||me.tableId||!this.walking||Math.hypot(this.localPosition.x-me.x,this.localPosition.z-me.z)>2){this.localPosition={x:me.x,z:me.z,heading:Number.isFinite(me.heading)?me.heading:Math.PI};}this.localIdentity=me.id;}updateCasinoHall(this.hall,this.lobby);this._updateTableView();this._syncPresentation();const own=this.hall.userData.players.get(this.lobby.meId);if(own&&!own.sitting){own.group.position.set(this.localPosition.x,0,this.localPosition.z);own.group.rotation.y=this.localPosition.heading;}if(this.active)this._render(globalThis.performance?.now?.()??0);}
  setWalking(walking){if(this.disposed||this.walking===Boolean(walking))return;this.walking=Boolean(walking);this._syncPresentation();this.lastStep=null;this.setMoveInput({x:0,z:0});if(this.active)this.setActive(true);else this.resize();}
  setMoveInput(input={}){input=input&&typeof input==='object'?input:{};this.moveInput.x=Number.isFinite(input.x)?THREE.MathUtils.clamp(input.x,-1,1):0;this.moveInput.z=Number.isFinite(input.z)?THREE.MathUtils.clamp(input.z,-1,1):0;}
  nearestTable(){return nearestCasinoTable(this.localPosition,this.hall.userData.tables);}
  interact(){const table=this.walking?this.nearestTable():null;if(table)this.onTable?.(table.id);return table?.id??null;}
  _syncPresentation(){
    const local=this.lobby?.players?.find(player=>player.id===this.lobby.meId);
    const table=!this.walking?this.hall.userData.tables.find(table=>table.playable&&table.id===local?.tableId):null;
    this.seatedTable=table??null;this.hall.visible=this.walking||Boolean(table);this.lounge.visible=!this.walking;
    this.lounge.position.set(table?.x??0,0,table?.z??0);
    for(const child of this.lounge.children)if(child.userData.loungeArchitecture)child.visible=!table;
    for(const candidate of this.hall.userData.tables){const simple=this.hall.getObjectByName(`hall-table-${candidate.id}`);if(simple)simple.visible=candidate.id!==table?.id;}
    for(const record of this.hall.userData.players.values())record.group.visible=!table||record.group.userData.tableId!==table.id;
    if(!this.walking)this._seatedCamera();
  }
  _seatedCamera(){
    const x=this.seatedTable?.x??0,z=this.seatedTable?.z??0;
    if(this.camera.aspect<1.5)this.camera.position.set(x+8.4,6.8,z+11.8);else this.camera.position.set(x+5.8,5.1,z+8);
    this.camera.position.x=THREE.MathUtils.clamp(this.camera.position.x,-13,13);
    this.camera.position.z=THREE.MathUtils.clamp(this.camera.position.z,-10,13);
    this.camera.position.y=Math.min(this.camera.position.y,6.8);
    this.camera.lookAt(x,1.1,z);
  }
  _walkCamera(){const p=this.localPosition,mobile=this.camera.aspect<1;this.camera.position.set(p.x,mobile?7.4:6,p.z+(mobile?11:9));this.camera.lookAt(p.x,1,p.z-3);}
  _walkStep(now){const dt=this.lastStep===null?0:Math.min(.1,Math.max(0,(now-this.lastStep)/1000));this.lastStep=now;animateCasinoHall(this.hall,dt,now,this.reducedMotion);const record=this.hall.userData.players.get(this.lobby?.meId);if(record&&!record.sitting){const previous=this.localPosition;this.localPosition=moveCasinoWalker(previous,this.moveInput,dt,this.hall.userData.tables);record.group.position.set(this.localPosition.x,0,this.localPosition.z);record.group.rotation.y=this.localPosition.heading;const moving=Math.hypot(this.localPosition.x-previous.x,this.localPosition.z-previous.z)>.0001;const rig=record.robot.userData.rig,cycle=moving&&!this.reducedMotion?Math.sin(now*.012)*.55:0;rig.leftLeg.rotation.x=cycle;rig.rightLeg.rotation.x=-cycle;rig.leftArm.rotation.x=-cycle*.6;rig.rightArm.rotation.x=cycle*.6;if(moving)this.moveDirty=true;if(this.moveDirty&&now-this.lastMoveSent>=100){this.lastMoveSent=now;this.moveDirty=false;this.onMove?.({...this.localPosition});}}this._walkCamera();}
  _render(now){if(!this.renderer||this.disposed)return;if(this.walking){this._walkStep(now);this.renderer.render(this.scene,this.camera);return;}const ambientDt=this.lastAmbientTime===undefined?0:Math.min(.1,Math.max(0,(now-this.lastAmbientTime)/1000));this.lastAmbientTime=now;animateCasinoHall(this.hall,ambientDt,now,this.reducedMotion);const data=this.lounge.userData;for(const card of data.cards.children){const target=card.userData.dealTarget;if(!target)continue;const t=this.reducedMotion?1:Math.min(1,Math.max(0,(now-card.userData.dealStarted)/550));card.position.set(THREE.MathUtils.lerp(0,target.x,t),THREE.MathUtils.lerp(1.65,target.y,t),THREE.MathUtils.lerp(-1.4,target.z,t));}const duration=this.reducedMotion?0:2800,t=duration?Math.min(1,Math.max(0,(now-data.spinStarted)/duration)):1;data.wheel.userData.rotor.rotation.y=THREE.MathUtils.lerp(data.spinFrom,data.spinTo,1-(1-t)**3);animateCasinoDealer(data.dealer,{time:this.reducedMotion?0:now/1000,...data.view});if(!this.reducedMotion)for(const record of data.players.values()){record.robot.userData.rig.head.rotation.y=Math.sin(now*.0006+record.slot)*.07;}this.renderer.render(this.scene,this.camera);}
  setActive(active){if(this.disposed)return;this.active=Boolean(active);this.lastStep=null;if(this.frame!==null){globalThis.cancelAnimationFrame?.(this.frame);this.frame=null;}if(!this.active||!this.renderer)return;this.resize();if(this.reducedMotion&&!this.walking){this._render(0);return;}const loop=now=>{if(!this.active||this.disposed)return;if(!this.lastFrame||now-this.lastFrame>1000/(this.container.clientWidth<600?30:60)){this.lastFrame=now;this._render(now);}this.frame=globalThis.requestAnimationFrame?.(loop)??null;};if(typeof requestAnimationFrame==='function')this.frame=requestAnimationFrame(loop);else this._render(0);}
  dispose(){if(this.disposed)return;this.setActive(false);this.disposed=true;this.observer?.disconnect();const textures=new Set(this.lounge.userData.textureCache.values());this.lounge.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material])if(material?.map)textures.add(material.map);});this.hall.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material])if(material?.map)textures.add(material.map);});releaseTree(this.hall);this.hall.clear();releaseTree(this.lounge);textures.forEach(t=>t.dispose());this.lounge.userData.textureCache.clear();this.lounge.clear();this.scene.traverse(object=>object.shadow?.dispose?.());this.renderer?.dispose();this.renderer?.forceContextLoss();this.renderer?.domElement.remove();this.fallback?.remove();this.renderer=null;}
}
