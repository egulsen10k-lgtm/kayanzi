import test from 'node:test';
import assert from 'node:assert/strict';
import {coastalSegments,isMappedSea,buildCoastalWater} from '../src/coastal-water.js';
import {disposeWorldGroup} from '../src/building-world.js';
test('sea follows oriented mapped coast and does not invent water beyond missing endpoints',()=>{
  const segments=coastalSegments([{points:[[-800,0],[800,0]]}]);
  assert.equal(isMappedSea([0,-100],segments),true);
  assert.equal(isMappedSea([0,100],segments),false);
  assert.equal(isMappedSea([900,-100],segments),false);
  assert.equal(isMappedSea([0,-800],segments),false);
  assert.equal(isMappedSea([0,-100],[]),false);
});
test('coastal geometry stays seaward and releases its GPU geometry',()=>{
  const group=buildCoastalWater({coastlines:[{points:[[-800,0],[800,0]]}]});
  const mesh=group.getObjectByName('sea-surface');assert.ok(mesh);
  const p=mesh.geometry.attributes.position;
  for(let i=0;i<p.count;i++)assert.ok(p.getZ(i)>0,'all water must stay south of eastward coast');
  let disposed=false;mesh.geometry.addEventListener('dispose',()=>disposed=true);
  mesh.userData.animateWater(5);disposeWorldGroup(group);assert.ok(disposed);
  assert.equal(buildCoastalWater({}).children.length,0);
});
