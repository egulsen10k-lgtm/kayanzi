import test from 'node:test';
import assert from 'node:assert/strict';
import { PedestrianRagdoll } from '../src/pedestrian-ragdoll.js';
test('ragdoll has articulated bodies, settles above floor and releases solver objects',()=>{
 const doll=new PedestrianRagdoll({heading:.7,height:.12,velocity:{vx:8,vy:2.5,vz:18}});
 assert.equal(Object.keys(doll.bodies).length,6);assert.equal(doll.world.constraints.length,5);
 for(let i=1;i<=240;i++)doll.update(i/60);
 for(const b of Object.values(doll.bodies)){assert.ok(Number.isFinite(b.position.x+b.position.y+b.position.z));assert.ok(b.position.y>0);}
 assert.notEqual(doll.bodies.leftArm.quaternion.x,doll.bodies.torso.quaternion.x);
 doll.dispose();assert.equal(doll.world.bodies.length,0);assert.equal(doll.world.constraints.length,0);
});
