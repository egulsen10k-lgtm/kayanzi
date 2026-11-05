import * as THREE from 'three';
import { buildTrafficGraph } from './traffic-routes.js';
import { sidewalkWidth } from './sidewalks.js';

const finitePoint = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const finiteTangent = tangent => finitePoint(tangent) && Math.hypot(tangent[0], tangent[1]) > 1e-6;
const validRoad = road => road && Number.isFinite(road.width) && road.width >= 3 && road.width <= 40 &&
  Array.isArray(road.points) && road.points.length > 1 && road.points.every(finitePoint) &&
  (!road.elevations || (Array.isArray(road.elevations) && road.elevations.length === road.points.length && road.elevations.every(Number.isFinite)));

// Shared by paint, signal stop lines, and vehicle stopping distances.
export function crosswalkLayout(edge) {
  if (!edge || !validRoad(edge.road) || !finitePoint(edge.start) || !finitePoint(edge.end) ||
      !finiteTangent(edge.tangent) || !finiteTangent(edge.normal) || !Number.isFinite(edge.length) ||
      !Number.isFinite(edge.trim) || edge.length <= 0 || edge.trim < 0) return null;
  const node=edge.to;
  if(!node || !finitePoint(node.p) || !Number.isFinite(node.h) || !(node.neighbors instanceof Map || node.neighbors instanceof Set) ||
      !(node.incoming instanceof Set || Array.isArray(node.incoming)) || !(node.out instanceof Set || Array.isArray(node.out))) return null;
  if(node.neighbors.size<3||Math.abs(node.h)>.5||!sidewalkWidth(edge.road))return null;
  const crossing=[...node.incoming,...node.out].filter(other=>other && validRoad(other.road) && finiteTangent(other.tangent) &&
    Number.isFinite(other.road.width) && Math.abs(other.tangent[0]*edge.tangent[0]+other.tangent[1]*edge.tangent[1])<.8);
  if(!crossing.length||crossing.some(other=>!sidewalkWidth(other.road)))return null;
  const depth=3,setback=Math.max(...crossing.map(other=>other.road.width/2))+depth/2+.7;
  if(edge.length+2*edge.trim<2*(setback+depth/2+.8))return null;
  const stopOffset=Math.max(0,setback+depth/2+.8-edge.trim);
  if(!Number.isFinite(setback)||!Number.isFinite(stopOffset)||!Number.isFinite(edge.road.width))return null;
  return {x:node.p[0]-edge.tangent[0]*setback,y:node.p[1]-edge.tangent[1]*setback,
    height:node.h+.08,width:edge.road.width,depth,tangent:edge.tangent,normal:edge.normal,stopOffset};
}

export function buildCrosswalkMesh(network) {
  const roads=(network?.roads??[]).filter(road=>Number.isFinite(road.width)&&road.width<=40&&Array.isArray(road.points)&&road.points.length>1&&road.points.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]))&&(!road.elevations||road.elevations.every(Number.isFinite)));
  if(roads.filter(road=>sidewalkWidth(road)>0).length<2)return null;
  const graph=buildTrafficGraph({...network,roads}),crossings=[],vertices=[];
  for(const edge of graph.edges) {
    const layout=crosswalkLayout(edge);if(!layout)continue;
    if(crossings.some(other=>Math.hypot(other.x-layout.x,other.y-layout.y)<4&&Math.abs(other.tangent[0]*layout.tangent[0]+other.tangent[1]*layout.tangent[1])>.8))continue;
    crossings.push(layout);
    const count=Math.max(2,Math.floor(layout.width)),paintedWidth=count-.5;
    const point=(across,along)=>[layout.x+layout.normal[0]*across+layout.tangent[0]*along,layout.height+.009,-layout.y-layout.normal[1]*across-layout.tangent[1]*along];
    for(let i=0;i<count;i++) {
      const side=-paintedWidth/2+i,a=point(side,-layout.depth/2),b=point(side+.5,-layout.depth/2),c=point(side+.5,layout.depth/2),d=point(side,layout.depth/2);
      vertices.push(...a,...b,...c,...a,...c,...d);
    }
  }
  if(!vertices.length)return null;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({color:0xf4f1df,roughness:.95,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='crosswalks';mesh.receiveShadow=true;mesh.renderOrder=2;mesh.userData.crossings=crossings;
  return mesh;
}
