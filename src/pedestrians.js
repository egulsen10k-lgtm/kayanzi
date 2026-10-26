import { projectCoordinate } from './road-network.js';
import { localToCoordinate } from './road-safety.js';
import { SIDEWALK_HEIGHT, sidewalkWidth } from './sidewalks.js';

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
function distanceToSegment(point, a, b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],lengthSquared=dx*dx+dy*dy;
  const t=lengthSquared ? Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/lengthSquared)) : 0;
  return Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dy*t);
}
function sidewalkSurfaceAt(network, point) {
  let best = null;
  for (const road of network.roads ?? []) {
    for (let i=1;i<road.points.length;i++) {
      const width = sidewalkWidth({...road, elevations: [0, 0]});
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],lengthSquared=dx*dx+dy*dy;
      if(!width || lengthSquared<.01)continue;
      const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/lengthSquared));
      const lateral=Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);
      const half=road.width/2;
      if(lateral<half+.12||lateral>half+width-.08)continue;
      const elevation=(road.elevations?.[i-1]??0)+((road.elevations?.[i]??0)-(road.elevations?.[i-1]??0))*t;
      const height=elevation+SIDEWALK_HEIGHT;
      if(best===null||Math.abs(height-.22)<Math.abs(best-.22))best=height;
    }
  }
  return best;
}
export class Pedestrians {
  constructor() { this.people = []; this.passengers = 0; this.network = null; this.density = 1; this.message = 'Korna çal: yakındaki yayaları çağır'; }
  clearNetwork() {
    this.network = null;
    this.people = [];
    this.passengers = 0;
    this.lastCarPoint = null;
  }
  reset(network, car, density = this.density) {
    this.network = network; this.people = []; this.lastCarPoint = null; this.density = Math.max(0, Math.min(2, Number(density) || 0));
    const p = projectCoordinate(car.lat, car.lng, network.center);
    const candidates = [];
    for (const road of network.roads ?? []) {
      if (!sidewalkWidth(road)) continue;
      for (let i=1;i<road.points.length;i++) {
        const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        if (length<4 || Math.abs(road.elevations?.[i-1] ?? 0)>.5 || Math.abs(road.elevations?.[i] ?? 0)>.5) continue;
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length*length)));
        for (const shift of [-70,-52,-35,-18,0,18,35,52,70]) for (const side of [-1,1]) {
          const u=t+shift/length;if(u<.02||u>.98)continue;
          const offset=road.width/2+.75;
          const point=[a[0]+dx*u-dy/length*offset*side,a[1]+dy*u+dx/length*offset*side];
          const distance=Math.hypot(point[0]-p[0],point[1]-p[1]);
          if(distance<10||distance>145||insideBuilding(network,point))continue;
          const height=sidewalkSurfaceAt(network,point);if(height===null)continue;
          candidates.push({point,height,distance,heading:Math.atan2(dx,dy)});
        }
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    for (const candidate of candidates) {
      if(this.people.some(n=>Math.hypot(n.x-candidate.point[0],n.y-candidate.point[1])<4.5))continue;
      const id=this.people.length;
      this.people.push({id,style:['goth','turkish-headscarf','casual','goth','turkish'][id%5],x:candidate.point[0],y:candidate.point[1],height:candidate.height,heading:candidate.heading,state:'idle',remaining:0,phase:0});
      if(this.people.length>=Math.min(24,Math.round(20 * this.density)))break;
    }
  }
  highBeam(car) {
    if (!this.network || !car || !this.people.length) return 0;
    const p = projectCoordinate(car.lat, car.lng, this.network.center);
    const forward = [Math.sin(car.heading), Math.cos(car.heading)]; let count = 0;
    for (const person of this.people) {
      const dx = person.x - p[0], dy = person.y - p[1], distance = Math.hypot(dx, dy);
      if (distance > 42 || dx * forward[0] + dy * forward[1] < 2) continue;
      const side = Math.abs(dx * forward[1] - dy * forward[0]);
      if (side < 9) count++;
    }
    if (count) this.message = count === 1 ? 'Yaya: Farlarını kısar mısın?' : `${count} yaya farlardan rahatsız oldu.`;
    return count;
  }
  horn(car) {
    if (!this.network || Math.abs(car.roadHeight ?? .08)>.6) return 0;
    const p=projectCoordinate(car.lat,car.lng,this.network.center);
    let count=0;
    for(const person of this.people) {
      if(!['idle','chasing'].includes(person.state)||Math.hypot(person.x-p[0],person.y-p[1])>55)continue;
      person.state='chasing';person.remaining=18;count++;
    }
    this.message=count ? `${count} kişi geliyor! Binmeleri için yavaşla.` : 'Yakında korna duyacak yaya yok.';
    return count;
  }
  update(car, dt) {
    const capacity=seatCapacity(car.bmwModel);
    this.passengers=Math.min(this.passengers,capacity-1);
    if(!car.roadNetwork) {this.people=[];this.network=null;this.lastCarPoint=null;return;}
    const p=projectCoordinate(car.lat,car.lng,car.roadNetwork.center);
    const far=this.network===car.roadNetwork && this.people.length && this.people.every(n=>Math.hypot(n.x-p[0],n.y-p[1])>130);
    if(this.network!==car.roadNetwork||far) {
      const attached=this.network ? this.people.filter(n=>n.state==='clinging').map(n=>({person:n,coordinate:localToCoordinate([n.x,n.y],this.network.center)})) : [];
      this.reset(car.roadNetwork,car);
      for(const {person,coordinate} of attached) {
        const point=projectCoordinate(coordinate.lat,coordinate.lng,this.network.center);
        person.x=point[0];person.y=point[1];
      }
      this.people=[...attached.map(n=>n.person),...this.people].slice(0,24);
    }
    const previous=this.lastCarPoint && this.lastCarPoint.network===car.roadNetwork ? this.lastCarPoint.point : p;
    this.lastCarPoint={network:car.roadNetwork,point:p};
    dt=Math.min(.1,Math.max(0,dt));
    const steer=car.steering ?? 0;
    const sign=Math.abs(steer)>.25 ? Math.sign(steer) : 0;
    this.wiggleTime=Math.max(0,(this.wiggleTime??0)-dt);
    if(sign && this.lastSteerSign && sign!==this.lastSteerSign)this.wiggleTime=1.3;
    if(sign)this.lastSteerSign=sign;
    for(const person of this.people) {
      if(['idle','chasing'].includes(person.state) && Math.abs(car.speed) > 8) {
        const heading = car.heading ?? 0;
        const forward=[Math.sin(heading),Math.cos(heading)];
        const a=[previous[0]-forward[0]*2.25,previous[1]-forward[1]*2.25];
        const b=[p[0]+forward[0]*2.25,p[1]+forward[1]*2.25];
        if(distanceToSegment([person.x,person.y],a,b) < 1.2 && Math.abs(person.height - (car.roadHeight ?? .08)) < .6) {
          const speed = Math.abs(car.speed) / 3.6;
          const direction = Math.sign(car.speed) || 1;
          person.state = 'ragdoll';
          person.fall = {
            age: 0,
            vx: Math.sin(heading) * speed * direction + (person.x - p[0]) * 1.5,
            vy: Math.min(12, 2 + speed * .16),
            vz: Math.cos(heading) * speed * direction + (person.y - p[1]) * 1.5
          };
          person.recoveryPoint = null;
          this.message = `${Math.round(Math.abs(car.speed))} km/sa çarpışma: yaya savruldu.`;
          continue;
        }
      }
      if(person.state==='clinging') {
        const heading=car.heading ?? 0, side=person.gripSlot%2 ? 1 : -1, along=person.gripSlot<2 ? .65 : -.8;
        person.x=p[0]+Math.sin(heading)*along+Math.cos(heading)*side*1.25;
        person.y=p[1]+Math.cos(heading)*along-Math.sin(heading)*side*1.25;
        person.height=(car.roadHeight??.08)+.12;
        person.heading=heading-side*Math.PI/2;
        const speed=Math.abs(car.speed);
        if(speed>=80 && this.wiggleTime>0) {
          person.state='ragdoll';
          person.fall={age:0,vx:Math.sin(heading)*car.speed/3.6+Math.cos(heading)*side*2,
            vy:2.5,vz:Math.cos(heading)*car.speed/3.6-Math.sin(heading)*side*2};
          this.message='80 km/sa üstünde savrulma: tutunanlar düştü!';
        }
        continue;
      }
      if(person.state==='ragdoll') {
        person.fall.age+=dt;
        if(person.fall.age>=4) {
          const point=person.recoveryPoint;
          if(point){person.x=point.x;person.y=point.y;person.height=point.height;}
          person.state='recovering';person.recoveryTime=0;
        }
        continue;
      }
      if(person.state==='recovering') {
        person.recoveryTime+=dt;
        if(person.recoveryTime>=1.2){person.state='idle';person.fall=null;person.recoveryPoint=null;}
        continue;
      }
      if(person.state!=='chasing')continue;
      person.remaining-=dt;
      if(person.remaining<=0||Math.abs(person.height-(car.roadHeight??.08))>.6){person.state='idle';continue;}
      const dx=p[0]-person.x,dy=p[1]-person.y,distance=Math.hypot(dx,dy);
      if(distance<5.4 && Math.abs(car.speed)<8 && ![.25,.5,.75].some(t=>insideBuilding(this.network,[person.x+dx*t,person.y+dy*t]))) {
        if(this.passengers<capacity-1){this.passengers++;person.state='boarded';this.message=`Yolcu bindi · ${this.passengers+1}/${capacity} kişi`;} 
        else {
          const occupied=new Set(this.people.filter(n=>n.state==='clinging').map(n=>n.gripSlot));
          const active=this.people.filter(n=>['clinging','ragdoll','recovering'].includes(n.state)).length;
          const slot=[0,1,2,3].find(i=>!occupied.has(i));
          if(slot!==undefined && active<4){person.state='clinging';person.gripSlot=slot;this.message='Araba dolu: dışarıdan tutunuyorlar. Hızlanınca düşerler!';}
          else {person.state='idle';this.message='Araba ve tutunma yerleri dolu.';}
        }
        continue;
      }
      const direction=Math.atan2(dx,dy),step=Math.min(4.3*dt,Math.max(0,distance-2.1));
      for(const turn of [0,.5,-.5,1,-1]) {
        const heading=direction+turn, next=[person.x+Math.sin(heading)*step,person.y+Math.cos(heading)*step];
        const height=sidewalkSurfaceAt(this.network,next);
        if(height===null)continue;
        if(height===null||insideBuilding(this.network,next)||this.people.some(other=>other!==person&&other.state!=='boarded'&&Math.hypot(other.x-next[0],other.y-next[1])<.55))continue;
        person.x=next[0];person.y=next[1];person.height=height;person.heading=heading;person.phase+=dt*11;break;
      }
    }
  }
}
