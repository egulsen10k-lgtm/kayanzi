import { sidewalkWidth, SIDEWALK_HEIGHT } from './sidewalks.js';
import { projectCoordinate } from './road-network.js';
const R = 6371008.8;
const indexes = new WeakMap();
const CELL = 30;
function segmentsFor(network) {
  if (indexes.has(network)) return indexes.get(network);
  const cells = new Map(), segments = [];
  for (const road of network.roads ?? []) {
    if (!Number.isFinite(road.width) || road.width < 2.5) continue;
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1], b=road.points[i];
      if (![...a,...b].every(Number.isFinite) || Math.hypot(b[0]-a[0],b[1]-a[1])<.01) continue;
      const s={a,b,width:road.width,sidewalk:sidewalkWidth(road),name:road.name,ha:(road.elevations?.[i-1] ?? 0)+.08,hb:(road.elevations?.[i] ?? 0)+.08}; segments.push(s);
      const margin=road.width/2+s.sidewalk;
      for(let x=Math.floor((Math.min(a[0],b[0])-margin)/CELL);x<=Math.floor((Math.max(a[0],b[0])+margin)/CELL);x++)
        for(let y=Math.floor((Math.min(a[1],b[1])-margin)/CELL);y<=Math.floor((Math.max(a[1],b[1])+margin)/CELL);y++) {
          const key=`${x},${y}`; if(!cells.has(key)) cells.set(key,[]); cells.get(key).push(s);
        }
    }
  }
  const buildings = new Map();
  for (const building of network.buildings ?? []) {
    const xs=building.points.map(p=>p[0]),ys=building.points.map(p=>p[1]);
    for(let x=Math.floor((Math.min(...xs)-1)/CELL);x<=Math.floor((Math.max(...xs)+1)/CELL);x++)
      for(let y=Math.floor((Math.min(...ys)-1)/CELL);y<=Math.floor((Math.max(...ys)+1)/CELL);y++) {
        const key=`${x},${y}`;if(!buildings.has(key))buildings.set(key,[]);buildings.get(key).push(building);
      }
  }
  const result={segments,cells,buildings}; indexes.set(network,result); return result;
}
function nearest(p,s) {
  const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1];
  const t=Math.max(0,Math.min(1,((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dy)/(dx*dx+dy*dy)));
  return [s.a[0]+dx*t,s.a[1]+dy*t];
}
function nearby(map,p) {
  const x=Math.floor(p[0]/CELL),y=Math.floor(p[1]/CELL),found=new Set(),result=[];
  for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++)
    for(const item of map.get(`${x+dx},${y+dy}`) ?? []) if(!found.has(item)){found.add(item);result.push(item);}
  return result;
}
export function localToCoordinate(point,center) {
  const distance=Math.hypot(...point)/R,bearing=Math.atan2(point[0],point[1]);
  const lat=center.lat*Math.PI/180,lng=center.lng*Math.PI/180;
  const phi=Math.asin(Math.sin(lat)*Math.cos(distance)+Math.cos(lat)*Math.sin(distance)*Math.cos(bearing));
  const lambda=lng+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(lat),Math.cos(distance)-Math.sin(lat)*Math.sin(phi));
  return {lat:phi*180/Math.PI,lng:((lambda*180/Math.PI+540)%360)-180};
}
function surfaceHeight(p,s) {
  const q=nearest(p,s), length=Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1]);
  return s.ha+(s.hb-s.ha)*Math.hypot(q[0]-s.a[0],q[1]-s.a[1])/length;
}
export function roadSurfaceAt(network,p,referenceRoadHeight=.08) {
  if(!network?.roads) return null;
  const candidates=nearby(segmentsFor(network).cells,p);
  let best=null, distance=Infinity;
  for(const s of candidates) {
    const q=nearest(p,s), horizontal=Math.hypot(p[0]-q[0],p[1]-q[1]);
    const onAsphalt=horizontal<=s.width/2;
    const h=(onAsphalt ? surfaceHeight(p,s) : SIDEWALK_HEIGHT), delta=Math.abs(h-referenceRoadHeight);
    // At junctions, asphalt cuts through the raised sidewalk of a crossing road.
    const score=(onAsphalt ? 0 : 1000)+horizontal+delta*.001;
    if(horizontal<=s.width/2+s.sidewalk && delta<=.65 && score<distance) { best=h; distance=score; }
  }
  return best;
}
function circleOnRoad(network,p,radius,roadHeight) {
  if (Math.hypot(...p)+radius > network.radiusMeters-.5) return false;
  const candidates=nearby(segmentsFor(network).cells,p);
  if (!candidates.some(s=>{const q=nearest(p,s);return Math.abs(surfaceHeight(p,s)-roadHeight)<=.65 && Math.hypot(p[0]-q[0],p[1]-q[1])<=s.width/2+s.sidewalk-radius+1e-6;})) return false;
  for (const building of nearby(segmentsFor(network).buildings,p)) {
    if (roadHeight+1.5 <= (building.minHeight ?? 0) || roadHeight >= (building.height ?? 10)) continue;
    let inside=false;
    for(let i=1;i<building.points.length;i++) {
      const a=building.points[i-1],b=building.points[i];
      if (Math.hypot(b[0]-a[0],b[1]-a[1])<.001) continue;
      const q=nearest(p,{a,b});
      if(Math.hypot(q[0]-p[0],q[1]-p[1])<radius) return false;
      if ((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    if(inside)return false;
  }
  return true;
}
export function footprintOnRoad(network,point,heading=0,roadHeight=.08) {
  if(!network?.roads?.length || !Number.isFinite(network.radiusMeters) || !Number.isFinite(heading)) return false;
  // A tighter 4.5m × 1.8m envelope permits close sidewalk maneuvering.
  for (const along of [-1.8,-.9,0,.9,1.8]) for (const across of [-.45,0,.45]) {
    if (!circleOnRoad(network,[point[0]+Math.sin(heading)*along+Math.cos(heading)*across,
      point[1]+Math.cos(heading)*along-Math.sin(heading)*across],.45,roadHeight)) return false;
  }
  return true;
}
export function nearestRoadSpawn(network,lat,lng) {
  const p=projectCoordinate(lat,lng,network.center); if(!p) return null;
  let best=null;
  for(const s of segmentsFor(network).segments) {
    const q=nearest(p,s), heading=Math.atan2(s.b[0]-s.a[0],s.b[1]-s.a[1]);
    const roadHeight=surfaceHeight(q,s);
    if(!footprintOnRoad(network,q,heading,roadHeight)) continue;
    const distance=Math.hypot(q[0]-p[0],q[1]-p[1]);
    if(!best || distance<best.distance) best={...localToCoordinate(q,network.center),heading,distance,name:s.name,roadHeight};
  }
  return best;
}
/** Swept translation AND rotation prevent high-speed or steering-only edge escapes. */
export function sweepRoadMotionResult(network,start,end) {
  let roadHeight=start.roadHeight ?? .08;
  const result=fraction=>({fraction,roadHeight});
  if(!network?.center) return result(0);
  const a=projectCoordinate(start.lat,start.lng,network.center),b=projectCoordinate(end.lat,end.lng,network.center);
  if(!a||!b||!footprintOnRoad(network,a,start.heading,roadHeight)) return result(0);
  const angle=Math.atan2(Math.sin(end.heading-start.heading),Math.cos(end.heading-start.heading));
  const steps=Math.max(1,Math.ceil((Math.hypot(b[0]-a[0],b[1]-a[1])+Math.abs(angle)*2.5)/.2));
  const safe=t=>{
    const p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    const h=roadSurfaceAt(network,p,roadHeight);
    return h!==null && footprintOnRoad(network,p,start.heading+angle*t,h) ? h : null;
  };
  let previous=0;
  for(let i=1;i<=steps;i++) {
    const t=i/steps, h=safe(t);
    if(h===null) {
      let low=previous,high=t;
      for(let j=0;j<12;j++){ const m=(low+high)/2, mh=safe(m); if(mh!==null){low=m;roadHeight=mh;}else high=m; }
      return result(low);
    }
    previous=t; roadHeight=h;
  }
  return result(1);
}
export function sweepRoadMotion(network,start,end) { return sweepRoadMotionResult(network,start,end).fraction; }
