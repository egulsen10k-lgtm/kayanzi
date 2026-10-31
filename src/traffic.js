import { resolveTrafficContact, integrateTrafficImpact } from './traffic-collision.js';
import * as THREE from 'three';
import { projectCoordinate } from './road-network.js';
import { footprintOnRoad } from './road-safety.js';

// Bounded local traffic; each vehicle follows connected points on its own road.
export class TrafficManager {
  constructor(parent) { this.scene=parent;this.cars=[];this.network=null;this.maxCars=8; }
  setDensity(value,player) {
    this.maxCars=Math.round(Math.max(0,Math.min(2,Number(value)||0))*8);
    if(this.network)this.reset(this.network,player);
  }
  reset(network,player) {
    this.clear();this.network=network;if(!network)return;
    const p=projectCoordinate(player.lat,player.lng,network.center);
    const candidates=[];
    for(const road of network.roads??[]) {
      if(road.width<6)continue;
      for(let i=0;i<road.points.length-1;i++) {
        const a=road.points[i],b=road.points[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        const distance=Math.hypot((a[0]+b[0])/2-p[0],(a[1]+b[1])/2-p[1]);
        if(length<=15||distance<=18||distance>=280)continue;
        const lane=Math.min(road.width/4,1.7),heading=Math.atan2(dx,dy);
        const position=[(a[0]+b[0])/2+dy/length*lane,(a[1]+b[1])/2-dx/length*lane];
        const roadHeight=.08+((road.elevations?.[i]??0)+(road.elevations?.[i+1]??0))*.5;
        if(footprintOnRoad(network,position,heading,roadHeight))candidates.push({road,i,distance});
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    for(let i=0;i<Math.min(this.maxCars,candidates.length);i++) {
      const candidate=candidates[i],group=new THREE.Group();
      const paint=new THREE.MeshStandardMaterial({color:[0x7399b5,0xce6d55,0xe4ded0,0x446357][i%4],roughness:.4,metalness:.3});
      const dark=new THREE.MeshStandardMaterial({color:0x1a2630,roughness:.5});
      const part=(w,h,d,material,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);group.add(m);};
      part(1.8,.55,4.2,paint,0,.55,0);part(1.5,.55,2.1,dark,0,1.1,-.1);
      for(const x of [-.92,.92])for(const z of [-1.3,1.3])part(.18,.55,.65,dark,x,.32,z);
      this.scene.add(group);
      this.cars.push({group,road:candidate.road,ptIdx:candidate.i,t:.5,direction:1,speed:0,cruise:22+(i%4)*5,x:0,y:0,offsetX:0,offsetY:0,yawOffset:0,roadHeight:.08,heading:0,impactTime:Infinity,vx:0,vy:0});
    }
    this.update(0,player);
  }
  clear() {
    for(const car of this.cars){const materials=new Set();car.group.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});materials.forEach(m=>m.dispose());car.group.removeFromParent();}
    this.cars=[];this.network=null;
  }
  update(dt,player) {
    if(!this.network)return;
    dt=Math.max(0,Math.min(.1,dt));const p=projectCoordinate(player.lat,player.lng,this.network.center);
    for(const car of this.cars) {
      const road=car.road;
      const previous={x:car.x,y:car.y,t:car.t,ptIdx:car.ptIdx,direction:car.direction,
        heading:car.heading,roadHeight:car.roadHeight,offsetX:car.offsetX,offsetY:car.offsetY,
        yawOffset:car.yawOffset,angularVelocity:car.angularVelocity};
      let a=road.points[car.ptIdx],b=road.points[car.ptIdx+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(length<.01)continue;
      const ahead=(x,y)=>(x-car.x)*Math.sin(car.heading)+(y-car.y)*Math.cos(car.heading)>-1;
      const blocked=(Math.abs(car.roadHeight-(player.roadHeight??.08))<1&&Math.hypot(car.x-p[0],car.y-p[1])<12&&ahead(...p)) || this.cars.some(other=>other!==car&&Math.abs(other.roadHeight-car.roadHeight)<1&&Math.hypot(other.x-car.x,other.y-car.y)<10&&ahead(other.x,other.y));
      integrateTrafficImpact(car,dt,Math.hypot(car.x-p[0],car.y-p[1]));
      const recovering=car.impactTime<2 || Math.hypot(car.vx,car.vy)>1;
      car.speed=recovering?0:Math.max(0,Math.min(car.cruise,car.speed+(blocked?-60:12)*dt));
      car.t+=car.direction*car.speed/3.6*dt/length;
      if(car.t>1){if(car.ptIdx<road.points.length-2){car.ptIdx++;car.t=0;}else{car.direction=-1;car.t=1;car.speed=0;}}
      if(car.t<0){if(car.ptIdx>0){car.ptIdx--;car.t=1;}else{car.direction=1;car.t=0;car.speed=0;}}
      a=road.points[car.ptIdx];b=road.points[car.ptIdx+1];dx=b[0]-a[0];dy=b[1]-a[1];length=Math.hypot(dx,dy)||1;
      const lane=Math.min(road.width/4,1.7)*car.direction;
      const normalX=dy/length,normalY=-dx/length;
      const laneRoom=Math.max(0,road.width/2-Math.abs(lane)-1.1);
      const sideOffset=car.offsetX*normalX+car.offsetY*normalY;
      const boundedSide=Math.max(-laneRoom,Math.min(laneRoom,sideOffset));
      if(sideOffset!==boundedSide) {
        car.offsetX+=(boundedSide-sideOffset)*normalX;
        car.offsetY+=(boundedSide-sideOffset)*normalY;
        const outwardVelocity=car.vx*normalX+car.vy*normalY;
        if(Math.sign(outwardVelocity)===Math.sign(sideOffset)) {
          car.vx-=outwardVelocity*normalX;car.vy-=outwardVelocity*normalY;
        }
      }
      const roadHeight=.08+(road.elevations?.[car.ptIdx]??0)*(1-car.t)+(road.elevations?.[car.ptIdx+1]??0)*car.t;
      const heading=Math.atan2(dx*car.direction,dy*car.direction)+car.yawOffset;
      const candidate=[a[0]+dx*car.t+dy/length*lane+car.offsetX,a[1]+dy*car.t-dx/length*lane+car.offsetY];
      if(footprintOnRoad(this.network,candidate,heading,roadHeight)) {
        car.x=candidate[0];car.y=candidate[1];car.heading=heading;car.roadHeight=roadHeight;
      } else {
        // The proposed lane position is blocked. Restore the last valid state;
        // never fall back to an unvalidated base lane at the same progress.
        Object.assign(car,previous);
        car.speed=0;car.vx=0;car.vy=0;car.angularVelocity=0;
      }
      if(dt>0) {
        const body={x:p[0],y:p[1],heading:player.heading??0,speed:player.speed,roadHeight:player.roadHeight??.08};
        const beforeContact={x:car.x,y:car.y,speed:car.speed,offsetX:car.offsetX,offsetY:car.offsetY,
          impactTime:car.impactTime,vx:car.vx,vy:car.vy,angularVelocity:car.angularVelocity};
        if(resolveTrafficContact(body,car)) {
          const contactSide=car.offsetX*normalX+car.offsetY*normalY;
          if(Math.abs(contactSide)<=laneRoom+1e-6 && footprintOnRoad(this.network,[car.x,car.y],car.heading,car.roadHeight)) player.speed=body.speed;
          else Object.assign(car,beforeContact);
        }
      }
      // The traffic parent shares the road group's player-relative transform.
      // Keep children in network coordinates so the player's movement is not applied twice.
      car.group.position.set(car.x,car.roadHeight,-car.y);car.group.rotation.y=Math.PI-car.heading;
    }
  }
}
