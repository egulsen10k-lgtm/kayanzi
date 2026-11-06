import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectCasinoBuildings,nearbyCasino,buildCasinoExteriors,CASINO_ENTRY_RADIUS} from '../src/casino-locations.js';
import {decodeWorld} from '../src/road-network.js';
import {disposeWorldGroup} from '../src/building-world.js';
const building=(id,x=0,y=12)=>({id,height:8,minHeight:0,points:[[x,y],[x+12,y],[x+12,y+12],[x,y+12],[x,y]]});
const network=()=>({roads:[{width:6,points:[[-250,0],[250,0]],elevations:[0,0]}],buildings:[building(1),building(2,100),building(3,-100)]});
test('casino entrances use mapped ground footprints near streets and remain deterministic',()=>{
  const n=network(),a=selectCasinoBuildings(n),b=selectCasinoBuildings({...n,buildings:[...n.buildings].reverse()});
  assert.equal(a.length,3);assert.deepEqual(a.map(v=>v.id),b.map(v=>v.id));
  assert.ok(a.every(v=>n.buildings.some(b=>String(b.id)===v.id)&&v.entrance.every(Number.isFinite)));
  const pinned=selectCasinoBuildings(n,[a[2].id]);assert.equal(pinned[0].id,a[2].id);
});
test('only a nearby ground-level casino entrance enables access',()=>{
  const venues=selectCasinoBuildings(network()),v=venues[0];
  assert.equal(nearbyCasino(venues,v.entrance,.08).allowed,true);
  const one=[v];assert.equal(nearbyCasino(one,[v.entrance[0]+CASINO_ENTRY_RADIUS,v.entrance[1]]).allowed,true);
  assert.equal(nearbyCasino(one,[v.entrance[0]+CASINO_ENTRY_RADIUS+1,v.entrance[1]]).allowed,false);
  for(const height of [5,-5,NaN,Infinity])assert.equal(nearbyCasino(one,v.entrance,height).allowed,false);
  assert.equal(nearbyCasino([],v.entrance).allowed,false);assert.equal(nearbyCasino(one,[NaN,0]).allowed,false);
});
test('missing data, malformed footprints and elevated approaches create no casino',()=>{
  for(const n of [null,{}, {buildings:[],roads:[]}, {...network(),buildings:[null,{points:null},building(1,0,200)]}, {...network(),roads:[{width:6,points:[[-250,0],[250,0]],bridge:true}]}])assert.deepEqual(selectCasinoBuildings(n),[]);
  assert.deepEqual(selectCasinoBuildings({...network(),buildings:[{...building(1),minHeight:NaN}]}),[]);
});
test('casino exteriors have named doors, marquee lighting and finite mapped geometry',()=>{
  const venues=selectCasinoBuildings(network());const group=buildCasinoExteriors(venues);
  assert.equal(group.children.filter(c=>c.userData.casinoId).length,venues.length);
  assert.ok(group.getObjectByName('casino-sign'));assert.ok(group.getObjectByName('casino-door'));assert.ok(group.getObjectByName('casino-roof-lights'));
  group.traverse(object=>{if(object.geometry?.attributes.position)assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));});disposeWorldGroup(group);
});
test('starter district offers reachable casino buildings within its loaded streets',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/munich.json',import.meta.url)));
  const world=decodeWorld(data.elements,48.1764,11.5583,450),venues=selectCasinoBuildings(world);
  assert.ok(venues.length>0&&venues.length<=3);assert.ok(Math.hypot(...venues[0].entrance)<150);
  assert.equal(nearbyCasino(venues,[0,0]).allowed,false);assert.ok(venues.every(v=>nearbyCasino(venues,v.roadPoint).allowed));
});
