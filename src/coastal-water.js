import * as THREE from 'three';

// OSM coastlines are directed: land on the left, sea on the right.
// Stay within the mapped segments' longitudinal extent instead of extending
// incomplete coastlines into imaginary coast. A coarse boundary leaves aerial
// imagery visible immediately along the shore.
export function coastalSegments(coastlines) {
  const segments=[];
  for (const coast of coastlines ?? []) {
    const points=coast.points ?? coast;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
      if(length2>.01 && [...a,...b].every(Number.isFinite)) segments.push({a,b,dx,dy,length2});
    }
  }
  return segments;
}
export function isMappedSea(point,segments,maxDistance=700) {
  let nearest=null,best=maxDistance*maxDistance;
  for(const s of segments) {
    const t=((point[0]-s.a[0])*s.dx+(point[1]-s.a[1])*s.dy)/s.length2;
    const bounded=Math.max(0,Math.min(1,t));
    const x=point[0]-s.a[0]-s.dx*bounded,y=point[1]-s.a[1]-s.dy*bounded;
    const d=x*x+y*y;
    if(d<best){best=d;nearest={s,t,cross:s.dx*(point[1]-s.a[1])-s.dy*(point[0]-s.a[0])};}
  }
  return Boolean(nearest && nearest.t>=0 && nearest.t<=1 && nearest.cross<0);
}

export function buildCoastalWater(network) {
  const group=new THREE.Group();group.name='coastal-water';
  const segments=coastalSegments(network.coastlines);
  if(!segments.length)return group;
  const radius=650,step=16,vertices=[];
  const samples=new Map();
  const sea=(x,y)=>{
    const key=`${x},${y}`;
    if(!samples.has(key))samples.set(key,isMappedSea([x,y],segments));
    return samples.get(key);
  };
  for(let x=-radius;x<radius;x+=step) for(let y=-radius;y<radius;y+=step) {
    if(!sea(x,y)||!sea(x+step,y)||!sea(x,y+step)||!sea(x+step,y+step))continue;
    vertices.push(x,-.008,-y,x+step,-.008,-y,x+step,-.008,-y-step,
      x,-.008,-y,x+step,-.008,-y-step,x,-.008,-y-step);
  }
  if(!vertices.length)return group;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const time={value:0};
  const material=new THREE.MeshStandardMaterial({color:0x20798d,roughness:.25,metalness:.35,side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.uniforms.waterTime=time;
    shader.vertexShader='varying vec2 coastPoint;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncoastPoint=position.xz;');
    shader.fragmentShader='uniform float waterTime;\nvarying vec2 coastPoint;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      float ripple=sin(coastPoint.x*.24+coastPoint.y*.17+waterTime*.7);
      float ripple2=cos(coastPoint.y*.35-coastPoint.x*.09-waterTime*.9);
      normal=normalize(normal+vec3(ripple*.12,ripple2*.08,0.0));`);
  };
  material.customProgramCacheKey=()=> 'coastal-ripples-v1';
  const mesh=new THREE.Mesh(geometry,material);mesh.name='sea-surface';mesh.receiveShadow=true;
  mesh.userData.animateWater=seconds=>{time.value=seconds;};group.add(mesh);
  return group;
}
