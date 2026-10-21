import * as THREE from 'three';
import { createPerson } from './person-model.js';
import { PedestrianRagdoll } from './pedestrian-ragdoll.js';
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
            ragdoll={physics:new PedestrianRagdoll({heading:person.heading,height:0,velocity:person.fall}),origin:{x:person.x,y:person.y,height:person.height}};
            this.ragdolls.set(person,ragdoll);
          }
          ragdoll.physics.update(person.fall.age);
          const torso=ragdoll.physics.bodies.torso;
          const rotation=new THREE.Quaternion(-torso.quaternion.x,-torso.quaternion.y,torso.quaternion.z,torso.quaternion.w);
          const rootOffset=new THREE.Vector3(0,1.09,0).applyQuaternion(rotation);
          model.position.set(ragdoll.origin.x-p[0]+torso.position.x-rootOffset.x,ragdoll.origin.height+torso.position.y-rootOffset.y,-(ragdoll.origin.y-p[1])-torso.position.z+rootOffset.z);
          model.quaternion.copy(rotation);
          model.userData.legs.forEach(limb=>limb.rotation.set(0,0,0));
          model.userData.arms.forEach(limb=>limb.rotation.set(0,0,0));
        } else {
          model.position.set(person.x-p[0],person.height,-(person.y-p[1]));model.rotation.set(0,Math.PI-person.heading,0);
          const holding=person.state==='clinging';
          const swing=person.state==='chasing'?Math.sin(person.phase)*.65:0;
          model.rotation.x=holding ? -.18 : 0;
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
