import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuildings, disposeWorldGroup } from '../src/building-world.js';
import { CarVisualizer3D } from '../src/visualizer.js';

test('building chunks include lit and unlit window materials at an approximately thirty percent ratio',()=>{
  const buildings=Array.from({length:100},(_,i)=>{
    const x=(i%10)*24,y=Math.floor(i/10)*24;
    return {height:9,points:[[x,y],[x+8,y],[x+8,y+8],[x,y+8],[x,y]]};
  });
  let randomIndex=0;
  const group=buildBuildings({buildings},{random:()=>randomIndex++%10<3?.1:.9});
  const stats=group.userData.windowLighting;
  assert.equal(stats.totalWindows,1200);
  assert.equal(stats.litWindows,360);
  assert.ok(stats.litWindows/stats.totalWindows>.25&&stats.litWindows/stats.totalWindows<.35);
  assert.ok(stats.litMaterials[0].emissiveIntensity>.0);
  assert.equal(stats.unlitMaterials[0].emissiveIntensity,0);
  CarVisualizer3D.prototype.setBuildingNightMode.call({roadGroup:group},false);
  assert.equal(stats.litMaterials[0].emissiveIntensity,0);
  CarVisualizer3D.prototype.setBuildingNightMode.call({roadGroup:group},true);
  assert.equal(stats.litMaterials[0].emissiveIntensity,.9);
  disposeWorldGroup(group);
});

test('malformed buildings are skipped without exceptions or non-finite geometry',()=>{
  const good={height:8,points:[[0,0],[6,0],[6,5],[0,5],[0,0]]};
  const malformed=[null,undefined,{},[],
    {...good,height:NaN},{...good,height:Infinity},{...good,height:0},{...good,height:1001},
    {...good,minHeight:NaN},{...good,minHeight:Infinity},{...good,minHeight:8},
    {...good,points:null},{...good,points:[[0,0],[1,1]]},
    {...good,points:[[0,0],[1,1],[2,2],[0,0]]},
    {...good,points:[[0,0],[6,0],[6,5],[NaN,5],[0,0]]},
    {...good,points:[[0,0],[6,0],[6,5],[0,5],[Infinity,0]]},
    {...good,points:[[0,0],[1e30,0],[1e30,5],[0,5],[0,0]]}];
  const group=buildBuildings({buildings:[...malformed,good]},{random:()=>.9});
  assert.equal(group.children.length,1);
  const geometry=group.children[0].geometry;
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
  assert.equal(group.userData.windowLighting.totalWindows,12);
  disposeWorldGroup(group);

  for(const network of [null,undefined,{}, {buildings:null}, {buildings:{}}]) {
    const empty=buildBuildings(network);
    assert.equal(empty.children.length,0);
    disposeWorldGroup(empty);
  }
});

test('valid closed and open footprints retain finite extrusions and min-height clearance',()=>{
  const group=buildBuildings({buildings:[
    {height:12,minHeight:3,points:[[10,20],[18,20],[18,30],[10,30],[10,20]]},
    {height:6,points:[[130,20],[136,20],[136,26],[130,26]]}
  ]},{random:()=>.9});
  assert.equal(group.children.length,2);
  const geometry=group.children.find(chunk=>chunk.name.endsWith('0,0')).geometry;
  geometry.computeBoundingBox();
  assert.deepEqual([geometry.boundingBox.min.x,geometry.boundingBox.max.x],[10,18]);
  assert.equal(geometry.boundingBox.min.y,3);
  assert.equal(geometry.boundingBox.max.y,12);
  assert.equal(geometry.boundingBox.min.z,-30);
  assert.equal(geometry.boundingBox.max.z,-20);
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
  assert.equal(group.userData.windowLighting.totalWindows,20);
  assert.equal(group.userData.windowLighting.litWindows,0);
  disposeWorldGroup(group);
});
