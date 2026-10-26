import * as THREE from 'three';
import { createPerson } from './person-model.js';
import { RUNNER_LANES, TRUCK_ROOF_HEIGHT } from './runner-game.js';

const paint = (color, metalness = .2) => new THREE.MeshStandardMaterial({ color, metalness, roughness:.45 });

export function createRobotModel(color = '#1c3fa8') {
  const robot = new THREE.Group();
  robot.name = 'transformer-robot';
  const body = paint(color,.65), steel = paint('#a9bfce',.8), dark = paint('#172432',.55);
  const cyan = new THREE.MeshStandardMaterial({color:'#67eaff',emissive:'#15a5cc',emissiveIntensity:1.5});
  function box(parent,name,w,h,d,x,y,z,material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  box(robot,'waist',.85,.35,.48,0,1.25,0,dark);
  box(robot,'chest',1.18,.82,.58,0,1.92,0,body);
  box(robot,'windshield-chest',.82,.28,.035,0,2.06,.31,dark);
  box(robot,'chest-light',.34,.08,.04,0,1.81,.33,cyan);
  box(robot,'neck',.25,.18,.24,0,2.43,0,steel);
  box(robot,'head',.48,.47,.4,0,2.72,0,steel);
  box(robot,'helmet',.6,.16,.46,0,2.98,-.02,body);
  for(const side of [-1,1]) {
    box(robot,'eye',.16,.075,.035,side*.12,2.76,.217,cyan);
    const arm = new THREE.Group();arm.name=side<0?'robot-left-arm':'robot-right-arm';arm.position.set(side*.82,2.28,0);robot.add(arm);
    box(arm,'shoulder',.38,.38,.45,0,0,0,body);
    box(arm,'forearm',.3,.72,.32,side*.04,-.53,.02,steel);
    box(arm,'fist',.32,.24,.32,side*.04,-.98,.02,dark);
    const leg = new THREE.Group();leg.name=side<0?'robot-left-leg':'robot-right-leg';leg.position.set(side*.31,1.16,0);robot.add(leg);
    box(leg,'thigh',.39,.72,.46,0,-.34,0,body);
    box(leg,'shin',.4,.6,.48,0,-.88,.04,steel);
    box(leg,'foot',.48,.22,.7,0,-1.16,.16,dark);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.13,16),dark);
    wheel.rotation.z=Math.PI/2;wheel.position.set(side*.9,1.25,-.24);wheel.castShadow=true;wheel.name='folded-wheel';robot.add(wheel);
  }
  robot.userData.limbs={leftArm:robot.getObjectByName('robot-left-arm'),rightArm:robot.getObjectByName('robot-right-arm'),leftLeg:robot.getObjectByName('robot-left-leg'),rightLeg:robot.getObjectByName('robot-right-leg')};
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
    for(const x of [-2,2])for(let z=8;z>-145;z-=11) {
      const line=new THREE.Mesh(new THREE.BoxGeometry(.12,.015,5.2),paint('#d5e4e7'));
      line.position.set(x,.01,z);this.root.add(line);
    }
    for(const side of [-1,1])for(let i=0;i<9;i++) {
      const height=8+(i*11%17),depth=11+(i%3)*3;
      const building=new THREE.Mesh(new THREE.BoxGeometry(8,height,depth),paint(i%2?'#668294':'#56748a'));
      building.position.set(side*14,height/2,-i*20);this.root.add(building);
    }
    this.robot=createRobotModel(color);this.root.add(this.robot);
    this.trucks=new Map();this.pickups=new Map();
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
    for(const x of [-1.25,1.25])for(const z of [-2.8,2.75]) {
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.22,12),rubber);
      wheel.rotation.z=Math.PI/2;wheel.position.set(x,.47,z);group.add(wheel);
    }
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
    this.trucks.clear();this.pickups.clear();
    this.camera.position.set(0,6.7,13);
  }

  update(game,dt) {
    const visibleTrucks=new Set(game.trucks.map(item=>item.id));
    const visiblePickups=new Set(game.pickups.map(item=>item.id));
    for(const [id,group] of this.trucks)if(!visibleTrucks.has(id)){disposeGroup(group);this.trucks.delete(id);}
    for(const [id,group] of this.pickups)if(!visiblePickups.has(id)){disposeGroup(group);this.pickups.delete(id);}
    for(const item of game.trucks) {
      const group=this.trucks.get(item.id)??this.createTruck(item);
      this.trucks.set(item.id,group);group.position.set(RUNNER_LANES[item.lane],0,item.z);
    }
    for(const item of game.pickups) {
      const group=this.pickups.get(item.id)??this.createPickup();
      this.pickups.set(item.id,group);group.position.set(RUNNER_LANES[item.lane],item.y,item.z);
      group.rotation.y+=dt*1.2;
    }
    this.robot.position.set(game.x,game.y,0);
    this.robot.visible=game.over||game.invulnerable<=0||Math.floor(game.invulnerable*10)%2===0;
    const swing=game.y>.05 ? .25 : Math.sin(game.distance*.8)*.38;
    const limbs=this.robot.userData.limbs;
    limbs.leftArm.rotation.x=swing;limbs.rightArm.rotation.x=-swing;
    limbs.leftLeg.rotation.x=-swing;limbs.rightLeg.rotation.x=swing;
    this.camera.aspect=this.container.clientWidth/Math.max(1,this.container.clientHeight);
    this.camera.updateProjectionMatrix();
    this.camera.position.lerp(new THREE.Vector3(game.x*.35,6.7,13),Math.min(1,dt*5));
    this.camera.lookAt(game.x*.45,1.4,-12);
    this.renderer.render(this.scene,this.camera);
  }
}
