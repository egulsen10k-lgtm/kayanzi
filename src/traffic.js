import * as THREE from 'three';
import { projectCoordinate } from './road-network.js';

// Bounded local traffic; each vehicle follows connected points on its own road.
export class TrafficManager {
  constructor(scene) { this.scene=scene;this.cars=[];this.network=null;this.maxCars=8; }
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
        const a=road.points[i],b=road.points[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        const distance=Math.hypot((a[0]+b[0])/2-p[0],(a[1]+b[1])/2-p[1]);
        if(length>15&&distance>18&&distance<280)candidates.push({road,i,distance});
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
      this.cars.push({group,road:candidate.road,ptIdx:candidate.i,t:.5,direction:1,speed:0,cruise:22+(i%4)*5,x:Infinity,y:Infinity,roadHeight:0,heading:0});
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
      let a=road.points[car.ptIdx],b=road.points[car.ptIdx+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(length<.01)continue;
      const ahead=(x,y)=>(x-car.x)*Math.sin(car.heading)+(y-car.y)*Math.cos(car.heading)>-1;
      const blocked=(Math.abs(car.roadHeight-(player.roadHeight??.08))<1&&Math.hypot(car.x-p[0],car.y-p[1])<12&&ahead(...p)) || this.cars.some(other=>other!==car&&Math.abs(other.roadHeight-car.roadHeight)<1&&Math.hypot(other.x-car.x,other.y-car.y)<10&&ahead(other.x,other.y));
      car.speed=Math.max(0,Math.min(car.cruise,car.speed+(blocked?-60:12)*dt));
      car.t+=car.direction*car.speed/3.6*dt/length;
      if(car.t>1){if(car.ptIdx<road.points.length-2){car.ptIdx++;car.t=0;}else{car.direction=-1;car.t=1;car.speed=0;}}
      if(car.t<0){if(car.ptIdx>0){car.ptIdx--;car.t=1;}else{car.direction=1;car.t=0;car.speed=0;}}
      a=road.points[car.ptIdx];b=road.points[car.ptIdx+1];dx=b[0]-a[0];dy=b[1]-a[1];length=Math.hypot(dx,dy)||1;
      const lane=Math.min(road.width/4,1.7)*car.direction;
      car.x=a[0]+dx*car.t+dy/length*lane;car.y=a[1]+dy*car.t-dx/length*lane;
      car.heading=Math.atan2(dx*car.direction,dy*car.direction);
      car.roadHeight=.08+(road.elevations?.[car.ptIdx]??0)*(1-car.t)+(road.elevations?.[car.ptIdx+1]??0)*car.t;
      car.group.position.set(car.x-p[0],car.roadHeight,-(car.y-p[1]));car.group.rotation.y=Math.PI-car.heading;
      // Close contact stops player motion; opposite road levels never collide.
      if(Math.abs(car.roadHeight-(player.roadHeight??.08))<1&&Math.hypot(car.x-p[0],car.y-p[1])<2.7){player.speed=0;car.speed=0;}
    }
  }
}
