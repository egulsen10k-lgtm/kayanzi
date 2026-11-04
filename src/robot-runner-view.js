import * as THREE from 'three';
import { createPerson } from './person-model.js';
import { RUNNER_LANES, TRUCK_ROOF_HEIGHT, POWERUP_WRENCH, POWERUP_ROCKET } from './runner-game.js';
import { animateRobot } from './robot-animation.js';

const paint = (color, metalness = .2) => new THREE.MeshStandardMaterial({ color, metalness, roughness:.45 });

const _iconTextureCache = new Map();
function makeIconTexture(icon) {
  if (_iconTextureCache.has(icon)) return _iconTextureCache.get(icon);
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(icon, 16, 16);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  _iconTextureCache.set(icon, tex);
  return tex;
}

export function createRobotModel(color = '#1c3fa8') {
  const robot = new THREE.Group();
  robot.name = 'transformer-robot';
  const body = paint(color,.65), steel = paint('#a9bfce',.8), dark = paint('#172432',.55);
  const cyan = new THREE.MeshStandardMaterial({color:'#67eaff',emissive:'#15a5cc',emissiveIntensity:1.5});
  const motion = new THREE.Group();motion.name='robot-motion';robot.add(motion);
  const torso = new THREE.Group();torso.name='robot-torso';torso.position.y=1.25;motion.add(torso);
  function box(parent,name,w,h,d,x,y,z,material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  box(motion,'waist',.85,.35,.48,0,1.25,0,dark);
  box(torso,'chest',1.18,.82,.58,0,.67,0,body);
  box(torso,'windshield-chest',.82,.28,.035,0,.81,.31,dark);
  box(torso,'chest-light',.34,.08,.04,0,.56,.33,cyan);
  const head=new THREE.Group();head.name='robot-head';head.position.y=1.18;torso.add(head);
  box(head,'neck',.25,.18,.24,0,0,0,steel);
  box(head,'head',.48,.47,.4,0,.29,0,steel);
  box(head,'helmet',.6,.16,.46,0,.55,-.02,body);
  const rig={motion,torso,head};
  for(const side of [-1,1]) {
    const label=side<0?'left':'right';
    box(head,'eye',.16,.075,.035,side*.12,.33,.217,cyan);
    const arm = new THREE.Group();arm.name=`robot-${label}-arm`;arm.position.set(side*.82,1.03,0);torso.add(arm);
    box(arm,'shoulder',.38,.38,.45,0,0,0,body);
    box(arm,'upper-arm',.3,.38,.35,side*.03,-.35,0,body);
    const elbow=new THREE.Group();elbow.name=`robot-${label}-elbow`;elbow.position.set(side*.03,-.55,.02);arm.add(elbow);
    box(elbow,'forearm',.3,.54,.32,0,-.26,0,steel);
    box(elbow,'fist',.32,.24,.32,0,-.63,0,dark);
    const leg = new THREE.Group();leg.name=`robot-${label}-leg`;leg.position.set(side*.31,1.16,0);motion.add(leg);
    box(leg,'thigh',.39,.68,.46,0,-.32,0,body);
    const knee=new THREE.Group();knee.name=`robot-${label}-knee`;knee.position.y=-.66;leg.add(knee);
    box(knee,'shin',.4,.54,.48,0,-.26,.04,steel);
    const ankle=new THREE.Group();ankle.name=`robot-${label}-ankle`;ankle.position.y=-.39;knee.add(ankle);
    box(ankle,'foot',.48,.22,.7,0,-.10,.16,dark);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.13,16),dark);
    wheel.rotation.z=Math.PI/2;wheel.position.set(side*.9,1.25,-.24);wheel.castShadow=true;wheel.name='folded-wheel';motion.add(wheel);
    rig[`${label}Arm`]=arm;rig[`${label}Elbow`]=elbow;
    rig[`${label}Leg`]=leg;rig[`${label}Knee`]=knee;rig[`${label}Ankle`]=ankle;
  }
  robot.userData.rig=rig;
  return robot;
}

