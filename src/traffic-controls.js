import * as THREE from 'three';
import { disposeTrafficObject } from './traffic-vehicle.js';
import { crosswalkLayout } from './crosswalks.js';
export function signalPhase(time,axis,offset=0) {
  const phase=((time+offset)%44+44)%44;
  const local=axis===0?phase:(phase+22)%44;
  return local<18?'green':local<21?'amber':'red';
}
export function approachAxis(edge){return Math.abs(edge.tangent[0])>Math.abs(edge.tangent[1])?0:1;}
export class TrafficControls {
  constructor(parent){this.parent=parent;this.signals=new Map();this.radars=new Map();this.tickets=0;this.message='';this.messageUntil=0;this.previousPlayer=null;this.lastRedTicket=-10;}
  rebuild(graph) {
    if(this.signalBatch)disposeTrafficObject(this.signalBatch);
    this.signals.clear();this.signalBatch=new THREE.Group();this.parent.add(this.signalBatch);
    const junctions=[...graph.nodes.values()].filter(node=>node.neighbors.size>=3&&node.incoming.some(a=>node.incoming.some(b=>Math.abs(a.tangent[0]*b.tangent[0]+a.tangent[1]*b.tangent[1])<.7)));
    const count=junctions.reduce((sum,node)=>sum+node.incoming.length,0);
    const batch=(geometry,material,n)=>{const mesh=new THREE.InstancedMesh(geometry,material,n);this.signalBatch.add(mesh);mesh.frustumCulled=false;return mesh;};
    const poles=batch(new THREE.CylinderGeometry(.065,.065,3.8,6),new THREE.MeshStandardMaterial({color:0x434b4e}),count);
    const heads=batch(new THREE.BoxGeometry(.38,1.05,.22),new THREE.MeshStandardMaterial({color:0x161b1d}),count);
    this.bulbs=batch(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({color:0xffffff}),count*3);
    const lines=batch(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0xf0f0df}),count);
    const transform=new THREE.Object3D();let index=0;
    for(const node of junctions) {
      const lamps=[];
      for(const edge of node.incoming) {
        const side=edge.road.width/2+.45,p=[node.p[0]-edge.tangent[0]*5+edge.normal[0]*side,node.p[1]-edge.tangent[1]*5+edge.normal[1]*side];
        transform.position.set(p[0],node.h+1.9,-p[1]);transform.rotation.set(0,0,0);transform.scale.set(1,1,1);transform.updateMatrix();poles.setMatrixAt(index,transform.matrix);
        transform.position.y=node.h+3.6;transform.rotation.y=-Math.atan2(...edge.tangent);transform.updateMatrix();heads.setMatrixAt(index,transform.matrix);
        for(const [i,color] of [0xff2424,0xffbe25,0x28e36e].entries()) {
          const bulbIndex=index*3+i;
          transform.position.set(p[0],node.h+3.92-i*.32,-p[1]);transform.translateZ(.14);transform.updateMatrix();this.bulbs.setMatrixAt(bulbIndex,transform.matrix);
          this.bulbs.setColorAt(bulbIndex,new THREE.Color(color).multiplyScalar(.05));lamps.push({index:bulbIndex,color,axis:approachAxis(edge),phase:['red','amber','green'][i]});
        }
        const stop=this.stopPoint(edge);
        transform.position.set(stop[0],edge.hb+.025,-stop[1]);transform.rotation.set(-Math.PI/2,0,-Math.atan2(...edge.tangent));transform.scale.set(Math.max(1.6,edge.road.width/2-.3),.22,1);transform.updateMatrix();lines.setMatrixAt(index,transform.matrix);index++;
      }
      this.signals.set(node.id,{node,lamps,offset:0,lastPhase:null});
    }
    // Existing intersection props stay in place as districts stream in.
    const eligible=graph.edges.filter(e=>e.length>55&&e.road.width>=7&&Math.abs(e.ha-.08)<.5).sort((a,b)=>a.id.localeCompare(b.id));
    for(const edge of eligible) {
      if(this.radars.size>=8)break;
      const p=[(edge.start[0]+edge.end[0])/2+edge.normal[0]*(edge.road.width/2+1-edge.lane),(edge.start[1]+edge.end[1])/2+edge.normal[1]*(edge.road.width/2+1-edge.lane)];
      if([...this.radars.values()].some(r=>Math.hypot(r.x-p[0],r.y-p[1])<150))continue;
      const group=new THREE.Group();group.position.set(p[0],edge.ha,-p[1]);
      const pole=new THREE.Mesh(new THREE.BoxGeometry(.12,2.3,.12),new THREE.MeshStandardMaterial({color:0x656d70}));pole.position.y=1.15;group.add(pole);
      const camera=new THREE.Mesh(new THREE.BoxGeometry(.5,.55,.5),new THREE.MeshStandardMaterial({color:0xd7d1bd}));camera.position.y=2.25;group.add(camera);
      const lens=new THREE.Mesh(new THREE.SphereGeometry(.11,8,6),new THREE.MeshStandardMaterial({color:0x162833}));lens.position.set(0,2.3,.28);group.add(lens);
      const sign=new THREE.Mesh(new THREE.CircleGeometry(.42,20),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));sign.position.set(0,3,0);group.add(sign);
      if(typeof document!=='undefined') {
        const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');
        if(ctx){ctx.fillStyle='white';ctx.fillRect(0,0,128,128);ctx.strokeStyle='#d02020';ctx.lineWidth=13;ctx.beginPath();ctx.arc(64,64,57,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#171717';ctx.font='bold 48px sans-serif';ctx.textAlign='center';ctx.fillText(String(Math.round(edge.limit)),64,82);sign.material.map=new THREE.CanvasTexture(canvas);sign.material.needsUpdate=true;}
      }
      this.parent.add(group);this.radars.set(edge.id,{group,x:p[0],y:p[1],edge,armed:true,limit:edge.limit});
    }
  }
  allows(edge,time){const signal=this.signals.get(edge.to.id);return !signal||signalPhase(time,approachAxis(edge),signal.offset)==='green';}
  stopDistance(edge){return crosswalkLayout(edge)?.stopOffset??0;}
  stopPoint(edge){const offset=this.stopDistance(edge);return [edge.end[0]-edge.tangent[0]*offset,edge.end[1]-edge.tangent[1]*offset];}
  phase(edge,time){const signal=edge?this.signals.get(edge.to.id):null;return signal?signalPhase(time,approachAxis(edge),signal.offset):null;}
  update(time,player) {
    let changed=false;
    for(const signal of this.signals.values()) {
      const phase=signalPhase(time,0,signal.offset)+signalPhase(time,1,signal.offset);
      if(signal.lastPhase===phase)continue;signal.lastPhase=phase;
      for(const lamp of signal.lamps)this.bulbs.setColorAt(lamp.index,new THREE.Color(lamp.color).multiplyScalar(signalPhase(time,lamp.axis,signal.offset)===lamp.phase?1.8:.04));
      changed=true;
    }
    if(changed&&this.bulbs.instanceColor)this.bulbs.instanceColor.needsUpdate=true;
    if(this.previousPlayer&&Math.hypot(player.x-this.previousPlayer.x,player.y-this.previousPlayer.y)<20&&Math.abs(player.speed)>3) {
      const forward=[Math.sin(player.heading),Math.cos(player.heading)];
      for(const signal of this.signals.values())for(const edge of signal.node.incoming) {
        if(this.phase(edge,time)!=='red'||time-this.lastRedTicket<5||Math.abs(player.roadHeight-edge.hb)>.7||forward[0]*edge.tangent[0]+forward[1]*edge.tangent[1]<.6)continue;
        const stop=this.stopPoint(edge);
        const front=p=>[p.x+Math.sin(p.heading)*2.25-stop[0],p.y+Math.cos(p.heading)*2.25-stop[1]],before=front(this.previousPlayer),after=front(player);
        const along=p=>p[0]*edge.tangent[0]+p[1]*edge.tangent[1];
        if(along(before)<0&&along(after)>=0&&Math.abs(after[0]*edge.normal[0]+after[1]*edge.normal[1])<edge.road.width/4) {
          this.tickets++;this.lastRedTicket=time;this.message=`Red light · Ticket ${this.tickets}`;this.messageUntil=time+6;
        }
      }
    }
    this.previousPlayer={...player};
    for(const radar of this.radars.values()) {
      const distance=Math.hypot(player.x-radar.x,player.y-radar.y);
      if(distance>35)radar.armed=true;
      if(distance<14&&radar.armed&&Math.abs(player.roadHeight-radar.edge.ha)<1) {
        radar.armed=false;
        if(Math.abs(player.speed)>radar.limit+5){this.tickets++;this.message=`Speed camera · ${Math.round(Math.abs(player.speed))} / ${radar.limit} km/h · Ticket ${this.tickets}`;this.messageUntil=time+6;}
      }
    }
  }
  clear(){if(this.signalBatch)disposeTrafficObject(this.signalBatch);this.signalBatch=null;for(const item of this.radars.values())disposeTrafficObject(item.group);this.signals.clear();this.radars.clear();this.message='';this.previousPlayer=null;}
}
