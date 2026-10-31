import * as THREE from 'three';
import { projectCoordinate } from './road-network.js';
import { footprintOnRoad } from './road-safety.js';
import { resolveTrafficContact, integrateTrafficImpact } from './traffic-collision.js';
import { buildTrafficGraph, lanePose, nextTrafficEdge, makeTrafficTurn } from './traffic-routes.js';
import { createTrafficVehicle, disposeTrafficObject, TRAFFIC_TYPES } from './traffic-vehicle.js';
import { TrafficControls } from './traffic-controls.js';
import { RoadSigns } from './road-signs.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const poseFields=['x','y','heading','roadHeight'];
export class TrafficManager {
  constructor(parent,{camera=null}={}) {
    this.scene=parent;this.root=new THREE.Group();this.root.name='persistent-road-traffic';parent.add(this.root);
    this.camera=camera;this.cars=[];this.maxCars=8;this.network=null;this.origin=null;
    this.roads=new Map();this.buildings=new Map();this.time=0;this.nextId=0;this.spawnClock=0;
    this.controls=new TrafficControls(this.root);this.frustum=new THREE.Frustum();
    this.signs=new RoadSigns(this.root);this.roadInfo=null;this.infoClock=0;
  }
  setDensity(value) {this.maxCars=Math.round(clamp(Number(value)||0,0,2)*8);}
  reset(network,player) {
    if(!network){this.clear();return;}
    if(this.origin&&Math.hypot(...projectCoordinate(network.center.lat,network.center.lng,this.origin))>2000)this.clear();
    const first=!this.origin;if(first)this.origin={...network.center};
    this.network=network;
    const shift=projectCoordinate(network.center.lat,network.center.lng,this.origin);
    this.shift=shift;this.root.position.set(-shift[0],0,shift[1]);
    for(const source of network.roads??[]) {
      const points=source.points.map(p=>[p[0]+shift[0],p[1]+shift[1]]);
      const id=String(source.id??source.highway??'road')+':'+points[0]?.map(v=>Math.round(v)).join(',')+':'+points.at(-1)?.map(v=>Math.round(v)).join(',');
      this.roads.set(id,{...source,points});
    }
    for(const source of network.buildings??[]) {
      const points=source.points.map(p=>[p[0]+shift[0],p[1]+shift[1]]),id=source.id??points.map(p=>p.map(v=>Math.round(v)).join(',')).join(':');
      this.buildings.set(id,{...source,points});
    }
    const p=this.playerPoint(player);
    for(const [id,road] of this.roads)if(road.points.every(q=>Math.hypot(q[0]-p.x,q[1]-p.y)>1400)&&!this.cars.some(c=>c.edge.road===road||c.turn?.next.road===road))this.roads.delete(id);
    for(const [id,building] of this.buildings)if(building.points.every(q=>Math.hypot(q[0]-p.x,q[1]-p.y)>1400))this.buildings.delete(id);
    let radius=500;for(const road of this.roads.values())for(const q of road.points)radius=Math.max(radius,Math.hypot(...q)+30);
    this.world={center:this.origin,radiusMeters:radius,roads:[...this.roads.values()],buildings:[...this.buildings.values()]};
    this.graph=buildTrafficGraph(this.world);this.controls.rebuild(this.graph);this.signs.rebuild(this.graph,p,this.world.roads);
    this.roadInfo=this.signs.nearby(this.graph,p);
    if(first)for(let i=0;i<this.maxCars;i++)if(!this.spawn(p,true))break;
    // Streaming preserves vehicle identities, exact world positions, and routes.
    for(const car of this.cars)if(car.group.parent!==this.root)this.root.add(car.group);
  }
  playerPoint(player) {
    const p=projectCoordinate(player.lat,player.lng,this.origin);
    return {x:p[0],y:p[1],heading:player.heading??0,speed:player.speed??0,roadHeight:player.roadHeight??.08};
  }
  refreshFrustum() {
    if(!this.camera)return;
    this.camera.updateMatrixWorld();this.root.updateWorldMatrix(true,false);
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse));
  }
  offscreen(p) {
    if(!this.camera)return true;
    const center=this.root.localToWorld(new THREE.Vector3(p.x,p.roadHeight??.08,-p.y));
    return !this.frustum.intersectsSphere(new THREE.Sphere(center,22));
  }
  spawn(player,initial=false) {
    if(!this.graph||this.cars.length>=this.maxCars)return false;
    this.refreshFrustum();const candidates=[];
    for(const edge of this.graph.edges) {
      if(edge.length<16)continue;
      const count=Math.max(1,Math.floor(edge.length/65));
      for(let i=0;i<count;i++) {
        const s=edge.length*(i+.5)/count,pose=lanePose(edge,s),d=distance(pose,player);
        if(d<(initial&&!this.camera?18:180)||d>500||!this.offscreen(pose))continue;
        if(this.cars.some(other=>distance(pose,other)<18))continue;
        if(!footprintOnRoad(this.world,[pose.x,pose.y],pose.heading,pose.roadHeight))continue;
        candidates.push({edge,s,pose,d});
      }
    }
    candidates.sort((a,b)=>a.d-b.d||a.edge.id.localeCompare(b.edge.id));
    let candidate=candidates[0];if(!candidate)return false;
    const id=this.nextId++,requested=TRAFFIC_TYPES[id%TRAFFIC_TYPES.length];
    const type=['firetruck','bus'].includes(requested)&&candidate.edge.road.width<7?'sedan':requested;
    const model=createTrafficVehicle(type,id),materials=new Set();
    candidate=candidates.find(c=>c.edge.road.width>=(model.width>2?7:6)&&this.safe(model,c.pose));
    if(!candidate){disposeTrafficObject(model.group);return false;}
    model.group.traverse(o=>{if(o.material)materials.add(o.material);});
    const car={...model,id,edge:candidate.edge,s:candidate.s,turn:null,...candidate.pose,speed:0,
      cruise:type==='bus'||type==='firetruck'?80:type==='van'?90:120,
      offsetX:0,offsetY:0,yawOffset:0,impactTime:Infinity,vx:0,vy:0,angularVelocity:0,
      opacity:0,materials:[...materials],alertUntil:0,noticeAt:0};
    this.root.add(car.group);this.cars.push(car);this.renderCar(car,0);return true;
  }
  safe(car,pose) {
    const extra=Math.max(0,(car.length-4.5)/2),forward=[Math.sin(pose.heading),Math.cos(pose.heading)];
    return [-extra,extra].every(along=>footprintOnRoad(this.world,[pose.x+forward[0]*along,pose.y+forward[1]*along],pose.heading,pose.roadHeight));
  }
  nextEdge(car,player) {
    if(car.type==='police'&&car.alertUntil>this.time) {
      const candidates=(this.graph.nodes.get(car.edge.to.id)?.out??[]).filter(e=>e.to.id!==car.edge.from.id&&Math.abs(e.ha-car.roadHeight)<.6);
      candidates.sort((a,b)=>Math.hypot(a.end[0]-player.x,a.end[1]-player.y)-Math.hypot(b.end[0]-player.x,b.end[1]-player.y));
      if(candidates.length)return candidates[0];
    }
    return nextTrafficEdge(this.graph,car.edge,car.id+Math.floor(this.time/44));
  }
  targetSpeed(car,player) {
    let target=Math.min(car.cruise,car.edge.limit*.92)/3.6;
    if(car.turn&&car.edge.tangent[0]*car.turn.next.tangent[0]+car.edge.tangent[1]*car.turn.next.tangent[1]<.95)target=Math.min(target,5);
    const forward=[Math.sin(car.heading),Math.cos(car.heading)];
    for(const other of [player,...this.cars]) {
      if(other===car||Math.abs(other.roadHeight-car.roadHeight)>.7)continue;
      const dx=other.x-car.x,dy=other.y-car.y,along=dx*forward[0]+dy*forward[1],side=Math.abs(dx*forward[1]-dy*forward[0]);
      if(along<=0||side>(car.width+(other.width??1.86))/2+.25)continue;
      const gap=along-(car.length+(other.length??4.5))/2-2.5;
      target=Math.min(target,Math.sqrt(Math.max(0,2*3.5*gap)));
    }
    if(!car.turn) {
      const next=this.nextEdge(car,player),remaining=car.edge.length-car.s;
      if(next&&next.tangent[0]*car.edge.tangent[0]+next.tangent[1]*car.edge.tangent[1]<.95)target=Math.min(target,Math.sqrt(25+2*3.5*Math.max(0,remaining)));
      const red=!this.controls.allows(car.edge,this.time),stopBuffer=red?car.length/2+.6+this.controls.stopDistance(car.edge):.3;
      if(!next||red)target=Math.min(target,Math.sqrt(Math.max(0,2*4*(remaining-stopBuffer))));
      if(remaining<12&&next&&car.edge.to.neighbors.size>=3&&this.cars.some(other=>other!==car&&other.turn&&Math.abs(other.roadHeight-car.roadHeight)<.7&&distance(other,{x:car.edge.to.p[0],y:car.edge.to.p[1]})<9))target=Math.min(target,Math.sqrt(Math.max(0,2*4*(remaining-.4))));
    }
    if(car.impactTime<1.5||Math.hypot(car.vx,car.vy)>1)target=0;
    return target;
  }
  advance(car,meters,player) {
    let remaining=meters;
    for(let step=0;step<8&&remaining>0;step++) {
      const length=car.turn?.length??car.edge.length,available=Math.max(0,length-car.s);
      if(!car.turn&&!this.controls.allows(car.edge,this.time)) {
        const stopAt=Math.max(car.s,length-this.controls.stopDistance(car.edge)-car.length/2-.6);
        if(car.s+remaining>=stopAt){car.s=stopAt;car.speed=0;return;}
      }
      if(remaining<available){car.s+=remaining;return;}
      if(!car.turn) {
        const next=this.nextEdge(car,player);
        if(!next||!this.controls.allows(car.edge,this.time)){car.s=Math.max(car.s,length-.3);car.speed=0;return;}
        car.turn=makeTrafficTurn(car.edge,next);car.s=0;
      } else {car.edge=car.turn.next;car.turn=null;car.s=0;}
      remaining-=available;
    }
  }
  renderCar(car,dt) {
    car.group.position.set(car.x,car.roadHeight,-car.y);car.group.rotation.y=Math.PI-car.heading;
    const opacity=clamp(car.opacity+(car.retiring?-dt:dt)/1.5,0,1);car.opacity=opacity;
    for(const material of car.materials)if(material.opacity!==opacity){material.transparent=opacity<1;material.opacity=opacity;material.depthWrite=opacity>.9;}
    for(const wheel of car.wheels)wheel.rotation.x+=car.speed/3.6*dt/.32;
    for(const lamp of car.brakeLamps)lamp.emissiveIntensity=car.braking?2:.25;
    car.beacons.forEach((lamp,i)=>{lamp.emissiveIntensity=(car.type!=='police'||car.alertUntil>this.time)&&Math.floor(this.time*5+i)%2===0?3:.15;});
  }
  update(dt,player) {
    if(!this.network)return;
    dt=clamp(Number(dt)||0,0,.1);this.time+=dt;this.spawnClock+=dt;
    const p=this.playerPoint(player);this.controls.update(this.time,p);
    this.infoClock+=dt;
    if(this.infoClock>=.15){this.infoClock=0;this.roadInfo=this.signs.nearby(this.graph,p);}
    if(this.roadInfo){
      const edge=this.roadInfo.signalEdge??this.roadInfo.edge;
      this.roadInfo.signal=this.controls.phase(edge,this.time);
      this.roadInfo.signalDistance=Math.max(0,this.roadInfo.remaining-(edge?this.controls.stopDistance(edge):0));
    }
    if(this.spawnClock>=1.5){this.spawnClock=0;this.spawn(p);}
    this.refreshFrustum();
    let retireBudget=Math.max(0,this.cars.length-this.maxCars-this.cars.filter(car=>car.retiring).length);
    for(const car of this.cars) {
      if(car.retiring&&!this.offscreen(car))car.retiring=false;
      if(!car.retiring&&(retireBudget>0||(!car.turn&&!this.nextEdge(car,p)&&car.edge.length-car.s<1)||distance(car,p)>650)&&distance(car,p)>180&&this.offscreen(car)){car.retiring=true;if(retireBudget>0)retireBudget--;}
      if(car.type==='police'&&distance(car,p)<40&&Math.abs(car.roadHeight-p.roadHeight)<1&&Math.abs(p.speed)>car.edge.limit+10&&this.time>car.noticeAt) {
        car.alertUntil=this.time+8;car.noticeAt=this.time+20;this.controls.tickets++;
        this.controls.message='Police · speeding '+Math.round(Math.abs(p.speed))+' / '+car.edge.limit+' km/h · Ticket '+this.controls.tickets;this.controls.messageUntil=this.time+6;
      }
      const previous={edge:car.edge,turn:car.turn,s:car.s,x:car.x,y:car.y,heading:car.heading,roadHeight:car.roadHeight};
      integrateTrafficImpact(car,dt,distance(car,p));
      const desired=this.targetSpeed(car,p),speed=car.speed/3.6;
      car.braking=desired<speed-.3;
      const nextSpeed=speed+clamp(desired-speed,-4.5*dt,2*dt);car.speed=nextSpeed*3.6;
      this.advance(car,(speed+nextSpeed)/2*dt,p);
      const pose=car.turn?car.turn.pose(car.s):lanePose(car.edge,car.s);
      const normal=[Math.cos(pose.heading),-Math.sin(pose.heading)],forward=[Math.sin(pose.heading),Math.cos(pose.heading)];
      const side=clamp(car.offsetX*normal[0]+car.offsetY*normal[1],-.35,.35),along=clamp(car.offsetX*forward[0]+car.offsetY*forward[1],-.5,.5);
      car.offsetX=side*normal[0]+along*forward[0];car.offsetY=side*normal[1]+along*forward[1];
      pose.x+=car.offsetX;pose.y+=car.offsetY;pose.heading+=clamp(car.yawOffset,-.12,.12);
      if(this.safe(car,pose))for(const field of poseFields)car[field]=pose[field];
      else {Object.assign(car,previous);car.speed=0;car.vx=0;car.vy=0;}
      if(dt>0&&distance(car,p)<(car.length+4.5)/2+1) {
        const before={x:car.x,y:car.y,speed:car.speed,offsetX:car.offsetX,offsetY:car.offsetY,impactTime:car.impactTime,vx:car.vx,vy:car.vy,angularVelocity:car.angularVelocity};
        const body={...p};
        if(resolveTrafficContact(body,car)) {
          const lateral=car.offsetX*normal[0]+car.offsetY*normal[1];
          if(Math.abs(lateral)<=.35&&this.safe(car,car))player.speed=body.speed;
          else Object.assign(car,before);
        }
      }
      this.renderCar(car,dt);
    }
    this.cars=this.cars.filter(car=>{if(car.retiring&&car.opacity<=0){disposeTrafficObject(car.group);return false;}return true;});
  }
  get status(){return this.controls.messageUntil>this.time?this.controls.message:'';}
  clear() {
    for(const car of this.cars)disposeTrafficObject(car.group);this.cars=[];this.controls.clear();this.signs.clear();this.roadInfo=null;
    this.network=null;this.origin=null;this.graph=null;this.world=null;this.roads.clear();this.buildings.clear();this.root.position.set(0,0,0);
  }
}
