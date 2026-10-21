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
