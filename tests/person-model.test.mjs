import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPerson } from '../src/person-model.js';
import { createCarModel } from '../src/car-model.js';
test('adult blonde pedestrians have animated limbs and consistent instancing topology',()=>{
 const a=createPerson(),b=createPerson({color:'#ffffff'});
 assert.equal(a.userData.appearance,'adult-blonde-woman');
 assert.ok(a.getObjectByName('long-blonde-hair'));assert.equal(a.userData.legs.length,2);
 const names=g=>{const result=[];g.traverse(o=>{if(o.isMesh)result.push(o.name);});return result;};
 assert.deepEqual(names(a),names(b));
 const bounds=new THREE.Box3().setFromObject(a);assert.ok(bounds.max.y>1.6&&bounds.max.y<1.9);
});
test('boarded passengers retain blonde appearance while driver stays visible',()=>{
 const {group}=createCarModel('M3 Competition');
 assert.equal(group.getObjectByName('driver').visible,true);
 for(let i=0;i<4;i++) {const p=group.getObjectByName(`passenger-${i}`);assert.equal(p.userData.appearance,'adult-blonde-woman');assert.equal(p.visible,false);}
});
test('adult appearance variants keep the same instancing topology and expose tint colors',()=>{
 const variants=['casual','goth','turkish','turkish-sunroof'].map(style=>createPerson({style}));
 const meshNames=person=>{const names=[];person.traverse(o=>{if(o.isMesh)names.push(o.name);});return names;};
 for(const person of variants) {
   assert.deepEqual(meshNames(person),meshNames(variants[0]));
   assert.equal(person.userData.partColors.eye,`#${person.getObjectByName('eye').material.color.getHexString()}`);
   assert.ok(person.getObjectByName('earring'));
 }
 assert.notEqual(variants[1].userData.partColors['long-blonde-hair'],variants[0].userData.partColors['long-blonde-hair']);
 assert.notEqual(variants[2].userData.partColors.head,variants[0].userData.partColors.head);
 assert.equal(variants[3].userData.style,'turkish-sunroof');
});

test('sunroof rider uses a real roof opening and appears only with a passenger at safe speed',async()=>{
 const {PedestrianView}=await import('../src/pedestrian-view.js');
 const {group}=createCarModel('M3 Competition');
 assert.equal(group.getObjectByName('roof'),undefined);
 assert.equal(group.getObjectsByProperty('name','sunroof-side-rail').length,2);
 const rider=group.getObjectByName('sunroof-rider');
 assert.equal(rider.visible,false);
 assert.equal(rider.getObjectByName('sunroof-rider-person').userData.style,'turkish-sunroof');
 const view=new PedestrianView(new THREE.Scene());
 const sim={network:null,people:[],passengers:1};
 const car={lat:0,lng:0,speed:35};
 view.update(sim,car,group);
 assert.equal(rider.visible,true);
 assert.equal(group.getObjectByName('passenger-0').visible,false);
 car.speed=85;view.update(sim,car,group);
 assert.equal(rider.visible,false);
 assert.equal(group.getObjectByName('passenger-0').visible,true);
 sim.passengers=0;view.update(sim,car,group);
 assert.equal(group.getObjectByName('passenger-0').visible,false);
});

test('instanced NPC colors switch between goth and Turkish looks without new draw calls',async()=>{
 const {PedestrianView}=await import('../src/pedestrian-view.js');
 const view=new PedestrianView(new THREE.Scene());
 const {group}=createCarModel('M3 Competition');
 const npc={style:'goth',state:'idle',x:0,y:0,height:.22,heading:0,phase:0};
 const sim={network:null,people:[npc],passengers:0};
 const car={lat:0,lng:0,speed:0};
 const shirtIndex=view.parts[0].findIndex(part=>part.name==='shirt');
 view.update(sim,car,group);
 const before=new THREE.Color();view.batches[shirtIndex].getColorAt(0,before);
 npc.style='turkish';view.update(sim,car,group);
 const after=new THREE.Color();view.batches[shirtIndex].getColorAt(0,after);
 assert.notEqual(before.getHex(),after.getHex());
 assert.equal(view.batches[shirtIndex].count,24);
});
