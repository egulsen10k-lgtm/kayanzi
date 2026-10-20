import * as THREE from 'three';
import { ROAD_SURFACE_HEIGHT } from './road-mesh.js';
import { projectCoordinate } from './road-network.js';

function deck(point,network,reference) {
  if(!network)return ROAD_SURFACE_HEIGHT;
  if(Math.hypot(...point)>network.radiusMeters)return null;
  let best=null,score=Infinity;
  for(const road of network.roads)for(let i=1;i<road.points.length;i++) {
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
    if(!l)continue;
    const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/l));
    const distance=Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dy*t);
    if(distance>road.width/2)continue;
    const ha=road.elevations?.[i-1]??0,hb=road.elevations?.[i]??0,height=ha+(hb-ha)*t+ROAD_SURFACE_HEIGHT;
    const rank=distance+(reference==null?0:Math.abs(height-reference)*.1);
    if(rank<score){score=rank;best=height;}
  }
  return best;
}
export function buildRouteRibbon(route,center,network=null) {
  const vertices=[],points=route.coordinates.map(([lng,lat])=>projectCoordinate(lat,lng,center));
  let previousHeight=null;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<.01)continue;
    if(network && Math.min(Math.hypot(...a),Math.hypot(...b))>network.radiusMeters+length)continue;
    const steps=Math.ceil(length/5),nx=(b[1]-a[1])/length*.16,nz=(b[0]-a[0])/length*.16;
    for(let j=0;j<steps;j++) {
      const at=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
      const p=at(j/steps),q=at((j+1)/steps),ha=deck(p,network,previousHeight),hb=deck(q,network,ha);
      if(ha===null||hb===null||Math.abs(hb-ha)>length/steps*.2+.1){previousHeight=null;continue;}
      previousHeight=hb;
      const ax=p[0],az=-p[1],bx=q[0],bz=-q[1],ay=ha+.035,by=hb+.035;
      vertices.push(ax+nx,ay,az+nz,bx+nx,by,bz+nz,bx-nx,by,bz-nz,ax+nx,ay,az+nz,bx-nx,by,bz-nz,ax-nx,ay,az-nz);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x19e4ed,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));
  mesh.name='akanzi-route';return mesh;
}
