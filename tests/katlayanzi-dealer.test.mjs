import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCasinoDealer,animateCasinoDealer} from '../src/katlayanzi-dealer.js';

function dispose(group){group.traverse(node=>{node.geometry?.dispose();if(node.material)for(const m of Array.isArray(node.material)?node.material:[node.material])m.dispose();});}

test('adult dealer has grounded finite geometry, professional details and an articulated rig',()=>{
  const model=createCasinoDealer();model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model);
  assert.ok(bounds.min.y>=-.002&&bounds.max.y>1.65&&bounds.max.y<1.85);
  assert.equal(model.userData.identity.adult,true);assert.equal(model.userData.identity.name,'Elif');
  assert.equal(model.getObjectByName('dealer-name-badge').userData.label,'Elif · Dealer');
  assert.ok(model.getObjectByName('dealer-hair-bun'));assert.ok(model.getObjectByName('dealer-waistcoat-panel'));
  model.traverse(node=>{if(node.geometry)assert.ok([...node.geometry.attributes.position.array].every(Number.isFinite));});
  for(const arm of Object.values(model.userData.rig.arms))assert.ok(arm.shoulder.isGroup&&arm.elbow.isGroup&&arm.wrist.isGroup);
  dispose(model);
});

test('dealer changes arm gestures between idle, card dealing and roulette without moving root',()=>{
  const model=createCasinoDealer();const arm=model.userData.rig.arms.right;
  const root=model.position.clone();const idle=arm.shoulder.rotation.clone();
  animateCasinoDealer(model,{time:1,game:'blackjack',phase:'playing',round:2});
  const deal=arm.shoulder.rotation.clone();assert.notEqual(deal.x,idle.x);
  animateCasinoDealer(model,{time:1,game:'roulette',phase:'result',round:2});
  assert.notEqual(arm.shoulder.rotation.y,deal.y);
  animateCasinoDealer(model,{time:NaN,game:'poker',phase:'playing',round:Infinity});
  animateCasinoDealer(model,{time:Number.MAX_VALUE,game:'poker',phase:'playing',round:Number.MAX_VALUE});
  model.traverse(node=>assert.ok([...node.position,...node.rotation.toArray().slice(0,3)].every(Number.isFinite)));
  assert.deepEqual(model.position,root);dispose(model);
});
