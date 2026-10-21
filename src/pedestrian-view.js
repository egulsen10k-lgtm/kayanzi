import * as THREE from 'three';
import { createPerson } from './person-model.js';
import { PedestrianRagdoll } from './pedestrian-ragdoll.js';
import { roadSurfaceAt } from './road-safety.js';
import { projectCoordinate } from './road-network.js';
const colors=['#e9c9bd','#91b7cf','#b86476','#7eaa94','#f0e9dc','#ad9ac5'];
export class PedestrianView {
  constructor(scene) {
    this.group=new THREE.Group();this.group.name='pedestrians';scene.add(this.group);
    // One instanced draw per body part, rather than a draw for each pedestrian.
    this.models=Array.from({length:16},()=>createPerson({color:'#ffffff'}));
    this.parts=this.models.map(model=>{const parts=[];model.traverse(o=>{if(o.isMesh)parts.push(o);});return parts;});
    this.batches=this.parts[0].map(part=>{
      const batch=new THREE.InstancedMesh(part.geometry,part.material,16);
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);batch.frustumCulled=false;batch.castShadow=true;
      if(['shirt','sleeve'].includes(part.name))for(let i=0;i<16;i++)batch.setColorAt(i,new THREE.Color(colors[i%colors.length]));
      this.group.add(batch);return batch;
    });
    this.hiddenMatrix=new THREE.Matrix4().makeScale(0,0,0);
    this.ragdolls=new Map();
    this.bindParts=this.models.map((model,i)=>{model.updateMatrixWorld(true);return this.parts[i].map(part=>{
      let name='torso',parent=part;
      while(parent && parent!==model){if(parent.name==='left-arm')name='leftArm';if(parent.name==='right-arm')name='rightArm';if(parent.name==='left-leg')name='leftLeg';if(parent.name==='right-leg')name='rightLeg';parent=parent.parent;}
      if(['head','nose','smile','eye','eyebrow','blonde-crown','long-blonde-hair','face-framing-hair','hair','neck'].includes(part.name))name='head';
      return {name,matrix:part.matrixWorld.clone()};
    });});
  }
  update(sim, car, carGroup, hidden=false) {
    this.group.visible=!hidden;
    const p=sim.network ? projectCoordinate(car.lat,car.lng,sim.network.center) : [0,0];
    const activeRagdolls=new Set();
    this.models.forEach((model,i)=>{
      const person=sim.people[i],visible=!!person&&person.state!=='boarded';
      if(visible){
        if(person.state==='ragdoll') {
          activeRagdolls.add(person);
          let ragdoll=this.ragdolls.get(person);
          if(!ragdoll) {
            const floor=roadSurfaceAt(sim.network,[person.x,person.y],person.height)??person.height-.12;
            ragdoll={physics:new PedestrianRagdoll({heading:person.heading,height:person.height-floor,velocity:person.fall}),origin:{x:person.x,y:person.y,height:floor}};
            this.ragdolls.set(person,ragdoll);
          }
          ragdoll.physics.update(person.fall.age);
          const torso=ragdoll.physics.bodies.torso;
          const point=[ragdoll.origin.x+torso.position.x,ragdoll.origin.y-torso.position.z];
          const ground=roadSurfaceAt(sim.network,point,ragdoll.origin.height);
          person.recoveryPoint={x:ground===null?ragdoll.origin.x:point[0],y:ground===null?ragdoll.origin.y:point[1],height:ground??ragdoll.origin.height};
          const origin=new THREE.Matrix4().makeTranslation(ragdoll.origin.x-p[0],ragdoll.origin.height,-(ragdoll.origin.y-p[1]));
          this.batches.forEach((batch,j)=>{
            const bind=this.bindParts[i][j],body=ragdoll.physics.bodies[bind.name],center=ragdoll.physics.bindCenters[bind.name];
            const transform=new THREE.Matrix4().compose(new THREE.Vector3(body.position.x,body.position.y,body.position.z),new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w),new THREE.Vector3(1,1,1));
            transform.premultiply(origin).multiply(new THREE.Matrix4().makeTranslation(-center[0],-center[1],-center[2])).multiply(bind.matrix);
            batch.setMatrixAt(i,transform);
          });
          return;
        } else {
          model.position.set(person.x-p[0],person.height,-(person.y-p[1]));model.rotation.set(0,Math.PI-person.heading,0);
          const holding=person.state==='clinging';
          const swing=person.state==='chasing'?Math.sin(person.phase)*.65:0;
          model.rotation.x=holding ? -.18 : person.state==='recovering' ? (1-Math.min(1,person.recoveryTime/1.2))*1.3 : 0;
          model.userData.legs.forEach((limb,j)=>{limb.rotation.x=holding ? (j ? -.42 : -.25) : swing*(j%2?1:-1);});
          model.userData.arms.forEach((limb,j)=>{limb.rotation.x=holding ? -1.32+(j ? -.12 : .12) : swing*(j%2?-1:1);});
        }
        model.updateMatrixWorld(true);
      }
      this.batches.forEach((batch,j)=>batch.setMatrixAt(i,visible?this.parts[i][j].matrixWorld:this.hiddenMatrix));
    });
    for(const [person,ragdoll] of this.ragdolls) if(!activeRagdolls.has(person)) {ragdoll.physics.dispose();this.ragdolls.delete(person);}
    this.batches.forEach(batch=>{batch.instanceMatrix.needsUpdate=true;});
    for(let i=0;i<4;i++) {const passenger=carGroup.getObjectByName(`passenger-${i}`);if(passenger)passenger.visible=i<sim.passengers;}
  }
}
