import { projectCoordinate } from './road-network.js';
import { roadSurfaceAt } from './road-safety.js';
import { sidewalkWidth } from './sidewalks.js';

export const seatCapacity = model => /m4|csl/i.test(model) ? 2 : 5;
function insideBuilding(network, p) {
  return (network.buildings ?? []).some(building => {
    if ((building.minHeight ?? 0) > 2) return false;
    let inside = false;
    const points = building.points;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
    }
    return inside;
  });
}
export class Pedestrians {
  constructor() { this.people = []; this.passengers = 0; this.network = null; this.message = 'Korna çal: yakındaki yayaları çağır'; }
  reset(network, car) {
    this.network = network; this.people = [];
    const p = projectCoordinate(car.lat, car.lng, network.center);
    const candidates = [];
    for (const road of network.roads ?? []) {
      if (!sidewalkWidth(road)) continue;
      for (let i=1;i<road.points.length;i++) {
        const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        if (length<4 || Math.abs(road.elevations?.[i] ?? 0)>.5) continue;
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length*length)));
        for (const shift of [-24,-12,0,12,24]) for (const side of [-1,1]) {
          const u=t+shift/length;if(u<.02||u>.98)continue;
          const offset=road.width/2+.75;
          const point=[a[0]+dx*u-dy/length*offset*side,a[1]+dy*u+dx/length*offset*side];
          const distance=Math.hypot(point[0]-p[0],point[1]-p[1]);
          if(distance<7||distance>95||insideBuilding(network,point))continue;
          const height=roadSurfaceAt(network,point,.08);if(height===null)continue;
          candidates.push({point,height,distance,heading:Math.atan2(dx,dy)});
        }
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    for (const candidate of candidates) {
      if(this.people.some(n=>Math.hypot(n.x-candidate.point[0],n.y-candidate.point[1])<5))continue;
      this.people.push({id:this.people.length,x:candidate.point[0],y:candidate.point[1],height:candidate.height,heading:candidate.heading,state:'idle',remaining:0,phase:0});
      if(this.people.length>=16)break;
    }
  }
  horn(car) {
    if (!this.network || Math.abs(car.roadHeight ?? .08)>.6) return 0;
    const p=projectCoordinate(car.lat,car.lng,this.network.center);
    let count=0;
    for(const person of this.people) {
      if(person.state==='boarded'||Math.hypot(person.x-p[0],person.y-p[1])>55)continue;
      person.state='chasing';person.remaining=18;count++;
    }
    this.message=count ? `${count} kişi geliyor! Binmeleri için yavaşla.` : 'Yakında korna duyacak yaya yok.';
    return count;
  }
  update(car, dt) {
    const capacity=seatCapacity(car.bmwModel);
    this.passengers=Math.min(this.passengers,capacity-1);
    if(!car.roadNetwork) {this.people=[];this.network=null;return;}
    const p=projectCoordinate(car.lat,car.lng,car.roadNetwork.center);
    const far=this.network===car.roadNetwork && this.people.length && this.people.every(n=>Math.hypot(n.x-p[0],n.y-p[1])>130);
    if(this.network!==car.roadNetwork||far)this.reset(car.roadNetwork,car);
    dt=Math.min(.1,Math.max(0,dt));
    for(const person of this.people) {
      if(person.state!=='chasing')continue;
      person.remaining-=dt;
      if(person.remaining<=0||Math.abs(person.height-(car.roadHeight??.08))>.6){person.state='idle';continue;}
      const dx=p[0]-person.x,dy=p[1]-person.y,distance=Math.hypot(dx,dy);
      if(distance<2.8 && Math.abs(car.speed)<8 && ![.25,.5,.75].some(t=>insideBuilding(this.network,[person.x+dx*t,person.y+dy*t]))) {
        if(this.passengers<capacity-1){this.passengers++;person.state='boarded';this.message=`Yolcu bindi · ${this.passengers+1}/${capacity} kişi`;} 
        else {person.state='idle';this.message='Araba dolu. Kapasite aşılmıyor.';}
        continue;
      }
      const direction=Math.atan2(dx,dy),step=Math.min(4.3*dt,Math.max(0,distance-2.1));
      for(const turn of [0,.5,-.5,1,-1]) {
        const heading=direction+turn, next=[person.x+Math.sin(heading)*step,person.y+Math.cos(heading)*step];
        const height=roadSurfaceAt(this.network,next,person.height);
        if(height===null||insideBuilding(this.network,next)||this.people.some(other=>other!==person&&other.state!=='boarded'&&Math.hypot(other.x-next[0],other.y-next[1])<.55))continue;
        person.x=next[0];person.y=next[1];person.height=height;person.heading=heading;person.phase+=dt*11;break;
      }
    }
  }
}
