import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildCasinoLounge,updateCasinoLounge,casinoCardKey,casinoSeatPosition,KatlayanziScene} from '../src/katlayanzi-scene.js';
const view=()=>({game:'poker',phase:'playing',round:2,meId:'a',turnId:'b',players:[{id:'a',name:'Alice',bet:25,hand:[{rank:'A',suit:'♠'}]},{id:'b',name:'Bob',bet:50,hand:[null,null]}],dealer:[{rank:'K',suit:'♦'},null]});
test('lounge has a physical oval table, eight chairs, sunroof and finite geometry',()=>{
  const lounge=buildCasinoLounge();
  for(const name of ['oval-wood-table','oval-emerald-felt','padded-table-rail','glass-sunroof','casino-dealer','casino-roulette-wheel'])assert.ok(lounge.getObjectByName(name),name);
  for(let i=0;i<8;i++){assert.ok(lounge.getObjectByName(`casino-chair-${i}`));const p=casinoSeatPosition(i);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z)&&Number.isFinite(p.heading));}
  lounge.traverse(o=>{if(o.geometry?.attributes.position)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});
});
test('multiplayer robots retain stable seats, local identity and turn markers',()=>{
  const lounge=buildCasinoLounge(),v=view();updateCasinoLounge(lounge,v);
  const a=lounge.userData.players.get('a'),b=lounge.userData.players.get('b');
  assert.equal(lounge.userData.players.size,2);assert.equal(a.group.userData.isLocal,true);assert.equal(b.group.userData.isTurn,true);
  assert.ok(a.robot.userData.rig.leftLeg.rotation.x<-1);
  updateCasinoLounge(lounge,{...v,players:[v.players[1],v.players[0]]});
  assert.equal(lounge.userData.players.get('a').slot,a.slot);assert.equal(lounge.userData.players.get('b').group,b.group);
  updateCasinoLounge(lounge,{...v,players:[v.players[0]]});assert.equal(lounge.userData.players.size,1);
});
test('private-view card backs stay hidden and wheel contains all European pockets',()=>{
  const lounge=buildCasinoLounge();updateCasinoLounge(lounge,view());
  const bob=lounge.userData.cards.children.filter(c=>c.userData.ownerId==='b');assert.equal(bob.length,2);assert.ok(bob.every(c=>c.userData.cardKey==='back'));
  assert.equal(casinoCardKey(null),'back');assert.equal(casinoCardKey({rank:'A',suit:'♠'}),'A♠');assert.equal(casinoCardKey({rank:'secret',suit:'♠'}),'back');
  updateCasinoLounge(lounge,{...view(),game:'roulette',roulette:{number:17,color:'black'}});
  assert.equal(lounge.userData.wheel.visible,true);const numbers=[];lounge.userData.wheel.traverse(o=>{if(Number.isInteger(o.userData.number))numbers.push(o.userData.number);});assert.equal(new Set(numbers).size,37);assert.ok(numbers.includes(0));assert.ok(Number.isFinite(lounge.userData.spinTo));
});
test('no-DOM renderer gracefully supports updates, inactive mode and repeated disposal',()=>{
  const scene=new KatlayanziScene();assert.equal(scene.renderer,null);scene.update(view());scene.setActive(true);scene.setActive(false);assert.equal(scene.frame,null);scene.dispose();scene.dispose();assert.equal(scene.disposed,true);
});

test('disposing the lounge releases shared textures once and ignores late snapshots',()=>{
  const scene=new KatlayanziScene();
  const texture=new THREE.Texture();let releases=0;texture.addEventListener('dispose',()=>releases++);
  scene.lounge.userData.textureCache.set('shared',texture);
  const card=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:texture}));
  const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture}));
  scene.lounge.add(card,label);
  scene.dispose();scene.dispose();
  assert.equal(releases,1);
  assert.equal(scene.lounge.children.length,0);
  scene.update(view());scene.setActive(true);
  assert.equal(scene.lounge.children.length,0);
  assert.equal(scene.frame,null);
});