function disposeGroup(group) {
  group.traverse(object=>{object.geometry?.dispose();if(object.material){for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});
  group.removeFromParent();
}

export class RobotRunnerView {
  constructor(renderer,container,color) {
    this.renderer=renderer;
    this.container=container;
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color('#7ca5bb');
    this.scene.fog=new THREE.Fog('#7ca5bb',55,150);
    this.camera=new THREE.PerspectiveCamera(62,1,.1,220);
    this.scene.add(new THREE.HemisphereLight('#e9f7ff','#344657',2));
    const sun=new THREE.DirectionalLight('#ffebca',2.4);sun.position.set(-15,30,-25);this.scene.add(sun);
    this.root=new THREE.Group();this.scene.add(this.root);
    const road=new THREE.Mesh(new THREE.PlaneGeometry(15,210),paint('#253444'));
    road.rotation.x=-Math.PI/2;road.position.set(0,-.04,-69);this.root.add(road);
    for(const edge of [-7.3,7.3]) {
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.32,.55,210),paint('#90a9b4',.5));
      rail.position.set(edge,.22,-69);this.root.add(rail);
    }
    this.laneMarkers=[];
    for(const x of [-2,2])for(let z=8;z>-145;z-=11) {
      const line=new THREE.Mesh(new THREE.BoxGeometry(.12,.015,5.2),paint('#d5e4e7'));
      line.position.set(x,.01,z);this.root.add(line);
      this.laneMarkers.push({mesh:line,initialZ:z});
    }
    this.buildings=[];
    for(const side of [-1,1])for(let i=0;i<9;i++) {
      const height=8+(i*11%17),depth=11+(i%3)*3;
      const building=new THREE.Mesh(new THREE.BoxGeometry(8,height,depth),paint(i%2?'#668294':'#56748a'));
      const initialZ=-i*20;
      building.position.set(side*14,height/2,initialZ);this.root.add(building);
      this.buildings.push({mesh:building, depth, initialZ});
    }
    this.robot=createRobotModel(color);this.root.add(this.robot);
    this.trucks=new Map();this.pickups=new Map();this.lowObstacles=new Map();this.roadsters=new Map();this.powerups=new Map();
    // Warning sprite pool (max 6)
    this._warnSprites = Array.from({length: 6}, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      sprite.scale.set(1.1, 1.1, 1); sprite.visible = false; this.root.add(sprite); return sprite;
    });
  }

  createTruck(item) {
    const group=new THREE.Group();group.name='runner-truck';
    const colors=['#d84c47','#e2a633','#4d99a4'];
    const shell=paint(colors[item.lane],.3),glass=paint('#183a4b',.3),rubber=paint('#111b24');
    const add=(w,h,d,x,y,z,material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;group.add(mesh);};
    add(3.15,1.75,7.1,0,1.375,-.55,shell);
    add(3.18,.16,7.12,0,TRUCK_ROOF_HEIGHT-.08,-.55,paint('#d8e4e4',.45));
    add(2.75,1.65,1.8,0,1.1,3.3,shell);
    add(2.2,.53,.05,0,1.55,4.23,glass);
    add(2.35,.58,.08,0,.93,4.25,paint('#26333b',.35));
    add(.34,.16,.1,-.88,1.32,4.3,paint('#ff4b42'));
    add(.34,.16,.1,.88,1.32,4.3,paint('#ff4b42'));
    add(.28,.12,.18,-.55,.38,4.26,rubber);
    add(.28,.12,.18,.55,.38,4.26,rubber);
    group.userData.wheels=[];
    for(const x of [-1.25,1.25])for(const z of [-2.8,2.75]) {
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.22,12),rubber);
      wheel.rotation.z=Math.PI/2;wheel.position.set(x,.47,z);wheel.name='runner-wheel';group.add(wheel);group.userData.wheels.push(wheel);
    }
    this.root.add(group);return group;
  }

  createRoadster(item) {
    const group=new THREE.Group();group.name='runner-roadster';
    const body=paint('#c94a35',.55),dark=paint('#17232d',.4);
    const add=(w,h,d,x,y,z,material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;group.add(mesh);};
    add(2.3,.42,4.4,0,1.25,0,body);
    add(1.55,.34,1.8,0,1.62,-.15,dark);
    add(.18,.12,3.4,-1.05,.9,0,dark);add(.18,.12,3.4,1.05,.9,0,dark);
    this.root.add(group);return group;
  }

  createPowerup(item) {
    const group=new THREE.Group();group.name=`runner-powerup-${item.type}`;
    const material=paint(item.type===POWERUP_WRENCH?'#ffd22e':'#f04b2c',.35);
    const geometry=item.type===POWERUP_WRENCH
      ? new THREE.BoxGeometry(.4,.4,.4)
      : new THREE.ConeGeometry(.22,.7,6);
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;group.add(mesh);
    this.root.add(group);return group;
  }

  createPickup() {
    const group=new THREE.Group();group.name='adult-blonde-pickup';
    const person=createPerson({style:'casual'});person.scale.setScalar(.82);group.add(person);
    const halo=new THREE.Mesh(new THREE.TorusGeometry(.8,.065,6,24),new THREE.MeshBasicMaterial({color:'#fff0a3'}));
    halo.rotation.x=Math.PI/2;halo.position.y=1.65;group.add(halo);
    this.root.add(group);return group;
  }

  reset() {
    for(const group of this.trucks.values())disposeGroup(group);
    for(const group of this.pickups.values())disposeGroup(group);
    for(const group of this.lowObstacles.values())disposeGroup(group);
    for(const group of this.roadsters.values())disposeGroup(group);
    for(const group of this.powerups.values())disposeGroup(group);
    this.trucks.clear();this.pickups.clear();this.lowObstacles.clear();this.roadsters.clear();
    this.powerups.clear();
    for(const building of this.buildings) building.mesh.position.z=building.initialZ;
    this.camera.position.set(0,5.7,10.5);
  }

  update(game,dt) {
    if (!(this.powerups instanceof Map)) this.powerups=new Map();
    if (!(this.roadsters instanceof Map)) this.roadsters=new Map();
    if (!(this.lowObstacles instanceof Map)) this.lowObstacles=new Map();
    const speed=game.over?0:Math.min(25,14+game.distance/500);
    for(const marker of this.laneMarkers) {
      marker.mesh.position.z += speed*dt;
      if(marker.mesh.position.z - 2.6 > 18) marker.mesh.position.z -= 165;
    }
    for(const building of this.buildings) {
      building.mesh.position.z += speed*dt;
      if(building.mesh.position.z - building.depth/2 > 18) building.mesh.position.z -= 180;
    }
    const visibleTrucks=new Set(game.trucks.map(item=>item.id));
    const visiblePickups=new Set(game.pickups.map(item=>item.id));
    const visibleObstacles=new Set((game.lowObstacles??[]).map(item=>item.id));
    const visibleRoadsters=new Set((game.roadsters??[]).map(item=>item.id));
    const visiblePowerups=new Set((game.powerups??[]).map(item=>item.id));
    for(const [id,group] of this.roadsters) if(!visibleRoadsters.has(id)){disposeGroup(group);this.roadsters.delete(id);}
    for(const [id,group] of this.powerups) if(!visiblePowerups.has(id)){disposeGroup(group);this.powerups.delete(id);}
    for(const [id,group] of this.lowObstacles) if(!visibleObstacles.has(id)){disposeGroup(group);this.lowObstacles.delete(id);}
    for(const [id,group] of this.trucks)if(!visibleTrucks.has(id)){disposeGroup(group);this.trucks.delete(id);}
    for(const [id,group] of this.pickups)if(!visiblePickups.has(id)){disposeGroup(group);this.pickups.delete(id);}
    for(const item of game.trucks) {
      const group=this.trucks.get(item.id)??this.createTruck(item);
      this.trucks.set(item.id,group);group.position.set(RUNNER_LANES[item.lane],0,item.z);group.rotation.z=Number.isFinite(item.roll)?item.roll:0;
      for(const wheel of group.userData.wheels ?? []) wheel.rotation.x-=dt*7.5;
    }
    for(const item of game.pickups) {
      const group=this.pickups.get(item.id)??this.createPickup();
      this.pickups.set(item.id,group);group.position.set(RUNNER_LANES[item.lane],item.y+Math.sin((game.distance+item.id)*2.2)*.08,item.z);
      group.rotation.y+=dt*1.2;
      group.rotation.z=Math.sin((game.distance+item.id)*1.5)*.04;
    }
    for(const item of game.roadsters??[]) {
      const group=this.roadsters.get(item.id)??this.createRoadster(item);
      this.roadsters.set(item.id,group);
      group.position.set(RUNNER_LANES[item.lane],item.height??2.8,item.z);
      group.rotation.x=Number.isFinite(item.roll)?item.roll:0;
    }
    for(const item of game.powerups??[]) {
      const group=this.powerups.get(item.id)??this.createPowerup(item);
      this.powerups.set(item.id,group);
      group.position.set(RUNNER_LANES[item.lane],.55+Math.sin((game.distance+item.id)*2.2)*.08,item.z);
      group.rotation.y+=dt*1.7;
    }
    for(const item of game.lowObstacles??[]) {
      let group=this.lowObstacles.get(item.id);
      if(!group) {
        group=new THREE.Mesh(new THREE.BoxGeometry(3.1,item.height,1.8),paint('#b86b43'));
        group.name='runner-low-obstacle';this.root.add(group);this.lowObstacles.set(item.id,group);
      }
      group.position.set(RUNNER_LANES[item.lane],item.height/2,item.z);
    }
    this.robot.position.set(game.x,game.y,0);
    this.robot.visible=game.over||game.invulnerable<=0||Math.floor(game.invulnerable*10)%2===0;
    const rollingPose=game.sliding||game.rolling;
    this.robot.scale.y += ((rollingPose?.72:1)-this.robot.scale.y)*Math.min(1,dt*14);
    this.robot.rotation.z += ((game.rolling ? Math.sin(game.rollAngle||0)*.28 : 0)-this.robot.rotation.z)*Math.min(1,dt*12);
    animateRobot(this.robot,{dt,speed,grounded:game.y<=.03||Boolean(game.roof),verticalVelocity:game.vy,lateral:RUNNER_LANES[game.lane]-game.x});
    this.camera.aspect=this.container.clientWidth/Math.max(1,this.container.clientHeight);
    this.camera.updateProjectionMatrix();
    this.camera.position.lerp(new THREE.Vector3(game.x*.35,5.7,10.5),Math.min(1,dt*5));
    this.camera.lookAt(game.x*.45,1.4,-9);
    // Warning sprites for upcoming hazards
    const hazards = game.getUpcomingHazards ? game.getUpcomingHazards() : [];
    for (let i = 0; i < this._warnSprites.length; i++) {
      const sprite = this._warnSprites[i];
      const hazard = hazards[i];
      if (!hazard) { sprite.visible = false; continue; }
      const icon = hazard.kind === 'powerup' ? '🚀' : '⚠️';
      const tex = makeIconTexture(icon);
      if (sprite.material.map !== tex) sprite.material.map = tex;
      sprite.position.set(RUNNER_LANES[hazard.lane ?? 1], 3.5, hazard.z);
      sprite.visible = true;
    }
    this.renderer.render(this.scene,this.camera);
  }
}
