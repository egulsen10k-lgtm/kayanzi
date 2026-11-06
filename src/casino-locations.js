import * as THREE from 'three';
export const CASINO_ENTRY_RADIUS = 35;
const finitePoint=p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const hash=value=>{let h=2166136261;for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const closest=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;const t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return [a[0]+dx*t,a[1]+dy*t];};
// Only real mapped footprints are dressed as fictional, virtual-chip venues.
export function selectCasinoBuildings(network,previousIds=[]) {
  if(!Array.isArray(network?.buildings)||!Array.isArray(network?.roads))return [];
  const candidates=network.buildings.filter(b=>b&&Array.isArray(b.points)&&b.points.length>=4&&b.points.length<=64&&b.points.every(finitePoint)&&Math.hypot(b.points[0][0]-b.points.at(-1)[0],b.points[0][1]-b.points.at(-1)[1])<.001&&Math.abs(b.points.slice(1).reduce((sum,p,i)=>sum+b.points[i][0]*p[1]-p[0]*b.points[i][1],0))>2&&Number.isFinite(b.height)&&b.height>=4&&b.height<=60&&(b.minHeight===undefined||b.minHeight===0)).map(b=>({building:b,key:hash(b.id??JSON.stringify(b.points))})).sort((a,b)=>(Number(previousIds.includes(String(b.building.id)))-Number(previousIds.includes(String(a.building.id))))||Math.hypot(...a.building.points[0])-Math.hypot(...b.building.points[0])||a.key-b.key).slice(0,64);
  const segments=[];
  for(const road of network.roads){
    if(!road||road.bridge||road.tunnel||!Array.isArray(road.points)||!Number.isFinite(road.width)||road.width<2||road.width>40)continue;
    if(road.elevations!==undefined&&(!Array.isArray(road.elevations)||road.elevations.some(h=>!Number.isFinite(h)||Math.abs(h)>.01)))continue;
    for(let i=1;i<road.points.length&&segments.length<4096;i++)if(finitePoint(road.points[i-1])&&finitePoint(road.points[i]))segments.push([road.points[i-1],road.points[i]]);
  }
  const venues=[];
  for(const {building:b,key}of candidates){
    let best=null;
    for(let i=1;i<b.points.length;i++){
      const a=b.points[i-1],c=b.points[i],width=Math.hypot(c[0]-a[0],c[1]-a[1]);if(width<4)continue;
      const point=[(a[0]+c[0])/2,(a[1]+c[1])/2];
      const margin=Math.min(4,width*.45),ux=(c[0]-a[0])/width,uy=(c[1]-a[1])/width;
      const from=[a[0]+ux*margin,a[1]+uy*margin],to=[c[0]-ux*margin,c[1]-uy*margin];
      for(const [start,end]of segments)for(const entry of [point,closest(start,from,to),closest(end,from,to)]){const roadPoint=closest(entry,start,end),distance=Math.hypot(roadPoint[0]-entry[0],roadPoint[1]-entry[1]);if(distance<=28&&distance>=2&&(!best||distance<best.distance))best={point:entry,roadPoint,distance,width};}
    }
    if(!best)continue;
    const dx=best.roadPoint[0]-best.point[0],dy=best.roadPoint[1]-best.point[1],length=Math.hypot(dx,dy);
    venues.push({id:String(b.id??key),name:'Katlayanzi',points:b.points,height:b.height,entrance:best.point,roadPoint:best.roadPoint,normal:[dx/length,dy/length],width:Math.min(8,best.width*.85),key});
  }
  venues.sort((a,b)=>(Number(previousIds.includes(b.id))-Number(previousIds.includes(a.id)))||Math.hypot(...a.entrance)-Math.hypot(...b.entrance)||a.key-b.key);
  const selected=[];
  for(const venue of venues)if(selected.every(other=>Math.hypot(other.entrance[0]-venue.entrance[0],other.entrance[1]-venue.entrance[1])>75)){selected.push(venue);if(selected.length===3)break;}
  return selected;
}
export function nearbyCasino(venues,position,roadHeight=.08) {
  if(!Array.isArray(venues)||!finitePoint(position)||!Number.isFinite(roadHeight)||Math.abs(roadHeight-.08)>.8)return {allowed:false,distance:Infinity,venue:null};
  let venue=null,distance=Infinity;
  for(const candidate of venues)if(finitePoint(candidate?.entrance)){
    const d=Math.hypot(position[0]-candidate.entrance[0],position[1]-candidate.entrance[1]);if(d<distance){distance=d;venue=candidate;}
  }
  return {allowed:Boolean(venue&&distance<=CASINO_ENTRY_RADIUS),distance,venue};
}
function signTexture(){
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;const ctx=canvas.getContext('2d');if(!ctx)return null;
  ctx.fillStyle='#102c23';ctx.fillRect(0,0,768,192);ctx.strokeStyle='#e8c06d';ctx.lineWidth=8;ctx.strokeRect(8,8,752,176);ctx.fillStyle='#ffe8a6';ctx.textAlign='center';ctx.font='bold 65px Georgia';ctx.fillText('KATLAYANZI',384,97);ctx.font='bold 24px system-ui';ctx.fillText('KUMARHANE · SANAL FİŞLER',384,147);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export function buildCasinoExteriors(venues) {
  const group=new THREE.Group();group.name='casino-exteriors';
  const texture=signTexture();
  for(const venue of venues){
    const facade=new THREE.Group();facade.name=`casino-entrance-${venue.id}`;facade.userData.casinoId=venue.id;
    facade.position.set(venue.entrance[0]+venue.normal[0]*.12,0,-venue.entrance[1]-venue.normal[1]*.12);facade.rotation.y=Math.atan2(venue.normal[0],-venue.normal[1]);group.add(facade);
    const emerald=new THREE.MeshStandardMaterial({color:'#123f2a',roughness:.45}),gold=new THREE.MeshStandardMaterial({color:'#c59d50',metalness:.7,roughness:.25}),glow=new THREE.MeshStandardMaterial({color:'#ffe3a1',emissive:'#ffc76a',emissiveIntensity:1.5});
    const add=(name,w,h,d,mat,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.name=name;m.position.set(x,y,z);facade.add(m);return m;};
    add('casino-door',1.7,2.6,.1,emerald,0,1.3,.12);add('casino-door-frame',.07,2.65,.13,gold,-.9,1.32,.15);add('casino-door-frame',.07,2.65,.13,gold,.9,1.32,.15);
    add('casino-marquee',venue.width,1.05,.22,emerald,0,3.35,.12);
    const board=new THREE.Mesh(new THREE.PlaneGeometry(venue.width-.16,.89),new THREE.MeshBasicMaterial({map:texture,color:texture?'#ffffff':'#e7bf67',toneMapped:false}));board.name='casino-sign';board.position.set(0,3.35,.24);facade.add(board);
    for(let i=0;i<12;i++){const x=(i/11-.5)*(venue.width-.2);add('casino-marquee-light',.075,.075,.06,glow,x,2.82,.25);add('casino-marquee-light',.075,.075,.06,glow,x,3.88,.25);}
    const outline=new THREE.BufferGeometry().setFromPoints(venue.points.map(p=>new THREE.Vector3(p[0],venue.height+.04,-p[1])));
    const lights=new THREE.LineLoop(outline,new THREE.LineBasicMaterial({color:'#e7bd68',toneMapped:false}));lights.name='casino-roof-lights';group.add(lights);
  }
  if(!venues.length)texture?.dispose();
  return group;
}
