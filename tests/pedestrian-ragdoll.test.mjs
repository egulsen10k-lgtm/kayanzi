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

test('ragdoll enters its damped bounce phase after the fall animation',()=>{
 const doll=new PedestrianRagdoll();
 for(let i=1;i<=240;i++)doll.update(i/60);
 assert.equal(doll.phase,'bouncing');
 assert.equal(doll.bounceVelocityY,2.5);
 doll.update(4+1/60);
 assert.ok(doll.bodies.torso.position.y>=.25);
 assert.ok(doll.bounceCount<=1);
 doll.dispose();
});

test('ragdoll fades for 0.8 seconds, then removes every solver body',()=>{
 const doll=new PedestrianRagdoll();let age=0;
 while(doll.phase!=='fading'&&age<7) {age+=.1;doll.update(age);}
 assert.equal(doll.phase,'fading');
 doll.update(age+.4);
 assert.ok(doll.opacity>0&&doll.opacity<1);
 for(let i=1;i<=9;i++)doll.update(age+.4+i*.1);
 assert.equal(doll.phase,'disposed');
 assert.equal(doll.opacity,0);
 assert.equal(doll.world.bodies.length,0);
});
