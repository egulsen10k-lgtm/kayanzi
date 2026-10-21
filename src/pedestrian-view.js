import * as THREE from 'three';
import { createPerson } from './person-model.js';
import { projectCoordinate } from './road-network.js';
const colors=['#e9a13b','#4586ad','#b55257','#62a27c','#e4ded1','#8665ae'];
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
  }
  update(sim, car, carGroup, hidden=false) {
    this.group.visible=!hidden;
    const p=sim.network ? projectCoordinate(car.lat,car.lng,sim.network.center) : [0,0];
    this.models.forEach((model,i)=>{
      const person=sim.people[i],visible=!!person&&person.state!=='boarded';
      if(visible){
        model.position.set(person.x-p[0],person.height,-(person.y-p[1]));model.rotation.y=Math.PI-person.heading;
        const swing=person.state==='chasing'?Math.sin(person.phase)*.65:0;
        model.userData.legs.forEach((limb,j)=>{limb.rotation.x=swing*(j%2?1:-1);});
        model.userData.arms.forEach((limb,j)=>{limb.rotation.x=swing*(j%2?-1:1);});
        model.updateMatrixWorld(true);
      }
      this.batches.forEach((batch,j)=>batch.setMatrixAt(i,visible?this.parts[i][j].matrixWorld:this.hiddenMatrix));
    });
    this.batches.forEach(batch=>{batch.instanceMatrix.needsUpdate=true;});
    for(let i=0;i<4;i++) {const passenger=carGroup.getObjectByName(`passenger-${i}`);if(passenger)passenger.visible=i<sim.passengers;}
  }
}
