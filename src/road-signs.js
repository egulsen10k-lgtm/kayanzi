import * as THREE from 'three';
import { disposeTrafficObject } from './traffic-vehicle.js';
import { trafficSpeedLimit } from './traffic-routes.js';
export function turnArrow(incoming,outgoing) {
  const cross=incoming[0]*outgoing[1]-incoming[1]*outgoing[0],dot=incoming[0]*outgoing[0]+incoming[1]*outgoing[1];
  return dot>.8?'↑':cross>0?'←':'→';
}
export function roadDestination(edge) {
  if(edge.road.destination)return String(edge.road.destination).replaceAll(';',' / ').slice(0,45);
  if(edge.road.name)return edge.road.name;
  if(edge.road.ref)return edge.road.ref;
  const [x,y]=edge.tangent;return `Local road · ${Math.abs(x)>Math.abs(y)?x>0?'East':'West':y>0?'North':'South'}`;
}
export function junctionDirections(graph,edge) {
  return (graph.nodes.get(edge.to.id)?.out??[]).filter(next=>next.to.id!==edge.from.id&&Math.abs(next.ha-edge.hb)<.6)
    .map(next=>({arrow:turnArrow(edge.tangent,next.tangent),name:roadDestination(next),edgeId:next.id})).slice(0,3);
}
export class RoadSigns {
  constructor(parent){this.parent=parent;this.entries=[];this.group=null;this.roads=[];}
  rebuild(graph,focus={x:0,y:0},roads=[]) {
    this.clear();this.group=new THREE.Group();this.group.name='road-signs';this.parent.add(this.group);
    this.roads=roads;
    const sorted=[...graph.edges].sort((a,b)=>Math.hypot(a.start[0]-focus.x,a.start[1]-focus.y)-Math.hypot(b.start[0]-focus.x,b.start[1]-focus.y)||a.id.localeCompare(b.id));
    for(const edge of sorted) {
      if(edge.length<18)continue;
      const along=Math.min(edge.length*.3,18),x=edge.start[0]+edge.tangent[0]*along+edge.normal[0]*(edge.road.width/2+.8-edge.lane),y=edge.start[1]+edge.tangent[1]*along+edge.normal[1]*(edge.road.width/2+.8-edge.lane);
      if(this.entries.some(s=>s.type==='speed'&&s.limit===edge.limit&&Math.hypot(s.x-x,s.y-y)<85))continue;
      this.entries.push({type:'speed',limit:edge.limit,edgeId:edge.id,x,y,h:edge.ha,heading:-Math.atan2(...edge.tangent),width:.9,height:.9});
      if(this.entries.length>=28)break;
    }
    for(const road of roads.filter(r=>r.width<6)) {
      if(this.entries.length>=34)break;
      const a=road.points[0],b=road.points.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<30)continue;
      const tangent=[(b[0]-a[0])/length,(b[1]-a[1])/length],side=road.width/2+.8;
      this.entries.push({type:'speed',limit:trafficSpeedLimit(road),x:(a[0]+b[0])/2+tangent[1]*side,y:(a[1]+b[1])/2-tangent[0]*side,h:(road.elevations?.[0]??0)+.08,heading:-Math.atan2(...tangent),width:.9,height:.9});
    }
    for(const edge of sorted) {
      if(this.entries.length>=80)break;
      if(edge.to.neighbors.size<3||edge.length<12)continue;
      const directions=junctionDirections(graph,edge);if(!directions.length)continue;
      const side=edge.road.width/2+1.25-edge.lane;
      this.entries.push({type:'direction',directions,edgeId:edge.id,x:edge.end[0]-edge.tangent[0]*9+edge.normal[0]*side,y:edge.end[1]-edge.tangent[1]*9+edge.normal[1]*side,h:edge.hb,heading:-Math.atan2(...edge.tangent),width:3,height:Math.max(.8,directions.length*.4+.2)});
    }
    const canvas=typeof document==='undefined'?null:document.createElement('canvas');
    const columns=5,rows=Math.max(1,Math.ceil(this.entries.length/columns)),tileW=512,tileH=224;
    if(canvas){canvas.width=columns*tileW/2;canvas.height=rows*tileH/2;}
    const ctx=canvas?.getContext('2d'),texture=ctx?new THREE.CanvasTexture(canvas):null;
    ctx?.scale(.5,.5);
    const positions=[],uvs=[],indices=[],poles=new THREE.InstancedMesh(new THREE.CylinderGeometry(.05,.05,2.6,5),new THREE.MeshStandardMaterial({color:0x798184}),this.entries.length);
    this.group.add(poles);const object=new THREE.Object3D();
    this.entries.forEach((sign,i)=>{
      const col=i%columns,row=Math.floor(i/columns),px=col*tileW,py=row*tileH;
      if(ctx) {
        ctx.save();ctx.translate(px,py);ctx.clearRect(0,0,tileW,tileH);
        if(sign.type==='speed') {
          ctx.fillStyle='white';ctx.beginPath();ctx.arc(tileW/2,tileH/2,100,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#d22424';ctx.lineWidth=18;ctx.stroke();ctx.fillStyle='#171717';ctx.textAlign='center';ctx.font='bold 118px sans-serif';ctx.fillText(String(Math.round(sign.limit)),tileW/2,154);
        } else {
          ctx.fillStyle='#175b39';ctx.fillRect(0,0,tileW,tileH);ctx.strokeStyle='#f2f5e7';ctx.lineWidth=7;ctx.strokeRect(5,5,tileW-10,tileH-10);ctx.fillStyle='#f2f5e7';ctx.textAlign='left';
          sign.directions.forEach((direction,j)=>{const baseline=(j+.75)*(tileH-16)/sign.directions.length+8;ctx.font='bold 45px sans-serif';ctx.fillText(direction.arrow,18,baseline);ctx.font='bold 31px sans-serif';ctx.fillText(direction.name,80,baseline,410);});
        }
        ctx.restore();
      }
      const matrix=new THREE.Matrix4().compose(new THREE.Vector3(sign.x,sign.h+2.7,-sign.y),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),sign.heading),new THREE.Vector3(1,1,1));
      // Speed tiles include transparent margins: crop to the circular sign's square.
      const inset=sign.type==='speed'?(tileW-tileH)/2:0;
      const u0=(px+inset)/(columns*tileW),u1=(px+tileW-inset)/(columns*tileW),v0=1-(py+tileH)/(rows*tileH),v1=1-py/(rows*tileH),offset=positions.length/3;
      for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const p=new THREE.Vector3(x*sign.width/2,y*sign.height/2,0).applyMatrix4(matrix);positions.push(p.x,p.y,p.z);}
      uvs.push(u0,v0,u1,v0,u1,v1,u0,v1);indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
      object.position.set(sign.x,sign.h+1.3,-sign.y);object.rotation.set(0,0,0);object.scale.set(1,1,1);object.updateMatrix();poles.setMatrixAt(i,object.matrix);
    });
    if(texture){texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    this.group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,color:0xffffff,transparent:true,side:THREE.DoubleSide,alphaTest:.1})));
  }
  nearby(graph,player) {
    let best=null,score=Infinity;
    const forward=[Math.sin(player.heading),Math.cos(player.heading)];
    for(const edge of graph.edges) {
      if(Math.abs(edge.ha-player.roadHeight)>.8||edge.tangent[0]*forward[0]+edge.tangent[1]*forward[1]<.25)continue;
      const dx=player.x-edge.start[0],dy=player.y-edge.start[1],s=Math.max(0,Math.min(edge.length,dx*edge.tangent[0]+dy*edge.tangent[1]));
      const d=Math.hypot(dx-edge.tangent[0]*s,dy-edge.tangent[1]*s);
      if(d>12||d>=score)continue;score=d;best={edge,limit:edge.limit,name:edge.road.name??'',directions:junctionDirections(graph,edge),remaining:Math.max(0,edge.length-s)};
    }
    if(best) {
      let ahead=best.edge,total=best.remaining;const visited=new Set([ahead.id]);
      while(ahead.to.neighbors.size<3&&total<180) {
        const next=(graph.nodes.get(ahead.to.id)?.out??[]).filter(e=>e.to.id!==ahead.from.id&&Math.abs(e.ha-ahead.hb)<.6);
        if(next.length!==1||visited.has(next[0].id))break;
        const edge=next[0];total+=Math.hypot(edge.start[0]-ahead.end[0],edge.start[1]-ahead.end[1])+edge.length;
        ahead=edge;visited.add(ahead.id);
      }
      best.signalEdge=ahead;best.remaining=total;best.directions=junctionDirections(graph,ahead);
    }
    if(!best)for(const road of this.roads)for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.1)continue;
      const t=Math.max(0,Math.min(1,((player.x-a[0])*dx+(player.y-a[1])*dy)/(length*length)));
      const h=(road.elevations?.[i-1]??0)*(1-t)+(road.elevations?.[i]??0)*t+.08;
      const d=Math.hypot(player.x-a[0]-dx*t,player.y-a[1]-dy*t);
      if(d>road.width/2+2||d>=score||Math.abs(player.roadHeight-h)>.8)continue;
      score=d;best={edge:null,limit:trafficSpeedLimit(road),name:road.name??road.ref??'',directions:[],remaining:Infinity};
    }
    return best;
  }
  clear(){if(this.group)disposeTrafficObject(this.group);this.group=null;this.entries=[];this.roads=[];}
}
