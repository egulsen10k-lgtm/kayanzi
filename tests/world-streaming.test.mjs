import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyCachedWorld,nextWorldLocation,distanceMeters} from '../src/world-streaming.js';
import {buildBuildings,disposeWorldGroup} from '../src/building-world.js';

test('nearby worlds reuse cached patches but stale or distant ones do not',()=>{
  const cache=new Map([['old',{savedAt:0,network:{center:{lat:0,lng:0}}}],['near',{savedAt:300000,network:{center:{lat:0,lng:.0001}}}]]);
  assert.equal(nearbyCachedWorld(cache,0,0,300001).key,'near');
  assert.equal(nearbyCachedWorld(cache,0,.01,300001),null);
  assert.equal(nearbyCachedWorld(cache,0,0,600001),null);
});
test('streaming looks ahead with bounded distance and follows reverse direction',()=>{
  const origin={lat:40,lng:29};
  const ahead=nextWorldLocation(origin,0,90),reverse=nextWorldLocation(origin,0,-18);
  assert.ok(ahead.lat>origin.lat&&reverse.lat<origin.lat);
  assert.ok(distanceMeters(origin,ahead)<=100.01);
  assert.ok(Math.abs(distanceMeters(origin,reverse)-20)<.01);
  const wrapped=nextWorldLocation({lat:0,lng:179.9999},Math.PI/2,200);
  assert.ok(wrapped.lng<0);
});
test('buildings batch by spatial chunk with only roof and wall draw groups',()=>{
  const buildings=Array.from({length:20},(_,i)=>({id:i,height:10,points:[[i*3,0],[i*3+2,0],[i*3+2,2],[i*3,2],[i*3,0]]}));
  const group=buildBuildings({buildings});
  assert.equal(group.children.length,1);
  const geometry=group.children[0].geometry;
  assert.equal(geometry.groups.length,2);
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.y===10&&geometry.boundingBox.max.x===59);
  let disposed=false;geometry.addEventListener('dispose',()=>disposed=true);
  disposeWorldGroup(group);assert.ok(disposed);
});
