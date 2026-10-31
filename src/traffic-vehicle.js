import * as THREE from 'three';
export const TRAFFIC_TYPES=['sedan','sedan','police','van','sedan','firetruck','ambulance','bus'];
export function createTrafficVehicle(type='sedan',id=0) {
  const group=new THREE.Group();group.name=`traffic-${type}-${id}`;
  const long=['firetruck','bus'].includes(type),length=long?6.2:type==='van'||type==='ambulance'?4.9:4.2,width=long?2.05:1.8;
  const colors={police:0xe4eef2,firetruck:0xc93025,ambulance:0xf4ede0,bus:0xd8a32a,van:0xbdc8c8};
  const paint=new THREE.MeshStandardMaterial({color:colors[type]??[0x7399b5,0xce6d55,0xe4ded0,0x446357][id%4],roughness:.5,metalness:.2});
  const dark=new THREE.MeshStandardMaterial({color:0x152733,roughness:.5}),rubber=new THREE.MeshStandardMaterial({color:0x17191c});
  const trim=new THREE.MeshStandardMaterial({color:type==='police'?0x155898:type==='ambulance'?0xcc2222:0xe8e9e5});
  const box=(w,h,d,mat,x,y,z)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);group.add(mesh);return mesh;};
  box(width,.6,length,paint,0,.6,0);
  box(width-.25,long?1.15:.65,length*(long?.8:.52),dark,0,long?1.35:1.15,0);
  if(type==='police')for(const x of [-1,1])box(.025,.18,3,trim,x*width/2,.72,0);
  if(type==='van'||type==='ambulance'||type==='firetruck')box(width-.1,1.2,length*.55,paint,0,1.35,-length*.17);
  if(type==='ambulance')for(const x of [-1,1]){box(.035,.55,.16,trim,x*(width/2+.01),1.4,-.8);box(.035,.16,.55,trim,x*(width/2+.02),1.4,-.8);}
  if(type==='firetruck') {
    for(const x of [-.55,.55])box(.07,.06,4.2,trim,x,2.03,-.2);
    for(let z=-2;z<=1.8;z+=.35)box(1.16,.05,.045,trim,0,2.03,z);
    for(const x of [-1,1])box(.035,.6,2.2,trim,x*(width/2+.01),1.1,-1.1);
  }
  const label={police:'POLICE',firetruck:'FIRE',ambulance:'AMBULANCE',bus:'CITY BUS'}[type];
  if(label&&typeof document!=='undefined') {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const context=canvas.getContext('2d');
    if(context){context.fillStyle='#f4f5ed';context.fillRect(0,0,512,96);context.fillStyle=type==='police'?'#155898':'#a7211b';context.textAlign='center';context.font='bold 66px sans-serif';context.fillText(label,256,72);
      const material=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas)});
      for(const side of [-1,1]){const sign=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(length*.65,2.6),.3),material);sign.position.set(side*(width/2+.04),.93,-.2);sign.rotation.y=side*Math.PI/2;group.add(sign);}
    }
  }
  const wheels=[];
  for(const x of [-1,1])for(const z of (long?[-2.15,1.85]:[-1.3,1.3])) {
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.2,10),rubber);wheel.rotation.z=Math.PI/2;wheel.position.set(x*(width/2+.02),.32,z);group.add(wheel);wheels.push(wheel);
  }
  const lamps=[];
  for(const x of [-.6,.6]) {
    const front=new THREE.MeshStandardMaterial({color:0xffffdc,emissive:0xffffad,emissiveIntensity:.7});
    box(.3,.1,.045,front,x,.7,length/2+.025);
    const rear=new THREE.MeshStandardMaterial({color:0x921515,emissive:0xff2222,emissiveIntensity:.25});
    box(.3,.1,.045,rear,x,.7,-length/2-.025);lamps.push(rear);
  }
  const beacons=[];
  if(['police','firetruck','ambulance'].includes(type))for(const [i,x] of [-.35,.35].entries()) {
    const color=i?0x246bff:0xff3030,material=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.25});
    box(.35,.12,.22,material,x,type==='police'?1.57:2.06,.2);beacons.push(material);
  }
  return {group,length,width,type,mass:long?7000:type==='van'||type==='ambulance'?2800:1550,wheels,brakeLamps:lamps,beacons};
}
export function disposeTrafficObject(group) {
  const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});group.removeFromParent();
}
