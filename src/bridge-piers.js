import * as THREE from 'three';
export function buildBridgePiers(network) {
  const group=new THREE.Group();group.name='bridge-piers';
  const piers=[];
  const blocksRoad=p=>(network.roads??[]).some(road=>road.points.some((b,i)=>{
    if(!i || Math.abs(road.elevations?.[i]??0)>1.5)return false;
    const a=road.points[i-1],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
    if(!l)return false;
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l));
    return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t)<road.width/2+2;
  }));
  for(const road of network.roads??[]) {
    if(!road.bridge)continue;
    let distance=0;
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      distance+=length;
      const height=(road.elevations?.[i]??0)-.4;
      if(distance<24 || height<2 || !length)continue;
      distance=0;
      for(const side of [-1,1]) {
        const p=[b[0]-(b[1]-a[1])/length*road.width*.38*side,b[1]+(b[0]-a[0])/length*road.width*.38*side];
        if(!blocksRoad(p))piers.push({p,height});
      }
      if(piers.length>=120)break;
    }
  }
  if(!piers.length)return group;
  const mesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(.4,.52,1,8),new THREE.MeshStandardMaterial({color:0x9da19c,roughness:.95}),piers.length);
  const dummy=new THREE.Object3D();
  piers.forEach(({p,height},i)=>{dummy.position.set(p[0],height/2,-p[1]);dummy.scale.set(1,height,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return group;
}
